export type PrivacyTableClassification = 'project_owned' | 'provenance_owned' | 'shared_canonical' | 'operational_non_personal' | 'immutable_audit';
export declare const PRIVACY_BASELINE_CLASSIFICATION: Readonly<Record<string, PrivacyTableClassification>>;
export declare const PRIVACY_SCHEMA_CLASSIFICATION: Readonly<Record<string, PrivacyTableClassification>>;
export interface PrivacyDeletionContext {
    scope: string;
    neuronIds: string[];
    listPersistentTables(): string[];
    hasColumn(table: string, column: string): boolean;
    runDelete(sql: string, params?: Array<string | number>): number;
}
export type PrivacyDeletionAudit = Record<string, number>;
/** Child-first registry for user-derived content outside canonical neurons/events. */
export declare function deleteRegisteredProjectContent(context: PrivacyDeletionContext): PrivacyDeletionAudit;
/** Final exact-scope sweep for versioned project-owned tables not known to the core deletion order. */
export declare function deleteResidualProjectOwnedContent(context: PrivacyDeletionContext): PrivacyDeletionAudit;
export declare function assertPrivacySchemaClassified(tables: string[]): void;
//# sourceMappingURL=PrivacyDeletionRegistry.d.ts.map