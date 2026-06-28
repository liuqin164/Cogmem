import { backfillAtlasDocuments, installAtlasProjectionDirtyTriggers } from '../migrations/0025_memory_atlas.js';
import { ActionFrameExtractor } from './ActionFrameExtractor.js';
export class MemoryAtlasIndexer {
    db;
    store;
    actions;
    constructor(db, eventStore, store) {
        this.db = db;
        this.store = store;
        installAtlasProjectionDirtyTriggers(db);
        this.actions = new ActionFrameExtractor(db, eventStore, store);
    }
    rebuild(options = {}) {
        const projectId = options.projectId;
        let actions = 0;
        try {
            this.db.transaction(() => {
                if (projectId) {
                    this.db.prepare(`DELETE FROM memory_atlas_documents WHERE project_id=? AND node_type IN ('project','entity','topic','cluster','episode','belief')`).run(projectId);
                }
                else {
                    this.db.exec(`DELETE FROM memory_atlas_documents WHERE node_type IN ('project','entity','topic','cluster','episode','belief');`);
                }
                backfillAtlasDocuments(this.db, projectId);
                const projects = projectId
                    ? [projectId]
                    : this.db.prepare(`SELECT DISTINCT project_id FROM memory_atlas_documents WHERE project_id<>''`).all().map((row) => row.project_id);
                for (const id of projects)
                    this.store.upsertDocument({
                        id: `project:${id}`, projectId: id, nodeType: 'project', sourceId: id, label: id,
                        confidence: 1, supportCount: this.store.countDocuments(id), status: 'active', evidenceEventIds: [],
                        metadata: { projection: 'memory_atlas.v1' },
                    });
                actions = this.actions.rebuild(projectId);
                if (projectId) {
                    this.store.markProjectionClean(projectId, { actions });
                }
                else {
                    for (const id of projects)
                        this.store.markProjectionClean(id, { actions });
                }
            })();
        }
        catch (error) {
            this.store.markProjectionFailed(projectId || '__global__', error instanceof Error ? error.message : String(error));
            throw error;
        }
        return { documents: this.store.countDocuments(projectId), actions };
    }
    ensureFresh(options) {
        if (!this.store.projectionNeedsRefresh(options.projectId)) {
            return { documents: this.store.countDocuments(options.projectId), actions: 0, refreshed: false };
        }
        return { ...this.rebuild(options), refreshed: true };
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
