import { readFileSync } from 'node:fs';

const packageMetadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown };

if (typeof packageMetadata.version !== 'string' || !packageMetadata.version.trim()) {
  throw new Error('invalid_package_version');
}

export const CORE_VERSION = packageMetadata.version;
