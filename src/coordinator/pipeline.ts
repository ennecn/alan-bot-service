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
import { narrativize, writeDirective } from '../emotion/narrativizer.js';
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
import { assemble, SAMPLING_PRESETS } from './prompt-assembler.js';
import type { CardData } from '../card-import/mapper.js';
import type { AlanPreset } from '../preset-import/types.js';
import { expandMacros } from '../preset-import/macros.js';
import { getGuardText } from '../quality/guards.js';
import { getBannedWordText } from '../quality/banned-words.js';
import { scanForBannedWords, sanitizeS1Output } from '../quality/post-processor.js';

export class Pipeline {
  private mutex = new Mutex();
  private s2Queue = new S2Queue();
  readonly memoryQueue = new MemoryQueue();
  private emotionStore = new EmotionStateStore();
  private metricsWriter: MetricsWriter;
  private cardDataCache: { data: CardData | null; loaded: boolean } = { data: null, loaded: false };
  private presetCache: { data: AlanPreset | null; loaded: boolean } = { data: null, loaded: false };

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

  private loadPreset(): AlanPreset | null {
    if (this.presetCache.loaded) return this.presetCache.data;
    const presetPath = path.join(this.config.workspace_path, 'internal', 'preset.json');
    try {
      const raw = fs.readFileSync(presetPath, 'utf-8');
      this.presetCache = { data: JSON.parse(raw) as AlanPreset, loaded: true };
    } catch {
      this.presetCache = { data: null, loaded: true };
    }
    return this.presetCache.data;
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

    // Phase 1: Sanitize S1 impulse_narrative — replace absolute-ban words with [...]
    const s1Sanitized = sanitizeS1Output(
      system1Output.impulse_narrative,
      this.config.character_language,
    );
    if (s1Sanitized.replaced) {
      system1Output.impulse_narrative = s1Sanitized.sanitized;
    }

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

    // (h2) Writing directive from emotion state (PRD §2.1.5)
    const directiveResult = writeDirective({
      state: emotionAfter,
      language: this.config.character_language,
      suppressionCount: emotionBefore.suppression.count,
      lastSuppressTime: emotionBefore.suppression.last_suppress,
      directiveHistory: emotionBefore.directive_history,
      sessionTimeoutHours: this.config.session_timeout_hours,
    });

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

    // Update emotion snapshot (with directive_history tracking — PRD §2.1.5)
    const prevHistory = emotionBefore.directive_history ?? [];
    const newDirectiveHistory = [...prevHistory, directiveResult.patternId].slice(-3);
    const newSnapshot: EmotionSnapshot = {
      current: emotionAfter,
      baseline: emotionBefore.baseline,
      suppression: updateSuppression(emotionBefore.suppression, decision, event.timestamp),
      last_interaction: event.timestamp,
      session_start: emotionBefore.session_start,
      directive_history: newDirectiveHistory,
      banned_word_streak: emotionBefore.banned_word_streak ?? {},
    };

    // Write IMPULSE.md immediately (doesn't depend on S2 outcome)
    const newImpulseMd = `# Impulse\n\nvalue: ${impulse.value.toFixed(3)}\nfired: ${impulse.fired}\ndecision: ${decision}\nnarrative: ${system1Output.impulse_narrative}\n`;
    await this.memoryQueue.enqueue(async () => {
      fs.writeFileSync(impulseMdPath, newImpulseMd, 'utf-8');
    });
    // emotion_state.md is written after S2 (post-processor may update banned_word_streak)

    // (l) Branch on decision
    let reply: string | undefined;
    let s2Ms: number | null = null;
    let s2Usage: { input_tokens: number; output_tokens: number } | null = null;
    let s2StreamChunks: import('./system2/types.js').System2StreamChunk[] = [];
    let s2BannedWordHits = 0;
    let s2BannedWordsFound: string[] = [];

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
      const preset = this.loadPreset();

      const charName = cardData?.character_name ?? '';
      const userName = (event.metadata?.user_name as string) ?? 'User';

      // Resolve output style: card-data > config > default
      const resolvedOutputStyle = cardData?.output_style ?? this.config.output_style ?? 'default';

      // Phase 1: Guard text and banned word text for L1 injection
      const guardResult = resolvedOutputStyle !== 'casual'
        ? getGuardText(this.config.character_language, this.config.disabled_guards)
        : null;
      const bannedWordText = resolvedOutputStyle !== 'casual'
        ? getBannedWordText(this.config.character_language)
        : undefined;

      // Phase 2: Reinforcement from previous turn's post-processor streak
      const prevStreak = emotionBefore.banned_word_streak ?? {};
      // Reinforcement is carried forward — we don't scan yet (scan happens after S2 reply)
      // Check if any word hit streak threshold from previous scans
      const prevReinforcements: string[] = [];
      for (const [word, count] of Object.entries(prevStreak)) {
        if (count >= 3) {
          const templates: Record<string, (w: string, c: number) => string> = {
            zh: (w, c) => `注意：你已连续${c}次使用「${w}」。此表达被禁止。请使用具体的感官描写代替。`,
            en: (w, c) => `CRITICAL: You have used '${w}' in ${c} consecutive replies. This expression is banned. Use concrete sensory details instead.`,
            ja: (w, c) => `注意：「${w}」を${c}回連続使用しています。この表現は禁止です。具体的な感覚描写を使ってください。`,
          };
          const tmpl = templates[this.config.character_language] ?? templates.en;
          prevReinforcements.push(tmpl(word, count));
        }
      }
      const reinforcement = prevReinforcements.length > 0
        ? prevReinforcements.join('\n')
        : undefined;

      const assembled = assemble({
        systemPrompt: cardData?.system_prompt ?? '',
        soulMd,
        mesExample: cardData?.mes_example ?? '',
        constantWI: [],
        impulseMd: newImpulseMd,
        emotionNarrative,
        activatedWI,
        chatHistory: (() => {
          const history = this.chatHistory
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
            : [];
          // Append current user message — it hasn't been written to the store yet
          history.push({ role: 'user', content: event.content });
          return history;
        })(),
        postHistoryInstructions: cardData?.post_history_instructions ?? '',
        presetSystemPrefix: preset?.system_prefix
          ? expandMacros(preset.system_prefix, charName, userName) : undefined,
        presetPostHistory: preset?.post_history
          ? expandMacros(preset.post_history, charName, userName) : undefined,
        depthInjections: preset?.depth_injections?.map(d => ({
          ...d, content: expandMacros(d.content, charName, userName),
        })),
        assistantPrefill: preset?.assistant_prefill
          ? expandMacros(preset.assistant_prefill, charName, userName) : undefined,
        maxContextTokens: preset?.max_context_tokens,
        writingDirective: directiveResult.directive,
        outputStyle: resolvedOutputStyle,
        language: this.config.character_language,
        guardText: guardResult?.text,
        bannedWordText,
        reinforcement,
      });

      // Phase 2: Resolve sampling preset (config preset → lookup, merged with card preset)
      const presetSampler = preset?.sampler;
      const configSampler = this.config.sampling_preset
        ? SAMPLING_PRESETS[this.config.sampling_preset]
        : undefined;
      // Card preset sampler takes priority over config sampling_preset
      const resolvedSampler = presetSampler ?? configSampler;

      // System 2 call via serial queue
      const s2Config: System2Config = {
        baseUrl: this.config.system2_base_url,
        model: this.config.system2_model,
        apiKey: this.config.s2_api_key,
        maxTokens: preset?.max_output_tokens ?? this.config.s2_max_tokens,
        sampler: resolvedSampler,
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

      // Phase 2: Post-processor — scan S2 output for banned words, update streak
      if (reply && resolvedOutputStyle !== 'casual') {
        const postResult = scanForBannedWords(
          reply,
          this.config.character_language,
          newSnapshot.banned_word_streak ?? {},
        );
        newSnapshot.banned_word_streak = postResult.updatedStreak;
        // Store scan results for metrics
        s2BannedWordHits = postResult.hitCount;
        s2BannedWordsFound = postResult.wordsFound;
      }
    }

    // Write emotion_state.md after S2 (post-processor may have updated banned_word_streak)
    await this.memoryQueue.enqueue(async () => {
      this.emotionStore.write(this.config.workspace_path, newSnapshot);
    });

    // (m) Write metrics (including Phase 1+2 quality fields)
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
      write_directive: directiveResult.directive,
      write_directive_pattern: directiveResult.patternId,
      output_style: decision === 'reply'
        ? (this.loadCardData()?.output_style ?? this.config.output_style ?? 'default')
        : undefined,
      banned_word_hits: s2BannedWordHits > 0 ? s2BannedWordHits : undefined,
      banned_words_found: s2BannedWordsFound.length > 0 ? s2BannedWordsFound : undefined,
      s1_banned_word_sanitized: s1Sanitized.replaced || undefined,
      write_directive_debug: directiveResult.debug,
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
