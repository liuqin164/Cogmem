import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { defaultPublicEntrypoint } from '../src/host/openclaw/AutoMemoryPluginInstaller.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #53 acceptance: a fresh clone that has not been built must get a clear
 * "build first" error from the OpenClaw installer, not a plugin entry pointing
 * at a file that does not exist.
 *
 * `dist/` is no longer tracked, so the fallback branch is the one an unbuilt
 * checkout takes. The base directory is supplied because the real module lives
 * under `src/host/openclaw`, whose sibling `dist/` may or may not exist depending
 * on whether the suite ran after a build.
 */
describe('#53 OpenClaw plugin entry needs a build', () => {
  test('an unbuilt checkout is refused with a message naming the build command', () => {
    const empty = makeTempDir('cogmem-unbuilt-');
    const here = join(empty, 'src', 'host', 'openclaw');

    expect(existsSync(join(empty, 'dist', 'public.js'))).toBe(false);
    expect(() => defaultPublicEntrypoint(here)).toThrow(/dist\/public\.js is missing/);
    // The message has to name the fix, or the operator has nowhere to go.
    expect(() => defaultPublicEntrypoint(here)).toThrow(/bun run build/);
  });

  test('a built checkout resolves the entry instead of throwing', () => {
    const built = makeTempDir('cogmem-built-');
    const here = join(built, 'src', 'host', 'openclaw');
    const entry = join(built, 'dist', 'public.js');
    mkdirSync(join(built, 'dist'), { recursive: true });
    writeFileSync(entry, 'export {};\n');

    expect(defaultPublicEntrypoint(here)).toBe(entry);
  });
});
