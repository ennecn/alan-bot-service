/**
 * Behavior Decision Logic — PRD v6.0 §6.3.1
 */

import type { ImpulseResult, SuppressionFatigue } from '../types/index.js';
import type { TriggerType, BehaviorDecision } from '../types/actions.js';

/**
 * Decide behavior based on impulse, trigger type, and suppression state.
 *
 * heartbeat / cron / social_notification / fact_sync / system_event:
 *   impulse >= threshold → reply
 *   else → suppress
 *
 * user_message / direct_message:
 *   impulse < threshold * 0.6 → suppress
 *   threshold * 0.6 <= impulse < threshold:
 *     consecutive_hesitate < 2 → hesitate
 *     else → reply (forced after 2 hesitations)
 *   impulse >= threshold → reply
 */
export function decideBehavior(
  impulse: ImpulseResult,
  trigger: TriggerType,
  suppression: SuppressionFatigue,
): BehaviorDecision {
  const { value, fire_threshold } = impulse;

  // Non-interactive triggers: binary fire/suppress
  if (trigger === 'heartbeat' || trigger === 'cron' || trigger === 'social_notification' || trigger === 'fact_sync' || trigger === 'system_event') {
    return value >= fire_threshold ? 'reply' : 'suppress';
  }

  // Interactive triggers: user_message / direct_message
  const hesitateFloor = fire_threshold * 0.6;

  if (value >= fire_threshold) return 'reply';
  if (value < hesitateFloor) return 'suppress';

  // In the hesitation zone
  return suppression.consecutive_hesitate < 2 ? 'hesitate' : 'reply';
}
