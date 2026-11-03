#!/usr/bin/env bun
/**
 * Measure what a full Memory Atlas rebuild costs on a real database, and how much of
 * it is the frame layer. Written for #110, whose cost premise came from a corpus with
 * no frames in it.
 *
 *   MEASURE_DB=/path/to/memory.db [MEASURE_PROJECT=p] [MEASURE_ONLY=total] bun scripts/measure-atlas-rebuild.ts
 *
 * It runs against the database you point it at, so point it at a copy. Two things about
 * the method matter and are easy to get wrong:
 *
 * - The real path runs inside `store.deferFts(() => db.transaction(…))`, where the whole
 *   batch defers its FTS writes and pays them once. Timing a phase outside that context
 *   measures something else: an isolated `GraphCurator.rebuild` was 225 s that way and
 *   14 s inside it.
 * - One connection only. A second `new Database(path)` on the same file locks it
 *   (`SQLITE_BUSY`), and killing that run leaves a `-wal` behind that corrupts the next
 *   copy (`rm -rf` the directory, not just the `.db`).
 *
 * The per-phase numbers are each measured after the total has already rebuilt, so they
 * describe a projection that is in place rather than absent; compare them with each other,
 * not as parts of the total. `(b)` is deliberately measured that way — it is the cost of
 * recomputing frames whose projection already exists.
 */
import { createMemoryKernel } from '../dist/factory.js';
import { ActionFrameExtractor } from '../dist/atlas/ActionFrameExtractor.js';
import { GraphCurator } from '../dist/atlas/GraphCurator.js';
import { MemoryFrameProjector } from '../dist/atlas/MemoryFrameProjector.js';
import { MemoryAtlasIndexer } from '../dist/atlas/MemoryAtlasIndexer.js';
import { backfillAtlasDocuments } from '../dist/migrations/MigrationUtils.js';

const dbPath = process.env.MEASURE_DB;
if (!dbPath) throw new Error('set MEASURE_DB to a copy of a memory.db');
const kernel = createMemoryKernel({ dbPath });
const db = kernel.factStore.getDatabase();
const store = kernel.memoryAtlasStore;
const { eventStore, memoryFrameStore: frameStore } = kernel;

const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
const projectId = process.env.MEASURE_PROJECT
  ?? store.listKnownProjectIds()
    .map((id) => ({ id, docs: count(`SELECT COUNT(*) n FROM memory_atlas_documents WHERE project_id='${id}'`) }))
    .sort((a, b) => b.docs - a.docs)[0]?.id;
if (!projectId) throw new Error('no project id found');
const stats = () => ({
  events: count(`SELECT COUNT(*) n FROM memory_events WHERE project_id='${projectId}'`),
  episodes: count(`SELECT COUNT(*) n FROM memory_episodes WHERE project_id='${projectId}'`),
  activeFrames: count(`SELECT COUNT(*) n FROM memory_frames WHERE project_id='${projectId}' AND status='active'`),
  docs: count(`SELECT COUNT(*) n FROM memory_atlas_documents WHERE project_id='${projectId}'`),
});
console.log(`db ${dbPath}\nproject ${projectId}  ${JSON.stringify(stats())}`);

const indexer = new MemoryAtlasIndexer(db, eventStore, store, frameStore);
store.markProjectionDirty(projectId);
let started = performance.now();
const rebuilt = indexer.rebuild({ projectId });
const total = performance.now() - started;
console.log(`\n(a) total (real path)          ${total.toFixed(0).padStart(8)} ms  ${JSON.stringify(rebuilt)}`);
if (process.env.MEASURE_ONLY === 'total') process.exit(0);

// Same context as the real path, one phase at a time.
const inContext = <T,>(fn: () => T): T => store.deferFts(() => db.transaction(() => fn())());
function timed(label: string, fn: () => unknown): number {
  const t0 = performance.now();
  const out = inContext(fn);
  const ms = performance.now() - t0;
  console.log(`    ${label.padEnd(30)} ${ms.toFixed(0).padStart(8)} ms  ${typeof out === 'object' && out ? JSON.stringify(out).slice(0, 70) : String(out).slice(0, 60)}`);
  return ms;
}
const actions = new ActionFrameExtractor(db, eventStore, store);
const curator = new GraphCurator(db, eventStore, store);
const frameProjector = new MemoryFrameProjector(db, frameStore, store, eventStore.getProjectTimeZone());

console.log('\n(a) per phase (context of the real path, idempotent, projection already in place)');
timed('backfillAtlasDocuments', () => { backfillAtlasDocuments(db, projectId); return 'ok'; });
timed('ActionFrameExtractor.rebuild', () => actions.rebuild(projectId));
timed('GraphCurator.rebuild', () => curator.rebuild(projectId));
timed('MemoryFrameProjector.rebuild', () => frameProjector.rebuild(projectId, Date.now(), { canonicalDocumentsRebuilt: true }));
timed('aggregateFacetNodeSupport', () => { store.aggregateFacetNodeSupport(projectId); return 'ok'; });
timed('refreshFtsProject', () => { store.refreshFtsProject(projectId); return 'ok'; });

const frames = stats().activeFrames;
console.log('\n(b) recompute every frame\'s derived summary twice — the second is the pure recompute');
if (frames === 0) {
  console.log('    no active frames in this database: nothing to recompute');
} else {
  for (const pass of [1, 2]) {
    started = performance.now();
    const out = inContext(() => frameProjector.rebuild(projectId, Date.now(), { canonicalDocumentsRebuilt: true }));
    const ms = performance.now() - started;
    console.log(`    pass ${pass}                        ${ms.toFixed(0).padStart(8)} ms  ${(ms / frames).toFixed(0)} ms/frame  ${JSON.stringify(out)}`);
  }
}
