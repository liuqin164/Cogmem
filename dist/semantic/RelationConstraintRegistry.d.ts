import type { MemoryDimension, MemoryRelationType } from './MemoryFrameTypes.js';
export declare class RelationConstraintRegistry {
    isAllowed(source: MemoryDimension, relation: MemoryRelationType, target: MemoryDimension): boolean;
    validate(source: MemoryDimension, relation: MemoryRelationType, target: MemoryDimension): void;
}
export declare const relationConstraintRegistry: RelationConstraintRegistry;
//# sourceMappingURL=RelationConstraintRegistry.d.ts.map