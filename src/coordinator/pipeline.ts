/**
 * Coordinator Pipeline — Central orchestrator of the Alan Engine.
 * PRD v6.0 §3.3
 *
 * System 1 call with degradation, real System 2 streaming LLM call.
 * All deterministic steps (emotion, impulse, decision, WI, prompt assembly) are real.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { EmotionDimension, EmotionSnapshot, MemoryPools, System1Output } from '../types/index.js';
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
import { resolveDeliveryMode } from '../action/adapters/delivery-modes.js';

interface CustomEmotionDef {
  baseline: number;
  range: [number, number];
  projection?: Partial<Record<EmotionDimension, number>>;
}

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

  /**
   * Invalidate preset cache so the next request reloads workspace/internal/preset.json.
   * Used by preset admin routes after upload/activate.
   */
  invalidatePresetCache(): void {
    this.presetCache = { data: null, loaded: false };
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
    const cardData = this.loadCardData();
    const customDefs = getCustomEmotionDefs(cardData);
    const customStateBefore = getCustomEmotionState(emotionBefore, customDefs);

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
        customEmotions: Object.entries(customDefs).map(([name, cfg]) => ({
          name,
          current: customStateBefore[name],
          baseline: cfg.baseline,
          range: cfg.range,
        })),
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

    const customDeltas = sanitizeCustomDeltas(system1Output.custom_deltas, customDefs);
    const customStateAfter = updateCustomEmotionState(
      customStateBefore,
      customDefs,
      customDeltas,
      elapsedHours,
    );
    const projectedCustomDeltas = projectCustomToCoreDeltas(
      customStateBefore,
      customStateAfter,
      customDefs,
    );
    const effectiveEmotionDeltas = mergeEmotionDeltas(
      system1Output.emotional_interpretation,
      projectedCustomDeltas,
    );

    // (g) Deterministic emotion calculation
    const emotionAfter = updateEmotion(
      emotionBefore.current,
      emotionBefore.baseline,
      makeDefaultHalfLife(),
      elapsedHours,
      effectiveEmotionDeltas,
    );

    // Slow-memory pools (attachment/stress) — long-horizon affect accumulators.
    const poolsBefore = getMemoryPools(emotionBefore);
    const poolsAfter = updateMemoryPools(
      poolsBefore,
      effectiveEmotionDeltas,
      elapsedHours,
      event.trigger,
      emotionBefore.suppression.accumulated,
    );
    const memoryPressure = computeMemoryPressure(poolsAfter);

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

    // Social actions from S1
    const socialActions: import('../types/actions.js').Action[] = [];
    if (system1Output.social_actions) {
      const sa = system1Output.social_actions;
      if (sa.should_post && sa.post_content) {
        socialActions.push({
          type: 'post_moment',
          content: sa.post_content,
          mood: sa.post_mood ?? 'neutral',
        });
      }
      if (sa.should_react && sa.react_target) {
        if (sa.react_type === 'comment' && sa.react_content) {
          socialActions.push({
            type: 'comment',
            target: sa.react_target,
            content: sa.react_content,
          });
        } else {
          socialActions.push({
            type: 'like',
            target: sa.react_target,
          });
        }
      }
    }

    // (j) Impulse calculation
    const impulse = calculateImpulse({
      emotionDeltas: effectiveEmotionDeltas,
      suppressionCount: emotionBefore.suppression.count,
      memoryPressure,
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
      memory_pools: poolsAfter,
      custom_state: customStateAfter,
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

      // Fetch social context if event bus is configured
      let socialContext: string | undefined;
      if (this.config.event_bus_url) {
        try {
          const res = await fetch(
            `${this.config.event_bus_url}/posts?agent_id=${this.config.agent_id}&limit=5`,
          );
          if (res.ok) {
            const posts = (await res.json()) as Array<{ agent_id: string; content: string; mood: string; created_at: string }>;
            if (posts.length > 0) {
              socialContext = '## Recent Social Activity\n' +
                posts.map(p => `- ${p.agent_id} (${p.mood}): ${p.content}`).join('\n');
            }
          }
        } catch {
          // Silent — social layer may be unavailable
        }
      }

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
        socialContext,
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
      emotion_delta: effectiveEmotionDeltas,
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
      ? [{ type: 'reply' as const, content: reply, delivery_mode: resolveDeliveryMode(emotionAfter) }, ...memoryActions, ...socialActions]
      : [{ type: decision as 'hesitate' | 'suppress' }, ...memoryActions, ...socialActions];

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
    memory_pools: { attachment_pool: 0, stress_pool: 0 },
    custom_state: {},
    last_interaction: now,
    session_start: now,
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function getMemoryPools(snapshot: EmotionSnapshot): MemoryPools {
  const pools = snapshot.memory_pools;
  if (!pools) {
    return { attachment_pool: 0, stress_pool: 0 };
  }
  return {
    attachment_pool: clamp01(pools.attachment_pool),
    stress_pool: clamp01(pools.stress_pool),
  };
}

function updateMemoryPools(
  prev: MemoryPools,
  emotionDeltas: Partial<Record<EmotionDimension, number>>,
  elapsedHours: number,
  trigger: import('../types/actions.js').TriggerType,
  suppressionAccumulated: number,
): MemoryPools {
  const attachmentHalfLife = 72; // hours
  const stressHalfLife = 48; // hours

  const attachmentDecayed = prev.attachment_pool * Math.exp(-elapsedHours / attachmentHalfLife);
  const stressDecayed = prev.stress_pool * Math.exp(-elapsedHours / stressHalfLife);

  const relationalBoost = (trigger === 'user_message' || trigger === 'direct_message') ? 0.03 : 0;

  const dTrust = emotionDeltas.trust ?? 0;
  const dLonging = emotionDeltas.longing ?? 0;
  const dJoy = emotionDeltas.joy ?? 0;
  const dAnxiety = emotionDeltas.anxiety ?? 0;
  const dAnger = emotionDeltas.anger ?? 0;
  const dSadness = emotionDeltas.sadness ?? 0;

  const attachmentDeltaRaw = dTrust * 0.25 + dLonging * 0.2 + dJoy * 0.1 + relationalBoost;
  const stressDeltaRaw = dAnxiety * 0.3 + dAnger * 0.25 + dSadness * 0.2 - dJoy * 0.1;
  const suppressionCarry = Math.min(0.05, suppressionAccumulated * 0.01);

  const attachmentDelta = Math.max(-0.05, Math.min(0.08, attachmentDeltaRaw));
  const stressDelta = Math.max(-0.08, Math.min(0.1, stressDeltaRaw + suppressionCarry));

  return {
    attachment_pool: clamp01(attachmentDecayed + attachmentDelta),
    stress_pool: clamp01(stressDecayed + stressDelta),
  };
}

function computeMemoryPressure(pools: MemoryPools): number {
  // Keep pressure small so it nudges behavior without overriding core impulse signals.
  const pressure = pools.attachment_pool * 0.08 + pools.stress_pool * 0.22;
  return Math.min(0.25, Math.max(0, pressure));
}

function getCustomEmotionDefs(cardData: CardData | null): Record<string, CustomEmotionDef> {
  const raw = cardData?.behavioral_engine?.custom_emotions;
  if (!raw) return {};
  const defs: Record<string, CustomEmotionDef> = {};

  for (const [name, cfg] of Object.entries(raw)) {
    if (!cfg || !Array.isArray(cfg.range) || cfg.range.length !== 2) continue;
    if (name.length === 0 || name.length > 64) continue;
    const min = Number(cfg.range[0]);
    const max = Number(cfg.range[1]);
    const baseline = Number(cfg.baseline);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(baseline)) continue;
    if (min >= max) continue;
    const projection = parseProjection(cfg.projection);
    const clampedBaseline = Math.min(max, Math.max(min, baseline));
    defs[name] = {
      baseline: clampedBaseline,
      range: [min, max],
      projection,
    };
  }

  return defs;
}

function getCustomEmotionState(
  snapshot: EmotionSnapshot,
  defs: Record<string, CustomEmotionDef>,
): Record<string, number> {
  const state: Record<string, number> = {};
  const prev = snapshot.custom_state ?? {};
  for (const [name, def] of Object.entries(defs)) {
    const value = typeof prev[name] === 'number' ? prev[name] : def.baseline;
    state[name] = clampRange(value, def.range);
  }
  return state;
}

function sanitizeCustomDeltas(
  raw: Record<string, number> | undefined,
  defs: Record<string, CustomEmotionDef>,
): Record<string, number> {
  if (!raw) return {};
  const clean: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!defs[key]) continue;
    if (!Number.isFinite(value)) continue;
    clean[key] = Math.min(0.3, Math.max(-0.3, value));
  }
  return clean;
}

function updateCustomEmotionState(
  prev: Record<string, number>,
  defs: Record<string, CustomEmotionDef>,
  deltas: Record<string, number>,
  elapsedHours: number,
): Record<string, number> {
  const next: Record<string, number> = {};
  const halfLifeHours = 12;
  const decayRate = Math.max(0, elapsedHours) / halfLifeHours;
  const decay = Math.exp(-decayRate);

  for (const [name, def] of Object.entries(defs)) {
    const current = prev[name] ?? def.baseline;
    const towardBaseline = def.baseline + (current - def.baseline) * decay;
    const span = Math.max(0.0001, def.range[1] - def.range[0]);
    const appliedDelta = (deltas[name] ?? 0) * span * 0.35;
    next[name] = clampRange(towardBaseline + appliedDelta, def.range);
  }

  return next;
}

function projectCustomToCoreDeltas(
  before: Record<string, number>,
  after: Record<string, number>,
  defs: Record<string, CustomEmotionDef>,
): Partial<Record<EmotionDimension, number>> {
  const projected: Partial<Record<EmotionDimension, number>> = {};

  for (const [name, def] of Object.entries(defs)) {
    const span = Math.max(0.0001, def.range[1] - def.range[0]);
    const normalizedShift = ((after[name] ?? def.baseline) - (before[name] ?? def.baseline)) / span;
    if (Math.abs(normalizedShift) < 0.0001) continue;
    const profile = def.projection ?? inferProjectionProfile(name);
    for (const [dim, weight] of Object.entries(profile) as Array<[EmotionDimension, number]>) {
      projected[dim] = (projected[dim] ?? 0) + normalizedShift * weight;
    }
  }

  for (const dim of Object.keys(projected) as EmotionDimension[]) {
    projected[dim] = Math.min(0.15, Math.max(-0.15, projected[dim] ?? 0));
  }
  return projected;
}

function inferProjectionProfile(name: string): Record<EmotionDimension, number> {
  const n = name.toLowerCase();

  if (/(anger|rage|hate|resent|furious)/.test(n)) {
    return { anger: 0.6, anxiety: 0.2, joy: -0.2, sadness: 0.1, longing: 0, trust: -0.1 };
  }
  if (/(fear|anx|panic|worry)/.test(n)) {
    return { anxiety: 0.65, sadness: 0.15, joy: -0.2, anger: 0.05, longing: 0, trust: -0.05 };
  }
  if (/(sad|grief|lonely|loss|depress)/.test(n)) {
    return { sadness: 0.6, anxiety: 0.15, joy: -0.2, longing: 0.1, trust: -0.05, anger: 0 };
  }
  if (/(love|crush|attach|miss|yearn|long)/.test(n)) {
    return { longing: 0.45, trust: 0.3, joy: 0.2, sadness: -0.05, anxiety: -0.05, anger: 0 };
  }
  if (/(joy|happy|excite|kitty|cute|comfort|safe)/.test(n)) {
    return { joy: 0.55, trust: 0.25, anxiety: -0.1, sadness: -0.05, longing: 0.05, anger: 0 };
  }

  return { joy: 0.25, trust: 0.15, sadness: -0.1, anxiety: -0.1, longing: 0.05, anger: 0 };
}

function parseProjection(
  projection: Partial<Record<EmotionDimension, number>> | undefined,
): Partial<Record<EmotionDimension, number>> | undefined {
  if (!projection) return undefined;

  const dims: EmotionDimension[] = ['joy', 'sadness', 'anger', 'anxiety', 'longing', 'trust'];
  const parsed: Partial<Record<EmotionDimension, number>> = {};
  let absSum = 0;

  for (const dim of dims) {
    const raw = projection[dim];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const clamped = Math.min(1, Math.max(-1, raw));
    if (Math.abs(clamped) < 0.001) continue;
    parsed[dim] = clamped;
    absSum += Math.abs(clamped);
  }

  if (absSum <= 0.001) return undefined;
  if (absSum <= 1) return parsed;

  const normalized: Partial<Record<EmotionDimension, number>> = {};
  for (const [dim, value] of Object.entries(parsed) as Array<[EmotionDimension, number]>) {
    normalized[dim] = value / absSum;
  }
  return normalized;
}

function mergeEmotionDeltas(
  base: Partial<Record<EmotionDimension, number>>,
  projection: Partial<Record<EmotionDimension, number>>,
): Partial<Record<EmotionDimension, number>> {
  const merged: Partial<Record<EmotionDimension, number>> = {};
  const dims: EmotionDimension[] = ['joy', 'sadness', 'anger', 'anxiety', 'longing', 'trust'];
  for (const dim of dims) {
    const value = (base[dim] ?? 0) + (projection[dim] ?? 0);
    if (Math.abs(value) < 0.0001) continue;
    merged[dim] = Math.min(0.3, Math.max(-0.3, value));
  }
  return merged;
}

function clampRange(value: number, range: [number, number]): number {
  return Math.min(range[1], Math.max(range[0], value));
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
