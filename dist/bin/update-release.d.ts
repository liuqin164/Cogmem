export declare const DEFAULT_RELEASE_REPO = "liuqin164/cogmem";
export declare const DEFAULT_NPM_PACKAGE = "cogmem";
export interface ResolveLatestNpmSpecOptions {
    env?: Record<string, string | undefined>;
}
export interface ResolveLatestReleaseSpecOptions {
    repo?: string;
    env?: Record<string, string | undefined>;
    timeoutMs?: number;
    fetchJson?: (url: string) => Promise<unknown>;
}
export declare function resolveLatestNpmSpec(options?: ResolveLatestNpmSpecOptions): string;
export declare function resolveLatestReleaseSpec(options?: ResolveLatestReleaseSpecOptions): Promise<string>;
export declare function resolveReleasePayloadSpec(payload: unknown, repo?: string): string;
//# sourceMappingURL=update-release.d.ts.map