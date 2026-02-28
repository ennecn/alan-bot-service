/**
 * Per-agent mutex with 30s timeout.
 * Prevents concurrent Coordinator runs for the same agent.
 */

const DEFAULT_TIMEOUT_MS = 30_000;

export class Mutex {
  private locked = false;
  private waitQueue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

  async acquire(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Force-release on timeout
        const idx = this.waitQueue.findIndex((w) => w.resolve === resolve);
        if (idx !== -1) this.waitQueue.splice(idx, 1);
        console.warn('[mutex] Force-release: waiter timed out after', timeoutMs, 'ms');
        reject(new Error(`Mutex acquire timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.waitQueue.push({
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject,
      });
    });
  }

  release(): void {
    const next = this.waitQueue.shift();
    if (next) {
      next.resolve();
    } else {
      this.locked = false;
    }
  }

  isLocked(): boolean {
    return this.locked;
  }
}
