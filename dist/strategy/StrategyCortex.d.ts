import type { ContextIntent } from '../context/ContextCortex.js';
import type { StrategyCapsule, StrategyReplanReason } from './StrategyCapsule.js';
import { StrategyTemplateRegistry } from './StrategyTemplateRegistry.js';
export interface StrategyPlanInput {
    query: string;
    intent: ContextIntent;
    projectId?: string;
    createdAt?: number;
}
export interface StrategyReplanObservation {
    intent: ContextIntent;
    projectId?: string;
    sourceRequirementSatisfied?: boolean;
    evidenceConflict?: boolean;
    budgetSatisfied?: boolean;
}
export interface StrategyReplanDecision {
    replanned: boolean;
    reason?: StrategyReplanReason;
    capsule: StrategyCapsule;
}
export declare class StrategyCortex {
    private readonly registry;
    constructor(registry?: StrategyTemplateRegistry);
    plan(input: StrategyPlanInput): StrategyCapsule;
    replan(current: StrategyCapsule, observation: StrategyReplanObservation): StrategyReplanDecision;
}
//# sourceMappingURL=StrategyCortex.d.ts.map