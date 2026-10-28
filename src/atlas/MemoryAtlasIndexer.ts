import type Database from 'bun:sqlite';
import type { EventStore } from '../store/EventStore.js';
import type { MemoryAtlasStore } from '../store/MemoryAtlasStore.js';
import { MEMORY_ATLAS_PROJECTION_NAME, MEMORY_ATLAS_PROJECTION_SCHEMA_VERSION } from '../store/MemoryAtlasStore.js';
import { backfillAtlasDocuments } from '../migrations/MigrationUtils.js';
import { installAtlasProjectionDirtyTriggersV3 } from '../migrations/v3_7_4/FinalRuntimeGuards.js';
import { ActionFrameExtractor } from './ActionFrameExtractor.js';
import { GraphCurator } from './GraphCurator.js';
import type { MemoryFrameStore } from '../store/MemoryFrameStore.js';
import { MemoryFrameProjector } from './MemoryFrameProjector.js';

export class MemoryAtlasIndexer {
  private readonly actions: ActionFrameExtractor;
  private readonly curator: GraphCurator;
  private readonly frameProjector?: MemoryFrameProjector;
  constructor(private db: Database, eventStore: EventStore, private store: MemoryAtlasStore, frameStore?: MemoryFrameStore) {
    installAtlasProjectionDirtyTriggersV3(db);
    this.actions = new ActionFrameExtractor(db, eventStore, store);
    this.curator = new GraphCurator(db, eventStore, store);
    if (frameStore) this.frameProjector = new MemoryFrameProjector(db, frameStore, store, eventStore.getProjectTimeZone());
  }
  rebuild(options: { projectId?: string } = {}): { documents: number; actions: number; curatedEpisodes: number; facetEdges: number; reviewNeeded: number } {
    const projectId = options.projectId;
    let actions = 0;
    let curatedEpisodes = 0;
    let facetEdges = 0;
    let reviewNeeded = 0;
    try {
      this.store.deferFts(() => this.db.transaction(() => {
      const ftsExists = Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_atlas_fts'`).get());
      if (ftsExists) {
        if (projectId !== undefined) this.db.prepare(`DELETE FROM memory_atlas_fts WHERE project_id=? AND node_id IN (SELECT node_id FROM memory_atlas_documents WHERE project_id=?)`).run(projectId, projectId);
        else this.db.exec(`DELETE FROM memory_atlas_fts WHERE node_id IN (SELECT node_id FROM memory_atlas_documents);`);
      }
      if (projectId !== undefined) {
        this.db.prepare(`DELETE FROM memory_atlas_documents WHERE project_id=? AND node_type IN ('project','entity','topic','issue','session','thread','memoryKind','actionKind','cluster','episode','raw_event','belief','time')`).run(projectId);
      } else {
        this.db.exec(`DELETE FROM memory_atlas_documents WHERE node_type IN ('project','entity','topic','issue','session','thread','memoryKind','actionKind','cluster','episode','raw_event','belief','time');`);
      }
      backfillAtlasDocuments(this.db, projectId);
      actions = this.actions.rebuild(projectId);
      const projects = projectId !== undefined
        ? [projectId]
        : this.store.listKnownProjectIds();
      for (const id of projects) {
        const result = this.curator.rebuild(id);
        curatedEpisodes += result.episodeCount;
        facetEdges += result.facetEdgeCount;
        reviewNeeded += result.reviewNeeded;
      }
      if (this.frameProjector) for (const id of projects) {
        const result = this.frameProjector.rebuild(id, Date.now(), { canonicalDocumentsRebuilt: true });
        facetEdges += result.edges;
        reviewNeeded += result.needsReview;
      }
      for (const id of projects) this.store.aggregateFacetNodeSupport(id);
      for (const id of projects) {
        const nodeId = `project:${id}`;
        this.store.upsertDocument({
          id: nodeId, projectId: id, nodeType: 'project', sourceId: id, label: id || 'Projectless',
          confidence: 1, supportCount: this.store.countDocuments(id) + (this.store.getNodeIncludingInactive(nodeId, id) ? 0 : 1), status: 'active', evidenceEventIds: [],
          metadata: { projection: MEMORY_ATLAS_PROJECTION_NAME, projectionSchemaVersion: MEMORY_ATLAS_PROJECTION_SCHEMA_VERSION },
        });
      }
      // Every document exists now, so the index is written once per project
      // instead of once per node (see MemoryAtlasStore.deferFts).
      for (const id of projects) this.store.refreshFtsProject(id);
      if (projectId !== undefined) {
        this.store.markProjectionClean(projectId, { actions, curatedEpisodes, facetEdges, reviewNeeded, projectionVersion: 'v2', frameSchemaVersion: 'memory_frame.v1' });
      } else {
        for (const id of projects) this.store.markProjectionClean(id, { actions, curatedEpisodes, facetEdges, reviewNeeded, projectionVersion: 'v2', frameSchemaVersion: 'memory_frame.v1' });
      }
      })());
    } catch (error) {
      this.store.markProjectionFailed(projectId ?? '__all__', error instanceof Error ? error.message : String(error));
      throw error;
    }
    return { documents: this.store.countDocuments(projectId), actions, curatedEpisodes, facetEdges, reviewNeeded };
  }

  ensureFresh(options: { projectId: string }): { documents: number; actions: number; curatedEpisodes?: number; refreshed: boolean } {
    if (!this.store.projectionNeedsRefresh(options.projectId)) {
      return { documents: this.store.countDocuments(options.projectId), actions: 0, refreshed: false };
    }
    return { ...this.rebuild(options), refreshed: true };
  }

  /**
   * Add these episodes to the graph without recomputing the corpus.
   *
   * `GraphCurator.rebuildEpisodes` already deletes and re-projects exactly these
   * episodes' edges and facet nodes; the full rebuild was used instead because a
   * frame revision can change shared canonical nodes. That is still true for the
   * frame and action layers, which stay batch-level (a full rebuild is 17.4 s
   * after the index fix and remains the consistency backstop). What is gained
   * here is the canonical layer — the nodes and edges facet recall reads —
   * landing immediately, for ~30 nodes instead of 14,271.
   *
   * Shared-node support counts are aggregated once per batch by the caller
   * (`aggregateFacetNodeSupport`), not per episode: it is a project-wide pass.
   */
  projectEpisodes(projectId: string, episodeIds: string[]): { episodeCount: number; facetNodeCount: number; facetEdgeCount: number; reviewNeeded: number } {
    const bounded = Array.from(new Set(episodeIds.filter(Boolean))).slice(0, 100);
    if (!bounded.length) return { episodeCount: 0, facetNodeCount: 0, facetEdgeCount: 0, reviewNeeded: 0 };
    try {
      const result = this.db.transaction(() => this.curator.rebuildEpisodes(projectId, bounded))();
      // Only the canonical layer is touched here. Nothing is owed: this path
      // re-projects episodes that were already projected, and the frame and
      // action layers it does not touch stay as they were. A caller that just
      // Dreamed new frames (the nightly run) is what owes a full refresh, and it
      // finishes with one.
      return {
        episodeCount: result.episodeCount,
        facetNodeCount: result.facetNodeCount,
        facetEdgeCount: result.facetEdgeCount,
        reviewNeeded: result.reviewNeeded,
      };
    } catch (error) {
      // A failed projection must be retried by the next batch rather than
      // reported as clean.
      this.store.markProjectionDirty(projectId, { dirtyBecause: 'incremental_projection_failed' });
      throw error;
    }
  }

  reindex(options: { projectId: string; eventId?: string; episodeId?: string }): { projectId: string; episodeIds: string[]; refreshed: boolean; curatedEpisodes: number; facetEdges: number; reviewNeeded: number } {
    const episodeIds = new Set<string>();
    if (options.episodeId) episodeIds.add(options.episodeId);
    if (options.eventId) {
      const rows = this.db.prepare(`SELECT episode_id FROM memory_episode_events WHERE event_id=?`).all(options.eventId) as Array<{ episode_id: string }>;
      for (const row of rows) if (row.episode_id) episodeIds.add(row.episode_id);
    }
    const ids = Array.from(episodeIds);
    if (!ids.length) throw new Error('graph_reindex_target_not_found');
    const rebuilt = this.projectEpisodes(options.projectId, ids);
    return {
      projectId: options.projectId,
      episodeIds: ids,
      refreshed: true,
      curatedEpisodes: rebuilt.episodeCount,
      facetEdges: rebuilt.facetEdgeCount,
      reviewNeeded: rebuilt.reviewNeeded,
    };
  }

  ensureAllFresh(): { documents: number; actions: number; refreshed: boolean; errors: Array<{ projectId: string; error: string }> } {
    let documents = 0; let actions = 0; let refreshed = false;
    const errors: Array<{ projectId: string; error: string }> = [];
    for (const projectId of this.store.listKnownProjectIds()) {
      try {
        const result = this.ensureFresh({ projectId });
        documents += result.documents; actions += result.actions; refreshed ||= result.refreshed;
      } catch (error) { errors.push({ projectId, error: error instanceof Error ? error.message : String(error) }); }
    }
    return { documents, actions, refreshed, errors };
  }
}
