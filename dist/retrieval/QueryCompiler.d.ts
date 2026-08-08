import type { QueryIR } from '../types/query-ir.js';
import type { LocalSemanticCompiler, SemanticCompilation } from '../engine/LocalSemanticCompiler.js';
import type { EntityResolutionEngine, EntityResolutionResult } from '../engine/EntityResolutionEngine.js';
import { type ProjectClockContext } from '../utils/LocalDateContext.js';
export interface CompiledQuery {
    ir: QueryIR;
    semanticCompilation: SemanticCompilation;
    entityResolution: EntityResolutionResult;
}
export declare class QueryCompiler {
    private semanticCompiler;
    private entityResolutionEngine;
    private nativeQueryParser;
    constructor(semanticCompiler: LocalSemanticCompiler, entityResolutionEngine: EntityResolutionEngine);
    compile(query: string, projectId?: string, clock?: Pick<ProjectClockContext, 'now' | 'localDateNow' | 'timeZone'>): CompiledQuery;
    private mapNativeTime;
    private parseNativeDate;
    private resolveProjectTemporalWindow;
    private civilParts;
    private shiftMonth;
    private validPriorYearDate;
}
//# sourceMappingURL=QueryCompiler.d.ts.map