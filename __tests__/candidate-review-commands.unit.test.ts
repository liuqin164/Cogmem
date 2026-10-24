import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryKernel } from '../src/factory.js';
import { listCogmemMcpTools } from '../src/mcp/CoreMcpTools.js';
import { DeepWriteCandidateStore } from '../src/store/DeepWriteCandidateStore.js';

/**
 * `memory plan` and `memory govern --status needs_confirmation` both hand the caller the
 * command to run next. One shape used to be printed for five actions whose required flags
 * differ, so approve, defer and relink all failed on the operator's first paste
 * (`confirmation_event_required`, `review_after_must_never_in_the_future`,
 * `target_belief_not_active_in_project`). These tests hold the per-action shapes to two
 * facts: each one parses through the real CLI, and each one actually runs.
 */

const root = join(import.meta.dir, '..');
const memoryBin = join(root, 'src', 'bin', 'memory.ts');
const PROJECT = 'review-shapes';
/** `defer` rejects a past `--review-after`, so this has to be computed, not frozen. */
const FUTURE_EPOCH_MS = Date.now() + 24 * 60 * 60 * 1000;
/** The candidate a supersede points at. Deliberately not one of the five reviewed candidates. */
const REPLACEMENT_CANDIDATE_ID = 'cand-replacement';

type Shape = { action: string; command: string };

function seededCandidateId(action: string, suffix = ''): string {
  return `cand-${action}${suffix}`;
}

function seed(dbPath: string, actions: string[], suffix = ''): void {
  const kernel = createMemoryKernel({ dbPath });
  try {
    kernel.eventStore.append({
      eventId: 'evt-confirm', streamId: 'session-1', streamType: 'thread', eventType: 'MESSAGE',
      rawEventType: 'message', projectId: PROJECT, role: 'user', payload: { text: '我确认这条结论有效。' },
    });
    const db = kernel.factStore.getDatabase();
    db.prepare(`INSERT OR IGNORE INTO beliefs (id, project_id, scope, subject, predicate, object_value, canonical_key, confidence, trust_score, source_type, validity_kind, valid_from, status, created_at, updated_at)
      VALUES ('belief-active', ?, 'project', 'svc', 'runs_on', 'bun', 'svc::runs_on', 0.9, 0.9, 'user_input', 'open', ?, 'active', ?, ?)`)
      .run(PROJECT, 1_700_000_000_000, 1_700_000_000_000, 1_700_000_000_000);
    const store = new DeepWriteCandidateStore(db);
    for (const action of actions) {
      const candidateId = seededCandidateId(action, suffix);
      store.insertRun({ runId: `run-${action}${suffix}`, projectId: PROJECT, sourceNeuronIds: ['evt-confirm'], mode: 'episode', promptHash: 'p', outputHash: 'o', status: 'succeeded' });
      store.insertCandidates([{
        candidateId, runId: `run-${action}${suffix}`,
        candidateType: action === 'relink' ? 'correction' : 'semantic_tags',
        status: 'needs_confirmation', confidence: 0.8,
        content: { topicPath: 'review/shape' },
        evidence: [{ eventId: 'evt-confirm', role: 'user' }],
      }]);
    }
    // supersede names a candidate other than the one being closed; the shape needs one to point at.
    store.insertRun({ runId: 'run-replacement', projectId: PROJECT, sourceNeuronIds: ['evt-confirm'], mode: 'episode', promptHash: 'p', outputHash: 'o', status: 'succeeded' });
    store.insertCandidates([{
      candidateId: REPLACEMENT_CANDIDATE_ID, runId: 'run-replacement', candidateType: 'semantic_tags',
      status: 'needs_confirmation', confidence: 0.8,
      content: { topicPath: 'review/shape' }, evidence: [{ eventId: 'evt-confirm', role: 'user' }],
    }]);
    // A same-shaped candidate in another project, for the project-scope rejection.
    store.insertRun({ runId: 'run-foreign', projectId: 'review-shapes-other', sourceNeuronIds: ['evt-confirm'], mode: 'episode', promptHash: 'p', outputHash: 'o', status: 'succeeded' });
    store.insertCandidates([{
      candidateId: 'cand-foreign', runId: 'run-foreign', candidateType: 'semantic_tags',
      status: 'needs_confirmation', confidence: 0.8,
      content: { topicPath: 'review/shape' }, evidence: [{ eventId: 'evt-confirm', role: 'user' }],
    }]);
  } finally {
    kernel.close();
  }
}

async function run(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({ cmd: ['bun', memoryBin, ...args], stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

function withSeeded<T>(actions: string[], body: (dbPath: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-review-shapes-'));
  const dbPath = join(dir, 'memory.db');
  return (async () => {
    try {
      seed(dbPath, actions);
      return await body(dbPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
}

async function planShapes(dbPath: string): Promise<Shape[]> {
  const result = await run(['plan', '--db', dbPath, '--project', PROJECT, '--json']);
  expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: '' });
  const payload = JSON.parse(result.stdout) as {
    nextActions: Array<{ type: string; reviewCommands?: Shape[] }>;
  };
  const actions = payload.nextActions.filter((entry) => entry.reviewCommands !== undefined);
  expect(actions).toHaveLength(1);
  expect(actions[0].type).toBe('review_needs_confirmation');
  return actions[0].reviewCommands!;
}

async function governShapes(dbPath: string): Promise<Shape[]> {
  const result = await run(['govern', '--db', dbPath, '--project', PROJECT, '--status', 'needs_confirmation', '--json']);
  expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: '' });
  return (JSON.parse(result.stdout) as { reviewCommands: Shape[] }).reviewCommands;
}

/** Every `<placeholder>` this file knows how to fill. An unknown one fails the render. */
const PLACEHOLDERS: Record<string, (candidateId: string) => string> = {
  '<candidate-id>': (candidateId) => candidateId,
  '<replacement-candidate-id>': () => REPLACEMENT_CANDIDATE_ID,
  '<user-event-id>': () => 'evt-confirm',
  '<belief-id>': () => 'belief-active',
  '<epoch-ms>': () => String(FUTURE_EPOCH_MS),
  '<operator>': () => 'operator',
  '<reason>': () => 'reviewed by hand',
};

function render(command: string, candidateId: string): string {
  let out = command;
  for (const [placeholder, value] of Object.entries(PLACEHOLDERS)) {
    out = out.split(placeholder).join(value(candidateId));
  }
  const leftover = out.match(/<[^<>\s]+>/g);
  if (leftover) throw new Error(`unfilled placeholder in "${command}": ${leftover.join(', ')}`);
  return out;
}

function tokens(command: string): string[] {
  return command.split(/\s+/).filter(Boolean);
}

function flagValue(command: string, flag: string): string | undefined {
  const items = tokens(command);
  const at = items.indexOf(flag);
  return at >= 0 ? items[at + 1] : undefined;
}

describe('every review action gets a shape that runs', () => {
  test('plan and govern advertise the same five shapes, and each names its own action', async () => {
    await withSeeded(['approve', 'relink'], async (dbPath) => {
      const fromPlan = await planShapes(dbPath);
      const fromGovern = await governShapes(dbPath);
      expect(fromPlan.map((entry) => entry.action)).toEqual(['approve', 'reject', 'defer', 'supersede', 'relink']);
      // One source of truth: the two surfaces cannot drift apart.
      expect(fromGovern).toEqual(fromPlan);
      for (const { action, command } of fromPlan) {
        expect(tokens(command).slice(0, 3)).toEqual(['cogmem', 'memory', 'review']);
        expect(flagValue(command, '--action')).toBe(action);
        expect(flagValue(command, '--project')).toBe(PROJECT);
        expect(flagValue(command, '--actor')).toBe('<operator>');
        expect(flagValue(command, '--reason')).toBe('<reason>');
        expect(tokens(command).at(-1)).toBe('--json');
      }
    });
  });

  test('the flags each shape promises are the ones its action needs', async () => {
    await withSeeded(['approve', 'relink'], async (dbPath) => {
      const shapes = await planShapes(dbPath);
      const flags = (action: string, flag: string) => tokens(shapes.find((entry) => entry.action === action)!.command).includes(flag);
      expect(flags('approve', '--confirmation-event')).toBe(true);
      expect(flags('approve', '--review-after')).toBe(false);
      expect(flags('reject', '--confirmation-event')).toBe(false);
      expect(flags('defer', '--review-after')).toBe(true);
      expect(flags('defer', '--confirmation-event')).toBe(false);
      expect(flags('supersede', '--confirmation-event')).toBe(false);
      expect(flags('supersede', '--replacement')).toBe(true);
      expect(flags('relink', '--confirmation-event')).toBe(true);
      expect(flags('relink', '--target-belief')).toBe(true);
    });
  });

  test('all five shape commands run to completion on a real database', async () => {
    const actions = ['approve', 'reject', 'defer', 'supersede', 'relink'];
    await withSeeded(actions, async (dbPath) => {
      const shapes = await planShapes(dbPath);
      const outcomes: Record<string, { exitCode: number; stderr: string; status?: string; reviewAfter?: number; targetBeliefId?: unknown }> = {};
      const targets: Record<string, { promotionTargetType?: string; promotionTargetId?: string }> = {};
      for (const action of actions) {
        const shape = shapes.find((entry) => entry.action === action)!;
        const result = await run([...tokens(render(shape.command, seededCandidateId(action))).slice(2), '--db', dbPath]);
        const candidate = result.exitCode === 0
          ? (JSON.parse(result.stdout) as {
            reviewedCandidate: { status: string; reviewAfter?: number; promotionTargetType?: string; promotionTargetId?: string; content?: { targetBeliefId?: string } };
          }).reviewedCandidate
          : undefined;
        outcomes[action] = {
          exitCode: result.exitCode,
          stderr: result.stderr,
          status: candidate?.status,
          reviewAfter: candidate?.reviewAfter,
          targetBeliefId: candidate?.content?.targetBeliefId,
        };
        targets[action] = { promotionTargetType: candidate?.promotionTargetType, promotionTargetId: candidate?.promotionTargetId };
      }
      // The shape the CLI prints is the shape that works: no action is aspirational.
      expect(outcomes).toEqual({
        approve: { exitCode: 0, stderr: '', status: 'promoted', reviewAfter: undefined, targetBeliefId: undefined },
        reject: { exitCode: 0, stderr: '', status: 'rejected', reviewAfter: undefined, targetBeliefId: undefined },
        defer: { exitCode: 0, stderr: '', status: 'needs_confirmation', reviewAfter: FUTURE_EPOCH_MS, targetBeliefId: undefined },
        supersede: { exitCode: 0, stderr: '', status: 'superseded', reviewAfter: undefined, targetBeliefId: undefined },
        relink: { exitCode: 0, stderr: '', status: 'promoted', reviewAfter: undefined, targetBeliefId: 'belief-active' },
      });
      // The advertised supersede shape must land on the replacement it names, not on the
      // degenerate manual_review target it used to fall back to when no replacement was given.
      expect(targets.supersede).toEqual({ promotionTargetType: 'replacement_candidate', promotionTargetId: REPLACEMENT_CANDIDATE_ID });
      const untouched = JSON.parse((await run(['candidates', '--db', dbPath, '--status', 'needs_confirmation', '--json'])).stdout) as {
        candidates?: Array<{ candidateId: string; status: string }>;
      };
      expect(untouched.candidates?.some((entry) => entry.candidateId === REPLACEMENT_CANDIDATE_ID && entry.status === 'needs_confirmation')).toBe(true);
    });
  });

  test('dropping the flag a shape adds flips the run into the rejection it exists to prevent', async () => {
    const actions = ['approve', 'defer', 'relink'];
    await withSeeded(actions, async (dbPath) => {
      const shapes = await planShapes(dbPath);
      const drops: Array<[string, string, string]> = [
        ['approve', '--confirmation-event', 'confirmation_event_required'],
        ['defer', '--review-after', 'review_after_must_be_in_the_future'],
        ['relink', '--target-belief', 'target_belief_not_active_in_project'],
      ];
      for (const [action, flag, expected] of drops) {
        const shape = shapes.find((entry) => entry.action === action)!;
        const items = tokens(render(shape.command, seededCandidateId(action)));
        const at = items.indexOf(flag);
        expect(at).toBeGreaterThan(-1);
        const stripped = [...items.slice(0, at), ...items.slice(at + 2)];
        const result = await run([...stripped.slice(2), '--db', dbPath]);
        expect(`${action} without ${flag}: ${result.exitCode} ${result.stderr}`).toBe(`${action} without ${flag}: 1 ${expected}`);
      }
    });
  });

  test('the shapes agree with the five review lines shipped to hosts', async () => {
    // Every flag a shape adds is a requirement the host has to be told about, so the runtime
    // shape and both shipped runbooks must agree on all four of them.
    const flags = ['--confirmation-event', '--target-belief', '--review-after', '--replacement'];
    await withSeeded(['approve', 'relink'], async (dbPath) => {
      const shapes = await planShapes(dbPath);
      for (const runbookPath of [
        join(root, 'examples', 'hermes-backend', 'references', 'operations.md'),
        join(root, 'examples', 'openclaw-backend', 'references', 'operations.md'),
      ]) {
        const runbook = readFileSync(runbookPath, 'utf8');
        for (const flag of flags) {
          for (const { action, command } of shapes) {
            const documented = runbook.split('\n')
              .find((line) => line.startsWith('cogmem memory review ') && line.includes(`--action ${action} `));
            expect(documented).toBeDefined();
            expect({ runbook: runbookPath.split('/').at(-4), action, flag, doc: documented!.includes(flag), runtime: tokens(command).includes(flag) })
              .toEqual({ runbook: runbookPath.split('/').at(-4), action, flag, doc: tokens(command).includes(flag), runtime: tokens(command).includes(flag) });
          }
        }
      }
    });
  });

  test('the replacement is documented as a different candidate, not as a second <candidate-id>', async () => {
    // Both runbooks used to write `--id <candidate-id> ... --replacement <candidate-id>`, so an
    // operator filling in one id made the candidate supersede itself. That line is now rejected
    // by the service, which makes the old placeholder a documented way to fail.
    await withSeeded(['supersede'], async (dbPath) => {
      const shapes = await planShapes(dbPath);
      const shape = shapes.find((entry) => entry.action === 'supersede')!;
      expect(flagValue(shape.command, '--replacement')).toBe('<replacement-candidate-id>');
      expect(flagValue(shape.command, '--replacement')).not.toBe(flagValue(shape.command, '--id'));
      for (const runbookPath of [
        join(root, 'examples', 'hermes-backend', 'references', 'operations.md'),
        join(root, 'examples', 'openclaw-backend', 'references', 'operations.md'),
      ]) {
        const line = readFileSync(runbookPath, 'utf8').split('\n')
          .find((entry) => entry.startsWith('cogmem memory review ') && entry.includes('--action supersede '))!;
        const items = tokens(line);
        expect(items[items.indexOf('--replacement') + 1]).not.toBe(items[items.indexOf('--id') + 1]);
      }
    });
  });

  test('a named replacement must be a different candidate in the same project', async () => {
    await withSeeded(['supersede'], async (dbPath) => {
      const reviewed = seededCandidateId('supersede');
      const base = ['review', '--project', PROJECT, '--id', reviewed, '--action', 'supersede', '--actor', 'operator', '--reason', 'duplicate'];
      const rejections = {
        self: await run([...base, '--replacement', reviewed, '--db', dbPath]),
        foreignProject: await run([...base, '--replacement', 'cand-foreign', '--db', dbPath]),
        missing: await run([...base, '--replacement', 'cand-nope', '--db', dbPath]),
      };
      expect({
        self: { exitCode: rejections.self.exitCode, stderr: rejections.self.stderr },
        foreignProject: { exitCode: rejections.foreignProject.exitCode, stderr: rejections.foreignProject.stderr },
        // Not found and wrong project share one code: neither names a candidate in this project.
        missing: { exitCode: rejections.missing.exitCode, stderr: rejections.missing.stderr },
      }).toEqual({
        self: { exitCode: 1, stderr: 'replacement_candidate_must_differ' },
        foreignProject: { exitCode: 1, stderr: 'replacement_candidate_project_mismatch' },
        missing: { exitCode: 1, stderr: 'replacement_candidate_project_mismatch' },
      });
      // A rejected supersede must leave the candidate where it was: still awaiting review.
      const queue = JSON.parse((await run(['candidates', '--db', dbPath, '--status', 'needs_confirmation', '--json'])).stdout) as {
        candidates?: Array<{ candidateId: string; status: string }>;
      };
      expect(queue.candidates?.some((entry) => entry.candidateId === reviewed && entry.status === 'needs_confirmation')).toBe(true);
    });
  });

  test('supersede without a replacement is rejected instead of naming itself', async () => {
    // The old fallback wrote `promotion_target_type: 'manual_review'` with the candidate's own id
    // as the target, so "what replaced this?" answered with the row the review had just closed.
    await withSeeded(['supersede'], async (dbPath) => {
      const reviewed = seededCandidateId('supersede');
      const omitted = await run(['review', '--db', dbPath, '--project', PROJECT, '--id', reviewed,
        '--action', 'supersede', '--actor', 'operator', '--reason', 'obsolete']);
      expect({ exitCode: omitted.exitCode, stderr: omitted.stderr }).toEqual({
        exitCode: 1, stderr: 'replacement_candidate_required',
      });
      // Nothing was written: still awaiting review, and no promotion target at all.
      const queue = JSON.parse((await run(['candidates', '--db', dbPath, '--status', 'needs_confirmation', '--json'])).stdout) as {
        candidates?: Array<{ candidateId: string; status: string; promotionTargetType?: string; promotionTargetId?: string }>;
      };
      const still = queue.candidates?.find((entry) => entry.candidateId === reviewed);
      expect(still?.status).toBe('needs_confirmation');
      expect(still?.promotionTargetType).toBeUndefined();
      expect(still?.promotionTargetId).toBeUndefined();
      // The usage text says the flag is required, not optional.
      const usage = await run(['review', '--db', dbPath, '--project', PROJECT, '--id', reviewed]);
      expect(usage.exitCode).toBe(1);
      expect(usage.stderr).toContain('required for supersede');
    });
  });

  test('the MCP tool surface states the same per-action requirements it enforces', () => {
    const tool = listCogmemMcpTools().find((entry) => entry.name === 'cogmem_candidate_review');
    expect(tool).toBeDefined();
    const description = String(tool!.description);
    // Without these four sentences the model has to discover the requirements by failing.
    for (const fragment of ['confirmationEventId', 'targetBeliefId', 'reviewAfter', 'replacementCandidateId']) {
      expect(description).toContain(fragment);
    }
    expect(description).toContain('correction candidate');
    expect(description).toContain('epoch milliseconds');
    // A required input the description calls optional is a model that learns by failing.
    expect(description).toContain('supersede requires a replacementCandidateId');
    expect(description).toContain('replacement_candidate_required');
    expect(description).not.toContain('may name a replacementCandidateId');
    // reject needs nothing beyond the audited reason, and defer is not a way to skip evidence.
    expect(description).not.toContain('reject requires');
  });
});
