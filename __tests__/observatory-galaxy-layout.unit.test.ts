import { describe, expect, test } from 'bun:test';

import { armKeyFor, galaxyLayout } from '../src/observatory/GalaxyLayout.js';

/**
 * #136 §c: the same corpus has to open onto the same galaxy. A layout that drifted between two
 * openings would make "I saw it over there" useless, so determinism is the property worth a test —
 * not the exact constants, which exist to be tuned.
 */

const ids = Array.from({ length: 200 }, (_, index) => `raw_event:evt-${index}`);
const corpus = ids.map((id, index) => ({ id, arm: ['atlas', 'recall', 'deploy'][index % 3]! }));

describe('the star map is a pure function of the corpus', () => {
  test('the same input yields the same coordinates, whatever order it arrives in', () => {
    const first = galaxyLayout(corpus);
    const second = galaxyLayout([...corpus].reverse());
    for (const node of corpus) {
      expect(second.get(node.id)).toEqual(first.get(node.id));
    }
    expect(first.size).toBe(corpus.length);
  });

  test('a node keeps its position when its neighbours change', () => {
    const one = galaxyLayout([{ id: 'raw_event:evt-7', arm: 'atlas' }]);
    const many = galaxyLayout([...corpus.slice(0, 50), { id: 'raw_event:evt-7', arm: 'atlas' }]);
    expect(many.get('raw_event:evt-7')).toEqual(one.get('raw_event:evt-7'));
  });

  test('every point is finite and inside the disc', () => {
    for (const point of galaxyLayout(corpus, { radius: 100, thickness: 12 }).values()) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
      expect(Number.isFinite(point.z)).toBe(true);
      expect(Math.hypot(point.x, point.z)).toBeLessThanOrEqual(100);
      expect(Math.abs(point.y)).toBeLessThanOrEqual(12);
    }
  });

  test('the arms are separated: one group per arm, each on its own side of the disc', () => {
    const positions = galaxyLayout([...corpus]);
    const angles = new Map<string, number[]>();
    for (const node of corpus) {
      const point = positions.get(node.id)!;
      const list = angles.get(node.arm) ?? [];
      // The spiral term is removed by comparing the same radius band only approximately; the arm
      // offset dominates, which is what this asserts.
      list.push(Math.atan2(point.z, point.x));
      angles.set(node.arm, list);
    }
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const means = [...angles.values()].map(mean).map((value) => ((value % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
    expect(means).toHaveLength(3);
    for (let left = 0; left < means.length; left += 1) {
      for (let right = left + 1; right < means.length; right += 1) {
        const raw = Math.abs(means[left]! - means[right]!);
        const gap = Math.min(raw, Math.PI * 2 - raw);
        expect(gap).toBeGreaterThan(0.6);
      }
    }
  });

  test('a node with no arm still lands somewhere', () => {
    const positions = galaxyLayout([{ id: 'project:p', arm: 'p' }]);
    expect(positions.get('project:p')).toBeDefined();
  });
});

describe('which arm a node belongs to', () => {
  test('the top-level topic path wins, then a one-hop topic, then the project', () => {
    expect(armKeyFor({ topicPath: 'ops/deploy/window', projectId: 'p' })).toBe('ops');
    expect(armKeyFor({ topicArm: 'memory/atlas', projectId: 'p' })).toBe('memory/atlas');
    expect(armKeyFor({ projectId: 'p' })).toBe('p');
    // The 20,343-event corpus has a null topic_path on every row: one arm, and the page says so.
    expect(armKeyFor({ topicPath: undefined, projectId: 'p' })).toBe('p');
  });
});
