import Database from 'bun:sqlite';
import { randomUUID } from 'crypto';
export class CognitiveGraphStore {
    db;
    constructor(dbPath = ':memory:') {
        this.db = new Database(dbPath);
        this.initializeSchema();
    }
    initializeSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS cognitive_nodes (
        node_id TEXT PRIMARY KEY,
        node_type TEXT NOT NULL,
        node_key TEXT NOT NULL,
        title TEXT NOT NULL,
        project_id TEXT,
        source_neuron_id TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(node_type, node_key)
      );

      CREATE TABLE IF NOT EXISTS cognitive_edges (
        edge_id TEXT PRIMARY KEY,
        source_node_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        weight REAL NOT NULL,
        project_id TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(source_node_id, target_node_id, edge_type)
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
        const existing = this.db.prepare(`
      SELECT * FROM cognitive_nodes WHERE node_type = ? AND node_key = ?
    `).get(input.nodeType, input.nodeKey);
        const nodeId = existing?.node_id || input.nodeId;
        const createdAt = existing?.created_at || input.createdAt;
        this.db.prepare(`
      INSERT OR REPLACE INTO cognitive_nodes (
        node_id, node_type, node_key, title, project_id, source_neuron_id, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(nodeId, input.nodeType, input.nodeKey, input.title, input.projectId || null, input.sourceNeuronId || null, input.metadata ? JSON.stringify(input.metadata) : null, createdAt, input.createdAt);
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
        const existing = this.db.prepare(`
      SELECT edge_id, created_at FROM cognitive_edges
      WHERE source_node_id = ? AND target_node_id = ? AND edge_type = ?
    `).get(input.sourceNodeId, input.targetNodeId, input.edgeType);
        const edgeId = existing?.edge_id || `cgedge-${randomUUID()}`;
        const createdAt = existing?.created_at || input.createdAt;
        this.db.prepare(`
      INSERT OR REPLACE INTO cognitive_edges (
        edge_id, source_node_id, target_node_id, edge_type, weight, project_id, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(edgeId, input.sourceNodeId, input.targetNodeId, input.edgeType, input.weight ?? 1.0, input.projectId || null, input.metadata ? JSON.stringify(input.metadata) : null, createdAt);
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
    collectContext(input) {
        const limit = input.limit ?? 120;
        const hopLimit = Math.max(1, input.hopLimit ?? 2);
        const seedNodeIds = new Set(input.seedNodeIds || []);
        const traversedNodeIds = new Set();
        const neuronIds = new Set();
        const terms = (input.terms || []).map((term) => term.trim().toLowerCase()).filter((term) => term.length >= 2);
        for (const key of input.seedNodeKeys || []) {
            const rows = this.db.prepare(`
        SELECT node_id
        FROM cognitive_nodes
        WHERE node_key = ?
          AND (? IS NULL OR project_id = ?)
      `).all(key, input.projectId || null, input.projectId || null);
            for (const row of rows)
                seedNodeIds.add(row.node_id);
        }
        for (const term of terms) {
            const rows = this.db.prepare(`
        SELECT node_id
        FROM cognitive_nodes
        WHERE (? IS NULL OR project_id = ?)
          AND (lower(title) LIKE ? OR lower(node_key) LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(input.projectId || null, input.projectId || null, `%${term}%`, `%${term}%`, limit);
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
          ORDER BY ce.created_at DESC
          LIMIT ?
        `).all(nodeId, nodeId, nodeId, input.projectId || null, input.projectId || null, input.projectId || null, input.projectId || null, limit);
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
      `).all(...Array.from(traversedNodeIds), input.projectId || null, input.projectId || null);
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
        const row = this.db.prepare(`SELECT COUNT(*) AS count FROM cognitive_nodes`).get();
        return row?.count || 0;
    }
    getEdgeCount() {
        const row = this.db.prepare(`SELECT COUNT(*) AS count FROM cognitive_edges`).get();
        return row?.count || 0;
    }
    close() {
        this.db.close();
    }
}
