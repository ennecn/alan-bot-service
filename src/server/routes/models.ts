/**
 * Model Registry — CRUD for S1/S2 model configurations.
 * Stored in workspace/internal/models.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { AlanEngine } from '../engine.js';

export interface ModelEntry {
  id: string;
  label: string;
  base_url: string;
  api_key?: string;
  model_id: string;
  role: 's1' | 's2';
  added_at: string;
}

interface ModelRegistry {
  models: ModelEntry[];
  active: { s1?: string; s2?: string };
}

function registryPath(workspace: string): string {
  return path.join(workspace, 'internal', 'models.json');
}

function loadRegistry(workspace: string): ModelRegistry {
  const p = registryPath(workspace);
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as ModelRegistry;
  }
  return { models: [], active: {} };
}

function saveRegistry(workspace: string, registry: ModelRegistry): void {
  const p = registryPath(workspace);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(registry, null, 2), 'utf-8');
}

export function modelRoutes(engine: AlanEngine) {
  const app = new Hono();
  const ws = engine.config.workspace_path;

  // List all models + active info
  app.get('/admin/models', (c) => {
    const registry = loadRegistry(ws);
    return c.json(registry);
  });

  // Add a model
  app.post('/admin/models', async (c) => {
    const body = await c.req.json<{
      label: string;
      base_url: string;
      api_key?: string;
      model_id: string;
      role: 's1' | 's2';
    }>();

    if (!body.label || !body.base_url || !body.model_id || !body.role) {
      return c.json({ error: 'label, base_url, model_id, role are required' }, 400);
    }
    if (body.role !== 's1' && body.role !== 's2') {
      return c.json({ error: 'role must be "s1" or "s2"' }, 400);
    }

    const entry: ModelEntry = {
      id: randomUUID(),
      label: body.label,
      base_url: body.base_url,
      api_key: body.api_key,
      model_id: body.model_id,
      role: body.role,
      added_at: new Date().toISOString(),
    };

    const registry = loadRegistry(ws);
    registry.models.push(entry);
    saveRegistry(ws, registry);

    return c.json({ status: 'ok', model: entry }, 201);
  });

  // Set active model for a role
  app.put('/admin/models/active', async (c) => {
    const body = await c.req.json<{ role: 's1' | 's2'; id: string }>();

    if (!body.role || !body.id) {
      return c.json({ error: 'role and id are required' }, 400);
    }

    const registry = loadRegistry(ws);
    const model = registry.models.find(m => m.id === body.id);
    if (!model) {
      return c.json({ error: 'model not found' }, 404);
    }
    if (model.role !== body.role) {
      return c.json({ error: `model "${model.label}" is role ${model.role}, not ${body.role}` }, 400);
    }

    registry.active[body.role] = body.id;
    saveRegistry(ws, registry);

    // Apply to running engine
    engine.applyModelOverride(body.role, model);

    return c.json({ status: 'ok', active: registry.active });
  });

  // Delete a model
  app.delete('/admin/models/:id', (c) => {
    const id = c.req.param('id');
    const registry = loadRegistry(ws);
    const idx = registry.models.findIndex(m => m.id === id);
    if (idx === -1) {
      return c.json({ error: 'model not found' }, 404);
    }

    const removed = registry.models.splice(idx, 1)[0];

    // Clear active reference if this was active
    if (registry.active.s1 === id) delete registry.active.s1;
    if (registry.active.s2 === id) delete registry.active.s2;

    saveRegistry(ws, registry);
    return c.json({ status: 'ok', removed });
  });

  return app;
}
