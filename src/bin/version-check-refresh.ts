#!/usr/bin/env bun
import { runAutoUpgrade } from '../install/AutoUpgrade.js';
import { decideAutoUpgrade } from '../install/AutoUpgrade.js';
import { loadUpdateSettings, refreshUpdateCache } from '../install/VersionCheck.js';

/**
 * The detached half of the version check (#150).
 *
 * `cogmem` and `cogmem-mcp` start this and do not wait for it. Everything that
 * could take time — the registry read, and the staged upgrade when one is opted
 * in — happens here, out of the caller's way.
 *
 * It writes nothing to stdout or stderr. Its results are the cache file and, when
 * it stages an upgrade, the update log that `cogmem update` appends to. A check
 * that fails is a check that says nothing, which is the ticket's requirement and
 * also the only behaviour that cannot corrupt a host's JSON-RPC stream.
 */
async function main(): Promise<void> {
  const settings = loadUpdateSettings({});
  if (!settings.check) return;
  const cache = await refreshUpdateCache({});
  if (!cache.latestVersion) return;
  if (!decideAutoUpgrade(settings, cache.latestVersion).allowed) return;
  await runAutoUpgrade({ settings, latestVersion: cache.latestVersion });
}

main().catch(() => {
  // Silent by contract: nothing here is worth a line on a command that succeeded.
});
