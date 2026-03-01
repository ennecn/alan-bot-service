import { describe, it, expect } from 'vitest';
import { PROCESS_EVENT_TOOL } from '../schema.js';
import type { System1Output } from '../../../types/index.js';
import type { Action } from '../../../types/actions.js';

describe('S1 Social Extensions', () => {
  describe('Schema', () => {
    it('has social_actions property', () => {
      const props = PROCESS_EVENT_TOOL.input_schema.properties;
      expect(props).toHaveProperty('social_actions');
    });

    it('social_actions is NOT in required array', () => {
      const required = PROCESS_EVENT_TOOL.input_schema.required;
      expect(required).not.toContain('social_actions');
    });

    it('social_actions has expected sub-properties', () => {
      const sa = (PROCESS_EVENT_TOOL.input_schema.properties as any).social_actions;
      expect(sa.properties).toHaveProperty('should_post');
      expect(sa.properties).toHaveProperty('post_content');
      expect(sa.properties).toHaveProperty('post_mood');
      expect(sa.properties).toHaveProperty('should_react');
      expect(sa.properties).toHaveProperty('react_target');
      expect(sa.properties).toHaveProperty('react_type');
      expect(sa.properties).toHaveProperty('react_content');
    });
  });

  describe('System1Output type', () => {
    it('accepts social_actions field', () => {
      const output: System1Output = {
        event_classification: { type: 'user_message', importance: 0.6 },
        emotional_interpretation: { joy: 0.1 },
        cognitive_projection: 'test',
        wi_expansion: [],
        impulse_narrative: 'test',
        memory_consolidation: { should_save: false, summary: '' },
        social_actions: {
          should_post: true,
          post_content: 'Hello!',
          post_mood: 'happy',
        },
      };
      expect(output.social_actions?.should_post).toBe(true);
    });

    it('works without social_actions', () => {
      const output: System1Output = {
        event_classification: { type: 'user_message', importance: 0.3 },
        emotional_interpretation: {},
        cognitive_projection: 'test',
        wi_expansion: [],
        impulse_narrative: 'test',
        memory_consolidation: { should_save: false, summary: '' },
      };
      expect(output.social_actions).toBeUndefined();
    });
  });

  describe('Social action generation logic', () => {
    function generateSocialActions(s1: System1Output): Action[] {
      const actions: Action[] = [];
      if (s1.social_actions) {
        const sa = s1.social_actions;
        if (sa.should_post && sa.post_content) {
          actions.push({ type: 'post_moment', content: sa.post_content, mood: sa.post_mood ?? 'neutral' });
        }
        if (sa.should_react && sa.react_target) {
          if (sa.react_type === 'comment' && sa.react_content) {
            actions.push({ type: 'comment', target: sa.react_target, content: sa.react_content });
          } else {
            actions.push({ type: 'like', target: sa.react_target });
          }
        }
      }
      return actions;
    }

    const baseOutput: System1Output = {
      event_classification: { type: 'user_message', importance: 0.6 },
      emotional_interpretation: {},
      cognitive_projection: '',
      wi_expansion: [],
      impulse_narrative: '',
      memory_consolidation: { should_save: false, summary: '' },
    };

    it('generates post_moment when should_post=true', () => {
      const actions = generateSocialActions({
        ...baseOutput,
        social_actions: { should_post: true, post_content: 'Feeling great!', post_mood: 'happy' },
      });
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('post_moment');
    });

    it('generates comment when should_react=true and react_type=comment', () => {
      const actions = generateSocialActions({
        ...baseOutput,
        social_actions: { should_react: true, react_target: 'post-1', react_type: 'comment', react_content: 'Nice!' },
      });
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('comment');
    });

    it('generates like when should_react=true and react_type=like', () => {
      const actions = generateSocialActions({
        ...baseOutput,
        social_actions: { should_react: true, react_target: 'post-1', react_type: 'like' },
      });
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('like');
    });

    it('returns empty array when no social_actions', () => {
      const actions = generateSocialActions(baseOutput);
      expect(actions).toHaveLength(0);
    });

    it('generates both post and reaction', () => {
      const actions = generateSocialActions({
        ...baseOutput,
        social_actions: {
          should_post: true, post_content: 'Hello', post_mood: 'excited',
          should_react: true, react_target: 'post-2', react_type: 'like',
        },
      });
      expect(actions).toHaveLength(2);
      expect(actions[0].type).toBe('post_moment');
      expect(actions[1].type).toBe('like');
    });
  });
});
