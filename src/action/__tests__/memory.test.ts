import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MemoryAdapter } from '../adapters/memory.js';

describe('MemoryAdapter', () => {
  let tmpDir: string;
  let adapter: MemoryAdapter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alan-mem-'));
    adapter = new MemoryAdapter(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates MEMORY.md with header on first write', async () => {
    await adapter.execute({ type: 'update_memory', content: 'First entry' });
    const content = fs.readFileSync(path.join(tmpDir, 'MEMORY.md'), 'utf-8');
    expect(content).toMatch(/^# Memory/);
    expect(content).toContain('First entry');
  });

  it('appends entries on subsequent writes', async () => {
    await adapter.execute({ type: 'update_memory', content: 'Entry 1' });
    await adapter.execute({ type: 'update_memory', content: 'Entry 2' });
    const content = fs.readFileSync(path.join(tmpDir, 'MEMORY.md'), 'utf-8');
    expect(content).toContain('Entry 1');
    expect(content).toContain('Entry 2');
    const sections = content.split('\n## ');
    expect(sections.length).toBe(3); // header + 2 entries
  });

  it('trims to ~150 entries when exceeding 200 lines', async () => {
    // Write 210 entries (each ~3 lines: \n## timestamp\n\ncontent\n)
    const memPath = path.join(tmpDir, 'MEMORY.md');
    const lines = ['# Memory\n'];
    for (let i = 0; i < 210; i++) {
      lines.push(`\n## 2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z\n\nEntry ${i}\n`);
    }
    fs.writeFileSync(memPath, lines.join(''), 'utf-8');

    // Trigger one more write to activate trimming
    await adapter.execute({ type: 'update_memory', content: 'Trigger trim' });

    const content = fs.readFileSync(memPath, 'utf-8');
    expect(content).toMatch(/^# Memory/);
    const sections = content.split('\n## ').filter(Boolean);
    // header + ~150 entries (kept) + 1 new = ~151 entries section count
    expect(sections.length).toBeLessThanOrEqual(152);
    expect(sections.length).toBeGreaterThan(100);
    expect(content).toContain('Trigger trim');
  });

  it('returns error for non-update_memory actions', async () => {
    const result = await adapter.execute({ type: 'reply', content: 'hello' });
    expect(result.success).toBe(false);
  });
});
