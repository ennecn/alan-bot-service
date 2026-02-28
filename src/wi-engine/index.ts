/**
 * WI Engine — Re-exports
 */

export { scanEntries } from './text-scanner.js';
export { scoreEntries, cosineSimilarity } from './semantic-scorer.js';
export { preFilter } from './pre-filter.js';
export { combineSignals } from './combiner.js';
export { activateEntries } from './activation.js';
export type { ActivatedEntry, ActivationContext } from './activation.js';
export type { SignalScores } from './combiner.js';
export { evaluateState } from './state-evaluator.js';
export { evaluateTemporal } from './temporal-evaluator.js';
