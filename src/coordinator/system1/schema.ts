/**
 * System 1 — Anthropic tool_use schema for "process_event".
 * PRD v6.0 §3.2
 */

export const PROCESS_EVENT_TOOL = {
  name: 'process_event',
  description:
    'Process an incoming event through the character\'s cognitive filter. ' +
    'Classify the event, interpret emotional impact, project inner thoughts, ' +
    'expand World Info, generate impulse narrative, and decide on memory consolidation.',
  input_schema: {
    type: 'object' as const,
    properties: {
      event_classification: {
        type: 'object' as const,
        description: 'Classify the event type and importance.',
        properties: {
          type: {
            type: 'string' as const,
            enum: ['user_message', 'heartbeat', 'social', 'life_event', 'system'],
            description: 'The category of this event.',
          },
          importance: {
            type: 'number' as const,
            enum: [0.0, 0.3, 0.6, 1.0],
            description: 'How important this event is to the character. 0.0=trivial, 0.3=minor, 0.6=significant, 1.0=critical.',
          },
        },
        required: ['type', 'importance'],
      },
      emotional_interpretation: {
        type: 'object' as const,
        description: 'Emotional deltas for each dimension. Each value must be between -0.3 and 0.3. Only include dimensions that are affected.',
        properties: {
          joy: { type: 'number' as const, minimum: -0.3, maximum: 0.3 },
          sadness: { type: 'number' as const, minimum: -0.3, maximum: 0.3 },
          anger: { type: 'number' as const, minimum: -0.3, maximum: 0.3 },
          anxiety: { type: 'number' as const, minimum: -0.3, maximum: 0.3 },
          longing: { type: 'number' as const, minimum: -0.3, maximum: 0.3 },
          trust: { type: 'number' as const, minimum: -0.3, maximum: 0.3 },
        },
      },
      cognitive_projection: {
        type: 'string' as const,
        description: 'What the character would think upon receiving this event. Inner monologue.',
      },
      wi_expansion: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Additional World Info entry IDs to activate beyond the pre-filter candidates.',
      },
      impulse_narrative: {
        type: 'string' as const,
        description: 'IMPULSE.md content — a brief narrative of the character\'s current impulse state, written in the character\'s language.',
      },
      memory_consolidation: {
        type: 'object' as const,
        description: 'Whether this event should be saved to long-term memory.',
        properties: {
          should_save: {
            type: 'boolean' as const,
            description: 'True if this event is worth remembering.',
          },
          summary: {
            type: 'string' as const,
            description: 'A concise summary for memory storage. Empty string if should_save is false.',
          },
        },
        required: ['should_save', 'summary'],
      },
    },
    required: [
      'event_classification',
      'emotional_interpretation',
      'cognitive_projection',
      'wi_expansion',
      'impulse_narrative',
      'memory_consolidation',
    ],
  },
} as const;
