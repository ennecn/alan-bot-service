/**
 * AlanEngine — Initializes all components and provides a single run() entry point.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { AlanConfig } from '../types/actions.js';
import type { CoordinatorEvent, ActionList } from '../coordinator/types.js';
import { Pipeline } from '../coordinator/pipeline.js';
import { ActionDispatcher } from '../action/dispatcher.js';
import { DeliveryAdapter } from '../action/adapters/delivery.js';
import { MemoryAdapter } from '../action/adapters/memory.js';
import { EventBusAdapter } from '../action/adapters/event-bus.js';
import { initDatabase } from '../storage/database.js';
import { ChatHistoryStore } from '../storage/chat-history.js';
import { WIStore } from '../storage/wi-store.js';
import { EmotionStateStore } from '../storage/emotion-state.js';
import { MetricsWriter } from '../storage/metrics.js';
import { makeEmotionState } from '../emotion/calculator.js';
import type { CardData } from '../card-import/mapper.js';

export class AlanEngine {
  readonly pipeline: Pipeline;
  readonly dispatcher: ActionDispatcher;
  readonly emotionStore: EmotionStateStore;
  readonly metricsWriter: MetricsWriter;
  readonly chatHistory: ChatHistoryStore;
  readonly wiStore: WIStore;
  private coldStartDone = false;

  constructor(readonly config: AlanConfig) {
    // Ensure workspace internal dir exists
    fs.mkdirSync(path.join(config.workspace_path, 'internal'), { recursive: true });

    // Storage
    const db = initDatabase(config.workspace_path);
    this.chatHistory = new ChatHistoryStore(db);
    this.wiStore = new WIStore(db);
    this.emotionStore = new EmotionStateStore();
    this.metricsWriter = new MetricsWriter(config.workspace_path);

    // Coordinator
    this.pipeline = new Pipeline(config, this.wiStore, this.chatHistory);

    // Action Dispatcher
    this.dispatcher = new ActionDispatcher(config.workspace_path);
    this.dispatcher.registerAdapter(new DeliveryAdapter());
    this.dispatcher.registerAdapter(new MemoryAdapter(config.workspace_path, this.pipeline.memoryQueue));
    this.dispatcher.registerAdapter(new EventBusAdapter(config.event_bus_url, config.agent_id));

    console.log(`[alan-engine] initialized for agent "${config.agent_id}" at ${config.workspace_path}`);
  }

  async run(event: CoordinatorEvent): Promise<ActionList> {
    // Cold start detection
    if (!this.coldStartDone) {
      this.detectColdStart();
      this.coldStartDone = true;
    }

    // Run coordinator pipeline
    const result = await this.pipeline.run(event);

    // Dispatch actions
    await this.dispatcher.dispatch(result.actions);

    // Write chat history
    const sessionId = this.chatHistory.getOrCreateSession(
      result.emotion.last_interaction,
      this.config.session_timeout_hours,
    );
    this.chatHistory.write(sessionId, 'user', event.content);
    if (result.reply) {
      this.chatHistory.write(sessionId, 'assistant', result.reply);
    }

    return result;
  }

  private detectColdStart(): void {
    const ws = this.config.workspace_path;

    // 1. Read card-data.json for character info
    const cardDataPath = path.join(ws, 'internal', 'card-data.json');
    let cardData: CardData | null = null;
    if (fs.existsSync(cardDataPath)) {
      try {
        cardData = JSON.parse(fs.readFileSync(cardDataPath, 'utf-8')) as CardData;
      } catch {
        console.warn('[alan-engine] Failed to parse card-data.json');
      }
    }

    // 2. Check IDENTITY.md
    const identityPath = path.join(ws, 'IDENTITY.md');
    const identityExists = fs.existsSync(identityPath);
    if (!identityExists) {
      console.warn('[alan-engine] WARNING: IDENTITY.md not found — character identity is undefined');
    }

    // 3. Initialize emotion_state.md if missing
    const emotionPath = path.join(ws, 'emotion_state.md');
    let emotionInitialized = false;
    if (!fs.existsSync(emotionPath)) {
      const now = new Date().toISOString();
      const defaultState = makeEmotionState(0.5);
      this.emotionStore.write(ws, {
        current: defaultState,
        baseline: defaultState,
        suppression: { count: 0, consecutive_hesitate: 0, accumulated: 0, last_suppress: null },
        last_interaction: now,
        session_start: now,
      });
      emotionInitialized = true;
    }

    // 4. Write initial IMPULSE.md if missing
    const impulsePath = path.join(ws, 'IMPULSE.md');
    if (!fs.existsSync(impulsePath)) {
      fs.writeFileSync(
        impulsePath,
        '# Impulse\n\nvalue: 0.300\nfired: false\ndecision: suppress\nnarrative: Engine cold start.\n',
        'utf-8',
      );
    }

    // 5. WI entry count
    const wiCount = this.wiStore.getAllEntries().length;

    // 6. Comprehensive cold start log
    console.log(
      '[alan-engine] Cold start status:\n' +
      `  character: ${cardData?.character_name ?? '(unknown)'}\n` +
      `  language: ${cardData?.detected_language ?? this.config.character_language}\n` +
      `  workspace: ${ws}\n` +
      `  IDENTITY.md: ${identityExists ? 'OK' : 'MISSING'}\n` +
      `  emotion_state: ${emotionInitialized ? 'initialized (defaults)' : 'loaded'}\n` +
      `  WI entries: ${wiCount}`,
    );
  }
}
