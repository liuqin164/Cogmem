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
        this.db.transaction(() => {
            if (projectId) {
                this.db.prepare(`DELETE FROM memory_atlas_documents WHERE project_id=? AND node_type IN ('entity','topic','cluster','episode','belief')`).run(projectId);
            }
            else {
                this.db.exec(`DELETE FROM memory_atlas_documents WHERE node_type IN ('entity','topic','cluster','episode','belief');`);
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
        return { documents: this.store.countDocuments(projectId), actions };
    }
    ensureFresh(options) {
        if (!this.store.projectionNeedsRefresh(options.projectId)) {
            return { documents: this.store.countDocuments(options.projectId), actions: 0, refreshed: false };
        }
        return { ...this.rebuild(options), refreshed: true };
    }
}
