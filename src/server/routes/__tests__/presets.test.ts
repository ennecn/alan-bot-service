import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { presetRoutes } from '../presets.js';
import type { AlanEngine } from '../../engine.js';

function makeTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'alan-presets-test-'));
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function makeEngineStub(workspacePath: string, invalidateFn: ReturnType<typeof vi.fn>): AlanEngine {
  return {
    config: { workspace_path: workspacePath },
    pipeline: { invalidatePresetCache: invalidateFn },
  } as unknown as AlanEngine;
}

describe('presetRoutes cache invalidation', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('invalidates preset cache after activate', async () => {
    const ws = makeTempWorkspace();
    tempDirs.push(ws);

    const presetId = 'preset-1';
    const presetFile = `${presetId}.json`;
    const presetsDir = path.join(ws, 'internal', 'presets');
    writeJson(path.join(presetsDir, presetFile), {});
    writeJson(path.join(presetsDir, 'manifest.json'), {
      presets: [{ id: presetId, source_name: 'old', file: presetFile, active: false, imported_at: new Date().toISOString() }],
    });

    const invalidatePresetCache = vi.fn();
    const app = presetRoutes(makeEngineStub(ws, invalidatePresetCache));

    const res = await app.request(`/admin/presets/${presetId}/activate`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(invalidatePresetCache).toHaveBeenCalledTimes(1);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(presetsDir, 'manifest.json'), 'utf-8'),
    ) as { presets: Array<{ id: string; active: boolean }> };
    expect(manifest.presets.find((p) => p.id === presetId)?.active).toBe(true);
    expect(fs.existsSync(path.join(ws, 'internal', 'preset.json'))).toBe(true);
  });

  it('invalidates preset cache after upload', async () => {
    const ws = makeTempWorkspace();
    tempDirs.push(ws);

    const invalidatePresetCache = vi.fn();
    const app = presetRoutes(makeEngineStub(ws, invalidatePresetCache));

    const form = new FormData();
    form.set(
      'preset',
      new File([JSON.stringify({ temperature: 0.8, prompts: [] })], 'new-preset.json', {
        type: 'application/json',
      }),
    );

    const res = await app.request('/admin/presets/upload', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(201);
    expect(invalidatePresetCache).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(ws, 'internal', 'preset.json'))).toBe(true);
  });
});

