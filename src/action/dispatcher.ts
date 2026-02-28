/**
 * Action Dispatcher — executes actions through pluggable adapters.
 * reply actions MUST succeed; other actions are best-effort with retry.
 */

import type { Action } from '../types/actions.js';
import type { ActionAdapter, ActionResult } from './adapters/base.js';
import { RetryQueue } from './retry-queue.js';

export interface DispatchResult {
  success: boolean;
  results: ActionResult[];
  retried: string[];
}

export class ActionDispatcher {
  private adapters: ActionAdapter[] = [];
  private retryQueue: RetryQueue;

  constructor(workspacePath: string) {
    this.retryQueue = new RetryQueue(workspacePath);
  }

  registerAdapter(adapter: ActionAdapter): void {
    this.adapters.push(adapter);
  }

  async dispatch(actions: Action[]): Promise<DispatchResult> {
    const results: ActionResult[] = [];
    const retried: string[] = [];
    let success = true;

    for (const action of actions) {
      const adapter = this.adapters.find((a) => a.canHandle(action));
      if (!adapter) {
        const result: ActionResult = { success: false, error: `No adapter for ${action.type}` };
        results.push(result);
        if (action.type === 'reply') success = false;
        continue;
      }

      try {
        const result = await adapter.execute(action);
        results.push(result);

        if (!result.success) {
          if (action.type === 'reply') {
            // reply MUST succeed — mark overall as degraded
            success = false;
          } else {
            // Best-effort: queue for retry
            this.retryQueue.add(action, result.error ?? 'unknown');
            retried.push(action.type);
          }
        }
      } catch (err) {
        const error = String(err);
        const result: ActionResult = { success: false, error };
        results.push(result);

        if (action.type === 'reply') {
          success = false;
        } else {
          this.retryQueue.add(action, error);
          retried.push(action.type);
        }
      }
    }

    return { success, results, retried };
  }

  getRetryQueue(): RetryQueue {
    return this.retryQueue;
  }
}
