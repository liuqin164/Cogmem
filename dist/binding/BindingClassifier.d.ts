import type { MemoryBindingType, MemoryEntityType } from './MemoryBindingTypes.js';
export interface BindingTopicDecision {
    topicPath: string;
    topicType: 'project' | 'person' | 'object' | 'event' | 'place' | 'time' | 'concept';
    summary: string;
    bindingType: MemoryBindingType;
    signal: string;
    claimKey: string;
    confidence: number;
    entityName?: string;
    entityType?: MemoryEntityType;
    aliases?: string[];
}
export declare class BindingClassifier {
    classify(text: string): BindingTopicDecision[];
    isBindableText(text: string): boolean;
}
export declare function normalizeForBinding(text: string): string;
//# sourceMappingURL=BindingClassifier.d.ts.map