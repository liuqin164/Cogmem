export interface EntityCue {
    label: string;
    id: string;
}
export interface OperationalActionCue {
    kind: string;
    label: string;
    verb: string;
}
export declare function extractEntityCues(text: string, limit?: number): EntityCue[];
export declare function inferOperationalActionCue(text: string): OperationalActionCue | undefined;
export declare function normalizeEntityCueId(label: string): string;
//# sourceMappingURL=EntityCueExtractor.d.ts.map