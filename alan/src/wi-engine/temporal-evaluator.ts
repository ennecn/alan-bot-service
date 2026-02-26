/**
 * Temporal Evaluator — Scores WI entries based on time-of-day and day-of-week.
 * PRD v6.0 §3.5
 *
 * Checks each entry's temporal_conditions (after, before, day_of_week).
 * Score = 1.0 if ALL conditions met, 0.0 if ANY fail.
 * Handles midnight crossing (e.g. after=22:00, before=06:00 means overnight).
 */

interface TemporalConditions {
  after?: string;   // HH:MM
  before?: string;  // HH:MM
  day_of_week?: number[]; // 0=Sun..6=Sat
}

interface TemporalEntry {
  id: string;
  temporal_conditions?: TemporalConditions;
}

/** Parse "HH:MM" to minutes since midnight. Returns -1 on invalid input. */
function parseTime(hhmm: string): number {
  const parts = hhmm.split(':');
  if (parts.length !== 2) return -1;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return -1;
  return h * 60 + m;
}

/**
 * Check if current time (in minutes since midnight) is within the after/before range.
 * Handles midnight crossing: after=22:00 before=06:00 means 22:00-23:59 OR 00:00-06:00.
 */
function isInTimeRange(nowMinutes: number, after?: string, before?: string): boolean {
  if (after === undefined && before === undefined) return true;

  const afterMin = after !== undefined ? parseTime(after) : -1;
  const beforeMin = before !== undefined ? parseTime(before) : -1;

  if (after !== undefined && afterMin === -1) return false;
  if (before !== undefined && beforeMin === -1) return false;

  // Only "after" specified: now >= after
  if (after !== undefined && before === undefined) {
    return nowMinutes >= afterMin;
  }

  // Only "before" specified: now <= before
  if (after === undefined && before !== undefined) {
    return nowMinutes <= beforeMin;
  }

  // Both specified
  if (afterMin <= beforeMin) {
    // Normal range (e.g. after=09:00, before=17:00)
    return nowMinutes >= afterMin && nowMinutes <= beforeMin;
  } else {
    // Midnight crossing (e.g. after=22:00, before=06:00)
    return nowMinutes >= afterMin || nowMinutes <= beforeMin;
  }
}

/**
 * Evaluate entries against current time.
 * Returns a Map of entry ID → score (1.0 or 0.0).
 * Entries without temporal_conditions get score 0.
 */
export function evaluateTemporal(
  entries: TemporalEntry[],
  now?: Date,
): Map<string, number> {
  const result = new Map<string, number>();
  const currentTime = now ?? new Date();
  const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  const currentDay = currentTime.getDay(); // 0=Sun..6=Sat

  for (const entry of entries) {
    if (!entry.temporal_conditions) {
      result.set(entry.id, 0);
      continue;
    }

    const tc = entry.temporal_conditions;

    // Check day_of_week
    if (tc.day_of_week !== undefined && tc.day_of_week.length > 0) {
      if (!tc.day_of_week.includes(currentDay)) {
        result.set(entry.id, 0);
        continue;
      }
    }

    // Check time range
    if (!isInTimeRange(currentMinutes, tc.after, tc.before)) {
      result.set(entry.id, 0);
      continue;
    }

    result.set(entry.id, 1.0);
  }

  return result;
}
