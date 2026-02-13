const http = require('http');
const https = require('https');

const PORT = 8047;
const OPENAI_HOST = '127.0.0.1';
const OPENAI_PORT = 8045;

// NVIDIA API configuration (via VPS proxy)
const NVIDIA_HOST = '138.68.44.141';
const NVIDIA_PORT = 8046;
const NVIDIA_API_KEY = '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';

// Model mapping: incoming model -> { target model, backend }
// backend: 'openai' (local 8045) or 'nvidia' (VPS 8046)
const MODEL_MAP = {
  // Claude Code models -> NVIDIA Kimi K2.5
  'claude-opus-4-6': { model: 'moonshotai/kimi-k2.5', backend: 'nvidia' },
  'claude-4-opus': { model: 'moonshotai/kimi-k2.5', backend: 'nvidia' },
  'claude-opus-4': { model: 'moonshotai/kimi-k2.5', backend: 'nvidia' },
  'anthropic/claude-opus-4-6': { model: 'moonshotai/kimi-k2.5', backend: 'nvidia' },
  'claude-3-5-sonnet-20241022': { model: 'moonshotai/kimi-k2.5', backend: 'nvidia' },
  'claude-sonnet-4-5': { model: 'moonshotai/kimi-k2.5', backend: 'nvidia' },
  'claude-haiku-4-5': { model: 'moonshotai/kimi-k2.5', backend: 'nvidia' },
  // Date-suffixed variants from Claude Code
  'claude-haiku-4-5-20251001': { model: 'moonshotai/kimi-k2.5', backend: 'nvidia' },
  'claude-sonnet-4-5-20251001': { model: 'moonshotai/kimi-k2.5', backend: 'nvidia' },
  'claude-opus-4-6-20251001': { model: 'moonshotai/kimi-k2.5', backend: 'nvidia' },

  // Direct Kimi model names
  'kimi-k2.5': { model: 'moonshotai/kimi-k2.5', backend: 'nvidia' },
  'kimi-k2-thinking': { model: 'moonshotai/kimi-k2-thinking', backend: 'nvidia' },
  'moonshotai/kimi-k2.5': { model: 'moonshotai/kimi-k2.5', backend: 'nvidia' },
  'moonshotai/kimi-k2-thinking': { model: 'moonshotai/kimi-k2-thinking', backend: 'nvidia' },
};

// Fallback: route any claude-* model to NVIDIA if not explicitly mapped
function getModelMapping(model) {
  if (MODEL_MAP[model]) {
    return MODEL_MAP[model];
  }
  // Any claude model -> NVIDIA Kimi
  if (model.startsWith('claude-')) {
    return { model: 'moonshotai/kimi-k2.5', backend: 'nvidia' };
  }
  // Default: pass through to local OpenAI
  return { model: model, backend: 'openai' };
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// Convert Anthropic messages to OpenAI format
function convertToOpenAI(anthropicBody) {
  const messages = [];

  // Add system message if present
  if (anthropicBody.system) {
    messages.push({
      role: 'system',
      content: typeof anthropicBody.system === 'string'
        ? anthropicBody.system
        : anthropicBody.system.map(s => s.text).join('\n')
    });
  }

  // Convert messages
  for (const msg of anthropicBody.messages || []) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      let content = msg.content;

      // Handle array content (multimodal)
      if (Array.isArray(content)) {
        const parts = [];
        for (const part of content) {
          if (part.type === 'text') {
            parts.push({ type: 'text', text: part.text });
          } else if (part.type === 'image') {
            parts.push({
              type: 'image_url',
              image_url: {
                url: `data:${part.source.media_type};base64,${part.source.data}`
              }
            });
          } else if (part.type === 'tool_use') {
            // Tool use in assistant message - convert to tool_calls
            continue; // Handle separately
          } else if (part.type === 'tool_result') {
            // Tool result - convert to tool message
            continue; // Handle separately
          }
        }
        content = parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts;
      }

      messages.push({ role: msg.role, content });
    }
  }

  // Build OpenAI request
  const openaiBody = {
    model: anthropicBody.model,
    messages,
    max_tokens: anthropicBody.max_tokens,
    stream: anthropicBody.stream || false
  };

  // Optional parameters
  if (anthropicBody.temperature !== undefined) openaiBody.temperature = anthropicBody.temperature;
  if (anthropicBody.top_p !== undefined) openaiBody.top_p = anthropicBody.top_p;
  if (anthropicBody.stop_sequences) openaiBody.stop = anthropicBody.stop_sequences;

  // Convert tools if present
  if (anthropicBody.tools && anthropicBody.tools.length > 0) {
    openaiBody.tools = anthropicBody.tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema
      }
    }));
  }

  return openaiBody;
}

// Convert OpenAI response to Anthropic format
function convertToAnthropic(openaiResponse, isStream = false) {
  if (isStream) {
    // Handle streaming chunk
    const choice = openaiResponse.choices?.[0];
    if (!choice) return null;

    const delta = choice.delta || {};
    const content = [];

    if (delta.content) {
      content.push({ type: 'text', text: delta.content });
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id || `tool_${Date.now()}`,
          name: tc.function?.name,
          input: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}
        });
      }
    }

    return {
      type: 'content_block_delta',
      index: 0,
      delta: content.length > 0 ? { type: 'text_delta', text: delta.content || '' } : null
    };
  }

  // Non-streaming response
  const choice = openaiResponse.choices?.[0];
  if (!choice) {
    return {
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [],
      model: openaiResponse.model,
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 }
    };
  }

  const content = [];
  const message = choice.message;

  if (message.content) {
    content.push({ type: 'text', text: message.content });
  }

  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments || '{}')
      });
    }
  }

  // Map stop reason
  let stopReason = 'end_turn';
  if (choice.finish_reason === 'length') stopReason = 'max_tokens';
  else if (choice.finish_reason === 'tool_calls') stopReason = 'tool_use';
  else if (choice.finish_reason === 'stop') stopReason = 'end_turn';

  return {
    id: `msg_${openaiResponse.id || Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model: openaiResponse.model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: openaiResponse.usage?.prompt_tokens || 0,
      output_tokens: openaiResponse.usage?.completion_tokens || 0
    }
  };
}

// Handle streaming response
function handleStreamingResponse(proxyRes, res, model) {
  // Send SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // Send message_start event
  const msgId = `msg_${Date.now()}`;
  res.write(`event: message_start\ndata: ${JSON.stringify({
    type: 'message_start',
    message: {
      id: msgId,
      type: 'message',
      role: 'assistant',
      content: [],
      model: model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 }
    }
  })}\n\n`);

  // Send content_block_start
  res.write(`event: content_block_start\ndata: ${JSON.stringify({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' }
  })}\n\n`);

  let buffer = '';
  let totalOutput = 0;

  proxyRes.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          // Send content_block_stop
          res.write(`event: content_block_stop\ndata: ${JSON.stringify({
            type: 'content_block_stop',
            index: 0
          })}\n\n`);

          // Send message_delta with stop_reason
          res.write(`event: message_delta\ndata: ${JSON.stringify({
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: totalOutput }
          })}\n\n`);

          // Send message_stop
          res.write(`event: message_stop\ndata: ${JSON.stringify({
            type: 'message_stop'
          })}\n\n`);

          res.end();
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;

          if (delta?.content) {
            totalOutput += delta.content.length;
            res.write(`event: content_block_delta\ndata: ${JSON.stringify({
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: delta.content }
            })}\n\n`);
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    }
  });

  proxyRes.on('end', () => {
    if (!res.writableEnded) {
      res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
      res.end();
    }
  });

  proxyRes.on('error', (err) => {
    log(`Stream error: ${err.message}`);
    if (!res.writableEnded) {
      res.end();
    }
  });
}

// Main request handler
function handleRequest(req, res) {
  log(`${req.method} ${req.url}`);

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'anthropic-proxy', target: `${OPENAI_HOST}:${OPENAI_PORT}` }));
    return;
  }

  // Return available models - include mapped models so Claude Code validation passes
  if (req.method === 'GET' && req.url === '/v1/models') {
    const models = [
      'claude-opus-4-6',
      'claude-opus-4-5-thinking',
      'claude-sonnet-4-5',
      'claude-sonnet-4-5-thinking',
      'claude-haiku-4-5',
      'claude-3-5-sonnet-20241022',
      'kimi-k2.5',
      'kimi-k2-thinking',
      'gemini-3-pro',
      'gemini-3-pro-high',
      'gpt-4o',
      'gpt-4-turbo'
    ];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      object: 'list',
      data: models.map(id => ({
        id,
        object: 'model',
        created: 1706745600,
        owned_by: 'antigravity'
      }))
    }));
    return;
  }

  // Parse URL to handle query parameters
  const urlPath = req.url.split('?')[0];

  // Handle count_tokens endpoint (return dummy response for now)
  if (req.method === 'POST' && urlPath === '/v1/messages/count_tokens') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        // Return a dummy token count
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          input_tokens: Math.ceil((JSON.stringify(data.messages || []).length) / 4)
        }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ input_tokens: 100 }));
      }
    });
    return;
  }

  if (req.method !== 'POST' || urlPath !== '/v1/messages') {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });

  req.on('end', () => {
    try {
      const anthropicBody = JSON.parse(body);
      const isStream = anthropicBody.stream === true;

      // Apply model mapping using fallback function
      const originalModel = anthropicBody.model;
      const mapping = getModelMapping(originalModel);
      const targetModel = mapping.model;
      const targetBackend = mapping.backend;

      if (targetModel !== originalModel) {
        anthropicBody.model = targetModel;
        log(`Model mapped: ${originalModel} -> ${targetModel} (backend: ${targetBackend})`);
      }

      log(`Received: model=${anthropicBody.model} stream=${isStream} backend=${targetBackend}`);

      // Convert to OpenAI format
      const openaiBody = convertToOpenAI(anthropicBody);

      // NVIDIA requires streaming
      if (targetBackend === 'nvidia') {
        openaiBody.stream = true;
      }

      const targetBody = JSON.stringify(openaiBody);

      // Determine target host/port based on backend
      let targetHost, targetPort, authHeader;
      if (targetBackend === 'nvidia') {
        targetHost = NVIDIA_HOST;
        targetPort = NVIDIA_PORT;
        authHeader = `Bearer ${NVIDIA_API_KEY}`;
      } else {
        targetHost = OPENAI_HOST;
        targetPort = OPENAI_PORT;
        authHeader = `Bearer ${req.headers['x-api-key'] || 'sk-antigravity-openclaw'}`;
      }

      // Forward to target endpoint
      const options = {
        hostname: targetHost,
        port: targetPort,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(targetBody),
          'Authorization': authHeader
        }
      };

      const proxyReq = http.request(options, (proxyRes) => {
        // NVIDIA always streams, so we need special handling
        const actuallyStreaming = isStream || targetBackend === 'nvidia';

        if (isStream) {
          // Client wants streaming - directly stream through
          handleStreamingResponse(proxyRes, res, anthropicBody.model);
        } else if (targetBackend === 'nvidia') {
          // NVIDIA always streams, but client wants non-streaming
          // Collect all SSE chunks and return unified response
          let fullContent = '';
          let lastChunk = null;

          proxyRes.on('data', chunk => {
            const lines = chunk.toString().split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.choices && data.choices[0]) {
                    const delta = data.choices[0].delta;
                    if (delta && delta.content) {
                      fullContent += delta.content;
                    }
                    if (delta && delta.reasoning_content) {
                      fullContent += delta.reasoning_content;
                    }
                    lastChunk = data;
                  }
                } catch (e) {
                  // Skip malformed chunks
                }
              }
            }
          });

          proxyRes.on('end', () => {
            // Build Anthropic-style response from collected content
            const anthropicResponse = {
              id: lastChunk?.id || `msg_${Date.now()}`,
              type: 'message',
              role: 'assistant',
              content: [{
                type: 'text',
                text: fullContent
              }],
              model: anthropicBody.model,
              stop_reason: 'end_turn',
              usage: {
                input_tokens: lastChunk?.usage?.prompt_tokens || 0,
                output_tokens: lastChunk?.usage?.completion_tokens || 0
              }
            };

            log(`NVIDIA Response: collected ${fullContent.length} chars`);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(anthropicResponse));
          });
        } else {
          let responseBody = '';
          proxyRes.on('data', chunk => { responseBody += chunk.toString(); });
          proxyRes.on('end', () => {
            try {
              const openaiResponse = JSON.parse(responseBody);
              const anthropicResponse = convertToAnthropic(openaiResponse);

              log(`Response: status=200 stop_reason=${anthropicResponse.stop_reason}`);

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(anthropicResponse));
            } catch (e) {
              log(`Parse error: ${e.message}`);
              res.writeHead(proxyRes.statusCode, proxyRes.headers);
              res.end(responseBody);
            }
          });
        }
      });

      proxyReq.on('error', (err) => {
        log(`Proxy error: ${err.message}`);
        res.writeHead(502);
        res.end(JSON.stringify({ error: { type: 'api_error', message: err.message } }));
      });

      proxyReq.write(targetBody);
      proxyReq.end();

    } catch (e) {
      log(`Request error: ${e.message}`);
      res.writeHead(400);
      res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: e.message } }));
    }
  });
}

const server = http.createServer(handleRequest);

server.listen(PORT, '0.0.0.0', () => {
  log(`Anthropic Proxy listening on http://0.0.0.0:${PORT}`);
  log(`Forwarding to OpenAI endpoint at ${OPENAI_HOST}:${OPENAI_PORT}`);
});

process.on('SIGTERM', () => {
  log('Shutting down...');
  server.close(() => process.exit(0));
});
