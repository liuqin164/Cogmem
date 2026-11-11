import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';

import { MemoryObservatory } from '../src/observatory/MemoryObservatory.js';

/**
 * #188: the recall list's project/agent scope is the SQL's, before the LIMIT.
 *
 * On a database shared by several projects the old read fetched `min(limit * 2, 1000)` newest rows
 * first and dropped what it would not show afterwards, so a project whose decisions all sat behind
 * that window came back short of `limit` — or empty. The fixture below is exactly that: the target's
 * matching rows are the oldest, the other project fills the window, and the acceptance is a full page
 * of the target's decisions. Order and row shape are not re-decided here; the ids are checked in the
 * order the read promises.
 */

const TARGET = 'project-target';
const OTHER = 'project-other';
const LIMIT = 5;
/** More newer decoy rows than one fetch window (`limit * 2`), so a post-filter read saw none of them. */
const DECOYS = 40;

function newObservatory(): { db: Database; observatory: MemoryObservatory } {
  const db = new Database(':memory:');
  // `readRecalls` reads its watermark off this table; everything else the recall page touches is
  // `trace_events`, hand-built like the production table (#187).
  db.exec(`CREATE TABLE memory_events (global_seq INTEGER)`);
  db.exec(`CREATE TABLE trace_events (
    id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, task_id TEXT, project_id TEXT,
    event_type TEXT NOT NULL, payload TEXT NOT NULL, parent_event_id TEXT)`);
  return { db, observatory: new MemoryObservatory({ db }) };
}

function insertTrace(db: Database, id: string, project: string | null, timestamp: number, payload: unknown = {}): void {
  db.query(`INSERT INTO trace_events (id, timestamp, task_id, project_id, event_type, payload, parent_event_id)
            VALUES (?, ?, NULL, ?, 'recall.result', ?, NULL)`)
    .run(id, timestamp, project, JSON.stringify(payload));
}

describe('the recall list scopes in SQL, before the LIMIT (#188)', () => {
  test('a project behind the fetch window still gets a full page', () => {
    const { db, observatory } = newObservatory();
    for (let i = 1; i <= DECOYS; i += 1) insertTrace(db, `other-${i}`, OTHER, 2_000 + i);
    for (let i = 1; i <= LIMIT; i += 1) insertTrace(db, `target-${i}`, TARGET, 1_000 + i);
    expect(DECOYS).toBeGreaterThan(LIMIT * 2); // the window cannot reach the target rows

    const page = observatory.recalls({ projectId: TARGET, limit: LIMIT });
    expect(page.available).toBe(true);
    expect(page.recalls.map((recall) => recall.recallId)).toEqual([
      'target-5', 'target-4', 'target-3', 'target-2', 'target-1',
    ]);
  });

  test('an agent scope behind the fetch window still gets a full page', () => {
    const { db, observatory } = newObservatory();
    for (let i = 1; i <= DECOYS; i += 1) insertTrace(db, `pi-${i}`, TARGET, 2_000 + i, { agentId: 'pi' });
    for (let i = 1; i <= LIMIT; i += 1) insertTrace(db, `hermes-${i}`, TARGET, 1_000 + i, { agentId: 'hermes' });

    const hers = observatory.recalls({ projectId: TARGET, agent: 'hermes', limit: LIMIT });
    expect(hers.recalls.map((recall) => recall.recallId)).toEqual([
      'hermes-5', 'hermes-4', 'hermes-3', 'hermes-2', 'hermes-1',
    ]);
    // Control: without the agent scope the newest rows are the decoys, which is what the scope is
    // spending the budget to exclude.
    const merged = observatory.recalls({ projectId: TARGET, limit: LIMIT });
    expect(merged.recalls.map((recall) => recall.recallId)).toEqual(['pi-40', 'pi-39', 'pi-38', 'pi-37', 'pi-36']);
  });
});

describe('the SQL scope is the same predicate the row filter was (#188)', () => {
  test('one project, no filter: same rows, same order, same count', () => {
    const { db, observatory } = newObservatory();
    insertTrace(db, 'plain', TARGET, 100, {});
    insertTrace(db, 'hermes', TARGET, 200, { agentId: 'hermes' });
    insertTrace(db, 'array', TARGET, 300, [1, 2]);
    insertTrace(db, 'malformed', TARGET, 400);
    db.query(`UPDATE trace_events SET payload = 'not json' WHERE id = 'malformed'`).run();
    insertTrace(db, 'numeric', TARGET, 500, { agentId: 42 });

    const all = observatory.recalls({ projectId: TARGET, limit: 10 });
    expect(all.recalls.map((recall) => recall.recallId)).toEqual(['numeric', 'malformed', 'array', 'hermes', 'plain']);

    // A row that names no *string* agent is project-level and passes the scope: a malformed payload,
    // an array, and a numeric id all read the way `recallNamesAgent` read them.
    expect(observatory.recalls({ projectId: TARGET, agent: 'hermes', limit: 10 })
      .recalls.map((recall) => recall.recallId)).toEqual(['numeric', 'malformed', 'array', 'hermes', 'plain']);
    expect(observatory.recalls({ projectId: TARGET, agent: 'pi', limit: 10 })
      .recalls.map((recall) => recall.recallId)).toEqual(['numeric', 'malformed', 'array', 'plain']);
  });

  test('an unowned row is project-level and stays in every project read', () => {
    const { db, observatory } = newObservatory();
    insertTrace(db, 'unowned', null, 100, {});
    insertTrace(db, 'target', TARGET, 200, {});
    insertTrace(db, 'other', OTHER, 300, {});
    // Empty is read as unowned too, which is what the row filter's truthiness test did (#188).
    insertTrace(db, 'empty-project', '', 400, {});

    expect(observatory.recalls({ projectId: TARGET, limit: 10 }).recalls.map((recall) => recall.recallId))
      .toEqual(['empty-project', 'target', 'unowned']);
    expect(observatory.recalls({ projectId: OTHER, limit: 10 }).recalls.map((recall) => recall.recallId))
      .toEqual(['empty-project', 'other', 'unowned']);
  });
});
