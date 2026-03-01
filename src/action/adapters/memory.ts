/**
 * MemoryAdapter — handles update_memory actions.
 * Appends to MEMORY.md with timestamp header.
 * Writes are serialized through the shared MemoryQueue (PRD §8.3).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Action } from '../../types/actions.js';
import type { ActionAdapter, ActionResult } from './base.js';
import type { MemoryQueue } from '../../coordinator/memory-queue.js';

export class MemoryAdapter implements ActionAdapter {
  constructor(
    private workspacePath: string,
    private memoryQueue?: MemoryQueue,
  ) {}

  canHandle(action: Action): boolean {
    return action.type === 'update_memory';
  }

  async execute(action: Action): Promise<ActionResult> {
    if (action.type !== 'update_memory') {
      return { success: false, error: 'Not an update_memory action' };
    }

    try {
      const writeOp = async () => {
        const memPath = path.join(this.workspacePath, 'MEMORY.md');
        const timestamp = new Date().toISOString();
        const entry = `\n## ${timestamp}\n\n${action.content}\n`;

        if (fs.existsSync(memPath)) {
          fs.appendFileSync(memPath, entry, 'utf-8');
        } else {
          fs.writeFileSync(memPath, `# Memory\n${entry}`, 'utf-8');
        }

        // Size management: trim to 150 entries if over 200 lines
        const content = fs.readFileSync(memPath, 'utf-8');
        const lines = content.split('\n');
        if (lines.length > 200) {
          const sections = content.split('\n## ');
          const header = sections[0]; // "# Memory\n..."
          const entries = sections.slice(1);
          const kept = entries.slice(-150).map(s => '## ' + s);
          fs.writeFileSync(memPath, header.trimEnd() + '\n' + kept.join('\n'), 'utf-8');
        }
      };

      if (this.memoryQueue) {
        await this.memoryQueue.enqueue(writeOp);
      } else {
        await writeOp();
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}
