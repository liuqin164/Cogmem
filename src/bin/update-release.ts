export const DEFAULT_RELEASE_REPO = 'liuqin164/cogmem';
export const DEFAULT_NPM_PACKAGE = 'cogmem';

export interface ResolveLatestNpmSpecOptions {
  env?: Record<string, string | undefined>;
}

export interface ResolveLatestReleaseSpecOptions {
  repo?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  fetchJson?: (url: string) => Promise<unknown>;
}

interface GitHubReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
}

interface GitHubReleasePayload {
  tag_name?: unknown;
  assets?: unknown;
}

export function resolveLatestNpmSpec(options: ResolveLatestNpmSpecOptions = {}): string {
  const env = options.env || {};
  return env.COGMEM_NPM_SPEC?.trim()
    || env.COGMEM_PACKAGE_SPEC?.trim()
    || env.COGMEM_RELEASE_TARBALL?.trim()
    || 'latest';
}

export async function resolveLatestReleaseSpec(options: ResolveLatestReleaseSpecOptions = {}): Promise<string> {
  const env = options.env || {};
  const override = env.COGMEM_RELEASE_TARBALL?.trim();
  if (override) return override;

  const repo = options.repo || env.COGMEM_REPO || DEFAULT_RELEASE_REPO;
  const fetchJson = options.fetchJson || ((url: string) => fetchReleaseJson(url, options.timeoutMs ?? 10_000));
  const payload = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
  return resolveReleasePayloadSpec(payload, repo);
}

export function resolveReleasePayloadSpec(payload: unknown, repo: string = DEFAULT_RELEASE_REPO): string {
  const release = (payload && typeof payload === 'object') ? payload as GitHubReleasePayload : {};
  const assets = Array.isArray(release.assets) ? release.assets as GitHubReleaseAsset[] : [];
  const packageAsset = assets.find((asset) => isCogmemPackageAsset(asset));
  const packageUrl = typeof packageAsset?.browser_download_url === 'string'
    ? packageAsset.browser_download_url.trim()
    : '';
  if (packageUrl) return packageUrl;

  const tag = typeof release.tag_name === 'string' ? release.tag_name.trim() : '';
  if (tag) return `github:${repo}#${tag}`;
  throw new Error(`latest_release_unavailable: GitHub returned no release asset or tag for ${repo}. Retry later or pass --from explicitly.`);
}

async function fetchReleaseJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'cogmem-update',
      },
      signal: controller.signal,
    });
    if (!response.ok) return {};
    return await response.json();
  } catch {
    return {};
  } finally {
    clearTimeout(timeout);
  }
}

function isCogmemPackageAsset(asset: GitHubReleaseAsset): boolean {
  const name = typeof asset.name === 'string' ? asset.name : '';
  const url = typeof asset.browser_download_url === 'string' ? asset.browser_download_url : '';
  if (!url.endsWith('.tgz')) return false;
  return /cogmem/i.test(name) || /cogmem/i.test(url);
}
