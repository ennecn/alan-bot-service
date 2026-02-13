// Fallback Chain Manager for Model Quota Exhaustion
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FALLBACK_STATE_FILE = path.join(__dirname, 'data', 'fallback-state.json');

// Global Fallback Chain Configuration
// Tier 0 (highest priority) -> Tier 5 (last resort)
const FALLBACK_CHAINS = {
  // For opus-4-6 and opus-4-5 requests
  'claude-opus': [
    { tier: 0, provider: 'v3.codesome.cn', model: 'claude-opus-4-6-thinking' },
    { tier: 1, provider: 'NVIDIA', model: 'moonshotai/kimi-k2.5' },
    { tier: 2, provider: 'Kimi', model: 'kimi-k2.5' },
    { tier: 3, provider: 'Antigravity', model: 'claude-opus-4-5-thinking' },
    { tier: 4, provider: 'Antigravity', model: 'claude-sonnet-4-5-thinking' },
    { tier: 5, provider: 'T8', model: 'claude-opus-4-6-thinking' }
  ],
  // For sonnet requests
  'claude-sonnet': [
    { tier: 0, provider: 'v3.codesome.cn', model: 'claude-sonnet-4-5-thinking' },
    { tier: 1, provider: 'NVIDIA', model: 'moonshotai/kimi-k2.5' },
    { tier: 2, provider: 'Kimi', model: 'kimi-k2.5' },
    { tier: 3, provider: 'Antigravity', model: 'claude-sonnet-4-5-thinking' },
    { tier: 4, provider: 'Antigravity', model: 'claude-opus-4-5-thinking' },
    { tier: 5, provider: 'T8', model: 'claude-opus-4-6-thinking' }
  ]
};

// Track tier exhaustion status
// Format: { 'v3.codesome.cn:claude-opus-4-6-thinking': { exhaustedAt, errorCount, lastError } }
let tierStates = {};

// Load persisted state
function loadState() {
  try {
    if (fs.existsSync(FALLBACK_STATE_FILE)) {
      const data = fs.readFileSync(FALLBACK_STATE_FILE, 'utf8');
      tierStates = JSON.parse(data);
      console.log('[Fallback] Loaded state:', Object.keys(tierStates).length, 'tracked tiers');
    }
  } catch (err) {
    console.error('[Fallback] Failed to load state:', err.message);
  }
}

// Save state to disk
function saveState() {
  try {
    const dir = path.dirname(FALLBACK_STATE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(FALLBACK_STATE_FILE, JSON.stringify(tierStates, null, 2));
  } catch (err) {
    console.error('[Fallback] Failed to save state:', err.message);
  }
}

// Get tier key
function getTierKey(provider, model) {
  return `${provider}:${model}`;
}

// Determine which fallback chain to use
function getChainType(requestedModel) {
  if (requestedModel.includes('opus')) {
    return 'claude-opus';
  } else if (requestedModel.includes('sonnet')) {
    return 'claude-sonnet';
  }
  // Default to opus chain for unknown models
  return 'claude-opus';
}

// Get next available tier in the fallback chain
export function getActiveTier(requestedModel) {
  const chainType = getChainType(requestedModel);
  const chain = FALLBACK_CHAINS[chainType];

  if (!chain) {
    return null;
  }

  const now = Date.now();

  // Find first non-exhausted tier
  for (const tier of chain) {
    const key = getTierKey(tier.provider, tier.model);
    const state = tierStates[key];

    if (!state || !state.exhaustedAt) {
      return tier; // This tier is available
    }

    // Check if exhausted tier should be reset (24 hours passed)
    const hoursSinceExhaustion = (now - state.exhaustedAt) / (1000 * 60 * 60);
    if (hoursSinceExhaustion >= 24) {
      console.log(`[Fallback] Auto-recovering tier: ${key} (24h passed)`);
      delete tierStates[key];
      saveState();
      return tier;
    }
  }

  // All tiers exhausted!
  return null;
}

// Record a 429 error for a tier
export function recordQuotaError(provider, model, errorMessage) {
  const key = getTierKey(provider, model);

  if (!tierStates[key]) {
    tierStates[key] = {
      errorCount: 0,
      errors: []
    };
  }

  const state = tierStates[key];
  state.errorCount++;
  state.errors.push({
    timestamp: Date.now(),
    message: errorMessage
  });

  // Keep only last 10 errors
  if (state.errors.length > 10) {
    state.errors = state.errors.slice(-10);
  }

  console.log(`[Fallback] Quota error for ${key}: count=${state.errorCount}`);

  // Mark as exhausted after 3 consecutive errors
  if (state.errorCount >= 3 && !state.exhaustedAt) {
    state.exhaustedAt = Date.now();
    console.log(`[Fallback] TIER EXHAUSTED: ${key} (${state.errorCount} errors)`);
    saveState();
    return true; // Tier just became exhausted
  }

  saveState();
  return false;
}

// Reset a specific tier (manual recovery)
export function resetTier(provider, model) {
  const key = getTierKey(provider, model);
  if (tierStates[key]) {
    console.log(`[Fallback] Manually resetting tier: ${key}`);
    delete tierStates[key];
    saveState();
    return true;
  }
  return false;
}

// Reset all tiers
export function resetAllTiers() {
  console.log(`[Fallback] Resetting all tiers (${Object.keys(tierStates).length} tracked)`);
  tierStates = {};
  saveState();
}

// Reset tiers for a specific provider
export function resetProviderTiers(providerName) {
  let resetCount = 0;
  for (const key of Object.keys(tierStates)) {
    if (key.startsWith(providerName + ':')) {
      delete tierStates[key];
      resetCount++;
    }
  }
  if (resetCount > 0) {
    console.log(`[Fallback] Reset ${resetCount} tier(s) for provider: ${providerName}`);
    saveState();
  }
  return resetCount;
}

// Get full status
export function getFallbackStatus() {
  const now = Date.now();
  const status = {};

  for (const [chainType, chain] of Object.entries(FALLBACK_CHAINS)) {
    status[chainType] = chain.map(tier => {
      const key = getTierKey(tier.provider, tier.model);
      const state = tierStates[key] || {};

      let exhaustedStatus = 'available';
      let recoveryTime = null;

      if (state.exhaustedAt) {
        const hoursSince = (now - state.exhaustedAt) / (1000 * 60 * 60);
        if (hoursSince < 24) {
          exhaustedStatus = 'exhausted';
          recoveryTime = new Date(state.exhaustedAt + 24 * 60 * 60 * 1000).toISOString();
        }
      }

      return {
        tier: tier.tier,
        provider: tier.provider,
        model: tier.model,
        status: exhaustedStatus,
        errorCount: state.errorCount || 0,
        recoveryTime: recoveryTime,
        lastError: state.errors?.[state.errors.length - 1]
      };
    });
  }

  return status;
}

// Schedule codesome reset at Beijing midnight (UTC 16:00)
function scheduleCodesomeReset() {
  const now = new Date();
  // Next UTC 16:00 (= Beijing 00:00)
  const next = new Date(now);
  next.setUTCHours(16, 0, 0, 0);
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  const msUntil = next - now;

  setTimeout(() => {
    console.log('[Fallback] Codesome daily reset triggered (Beijing midnight)');
    resetProviderTiers('v3.codesome.cn');
    // Schedule next day
    scheduleCodesomeReset();
  }, msUntil);

  console.log(`[Fallback] Codesome reset scheduled for ${next.toISOString()} (Beijing 00:00)`);
}

// Initialize
loadState();
scheduleCodesomeReset();

console.log('[Fallback] Manager initialized');
console.log('[Fallback] Chains configured:', Object.keys(FALLBACK_CHAINS).join(', '));
