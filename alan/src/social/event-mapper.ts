/**
 * Social Event Mapper — converts SocialEvent to CoordinatorEvent.
 */
import type { SocialEvent } from './types.js';
import type { CoordinatorEvent } from '../coordinator/types.js';

export function mapSocialEvent(event: SocialEvent): CoordinatorEvent | null {
  const timestamp = event.created_at ?? new Date().toISOString();

  switch (event.type) {
    case 'social_post':
      return {
        trigger: 'social_notification',
        content: `[Social] ${event.source_agent} posted: ${(event.payload as { content?: string }).content ?? ''}`,
        timestamp,
      };
    case 'fact_update':
      return {
        trigger: 'fact_sync',
        content: `[FactSync] ${event.source_agent}: ${(event.payload as { content?: string }).content ?? ''}`,
        timestamp,
      };
    case 'reaction':
      return {
        trigger: 'social_notification',
        content: `[Social] ${event.source_agent} reacted: ${(event.payload as { type?: string }).type ?? 'unknown'} — ${(event.payload as { content?: string }).content ?? ''}`,
        timestamp,
      };
    case 'life_event':
      return {
        trigger: 'social_notification',
        content: `[LifeEvent] ${event.source_agent}: ${(event.payload as { content?: string }).content ?? ''}`,
        timestamp,
      };
    default:
      return null;
  }
}
