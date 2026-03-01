/**
 * Delivery Mode Resolver — maps emotion state to message delivery style.
 */
import type { EmotionState } from '../../types/index.js';
import type { DeliveryMode } from '../../types/actions.js';

export function resolveDeliveryMode(emotion: EmotionState): DeliveryMode {
  if (emotion.joy > 0.7) return 'burst';
  if (emotion.anxiety > 0.6 || emotion.trust < 0.3) return 'minimal';
  if (emotion.sadness > 0.6 || emotion.anger > 0.6) return 'single';
  return 'fragmented';
}
