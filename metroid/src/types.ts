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
}

export interface ImpulseSignal {
  type: 'emotion_pattern' | 'idle' | 'time_of_day' | 'emotion_pressure';
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
}

export interface ActiveEvent {
  name: string;
  intensity: number;           // 0-1
  relevance: number;           // 0-1, event-character relevance (default 0.8)
  createdAt: number;           // timestamp
  decayRate: number;           // per-hour decay (default 0.5)
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
