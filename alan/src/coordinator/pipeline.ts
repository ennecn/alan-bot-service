/**
 * Coordinator Pipeline — Central orchestrator of the Alan Engine.
 * PRD v6.0 §3.3
 *
 * System 1 call with degradation, real System 2 streaming LLM call.
 * All deterministic steps (emotion, impulse, decision, WI, prompt assembly) are real.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { EmotionDimension, EmotionSnapshot, System1Output } from '../types/index.js';
import type { AlanConfig, CoordinatorMetrics, WIEntry } from '../types/actions.js';
import type { CoordinatorEvent, ActionList, PipelineContext } from './types.js';
import { Mutex } from './mutex.js';
import { S2Queue } from './s2-queue.js';
import { MemoryQueue } from './memory-queue.js';
import { callSystem1 } from './system1/client.js';
import type { System1Config } from './system1/client.js';
import { callSystem2 } from './system2/client.js';
import type { System2Config } from './system2/types.js';
import { updateEmotion, makeEmotionState, makeDefaultHalfLife } from '../emotion/calculator.js';
import { narrativize } from '../emotion/narrativizer.js';
import { calculateImpulse } from '../impulse/calculator.js';
import { decideBehavior } from '../impulse/decision.js';
import { preFilter } from '../wi-engine/pre-filter.js';
import { scanEntries } from '../wi-engine/text-scanner.js';
import { scoreEntries } from '../wi-engine/semantic-scorer.js';
import { combineSignals } from '../wi-engine/combiner.js';
import type { SignalScores } from '../wi-engine/combiner.js';
import { activateEntries } from '../wi-engine/activation.js';
import { evaluateState } from '../wi-engine/state-evaluator.js';
import { evaluateTemporal } from '../wi-engine/temporal-evaluator.js';
import { EmotionStateStore } from '../storage/emotion-state.js';
import { MetricsWriter } from '../storage/metrics.js';
import type { WIStore } from '../storage/wi-store.js';
import type { ChatHistoryStore } from '../storage/chat-history.js';
import { getEmbedding } from '../embedding/client.js';
import type { EmbeddingConfig } from '../embedding/client.js';
import { assemble } from './prompt-assembler.js';
import type { CardData } from '../card-import/mapper.js';

export class Pipeline {
  private mutex = new Mutex();
  private s2Queue = new S2Queue();
  readonly memoryQueue = new MemoryQueue();
  private emotionStore = new EmotionStateStore();
  private metricsWriter: MetricsWriter;
  private cardDataCache: { data: CardData | null; loaded: boolean } = { data: null, loaded: false };

  constructor(
    private config: AlanConfig,
    private wiStore?: WIStore,
    private chatHistory?: ChatHistoryStore,
  ) {
    this.metricsWriter = new MetricsWriter(config.workspace_path);
  }

  private loadCardData(): CardData | null {
    if (this.cardDataCache.loaded) return this.cardDataCache.data;
    const cardPath = path.join(this.config.workspace_path, 'internal', 'card-data.json');
    try {
      const raw = fs.readFileSync(cardPath, 'utf-8');
      this.cardDataCache = { data: JSON.parse(raw) as CardData, loaded: true };
    } catch {
      this.cardDataCache = { data: null, loaded: true };
    }
    return this.cardDataCache.data;
  }

  async run(event: CoordinatorEvent): Promise<ActionList> {
    const startMs = Date.now();

    // (a) Acquire mutex
    await this.mutex.acquire();
    try {
      return await this.executePipeline(event, startMs);
    } finally {
      this.mutex.release();
    }
  }

  private async executePipeline(event: CoordinatorEvent, startMs: number): Promise<ActionList> {
    const now = new Date(event.timestamp);

    // (b) Time calculation
    const emotionBefore = this.emotionStore.read(this.config.workspace_path) ?? makeDefaultSnapshot();
    const lastInteraction = new Date(emotionBefore.last_interaction);
    const elapsedHours = (now.getTime() - lastInteraction.getTime()) / 3_600_000;

    // (c) Read current emotion state — already done above

    // (d) Read current IMPULSE.md
    const impulseMdPath = path.join(this.config.workspace_path, 'IMPULSE.md');
    const impulseMd = readFileOr(impulseMdPath, '');

    // (e) WI pre-filter — load from store, get query embedding
    const allWI = this.wiStore
      ? this.wiStore.getAllEntries().filter(e => e.enabled !== false)
      : [];

    const embeddingConfig: EmbeddingConfig = {
      baseUrl: this.config.embedding_url,
      apiKey: this.config.embedding_api_key,
      model: this.config.embedding_model,
    };
    const queryEmbedding = event.content
      ? await getEmbedding(event.content, embeddingConfig)
      : null;

    const candidates = preFilter(event.content, queryEmbedding, allWI, this.config.wi_weights);

    // (f) System 1 call (with degradation)
    const s1StartMs = Date.now();
    const s1Config: System1Config = {
      baseUrl: this.config.system1_base_url,
      model: this.config.system1_model,
      apiKey: this.config.s1_api_key,
    };
    const identityMd = readFileOr(path.join(this.config.workspace_path, 'IDENTITY.md'), '');
    const wiCandidateSummaries = candidates.map(c => ({
      id: c.id,
      summary: c.content.slice(0, 100),
    }));
    const s1Raw = await callSystem1(
      {
        characterFilter: identityMd,
        emotionState: emotionBefore.current,
        eventContent: event.content,
        triggerType: event.trigger,
        wiCandidates: wiCandidateSummaries,
        language: this.config.character_language,
        previousImpulse: impulseMd || null,
        oldImpulse: impulseMd || null,
      },
      s1Config,
    );
    const system1Output = s1Raw ?? makeDegradedSystem1Output();
    const s1Degraded = s1Raw === null;
    const s1Ms = Date.now() - s1StartMs;

    // (g) Deterministic emotion calculation
    const emotionAfter = updateEmotion(
      emotionBefore.current,
      emotionBefore.baseline,
      makeDefaultHalfLife(),
      elapsedHours,
      system1Output.emotional_interpretation,
    );

    // (h) Emotion narrativization
    const emotionNarrative = narrativize(emotionAfter, this.config.character_language);

    // (i) Memory consolidation check
    const memoryActions: Array<{ type: 'update_memory'; content: string }> = [];
    if (system1Output.memory_consolidation.should_save) {
      memoryActions.push({
        type: 'update_memory',
        content: system1Output.memory_consolidation.summary,
      });
    }

    // (j) Impulse calculation
    const impulse = calculateImpulse({
      emotionDeltas: system1Output.emotional_interpretation,
      suppressionCount: emotionBefore.suppression.count,
      hoursSinceLastInteraction: elapsedHours,
      eventImportance: system1Output.event_classification.importance,
      consecutiveUnreplied: event.trigger === 'user_message' ? 1 : 0,
      fireThreshold: this.config.fire_threshold,
      userMessageIncrement: this.config.user_message_increment,
    });

    // (k) Behavior decision
    const decision = decideBehavior(impulse, event.trigger, emotionBefore.suppression);

    // Update emotion snapshot
    const newSnapshot: EmotionSnapshot = {
      current: emotionAfter,
      baseline: emotionBefore.baseline,
      suppression: updateSuppression(emotionBefore.suppression, decision, event.timestamp),
      last_interaction: event.timestamp,
      session_start: emotionBefore.session_start,
    };

    // Write IMPULSE.md + emotion_state.md (serialized through memory queue)
    const newImpulseMd = `# Impulse\n\nvalue: ${impulse.value.toFixed(3)}\nfired: ${impulse.fired}\ndecision: ${decision}\nnarrative: ${system1Output.impulse_narrative}\n`;
    await this.memoryQueue.enqueue(async () => {
      fs.writeFileSync(impulseMdPath, newImpulseMd, 'utf-8');
      this.emotionStore.write(this.config.workspace_path, newSnapshot);
    });

    // (l) Branch on decision
    let reply: string | undefined;
    let s2Ms: number | null = null;
    let s2Usage: { input_tokens: number; output_tokens: number } | null = null;
    let s2StreamChunks: import('./system2/types.js').System2StreamChunk[] = [];

    if (decision === 'reply') {
      // WI final activation — combine all 4 signals and apply threshold
      const textScores = scanEntries(event.content, candidates);
      const semanticScores = queryEmbedding
        ? scoreEntries(queryEmbedding, candidates)
        : new Map<string, number>();

      const stateScores = evaluateState(candidates, emotionAfter);
      const temporalScores = evaluateTemporal(candidates);

      const combinedScores = new Map<string, number>();
      for (const c of candidates) {
        const scores: SignalScores = {
          text: textScores.get(c.id) ?? 0,
          semantic: semanticScores.get(c.id) ?? 0,
          state: stateScores.get(c.id) ?? 0,
          temporal: temporalScores.get(c.id) ?? 0,
        };
        combinedScores.set(c.id, combineSignals(scores, this.config.wi_weights));
      }
      const activatedWI = activateEntries(
        candidates,
        combinedScores,
        this.config.wi_activation_threshold,
      );

      // 4-layer prompt assembly
      const soulMdPath = path.join(this.config.workspace_path, 'SOUL.md');
      const soulMd = readFileOr(soulMdPath, '');
      const cardData = this.loadCardData();

      const assembled = assemble({
        systemPrompt: cardData?.system_prompt ?? '',
        soulMd,
        mesExample: cardData?.mes_example ?? '',
        constantWI: [],
        impulseMd: newImpulseMd,
        emotionNarrative,
        activatedWI,
        chatHistory: this.chatHistory
          ? (() => {
              const sessionId = this.chatHistory.getOrCreateSession(
                emotionBefore.last_interaction,
                this.config.session_timeout_hours,
              );
              return this.chatHistory.getRecent(sessionId, 50).reverse().map(m => ({
                role: m.role,
                content: m.content,
              }));
            })()
          : [],
        postHistoryInstructions: cardData?.post_history_instructions ?? '',
      });

      // System 2 call via serial queue
      const s2Config: System2Config = {
        baseUrl: this.config.system2_base_url,
        model: this.config.system2_model,
        apiKey: this.config.s2_api_key,
        maxTokens: this.config.s2_max_tokens,
      };
      const s2Start = Date.now();
      const s2Result = await this.s2Queue.enqueue(async () => {
        return callSystem2(assembled, s2Config);
      });
      s2Ms = Date.now() - s2Start;

      // Consume stream to get full text, collect usage, buffer chunks for SSE passthrough
      for await (const chunk of s2Result.stream) {
        s2StreamChunks.push(chunk);
        if (chunk.type === 'stop' && chunk.usage) {
          s2Usage = chunk.usage;
        }
      }
      reply = s2Result.text;
    }

    // (m) Write metrics
    const metrics: CoordinatorMetrics = {
      timestamp: event.timestamp,
      trigger: event.trigger,
      duration_ms: Date.now() - startMs,
      system1_ms: s1Ms,
      system2_ms: s2Ms,
      emotion_delta: system1Output.emotional_interpretation,
      wi_activated: candidates.length,
      wi_total: allWI.length,
      actions: decision === 'reply' ? ['reply'] : [decision],
      token_usage: {
        s1_in: 0,
        s1_out: 0,
        s2_in: s2Usage?.input_tokens ?? null,
        s2_out: s2Usage?.output_tokens ?? null,
      },
      degraded: s1Degraded,
    };
    this.metricsWriter.write(metrics);

    // Build action list
    const actions: import('../types/actions.js').Action[] = decision === 'reply' && reply
      ? [{ type: 'reply' as const, content: reply }, ...memoryActions]
      : [{ type: decision as 'hesitate' | 'suppress' }, ...memoryActions];

    // Create replay stream from buffered chunks for SSE passthrough
    const replayStream = s2StreamChunks.length > 0
      ? (async function* () {
          for (const chunk of s2StreamChunks) {
            yield chunk;
          }
        })()
      : undefined;

    return {
      decision,
      actions,
      metrics,
      impulse,
      emotion: newSnapshot,
      system1: system1Output,
      reply,
      stream: replayStream,
    };
  }
}

// --- Helpers ---

function readFileOr(filePath: string, fallback: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return fallback;
  }
}

function makeDefaultSnapshot(): EmotionSnapshot {
  const now = new Date().toISOString();
  return {
    current: makeEmotionState(0.5),
    baseline: makeEmotionState(0.5),
    suppression: { count: 0, consecutive_hesitate: 0, accumulated: 0, last_suppress: null },
    last_interaction: now,
    session_start: now,
  };
}

function updateSuppression(
  prev: EmotionSnapshot['suppression'],
  decision: string,
  timestamp: string,
): EmotionSnapshot['suppression'] {
  if (decision === 'suppress') {
    return {
      count: prev.count + 1,
      consecutive_hesitate: 0,
      accumulated: prev.accumulated + 1,
      last_suppress: timestamp,
    };
  }
  if (decision === 'hesitate') {
    return {
      ...prev,
      consecutive_hesitate: prev.consecutive_hesitate + 1,
    };
  }
  // reply — reset consecutive hesitate
  return { ...prev, consecutive_hesitate: 0 };
}

function makeDegradedSystem1Output(): System1Output {
  return {
    event_classification: { type: 'user_message', importance: 0.3 },
    emotional_interpretation: {},
    cognitive_projection: '',
    wi_expansion: [],
    impulse_narrative: '',
    memory_consolidation: { should_save: false, summary: '' },
  };
}
