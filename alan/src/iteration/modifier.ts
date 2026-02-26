/**
 * 3-Tier Modifier — applies modifications to the workspace.
 * All modifications are reversible.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Modification, ParameterChange, PromptChange } from './types.js';

export class Modifier {
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /**
   * Apply a single modification to the workspace.
   * Creates a .bak backup before modifying.
   */
  apply(modification: Modification): { success: boolean; backup: string } {
    const fullPath = path.resolve(this.workspacePath, modification.targetFile);
    const backupPath = `${fullPath}.bak`;

    try {
      // Read target file
      if (!fs.existsSync(fullPath)) {
        return { success: false, backup: '' };
      }

      const content = fs.readFileSync(fullPath, 'utf-8');

      // Create backup
      fs.writeFileSync(backupPath, content, 'utf-8');

      // Apply change based on tier
      const newContent = this.applyChange(content, modification.change);

      if (newContent === null) {
        // Cleanup backup if change couldn't be applied
        fs.unlinkSync(backupPath);
        return { success: false, backup: '' };
      }

      fs.writeFileSync(fullPath, newContent, 'utf-8');
      return { success: true, backup: backupPath };
    } catch {
      // Attempt to restore backup on error
      if (fs.existsSync(backupPath)) {
        try {
          const backup = fs.readFileSync(backupPath, 'utf-8');
          fs.writeFileSync(fullPath, backup, 'utf-8');
          fs.unlinkSync(backupPath);
        } catch {
          // Ignore cleanup errors
        }
      }
      return { success: false, backup: '' };
    }
  }

  /**
   * Revert a modification by restoring from .bak backup.
   */
  revert(modification: Modification): boolean {
    const fullPath = path.resolve(this.workspacePath, modification.targetFile);
    const backupPath = `${fullPath}.bak`;

    try {
      if (!fs.existsSync(backupPath)) {
        return false;
      }

      const backup = fs.readFileSync(backupPath, 'utf-8');
      fs.writeFileSync(fullPath, backup, 'utf-8');
      fs.unlinkSync(backupPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Apply all modifications. Returns count of applied/failed and backup paths.
   */
  applyAll(
    modifications: Modification[],
  ): { applied: number; failed: number; backups: string[] } {
    let applied = 0;
    let failed = 0;
    const backups: string[] = [];

    for (const mod of modifications) {
      const result = this.apply(mod);
      if (result.success) {
        applied++;
        backups.push(result.backup);
      } else {
        failed++;
      }
    }

    return { applied, failed, backups };
  }

  /**
   * Revert all modifications. Returns count of successfully reverted.
   */
  revertAll(modifications: Modification[]): number {
    let reverted = 0;
    for (const mod of modifications) {
      if (this.revert(mod)) {
        reverted++;
      }
    }
    return reverted;
  }

  private applyChange(
    content: string,
    change: Modification['change'],
  ): string | null {
    switch (change.type) {
      case 'parameter':
        return this.applyParameterChange(content, change);
      case 'prompt':
        return this.applyPromptChange(content, change);
      case 'code':
        // Code patches require human review — log and skip
        console.log(
          `[modifier] Skipping code patch: ${change.description}`,
        );
        return null;
      default:
        return null;
    }
  }

  private applyParameterChange(
    content: string,
    change: ParameterChange,
  ): string | null {
    try {
      const obj = JSON.parse(content);
      this.setNestedKey(obj, change.key, change.newValue);
      return JSON.stringify(obj, null, 2) + '\n';
    } catch {
      return null;
    }
  }

  private applyPromptChange(
    content: string,
    change: PromptChange,
  ): string | null {
    if (!change.oldText || !content.includes(change.oldText)) {
      return null;
    }
    return content.replace(change.oldText, change.newText);
  }

  /**
   * Set a potentially nested key (dot-separated) on an object.
   */
  private setNestedKey(
    obj: Record<string, unknown>,
    key: string,
    value: unknown,
  ): void {
    const parts = key.split('.');
    let current: Record<string, unknown> = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (
        typeof current[part] !== 'object' ||
        current[part] === null
      ) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }
}
