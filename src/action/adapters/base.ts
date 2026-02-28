/**
 * Base adapter interface for action dispatch.
 */

import type { Action } from '../../types/actions.js';

export interface ActionResult {
  success: boolean;
  error?: string;
  /** Adapter-specific payload (e.g. response content for delivery) */
  payload?: unknown;
}

export interface ActionAdapter {
  canHandle(action: Action): boolean;
  execute(action: Action): Promise<ActionResult>;
}
