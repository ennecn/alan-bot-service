import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { extractUserMessage } from '../middleware/extract-message.js';
import type { AlanEngine } from '../engine.js';

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>;
  system?: string | Array<{ type: string; text?: string }>;
  stream?: boolean;
  temperature?: number;
  metadata?: Record<string, unknown>;
}

const MSG_ID_PREFIX = 'msg_alan_';

function generateId(): string {
  return MSG_ID_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function anthropicRoutes(engine: AlanEngine) {
  const app = new Hono();

  app.post('/v1/messages', async (c) => {
    const body = await c.req.json<AnthropicRequest>();
    const { messages, stream, model } = body;

    // Extract user message from pi-ai assembled prompt
    const extraction = extractUserMessage(messages);
    const userText = extraction.text || '';

    // Create CoordinatorEvent and run pipeline
    const result = await engine.run({
      trigger: 'user_message',
      content: userText,
      timestamp: new Date().toISOString(),
      metadata: extraction.fallback ? { extraction_fallback: true } : undefined,
    });

    // Determine reply text based on decision
    let replyText: string;
    if (result.decision === 'reply' && result.reply) {
      replyText = result.reply;
    } else if (result.decision === 'hesitate') {
      replyText = '...';
    } else {
      // suppress — return minimal acknowledgment
      replyText = '';
    }

    const msgId = generateId();
    const modelName = model || engine.config.system2_model;
    const inputTokens = result.metrics.token_usage.s2_in ?? 0;
    const outputTokens = result.metrics.token_usage.s2_out ?? 0;

    if (stream) {
      return streamSSE(c, async (sseStream) => {
        // message_start
        await sseStream.writeSSE({
          event: 'message_start',
          data: JSON.stringify({
            type: 'message_start',
            message: {
              id: msgId,
              type: 'message',
              role: 'assistant',
              content: [],
              model: modelName,
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: inputTokens, output_tokens: 0 },
            },
          }),
        });

        // content_block_start
        await sseStream.writeSSE({
          event: 'content_block_start',
          data: JSON.stringify({
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          }),
        });

        // Stream real S2 chunks if available, otherwise fall back to synthetic chunking
        if (result.stream) {
          for await (const chunk of result.stream) {
            if (chunk.type === 'text_delta' && chunk.text) {
              await sseStream.writeSSE({
                event: 'content_block_delta',
                data: JSON.stringify({
                  type: 'content_block_delta',
                  index: 0,
                  delta: { type: 'text_delta', text: chunk.text },
                }),
              });
            }
            // stop chunk is handled below in the standard envelope
          }
        } else if (replyText) {
          // Fallback: single delta for non-streamed replies (hesitate/suppress)
          await sseStream.writeSSE({
            event: 'content_block_delta',
            data: JSON.stringify({
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: replyText },
            }),
          });
        }

        // content_block_stop
        await sseStream.writeSSE({
          event: 'content_block_stop',
          data: JSON.stringify({ type: 'content_block_stop', index: 0 }),
        });

        // message_delta with usage
        await sseStream.writeSSE({
          event: 'message_delta',
          data: JSON.stringify({
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: outputTokens },
          }),
        });

        // message_stop
        await sseStream.writeSSE({
          event: 'message_stop',
          data: JSON.stringify({ type: 'message_stop' }),
        });
      });
    }

    return c.json({
      id: msgId,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: replyText }],
      model: modelName,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    });
  });

  return app;
}
