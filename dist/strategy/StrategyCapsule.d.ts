import type { ContextIntent, ContextLayer } from '../context/ContextCortex.js';
export type StrategyTemplateId = 'no-memory' | 'continuity-only' | 'source-first' | 'temporal-first' | 'user-belief-first' | 'project-state' | 'graph-source' | 'balanced-memory';
export type RetrievalLane = 'graph' | 'compiled' | 'raw_source';
export type StrategySourcePolicy = 'not_needed' | 'fallback' | 'on_dispute' | 'required';
export type StrategyReplanReason = 'intent_changed' | 'project_changed' | 'source_requirement_unmet' | 'evidence_conflict' | 'budget_unsatisfied';
export interface StrategyRetrievalPolicy {
    allowedLanes: RetrievalLane[];
    preferredLanes: RetrievalLane[];
    requiredLane?: RetrievalLane;
}
export interface StrategyCapsule {
    version: 'strategy_capsule.v1';
    capsuleId: string;
    templateId: StrategyTemplateId;
    intent: ContextIntent;
    objective: string;
    projectId?: string;
    primaryLayers: ContextLayer[];
    secondaryLayers: ContextLayer[];
    excludedLayers: ContextLayer[];
    retrievalPolicy: StrategyRetrievalPolicy;
    sourcePolicy: StrategySourcePolicy;
    maxMemoryRatio: number;
    maxItems: number;
    instructionAuthority: 'none';
    persistAllowed: false;
    generatedBy: 'deterministic';
    fixedWithinTurn: true;
    revision: number;
    maxReplans: 1;
    replanReason?: StrategyReplanReason;
    createdAt: number;
}
export interface StrategyTemplate {
    templateId: StrategyTemplateId;
    objective: string;
    primaryLayers: ContextLayer[];
    secondaryLayers: ContextLayer[];
    retrievalPolicy: StrategyRetrievalPolicy;
    sourcePolicy: StrategySourcePolicy;
    maxMemoryRatio: number;
    maxItems: number;
}
//# sourceMappingURL=StrategyCapsule.d.ts.map