import type Database from 'bun:sqlite';
import type { EventStore } from '../store/EventStore.js';
import type { MemoryAtlasStore } from '../store/MemoryAtlasStore.js';
import { MEMORY_ATLAS_PROJECTION_NAME, MEMORY_ATLAS_PROJECTION_SCHEMA_VERSION } from '../store/MemoryAtlasStore.js';
import { backfillAtlasDocuments, installAtlasProjectionDirtyTriggers } from '../migrations/0025_memory_atlas.js';
import { ActionFrameExtractor } from './ActionFrameExtractor.js';
import { GraphCurator } from './GraphCurator.js';
import type { MemoryFrameStore } from '../store/MemoryFrameStore.js';
import { MemoryFrameProjector } from './MemoryFrameProjector.js';

export class MemoryAtlasIndexer {
  private readonly actions: ActionFrameExtractor;
  private readonly curator: GraphCurator;
  private readonly frameProjector?: MemoryFrameProjector;
  constructor(private db: Database, eventStore: EventStore, private store: MemoryAtlasStore, frameStore?: MemoryFrameStore) {
    installAtlasProjectionDirtyTriggers(db);
    this.actions = new ActionFrameExtractor(db, eventStore, store);
    this.curator = new GraphCurator(db, eventStore, store);
    if (frameStore) this.frameProjector = new MemoryFrameProjector(db, frameStore, store, eventStore.getProjectTimeZone());
  }
  rebuild(options: { projectId?: string } = {}): { documents: number; actions: number; curatedEpisodes: number } {
    const projectId = options.projectId;
    let actions = 0;
    let curatedEpisodes = 0;
    let facetEdges = 0;
    let reviewNeeded = 0;
    try {
      this.db.transaction(() => {
      const ftsExists = Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_atlas_fts'`).get());
      if (ftsExists) {
        if (projectId) this.db.prepare(`DELETE FROM memory_atlas_fts WHERE project_id=? AND node_id IN (SELECT node_id FROM memory_atlas_documents WHERE project_id=?)`).run(projectId, projectId);
        else this.db.exec(`DELETE FROM memory_atlas_fts WHERE node_id IN (SELECT node_id FROM memory_atlas_documents);`);
      }
      if (projectId) {
        this.db.prepare(`DELETE FROM memory_atlas_documents WHERE project_id=? AND node_type IN ('project','entity','topic','issue','session','thread','memoryKind','actionKind','cluster','episode','raw_event','belief','time')`).run(projectId);
      } else {
        this.db.exec(`DELETE FROM memory_atlas_documents WHERE node_type IN ('project','entity','topic','issue','session','thread','memoryKind','actionKind','cluster','episode','raw_event','belief','time');`);
      }
      backfillAtlasDocuments(this.db, projectId);
      const projects = projectId
        ? [projectId]
        : (this.db.prepare(`SELECT project_id FROM memory_atlas_documents WHERE project_id<>'' UNION SELECT project_id FROM memory_frames WHERE status='active' AND project_id<>''`).all() as Array<{ project_id: string }>).map((row) => row.project_id);
      for (const id of projects) this.store.upsertDocument({
        id: `project:${id}`, projectId: id, nodeType: 'project', sourceId: id, label: id,
        confidence: 1, supportCount: this.store.countDocuments(id), status: 'active', evidenceEventIds: [],
        metadata: { projection: MEMORY_ATLAS_PROJECTION_NAME, projectionSchemaVersion: MEMORY_ATLAS_PROJECTION_SCHEMA_VERSION },
      });
      actions = this.actions.rebuild(projectId);
      for (const id of projects) {
        const result = this.curator.rebuild(id);
        curatedEpisodes += result.episodeCount;
        facetEdges += result.facetEdgeCount;
        reviewNeeded += result.reviewNeeded;
        this.store.aggregateFacetNodeSupport(id);
      }
      if (projectId && this.frameProjector) this.frameProjector.rebuild(projectId);
      else if (!projectId && this.frameProjector) for (const id of projects) this.frameProjector.rebuild(id);
      if (projectId) {
        this.store.markProjectionClean(projectId, { actions, curatedEpisodes, facetEdges, reviewNeeded, projectionVersion: 'v2', frameSchemaVersion: 'memory_frame.v1' });
      } else {
        for (const id of projects) this.store.markProjectionClean(id, { actions, curatedEpisodes, facetEdges, reviewNeeded, projectionVersion: 'v2', frameSchemaVersion: 'memory_frame.v1' });
      }
      })();
    } catch (error) {
      this.store.markProjectionFailed(projectId || '__global__', error instanceof Error ? error.message : String(error));
      throw error;
    }
    return { documents: this.store.countDocuments(projectId), actions, curatedEpisodes };
  }

  ensureFresh(options: { projectId: string }): { documents: number; actions: number; curatedEpisodes?: number; refreshed: boolean } {
    if (!this.store.projectionNeedsRefresh(options.projectId)) {
      return { documents: this.store.countDocuments(options.projectId), actions: 0, refreshed: false };
    }
    return { ...this.rebuild(options), refreshed: true };
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
    // A Frame revision can change shared canonical nodes and edges. A partial
    // rebuild would leave the project dirty while reporting it as refreshed,
    // so reindex uses the same clean, transactional path as a full rebuild.
    const rebuilt = this.rebuild({ projectId: options.projectId });
    return {
      projectId: options.projectId,
      episodeIds: ids,
      refreshed: true,
      curatedEpisodes: rebuilt.curatedEpisodes,
      facetEdges: 0,
      reviewNeeded: 0,
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
