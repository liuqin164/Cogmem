import { describe, expect, test } from 'bun:test';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createMemoryKernel } from '../src/factory.js';
import { listCogmemMcpTools } from '../src/mcp/CoreMcpTools.js';
import { DeepWriteCandidateStore } from '../src/store/DeepWriteCandidateStore.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * `deep_write_candidate_reviews` is append-only evidence, so every column it records has to be
 * something the action actually read. It used to record the raw input instead: `approve
 * --target-belief X` stamped `target_belief_id = X` on a row for a review that never bound
 * anything, `reject --review-after T` recorded a deferral that never happened, and `supersede
 * --confirmation-event E` claimed user evidence for the one action that never asks for it.
 *
 * The contract these tests hold: an input outside the action's consumed set is rejected with
 * `review_input_not_applicable:<field>` and nothing is written, so a row can only ever describe
 * what happened.
 */

const root = join(import.meta.dir, '..');
const memoryBin = join(root, 'src', 'bin', 'memory.ts');
const PROJECT = 'review-audit-inputs';
const BELIEF = 'belief-active';
const REPLACEMENT = 'cand-replacement';

type Action = 'approve' | 'reject' | 'defer' | 'supersede' | 'relink';
type Field = 'confirmationEventId' | 'targetBeliefId' | 'replacementCandidateId' | 'reviewAfter';

const ACTIONS: Action[] = ['approve', 'reject', 'defer', 'supersede', 'relink'];
const FIELDS: Field[] = ['confirmationEventId', 'targetBeliefId', 'replacementCandidateId', 'reviewAfter'];
/** Mirrors the service table on purpose: if the implementation widens or narrows, these fail. */
const CONSUMED: Record<Action, Field[]> = {
  approve: ['confirmationEventId'],
  reject: [],
  defer: ['reviewAfter'],
  supersede: ['replacementCandidateId'],
  relink: ['confirmationEventId', 'targetBeliefId'],
};

function valueFor(field: Field): string | number {
  if (field === 'reviewAfter') return Date.now() + 24 * 60 * 60 * 1000;
  if (field === 'targetBeliefId') return BELIEF;
  if (field === 'replacementCandidateId') return REPLACEMENT;
  return 'evt-confirm';
}

function seed(dbPath: string, candidateIds: string[]): void {
  const kernel = createMemoryKernel({ dbPath });
  try {
    kernel.eventStore.append({
      eventId: 'evt-confirm', streamId: 'session-1', streamType: 'thread', eventType: 'MESSAGE',
      rawEventType: 'message', projectId: PROJECT, role: 'user', payload: { text: '我确认这条结论有效。' },
    });
    const db = kernel.factStore.getDatabase();
    db.prepare(`INSERT OR IGNORE INTO beliefs (id, project_id, scope, subject, predicate, object_value, canonical_key, confidence, trust_score, source_type, validity_kind, valid_from, status, created_at, updated_at)
      VALUES (?, ?, 'project', 'svc', 'runs_on', 'bun', 'svc::runs_on', 0.9, 0.9, 'user_input', 'open', ?, 'active', ?, ?)`)
      .run(BELIEF, PROJECT, 1_700_000_000_000, 1_700_000_000_000, 1_700_000_000_000);
    const store = new DeepWriteCandidateStore(db);
    store.insertRun({ runId: 'run-replacement', projectId: PROJECT, sourceNeuronIds: ['evt-confirm'], mode: 'episode', promptHash: 'p', outputHash: 'o', status: 'succeeded' });
    store.insertCandidates([{
      candidateId: REPLACEMENT, runId: 'run-replacement', candidateType: 'semantic_tags',
      status: 'needs_confirmation', confidence: 0.8, content: { topicPath: 'audit/replacement' },
      evidence: [{ eventId: 'evt-confirm', role: 'user' }],
    }]);
    for (const candidateId of candidateIds) {
      const action = candidateId.split('-')[1];
      store.insertRun({ runId: `run-${candidateId}`, projectId: PROJECT, sourceNeuronIds: ['evt-confirm'], mode: 'episode', promptHash: 'p', outputHash: 'o', status: 'succeeded' });
      store.insertCandidates([{
        candidateId, runId: `run-${candidateId}`,
        candidateType: action === 'relink' ? 'correction' : 'semantic_tags',
        status: 'needs_confirmation', confidence: 0.8,
        content: action === 'relink' ? { correctedClaimKey: null, correctedBeliefCandidateIds: [] } : { topicPath: 'audit/input' },
        evidence: [{ eventId: 'evt-confirm', role: 'user' }],
      }]);
    }
  } finally {
    kernel.close();
  }
}

function reviewRows(kernel: ReturnType<typeof createMemoryKernel>, candidateId: string): Array<Record<string, unknown>> {
  return kernel.factStore.getDatabase().prepare(`SELECT action, confirmation_event_id, target_belief_id,
    replacement_candidate_id, review_after FROM deep_write_candidate_reviews WHERE candidate_id=?`)
    .all(candidateId) as Array<Record<string, unknown>>;
}

function candidateStatus(kernel: ReturnType<typeof createMemoryKernel>, candidateId: string): string | undefined {
  return new DeepWriteCandidateStore(kernel.factStore.getDatabase()).getCandidate(candidateId)?.status;
}

async function run(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({ cmd: ['bun', memoryBin, ...args], stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

/** Async-safe: the temp dir outlives the awaited body, which the CLI case needs. */
async function withDb<T>(candidateIds: string[], body: (dbPath: string) => Promise<T> | T): Promise<T> {
  const dir = makeTempDir('cogmem-review-audit-inputs-');
  const dbPath = join(dir, 'memory.db');
  try {
    seed(dbPath, candidateIds);
    return await body(dbPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('candidate review records only the inputs its action consumes', () => {
  test('every unconsumed input is rejected by name and writes nothing', async () => {
    const ids = ACTIONS.flatMap((action) => FIELDS.map((field) => `cand-${action}-${field}`));
    await withDb(ids, (dbPath) => {
      const kernel = createMemoryKernel({ dbPath });
      try {
        const rejections: string[] = [];
        for (const action of ACTIONS) {
          for (const field of FIELDS) {
            if (CONSUMED[action].includes(field)) continue;
            const candidateId = `cand-${action}-${field}`;
            const input: Record<string, unknown> = {
              candidateId, projectId: PROJECT, action, actor: 'operator', reason: 'probe',
            };
            // Every action's own required inputs are present, so the only reason to fail is the extra one.
            for (const consumed of CONSUMED[action]) input[consumed] = valueFor(consumed);
            input[field] = valueFor(field);
            try {
              kernel.reviewDreamCandidate(input as never);
              rejections.push(`${action}+${field}: accepted`);
            } catch (error) {
              rejections.push(`${action}+${field}: ${(error as Error).message}`);
            }
          }
        }
        const expected = ACTIONS.flatMap((action) => FIELDS
          .filter((field) => !CONSUMED[action].includes(field))
          .map((field) => `${action}+${field}: review_input_not_applicable:${field}`));
        expect(rejections).toEqual(expected);
        expect(rejections).toHaveLength(15);
        // Nothing was written and nothing moved: a rejected input cannot leave a half review.
        for (const candidateId of ids) {
          expect(reviewRows(kernel, candidateId)).toEqual([]);
          expect(candidateStatus(kernel, candidateId)).toBe('needs_confirmation');
        }
      } finally {
        kernel.close();
      }
    });
  });

  test('each action with exactly its consumed inputs succeeds and the audit row has no stray column', async () => {
    const ids = ACTIONS.map((action) => `cand-${action}-confirmationEventId`);
    await withDb(ids, (dbPath) => {
      const kernel = createMemoryKernel({ dbPath });
      try {
        const toStatus: Record<Action, string> = {
          approve: 'promoted', reject: 'rejected', defer: 'needs_confirmation',
          supersede: 'superseded', relink: 'promoted',
        };
        for (const action of ACTIONS) {
          const candidateId = `cand-${action}-confirmationEventId`;
          const input: Record<string, unknown> = { candidateId, projectId: PROJECT, action, actor: 'operator', reason: 'probe' };
          for (const consumed of CONSUMED[action]) input[consumed] = valueFor(consumed);
          const result = kernel.reviewDreamCandidate(input as never);
          expect(result.candidate.status).toBe(toStatus[action]);
          const rows = reviewRows(kernel, candidateId);
          expect(rows).toHaveLength(1);
          const row = rows[0];
          // The invariant: a column is populated only when the action read that input.
          expect({
            action: row.action,
            confirmation_event_id: row.confirmation_event_id,
            target_belief_id: row.target_belief_id,
            replacement_candidate_id: row.replacement_candidate_id,
            review_after: row.review_after === null ? null : 'set',
          }).toEqual({
            action,
            confirmation_event_id: CONSUMED[action].includes('confirmationEventId') ? 'evt-confirm' : null,
            target_belief_id: CONSUMED[action].includes('targetBeliefId') ? BELIEF : null,
            replacement_candidate_id: CONSUMED[action].includes('replacementCandidateId') ? REPLACEMENT : null,
            review_after: CONSUMED[action].includes('reviewAfter') ? 'set' : null,
          });
        }
      } finally {
        kernel.close();
      }
    });
  });

  test('the real CLI rejects an unconsumed flag and leaves the audit table empty', async () => {
    await withDb(['cand-approve-targetBeliefId'], async (dbPath) => {
      const rejected = await run(['review', '--db', dbPath, '--project', PROJECT, '--id', 'cand-approve-targetBeliefId',
        '--action', 'approve', '--actor', 'operator', '--reason', 'probe',
        '--confirmation-event', 'evt-confirm', '--target-belief', BELIEF, '--json']);
      expect({ exitCode: rejected.exitCode, stderr: rejected.stderr }).toEqual({
        exitCode: 1, stderr: 'review_input_not_applicable:targetBeliefId',
      });

      const kernel = createMemoryKernel({ dbPath });
      try {
        expect(reviewRows(kernel, 'cand-approve-targetBeliefId')).toEqual([]);
        expect(candidateStatus(kernel, 'cand-approve-targetBeliefId')).toBe('needs_confirmation');
      } finally {
        kernel.close();
      }

      const accepted = await run(['review', '--db', dbPath, '--project', PROJECT, '--id', 'cand-approve-targetBeliefId',
        '--action', 'approve', '--actor', 'operator', '--reason', 'probe',
        '--confirmation-event', 'evt-confirm', '--json']);
      expect({ exitCode: accepted.exitCode, stderr: accepted.stderr }).toEqual({ exitCode: 0, stderr: '' });

      const after = createMemoryKernel({ dbPath });
      try {
        const rows = reviewRows(after, 'cand-approve-targetBeliefId');
        expect(rows).toHaveLength(1);
        expect(rows[0].target_belief_id).toBeNull();
      } finally {
        after.close();
      }
    });
  });

  test('the MCP description and the CLI usage say the inputs are per action', () => {
    const tool = listCogmemMcpTools().find((entry) => entry.name === 'cogmem_candidate_review');
    expect(tool?.description).toContain('review_input_not_applicable');
    expect(tool?.description).toContain('does not consume');
    const usage = readFileSync(join(root, 'src', 'bin', 'memory.ts'), 'utf8');
    expect(usage).toContain('an input the chosen action does not consume is rejected, not recorded');
  });
});
