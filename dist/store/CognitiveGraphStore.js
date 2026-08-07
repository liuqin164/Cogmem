import Database from 'bun:sqlite';
import { cognitiveEdgeId, cognitiveNodeId } from '../engine/CognitiveGraphIdentity.js';
import { projectQueryValue } from '../topology/ProjectScope.js';
import { installRuntimeProvenanceGuards } from '../migrations/v3_7_4/FinalRuntimeGuards.js';
export class CognitiveGraphStore {
    db;
    ownsDb;
    constructor(dbOrPath = ':memory:') {
        if (typeof dbOrPath === 'string') {
            this.db = new Database(dbOrPath);
            this.ownsDb = true;
        }
        else {
            this.db = dbOrPath;
            this.ownsDb = false;
        }
        this.initializeSchema();
        installRuntimeProvenanceGuards(this.db);
    }
    initializeSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS cognitive_nodes (
        node_id TEXT PRIMARY KEY,
        node_type TEXT NOT NULL,
        node_key TEXT NOT NULL,
        title TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT '',
        source_neuron_id TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(project_id, node_type, node_key)
      );

      CREATE TABLE IF NOT EXISTS cognitive_edges (
        edge_id TEXT PRIMARY KEY,
        source_node_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        weight REAL NOT NULL,
        project_id TEXT NOT NULL DEFAULT '',
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(project_id, source_node_id, target_node_id, edge_type)
      );

      CREATE INDEX IF NOT EXISTS idx_cognitive_nodes_type_project
        ON cognitive_nodes(node_type, project_id, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_cognitive_nodes_title
        ON cognitive_nodes(title, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_cognitive_edges_source
        ON cognitive_edges(source_node_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_cognitive_edges_target
        ON cognitive_edges(target_node_id, created_at DESC);
    `);
    }
    upsertNode(input) {
        const projectScope = input.projectId ?? '';
        if (input.sourceNeuronId) {
            const neuron = this.db.prepare(`SELECT COALESCE(project_id,'') AS scope FROM neurons WHERE id=? AND is_deleted=0`)
                .get(input.sourceNeuronId);
            if (!neuron || neuron.scope !== projectScope)
                throw new Error('cognitive_node_project_scope_mismatch');
        }
        const existing = this.db.prepare(`
      SELECT * FROM cognitive_nodes WHERE project_id = ? AND node_type = ? AND node_key = ?
    `).get(projectScope, input.nodeType, input.nodeKey);
        const nodeId = existing?.node_id || cognitiveNodeId(input.projectId, input.nodeType, input.nodeKey);
        const createdAt = existing?.created_at || input.createdAt;
        this.db.prepare(`
      INSERT OR REPLACE INTO cognitive_nodes (
        node_id, node_type, node_key, title, project_id, source_neuron_id, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(nodeId, input.nodeType, input.nodeKey, input.title, projectScope, input.sourceNeuronId || null, input.metadata ? JSON.stringify(input.metadata) : null, createdAt, input.createdAt);
        return {
            nodeId,
            nodeType: input.nodeType,
            nodeKey: input.nodeKey,
            title: input.title,
            projectId: input.projectId,
            sourceNeuronId: input.sourceNeuronId,
            metadata: input.metadata,
            createdAt,
            updatedAt: input.createdAt
        };
    }
    linkNodes(input) {
        const projectScope = input.projectId ?? '';
        const endpoints = this.db.prepare(`SELECT node_id,project_id FROM cognitive_nodes WHERE node_id IN (?,?)`).all(input.sourceNodeId, input.targetNodeId);
        const endpointProjects = new Map(endpoints.map((endpoint) => [endpoint.node_id, endpoint.project_id]));
        if (endpointProjects.get(input.sourceNodeId) !== projectScope || endpointProjects.get(input.targetNodeId) !== projectScope) {
            throw new Error('cognitive_edge_project_scope_mismatch');
        }
        const existing = this.db.prepare(`
      SELECT edge_id, created_at FROM cognitive_edges
      WHERE project_id = ? AND source_node_id = ? AND target_node_id = ? AND edge_type = ?
    `).get(projectScope, input.sourceNodeId, input.targetNodeId, input.edgeType);
        const edgeId = existing?.edge_id || cognitiveEdgeId(input);
        const createdAt = existing?.created_at || input.createdAt;
        this.db.prepare(`
      INSERT OR REPLACE INTO cognitive_edges (
        edge_id, source_node_id, target_node_id, edge_type, weight, project_id, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(edgeId, input.sourceNodeId, input.targetNodeId, input.edgeType, input.weight ?? 1.0, projectScope, input.metadata ? JSON.stringify(input.metadata) : null, createdAt);
        return {
            edgeId,
            sourceNodeId: input.sourceNodeId,
            targetNodeId: input.targetNodeId,
            edgeType: input.edgeType,
            weight: input.weight ?? 1.0,
            projectId: input.projectId,
            metadata: input.metadata,
            createdAt
        };
    }
    findNode(projectId, nodeType, nodeKey) {
        const row = this.db.prepare(`
      SELECT * FROM cognitive_nodes WHERE project_id=? AND node_type=? AND node_key=?
        AND ${recallableCognitiveNodeSql(this.db, 'cognitive_nodes')}
    `).get(projectId ?? '', nodeType, nodeKey);
        if (!row)
            return null;
        return {
            nodeId: row.node_id,
            nodeType: row.node_type,
            nodeKey: row.node_key,
            title: row.title,
            projectId: row.project_id == null ? undefined : String(row.project_id),
            sourceNeuronId: row.source_neuron_id || undefined,
            metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
    resetProjectTimeProjection(projectId) {
        this.db.prepare(`DELETE FROM cognitive_edges WHERE project_id=? AND edge_type='occurred_in_time_bucket'`).run(projectId);
        this.db.prepare(`DELETE FROM cognitive_nodes WHERE project_id=? AND node_type='time_bucket'`).run(projectId);
    }
    collectContext(input) {
        const limit = input.limit ?? 120;
        const hopLimit = Math.max(1, input.hopLimit ?? 2);
        const queryProject = projectQueryValue(input.projectId);
        const excludeTemporal = Boolean(input.excludeTemporal || !this.hasReadableTimeProjection(input.projectId));
        const seedNodeIds = new Set();
        const suppliedSeed = this.db.prepare(`
      SELECT 1 FROM cognitive_nodes
      WHERE node_id=?
        AND (? IS NULL OR project_id=?)
        AND (?=0 OR node_type<>'time_bucket')
        AND ${recallableCognitiveNodeSql(this.db, 'cognitive_nodes')}
      LIMIT 1
    `);
        for (const nodeId of input.seedNodeIds ?? []) {
            if (suppliedSeed.get(nodeId, input.projectId ?? null, input.projectId ?? null, excludeTemporal ? 1 : 0))
                seedNodeIds.add(nodeId);
        }
        const traversedNodeIds = new Set();
        const neuronIds = new Set();
        const terms = (input.terms || []).map((term) => term.trim().toLowerCase()).filter((term) => term.length >= 2);
        for (const key of input.seedNodeKeys || []) {
            const rows = this.db.prepare(`
        SELECT node_id
        FROM cognitive_nodes
        WHERE node_key = ?
          AND (? IS NULL OR project_id = ?)
          AND (? = 0 OR node_type <> 'time_bucket')
          AND ${recallableCognitiveNodeSql(this.db, 'cognitive_nodes')}
      `).all(key, queryProject, queryProject, excludeTemporal ? 1 : 0);
            for (const row of rows)
                seedNodeIds.add(row.node_id);
        }
        for (const term of terms) {
            const rows = this.db.prepare(`
        SELECT node_id
        FROM cognitive_nodes
        WHERE (? IS NULL OR project_id = ?)
          AND (? = 0 OR node_type <> 'time_bucket')
          AND ${recallableCognitiveNodeSql(this.db, 'cognitive_nodes')}
          AND (lower(title) LIKE ? OR lower(node_key) LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(queryProject, queryProject, excludeTemporal ? 1 : 0, `%${term}%`, `%${term}%`, limit);
            for (const row of rows)
                seedNodeIds.add(row.node_id);
        }
        let traversedEdgeCount = 0;
        let frontier = Array.from(seedNodeIds);
        for (const nodeId of frontier)
            traversedNodeIds.add(nodeId);
        for (let hop = 0; hop < hopLimit; hop += 1) {
            if (frontier.length === 0)
                break;
            const nextFrontier = [];
            for (const nodeId of frontier) {
                const rows = this.db.prepare(`
          SELECT ce.source_node_id, ce.target_node_id, cn.node_type, cn.source_neuron_id
          FROM cognitive_edges ce
          JOIN cognitive_nodes cn
            ON cn.node_id = CASE
              WHEN ce.source_node_id = ? THEN ce.target_node_id
              ELSE ce.source_node_id
            END
          WHERE (ce.source_node_id = ? OR ce.target_node_id = ?)
            AND (? IS NULL OR ce.project_id = ?)
            AND (? IS NULL OR cn.project_id = ?)
            AND (? = 0 OR (ce.edge_type <> 'occurred_in_time_bucket' AND cn.node_type <> 'time_bucket'))
            AND ${recallableCognitiveNodeSql(this.db, 'cn')}
          ORDER BY ce.created_at DESC
          LIMIT ?
        `).all(nodeId, nodeId, nodeId, queryProject, queryProject, queryProject, queryProject, excludeTemporal ? 1 : 0, limit);
                traversedEdgeCount += rows.length;
                for (const row of rows) {
                    const neighborId = row.source_node_id === nodeId ? row.target_node_id : row.source_node_id;
                    if (!traversedNodeIds.has(neighborId) && traversedNodeIds.size < limit * 4) {
                        traversedNodeIds.add(neighborId);
                        nextFrontier.push(neighborId);
                    }
                }
            }
            frontier = nextFrontier;
        }
        if (traversedNodeIds.size > 0) {
            const placeholders = Array.from(traversedNodeIds).map(() => '?').join(', ');
            const rows = this.db.prepare(`
        SELECT node_id, node_type, source_neuron_id, node_key
        FROM cognitive_nodes
        WHERE node_id IN (${placeholders})
          AND (? IS NULL OR project_id = ?)
          AND ${recallableCognitiveNodeSql(this.db, 'cognitive_nodes')}
      `).all(...Array.from(traversedNodeIds), queryProject, queryProject);
            for (const row of rows) {
                if (row.node_type === 'neuron') {
                    neuronIds.add(row.node_key.replace(/^neuron:/, ''));
                }
                else if (row.source_neuron_id) {
                    neuronIds.add(row.source_neuron_id);
                }
                if (neuronIds.size >= limit)
                    break;
            }
        }
        return {
            seedNodeIds: Array.from(seedNodeIds).slice(0, limit),
            traversedNodeIds: Array.from(traversedNodeIds).slice(0, limit * 4),
            neuronIds: Array.from(neuronIds).slice(0, limit),
            edgeCount: traversedEdgeCount
        };
    }
    getNodeCount() {
        const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM cognitive_nodes
      WHERE (?=1 OR node_type<>'time_bucket')
        AND ${recallableCognitiveNodeSql(this.db, 'cognitive_nodes')}
    `).get(this.hasReadableTimeProjection() ? 1 : 0);
        return row?.count || 0;
    }
    hasReadableTimeProjection(projectId) {
        const scope = projectQueryValue(projectId);
        return !Boolean(scope === null
            ? this.db.prepare(`SELECT 1 FROM topology_source_revisions r LEFT JOIN topology_projection_state s ON s.project_id=r.project_id WHERE s.project_id IS NULL OR s.status<>'clean' OR s.source_revision<>r.revision LIMIT 1`).get()
            : this.db.prepare(`SELECT 1 FROM topology_source_revisions r LEFT JOIN topology_projection_state s ON s.project_id=r.project_id WHERE r.project_id=? AND (s.project_id IS NULL OR s.status<>'clean' OR s.source_revision<>r.revision) LIMIT 1`).get(scope));
    }
    getEdgeCount() {
        const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM cognitive_edges ce
      JOIN cognitive_nodes src_node ON src_node.node_id=ce.source_node_id
      JOIN cognitive_nodes dst_node ON dst_node.node_id=ce.target_node_id
      WHERE (?=1 OR ce.edge_type<>'occurred_in_time_bucket')
        AND ${recallableCognitiveNodeSql(this.db, 'src_node')}
        AND ${recallableCognitiveNodeSql(this.db, 'dst_node')}
    `).get(this.hasReadableTimeProjection() ? 1 : 0);
        return row?.count || 0;
    }
    close() {
        if (this.ownsDb)
            this.db.close();
    }
}
function recallableCognitiveNodeSql(db, alias) {
    const conditions = [tableExists(db, 'neurons') ? `(${alias}.source_neuron_id IS NULL OR EXISTS (
      SELECT 1 FROM neurons n WHERE n.id=${alias}.source_neuron_id AND n.is_deleted=0
        AND COALESCE(n.project_id,'')=${alias}.project_id
    ))` : '1=1'];
    if (tableExists(db, 'facts'))
        conditions.push(`(${alias}.node_type<>'fact' OR EXISTS (
      SELECT 1 FROM facts f WHERE ('fact:'||f.fact_id)=${alias}.node_key
        AND f.status IN ('provisional','provisional_enriched','verified')
    ))`, `(${alias}.node_type<>'entity' OR json_extract(${alias}.metadata_json,'$.sourceFactId') IS NULL OR EXISTS (
      SELECT 1 FROM facts f WHERE f.fact_id=json_extract(${alias}.metadata_json,'$.sourceFactId')
        AND f.status IN ('provisional','provisional_enriched','verified')
    ))`);
    if (tableExists(db, 'beliefs'))
        conditions.push(`(${alias}.node_type<>'belief' OR EXISTS (
      SELECT 1 FROM beliefs b WHERE ('belief:'||b.id)=${alias}.node_key AND b.status='active'
    ))`);
    if (tableExists(db, 'compiled_events'))
        conditions.push(`(${alias}.node_type<>'compiled_event' OR EXISTS (
      SELECT 1 FROM compiled_events e WHERE ('compiled_event:'||e.event_id)=${alias}.node_key
        AND e.status IN ('provisional','verified')
    ))`);
    return conditions.join(' AND ');
}
function tableExists(db, name) {
    return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name));
}
