import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryKernel } from '../src/factory.js';
import { makeTempDir } from './helpers/tmp.js';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const doctorBin = join(coreRoot, 'src/bin/doctor.ts');
const cogmemBin = join(coreRoot, 'src/bin/cogmem.ts');

class FakeEmbeddingProvider {
  modelId = 'model/new';
  dimensions = 2;
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => new Float32Array([1, 1]));
  }
  async embed(text: string): Promise<Float32Array> {
    return new Float32Array([1, 1]);
  }
}

// The tick only reports stale embeddings when the host supplied a provider, because
// only then does a different model id mean "the vectors are behind".
function staleVectorFixture() {
  const dir = makeTempDir('cogmem-suggested-actions-');
  const dbPath = join(dir, 'memory.db');
  const kernel = createMemoryKernel({
    dbPath,
    projectTimeZone: 'Asia/Tokyo',
    embeddingProvider: new FakeEmbeddingProvider() as never,
  });
  const db = new Database(dbPath);
  db.exec([
    'INSERT INTO neuron_embeddings',
    '(neuron_id, model_id, vector_blob, dimensions, project_id, status, updated_at)',
    "VALUES ('n1', 'model/old', x'00000000', 1, 'p', 'pending', 1)",
  ].join(' '));
  db.close();
  return { kernel, dbPath };
}

describe('maintenance tick suggested actions point at commands that run', () => {
  test('the stale-embedding action names a command that reports the progress', () => {
    const { kernel, dbPath } = staleVectorFixture();
    try {
      const tick = kernel.runMaintenanceTick({ projectId: 'p' });
      expect(tick.chargeVector.staleVectors).toBe(1);
      const action = tick.suggestedActions.find((item) => item.kind === 're_embed');
      expect(action).toBeDefined();
      expect(action?.executable).toBe('cogmem');
      expect(action?.args).toEqual(['doctor', '--storage', '--json']);
      // The command cannot re-embed on its own; the reason has to name the real path.
      expect(action?.reason).toContain('ReEmbeddingPipeline.run()');
      expect(action?.command).not.toContain(' run');
    } finally {
      kernel.close();
    }
  });

  test('doctor --storage reports the embedding progress as data, not only as a human line', () => {
    // `cogmem re-embed status` could only ever read this, so it reads from the storage
    // report instead of from a command of its own (#141) — and the report is now in the
    // JSON, which it was not: `--storage` used to produce a human line and nothing
    // machine-readable, so an agent asking for storage state got a document without it.
    const { kernel, dbPath } = staleVectorFixture();
    kernel.close();
    const configPath = join(dirname(dbPath), 'config.toml');
    writeFileSync(configPath, `[core]\ndb_path = "${dbPath}"\n`);
    const probe = Bun.spawnSync({ cmd: ['bun', doctorBin, '--storage', '--config', configPath, '--json'], cwd: coreRoot, stdout: 'pipe', stderr: 'pipe' });
    expect(probe.exitCode).toBe(0);
    const body = JSON.parse(new TextDecoder().decode(probe.stdout)) as { storage?: { embeddings?: { completed: number; total: number; failed: number } } };
    expect(body.storage?.embeddings).toEqual({ completed: 0, total: 1, failed: 0 });
  });
  test('every suggested action names an executable that exists as a bin', () => {
    const packageJson = JSON.parse(readFileSync(join(coreRoot, 'package.json'), 'utf8')) as {
      bin: Record<string, string>;
    };
    const known = new Set(['cogmem', ...Object.keys(packageJson.bin)]);
    const source = readFileSync(join(coreRoot, 'src/factory.ts'), 'utf8');
    const callSites = [...source.matchAll(/suggestedAction\(\s*'([a-z_]+)',\s*'([^']+)'/g)].map((match) => ({
      kind: match[1],
      executable: match[2],
    }));
    // Eight kinds can be emitted; a silent drop to fewer means the scan lost the call sites.
    expect(callSites.length).toBeGreaterThanOrEqual(8);
    const unknown = callSites.filter((site) => !known.has(site.executable));
    expect(unknown).toEqual([]);
  });

});
