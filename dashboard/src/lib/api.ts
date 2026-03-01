/**
 * Typed API client — all calls go through Next.js rewrites (no CORS issues).
 */

import type {
  ModelRegistry, ModelEntry,
  CardManifestEntry, CardDetail,
  PresetManifestEntry,
  ChatMessage, SessionInfo,
  DebugState,
} from './types';

const BASE = '';  // Same-origin via rewrites

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
}

// ── Models ──

export async function getModels(): Promise<ModelRegistry> {
  return json('/api/admin/models');
}

export async function addModel(data: {
  label: string; base_url: string; api_key?: string; model_id: string; role: 's1' | 's2';
}): Promise<{ status: string; model: ModelEntry }> {
  return json('/api/admin/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function setActiveModel(role: 's1' | 's2', id: string): Promise<void> {
  await json('/api/admin/models/active', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, id }),
  });
}

export async function deleteModel(id: string): Promise<void> {
  await json(`/api/admin/models/${id}`, { method: 'DELETE' });
}

// ── Cards ──

export async function getCards(): Promise<{ cards: CardManifestEntry[] }> {
  return json('/api/admin/cards');
}

export async function getCardDetail(id: string): Promise<CardDetail> {
  return json(`/api/admin/cards/${id}`);
}

export async function uploadCard(file: File): Promise<unknown> {
  const fd = new FormData();
  fd.append('card', file);
  return json('/api/admin/cards/upload', { method: 'POST', body: fd });
}

export async function activateCard(id: string): Promise<void> {
  await json(`/api/admin/cards/${id}/activate`, { method: 'POST' });
}

// ── Presets ──

export async function getPresets(): Promise<{ presets: PresetManifestEntry[] }> {
  return json('/api/admin/presets');
}

export async function uploadPreset(file: File): Promise<unknown> {
  const fd = new FormData();
  fd.append('preset', file);
  return json('/api/admin/presets/upload', { method: 'POST', body: fd });
}

export async function activatePreset(id: string): Promise<void> {
  await json(`/api/admin/presets/${id}/activate`, { method: 'POST' });
}

// ── Chat ──

export async function getChatHistory(sessionId?: string, limit = 50): Promise<{ messages: ChatMessage[] }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (sessionId) params.set('session_id', sessionId);
  return json(`/api/chat/history?${params}`);
}

export async function getChatSessions(limit = 20): Promise<{ sessions: SessionInfo[] }> {
  return json(`/api/chat/sessions?limit=${limit}`);
}

// ── Debug ──

export async function getDebugState(): Promise<DebugState> {
  return json('/api/debug/state');
}

// ── Streaming Chat (Anthropic format) ──

export async function* streamChat(
  message: string,
  model = 'claude-opus-4-6',
): AsyncGenerator<string> {
  const res = await fetch('/api/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      stream: true,
      messages: [{ role: 'user', content: message }],
    }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Chat failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;

      try {
        const event = JSON.parse(data);
        if (event.type === 'content_block_delta' && event.delta?.text) {
          yield event.delta.text;
        }
      } catch {
        // Skip malformed events
      }
    }
  }
}
