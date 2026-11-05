import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeTempDir } from './helpers/tmp.js';

/**
 * `connect pi --auto` installs pi's push half.
 *
 * A skill is documentation pi reads when the model decides the task matches; measured on
 * a real pi with the cogmem skill installed and the MCP tools listed, a fresh session
 * asked about something from an earlier session made **zero** tool calls. An extension is
 * loaded at startup and can hook `before_agent_start`, which is where recall has to be
 * injected for pi to behave like OpenClaw. So the same command that writes the MCP entry
 * writes the extension, with the workspace and project baked in.
 */
const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const connectBin = join(coreRoot, 'src/bin/connect.ts');

async function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const proc = Bun.spawn({ cmd, cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NO_COLOR: '1', ...env } });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

function scratch() {
  const dir = makeTempDir('cogmem-pi-extension-');
  const home = join(dir, 'home');
  const ws = join(dir, 'ws');
  mkdirSync(join(ws, '.cogmem'), { recursive: true });
  const configPath = join(ws, '.cogmem', 'config.toml');
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');
  return { dir, home, ws, configPath, piConfig: join(home, '.pi', 'agent', 'mcp.json') };
}

test('connect pi writes the before_agent_start extension beside its MCP config', async () => {
  const p = scratch();
  const { exitCode, stdout } = await run([
    'bun', connectBin, 'pi', '--workspace', p.ws, '--auto', '--pi-config', p.piConfig, '--json',
  ], p.ws, { HOME: p.home });
  expect(exitCode).toBe(0);

  // Derived from the config path, so the two can never point at different pi homes.
  const extensionPath = join(dirname(p.piConfig), 'extensions', 'cogmem-auto-memory.ts');
  expect(existsSync(extensionPath)).toBe(true);

  const source = readFileSync(extensionPath, 'utf8');
  // The hook that makes it push rather than pull.
  expect(source).toContain('before_agent_start');
  // Baked in, not read from the environment: a generated file that only works when
  // three variables happen to be exported is a file that silently does nothing. The
  // workspace is what recall runs from, so that is what the file carries.
  expect(source).toContain(p.ws);
  expect(source).toContain('memory');
  const parsed = JSON.parse(stdout) as { piExtension?: { extensionPath?: string; changed?: boolean } };
  expect(parsed.piExtension?.extensionPath).toBe(extensionPath);
  expect(parsed.piExtension?.changed).toBe(true);
});

test('a second connect pi run leaves the extension alone', async () => {
  const p = scratch();
  const args = ['bun', connectBin, 'pi', '--workspace', p.ws, '--auto', '--pi-config', p.piConfig, '--json'];
  expect((await run(args, p.ws, { HOME: p.home })).exitCode).toBe(0);
  const extensionPath = join(dirname(p.piConfig), 'extensions', 'cogmem-auto-memory.ts');
  const first = readFileSync(extensionPath, 'utf8');

  const second = await run(args, p.ws, { HOME: p.home });
  expect(second.exitCode).toBe(0);
  expect(readFileSync(extensionPath, 'utf8')).toBe(first);
  expect((JSON.parse(second.stdout) as { piExtension?: { changed?: boolean } }).piExtension?.changed).toBe(false);
});

test('the generated extension does not write when the run is a dry run', async () => {
  const p = scratch();
  const { exitCode } = await run([
    'bun', connectBin, 'pi', '--workspace', p.ws, '--auto', '--pi-config', p.piConfig, '--dry-run', '--json',
  ], p.ws, { HOME: p.home });
  expect(exitCode).toBe(0);
  expect(existsSync(join(dirname(p.piConfig), 'extensions', 'cogmem-auto-memory.ts'))).toBe(false);
});

test('the extension is given the dispatcher, not the MCP server binary', async () => {
  // `resolveCogmemMcpServer` may hand back `cogmem-mcp`, which is the server itself: it
  // reads a positional `memory` as an unknown flag (measured on the box:
  // "unknown flag --query"). The extension runs `cogmem memory recall`, so baking the
  // server entry in made it fail silently — the whole feature did nothing, and the model
  // fell back to calling the tools itself.
  const p = scratch();
  const binDir = join(p.dir, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, 'cogmem'), '#!/bin/sh\nexit 0\n');
  const mcpBin = join(binDir, 'cogmem-mcp');
  writeFileSync(mcpBin, '#!/bin/sh\nexit 0\n');

  const { exitCode } = await run([
    'bun', connectBin, 'pi', '--workspace', p.ws, '--auto', '--pi-config', p.piConfig, '--json',
  ], p.ws, { HOME: p.home, COGMEM_MCP_BIN: mcpBin });
  expect(exitCode).toBe(0);

  const source = readFileSync(join(dirname(p.piConfig), 'extensions', 'cogmem-auto-memory.ts'), 'utf8');
  expect(source).toContain(JSON.stringify(join(binDir, 'cogmem')));
  expect(source).not.toContain('cogmem-mcp');
});
