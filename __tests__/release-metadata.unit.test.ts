import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = join(coreRoot, 'package.json');

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

function packageJson(): {
  name: string;
  version: string;
  scripts: Record<string, string>;
  exports: Record<string, { import: string; types: string }>;
  bin: Record<string, string>;
  files: string[];
} {
  return JSON.parse(readText(packageJsonPath));
}

describe('core release metadata', () => {
  test('2.0.0-rc.1 is GitHub-installable and not an npm publish release', () => {
    const manifest = packageJson();
    const readme = readText(join(coreRoot, 'README.md'));
    const contributing = readText(join(coreRoot, 'CONTRIBUTING.md'));
    const changelog = readText(join(coreRoot, 'CHANGELOG.md'));
    const checklist = readText(join(coreRoot, 'RELEASE_CHECKLIST.md'));

    expect(manifest.version).toBe('2.0.0-rc.1');
    expect(readme).toContain('GitHub');
    expect(readme).toContain('not published to npm');
    expect(contributing).toContain('npm pack --dry-run --json');
    expect(contributing).not.toContain('npm publish');
    expect(changelog).toContain('GitHub');
    expect(checklist).toContain('2.0.0-rc.1');
    expect(checklist).toContain('Do not run npm publish');
  });

  test('package exposes stable public exports and keeps internal on explicit subpath only', () => {
    const manifest = packageJson();

    expect(manifest.main).toBe('./dist/public.js');
    expect(manifest.types).toBe('./dist/public.d.ts');
    expect(Object.keys(manifest.exports).sort()).toEqual(['.', './internal']);
    expect(manifest.exports['.']).toEqual({
      import: './dist/public.js',
      types: './dist/public.d.ts',
    });
    expect(manifest.exports['./internal']).toEqual({
      import: './dist/internal.js',
      types: './dist/internal.d.ts',
    });
  });

  test('type command aliases the existing typecheck gate for Bun workspace filters', () => {
    const manifest = packageJson();

    expect(manifest.scripts.type).toBe(manifest.scripts.typecheck);
    expect(manifest.scripts.type).toContain('--noEmit');
  });

  test('every package CLI bin has a source entrypoint', () => {
    const manifest = packageJson();
    const expectedBins = [
      'cogmem',
      'cogmem-compact',
      'cogmem-connect',
      'cogmem-doctor',
      'cogmem-explain-recall',
      'cogmem-import-hermes',
      'cogmem-import-openclaw',
      'cogmem-init',
      'cogmem-mcp',
      'cogmem-memory',
      'cogmem-migrate-vectors',
      'cogmem-normalize-transcript',
      'cogmem-re-embed',
      'cogmem-snapshot',
      'cogmem-update',
    ];

    expect(Object.keys(manifest.bin).sort()).toEqual(expectedBins);
    for (const target of Object.values(manifest.bin)) {
      const source = target.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts');
      expect(existsSync(join(coreRoot, source))).toBe(true);
    }
  });

  test('release docs included in pack file whitelist', () => {
    const manifest = packageJson();

    expect(manifest.files).toContain('README.md');
    expect(manifest.files).toContain('MEMORY_MODEL.md');
    expect(manifest.files).toContain('RECALL_EXPLAINABILITY.md');
    expect(manifest.files).toContain('BENCHMARKS.md');
    expect(manifest.files).toContain('SECURITY.md');
    expect(manifest.files).toContain('CONTRIBUTING.md');
    expect(manifest.files).toContain('CHANGELOG.md');
    expect(manifest.files).toContain('RELEASE_CHECKLIST.md');
  });

  test('agent-facing docs describe chronological ledger, source anchors, and natural emergence metrics', () => {
    const memoryModel = readText(join(coreRoot, 'MEMORY_MODEL.md'));
    const explainability = readText(join(coreRoot, 'RECALL_EXPLAINABILITY.md'));
    const benchmarks = readText(join(coreRoot, 'BENCHMARKS.md'));

    expect(memoryModel).toContain('Chronological Memory Ledger');
    expect(memoryModel).toContain('Raw Archive');
    expect(memoryModel).toContain('Compiled Memory');
    expect(memoryModel).toContain('chronological order is not recall ranking');
    expect(memoryModel).toContain('sourceRefs');
    expect(memoryModel).toContain('not a vector RAG store');
    expect(memoryModel).toContain('rawEventType');
    expect(memoryModel).toContain('tool_result');
    expect(memoryModel).toContain('Normalized JSON array, JSONL, CSV, and TSV transcript imports');
    expect(explainability).toContain('sourceAnchor');
    expect(explainability).toContain('filteredEvidence');
    expect(explainability).toContain('same-project');
    expect(explainability).toContain('tool_call');
    expect(explainability).toContain('normalized JSON/CSV imports');
    expect(benchmarks).toContain('memory_natural_emergence');
    expect(benchmarks).toContain('critical_memory_recall_rate');
    expect(benchmarks).toContain('inhibition_correctness_rate');
  });
});
