/**
 * Chat History — query chat history and sessions.
 */

import { Hono } from 'hono';
import type { AlanEngine } from '../engine.js';

export function chatRoutes(engine: AlanEngine) {
  const app = new Hono();

  // List sessions
  app.get('/chat/sessions', (c) => {
    const limit = parseInt(c.req.query('limit') ?? '20', 10);
    const sessions = engine.chatHistory.listSessions(limit);
    return c.json({ sessions, count: sessions.length });
  });

  // Get chat history for a session
  app.get('/chat/history', (c) => {
    const sessionId = c.req.query('session_id');
    const limit = parseInt(c.req.query('limit') ?? '50', 10);

    if (!sessionId) {
      // Without session_id, return most recent messages across all sessions
      const messages = engine.chatHistory.getRecentAll(limit);
      return c.json({ messages, count: messages.length });
    }

    const messages = engine.chatHistory.getRecent(sessionId, limit);
    return c.json({ messages, count: messages.length });
  });

  return app;
}
