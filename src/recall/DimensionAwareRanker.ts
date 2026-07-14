import type { MemoryAtlasNode } from '../atlas/MemoryAtlasTypes.js';
import type { MemoryQueryFrameV1 } from '../semantic/MemoryFrameTypes.js';

export const DEFAULT_DIMENSION_QUOTAS: Record<string, number> = {
  episode: 20, event: 12, topic: 10, issue: 10, task: 10, actor: 8, project: 8, entity: 12, time: 8, state: 6,
};

export class DimensionAwareRanker {
  rank(nodes: MemoryAtlasNode[], frame: MemoryQueryFrameV1, quotas = DEFAULT_DIMENSION_QUOTAS): MemoryAtlasNode[] {
    const labels = Object.values(frame).flatMap((value) => Array.isArray(value)
      ? value.flatMap((item) => typeof item === 'string' ? [item] : [String(item?.label ?? '')])
      : []);
    const scored = nodes.map((node) => {
      const haystack = `${node.label} ${node.summary ?? ''}`.toLocaleLowerCase('und');
      const match = labels.filter((label) => haystack.includes(label.toLocaleLowerCase('und'))).length;
      return { node, score: node.score + match * 2 + node.confidence };
    }).sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
    const counts = new Map<string, number>();
    return scored.filter(({ node }) => {
      const type = node.nodeType; const max = quotas[type] ?? 12; const count = counts.get(type) ?? 0;
      if (count >= max) return false; counts.set(type, count + 1); return true;
    }).map(({ node }) => node);
  }
}
