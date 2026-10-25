import { existsSync, realpathSync } from 'node:fs';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
const EXIT_CODE = {
    not_installed: 0,
    ok: 0,
    warn: 0,
    fail: 1,
};
const SUMMARY = {
    not_installed: 'not installed yet',
    ok: 'installed and working',
    warn: 'installed but degraded',
    fail: 'broken',
};
export function buildGate(level, diagnostics, nextSteps) {
    return {
        level,
        exitCode: EXIT_CODE[level],
        summary: SUMMARY[level],
        diagnostics,
        nextSteps,
    };
}
/** The subset of steps an agent may run unattended, in declaration order. */
export function automationSafeCommands(steps) {
    return steps.filter((step) => step.safeForAutomation && step.actor === 'agent').map((step) => step.command);
}
/**
 * The two Install paths, as the steps that follow a finished install.
 * The installer prints these and stops; it never runs them.
 */
/**
 * The step that runs the Install gate.
 *
 * Defined once because it appears in more than one list, and the two copies had
 * already drifted apart in the one field that legitimately differs — when it is
 * run — while the rest must never diverge. `init` reports it as the step to take
 * now; the install-path list reports it as the step after setup.
 */
export function installGateStep(bin, when = 'after either setup step') {
    return {
        id: 'install_gate',
        actor: 'agent',
        safeForAutomation: true,
        command: `${bin} doctor --json`,
        when,
        purpose: 'the Install gate: not installed, OK, WARN or FAIL, plus the next step',
    };
}
export function installPathSteps(bin) {
    return [
        {
            id: 'operator_init',
            actor: 'operator',
            safeForAutomation: false,
            command: `${bin} init`,
            when: 'with a terminal available',
            purpose: 'interactive first-time config; asks for provider, key and passphrase',
        },
        {
            id: 'agent_init',
            actor: 'agent',
            safeForAutomation: true,
            command: `${bin} init --yes --json`,
            when: 'with no human present',
            purpose: 'non-interactive config; Human-required settings fall back to conservative defaults',
        },
        installGateStep(bin),
    ];
}
/** What the gate says to do once a config exists and the kernel opened. */
export function postInstallSteps(bin) {
    return [
        {
            id: 'connect_host',
            actor: 'operator',
            safeForAutomation: false,
            command: `${bin} connect openclaw --auto --force`,
            when: 'when an OpenClaw workspace should receive automatic recall (or `connect hermes` for Hermes)',
            purpose: 'install the host integration files; names the workspace it will write into',
        },
        {
            id: 'restart_host',
            actor: 'host',
            safeForAutomation: false,
            command: 'restart the agent host',
            when: 'after connect or update changed host files',
            purpose: 'reload the host so it picks up the refreshed Cogmem integration',
        },
    ];
}
/**
 * The steps that follow `connect`, shared rather than redefined in `connect.ts`.
 * Ids and commands are the contract: the JSON field `nextSteps` and the derived
 * `nextCommands` both read this list.
 */
export function connectSteps(host, bin) {
    const project = host === 'openclaw' ? 'openclaw' : 'hermes';
    const importCommand = host === 'openclaw' ? 'import-openclaw' : 'import-hermes';
    const steps = [
        {
            id: 'doctor',
            actor: 'agent',
            safeForAutomation: true,
            command: `${bin} doctor`,
            when: 'after installation or update',
            purpose: 'verify package, config, and database access',
        },
        {
            id: 'import_dry_run',
            actor: 'agent',
            safeForAutomation: true,
            command: `${bin} ${importCommand} --workspace . --project ${project} --dry-run --json`,
            when: 'before importing legacy memory',
            purpose: 'preview source discovery and import counts',
        },
        {
            id: 'import_apply',
            actor: 'agent',
            safeForAutomation: true,
            command: `${bin} ${importCommand} --workspace . --project ${project} --json`,
            when: 'after dry-run looks correct',
            purpose: 'idempotently import legacy memory into Cogmem',
        },
        {
            id: 'memory_plan',
            actor: 'agent',
            safeForAutomation: true,
            command: `${bin} memory plan --project ${project} --json`,
            when: 'after import, update, or user asks for governance progress',
            purpose: 'read agent-safe next actions instead of guessing from raw counters',
        },
        {
            id: 'memory_status',
            actor: 'agent',
            safeForAutomation: true,
            command: `${bin} memory status --project ${project} --json`,
            when: 'for read-only health checks',
            purpose: 'inspect raw ledger, vector fallback, dream backlog, and queue summary',
        },
        {
            id: 'interactive_init',
            actor: 'operator',
            safeForAutomation: false,
            command: `${bin} init --agent ${host} --scope project`,
            when: 'only if no Cogmem config exists and a human operator is present',
            purpose: 'interactive first-time config wizard; agents must not run this unattended',
        },
    ];
    if (host === 'openclaw') {
        steps.splice(1, 0, {
            id: 'openclaw_diagnose',
            actor: 'agent',
            safeForAutomation: true,
            command: `${bin} openclaw diagnose --workspace . --json`,
            when: 'after connect --auto --force or before investigating injection failures',
            purpose: 'verify generated plugin files, audit log, queue lock, and hook diagnostics',
        });
        steps.push({
            id: 'restart_gateway',
            actor: 'host',
            safeForAutomation: false,
            command: 'openclaw gateway restart',
            when: 'after plugin files or OpenClaw config changed',
            purpose: 'reload OpenClaw hooks so the refreshed Cogmem plugin is active',
        });
    }
    else {
        steps.push({
            id: 'reload_hermes',
            actor: 'host',
            safeForAutomation: false,
            command: 'restart or reload Hermes MCP server',
            when: 'after Hermes MCP config changed',
            purpose: 'reload the cogmem MCP server entry',
        });
    }
    return steps;
}
/**
 * The directory the CLI is installed into, when it can be told apart from a
 * source checkout. `COGMEM_BIN_DIR` wins. The dispatcher may be invoked via a
 * symlink that Bun/Node resolves in `process.argv[1]`, so also match the
 * launched file against `cogmem` entries on PATH.
 */
export function resolveCliBinDir(argv1, env = process.env) {
    const override = env.COGMEM_BIN_DIR?.trim();
    if (override)
        return resolve(override);
    if (!argv1)
        return undefined;
    const script = resolve(argv1);
    const leaf = basename(script);
    // Only a launcher named for the CLI counts: a source checkout runs
    // `src/bin/doctor.ts`, which is not an installed layout.
    if (leaf !== 'cogmem' && !/^cogmem\.[cm]?js$/.test(leaf))
        return undefined;
    const dir = dirname(script);
    const base = basename(dir);
    if ((base === 'bin' || base === '.bin') && leaf === 'cogmem')
        return dir;
    let launchedFile;
    try {
        launchedFile = realpathSync(script);
    }
    catch {
        return undefined;
    }
    for (const entry of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
        const candidate = join(resolve(entry), 'cogmem');
        if (!existsSync(candidate))
            continue;
        try {
            if (realpathSync(candidate) === launchedFile)
                return resolve(entry);
        }
        catch {
            // Ignore an invalid PATH entry and continue looking for the launcher.
        }
    }
    return undefined;
}
export function isOnPath(dir, env = process.env) {
    const pathValue = env.PATH ?? '';
    return pathValue.split(':').filter(Boolean).some((entry) => resolve(entry) === resolve(dir));
}
/**
 * The one wording for "the CLI is not on PATH", used by the installer and the
 * gate so a person and an agent are told the same thing.
 */
export function pathWarningSteps(binDir) {
    return [
        {
            id: 'fix_path',
            actor: 'operator',
            safeForAutomation: false,
            command: `export PATH="${binDir}:$PATH"`,
            when: 'now, and in your shell profile if you want it to persist',
            purpose: 'put the cogmem CLI on PATH so `cogmem` resolves without an absolute path',
        },
        {
            id: 'use_absolute_bin',
            actor: 'agent',
            safeForAutomation: true,
            command: `${resolve(binDir)}/cogmem`,
            when: 'instead of fixing PATH',
            purpose: 'call the CLI by absolute path; do not depend on PATH being set',
        },
    ];
}
