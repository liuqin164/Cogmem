import { existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A worker killed with SIGKILL cannot run its exit hook; sweep its leftovers before this run starts.
// The prefix list has to cover every prefix `makeTempDir` is called with, or that family accumulates
// one directory per run (the `companion-probe-` family did, one per probe test invocation).
const ROOTS = ['companion-shell-test-', 'companion-shell-baseline-', 'companion-kill-', 'companion-probe-', 'pi-channel-', 'pi-detach-'];
const root = tmpdir();
if (existsSync(root)) {
  for (const entry of readdirSync(root)) {
    if (ROOTS.some((prefix) => entry.startsWith(prefix))) rmSync(join(root, entry), { recursive: true, force: true });
  }
}
