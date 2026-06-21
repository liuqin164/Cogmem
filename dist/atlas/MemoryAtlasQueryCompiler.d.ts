export interface CompiledAtlasQuery {
    text: string;
    tokens: string[];
    target?: string;
    actionIntent: boolean;
    range?: {
        from: number;
        to: number;
        label: string;
    };
    memoryKinds: string[];
}
export declare function compileAtlasQuery(query: string, now?: number): CompiledAtlasQuery;
export declare function actionMarker(value: string): {
    frameType: string;
    action: string;
} | undefined;
//# sourceMappingURL=MemoryAtlasQueryCompiler.d.ts.map