import { describe, expect, test } from 'bun:test';
import { resolveLatestNpmSpec, resolveLatestReleaseSpec } from '../src/bin/update-release';

describe('cogmem update release resolution', () => {
  test('defaults update resolution to npm latest without network metadata', () => {
    expect(resolveLatestNpmSpec({ env: {} })).toBe('latest');
    expect(resolveLatestNpmSpec({ env: { COGMEM_NPM_SPEC: '3.6.3' } })).toBe('3.6.3');
    expect(resolveLatestNpmSpec({ env: { COGMEM_PACKAGE_SPEC: 'file:./cogmem.tgz' } })).toBe('file:./cogmem.tgz');
  });

  test('prefers a cogmem release tgz asset from the GitHub latest release payload', async () => {
    const spec = await resolveLatestReleaseSpec({
      repo: 'liuqin164/cogmem',
      fetchJson: async () => ({
        tag_name: '2.0.1',
        assets: [
          { name: 'checksums.txt', browser_download_url: 'https://github.com/liuqin164/cogmem/releases/download/2.0.1/checksums.txt' },
          { name: 'cogmem-2.0.1.tgz', browser_download_url: 'https://github.com/liuqin164/cogmem/releases/download/2.0.1/cogmem-2.0.1.tgz' },
        ],
      }),
    });

    expect(spec).toBe('https://github.com/liuqin164/cogmem/releases/download/2.0.1/cogmem-2.0.1.tgz');
  });

  test('falls back to the latest release tag when no package asset is attached', async () => {
    const spec = await resolveLatestReleaseSpec({
      repo: 'liuqin164/cogmem',
      fetchJson: async () => ({
        tag_name: '2.0.2',
        assets: [],
      }),
    });

    expect(spec).toBe('github:liuqin164/cogmem#2.0.2');
  });

  test('fails closed instead of installing main when release metadata is missing', async () => {
    const promise = resolveLatestReleaseSpec({
      repo: 'liuqin164/cogmem',
      fetchJson: async () => ({}),
    });

    await expect(promise).rejects.toThrow('latest_release_unavailable');
  });
});
