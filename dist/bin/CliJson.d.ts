export declare const CLI_JSON_SCHEMA_VERSION: "cogmem.cli.v1";
interface QueueCounters {
    candidate?: unknown;
    promoted?: unknown;
    needsConfirmation?: unknown;
    needs_confirmation?: unknown;
}
export declare function formatCliJson(command: string, payload: unknown, options?: {
    queue?: QueueCounters;
    beliefs?: number;
}): Record<string, unknown>;
export declare function printCliJson(command: string, payload: unknown, options?: {
    queue?: QueueCounters;
    beliefs?: number;
}): void;
export {};
//# sourceMappingURL=CliJson.d.ts.map