import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KernelAgentMemoryBackend, createMemoryKernel } from '../src/public.js';

// `memory_map.v1` is the self-description a host reads to learn how to operate
// Cogmem (the `cogmem_memory_map` tool returns it verbatim, and `cogmem memory
// map` prints it for humans). Two of its fields are executable claims, not
// prose: `manual.commands` tells an agent which command lines to run, and
// `dataLanes[].route` tells it which kernel call or command line reaches a lane.
// A command line that no longer resolves sends the caller into
// `Unknown cogmem command` or a usage error, exactly like the maintenance
// suggestions that pointed at a `run` subcommand which never existed. Every
// command and route below is therefore resolved against the real CLI dispatch
// tables and the live kernel object instead of against the string beside it.

const root = join(import.meta.dir, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const cliSource = read(join('src', 'bin', 'cogmem.ts'));

/** `COMMANDS` in src/bin/cogmem.ts is the group table the CLI dispatches through. */
function cliGroups(): Map<string, string> {
  const start = cliSource.indexOf('const COMMANDS');
  if (start < 0) throw new Error('src/bin/cogmem.ts no longer declares COMMANDS');
  const body = cliSource.slice(start, cliSource.indexOf('};', start));
  const groups = new Map<string, string>();
  for (const match of body.matchAll(/'?([a-z][a-z-]*)'?\s*:\s*'([a-z][a-z-]*)'/g)) {
    groups.set(match[1], match[2]);
  }
  return groups;
}

/**
 * Subcommands a bin actually dispatches. `command === '<sub>'` is the shape all
 * three bins use; `src/bin/memory.ts` additionally gates the group through
 * `isMemoryCommand()`, which is the authoritative list for that bin.
 */
function moduleCommands(entry: string): Set<string> {
  const code = read(join('src', 'bin', `${entry}.ts`));
  const commands = new Set<string>();
  for (const match of code.matchAll(/command === '([a-z][a-z-]*)'/g)) commands.add(match[1]);
  const guardStart = code.indexOf('function isMemoryCommand');
  if (guardStart >= 0) {
    const guardBody = code.slice(guardStart, code.indexOf('\n}', guardStart));
    for (const match of guardBody.matchAll(/value === '([a-z][a-z-]*)'/g)) commands.add(match[1]);
  }
  return commands;
}

const groups = cliGroups();

type ParsedCommand = { group: string; sub: string; flags: string[] };

function parseCommand(raw: string): ParsedCommand {
  const [binary, group, sub] = raw.split(/\s+/);
  expect(binary).toBe('cogmem');
  const flags = [...raw.matchAll(/--([a-z][a-z-]*)/g)].map((match) => match[1]);
  return { group, sub, flags };
}

/** Problems that would make a documented command line fail at the CLI. */
function commandProblems(raw: string): string[] {
  const problems: string[] = [];
  const { group, sub, flags } = parseCommand(raw);
  const entry = groups.get(group);
  if (!entry) {
    problems.push(`${raw}: unknown cogmem group '${group}'`);
    return problems;
  }
  const code = read(join('src', 'bin', `${entry}.ts`));
  if (!moduleCommands(entry).has(sub)) {
    problems.push(`${raw}: src/bin/${entry}.ts does not dispatch '${sub}'`);
  }
  for (const flag of flags) {
    // A flag is reachable when the bin reads that argument key, or when the bin
    // documents it. Neither means the caller's flag is silently ignored.
    const read = code.includes(`'${flag}'`) || code.includes(`"${flag}"`);
    const documented = code.includes(`--${flag}`);
    if (!read && !documented) problems.push(`${raw}: src/bin/${entry}.ts never reads or documents --${flag}`);
  }
  return problems;
}

const callNames = (route: string) => [...route.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\(\)/g)].map((match) => match[1]);

/** `cogmem <group> <sub>[|sub...]` and the `graph-*` family form. */
function routeCommandRefs(route: string): Array<{ group: string; subs: string[] }> {
  return [...route.matchAll(/cogmem ([a-z][a-z-]*) (graph-\*|[a-z][a-z-]*(?:\|[a-z][a-z-]*)*)/g)]
    .map((match) => ({ group: match[1], subs: match[2].split('|') }));
}

// Lanes whose route is a data shape rather than a callable: a tag namespace and
// a field of `sourceContext`. Both are read from records, never invoked. Each
// entry must still appear in a route, so a rename cannot leave this list stale.
const DATA_SHAPE_ROUTES = ['collection:<name>', 'sourceContext.locator.command'];

function withKernel<T>(run: (kernel: ReturnType<typeof createMemoryKernel>) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-memory-map-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  try {
    return run(kernel);
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('memory_map.v1 manual commands are executable, not aspirational', () => {
  const map = withKernel((kernel) => kernel.buildMemoryMap({ projectId: 'map-guard' }));

  test('the map still publishes memory_map.v1 with twelve unique commands', () => {
    expect(map.version).toBe('memory_map.v1');
    expect(map.manual.commands).toHaveLength(12);
    expect(new Set(map.manual.commands).size).toBe(12);
    for (const command of map.manual.commands) expect(command.startsWith('cogmem ')).toBe(true);
  });

  test('every manual command resolves through the real CLI group and subcommand tables', () => {
    const problems = map.manual.commands.flatMap(commandProblems);
    expect(problems).toEqual([]);
  });

  test('the map never documents a group the cogmem dispatcher cannot reach', () => {
    const groupsUsed = new Set(map.manual.commands.map((command) => parseCommand(command).group));
    expect([...groupsUsed].sort()).toEqual(['dream', 'episode', 'memory']);
    for (const group of groupsUsed) {
      const entry = groups.get(group);
      expect(entry).toBeDefined();
      // The dispatcher resolves the sibling bin from this entrypoint name; a
      // missing file is a `Cannot find module`, not a clean error.
      expect(read(join('src', 'bin', `${entry}.ts`)).length).toBeGreaterThan(0);
    }
  });

  test('the two command lines an agent runs first really execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cogmem-memory-map-cli-'));
    const db = join(dir, 'memory.db');
    try {
      const run = async (args: string[]) => {
        const proc = Bun.spawn({
          cmd: ['bun', join(root, 'src', 'bin', 'cogmem.ts'), ...args, '--db', db, '--json'],
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        return { stdout, stderr, exitCode };
      };

      const mapped = await run(['memory', 'map', '--project', 'map-guard']);
      expect(mapped.exitCode).toBe(0);
      expect(mapped.stderr).toBe('');
      const mapBody = JSON.parse(mapped.stdout) as { version: string; projectId: string; manual: { commands: string[] } };
      expect(mapBody.version).toBe('memory_map.v1');
      expect(mapBody.projectId).toBe('map-guard');
      // What the CLI prints is what the kernel builds: the same twelve lines.
      expect(mapBody.manual.commands).toEqual(map.manual.commands);

      const ticked = await run(['memory', 'tick', '--project', 'map-guard']);
      expect(ticked.exitCode).toBe(0);
      expect(ticked.stderr).toBe('');
      const tickBody = JSON.parse(ticked.stdout) as { version: string; projectId: string; hostOwned: boolean };
      expect(tickBody.version).toBe('maintenance_tick.v1');
      expect(tickBody.projectId).toBe('map-guard');
      expect(tickBody.hostOwned).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('memory_map.v1 data lane routes name something callable', () => {
  const lanes = withKernel((kernel) => kernel.buildMemoryMap({ projectId: 'map-guard' }).dataLanes);

  test('every X() in a route is a real kernel or agent-backend method', () => {
    withKernel((kernel) => {
      const backendPrototype = KernelAgentMemoryBackend.prototype as unknown as Record<string, unknown>;
      const missing: string[] = [];
      const checked: string[] = [];
      for (const lane of lanes) {
        for (const name of callNames(lane.route)) {
          checked.push(`${lane.id}.${name}`);
          const onKernel = typeof (kernel as unknown as Record<string, unknown>)[name] === 'function';
          const onBackend = typeof backendPrototype[name] === 'function';
          if (!onKernel && !onBackend) missing.push(`${lane.id}: ${name}()`);
        }
      }
      expect(missing).toEqual([]);
      // Guard the guard: a parser that silently matched nothing would pass.
      expect(checked.length).toBeGreaterThanOrEqual(12);
      expect(checked).toContain('agent_recall_pack.recallPack');
      expect(checked).toContain('memory_atlas.graphExplore');
    });
  });

  test('every cogmem reference in a route resolves, including the graph-* family', () => {
    const problems: string[] = [];
    let graphFamilyClaims = 0;
    for (const lane of lanes) {
      for (const ref of routeCommandRefs(lane.route)) {
        const entry = groups.get(ref.group);
        if (!entry) {
          problems.push(`${lane.id}: unknown cogmem group '${ref.group}'`);
          continue;
        }
        const known = moduleCommands(entry);
        for (const sub of ref.subs) {
          if (sub === 'graph-*') {
            // A family claim is only honest if the family is really there.
            graphFamilyClaims += 1;
            const family = [...known].filter((name) => name.startsWith('graph'));
            if (family.length < 6) problems.push(`${lane.id}: 'graph-*' matched only ${family.length} commands`);
            continue;
          }
          if (!known.has(sub)) problems.push(`${lane.id}: src/bin/${entry}.ts does not dispatch '${sub}'`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(graphFamilyClaims).toBe(1);
  });

  test('every lane is backed by a live handle or a declared data shape', () => {
    const routes = lanes.map((lane) => lane.route);
    const unbacked: string[] = [];
    for (const lane of lanes) {
      const liveHandle = callNames(lane.route).length > 0 || routeCommandRefs(lane.route).length > 0;
      const dataShape = DATA_SHAPE_ROUTES.some((fragment) => lane.route.includes(fragment));
      if (!liveHandle && !dataShape) unbacked.push(lane.id);
    }
    expect(unbacked).toEqual([]);
    // The whitelist cannot rot: each entry must still describe a live route.
    for (const fragment of DATA_SHAPE_ROUTES) {
      expect(routes.some((route) => route.includes(fragment))).toBe(true);
    }
  });
});
