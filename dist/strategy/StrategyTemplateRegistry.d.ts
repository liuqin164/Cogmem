import type { ContextIntent, ContextLayer } from '../context/ContextCortex.js';
import type { StrategyTemplate, StrategyTemplateId } from './StrategyCapsule.js';
export declare class StrategyTemplateRegistry {
    forIntent(intent: ContextIntent): StrategyTemplate;
    get(templateId: StrategyTemplateId): StrategyTemplate;
    excludedLayers(template: StrategyTemplate): ContextLayer[];
    list(): StrategyTemplate[];
}
//# sourceMappingURL=StrategyTemplateRegistry.d.ts.map