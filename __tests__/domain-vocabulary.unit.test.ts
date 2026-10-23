import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const read = (file: string): string => readFileSync(join(root, file), 'utf8');

describe('domain vocabulary in the main documents', () => {
  test('MEMORY_MODEL defines Facet and Dimension and points at the glossary', () => {
    const model = read('MEMORY_MODEL.md');
    expect(model).toMatch(/\*\*Facets?\*\*/);
    expect(model).toMatch(/\*\*Dimensions?\*\*/);
    expect(model).toContain('GLOSSARY.md');
  });

  test('no main document still uses the retired phrase', () => {
    for (const file of ['MEMORY_MODEL.md', 'README.md']) {
      expect(read(file)).not.toContain('structure-first pulse navigation');
    }
  });

  test('README names both pulses', () => {
    const readme = read('README.md');
    expect(readme).toContain('Pulse 1');
    expect(readme).toContain('Pulse 2');
  });
});
