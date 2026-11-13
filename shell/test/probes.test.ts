import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createMemoryKernel, KernelAgentMemoryBackend } from 'cogmem';
import { renderGapsMarkdown, runGapProbes } from '../src/probes/gaps.ts';
import { makeTempDir } from './helpers.ts';

const shellRoot = join(import.meta.dir, '..');

describe('F1/F2/F6 probes', () => {
  test('each probe records concrete evidence and a ticket proposal', async () => {
    const dir = makeTempDir();
    const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.sqlite'), projectTimeZone: 'UTC' });
    try {
      const backend = new KernelAgentMemoryBackend(kernel);
      const result = await runGapProbes({ kernel, backend, projectId: 'companion-test', agentId: 'cogmem-companion-test', sessionId: 'session-test' });
      const ids = result.probes.map((probe) => probe.id);
      expect(ids).toContain('F1');
      expect(ids).toContain('F2');
      expect(ids).toContain('F6');
      expect(ids).toContain('F-SEC');
      for (const probe of result.probes) {
        expect(probe.evidence.length).toBeGreaterThan(0);
        expect(probe.kernelMissing.length).toBeGreaterThan(0);
        expect(probe.proposal.length).toBeGreaterThan(0);
      }
      const f1 = result.probes.find((probe) => probe.id === 'F1')!;
      expect(f1.evidence.join('\n')).toContain('without a single subscriber');
      const f6 = result.probes.find((probe) => probe.id === 'F6')!;
      expect(f6.evidence.join('\n')).toContain('sensitivity');
      const markdown = renderGapsMarkdown(result);
      expect(markdown).toContain('#165');
      expect(markdown).toContain('F6');
    } finally {
      kernel.close();
    }
  });
});

describe('the probe command', () => {
  test('writes nothing durable, so running it twice is the same as running it once', () => {
    const dir = makeTempDir('companion-probe-');
    const run = () => spawnSync('bun', ['run', 'src/cli.ts', 'probe', '--data', dir], {
      cwd: shellRoot,
      env: { ...process.env, TMPDIR: join(shellRoot, '.tmp') },
      encoding: 'utf8',
    });
    const first = run();
    expect(first.status).toBe(0);
    const second = run();
    expect(second.status).toBe(0);
    // The command drives real writes to show what fires; with no --db they land in a throwaway kernel.
    expect(existsSync(join(dir, 'memory.sqlite'))).toBe(false);
    const gaps = JSON.parse(readFileSync(join(dir, 'gaps.json'), 'utf8')) as { probes: Array<{ id: string }> };
    expect(gaps.probes.map((probe) => probe.id)).toEqual(['F1', 'F2', 'F6', 'F-SEC']);
  }, 30_000);
});
