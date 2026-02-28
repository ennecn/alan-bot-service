/**
 * DeliveryAdapter — converts reply/hesitate/suppress to Anthropic-style responses.
 */

import type { Action } from '../../types/actions.js';
import type { ActionAdapter, ActionResult } from './base.js';

export interface DeliveryPayload {
  content: string;
  delayed: Array<{ content: string; delay: number }>;
  retraction?: { delay_ms: number };
}

export class DeliveryAdapter implements ActionAdapter {
  private delayed: Array<{ content: string; delay: number }> = [];

  canHandle(action: Action): boolean {
    return action.type === 'reply' || action.type === 'hesitate' || action.type === 'suppress';
  }

  static splitMultiMessage(content: string): string[] {
    const DELIMITER = '\n\n---\n\n';
    const parts = content.split(DELIMITER).map(s => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts : [content];
  }

  async execute(action: Action): Promise<ActionResult> {
    switch (action.type) {
      case 'reply': {
        const segments = DeliveryAdapter.splitMultiMessage(action.content);
        if (segments.length === 1) {
          const payload: DeliveryPayload = {
            content: segments[0],
            delayed: [...this.delayed],
          };
          this.delayed = [];
          return { success: true, payload };
        }
        // Multi-message: first segment immediate, rest delayed
        const delayed = segments.slice(1).map((seg, i) => ({
          content: seg,
          delay: (i + 1) * (1000 + Math.floor(Math.random() * 2000)),
        }));
        const payload: DeliveryPayload = {
          content: segments[0],
          delayed: [...delayed, ...this.delayed],
        };
        this.delayed = [];
        return { success: true, payload };
      }
      case 'hesitate': {
        const delay_ms = 2000 + Math.floor(Math.random() * 3000);
        return {
          success: true,
          payload: { content: '...', delayed: [], retraction: { delay_ms } } as DeliveryPayload,
        };
      }
      case 'suppress':
        return { success: true, payload: { content: 'HEARTBEAT_OK', delayed: [] } as DeliveryPayload };
      default:
        return { success: false, error: `DeliveryAdapter cannot handle ${(action as Action).type}` };
    }
  }

  /** Called by the transport layer after delay_ms to retract the hesitation message. */
  retractHesitation(messageId: string): { action: 'delete' | 'edit'; content: string } {
    return { action: 'edit', content: '' };
  }

  /** Queue a delayed reply (called by dispatcher for multi-message sequences). */
  queueDelayed(content: string, delay: number): void {
    this.delayed.push({ content, delay });
  }
}
