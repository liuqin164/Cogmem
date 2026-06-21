import { createHash } from 'node:crypto';
import type Database from 'bun:sqlite';
import type { EventStore } from '../store/EventStore.js';
import type { MemoryAtlasStore } from '../store/MemoryAtlasStore.js';
import { eventTextForMemory } from '../episode/CogmemBlockStripper.js';
import { actionMarker } from './MemoryAtlasQueryCompiler.js';

export class ActionFrameExtractor {
  constructor(private db: Database, private eventStore: EventStore, private atlasStore: MemoryAtlasStore) {}

  rebuild(projectId?: string): number {
    if (projectId) {
      this.db.prepare(`DELETE FROM memory_action_frame_evidence WHERE project_id=?`).run(projectId);
      this.db.prepare(`DELETE FROM memory_action_frames WHERE project_id=?`).run(projectId);
      this.db.prepare(`DELETE FROM memory_atlas_documents WHERE project_id=? AND node_type IN ('action','time')`).run(projectId);
    } else {
      this.db.exec(`DELETE FROM memory_action_frame_evidence; DELETE FROM memory_action_frames; DELETE FROM memory_atlas_documents WHERE node_type IN ('action','time');`);
    }
    const where = projectId ? 'WHERE b.project_id=?' : '';
    const bindings = this.db.prepare(`SELECT b.* FROM memory_bindings b ${where} ORDER BY b.created_at`).all(...(projectId ? [projectId] : [])) as Array<Record<string, unknown>>;
    let created = 0;
    for (const binding of bindings) {
      if (binding.role !== 'user' || !binding.entity_id || !binding.project_id) continue;
      const event = this.eventStore.getEvent(String(binding.event_id));
      if (!event || event.projectId !== String(binding.project_id)) continue;
      const text = eventTextForMemory(event);
      const marker = actionMarker(text);
      if (!marker) continue;
      const actionId = createHash('sha256').update(`${binding.project_id}\0${binding.event_id}\0${binding.entity_id}\0${marker.frameType}`).digest('hex').slice(0, 24);
      const now = Date.now();
      const eventId = String(binding.event_id);
      const bindingProjectId = String(binding.project_id);
      const entityId = String(binding.entity_id);
      const entityName = String(binding.entity_name || '');
      const topicPath = String(binding.topic_path || '');
      const occurredAt = event.occurredAt;
      const confidence = Number(binding.confidence);
      const episode = this.db.prepare(`SELECT episode_id FROM memory_episode_events WHERE event_id=? LIMIT 1`).get(eventId) as { episode_id: string } | null;
      this.db.prepare(`INSERT INTO memory_action_frames(action_id,project_id,frame_type,action,actor,target_entity_id,target_label,topic_path,episode_id,occurred_at,confidence,source_authority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(action_id) DO UPDATE SET action=excluded.action,target_label=excluded.target_label,topic_path=excluded.topic_path,episode_id=excluded.episode_id,updated_at=excluded.updated_at`).run(actionId, bindingProjectId, marker.frameType, marker.action, 'user', entityId, entityName, topicPath, episode?.episode_id || null, occurredAt, confidence, 'raw_evidence', now, now);
      this.db.prepare(`INSERT OR IGNORE INTO memory_action_frame_evidence(action_id,event_id,project_id,created_at) VALUES(?,?,?,?)`).run(actionId, eventId, bindingProjectId, now);
      this.atlasStore.upsertDocument({ id: `action:${actionId}`, projectId: String(binding.project_id), nodeType: 'action', sourceId: actionId,
        label: `${entityName} ${marker.action}`, summary: text.slice(0, 500), topicPath,
        confidence, supportCount: 1, status: 'active', occurredAt,
        evidenceEventIds: [eventId], metadata: { frameType: marker.frameType, targetEntityId: entityId } });
      const year = new Date(occurredAt).getUTCFullYear();
      this.atlasStore.upsertDocument({ id: `time:${bindingProjectId}:${year}`, projectId: bindingProjectId, nodeType: 'time', sourceId: String(year),
        label: String(year), confidence: 1, supportCount: 1, status: 'active', occurredAt: Date.UTC(year, 0, 1), evidenceEventIds: [eventId] });
      created += 1;
    }
    return created;
  }
}
