/**
 * MemoryAdapter — handles update_memory actions.
 * Appends to MEMORY.md with timestamp header.
 * (Direct file write until coordinator/memory-queue.ts exists)
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Action } from '../../types/actions.js';
import type { ActionAdapter, ActionResult } from './base.js';

export class MemoryAdapter implements ActionAdapter {
  constructor(private workspacePath: string) {}

  canHandle(action: Action): boolean {
    return action.type === 'update_memory';
  }

  async execute(action: Action): Promise<ActionResult> {
    if (action.type !== 'update_memory') {
      return { success: false, error: 'Not an update_memory action' };
    }

    try {
      const memPath = path.join(this.workspacePath, 'MEMORY.md');
      const timestamp = new Date().toISOString();
      const entry = `\n## ${timestamp}\n\n${action.content}\n`;

      if (fs.existsSync(memPath)) {
        fs.appendFileSync(memPath, entry, 'utf-8');
      } else {
        fs.writeFileSync(memPath, `# Memory\n${entry}`, 'utf-8');
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}
