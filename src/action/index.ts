/**
 * Action module — re-exports dispatcher, adapters, and retry queue.
 */

export { ActionDispatcher } from './dispatcher.js';
export type { DispatchResult } from './dispatcher.js';
export { RetryQueue } from './retry-queue.js';
export type { RetryItem } from './retry-queue.js';
export type { ActionAdapter, ActionResult } from './adapters/base.js';
export { DeliveryAdapter } from './adapters/delivery.js';
export type { DeliveryPayload } from './adapters/delivery.js';
export { MemoryAdapter } from './adapters/memory.js';
export { EventBusAdapter } from './adapters/event-bus.js';
