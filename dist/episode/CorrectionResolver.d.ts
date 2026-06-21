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
export declare class CorrectionResolver {
    private readonly searchActiveBeliefs;
    constructor(searchActiveBeliefs: (input: {
        projectId: string;
        query: string;
        topicPath?: string;
        entities?: string[];
        limit: number;
    }) => CorrectionTarget[]);
    resolve(input: {
        projectId: string;
        query: string;
        claimKey?: string;
        topicPath?: string;
        entities?: string[];
    }): CorrectionResolution;
}
//# sourceMappingURL=CorrectionResolver.d.ts.map