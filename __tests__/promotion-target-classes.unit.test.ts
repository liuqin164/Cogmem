import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const glossaryPath = join(coreRoot, 'GLOSSARY.md');
const storePath = join(coreRoot, 'src/store/DeepWriteCandidateStore.ts');

// `promotion_target_id` carries three different kinds of value, and `GLOSSARY.md` plus the
// `updateCandidateStatus` doc comment have to name all three: a referent row id, a locator (event
// id or topic path), and nothing at all. This test runs a real curator over a real database,
// promotes for real, and compares the distribution it observes against what the docs enumerate.
// A doc that only lists referents tells a reader that `memory/auditability` is a belief id.

type Class = 'referent' | 'locator_event' | 'locator_topic' | 'empty' | 'self' | 'unknown';

const REFERENT_TABLES: Record<string, { table: string; column: string }> = {
  belief: { table: 'beliefs', column: 'id' },
  summary: { table: 'deep_write_summaries', column: 'summary_id' },
  entity: { table: 'entities', column: 'entity_id' },
  fact: { table: 'facts', column: 'fact_id' },
  graph_edge: { table: 'memory_edges', column: 'edge_id' },
  replacement_candidate: { table: 'deep_write_candidates', column: 'candidate_id' },
};

interface Observed {
  candidateType: string;
  status: string;
  targetType: string | null;
  targetId: string | null;
  klass: Class;
}

test('every promotion target a real curator writes falls in a class the docs name', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-promotion-classes-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  // The text is chosen so the deterministic organizer emits a topic path (no event id) and the
  // provider buckets emit the referent-bearing rows.
  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-promotion-classes',
    userText: 'CogMem 的记忆黑盒必须保留原话，不要丢掉 source locator，这是诊断问题的根因。',
    assistantText: '好，原始账本和 source locator 都留在候选里等治理。',
    ingestMode: 'raw_then_dream',
  });
  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-promotion-classes',
    userText: '记忆内核的策展候选不要自己指向自己，治理时要按 topicPath 落主题。',
    assistantText: '收到，候选只写真实 referent。',
    ingestMode: 'raw_then_dream',
  });

  const db = kernel.factStore.getDatabase();
  const events = db.prepare(
    `SELECT event_id, role FROM memory_events WHERE project_id='demo' ORDER BY global_seq ASC`
  ).all() as Array<{ event_id: string; role: string }>;
  const userIds = events.filter((event) => event.role === 'user').map((event) => event.event_id);
  expect(userIds.length).toBeGreaterThanOrEqual(2);
  const allIds = events.map((event) => event.event_id);

  await kernel.runDreamCurator({
    projectId: 'demo',
    generateText: async () => JSON.stringify({
      sessionSummaryCandidates: [{ summary: '本轮决定 CogMem 记忆黑盒保留原话。', confidence: 0.78, evidenceEventIds: allIds }],
      projectMemoryCandidates: [{ statement: 'CogMem 保留 raw ledger。', confidence: 0.8, evidenceEventIds: [userIds[0]] }],
      semanticTagCandidates: [{ tags: ['topic:cogmem'], confidence: 0.7, evidenceEventIds: [userIds[0]] }],
      indexingDecisionCandidates: [{ shouldEmbed: true, storeAs: 'semantic', confidence: 0.72, evidenceEventIds: [userIds[1]] }],
      diagnosticConclusionCandidates: [{ conclusion: 'provider 输出稳定。', confidence: 0.7, evidenceEventIds: [userIds[0]] }],
      boundaryCandidates: [{ statement: '不要丢掉原话。', confidence: 0.82, evidenceEventIds: [userIds[0]] }],
      userPreferenceCandidates: [{ statement: '偏好保留 source locator。', confidence: 0.85, evidenceEventIds: [userIds[0]] }],
    }),
  });
  kernel.promoteDreamCandidates({ projectId: 'demo', limit: 200 });

  const rows = db.prepare(
    `SELECT candidate_id, candidate_type, status, promotion_target_type, promotion_target_id
       FROM deep_write_candidates
       WHERE run_id IN (SELECT run_id FROM deep_write_runs WHERE project_id='demo')`
  ).all() as Array<{
    candidate_id: string;
    candidate_type: string;
    status: string;
    promotion_target_type: string | null;
    promotion_target_id: string | null;
  }>;

  const eventIds = new Set(allIds);
  const existsIn = (table: string, column: string, value: string): boolean => {
    try {
      return Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ?`).get(value));
    } catch {
      return false;
    }
  };

  const observed: Observed[] = rows.map((row) => {
    const id = row.promotion_target_id;
    const base = {
      candidateType: row.candidate_type,
      status: row.status,
      targetType: row.promotion_target_type,
      targetId: id,
    };
    if (!id) return { ...base, klass: 'empty' as Class };
    if (id === row.candidate_id) return { ...base, klass: 'self' as Class };
    if (eventIds.has(id)) return { ...base, klass: 'locator_event' as Class };
    if (id.includes('/')) return { ...base, klass: 'locator_topic' as Class };
    const referent = REFERENT_TABLES[row.promotion_target_type || ''];
    if (referent && existsIn(referent.table, referent.column, id)) {
      return { ...base, klass: 'referent' as Class };
    }
    return { ...base, klass: 'unknown' as Class };
  });

  kernel.close();

  const tally = (klass: Class): number => observed.filter((item) => item.klass === klass).length;
  const report = observed.map((item) => `${item.status} ${item.targetType ?? '(null)'} ${item.klass} ${item.targetId ?? '(none)'}`);

  // No row may point at itself, and no id may be unclassifiable.
  expect(report.filter((line) => line.includes(' self '))).toEqual([]);
  expect(observed.filter((item) => item.klass === 'unknown').map((item) => `${item.targetType}=${item.targetId}`)).toEqual([]);

  // Guard the guard: a seed that stops producing any of the three shapes would go green on an
  // empty scan, so require that this run actually exercised each of them.
  expect(tally('referent')).toBeGreaterThanOrEqual(3);
  expect(tally('locator_event')).toBeGreaterThanOrEqual(3);
  expect(tally('locator_topic')).toBeGreaterThanOrEqual(1);
  expect(tally('empty')).toBeGreaterThanOrEqual(1);
  expect(observed.length).toBeGreaterThanOrEqual(15);

  // A locator id must be an event id or a topic path; a referent id must resolve to a stored row.
  for (const item of observed) {
    if (item.klass === 'locator_event') expect(item.targetId?.startsWith('evt-')).toBe(true);
    if (item.klass === 'locator_topic') expect(item.targetId).toContain('/');
  }

  // Every type the real run produced has to be named where the three classes are described.
  const glossary = readFileSync(glossaryPath, 'utf8');
  const candidatesSection = glossary.slice(glossary.indexOf('### Candidates'));
  const storeSource = readFileSync(storePath, 'utf8');
  const docCommentStart = storeSource.indexOf('`promotionTarget.type` names one of three classes');
  expect(docCommentStart).toBeGreaterThan(-1);
  const docComment = storeSource.slice(docCommentStart, storeSource.indexOf('*/', docCommentStart));

  for (const doc of [candidatesSection, docComment]) {
    expect(doc).toContain('referent');
    expect(doc).toContain('locator');
    expect(doc).toContain('reason class');
    // `summary` used to be missing from the referent list even though the promotion policy writes it.
    expect(doc).toContain('summary');
    expect(doc).toContain('memory/auditability');
  }

  const observedTypes = [...new Set(observed.map((item) => item.targetType).filter((type): type is string => Boolean(type)))];
  expect(observedTypes.length).toBeGreaterThanOrEqual(5);
  for (const type of observedTypes) {
    expect(`${type} ${candidatesSection.includes(type)}`).toBe(`${type} true`);
    expect(`${type} ${docComment.includes(type)}`).toBe(`${type} true`);
  }
});
