import type { MemoryEvent } from '../types/index.js';
export type EpisodeBoundaryMode = 'off' | 'shadow' | 'enforce';
export type EpisodeBoundaryGuardCode = 'max_events_exceeded' | 'max_duration_exceeded' | 'max_idle_gap_exceeded' | 'trusted_local_date_changed';
export interface EpisodeBoundaryWarning {
    code: string;
    message: string;
}
export interface EpisodeBoundaryConfig {
    enabled: boolean;
    mode: EpisodeBoundaryMode;
    maxEvents: number;
    maxDurationMs: number;
    maxIdleGapMs: number;
    splitOnTrustedLocalDateChange: boolean;
    auditDecisions: boolean;
    applyToLive: boolean;
    applyToImports: boolean;
    policyVersion: string;
    timezone?: string;
}
export interface EpisodeBoundaryMetrics {
    activeEventCount: number;
    activeStartedAt?: number;
    activeUpdatedAt?: number;
    elapsedMs?: number;
    idleGapMs?: number;
    trustedLocalDates: string[];
    lastTrustedLocalDate?: string;
    currentTrustedLocalDate?: string;
    outOfOrderTimestamp?: boolean;
}
export interface EpisodeBoundaryGuardResult {
    mode: EpisodeBoundaryMode;
    guardAction: 'none' | 'shadow_new_episode' | 'enforce_new_episode';
    guardCodes: EpisodeBoundaryGuardCode[];
    metrics: EpisodeBoundaryMetrics;
    warnings: EpisodeBoundaryWarning[];
    policyVersion: string;
}
export declare const DEFAULT_EPISODE_BOUNDARY_CONFIG: EpisodeBoundaryConfig;
export interface EpisodeBoundaryConfigDiagnostic {
    severity: 'warning' | 'error';
    code: string;
    message: string;
}
export declare function normalizeEpisodeBoundaryConfig(input?: Partial<EpisodeBoundaryConfig>): {
    config: EpisodeBoundaryConfig;
    diagnostics: EpisodeBoundaryConfigDiagnostic[];
};
export declare class EpisodeBoundaryPolicy {
    readonly config: EpisodeBoundaryConfig;
    constructor(config?: Partial<EpisodeBoundaryConfig>);
    evaluate(input: {
        active?: {
            eventCount: number;
            startedAt?: number;
            updatedAt?: number;
            localDates?: string[];
            lastTrustedLocalDate?: string;
        };
        primaryEvent: Pick<MemoryEvent, 'role' | 'occurredAt' | 'localDate' | 'payload'>;
        imported?: boolean;
    }): EpisodeBoundaryGuardResult;
}
export declare function isTrustedLocalDate(value: string | undefined): value is string;
export declare function resolveTrustedLocalDate(event: {
    occurredAt?: number;
    localDate?: string;
    localDateSource?: 'explicit' | 'generated_project_timezone' | 'generated_host_timezone' | 'generated_utc_fallback' | 'generated_utc' | 'legacy_unknown';
    payload?: unknown;
} | undefined, timezone?: string): {
    date?: string;
    warning?: EpisodeBoundaryWarning;
};
//# sourceMappingURL=EpisodeBoundaryPolicy.d.ts.map