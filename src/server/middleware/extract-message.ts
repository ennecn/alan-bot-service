/**
 * Extract the user's actual message from pi-ai assembled prompt.
 *
 * Strategy (3-tier):
 * 1. Take the last message with role "user"
 * 2. If that content is >2000 chars or contains pi-ai template markers,
 *    search backwards for a shorter, cleaner user message
 * 3. Fallback: return the raw content trimmed
 */

const PI_AI_MARKERS = [
  '[System note:',
  '### Input:',
  '<|system|>',
  '{{char}}',
  '{{user}}',
  '[Start a new',
  '### Instruction:',
];

const MAX_CLEAN_LENGTH = 2000;

export interface ExtractionResult {
  text: string;
  fallback: boolean;
}

interface Message {
  role: string;
  content: string | Array<{ type: string; text?: string }>;
}

function getTextContent(content: Message['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('\n');
  }
  return String(content);
}

function hasPiAiMarkers(text: string): boolean {
  return PI_AI_MARKERS.some((marker) => text.includes(marker));
}

export function extractUserMessage(messages: Message[]): ExtractionResult {
  // Find all user messages
  const userMessages = messages.filter((m) => m.role === 'user');
  if (userMessages.length === 0) {
    return { text: '', fallback: true };
  }

  // Tier 1: last user message
  const last = getTextContent(userMessages[userMessages.length - 1].content);

  if (last.length <= MAX_CLEAN_LENGTH && !hasPiAiMarkers(last)) {
    return { text: last.trim(), fallback: false };
  }

  // Tier 2: search backwards for a clean, short user message
  for (let i = userMessages.length - 2; i >= 0; i--) {
    const text = getTextContent(userMessages[i].content);
    if (text.length <= MAX_CLEAN_LENGTH && !hasPiAiMarkers(text)) {
      return { text: text.trim(), fallback: false };
    }
  }

  // Tier 3: fallback — trim the last user message
  const trimmed = last.slice(0, MAX_CLEAN_LENGTH).trim();
  return { text: trimmed, fallback: true };
}
