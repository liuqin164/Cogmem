import type { MemoryBindingAction, MemoryBindingType } from './MemoryBindingTypes.js';
export interface BindingDecisionInput {
    bindingType: MemoryBindingType;
    relatedCount: number;
    supportCount: number;
    relatedBindingTypes?: MemoryBindingType[];
}
export declare class BindingDecisionEngine {
    decide(input: BindingDecisionInput): MemoryBindingAction;
}
//# sourceMappingURL=BindingDecisionEngine.d.ts.map