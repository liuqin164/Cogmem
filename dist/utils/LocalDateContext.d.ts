export type ProjectClockSource = 'explicit' | 'project_config' | 'host_environment' | 'utc_fallback';
export interface ProjectClockContext {
    now: number;
    timeZone: string;
    localDateNow: string;
    source: ProjectClockSource;
}
export declare function resolveTimeZone(timeZone?: string): string;
export declare function resolveProjectClockContext(input?: {
    now?: number;
    localDateNow?: string;
    timeZone?: string;
    projectTimeZone?: string;
}): ProjectClockContext;
export declare function assertLocalDate(value: string, timeZone?: string): string;
export declare function localDateFor(ms: number, timeZone?: string): string;
export declare function localDateRange(year: number, month: number, day: number, endYear: number, endMonth: number, endDay: number, timeZone?: string): {
    from: number;
    to: number;
};
/** Advance an already-valid civil date without treating the result as user input. */
export declare function nextCivilDate(year: number, month: number, day: number, days?: number): readonly [number, number, number];
//# sourceMappingURL=LocalDateContext.d.ts.map