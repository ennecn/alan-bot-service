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
  soul?: {
    immutableValues: string[];
    mutableTraits: Array<{ trait: string; intensity: number }>;
  };
  emotion?: {
    baseline: EmotionState;
    intensityDial: number;  // 0-1
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
}
