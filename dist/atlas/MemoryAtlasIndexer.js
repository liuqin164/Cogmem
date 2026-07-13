import { MEMORY_ATLAS_PROJECTION_NAME, MEMORY_ATLAS_PROJECTION_SCHEMA_VERSION } from '../store/MemoryAtlasStore.js';
import { backfillAtlasDocuments, installAtlasProjectionDirtyTriggers } from '../migrations/0025_memory_atlas.js';
import { ActionFrameExtractor } from './ActionFrameExtractor.js';
import { GraphCurator } from './GraphCurator.js';
import { MemoryFrameProjector } from './MemoryFrameProjector.js';
export class MemoryAtlasIndexer {
    db;
    store;
    actions;
    curator;
    frameProjector;
    constructor(db, eventStore, store, frameStore) {
        this.db = db;
        this.store = store;
        installAtlasProjectionDirtyTriggers(db);
        this.actions = new ActionFrameExtractor(db, eventStore, store);
        this.curator = new GraphCurator(db, eventStore, store);
        if (frameStore)
            this.frameProjector = new MemoryFrameProjector(db, frameStore, store);
    }
    rebuild(options = {}) {
        const projectId = options.projectId;
        let actions = 0;
        let curatedEpisodes = 0;
        let facetEdges = 0;
        let reviewNeeded = 0;
        try {
            this.db.transaction(() => {
                if (projectId) {
                    this.db.prepare(`DELETE FROM memory_atlas_documents WHERE project_id=? AND node_type IN ('project','entity','topic','issue','session','thread','memoryKind','actionKind','cluster','episode','raw_event','belief','time')`).run(projectId);
                }
                else {
                    this.db.exec(`DELETE FROM memory_atlas_documents WHERE node_type IN ('project','entity','topic','issue','session','thread','memoryKind','actionKind','cluster','episode','raw_event','belief','time');`);
                }
                backfillAtlasDocuments(this.db, projectId);
                const projects = projectId
                    ? [projectId]
                    : this.db.prepare(`SELECT DISTINCT project_id FROM memory_atlas_documents WHERE project_id<>''`).all().map((row) => row.project_id);
                for (const id of projects)
                    this.store.upsertDocument({
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
                if (projectId && this.frameProjector)
                    this.frameProjector.rebuild(projectId);
                else if (!projectId && this.frameProjector)
                    for (const id of projects)
                        this.frameProjector.rebuild(id);
                if (projectId) {
                    this.store.markProjectionClean(projectId, { actions, curatedEpisodes, facetEdges, reviewNeeded, projectionVersion: 'v2', frameSchemaVersion: 'memory_frame.v1' });
                }
                else {
                    for (const id of projects)
                        this.store.markProjectionClean(id, { actions, curatedEpisodes, facetEdges, reviewNeeded, projectionVersion: 'v2', frameSchemaVersion: 'memory_frame.v1' });
                }
            })();
        }
        catch (error) {
            this.store.markProjectionFailed(projectId || '__global__', error instanceof Error ? error.message : String(error));
            throw error;
        }
        return { documents: this.store.countDocuments(projectId), actions, curatedEpisodes };
    }
    ensureFresh(options) {
        if (!this.store.projectionNeedsRefresh(options.projectId)) {
            return { documents: this.store.countDocuments(options.projectId), actions: 0, refreshed: false };
        }
        return { ...this.rebuild(options), refreshed: true };
    }
    reindex(options) {
        const episodeIds = new Set();
        if (options.episodeId)
            episodeIds.add(options.episodeId);
        if (options.eventId) {
            const rows = this.db.prepare(`SELECT episode_id FROM memory_episode_events WHERE event_id=?`).all(options.eventId);
            for (const row of rows)
                if (row.episode_id)
                    episodeIds.add(row.episode_id);
        }
        const ids = Array.from(episodeIds);
        if (!ids.length)
            throw new Error('graph_reindex_target_not_found');
        let result = { episodeCount: 0, facetNodeCount: 0, facetEdgeCount: 0, reviewNeeded: 0 };
        this.db.transaction(() => {
            result = this.curator.rebuildEpisodes(options.projectId, ids);
            this.frameProjector?.rebuild(options.projectId);
            this.store.markProjectionDirty(options.projectId, {
                targetedReindex: true,
                episodeIds: ids,
                eventId: options.eventId,
                curatedEpisodes: result.episodeCount,
                facetEdges: result.facetEdgeCount,
                reviewNeeded: result.reviewNeeded,
                reason: 'targeted_reindex_requires_full_consistency_rebuild',
            });
        })();
        return {
            projectId: options.projectId,
            episodeIds: ids,
            refreshed: true,
            curatedEpisodes: result.episodeCount,
            facetEdges: result.facetEdgeCount,
            reviewNeeded: result.reviewNeeded,
        };
    }
    ensureAllFresh() {
        let documents = 0;
        let actions = 0;
        let refreshed = false;
        const errors = [];
        for (const projectId of this.store.listKnownProjectIds()) {
            try {
                const result = this.ensureFresh({ projectId });
                documents += result.documents;
                actions += result.actions;
                refreshed ||= result.refreshed;
            }
            catch (error) {
                errors.push({ projectId, error: error instanceof Error ? error.message : String(error) });
            }
        }
        return { documents, actions, refreshed, errors };
    }
}
