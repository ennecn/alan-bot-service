/**
 * Memory Write Queue — serializes all MEMORY.md writes.
 */

export class MemoryQueue {
  private queue: Array<{ fn: () => Promise<void>; resolve: () => void; reject: (e: unknown) => void }> = [];
  private running = false;

  async enqueue(fn: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        await item.fn();
        item.resolve();
      } catch (err) {
        item.reject(err);
      }
    }

    this.running = false;
  }
}
