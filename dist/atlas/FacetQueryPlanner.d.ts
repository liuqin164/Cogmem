export type FacetType = 'time' | 'topic' | 'issue' | 'entity' | 'session' | 'thread' | 'memoryKind' | 'actionKind';
export type FacetOperator = 'intersection' | 'union';
export interface PlannedFacet {
    type: FacetType;
    value: string;
    label: string;
    nodeId?: string;
    relation?: string;
    granularity?: 'year' | 'month' | 'day';
    from?: number;
    to?: number;
}
export interface FacetQueryPlan {
    intent: string;
    operator: FacetOperator;
    facets: PlannedFacet[];
    temporalIntent?: 'timeline';
    groupBy?: 'topic' | 'time' | 'issue';
    exactness: 'strict' | 'relaxed';
    requiresIntersection: boolean;
    keywords: string[];
    query: string;
}
export interface FacetQueryPlannerOptions {
    projectId: string;
    now?: number;
    localDateNow?: string;
    timeZone?: string;
}
export declare class FacetQueryPlanner {
    plan(query: string, options: FacetQueryPlannerOptions): FacetQueryPlan;
}
//# sourceMappingURL=FacetQueryPlanner.d.ts.map