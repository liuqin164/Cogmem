export interface PrivacyDeletionContext {
    scope: string;
    neuronIds: string[];
    runDelete(sql: string, params?: Array<string | number>): number;
}
export type PrivacyDeletionAudit = Record<string, number>;
/** Child-first registry for user-derived content outside canonical neurons/events. */
export declare function deleteRegisteredProjectContent(context: PrivacyDeletionContext): PrivacyDeletionAudit;
//# sourceMappingURL=PrivacyDeletionRegistry.d.ts.map