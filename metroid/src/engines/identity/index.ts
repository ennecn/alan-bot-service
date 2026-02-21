import type Database from 'better-sqlite3';
import type {
  Engine, EngineContext, PromptFragment,
  AgentIdentity, MetroidCard, EmotionState, AgentMode,
} from '../../types.js';

/**
 * Identity Engine: manages agent persona and provides identity context.
 * Phase 1: load card, generate system prompt, enforce immutable values.
 */
export class IdentityEngine implements Engine {
  readonly name = 'identity';

  private agents = new Map<string, AgentIdentity>();

  constructor(private db: Database.Database) {
    this.loadAgents();
  }

  /** Register a new agent with a Metroid Card */
  createAgent(name: string, card: MetroidCard, mode: AgentMode = 'classic'): AgentIdentity {
    const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date();

    const emotionState: EmotionState = card.emotion?.baseline
      ?? { pleasure: 0, arousal: 0, dominance: 0 };

    this.db.prepare(`
      INSERT INTO agents (id, name, card_json, emotion_state, mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime(?), datetime(?))
    `).run(
      id, name, JSON.stringify(card), JSON.stringify(emotionState),
      mode, now.toISOString(), now.toISOString(),
    );

    const identity: AgentIdentity = {
      id, name, card, emotionState, mode, createdAt: now, updatedAt: now,
    };
    this.agents.set(id, identity);
    return identity;
  }

  getAgent(id: string): AgentIdentity | undefined {
    return this.agents.get(id);
  }

  getAllAgents(): AgentIdentity[] {
    return [...this.agents.values()];
  }

  /** Build identity prompt fragments */
  async getPromptFragments(context: EngineContext): Promise<PromptFragment[]> {
    const agent = this.agents.get(context.agentId);
    if (!agent) return [];

    const fragments: PromptFragment[] = [];
    const card = agent.card;

    // Core identity — always included
    const identityLines = [
      `你的名字是${card.name}。`,
      card.description,
      card.personality ? `性格：${card.personality}` : '',
      card.scenario ? `当前场景：${card.scenario}` : '',
    ].filter(Boolean);

    fragments.push({
      source: 'identity',
      content: identityLines.join('\n'),
      priority: 95,
      tokens: Math.ceil(identityLines.join('').length / 3),
      required: true,
    });

    // Soul — immutable values
    if (card.soul?.immutableValues?.length) {
      const soulText = [
        '<soul_anchors>',
        '以下是你的核心价值观，任何情况下都不能违反：',
        ...card.soul.immutableValues.map((v, i) => `${i + 1}. ${v}`),
        '</soul_anchors>',
      ].join('\n');

      fragments.push({
        source: 'identity',
        content: soulText,
        priority: 99, // highest priority
        tokens: Math.ceil(soulText.length / 3),
        required: true,
      });
    }

    // Mutable traits — personality nuances
    if (card.soul?.mutableTraits?.length) {
      const traitText = card.soul.mutableTraits
        .map(t => `- ${t.trait} (程度: ${Math.round(t.intensity * 100)}%)`)
        .join('\n');

      fragments.push({
        source: 'identity',
        content: `<personality_traits>\n${traitText}\n</personality_traits>`,
        priority: 70,
        tokens: Math.ceil(traitText.length / 3),
        required: false,
      });
    }

    return fragments;
  }

  fallback(): PromptFragment[] {
    return [{
      source: 'identity',
      content: '你是一个友好的AI助手。',
      priority: 95,
      tokens: 10,
      required: true,
    }];
  }

  /** Update a mutable trait's intensity. Creates the trait if it doesn't exist. */
  updateTrait(agentId: string, trait: string, delta: number): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    if (!agent.card.soul) {
      agent.card.soul = { immutableValues: [], mutableTraits: [] };
    }
    if (!agent.card.soul.mutableTraits) {
      agent.card.soul.mutableTraits = [];
    }

    const existing = agent.card.soul.mutableTraits.find(t => t.trait === trait);
    if (existing) {
      existing.intensity = Math.max(0, Math.min(1, existing.intensity + delta));
    } else {
      agent.card.soul.mutableTraits.push({
        trait,
        intensity: Math.max(0, Math.min(1, 0.5 + delta)),
      });
    }

    this.persistCard(agentId, agent);
  }

  /** Persist the card JSON to DB */
  persistCard(agentId: string, agent: AgentIdentity): void {
    this.db.prepare('UPDATE agents SET card_json = ?, updated_at = datetime(?) WHERE id = ?')
      .run(JSON.stringify(agent.card), new Date().toISOString(), agentId);
  }

  /** Update agent mode */
  setMode(agentId: string, mode: AgentMode): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.mode = mode;
    this.db.prepare('UPDATE agents SET mode = ?, updated_at = datetime(?) WHERE id = ?')
      .run(mode, new Date().toISOString(), agentId);
  }

  private loadAgents(): void {
    const rows = this.db.prepare('SELECT * FROM agents').all() as any[];
    for (const row of rows) {
      this.agents.set(row.id, {
        id: row.id,
        name: row.name,
        card: JSON.parse(row.card_json),
        emotionState: JSON.parse(row.emotion_state),
        mode: row.mode || 'classic',
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      });
    }
  }
}
