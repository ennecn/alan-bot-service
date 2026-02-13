import fetch from 'node-fetch';
import { SocksProxyAgent } from 'socks-proxy-agent';
import {
  getEnabledProviders,
  getProviderById,
  markProviderExhausted,
  incrementErrorCount,
  resetProviderHealth,
  rotateApiKey,
  logRequest,
  getSetting,
  getClientByApiKey
} from './db.js';
import {
  notifyProviderSwitch,
  notifyProviderExhausted,
  notifyAllProvidersDown,
  notifyError,
  notifyModelDowngrade
} from './telegram.js';
import { getActiveTier, recordQuotaError } from "./fallback.js";

let lastActiveProvider = null;

// Premium models - if request is for these but we can't use them, notify
const PREMIUM_MODELS = [
  'claude-opus-4-6',
  'claude-opus-4-6-thinking',
  'claude-opus-4-5',
  'claude-opus-4-5-thinking'
];

// Check if model is a downgrade from requested
function isModelDowngrade(requestedModel, actualProvider) {
  // If requested opus 4.6 but provider doesn't support it
  if (requestedModel.includes('opus-4-6') && actualProvider.name === 'Kimi') {
    return true; // Kimi doesn't have Claude
  }
  return false;
}

function getProxyAgent() {
  const proxyUrl = getSetting('proxy_url');
  if (proxyUrl) {
    return new SocksProxyAgent(proxyUrl);
  }
  return null;
}

function isProviderAvailable(provider) {
  if (!provider.enabled) return false;
  if (provider.health_status === 'unhealthy') return false;

  // Check if exhausted
  if (provider.exhausted_until) {
    const now = Math.floor(Date.now() / 1000);
    if (now < provider.exhausted_until) {
      return false;
    }
    // Recovery time passed, reset status
    resetProviderHealth(provider.id);
  }

  return true;
}

function getProviderForModel(model, providers) {
  // Check allowed models
  const allowedModelsJson = getSetting('allowed_models');
  if (allowedModelsJson) {
    const allowedModels = JSON.parse(allowedModelsJson);
    if (allowedModels.length > 0 && !allowedModels.includes(model)) {
      return { error: 'model_not_allowed', message: `Model ${model} is not in the allowed list` };
    }
  }

  // Find providers that support this model
  const eligibleProviders = [];

  for (const provider of providers) {
    if (!isProviderAvailable(provider)) continue;

    const supportedModels = JSON.parse(provider.supported_models || '[]');
    // Empty supported_models means provider accepts all models
    if (supportedModels.length === 0 || supportedModels.includes(model)) {
      eligibleProviders.push(provider);
    }
  }

  return eligibleProviders;
}

function getActualModel(model, provider) {
  const mapping = JSON.parse(provider.model_mapping || '{}');
  return mapping[model] || model;
}

function getApiKey(provider) {
  const keys = JSON.parse(provider.api_keys || '[]');
  if (keys.length === 0) return null;
  const index = provider.current_key_index || 0;
  return keys[index % keys.length];
}

function isQuotaError(statusCode, body) {
  if (statusCode === 429) return true;

  // Check for quota-related error messages
  if (typeof body === 'string') {
    const lowerBody = body.toLowerCase();
    if (lowerBody.includes('quota') || lowerBody.includes('rate limit') || lowerBody.includes('exceeded')) {
      return true;
    }
  }

  return false;
}

function isServerError(statusCode) {
  return statusCode >= 500 && statusCode < 600;
}

// --- OpenAI <-> Anthropic format conversion ---

function convertAnthropicToOpenAI(body) {
  const openaiBody = {
    model: body.model,
    messages: [],
    max_tokens: body.max_tokens || 4096,
  };

  // Convert system prompt to system message
  if (body.system) {
    if (typeof body.system === 'string') {
      openaiBody.messages.push({ role: 'system', content: body.system });
    } else if (Array.isArray(body.system)) {
      const text = body.system.map(b => b.text || '').join('\n');
      openaiBody.messages.push({ role: 'system', content: text });
    }
  }

  // Convert messages
  for (const msg of body.messages || []) {
    const openaiMsg = { role: msg.role };

    if (typeof msg.content === 'string') {
      openaiMsg.content = msg.content;
    } else if (Array.isArray(msg.content)) {
      const parts = [];
      for (const block of msg.content) {
        if (block.type === 'text') {
          parts.push({ type: 'text', text: block.text });
        } else if (block.type === 'image') {
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` }
          });
        } else if (block.type === 'tool_use') {
          // Skip tool_use blocks in conversion (not directly mappable)
        } else if (block.type === 'tool_result') {
          // Skip tool_result blocks
        }
      }
      openaiMsg.content = parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts;
    }

    openaiBody.messages.push(openaiMsg);
  }

  // Copy optional params
  if (body.temperature !== undefined) openaiBody.temperature = body.temperature;
  if (body.top_p !== undefined) openaiBody.top_p = body.top_p;

  // Enable reasoning for models that support it
  if (body.thinking || body.model?.includes('kimi-k2')) {
    openaiBody.reasoning = { effort: 'high' };
  }

  return openaiBody;
}

function convertOpenAIToAnthropic(openaiResponse, requestedModel) {
  const choice = openaiResponse.choices?.[0];
  if (!choice) {
    return {
      id: openaiResponse.id || `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model: requestedModel,
      content: [{ type: 'text', text: 'No response generated' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 }
    };
  }

  const content = [];

  // Handle reasoning/thinking content
  if (choice.message?.reasoning_content) {
    content.push({
      type: 'thinking',
      thinking: choice.message.reasoning_content
    });
  }

  // Handle main content
  if (choice.message?.content) {
    content.push({
      type: 'text',
      text: choice.message.content
    });
  }

  // Map finish_reason to Anthropic stop_reason
  const stopReasonMap = {
    'stop': 'end_turn',
    'length': 'max_tokens',
    'content_filter': 'end_turn'
  };

  return {
    id: openaiResponse.id || `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: requestedModel,
    content: content,
    stop_reason: stopReasonMap[choice.finish_reason] || 'end_turn',
    usage: {
      input_tokens: openaiResponse.usage?.prompt_tokens || 0,
      output_tokens: openaiResponse.usage?.completion_tokens || 0
    }
  };
}

// Collect OpenAI SSE streaming chunks into a complete response
async function collectOpenAIStream(response) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let result = {
      id: null,
      model: null,
      content: '',
      reasoning_content: '',
      finish_reason: null,
      usage: null
    };

    response.body.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          if (!result.id) result.id = parsed.id;
          if (!result.model) result.model = parsed.model;

          const choice = parsed.choices?.[0];
          if (choice) {
            if (choice.delta?.content) result.content += choice.delta.content;
            if (choice.delta?.reasoning_content) result.reasoning_content += choice.delta.reasoning_content;
            if (choice.delta?.reasoning) result.reasoning_content += choice.delta.reasoning;
            if (choice.finish_reason) result.finish_reason = choice.finish_reason;
          }
          if (parsed.usage) result.usage = parsed.usage;
        } catch (e) {
          // Skip unparseable chunks
        }
      }
    });

    response.body.on('end', () => resolve(result));
    response.body.on('error', (err) => reject(err));
  });
}

export async function routeRequest(requestBody, headers) {
  // 1. Identify client from API key
  const clientApiKey = headers['x-api-key'] || (headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  const client = clientApiKey ? getClientByApiKey(clientApiKey) : null;

  if (client) {
    console.log(`[Router] Client identified: ${client.name} (id=${client.id})`);
  }

  // 2. Determine model: client default_model overrides if request model is empty
  let model = requestBody.model;
  if (!model && client && client.default_model) {
    model = client.default_model;
    console.log(`[Router] Using client default model: ${model}`);
  }
  if (!model) {
    return {
      status: 400,
      body: { error: { type: 'invalid_request', message: 'Model is required' } }
    };
  }

  // 3. Apply client-level model mapping (takes priority over provider mapping)
  if (client) {
    const clientMapping = JSON.parse(client.model_mapping || '{}');
    if (clientMapping[model]) {
      console.log(`[Router] Client model mapping: ${model} -> ${clientMapping[model]}`);
      model = clientMapping[model];
    }
  }


  // 3.5. Fallback: check active tier and override model if needed
  const activeTier = getActiveTier(model);
  if (activeTier && activeTier.model !== model) {
    console.log(`[Fallback] Model override: ${model} -> ${activeTier.model} (tier ${activeTier.tier}, provider: ${activeTier.provider})`);
    model = activeTier.model;
  }

  // 4. Get providers, optionally reordered by client's provider_order
  let providers = getEnabledProviders();

  if (client) {
    const clientProviderOrder = JSON.parse(client.provider_order || '[]');
    if (clientProviderOrder.length > 0) {
      // Reorder: client's preferred providers first, then remaining by default priority
      const ordered = [];
      for (const pid of clientProviderOrder) {
        const p = providers.find(pr => pr.id === pid);
        if (p) ordered.push(p);
      }
      // Append any remaining providers not in client's list
      for (const p of providers) {
        if (!clientProviderOrder.includes(p.id)) {
          ordered.push(p);
        }
      }
      providers = ordered;
    }
  }

  const eligibleProviders = getProviderForModel(model, providers);

  if (eligibleProviders.error) {
    return {
      status: 403,
      body: { error: { type: eligibleProviders.error, message: eligibleProviders.message } }
    };
  }

  if (eligibleProviders.length === 0) {
    await notifyAllProvidersDown();
    return {
      status: 503,
      body: { error: { type: 'no_providers', message: 'No providers available for this model' } }
    };
  }

  let cascadedFrom = null;

  // Try each provider in priority order
  for (const provider of eligibleProviders) {
    const apiKey = getApiKey(provider);
    if (!apiKey) {
      console.log(`[Router] Skipping ${provider.name}: no API key configured`);
      continue;
    }

    // Notify if switching providers
    if (lastActiveProvider && lastActiveProvider !== provider.name) {
      await notifyProviderSwitch(lastActiveProvider, provider.name, 'Failover cascade');
    }

    // Check for model downgrade (e.g., requested opus but falling back to Kimi)
    if (PREMIUM_MODELS.some(m => model.includes(m.replace('claude-', '')) || model === m)) {
      if (provider.name === 'Kimi') {
        await notifyModelDowngrade(model, 'Kimi model', provider.name, 'Claude providers unavailable, using Kimi as fallback');
      }
    }

    const actualModel = getActualModel(model, provider);
    const startTime = Date.now();
    const isOpenAI = (provider.api_format || 'anthropic') === 'openai';

    try {
      // Determine if we need proxy
      let agent = null;
      if (provider.route_type === 'overseas') {
        agent = getProxyAgent();
      }

      // Build request URL based on API format
      const url = isOpenAI
        ? `${provider.base_url}/chat/completions`
        : `${provider.base_url}/v1/messages`;

      // Build request body with actual model
      let proxyBody;
      if (isOpenAI) {
        proxyBody = convertAnthropicToOpenAI({ ...requestBody, model: actualModel });
        // NVIDIA requires streaming - force it on
        proxyBody.stream = true;
      } else {
        proxyBody = { ...requestBody, model: actualModel };
      }

      // Build headers based on API format
      let proxyHeaders;
      if (isOpenAI) {
        proxyHeaders = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        };
      } else {
        proxyHeaders = {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': headers['anthropic-version'] || '2023-06-01'
        };
        // For local/antigravity, we might need different header format
        if (provider.route_type === 'local' || provider.base_url.includes('127.0.0.1')) {
          proxyHeaders['Authorization'] = `Bearer ${apiKey}`;
        }
      }

      console.log(`[Router] Trying ${provider.name} (${provider.route_type}${isOpenAI ? ', openai' : ''}) for model ${actualModel}`);

      const fetchOptions = {
        method: 'POST',
        headers: proxyHeaders,
        body: JSON.stringify(proxyBody)
      };

      if (agent) {
        fetchOptions.agent = agent;
      }

      const response = await fetch(url, fetchOptions);
      const latencyMs = Date.now() - startTime;

      // Handle streaming response (only for Anthropic format providers)
      if (requestBody.stream && response.ok && !isOpenAI) {
        lastActiveProvider = provider.name;

        logRequest({
          provider_id: provider.id,
          provider_name: provider.name,
          model: model,
          status_code: response.status,
          latency_ms: latencyMs,
          cascaded_from: cascadedFrom,
          client_id: client?.id,
          client_name: client?.name
        });

        // Reset error count on success
        resetProviderHealth(provider.id);

        return {
          status: response.status,
          headers: Object.fromEntries(response.headers),
          stream: response.body,
          provider: provider.name
        };
      }

      // Handle OpenAI streaming: collect chunks and convert to Anthropic format
      if (isOpenAI && response.ok) {
        try {
          const streamResult = await collectOpenAIStream(response);
          const latencyMsFinal = Date.now() - startTime;

          lastActiveProvider = provider.name;

          // Build Anthropic-format response from collected stream
          const content = [];
          if (streamResult.reasoning_content) {
            content.push({ type: 'thinking', thinking: streamResult.reasoning_content });
          }
          if (streamResult.content) {
            content.push({ type: 'text', text: streamResult.content });
          }
          if (content.length === 0) {
            content.push({ type: 'text', text: '' });
          }

          const stopReasonMap = { 'stop': 'end_turn', 'length': 'max_tokens' };
          const finalBody = {
            id: streamResult.id || `msg_${Date.now()}`,
            type: 'message',
            role: 'assistant',
            model: model,
            content: content,
            stop_reason: stopReasonMap[streamResult.finish_reason] || 'end_turn',
            usage: {
              input_tokens: streamResult.usage?.prompt_tokens || 0,
              output_tokens: streamResult.usage?.completion_tokens || 0
            }
          };

          logRequest({
            provider_id: provider.id,
            provider_name: provider.name,
            model: model,
            status_code: 200,
            latency_ms: latencyMsFinal,
            tokens_in: finalBody.usage.input_tokens,
            tokens_out: finalBody.usage.output_tokens,
            cascaded_from: cascadedFrom,
            client_id: client?.id,
            client_name: client?.name
          });

          resetProviderHealth(provider.id);

          return {
            status: 200,
            body: finalBody,
            provider: provider.name
          };
        } catch (streamError) {
          console.error(`[Router] ${provider.name} stream collection error:`, streamError.message);
          incrementErrorCount(provider.id);
          cascadedFrom = provider.name;
          continue;
        }
      }

      // Non-streaming response
      const responseText = await response.text();
      let responseBody;

      try {
        responseBody = JSON.parse(responseText);
      } catch {
        responseBody = responseText;
      }

      // Check for errors
      if (!response.ok) {
        console.log(`[Router] ${provider.name} returned ${response.status}`);

        // Handle quota errors
        if (isQuotaError(response.status, responseText)) {
          console.log(`[Router] ${provider.name} quota exhausted, marking unavailable`);
          markProviderExhausted(provider.id);
          await notifyProviderExhausted(provider.name, provider.recovery_minutes);

          // Try to rotate key first
          rotateApiKey(provider.id);

          cascadedFrom = provider.name;
          continue; // Try next provider
        }

        // Handle server errors
        if (isServerError(response.status)) {
          console.log(`[Router] ${provider.name} server error`);
          incrementErrorCount(provider.id);
          cascadedFrom = provider.name;
          continue; // Try next provider
        }

        // Other errors (4xx except 429) - return to client
        logRequest({
          provider_id: provider.id,
          provider_name: provider.name,
          model: model,
          status_code: response.status,
          latency_ms: latencyMs,
          error_type: responseBody?.error?.type || 'unknown',
          error_message: responseBody?.error?.message || responseText.substring(0, 500),
          cascaded_from: cascadedFrom,
          client_id: client?.id,
          client_name: client?.name
        });

        return {
          status: response.status,
          body: responseBody,
          provider: provider.name
        };
      }

      // Success!
      lastActiveProvider = provider.name;

      // Convert OpenAI response to Anthropic format
      let finalBody = responseBody;
      if (isOpenAI && typeof responseBody === 'object') {
        finalBody = convertOpenAIToAnthropic(responseBody, model);
      }

      const usage = finalBody?.usage || {};
      logRequest({
        provider_id: provider.id,
        provider_name: provider.name,
        model: model,
        status_code: response.status,
        latency_ms: latencyMs,
        tokens_in: usage.input_tokens || usage.prompt_tokens,
        tokens_out: usage.output_tokens || usage.completion_tokens,
        cascaded_from: cascadedFrom,
        client_id: client?.id,
        client_name: client?.name
      });

      // Reset error count on success
      resetProviderHealth(provider.id);

      return {
        status: response.status,
        body: finalBody,
        provider: provider.name
      };

    } catch (error) {
      console.error(`[Router] ${provider.name} error:`, error.message);
      incrementErrorCount(provider.id);

      logRequest({
        provider_id: provider.id,
        provider_name: provider.name,
        model: model,
        error_type: 'network_error',
        error_message: error.message,
        cascaded_from: cascadedFrom,
        client_id: client?.id,
        client_name: client?.name
      });

      await notifyError(provider.name, 'network_error', error.message);
      cascadedFrom = provider.name;
      continue; // Try next provider
    }
  }

  // All providers failed
  await notifyAllProvidersDown();
  return {
    status: 503,
    body: { error: { type: 'all_providers_failed', message: 'All providers failed to process the request' } }
  };
}

export function getActiveProvider() {
  return lastActiveProvider;
}

export function getRouterStatus() {
  const providers = getEnabledProviders();
  const available = providers.filter(p => isProviderAvailable(p));

  return {
    active_provider: lastActiveProvider,
    total_providers: providers.length,
    available_providers: available.length,
    providers: providers.map(p => ({
      id: p.id,
      name: p.name,
      route_type: p.route_type,
      priority: p.priority,
      enabled: p.enabled === 1,
      available: isProviderAvailable(p),
      health_status: p.health_status,
      error_count: p.error_count,
      exhausted_until: p.exhausted_until ? new Date(p.exhausted_until * 1000).toISOString() : null
    }))
  };
}

// Export fallback functions
export { getFallbackStatus, resetTier, resetAllTiers } from "./fallback.js";
