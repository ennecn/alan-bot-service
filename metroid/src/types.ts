// === Memory Types ===

export type MemoryType = 'working' | 'stm' | 'semantic' | 'episodic' | 'procedural';
export type PrivacyLevel = 'public' | 'private' | 'sensitive';
export type AgentMode = 'classic' | 'enhanced';

export interface Memory {
  id: string;
  agentId: string;
  type: MemoryType;
  content: string;
  summary?: string;
  importance: number;       // 0.0 - 1.0
  confidence: number;       // 0.0 - 1.0
  privacy: PrivacyLevel;
  emotionContext?: EmotionState;
  keywords: string[];
  sourceMessageId?: string;
  recallCount: number;
  createdAt: Date;
  lastRecalledAt?: Date;
  fadedAt?: Date;           // null = active
}

export interface MemoryQuery {
  agentId: string;
  text: string;             // user query text for keyword extraction
  limit?: number;           // default 5
  includesFaded?: boolean;  // default false
  privacyFilter?: PrivacyLevel[];
  timeWindowHours?: number; // restrict to recent N hours
}

export interface MemoryScore {
  memory: Memory;
  score: number;            // final composite score
  matchReason: string;      // why this memory was retrieved
}

// === Emotion Types ===

export interface EmotionState {
  pleasure: number;         // -1.0 ~ +1.0
  arousal: number;          // -1.0 ~ +1.0
  dominance: number;        // -1.0 ~ +1.0
}

export interface EmotionUpdate {
  delta: EmotionState;
  source: string;           // 'conversation' | 'recovery' | 'manual'
  timestamp: Date;
}

// === Growth Types ===

export interface BehavioralChange {
  id: string;
  agentId: string;
  observation: string;
  adaptation: string;
  confidence: number;       // 0.0 - 1.0
  active: boolean;
  createdAt: Date;
  revertedAt?: Date;
}

// === Identity Types ===

export interface AgentIdentity {
  id: string;
  name: string;
  card: MetroidCard;
  emotionState: EmotionState;
  mode: AgentMode;
  createdAt: Date;
  updatedAt: Date;
}

export type RpMode = 'off' | 'sfw' | 'nsfw';

export interface MetroidCard {
  // ST V2 compatible
  name: string;
  description: string;
  personality: string;
  firstMes?: string;
  mesExample?: string;
  scenario?: string;
  creatorNotes?: string;

  // Metroid extensions
  rpMode?: RpMode;  // RP instruction level: off=no RP, sfw=RP without explicit, nsfw=full RP
  soul?: {
    immutableValues: string[];
    mutableTraits: Array<{ trait: string; intensity: number }>;
  };
  emotion?: {
    baseline: EmotionState;
    intensityDial: number;    // 0-1, sensitivity: how much events affect emotions
    resilience?: number;      // 0-1, how fast emotions recover (0=brooding, 1=bouncy)
    expressiveness?: number;  // 0-1, how easily impulse converts to action
    restraint?: number;       // 0-1, self-control (0=impulsive, 1=restrained)
    moodInertia?: number;              // 0-1, long-term mood inertia (default 0.9)
    longTermDimensions?: string[];     // tracked long-term dimensions (default ['attachment','trust'])
    eventSensitivity?: Record<string, number>; // event name → intensity multiplier (default 1.0)
  };
  memoryStyle?: {
    encodingRate: number;
    forgettingCurve: 'slow' | 'normal' | 'fast';
    nostalgiaTendency: number;
  };
  growth?: {
    enabled: boolean;
    maxDrift: number;
    logChanges: boolean;
  };
  proactive?: {
    enabled: boolean;
    triggers: ProactiveTrigger[];
    impulse?: ImpulseConfig;
  };
  behavioral?: {
    stateOverrides?: Partial<Record<BehavioralState, {
      emotionalTone?: string;
      replyProbabilityMod?: number;   // -0.5 ~ +0.5
      delayMod?: number;              // 0.5 ~ 3.0
      preferredPattern?: MessagePattern;
    }>>;
    neverDo?: string[];
    alwaysDo?: string[];
  };
  // V6: Relationship-aware inner life
  relationship?: {
    attachmentEffect?: {
      decayRateMultiplier?: number;     // how attachment affects event decay (default: 0.5 per +1 attachment)
      thresholdShift?: number;          // how attachment shifts state thresholds (default: 0.1 per +1 attachment)
      toleranceBonus?: number;          // extra ignores tolerated per +1 attachment (default: 2)
    };
    relationshipVolatility?: number;    // how quickly relationship values change (0=glacial, 1=volatile, default 0.3)
  };
}

// === V5: Behavioral Envelope Types ===

export type BehavioralState = 'clingy' | 'normal' | 'hesitant' | 'withdrawn' | 'cold_war';
export type ResponseMode = 'eager' | 'normal' | 'reluctant' | 'silent';
export type MessagePattern = 'single' | 'burst' | 'fragmented' | 'minimal';

export interface BehavioralEnvelope {
  state: BehavioralState;
  responseMode: ResponseMode;
  messagePattern: MessagePattern;
  replyProbability: number;       // 0-1
  delayRange: [number, number];   // [min, max] ms
  maxMessages: number;            // 1-4
  emotionalTone: string;          // natural language, injected into prompt
  suppressFollowUp: boolean;
}

export interface MessagePlan {
  messages: Array<{ text: string; delayMs: number }>;
  envelope: BehavioralEnvelope;
}

// === Proactive Types ===

export type ProactiveTriggerType = 'cron' | 'idle' | 'emotion' | 'event';

export interface ProactiveTrigger {
  type: ProactiveTriggerType;
  /**
   * Condition string per trigger type:
   *   cron:    "HH:MM" daily schedule
   *   idle:    minutes of user silence (e.g. "3")
   *   emotion: one of three formats:
   *     delta:axis<threshold/windowMin     — rate of change (e.g. "delta:pleasure<-0.3/30m")
   *     sustained:axis<threshold/windowMin — held for duration (e.g. "sustained:pleasure<-0.3/20m")
   *     axis<threshold                     — legacy instant check (discouraged)
   *   event:   event name (e.g. "birthday")
   */
  condition: string;
  /** prompt hint injected when trigger fires (e.g. "发一条早安问候") */
  prompt: string;
  /** optional cooldown in minutes between firings (default 60) */
  cooldownMinutes?: number;
}

export interface ProactiveMessage {
  id: string;
  agentId: string;
  triggerId: string;
  triggerType: ProactiveTriggerType;
  content: string;
  delivered: boolean;
  deliveredAt?: Date;          // V3: when the message was delivered
  delayMs?: number;            // V5: delay before delivering this message
  monologue?: string;          // V6: inner thought that accompanied this message
  createdAt: Date;
}

// === Impulse Accumulator Types ===

export interface ImpulseConfig {
  enabled: boolean;
  signals: ImpulseSignal[];
  decayRate?: number;          // per-hour natural decay (default 0.1)
  fireThreshold?: number;      // base threshold to fire (default 0.6)
  cooldownMinutes?: number;    // min time between firings (default 30)
  promptTemplate: string;      // LLM prompt when impulse fires
  memoryBreachThreshold?: number;    // pressure level to trigger breach (default 0.7)
  memoryPressureDecayRate?: number;  // per-hour passive decay (default 0.02)
  sparkPool?: string[];              // thematic keywords (e.g., ['月亮','远方','咖啡'])
  sparkProbability?: number;         // per-tick base probability (default 0.08)
  sparkResonanceThreshold?: number;  // min resonance to inject event (default 0.4)
}

export interface ImpulseSignal {
  type: 'emotion_pattern' | 'idle' | 'time_of_day' | 'emotion_pressure' | 'memory_breach';
  weight: number;              // 0-1, contribution weight
  emotionCondition?: EmotionPattern;
  idleMinutes?: number;
  timeRange?: { start: string; end: string }; // "HH:MM"
}

export interface EmotionPattern {
  /** Multi-axis conditions — ALL must be satisfied */
  conditions: Array<{
    axis: 'pleasure' | 'arousal' | 'dominance';
    op: '<' | '>';
    value: number;
  }>;
  /** Require sustained for N minutes */
  sustainedMinutes?: number;
}

export interface ImpulseState {
  value: number;               // 0-1, current impulse level
  lastDecayTime: number;       // timestamp
  lastFireTime: number;        // timestamp
  activeEvents: ActiveEvent[];
  suppressionCount: number;    // consecutive suppressions
  memoryPressure: number;      // V4: accumulated emotional pressure (0-2)
  lastMemoryPressureTime: number; // V4: timestamp for pressure computation
  awaitingResponse: boolean;   // V4: waiting for user reply to proactive msg
  awaitingMessageId?: string;  // V4: the proactive message ID we're waiting on
  inbox: Array<{               // V5: incoming messages pending scheduler
    messageId: string;
    content: string;
    receivedAt: number;
    processed: boolean;
  }>;
  conversationTempo: number;   // V6: EMA of user reply speed in ms (0 = no data)
}

export interface ActiveEvent {
  name: string;
  intensity: number;           // 0-1
  relevance: number;           // 0-1, event-character relevance (default 0.8)
  confidence: number;          // 0-1, detection confidence (V3, default 1.0 for manual/regex)
  createdAt: number;           // timestamp
  decayRate: number;           // per-hour decay (default 0.5)
}

// === V6: Relationship & Inner Life Types ===

export interface UserRelationship {
  agentId: string;
  userId: string;
  attachment: number;      // -1 ~ +1, emotional bond strength
  trust: number;           // -1 ~ +1, reliability/safety perception
  familiarity: number;     // 0 ~ 1, how well agent knows this user
  lastInteraction: number; // timestamp
  updatedAt: number;       // timestamp
}

export interface InnerMonologue {
  id: string;
  agentId: string;
  userId?: string;         // which user triggered this thought (null = ambient)
  trigger: MonologueTrigger;
  content: string;         // the inner thought (~20-50 tokens)
  emotionSnapshot: EmotionState;
  createdAt: number;
}

export type MonologueTrigger =
  | 'state_change'        // behavioral state transition
  | 'message_received'    // user sent a message
  | 'message_suppressed'  // wanted to reply but didn't (unsent_draft)
  | 'event_detected'      // significant conversation event
  | 'ambient';            // low-frequency background thought

export interface UnsentDraft {
  id: string;
  agentId: string;
  userId: string;
  content: string;         // what the agent wanted to say
  reason: string;          // why it was suppressed (e.g., "cold_war", "hesitant")
  behavioralState: BehavioralState;
  createdAt: number;
  consumedAt?: number;     // when it was used as context in a future message
}

// === Prompt Compiler Types ===

export type STPosition = 'before_char' | 'after_char' | 'before_an' | 'after_an' | 'at_depth';

export interface PromptFragment {
  source: string;           // "memory" | "world" | "emotion" | "identity" | "tool"
  content: string;
  priority: number;         // 0-100, higher = more important
  tokens: number;           // estimated token count
  required: boolean;        // true = must include

  // ST-compatible fields (used in classic mode)
  position?: STPosition;    // where to place in ST-style assembly
  depth?: number;           // for position='at_depth'
}

// === Channel Types ===

export type ChannelType = 'telegram' | 'discord' | 'web-im';

export interface MetroidMessage {
  id: string;
  channel: ChannelType;
  author: {
    id: string;
    name: string;
    isBot: boolean;
  };
  content: string;
  attachments?: Array<{ type: string; url: string }>;
  replyTo?: string;
  mentions?: string[];
  timestamp: number;
}

// === Audit Types ===

export interface AuditEntry {
  id?: number;
  timestamp: Date;
  actor: string;            // 'agent:alin', 'user:xxx', 'system'
  action: string;           // 'memory.create', 'emotion.update', etc.
  target?: string;
  details?: Record<string, unknown>;
  approvedBy?: string;
}

// === Engine Interface ===

export interface Engine {
  name: string;
  getPromptFragments(context: EngineContext): Promise<PromptFragment[]>;
  onResponse?(response: string, context: EngineContext): Promise<void>;
  fallback?(): PromptFragment[];
}

export interface EngineContext {
  agentId: string;
  mode: AgentMode;
  message: MetroidMessage;
  conversationHistory: MetroidMessage[];
  userName?: string;
}
