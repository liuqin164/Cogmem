export interface StableImportIdentityInput {
    role: string;
    text: string;
    timestamp?: number;
}
export declare function createStableImportIdentityFactory(sourceAgent: string, sourceSessionId: string): (input: StableImportIdentityInput) => string;
//# sourceMappingURL=EpisodeImportIdentity.d.ts.map