import type { MemoryStore } from './store.js';
import type { AuditLog } from '../../security/audit.js';
import type { MetroidConfig } from '../../config.js';

/**
 * Forgetting mechanism: periodically decay importance scores
 * and fade memories that drop below threshold.
 */
export class MemoryForgetter {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private store: MemoryStore,
    private audit: AuditLog,
    private config: MetroidConfig,
  ) {}

  /** Start periodic forgetting cycle (every hour) */
  start(agentId: string): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.decayCycle(agentId).catch(err =>
        console.error('[Forgetter] decay cycle failed:', err)
      );
    }, 60 * 60 * 1000); // every hour
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
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
