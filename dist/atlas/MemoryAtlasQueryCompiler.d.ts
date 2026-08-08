export interface CompiledAtlasQuery {
    text: string;
    tokens: string[];
    keywords: string[];
    target?: string;
    actionIntent: boolean;
    range?: {
        from: number;
        to: number;
        label: string;
    };
    memoryKinds: string[];
}
export declare function compileAtlasQuery(query: string, context?: number | {
    now?: number;
    localDateNow?: string;
    timeZone?: string;
}): CompiledAtlasQuery;
export declare function actionMarker(value: string): {
    frameType: string;
    action: string;
} | undefined;
export declare function actionMarkers(value: string): Array<{
    frameType: string;
    action: string;
    index: number;
    end: number;
    clause: string;
    ordinal: number;
}>;
//# sourceMappingURL=MemoryAtlasQueryCompiler.d.ts.map