import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface Conversation {
  id: string;
  title?: string;
  createdBy: string;
  participants: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationMessage {
  id: number;
  conversationId: string;
  agentId?: string;
  userId?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  authorName?: string;
  createdAt: Date;
}

/**
 * Conversation Engine: manages multi-agent conversations.
 * Supports shared history, participant management, and turn scheduling.
 */
export class ConversationEngine {
  private stmts: ReturnType<typeof this.prepare>;

  constructor(private db: Database.Database) {
    this.stmts = this.prepare();
  }

  private prepare() {
    return {
      createConv: this.db.prepare(
        `INSERT INTO conversations (id, title, created_by, created_at, updated_at)
         VALUES (?, ?, ?, datetime(?), datetime(?))`
      ),
      getConv: this.db.prepare(
        `SELECT * FROM conversations WHERE id = ?`
      ),
      listConvs: this.db.prepare(
        `SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?`
      ),
      addParticipant: this.db.prepare(
        `INSERT OR IGNORE INTO conversation_participants (conversation_id, agent_id) VALUES (?, ?)`
      ),
      getParticipants: this.db.prepare(
        `SELECT agent_id FROM conversation_participants WHERE conversation_id = ?`
      ),
      addMessage: this.db.prepare(
        `INSERT INTO conversation_messages (conversation_id, agent_id, user_id, role, content, author_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime(?))`
      ),
      getMessages: this.db.prepare(
        `SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?`
      ),
      getRecentMessages: this.db.prepare(
        `SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?`
      ),
      touchConv: this.db.prepare(
        `UPDATE conversations SET updated_at = datetime(?) WHERE id = ?`
      ),
      getConvsForAgent: this.db.prepare(
        `SELECT c.* FROM conversations c
         JOIN conversation_participants cp ON c.id = cp.conversation_id
         WHERE cp.agent_id = ?
         ORDER BY c.updated_at DESC LIMIT ?`
      ),
    };
  }

  /** Create a new conversation with initial participants */
  create(title: string | undefined, createdBy: string, agentIds: string[]): Conversation {
    const id = randomUUID();
    const now = new Date();
    this.stmts.createConv.run(id, title ?? null, createdBy, now.toISOString(), now.toISOString());

    for (const agentId of agentIds) {
      this.stmts.addParticipant.run(id, agentId);
    }

    return {
      id, title, createdBy, participants: agentIds,
      createdAt: now, updatedAt: now,
    };
  }

  /** Add a participant to an existing conversation */
  addParticipant(conversationId: string, agentId: string): void {
    this.stmts.addParticipant.run(conversationId, agentId);
  }

  /** Get conversation by ID */
  get(conversationId: string): Conversation | undefined {
    const row = this.stmts.getConv.get(conversationId) as any;
    if (!row) return undefined;
    const participants = (this.stmts.getParticipants.all(conversationId) as any[])
      .map(p => p.agent_id);
    return this.rowToConversation(row, participants);
  }

  /** List all conversations */
  list(limit = 20): Conversation[] {
    const rows = this.stmts.listConvs.all(limit) as any[];
    return rows.map(row => {
      const participants = (this.stmts.getParticipants.all(row.id) as any[])
        .map(p => p.agent_id);
      return this.rowToConversation(row, participants);
    });
  }

  /** List conversations for a specific agent */
  listForAgent(agentId: string, limit = 20): Conversation[] {
    const rows = this.stmts.getConvsForAgent.all(agentId, limit) as any[];
    return rows.map(row => {
      const participants = (this.stmts.getParticipants.all(row.id) as any[])
        .map(p => p.agent_id);
      return this.rowToConversation(row, participants);
    });
  }

  /** Add a message to the conversation */
  addMessage(
    conversationId: string,
    opts: { agentId?: string; userId?: string; role: 'user' | 'assistant' | 'system'; content: string; authorName?: string },
  ): ConversationMessage {
    const now = new Date();
    this.stmts.addMessage.run(
      conversationId, opts.agentId ?? null, opts.userId ?? null,
      opts.role, opts.content, opts.authorName ?? null, now.toISOString(),
    );
    this.stmts.touchConv.run(now.toISOString(), conversationId);

    const id = (this.db.prepare('SELECT last_insert_rowid() as id').get() as any).id;
    return {
      id, conversationId, agentId: opts.agentId, userId: opts.userId,
      role: opts.role, content: opts.content, authorName: opts.authorName,
      createdAt: now,
    };
  }

  /** Get conversation messages */
  getMessages(conversationId: string, limit = 100): ConversationMessage[] {
    const rows = this.stmts.getMessages.all(conversationId, limit) as any[];
    return rows.map(r => this.rowToMessage(r));
  }

  /** Get recent messages (reverse chronological, then reversed for display) */
  getRecentMessages(conversationId: string, limit = 20): ConversationMessage[] {
    const rows = this.stmts.getRecentMessages.all(conversationId, limit) as any[];
    return rows.map(r => this.rowToMessage(r)).reverse();
  }

  /**
   * Determine which agent should speak next based on:
   * 1. Relevance to the last message (name mentioned)
   * 2. Least recent speaker (round-robin fairness)
   * 3. Random tiebreaker
   */
  selectNextSpeaker(conversationId: string, participants: string[], lastMessage: string, agentNames: Map<string, string>): string | undefined {
    if (participants.length === 0) return undefined;
    if (participants.length === 1) return participants[0];

    // Check who was mentioned
    const mentioned = participants.filter(id => {
      const name = agentNames.get(id);
      return name && lastMessage.includes(name);
    });
    if (mentioned.length === 1) return mentioned[0];

    // Get recent messages to find least recent speaker
    const recent = this.getRecentMessages(conversationId, 10);
    const lastSpoke = new Map<string, number>();
    for (let i = 0; i < recent.length; i++) {
      const msg = recent[i];
      if (msg.agentId && !lastSpoke.has(msg.agentId)) {
        lastSpoke.set(msg.agentId, i);
      }
    }

    // Sort by least recent speaker (higher index = spoke longer ago)
    const sorted = [...participants].sort((a, b) => {
      const aLast = lastSpoke.get(a) ?? Infinity;
      const bLast = lastSpoke.get(b) ?? Infinity;
      return bLast - aLast; // higher = spoke longer ago = should go first
    });

    return sorted[0];
  }

  private rowToConversation(row: any, participants: string[]): Conversation {
    return {
      id: row.id,
      title: row.title ?? undefined,
      createdBy: row.created_by,
      participants,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private rowToMessage(row: any): ConversationMessage {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      agentId: row.agent_id ?? undefined,
      userId: row.user_id ?? undefined,
      role: row.role,
      content: row.content,
      authorName: row.author_name ?? undefined,
      createdAt: new Date(row.created_at),
    };
  }
}
