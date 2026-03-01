/**
 * Preset Management — upload, list, detail, activate ST presets.
 * Presets stored in workspace/internal/presets/ with a manifest.json index.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { importPreset } from '../../preset-import/index.js';
import type { AlanPreset } from '../../preset-import/types.js';
import type { AlanEngine } from '../engine.js';

interface PresetManifestEntry {
  id: string;
  source_name: string;
  file: string;
  active: boolean;
  imported_at: string;
}

interface PresetManifest {
  presets: PresetManifestEntry[];
}

function presetsDir(workspace: string): string {
  return path.join(workspace, 'internal', 'presets');
}

function manifestPath(workspace: string): string {
  return path.join(presetsDir(workspace), 'manifest.json');
}

function loadManifest(workspace: string): PresetManifest {
  const p = manifestPath(workspace);
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as PresetManifest;
  }
  return { presets: [] };
}

function saveManifest(workspace: string, manifest: PresetManifest): void {
  const dir = presetsDir(workspace);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(manifestPath(workspace), JSON.stringify(manifest, null, 2), 'utf-8');
}

export function presetRoutes(engine: AlanEngine) {
  const app = new Hono();
  const ws = engine.config.workspace_path;

  // List presets
  app.get('/admin/presets', (c) => {
    const manifest = loadManifest(ws);
    return c.json(manifest);
  });

  // Upload a preset (multipart: file field "preset")
  app.post('/admin/presets/upload', async (c) => {
    const formData = await c.req.formData();
    const file = formData.get('preset');

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'preset file is required (multipart field "preset")' }, 400);
    }

    if (!file.name.endsWith('.json')) {
      return c.json({ error: 'preset must be a .json file' }, 400);
    }

    // Save uploaded file
    const dir = presetsDir(ws);
    fs.mkdirSync(dir, { recursive: true });
    const id = randomUUID();
    const savedName = `${id}.json`;
    const savedPath = path.join(dir, savedName);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(savedPath, buffer);

    try {
      // Import preset (writes to workspace/internal/preset.json)
      const parsed = importPreset(savedPath, ws);

      // Update manifest
      const manifest = loadManifest(ws);
      for (const p of manifest.presets) p.active = false;
      manifest.presets.push({
        id,
        source_name: parsed.source_name,
        file: savedName,
        active: true,
        imported_at: new Date().toISOString(),
      });
      saveManifest(ws, manifest);

      return c.json({
        status: 'ok',
        preset: {
          id,
          source_name: parsed.source_name,
          sampler: parsed.sampler,
          depth_injections: parsed.depth_injections.length,
          has_prefill: !!parsed.assistant_prefill,
        },
      }, 201);
    } catch (err) {
      fs.unlinkSync(savedPath);
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // Get preset detail (full AlanPreset)
  app.get('/admin/presets/:id', (c) => {
    const id = c.req.param('id');
    const manifest = loadManifest(ws);
    const entry = manifest.presets.find(p => p.id === id);
    if (!entry) return c.json({ error: 'preset not found' }, 404);

    // Read the parsed preset from the saved source file
    const savedPath = path.join(presetsDir(ws), entry.file);
    if (!fs.existsSync(savedPath)) {
      return c.json({ error: 'preset file missing from storage' }, 500);
    }

    // If this preset is active, read from workspace/internal/preset.json for the processed version
    const activePath = path.join(ws, 'internal', 'preset.json');
    if (entry.active && fs.existsSync(activePath)) {
      const preset = JSON.parse(fs.readFileSync(activePath, 'utf-8')) as AlanPreset;
      return c.json({ ...entry, preset });
    }

    // Otherwise re-parse from source (without writing to disk)
    try {
      const raw = JSON.parse(fs.readFileSync(savedPath, 'utf-8'));
      return c.json({ ...entry, raw });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // Activate a preset (re-import from stored file)
  app.post('/admin/presets/:id/activate', (c) => {
    const id = c.req.param('id');
    const manifest = loadManifest(ws);
    const entry = manifest.presets.find(p => p.id === id);
    if (!entry) return c.json({ error: 'preset not found' }, 404);

    const savedPath = path.join(presetsDir(ws), entry.file);
    if (!fs.existsSync(savedPath)) {
      return c.json({ error: 'preset file missing from storage' }, 500);
    }

    try {
      const parsed = importPreset(savedPath, ws);

      for (const p of manifest.presets) p.active = p.id === id;
      saveManifest(ws, manifest);

      return c.json({
        status: 'ok',
        preset: { id, source_name: parsed.source_name },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
