export interface FinalSchemaObject {
    readonly type: 'table' | 'index' | 'trigger' | 'view';
    readonly name: string;
    readonly table: string;
    readonly sql: string;
}
export declare const FINAL_TABLES: readonly FinalSchemaObject[];
export declare const FINAL_AUXILIARY_OBJECTS: readonly FinalSchemaObject[];
//# sourceMappingURL=FinalSchemaDefinition.d.ts.map