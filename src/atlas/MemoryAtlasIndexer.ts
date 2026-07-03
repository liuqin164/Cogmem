import type Database from 'bun:sqlite';
import type { EventStore } from '../store/EventStore.js';
import type { MemoryAtlasStore } from '../store/MemoryAtlasStore.js';
import { backfillAtlasDocuments, installAtlasProjectionDirtyTriggers } from '../migrations/0025_memory_atlas.js';
import { ActionFrameExtractor } from './ActionFrameExtractor.js';
import { GraphCurator } from './GraphCurator.js';

export class MemoryAtlasIndexer {
  private readonly actions: ActionFrameExtractor;
  private readonly curator: GraphCurator;
  constructor(private db: Database, eventStore: EventStore, private store: MemoryAtlasStore) {
    installAtlasProjectionDirtyTriggers(db);
    this.actions = new ActionFrameExtractor(db, eventStore, store);
    this.curator = new GraphCurator(db, eventStore, store);
  }
  rebuild(options: { projectId?: string } = {}): { documents: number; actions: number; curatedEpisodes: number } {
    const projectId = options.projectId;
    let actions = 0;
    let curatedEpisodes = 0;
    let facetEdges = 0;
    let reviewNeeded = 0;
    try {
      this.db.transaction(() => {
      if (projectId) {
        this.db.prepare(`DELETE FROM memory_atlas_documents WHERE project_id=? AND node_type IN ('project','entity','topic','issue','session','thread','memoryKind','actionKind','cluster','episode','raw_event','belief','time')`).run(projectId);
      } else {
        this.db.exec(`DELETE FROM memory_atlas_documents WHERE node_type IN ('project','entity','topic','issue','session','thread','memoryKind','actionKind','cluster','episode','raw_event','belief','time');`);
      }
      backfillAtlasDocuments(this.db, projectId);
      const projects = projectId
        ? [projectId]
        : (this.db.prepare(`SELECT DISTINCT project_id FROM memory_atlas_documents WHERE project_id<>''`).all() as Array<{ project_id: string }>).map((row) => row.project_id);
      for (const id of projects) this.store.upsertDocument({
        id: `project:${id}`, projectId: id, nodeType: 'project', sourceId: id, label: id,
        confidence: 1, supportCount: this.store.countDocuments(id), status: 'active', evidenceEventIds: [],
        metadata: { projection: 'memory_atlas.v1' },
      });
      actions = this.actions.rebuild(projectId);
      for (const id of projects) {
        const result = this.curator.rebuild(id);
        curatedEpisodes += result.episodeCount;
        facetEdges += result.facetEdgeCount;
        reviewNeeded += result.reviewNeeded;
      }
      if (projectId) {
        this.store.markProjectionClean(projectId, { actions, curatedEpisodes, facetEdges, reviewNeeded });
      } else {
        for (const id of projects) this.store.markProjectionClean(id, { actions, curatedEpisodes, facetEdges, reviewNeeded });
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
