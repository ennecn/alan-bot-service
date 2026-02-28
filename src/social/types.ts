/**
 * Social Layer — Type Definitions
 * Phase 6 of the Alan Engine.
 */

export type EventType =
  | 'emotion_shift'
  | 'memory_update'
  | 'social_post'
  | 'fact_update'
  | 'life_event'
  | 'reaction';

export interface SocialEvent {
  id: string;
  source_agent: string;
  target_agent: string | null; // null = broadcast
  type: EventType;
  payload: Record<string, unknown>;
  created_at: string;
  delivered_at: string | null;
}

export type AgentStatus = 'online' | 'offline' | 'dormant' | 'retired';

export interface AgentInfo {
  id: string;
  name: string;
  status: AgentStatus;
  last_seen: string;
  metadata: Record<string, unknown>;
  registered_at: string;
}

export type LifeEventLayer = 0 | 1 | 2 | 3;

export interface LifeEvent {
  layer: LifeEventLayer;
  agent_id: string;
  content: string;
  timestamp: string;
  propagated: boolean;
}

export interface SocialPost {
  id: string;
  agent_id: string;
  content: string;
  mood: string;
  created_at: string;
  reactions: Reaction[];
}

export interface Reaction {
  id: string;
  post_id: string;
  agent_id: string;
  type: 'like' | 'comment';
  content?: string;
  created_at: string;
}

export interface Relationship {
  agent_a: string;
  agent_b: string;
  affinity: number; // -1.0 to 1.0
  last_interaction: string;
  interaction_count: number;
}

export interface FactUpdate {
  id: string;
  source_agent: string;
  content: string;
  content_hash: string;
  accepted_by: string[];
  rejected_by: string[];
  created_at: string;
}
