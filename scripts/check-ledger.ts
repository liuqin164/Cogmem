/**
 * Compare the issue ledger in `docs/engineering/4.0-issue-loop.md` against GitHub.
 *
 * The ledger is the recovery point: a round starts by reading it instead of trusting a
 * conversation. That makes a stale row a real defect — it sends the next round to redo
 * finished work, or to believe an open issue is closed. This script exists because that
 * had already happened: five closed issues were still listed as open, and four more as
 * in-progress.
 *
 * It reads the state GitHub reports and the state the table claims, and reports any row
 * where the two disagree. It is deliberately not a CI test: it needs `gh` and network,
 * and a check that fails for want of a network is one people learn to ignore. Run it at
 * the end of a round that touches the ledger:
 *
 *     bun run ledger:check
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LEDGER = join(import.meta.dir, '..', 'docs', 'engineering', '4.0-issue-loop.md');

interface Row { issue: number; claimed: string; line: number }

function rows(markdown: string): Row[] {
  // Only §3: earlier sections have their own tables, and one of them is keyed by the
  // same issue numbers for a different purpose. Reading the whole file compared rows
  // that were never claims about state.
  const start = markdown.indexOf('## 3.');
  const end = markdown.indexOf('## 4.', start);
  if (start < 0 || end < 0) return [];
  const section = markdown.slice(start, end);
  const found: Row[] = [];
  for (const [index, line] of section.split('\n').entries()) {
    // `| #68 不暴露共享记忆工具 | 4.0 | **已完成 / CLOSED** | …`
    const match = /^\|\s*#(\d+)\s[^|]*\|\s*[^|]*\|\s*([^|]*)\|/.exec(line);
    if (match) found.push({ issue: Number(match[1]), claimed: match[2]!.trim(), line: index + start });
  }
  return found;
}

/** A row says the issue is finished when it claims one of these. */
function claimsClosed(claimed: string): boolean {
  return /已完成|已关|CLOSED/.test(claimed);
}

async function main(): Promise<void> {
  const table = rows(readFileSync(LEDGER, 'utf8'));
  if (table.length === 0) {
    console.error('ledger:check — no rows parsed from §3; the table shape changed.');
    process.exitCode = 1;
    return;
  }

  const proc = Bun.spawn({
    cmd: ['gh', 'issue', 'list', '--state', 'all', '--limit', '200', '--json', 'number,state'],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if ((await proc.exited) !== 0) {
    console.error(`ledger:check — gh failed, so nothing was compared: ${stderr.trim().slice(0, 200)}`);
    process.exitCode = 1;
    return;
  }

  const actual = new Map<number, string>();
  for (const entry of JSON.parse(stdout) as Array<{ number: number; state: string }>) {
    actual.set(entry.number, entry.state);
  }

  const problems: string[] = [];
  for (const row of table) {
    const state = actual.get(row.issue);
    if (state === undefined) {
      problems.push(`#${row.issue} (line ${row.line}): the ledger names an issue GitHub does not return`);
      continue;
    }
    const closed = state === 'CLOSED';
    if (closed !== claimsClosed(row.claimed)) {
      problems.push(`#${row.issue} (line ${row.line}): ledger says "${row.claimed}", GitHub says ${state}`);
    }
  }

  if (problems.length > 0) {
    console.error(`ledger:check — ${problems.length} row(s) disagree with GitHub:`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(`ledger:check — ${table.length} rows match GitHub.`);
}

if (import.meta.main) await main();
