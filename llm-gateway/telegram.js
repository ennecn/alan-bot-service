import fetch from 'node-fetch';
import { getSetting } from './db.js';

const lastNotifications = new Map(); // key -> timestamp

export async function sendTelegramMessage(message, forceBypassCooldown = false) {
  const botToken = getSetting('telegram_bot_token');
  const chatId = getSetting('telegram_chat_id');

  if (!botToken || !chatId) {
    console.log('[Telegram] Not configured, skipping notification');
    return false;
  }

  // Check cooldown
  if (!forceBypassCooldown) {
    const cooldownMinutes = parseInt(getSetting('notification_cooldown_minutes') || '5', 10);
    const messageKey = message.substring(0, 100); // Use first 100 chars as key
    const lastTime = lastNotifications.get(messageKey);

    if (lastTime && (Date.now() - lastTime) < cooldownMinutes * 60 * 1000) {
      console.log('[Telegram] Notification skipped (cooldown)');
      return false;
    }
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
      })
    });

    if (response.ok) {
      lastNotifications.set(message.substring(0, 100), Date.now());
      console.log('[Telegram] Notification sent');
      return true;
    } else {
      const error = await response.text();
      console.error('[Telegram] Failed to send:', error);
      return false;
    }
  } catch (error) {
    console.error('[Telegram] Error:', error.message);
    return false;
  }
}

export async function notifyStartup(activeProvider, model) {
  const message = `<b>LLM Gateway Started</b>

Active provider: <code>${activeProvider}</code>
Model: <code>${model || 'auto'}</code>
Time: ${new Date().toISOString()}`;

  return sendTelegramMessage(message, true);
}

export async function notifyProviderSwitch(fromProvider, toProvider, reason) {
  const message = `<b>Provider Switch</b>

From: <code>${fromProvider}</code>
To: <code>${toProvider}</code>
Reason: ${reason}
Time: ${new Date().toISOString()}`;

  return sendTelegramMessage(message);
}

export async function notifyProviderExhausted(provider, recoveryMinutes) {
  const message = `<b>Provider Exhausted</b>

Provider: <code>${provider}</code>
Recovery in: ${recoveryMinutes} minutes
Time: ${new Date().toISOString()}`;

  return sendTelegramMessage(message);
}

export async function notifyProviderRecovered(provider) {
  const message = `<b>Provider Recovered</b>

Provider: <code>${provider}</code>
Status: Available
Time: ${new Date().toISOString()}`;

  return sendTelegramMessage(message);
}

export async function notifyAllProvidersDown() {
  const message = `<b>CRITICAL: All Providers Down</b>

All configured providers are unavailable!
Manual intervention required.
Time: ${new Date().toISOString()}`;

  return sendTelegramMessage(message, true);
}

export async function notifyError(provider, errorType, errorMessage) {
  const message = `<b>Provider Error</b>

Provider: <code>${provider}</code>
Error: ${errorType}
Details: ${errorMessage?.substring(0, 200) || 'N/A'}
Time: ${new Date().toISOString()}`;

  return sendTelegramMessage(message);
}

export async function notifyModelDowngrade(requestedModel, actualModel, provider, reason) {
  const message = `<b>Model Downgrade Alert</b>

Requested: <code>${requestedModel}</code>
Downgraded to: <code>${actualModel}</code>
Provider: <code>${provider}</code>
Reason: ${reason}
Time: ${new Date().toISOString()}`;

  return sendTelegramMessage(message, true); // Always send, bypass cooldown
}
