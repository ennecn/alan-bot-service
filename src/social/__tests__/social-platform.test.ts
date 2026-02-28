import { describe, it, expect, beforeEach } from 'vitest';
import { SocialPlatform } from '../social-platform.js';

describe('SocialPlatform', () => {
  let platform: SocialPlatform;

  beforeEach(() => {
    platform = new SocialPlatform(':memory:');
  });

  it('createPost returns post with ID and empty reactions', () => {
    const post = platform.createPost('agent-a', 'Hello world', 'happy');
    expect(post.id).toBeDefined();
    expect(post.agent_id).toBe('agent-a');
    expect(post.content).toBe('Hello world');
    expect(post.mood).toBe('happy');
    expect(post.reactions).toEqual([]);
  });

  it('getPosts returns posts in descending order', () => {
    platform.createPost('a', 'First', 'ok');
    platform.createPost('a', 'Second', 'ok');

    const posts = platform.getPosts();
    expect(posts).toHaveLength(2);
    expect(posts[0].content).toBe('Second');
    expect(posts[1].content).toBe('First');
  });

  it('getPosts filters by agentId', () => {
    platform.createPost('a', 'Post A', 'ok');
    platform.createPost('b', 'Post B', 'ok');

    const posts = platform.getPosts(50, 'a');
    expect(posts).toHaveLength(1);
    expect(posts[0].agent_id).toBe('a');
  });

  it('getPosts includes reactions', () => {
    const post = platform.createPost('a', 'My post', 'happy');
    platform.addReaction(post.id, 'b', 'like');
    platform.addReaction(post.id, 'c', 'comment', 'Nice!');

    const posts = platform.getPosts();
    expect(posts[0].reactions).toHaveLength(2);
    expect(posts[0].reactions[0].type).toBe('like');
    expect(posts[0].reactions[1].type).toBe('comment');
    expect(posts[0].reactions[1].content).toBe('Nice!');
  });

  it('addReaction returns reaction with ID', () => {
    const post = platform.createPost('a', 'Test', 'ok');
    const reaction = platform.addReaction(post.id, 'b', 'like');

    expect(reaction.id).toBeDefined();
    expect(reaction.post_id).toBe(post.id);
    expect(reaction.agent_id).toBe('b');
    expect(reaction.type).toBe('like');
  });

  it('updateAffinity creates new relationship', () => {
    platform.updateAffinity('a', 'b', 0.3);

    const rel = platform.getRelationship('a', 'b');
    expect(rel).not.toBeNull();
    expect(rel!.affinity).toBeCloseTo(0.3);
    expect(rel!.interaction_count).toBe(1);
  });

  it('updateAffinity updates existing relationship', () => {
    platform.updateAffinity('a', 'b', 0.3);
    platform.updateAffinity('a', 'b', 0.2);

    const rel = platform.getRelationship('a', 'b');
    expect(rel!.affinity).toBeCloseTo(0.5);
    expect(rel!.interaction_count).toBe(2);
  });

  it('affinity clamps to [-1, 1]', () => {
    platform.updateAffinity('a', 'b', 0.8);
    platform.updateAffinity('a', 'b', 0.5);

    const rel = platform.getRelationship('a', 'b');
    expect(rel!.affinity).toBe(1); // clamped
  });

  it('affinity clamps negative to -1', () => {
    platform.updateAffinity('a', 'b', -0.8);
    platform.updateAffinity('a', 'b', -0.5);

    const rel = platform.getRelationship('a', 'b');
    expect(rel!.affinity).toBe(-1);
  });

  it('initial affinity is clamped', () => {
    platform.updateAffinity('a', 'b', 5.0);
    const rel = platform.getRelationship('a', 'b');
    expect(rel!.affinity).toBe(1);
  });

  it('getRelationship returns null for non-existent pair', () => {
    expect(platform.getRelationship('a', 'b')).toBeNull();
  });

  it('decayRelationships reduces affinity', () => {
    platform.updateAffinity('a', 'b', 0.5);
    platform.updateAffinity('c', 'd', -0.4);

    const count = platform.decayRelationships(0.1);
    expect(count).toBe(2);

    const rel1 = platform.getRelationship('a', 'b');
    expect(rel1!.affinity).toBeCloseTo(0.45);

    const rel2 = platform.getRelationship('c', 'd');
    expect(rel2!.affinity).toBeCloseTo(-0.36);
  });
});
