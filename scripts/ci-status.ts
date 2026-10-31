/**
 * What CI says about the commit you just pushed.
 *
 * The repo runs `prepublishOnly` (typecheck → build → test → pack) in
 * `.github/workflows/ci.yml` on every push to `feat/**`, so by the time a round
 * writes "CI was not run" the answer usually exists and nobody looked. Run this
 * instead of guessing:
 *
 *     bun run ci:status [commit]
 *
 * Exit code is 0 when every `verify` run succeeded, 1 when one did not. The
 * external Cloudflare build (`Workers Builds`) is reported but never gates: it
 * is not this repo's CI (ledger §1).
 */
import { execFileSync } from 'node:child_process';

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function repoSlug(): string {
  const remote = git(['remote', 'get-url', 'origin']);
  const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!match) throw new Error(`cannot read a GitHub repo from origin: ${remote}`);
  return `${match[1]}/${match[2]}`;
}

const sha = process.argv[2] || git(['rev-parse', 'HEAD']);
const rows = execFileSync('gh', [
  'api', `repos/${repoSlug()}/commits/${sha}/check-runs`,
  '--jq', '.check_runs[] | [.name, .status, .conclusion] | @tsv',
], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);

if (rows.length === 0) {
  console.log(`ci:status — no check runs for ${sha.slice(0, 7)} yet (pushed? a minute late?)`);
  process.exit(1);
}

const gating: Array<{ name: string; conclusion: string }> = [];
for (const row of rows) {
  const [name, status, conclusion] = row.split('\t');
  const external = /Workers Builds/i.test(name ?? '');
  console.log(`${(conclusion || status || 'unknown').padEnd(10)} ${name}${external ? '  (external, not this repo\'s CI)' : ''}`);
  if (!external) gating.push({ name: name ?? '', conclusion: conclusion ?? '' });
}

const running = gating.filter((run) => run.conclusion === '' || run.conclusion === undefined);
const failed = gating.filter((run) => run.conclusion !== '' && run.conclusion !== 'success');
const passed = gating.length - running.length - failed.length;
if (running.length > 0) console.log(`ci:status — ${sha.slice(0, 7)}: ${passed}/${gating.length} succeeded, ${running.length} still running`);
else console.log(`ci:status — ${sha.slice(0, 7)}: ${passed}/${gating.length} gating checks succeeded`);
process.exit(failed.length === 0 && running.length === 0 ? 0 : 1);
