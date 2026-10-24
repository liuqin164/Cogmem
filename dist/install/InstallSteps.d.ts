/**
 * The Install actor vocabulary: who carries out one install step.
 * Defined once here so the installer, `init`, `doctor`, `connect` and `update`
 * all speak the same three words. See ADR-0003.
 */
export type InstallActor = 'agent' | 'operator' | 'host';
/**
 * One install step. The shape `connect` already used, now shared: every step
 * names exactly one actor, and only `agent` steps may be `safeForAutomation`.
 */
export interface InstallStep {
    id: string;
    actor: InstallActor;
    safeForAutomation: boolean;
    command: string;
    when: string;
    purpose: string;
}
/** The four Install gate outcomes. `not_installed` is not a failure. */
export type InstallGateLevel = 'not_installed' | 'ok' | 'warn' | 'fail';
export interface InstallGateDiagnostic {
    code: string;
    message: string;
}
export interface InstallGate {
    level: InstallGateLevel;
    exitCode: 0 | 1;
    summary: string;
    diagnostics: InstallGateDiagnostic[];
    nextSteps: InstallStep[];
}
export declare function buildGate(level: InstallGateLevel, diagnostics: InstallGateDiagnostic[], nextSteps: InstallStep[]): InstallGate;
/** The subset of steps an agent may run unattended, in declaration order. */
export declare function automationSafeCommands(steps: InstallStep[]): string[];
/**
 * The two Install paths, as the steps that follow a finished install.
 * The installer prints these and stops; it never runs them.
 */
export declare function installPathSteps(bin: string): InstallStep[];
/** What the gate says to do once a config exists and the kernel opened. */
export declare function postInstallSteps(bin: string): InstallStep[];
/** Host integration kinds that `connect` knows about. */
export type HostIntegration = 'openclaw' | 'hermes';
/**
 * The steps that follow `connect`, shared rather than redefined in `connect.ts`.
 * Ids and commands are the contract: the JSON field `nextSteps` and the derived
 * `nextCommands` both read this list.
 */
export declare function connectSteps(host: HostIntegration, bin: string): InstallStep[];
/**
 * The directory the CLI is installed into, when it can be told apart from a
 * source checkout. `COGMEM_BIN_DIR` wins. The dispatcher may be invoked via a
 * symlink that Bun/Node resolves in `process.argv[1]`, so also match the
 * launched file against `cogmem` entries on PATH.
 */
export declare function resolveCliBinDir(argv1: string | undefined, env?: Record<string, string | undefined>): string | undefined;
export declare function isOnPath(dir: string, env?: Record<string, string | undefined>): boolean;
/**
 * The one wording for "the CLI is not on PATH", used by the installer and the
 * gate so a person and an agent are told the same thing.
 */
export declare function pathWarningSteps(binDir: string): InstallStep[];
//# sourceMappingURL=InstallSteps.d.ts.map