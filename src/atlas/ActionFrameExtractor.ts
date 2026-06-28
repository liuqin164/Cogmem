import { createHash } from 'node:crypto';
import type Database from 'bun:sqlite';
import type { MemoryEvent } from '../types/index.js';
import type { EventStore } from '../store/EventStore.js';
import type { MemoryAtlasStore } from '../store/MemoryAtlasStore.js';
import { eventTextForMemory } from '../episode/CogmemBlockStripper.js';
import { actionMarkers } from './MemoryAtlasQueryCompiler.js';

interface TargetMatch {
  entityId?: string;
  entityName?: string;
  topicPath?: string;
  confidence: number;
}

interface EntityCandidate {
  entityId: string;
  canonicalName: string;
  aliases: string[];
}

/** Builds source-anchored action frames from raw events; bindings improve the
 * target/topic facets but are not a prerequisite for an action to exist. */
export class ActionFrameExtractor {
  constructor(private db: Database, private eventStore: EventStore, private atlasStore: MemoryAtlasStore) {}

  rebuild(projectId?: string): number {
    this.clear(projectId);
    const entityCache = new Map<string, EntityCandidate[]>();
    const yearEvidence = new Map<string, { projectId: string; year: number; eventIds: Set<string> }>();
    let created = 0;
    let page = 1;
    const pageSize = 1000;
    while (true) {
      const result = this.eventStore.queryEvents(page, pageSize, {
        projectId: projectId ? [projectId] : undefined,
      });
      for (const event of result.records) {
        if (!event.projectId || (event.role !== 'user' && event.role !== 'tool')) continue;
        const text = eventTextForMemory(event);
        const markers = actionMarkers(text);
        if (!markers.length) continue;
        const target = this.resolveTarget(event, text, entityCache);
        for (const marker of markers) {
          const actionId = createHash('sha256').update([
            event.projectId, event.eventId, target.entityId || '', marker.frameType, marker.action,
          ].join('\0')).digest('hex').slice(0, 24);
          const now = Date.now();
          const episode = this.db.prepare(`SELECT episode_id FROM memory_episode_events WHERE event_id=? LIMIT 1`).get(event.eventId) as { episode_id: string } | null;
          this.db.prepare(`
            INSERT INTO memory_action_frames(
              action_id,project_id,frame_type,action,actor,target_entity_id,target_label,
              topic_path,episode_id,occurred_at,confidence,source_authority,created_at,updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(action_id) DO UPDATE SET action=excluded.action,target_entity_id=excluded.target_entity_id,
              target_label=excluded.target_label,topic_path=excluded.topic_path,episode_id=excluded.episode_id,
              confidence=excluded.confidence,updated_at=excluded.updated_at
          `).run(actionId, event.projectId, marker.frameType, marker.action, event.role,
            target.entityId || null, target.entityName || null, target.topicPath || null,
            episode?.episode_id || null, event.occurredAt, target.confidence,
            event.role === 'tool' ? 'tool_evidence' : 'raw_user_request', now, now);
          this.db.prepare(`INSERT OR IGNORE INTO memory_action_frame_evidence(action_id,event_id,project_id,created_at) VALUES(?,?,?,?)`)
            .run(actionId, event.eventId, event.projectId, now);
          this.atlasStore.upsertDocument({
            id: `action:${actionId}`, projectId: event.projectId, nodeType: 'action', memoryKind: 'action', sourceId: actionId,
            label: [target.entityName, marker.action].filter(Boolean).join(' ') || marker.action,
            summary: text.slice(0, 500), topicPath: target.topicPath,
            confidence: target.confidence, supportCount: 1, status: 'active', occurredAt: event.occurredAt,
            evidenceEventIds: [event.eventId], metadata: {
              frameType: marker.frameType, targetEntityId: target.entityId, actor: event.role,
            },
          });
          created += 1;
        }
        const year = new Date(event.occurredAt).getUTCFullYear();
        const key = `${event.projectId}\0${year}`;
        const aggregate = yearEvidence.get(key) || { projectId: event.projectId, year, eventIds: new Set<string>() };
        aggregate.eventIds.add(event.eventId); yearEvidence.set(key, aggregate);
      }
      if (page * pageSize >= result.total) break;
      page += 1;
    }
    for (const aggregate of yearEvidence.values()) {
      const evidenceEventIds = [...aggregate.eventIds];
      this.atlasStore.upsertDocument({
        id: `time:${aggregate.projectId}:${aggregate.year}`, projectId: aggregate.projectId,
        nodeType: 'time', memoryKind: 'time', sourceId: String(aggregate.year), label: String(aggregate.year),
        confidence: 1, supportCount: evidenceEventIds.length, status: 'active',
        occurredAt: Date.UTC(aggregate.year, 0, 1), evidenceEventIds,
      });
    }
    return created;
  }

  private clear(projectId?: string): void {
    if (projectId) {
      this.db.prepare(`DELETE FROM memory_action_frame_evidence WHERE project_id=?`).run(projectId);
      this.db.prepare(`DELETE FROM memory_action_frames WHERE project_id=?`).run(projectId);
      this.db.prepare(`DELETE FROM memory_atlas_documents WHERE project_id=? AND node_type IN ('action','time')`).run(projectId);
      this.db.prepare(`DELETE FROM memory_atlas_fts WHERE project_id=? AND node_type IN ('action','time')`).run(projectId);
      return;
    }
    this.db.exec(`
      DELETE FROM memory_action_frame_evidence;
      DELETE FROM memory_action_frames;
      DELETE FROM memory_atlas_documents WHERE node_type IN ('action','time');
      DELETE FROM memory_atlas_fts WHERE node_type IN ('action','time');
    `);
  }

  private resolveTarget(event: MemoryEvent, text: string, cache: Map<string, EntityCandidate[]>): TargetMatch {
    const projectId = event.projectId;
    if (!projectId) return { confidence: 0.65 };
    const binding = this.db.prepare(`
      SELECT entity_id,entity_name,topic_path,confidence FROM memory_bindings
      WHERE project_id=? AND event_id=? AND entity_id IS NOT NULL
      ORDER BY confidence DESC,created_at DESC LIMIT 1
    `).get(projectId, event.eventId) as Record<string, unknown> | null;
    if (binding) return {
      entityId: String(binding.entity_id), entityName: optionalString(binding.entity_name),
      topicPath: optionalString(binding.topic_path), confidence: Number(binding.confidence || 0.8),
    };
    let candidates = cache.get(projectId);
    if (!candidates) {
      const rows = this.db.prepare(`SELECT entity_id,canonical_name,aliases_json FROM memory_entities WHERE project_id=?`).all(projectId) as Array<Record<string, unknown>>;
      candidates = rows.map((row) => ({
        entityId: String(row.entity_id), canonicalName: String(row.canonical_name), aliases: parseAliases(row.aliases_json),
      }));
      cache.set(projectId, candidates);
    }
    const normalized = normalize(text);
    const matched = candidates.find((candidate) => candidate.aliases.some((alias) => alias.length > 1 && normalized.includes(normalize(alias))));
    return matched ? { entityId: matched.entityId, entityName: matched.canonicalName, confidence: 0.82 } : { confidence: 0.65 };
  }
}

function parseAliases(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.from(new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []));
  } catch { return []; }
}
function normalize(value: string): string { return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ''); }
function optionalString(value: unknown): string | undefined { return typeof value === 'string' && value ? value : undefined; }
