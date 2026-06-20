import type { ContextCandidate } from '../context/ContextCortex.js';
import type { StrategyCapsule } from './StrategyCapsule.js';

export class StrategyConditionedCandidateBuilder {
  build(input: { capsule: StrategyCapsule; candidates: ContextCandidate[] }): ContextCandidate[] {
    const order = [...input.capsule.primaryLayers, ...input.capsule.secondaryLayers];
    const allowed = new Set(order);
    return input.candidates
      .filter((candidate) => allowed.has(candidate.layer))
      .sort((a, b) => order.indexOf(a.layer) - order.indexOf(b.layer)
        || (b.confidence ?? 0.5) - (a.confidence ?? 0.5)
        || a.id.localeCompare(b.id));
  }
}
