/**
 * Card Management — upload, list, detail, activate character cards.
 * Cards stored in workspace/internal/cards/ with a manifest.json index.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { importCard } from '../../card-import/index.js';
import { callImportLLM } from '../../card-import/import-llm.js';
import type { AlanEngine } from '../engine.js';

interface CardManifestEntry {
  id: string;
  name: string;
  file: string;
  detected_language: string;
  wi_count: number;
  active: boolean;
  imported_at: string;
}

interface CardManifest {
  cards: CardManifestEntry[];
}

function cardsDir(workspace: string): string {
  return path.join(workspace, 'internal', 'cards');
}

function manifestPath(workspace: string): string {
  return path.join(cardsDir(workspace), 'manifest.json');
}

function loadManifest(workspace: string): CardManifest {
  const p = manifestPath(workspace);
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as CardManifest;
  }
  return { cards: [] };
}

function saveManifest(workspace: string, manifest: CardManifest): void {
  const dir = cardsDir(workspace);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(manifestPath(workspace), JSON.stringify(manifest, null, 2), 'utf-8');
}

export function cardRoutes(engine: AlanEngine) {
  const app = new Hono();
  const ws = engine.config.workspace_path;

  // List imported cards
  app.get('/admin/cards', (c) => {
    const manifest = loadManifest(ws);
    return c.json(manifest);
  });

  // Upload a card (multipart: file field "card")
  app.post('/admin/cards/upload', async (c) => {
    const formData = await c.req.formData();
    const file = formData.get('card');

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'card file is required (multipart field "card")' }, 400);
    }

    const ext = path.extname(file.name).toLowerCase();
    if (ext !== '.png' && ext !== '.json') {
      return c.json({ error: 'card must be .png or .json' }, 400);
    }

    // Save uploaded file to cards dir
    const dir = cardsDir(ws);
    fs.mkdirSync(dir, { recursive: true });
    const id = randomUUID();
    const savedName = `${id}${ext}`;
    const savedPath = path.join(dir, savedName);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(savedPath, buffer);

    try {
      // Import the card into workspace
      const result = await importCard(savedPath, ws, {
        reimport: false,
        alanConfig: engine.config,
        embeddingConfig: engine.config.embedding_url
          ? { baseUrl: engine.config.embedding_url }
          : undefined,
      });

      // Run Import LLM to generate SOUL.md and IMPULSE.md
      const llmResult = await callImportLLM(engine.config, ws).catch(() => null);

      // Extract card name from card-data.json
      let cardName = file.name.replace(ext, '');
      const cardDataPath = path.join(ws, 'internal', 'card-data.json');
      if (fs.existsSync(cardDataPath)) {
        try {
          const cardData = JSON.parse(fs.readFileSync(cardDataPath, 'utf-8'));
          if (cardData.character_name) cardName = cardData.character_name;
        } catch { /* ignore */ }
      }

      // Update manifest
      const manifest = loadManifest(ws);
      // Deactivate all others, set this as active
      for (const card of manifest.cards) card.active = false;
      manifest.cards.push({
        id,
        name: cardName,
        file: savedName,
        detected_language: result.detected_language,
        wi_count: result.wi_count,
        active: true,
        imported_at: new Date().toISOString(),
      });
      saveManifest(ws, manifest);

      return c.json({
        status: 'ok',
        card: { id, name: cardName },
        import: {
          wi_count: result.wi_count,
          detected_language: result.detected_language,
          greetings: result.greetings.length,
          has_behavioral_engine: !!result.behavioral_engine,
        },
        import_llm: llmResult ? 'success' : 'skipped_or_failed',
      }, 201);
    } catch (err) {
      // Clean up saved file on import failure
      fs.unlinkSync(savedPath);
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // Get card detail
  app.get('/admin/cards/:id', (c) => {
    const id = c.req.param('id');
    const manifest = loadManifest(ws);
    const card = manifest.cards.find(m => m.id === id);
    if (!card) return c.json({ error: 'card not found' }, 404);

    // Read workspace files for active card detail
    const readFile = (name: string) => {
      const p = path.join(ws, name);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
    };

    return c.json({
      ...card,
      identity: readFile('IDENTITY.md'),
      soul: readFile('SOUL.md'),
      memory: readFile('MEMORY.md'),
      card_data: (() => {
        const p = path.join(ws, 'internal', 'card-data.json');
        return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null;
      })(),
    });
  });

  // Activate a card (re-import from stored file)
  app.post('/admin/cards/:id/activate', async (c) => {
    const id = c.req.param('id');
    const manifest = loadManifest(ws);
    const card = manifest.cards.find(m => m.id === id);
    if (!card) return c.json({ error: 'card not found' }, 404);

    const cardPath = path.join(cardsDir(ws), card.file);
    if (!fs.existsSync(cardPath)) {
      return c.json({ error: 'card file missing from storage' }, 500);
    }

    try {
      const result = await importCard(cardPath, ws, {
        reimport: true,
        embeddingConfig: engine.config.embedding_url
          ? { baseUrl: engine.config.embedding_url }
          : undefined,
      });

      await callImportLLM(engine.config, ws).catch(() => null);

      // Update active status
      for (const c of manifest.cards) c.active = c.id === id;
      saveManifest(ws, manifest);

      return c.json({
        status: 'ok',
        card: { id, name: card.name },
        wi_count: result.wi_count,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
