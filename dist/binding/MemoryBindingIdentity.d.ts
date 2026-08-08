export declare function memoryEntityId(projectId: string | undefined, entityType: string, identity: string): string;
export declare function memoryEdgeId(input: {
    projectId?: string;
    sourceType: string;
    sourceId: string;
    relationType: string;
    targetType: string;
    targetId: string;
}): string;
export declare function preferredMemoryEdgeAuthority(left: string, right: string): string;
export declare function preferredMemoryEdgeAuthoritySql(left: string, right: string): string;
export declare function memoryEdgeAuthorityRankSql(value: string): string;
//# sourceMappingURL=MemoryBindingIdentity.d.ts.map