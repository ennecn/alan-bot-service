import type { MemoryStore } from './store.js';
import type { AuditLog } from '../../security/audit.js';
import type { MetroidConfig } from '../../config.js';

/**
 * Forgetting mechanism: periodically decay importance scores
 * and fade memories that drop below threshold.
 * Manages per-agent timers so multiple agents each get their own decay cycle.
 */
export class MemoryForgetter {
  private timers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    private store: MemoryStore,
    private audit: AuditLog,
    private config: MetroidConfig,
  ) {}

  /** Start periodic forgetting cycle for a specific agent (every hour) */
  start(agentId: string): void {
    if (this.timers.has(agentId)) return;
    const timer = setInterval(() => {
      this.decayCycle(agentId).catch(err =>
        console.error(`[Forgetter] decay cycle failed for ${agentId}:`, err)
      );
    }, 60 * 60 * 1000); // every hour
    this.timers.set(agentId, timer);
  }

  /** Stop forgetting cycle. If agentId given, stop only that agent; otherwise stop all. */
  stop(agentId?: string): void {
    if (agentId) {
      const timer = this.timers.get(agentId);
      if (timer) {
        clearInterval(timer);
        this.timers.delete(agentId);
      }
    } else {
      for (const timer of this.timers.values()) {
        clearInterval(timer);
      }
      this.timers.clear();
    }
  }

  /** Run one decay cycle: reduce importance of old, unrecalled memories */
  async decayCycle(agentId: string): Promise<number> {
    const threshold = this.config.memory.fadeThreshold;
    const candidates = this.store.getFadedCandidates(agentId, threshold + 0.2, 50);
    let fadedCount = 0;

    for (const memory of candidates) {
      const ageHours = (Date.now() - memory.createdAt.getTime()) / (1000 * 60 * 60);
      const decayRate = memory.recallCount > 0 ? 0.005 : 0.01; // recalled = slower decay
      const newImportance = memory.importance - (decayRate * Math.sqrt(ageHours));

      if (newImportance < threshold) {
        this.store.fade(memory.id);
        fadedCount++;
        await this.audit.log({
          timestamp: new Date(),
          actor: 'system',
          action: 'memory.fade',
          target: memory.id,
          details: {
            oldImportance: memory.importance,
            newImportance,
            ageHours: Math.round(ageHours),
          },
        });
      } else {
        this.store.updateImportance(memory.id, newImportance);
      }
    }

    return fadedCount;
  }
}
