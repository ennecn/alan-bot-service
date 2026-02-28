/**
 * Activation Manager — Apply threshold, sticky/cooldown/delay/group logic.
 * PRD v6.0 §4.5
 */

import type { WIEntry } from '../types/actions.js';

export interface ActivatedEntry extends WIEntry {
  score: number;
  position: number;
  depth: number;
}

export interface ActivationContext {
  /** How many turns each entry has been active: entry_id → turns remaining */
  stickyCounters?: Map<string, number>;
  /** Cooldown remaining per entry: entry_id → turns to skip */
  cooldownCounters?: Map<string, number>;
  /** Turn count since conversation start (for delay) */
  turnCount?: number;
}

/**
 * Activate entries that pass the threshold, applying sticky/cooldown/delay/group rules.
 * Returns activated entries sorted by order (ascending), then weight (descending).
 */
export function activateEntries(
  candidates: WIEntry[],
  combinedScores: Map<string, number>,
  threshold: number,
  context: ActivationContext = {},
): ActivatedEntry[] {
  const { stickyCounters, cooldownCounters, turnCount = 0 } = context;
  const activated: ActivatedEntry[] = [];
  const seenGroups = new Set<string>();

  // Sort candidates by order (asc) then weight (desc) for deterministic group exclusion
  const sorted = [...candidates].sort((a, b) => {
    const orderDiff = (a.order ?? 0) - (b.order ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return (b.weight ?? 0) - (a.weight ?? 0);
  });

  for (const entry of sorted) {
    const score = combinedScores.get(entry.id) ?? 0;

    // Cooldown: skip if still cooling down
    const cd = cooldownCounters?.get(entry.id);
    if (cd !== undefined && cd > 0) continue;

    // Delay: skip if turn count hasn't reached delay
    if (entry.delay !== undefined && turnCount < entry.delay) continue;

    // Sticky: if entry was sticky-activated before, keep it regardless of score
    const stickyRemaining = stickyCounters?.get(entry.id);
    const isStickyActive = stickyRemaining !== undefined && stickyRemaining > 0;

    if (!isStickyActive && score < threshold) continue;

    // Group mutual exclusion: first entry in group wins
    if (entry.group) {
      if (seenGroups.has(entry.group)) continue;
      seenGroups.add(entry.group);
    }

    activated.push({
      ...entry,
      score,
      position: entry.position ?? 0,
      depth: entry.depth ?? 0,
    });
  }

  return activated;
}
