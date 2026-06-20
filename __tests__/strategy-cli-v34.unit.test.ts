import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function run(args: string[]) {
  const entrypoint = join(import.meta.dir, '..', 'src', 'bin', 'strategy.ts');
  const proc = Bun.spawn({ cmd: ['bun', entrypoint, ...args], stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

test('strategy CLI plans read-only policy and lists outcome telemetry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-strategy-cli-'));
  const dbPath = join(dir, 'memory.db');
  const planned = await run(['plan', '--db', dbPath, '--project', 'brain', '--query', '我当时的原话是什么？', '--json']);
  expect(planned.exitCode).toBe(0);
  expect(JSON.parse(planned.stdout)).toMatchObject({ templateId: 'source-first', instructionAuthority: 'none' });

  const outcomes = await run(['outcomes', '--db', dbPath, '--project', 'brain', '--json']);
  expect(outcomes.exitCode).toBe(0);
  expect(JSON.parse(outcomes.stdout)).toEqual([]);
  expect(outcomes.stderr).toBe('');
});
