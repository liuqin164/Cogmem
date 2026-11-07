import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMemoryKernel } from '../src/factory.js';
import { callCogmemMcpTool } from '../src/mcp/CoreMcpTools.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #168: the offline consolidation's blocked decisions (#129 rules 2 and 3) must be readable from
 * the CLI and MCP import results, not only from a direct `kernel.consolidate()` call.
 *
 * The scenario is a real one, produced by the import pipeline rather than hand-built: two
 * independent origins, one holding each polarity, so `likes` and `dislikes` both reach the
 * `preference` predicate and neither is consolidated. Each surface's result is compared
 * item-for-item against the API view on the same database, and the comparison is rollback-red:
 * dropping the field from either surface leaves `undefined` against a non-empty array.
 */
const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const importBin = join(coreRoot, 'src/bin/import.ts');
const projectId = 'blocked-consolidations-parity';

/** Two origins, one per polarity — both consolidate-worthy alone, neither resolved. */
function makeWorkspace(name: string): string {
  const dir = makeTempDir(`cogmem-${name}-`);
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'sessions', '2026-05-07.md'), [
    '# 2026-05-07',
    '',
    '- 09:00 User: I like pnpm.',
    '- 09:01 Agent: Noted.',
    '- 09:02 User: I dislike pnpm.',
    '- 09:03 Agent: Noted.',
  ].join('\n'));
  return dir;
}

async function runCli(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ['bun', ...args],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1' },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

/** The API view: what `kernel.consolidate()` returns for the window the import ran over. */
async function apiBlocked(kernel: ReturnType<typeof createMemoryKernel>) {
  const output = await kernel.consolidate({
    projectId,
    startTime: 0,
    endTime: Number.MAX_SAFE_INTEGER,
  });
  return output.blockedConsolidations;
}

test('CLI import --json reports blocked consolidations, item-for-item with the API view', async () => {
  const dir = makeWorkspace('blocked-cli');
  const dbPath = join(dir, 'memory.db');

  const result = await runCli([importBin, 'hermes', '--workspace', dir, '--db', dbPath, '--project', projectId, '--json']);
  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout) as { blockedConsolidations?: unknown };

  // The scenario really hit the rule, rather than the import quietly consolidating nothing.
  const kernel = createMemoryKernel({ dbPath });
  const api = await apiBlocked(kernel);
  kernel.close();
  expect(api.map((entry) => entry.reason)).toEqual(['origin_polarity_conflict', 'origin_polarity_conflict']);
  expect(parsed.blockedConsolidations).toEqual(api);
});

test('MCP cogmem_import_apply reports blocked consolidations, item-for-item with the API view', async () => {
  const dir = makeWorkspace('blocked-mcp');
  const dbPath = join(dir, 'memory.db');
  const kernel = createMemoryKernel({ dbPath });
  try {
    const applied = await callCogmemMcpTool(
      'cogmem_import_apply',
      { agent: 'hermes', workspaceRoot: dir, projectId },
      { kernel },
    );
    expect(applied.isError).toBeFalsy();
    const body = applied.structuredContent as { blockedConsolidations?: unknown };

    const api = await apiBlocked(kernel);
    expect(api.map((entry) => entry.reason)).toEqual(['origin_polarity_conflict', 'origin_polarity_conflict']);
    expect(body.blockedConsolidations).toEqual(api);
  } finally {
    kernel.close();
  }
});

test('CLI and MCP read back the same blocked consolidation semantics', async () => {
  const cliDir = makeWorkspace('blocked-cross-cli');
  const mcpDir = makeWorkspace('blocked-cross-mcp');

  const cli = await runCli([importBin, 'hermes', '--workspace', cliDir, '--db', join(cliDir, 'memory.db'), '--project', projectId, '--json']);
  expect(cli.exitCode).toBe(0);
  const cliRows = (JSON.parse(cli.stdout) as { blockedConsolidations: Array<{ factId: string; subject: string; predicate: string; reason: string }> }).blockedConsolidations;

  const kernel = createMemoryKernel({ dbPath: join(mcpDir, 'memory.db') });
  let mcpRows: Array<{ factId: string; subject: string; predicate: string; reason: string }>;
  try {
    const applied = await callCogmemMcpTool('cogmem_import_apply', { agent: 'hermes', workspaceRoot: mcpDir, projectId }, { kernel });
    mcpRows = (applied.structuredContent as { blockedConsolidations: typeof cliRows }).blockedConsolidations;
  } finally {
    kernel.close();
  }

  // Fact ids are per database, so the two surfaces are lined up on everything else.
  const shape = (rows: typeof cliRows) => rows.map(({ subject, predicate, reason }) => ({ subject, predicate, reason }));
  expect(shape(cliRows)).toEqual(shape(mcpRows));
  expect(cliRows.every((row) => typeof row.factId === 'string' && row.factId.length > 0)).toBe(true);
});
