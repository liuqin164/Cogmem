export interface CorrectionTarget {
  beliefId: string;
  canonicalKey?: string;
  statement?: string;
  projectId?: string;
}

export interface CorrectionResolution {
  status: 'resolved' | 'needs_review';
  target?: CorrectionTarget;
  candidates: CorrectionTarget[];
  reason: string;
}

export class CorrectionResolver {
  constructor(private readonly searchActiveBeliefs: (input: {
    projectId: string; query: string; topicPath?: string; entities?: string[]; limit: number;
  }) => CorrectionTarget[]) {}

  resolve(input: { projectId: string; query: string; claimKey?: string; topicPath?: string; entities?: string[] }): CorrectionResolution {
    const candidates = this.searchActiveBeliefs({
      projectId: input.projectId, query: input.claimKey || input.query, topicPath: input.topicPath,
      entities: input.entities, limit: 5,
    }).filter((candidate) => !candidate.projectId || candidate.projectId === input.projectId);
    const exact = input.claimKey ? candidates.filter((candidate) => candidate.canonicalKey === input.claimKey) : [];
    const selected = exact.length === 1 ? exact[0] : candidates.length === 1 ? candidates[0] : undefined;
    return selected
      ? { status: 'resolved', target: selected, candidates, reason: exact.length === 1 ? 'canonical_key_match' : 'single_bounded_semantic_match' }
      : { status: 'needs_review', candidates, reason: candidates.length ? 'ambiguous_correction_target' : 'orphan_correction' };
  }
}
