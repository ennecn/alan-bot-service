/**
 * EventBusAdapter — routes social actions to Event Bus service via HTTP.
 */

import type { Action } from '../../types/actions.js';
import type { ActionAdapter, ActionResult } from './base.js';

export class EventBusAdapter implements ActionAdapter {
  constructor(
    private eventBusUrl: string,
    private agentId: string,
  ) {}

  canHandle(action: Action): boolean {
    return (
      action.type === 'notify_agent' ||
      action.type === 'post_moment' ||
      action.type === 'like' ||
      action.type === 'comment'
    );
  }

  async execute(action: Action): Promise<ActionResult> {
    if (!this.eventBusUrl) {
      // No event bus configured — log and succeed (graceful degradation)
      console.log(`[EventBus] No URL configured, skipping ${action.type}`);
      return { success: true };
    }

    try {
      switch (action.type) {
        case 'post_moment':
          await this.postEvent('social_post', null, {
            content: action.content,
            mood: action.mood,
          });
          break;
        case 'notify_agent':
          await this.postEvent('fact_update', action.target, {
            fact: action.fact,
          });
          break;
        case 'like':
          await this.postEvent('reaction', action.target, { type: 'like' });
          break;
        case 'comment':
          await this.postEvent('reaction', action.target, {
            type: 'comment',
            content: action.content,
          });
          break;
        default:
          return { success: false, error: `Unhandled action type` };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  private async postEvent(
    type: string,
    targetAgent: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const url = `${this.eventBusUrl.replace(/\/$/, '')}/events/publish`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_agent: this.agentId,
        target_agent: targetAgent,
        type,
        payload,
      }),
    });
    if (!response.ok) {
      throw new Error(`Event Bus returned ${response.status}`);
    }
  }
}
