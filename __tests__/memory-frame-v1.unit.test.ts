import { describe, expect, test } from 'bun:test';
import { deterministicFrameFallback, normalizeAlias, validateMemoryFrame } from '../src/semantic/index.js';

describe('MemoryFrame V1 contract', () => {
  test('normalizes Unicode aliases without changing display labels', () => {
    expect(normalizeAlias('  CogＭｅｍ  ')).toBe('cogmem');
    expect(normalizeAlias('记忆  内核')).toBe('记忆 内核');
  });

  test('fallback contains only deterministic evidence-backed facts', () => {
    const frame = deterministicFrameFallback({
      projectId: 'cogmem', episodeId: 'ep-1',
      events: [{ eventId: 'evt-1', occurredAt: 0 } as never], now: 0,
    });
    expect(frame.sourceAuthority).toBe('deterministic_fallback');
    expect(frame.needsReview).toBe(true);
    expect(validateMemoryFrame(frame).valid).toBe(true);
    expect(frame.evidenceEventIds).toEqual(['evt-1']);
  });

  test('rejects relations whose endpoints are not registered', () => {
    const frame = deterministicFrameFallback({ projectId: 'p', episodeId: 'e', events: [] });
    frame.nodes.push({ frameNodeId: 'topic', dimension: 'topic', label: 'topic', confidence: 1, evidenceEventIds: [] });
    frame.relations.push({ sourceFrameNodeId: 'topic', relationType: 'PARTICIPATED_IN', targetFrameNodeId: 'project', confidence: 1, evidenceEventIds: [] });
    expect(validateMemoryFrame(frame).valid).toBe(false);
    expect(validateMemoryFrame(frame).errors.some((error) => error.startsWith('invalid_memory_frame_relation'))).toBe(true);
  });
});
