import fetch from 'node-fetch';
import { SocksProxyAgent } from 'socks-proxy-agent';
import {
  getEnabledProviders,
  updateProvider,
  resetProviderHealth,
  getSetting
} from './db.js';
import { notifyProviderRecovered } from './telegram.js';

let healthCheckInterval = null;

function getProxyAgent() {
  const proxyUrl = getSetting('proxy_url');
  if (proxyUrl) {
    return new SocksProxyAgent(proxyUrl);
  }
  return null;
}

async function checkProviderHealth(provider) {
  const keys = JSON.parse(provider.api_keys || '[]');
  if (keys.length === 0) {
    return { healthy: false, reason: 'no_api_key' };
  }

  const apiKey = keys[provider.current_key_index || 0];

  try {
    let agent = null;
    if (provider.route_type === 'overseas') {
      agent = getProxyAgent();
    }

    // Simple health check - just verify the endpoint responds
    const url = `${provider.base_url}/v1/messages`;

    const fetchOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }]
      }),
      timeout: 10000
    };

    if (agent) {
      fetchOptions.agent = agent;
    }

    // We don't actually need to send a real request for health check
    // Just verify the endpoint is reachable with a minimal request
    // Most providers will return 400 for invalid request which is fine
    const response = await fetch(url, fetchOptions);

    // 400, 401, 403 mean the endpoint is reachable but request is invalid/unauthorized
    // 429 means rate limited (quota exhausted)
    // 5xx means server error
    if (response.status >= 500) {
      return { healthy: false, reason: 'server_error', status: response.status };
    }

    if (response.status === 429) {
      return { healthy: false, reason: 'rate_limited', status: response.status };
    }

    // 2xx, 400, 401, 403 all indicate the service is reachable
    return { healthy: true, status: response.status };

  } catch (error) {
    return { healthy: false, reason: 'connection_error', error: error.message };
  }
}

export async function runHealthChecks() {
  const providers = getEnabledProviders();
  const results = [];

  for (const provider of providers) {
    const wasUnhealthy = provider.health_status === 'unhealthy' || provider.exhausted_until;
    const result = await checkProviderHealth(provider);

    const now = Math.floor(Date.now() / 1000);

    if (result.healthy) {
      // Check if recovery time has passed for exhausted providers
      if (provider.exhausted_until && now >= provider.exhausted_until) {
        resetProviderHealth(provider.id);
        if (wasUnhealthy) {
          await notifyProviderRecovered(provider.name);
        }
      } else if (provider.health_status !== 'healthy' && !provider.exhausted_until) {
        resetProviderHealth(provider.id);
        if (wasUnhealthy) {
          await notifyProviderRecovered(provider.name);
        }
      }
    }

    updateProvider(provider.id, { last_check_at: now });

    results.push({
      provider: provider.name,
      ...result
    });
  }

  return results;
}

export function startHealthChecker(intervalMs = 60000) {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }

  console.log(`[HealthCheck] Starting health checker (interval: ${intervalMs}ms)`);

  // Run immediately
  runHealthChecks().catch(err => console.error('[HealthCheck] Error:', err));

  // Then run periodically
  healthCheckInterval = setInterval(() => {
    runHealthChecks().catch(err => console.error('[HealthCheck] Error:', err));
  }, intervalMs);
}

export function stopHealthChecker() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
    console.log('[HealthCheck] Stopped');
  }
}
