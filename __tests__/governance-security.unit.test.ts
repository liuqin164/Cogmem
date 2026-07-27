import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AesGcmEncryptionProvider, PiiRedactor, createMemoryKernel } from '../src/public.js';
import { PRIVACY_BASELINE_CLASSIFICATION, PRIVACY_SCHEMA_CLASSIFICATION } from '../src/governance/PrivacyDeletionRegistry.js';
import { V0_5_BASELINE_TABLES } from '../src/migrations/0001_init.js';
import type { EmbeddingProvider } from '../src/embedding/EmbeddingProvider.js';
import { FileAssetStore } from '../src/assets/FileAssetStore.js';
import { FileBlockStore } from '../src/assets/FileBlockStore.js';
import { FileChunkStore } from '../src/assets/FileChunkStore.js';
import { UserModelStore } from '../src/models/UserModelStore.js';

function tempDir(): string {
  const dir = join(tmpdir(), `core-governance-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('Governance and security v1.14', () => {
  test('every baseline table has an explicit privacy classification', () => {
    expect(Object.keys(PRIVACY_BASELINE_CLASSIFICATION).sort()).toEqual([...V0_5_BASELINE_TABLES].sort());
  });

  test('BeliefStore distinguishes all, projectless, and named project scopes', () => {
    const kernel = createMemoryKernel();
    const db = kernel.factStore.getDatabase();
    const insert = db.prepare(`INSERT INTO beliefs(id,project_id,scope,subject,predicate,object_value,canonical_key,valid_from,created_at,updated_at) VALUES(?,?,'project','scopeprobe','is',?,?,1,1,1)`);
    insert.run('belief-global', null, 'global', 'global-key');
    insert.run('belief-a', 'a', 'a', 'a-key');
    insert.run('belief-b', 'b', 'b', 'b-key');

    expect(kernel.beliefStore.countActive()).toBe(3);
    expect(kernel.beliefStore.countActive('')).toBe(1);
    expect(kernel.beliefStore.countActive('a')).toBe(1);
    expect(kernel.beliefStore.listByTimeRange(0, 2, { projectId: '' }).map((belief) => belief.id)).toEqual(['belief-global']);
    expect(kernel.beliefStore.getActiveBeliefsForQuery({ query: 'scopeprobe', projectId: '', limit: 10 }).map((belief) => belief.id)).toEqual(['belief-global']);
    expect([...kernel.beliefStore.getBeliefHistoryForCanonicalKeys(['global-key', 'a-key', 'b-key'], { projectId: '' }).values()].flat().map((belief) => belief.id)).toEqual(['belief-global']);
    expect([...kernel.beliefStore.getBeliefHistoryForCanonicalKeys(['global-key', 'a-key', 'b-key'], { projectId: 'a' }).values()].flat().map((belief) => belief.id)).toEqual(['belief-a']);
    kernel.close();
  });

  test('belief revisions and evidence cannot cross project scope', () => {
    const kernel = createMemoryKernel();
    const eventA = kernel.eventStore.append({
      eventId: 'belief-a-event', streamId: 'belief-a', streamType: 'thread',
      eventType: 'MESSAGE', projectId: 'a', payload: { text: 'A' },
    });
    const eventB = kernel.eventStore.append({
      eventId: 'belief-b-event', streamId: 'belief-b', streamType: 'thread',
      eventType: 'MESSAGE', projectId: 'b', payload: { text: 'B' },
    });
    const make = (projectId: string, sourceEventId: string, value: string) => kernel.beliefStore.upsert({
      projectId, scope: 'project' as const, subject: 'shared', predicate: 'state',
      objectValue: { raw: value, normalized: value, type: 'string' as const },
      confidence: 0.9, sourceEventId, sourceType: 'user_input' as const,
      validityKind: 'open' as const, validFrom: 1,
    }).belief!;
    const beliefA = make('a', eventA.eventId, 'A');
    const beliefB = make('b', eventB.eventId, 'B');

    expect(kernel.beliefStore.findByCanonicalKey(beliefA.canonicalKey, 'a').map((belief) => belief.id)).toEqual([beliefA.id]);
    expect(kernel.beliefStore.findByCanonicalKey(beliefA.canonicalKey, 'b').map((belief) => belief.id)).toEqual([beliefB.id]);
    expect(kernel.beliefStore.findByCanonicalKey(beliefA.canonicalKey, 'a')[0]?.status).toBe('active');
    expect(() => kernel.beliefStore.attachEvidence([{
      beliefId: beliefA.id, eventId: eventB.eventId, evidenceType: 'source_event', weight: 1, createdAt: 2,
    }])).toThrow('belief_evidence_project_scope_mismatch');
    kernel.close();
  });

  test('every current persistent table has an explicit privacy classification', () => {
    const kernel = createMemoryKernel();
    const db = kernel.factStore.getDatabase();
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>).map((row) => row.name);
    expect(tables.filter((table) => !PRIVACY_SCHEMA_CLASSIFICATION[table] && !/^(?:neurons|memory_events|memory_atlas|deep_write_summaries)_fts(?:_|$)/.test(table))).toEqual([]);
    const triggers = (db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger'`).all() as Array<{ name: string }>).map((row) => row.name);
    for (const trigger of ['synapses_scope_insert','belief_evidence_scope_insert','cognitive_node_source_insert','pending_entity_scope_insert','memory_binding_scope_insert']) {
      expect(triggers).toContain(trigger);
    }
    kernel.close();
  });

  test('AesGcmEncryptionProvider round-trips encrypted payloads', () => {
    const provider = AesGcmEncryptionProvider.fromPassphrase('correct horse battery staple');
    const ciphertext = provider.encrypt('sensitive source text');

    expect(ciphertext).toStartWith('enc:v1:');
    expect(ciphertext).not.toContain('sensitive source text');
    expect(provider.decrypt(ciphertext)).toBe('sensitive source text');
  });

  test('PiiRedactor removes email phone and SSN values before persistence', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'memory.db');
    const kernel = createMemoryKernel({ dbPath });

    await kernel.ingest({
      projectId: 'pii-user',
      content: '联系 alice@example.com，电话 138-0013-8000，SSN 123-45-6789。',
      sourceType: 'chat',
    });
    kernel.close();

    const db = new Database(dbPath);
    const row = db.prepare(`SELECT content FROM neurons LIMIT 1`).get() as { content: string };
    expect(row.content).toContain('[REDACTED_EMAIL]');
    expect(row.content).toContain('[REDACTED_PHONE]');
    expect(row.content).toContain('[REDACTED_SSN]');
    expect(row.content).not.toContain('alice@example.com');
    expect(new PiiRedactor().redact('email a@b.com').findings[0]?.type).toBe('email');
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('encrypted EventStore and FactStore fields remain readable through public APIs', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'memory.db');
    const encryptionProvider = AesGcmEncryptionProvider.fromPassphrase('memory-secret');
    const kernel = createMemoryKernel({ dbPath, encryptionProvider });

    const neuron = await kernel.ingest({ projectId: 'secure-user', content: 'encrypted event memory' });
    const [fact] = kernel.factStore.insertFacts([{
      neuronId: neuron.id,
      subject: 'secure-user',
      predicateFamily: 'preference',
      object: 'encrypted facts',
      validFrom: Date.now(),
      certaintyLevel: 'certain',
      confidence: 1,
      status: 'verified',
      sourceText: 'secret fact source text',
    }]);

    const db = new Database(dbPath);
    const eventRow = db.prepare(`SELECT payload_json FROM memory_events WHERE event_type = 'INGESTED' LIMIT 1`).get() as { payload_json: string };
    const factRow = db.prepare(`SELECT source_text FROM facts WHERE fact_id = ?`).get(fact.factId) as { source_text: string };
    expect(eventRow.payload_json).toStartWith('enc:v1:');
    expect(factRow.source_text).toStartWith('enc:v1:');
    expect(kernel.eventStore.queryEvents(1, 1).records[0]?.payload).toBeDefined();
    expect(kernel.factStore.getFactById(fact.factId)?.sourceText).toBe('secret fact source text');
    db.close();
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('forgetUser fails closed when a new persistent table has no privacy classification', async () => {
    const kernel = createMemoryKernel();
    await kernel.ingest({ projectId: 'classified-project', content: 'must remain until schema is classified' });
    kernel.factStore.getDatabase().exec(`CREATE TABLE privacy_unknown_payload(id TEXT PRIMARY KEY, payload TEXT)`);
    expect(kernel.forgetUser('classified-project')).rejects.toThrow('privacy_schema_unclassified:privacy_unknown_payload');
    expect(kernel.recall('must remain until schema is classified', { projectId: 'classified-project' }).rawEvidence.length).toBeGreaterThan(0);
    kernel.close();
  });

  test('forgetUser with an embedding provider prevents a deferred write from resurrecting deleted data', async () => {
    let resolveEmbedding!: (value: Float32Array) => void;
    const pending = new Promise<Float32Array>((resolve) => { resolveEmbedding = resolve; });
    const provider: EmbeddingProvider = {
      modelId: 'test/deferred', dimensions: 2,
      embed: async () => pending,
      embedBatch: async (texts) => Promise.all(texts.map(() => pending)),
    };
    const kernel = createMemoryKernel({ embeddingProvider: provider });
    const neuron = await kernel.ingest({ projectId: 'erase-race', content: 'private deferred embedding' });

    await kernel.forgetUser('erase-race');
    resolveEmbedding(new Float32Array([1, 0]));
    await Promise.resolve();
    await Promise.resolve();

    const db = kernel.factStore.getDatabase();
    expect(db.prepare(`SELECT COUNT(*) AS count FROM neuron_embeddings WHERE neuron_id=?`).get(neuron.id)).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM re_embedding_progress WHERE projectId='erase-race'`).get()).toEqual({ count: 0 });
    kernel.close();
  });

  test('forgetUser deletes project memory and writes audit records', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'memory.db');
    const kernel = createMemoryKernel({ dbPath });

    const forgotten = await kernel.ingest({ projectId: 'forget-me', content: 'delete this project memory' });
    await kernel.ingest({ projectId: 'keep-me', content: 'keep this project memory' });
    kernel.activationStore.touch({
      neuronId: forgotten.id,
      projectId: 'forget-me',
      source: 'test:forget_user',
    });
    const evidence = kernel.recordRawEvent({
      threadId: 'forget-thread', projectId: 'forget-me', role: 'user',
      content: 'Remind me to remove this private release follow-up.',
    });
    kernel.prospectiveMemoryService.propose({
      projectId: 'forget-me', candidateType: 'reminder', canonicalKey: 'private:release',
      title: 'Private release follow-up', evidenceEventIds: [evidence.eventId], proposedBy: 'deterministic',
    });
    kernel.beliefGovernanceService.apply({
      projectId: 'forget-me', ownership: 'user', beliefType: 'boundary', canonicalKey: 'private:boundary',
      statement: 'Private project boundary.', evidenceEventIds: [evidence.eventId],
    });
    kernel.temporalMemoryService.record({
      projectId: 'forget-me', entryType: 'decision', title: 'Private decision', evidenceEventIds: [evidence.eventId],
    });
    kernel.contextCortex.plan({
      query: 'private project status', projectId: 'forget-me', availableTokens: 100,
      candidates: [{ id: 'private-context', layer: 'raw_source', content: 'Private context', projectId: 'forget-me' }],
    });
    kernel.executeMemoryGovernancePlan({
      planId: 'forget-plan', projectId: 'forget-me', proposedBy: 'deterministic', createdAt: Date.now(),
      operations: [{
        operationId: 'forget-bind', type: 'BIND_EVENT', projectId: 'forget-me',
        evidenceEventIds: [evidence.eventId], sourceRole: 'user', ownership: 'project',
        idempotencyKey: 'forget:bind', payload: { eventId: evidence.eventId },
      }],
    });
    const forgottenEntity = kernel.entityStore.upsertEntity({
      canonicalName: 'Shared Person', type: 'person', aliases: ['Forgotten Alias'],
      metadata: { projectId: 'forget-me' }, instanceMode: 'new_instance',
    });
    const keptEntity = kernel.entityStore.upsertEntity({
      canonicalName: 'Shared Person', type: 'person', aliases: ['Kept Alias'],
      metadata: { projectId: 'keep-me' }, instanceMode: 'new_instance',
    });
    const legacyMentionOnlyEntity = kernel.entityStore.upsertEntity({
      canonicalName: 'Legacy Private Person', type: 'person', aliases: ['Legacy Private Alias'],
      instanceMode: 'new_instance',
    });
    const insertLegacyMention = kernel.entityStore.getDatabase().prepare(`INSERT INTO entity_mentions(
      mention_id,entity_id,neuron_id,project_id,mention_type,created_at
    ) VALUES(?,?,NULL,?,'referenced',?)`);
    insertLegacyMention.run('legacy-private', legacyMentionOnlyEntity.entityId, 'forget-me', Date.now());
    const otherProjectOwnedEntity = kernel.entityStore.upsertEntity({
      canonicalName: 'Other Project Person', type: 'person', aliases: ['Other Project Alias'],
      metadata: { projectId: 'keep-me' }, instanceMode: 'new_instance',
    });
    insertLegacyMention.run('legacy-cross-owner', otherProjectOwnedEntity.entityId, 'forget-me', Date.now());
    const sharedLegacyEntity = kernel.entityStore.upsertEntity({
      canonicalName: 'Shared Legacy Person', type: 'person', aliases: ['Shared Legacy Alias'],
      instanceMode: 'new_instance',
    });
    insertLegacyMention.run('legacy-shared-forget', sharedLegacyEntity.entityId, 'forget-me', Date.now());
    insertLegacyMention.run('legacy-shared-keep', sharedLegacyEntity.entityId, 'keep-me', Date.now());
    expect(kernel.buildMemoryMap({ projectId: 'forget-me' }).counters.activationHotspots).toBe(1);
    const capsule = kernel.strategyCortex.plan({ query: 'project status', intent: 'project_status', projectId: 'forget-me' });
    kernel.contextOutcomeStore.record(kernel.memoryUseJudge.judge({
      receiptId: 'forget-outcome', capsule,
      selected: [{ id: 'memory', layer: 'belief', hasSourceEvidence: true }],
      usedTokens: 10, budgetTokens: 100, latencyMs: 5,
    }));
    const episodeMessage = kernel.appendEpisodeMessage({
      projectId: 'forget-me', sessionId: 'forget-session', sourceAgent: 'test', role: 'user',
      text: 'Forget this episode too.', externalMessageId: 'forget-episode-message',
    });
    kernel.sealEpisode(episodeMessage.episodeId!, { mode: 'manual', reason: 'test' });
    const db = kernel.factStore.getDatabase();
    db.prepare(`INSERT INTO deep_write_summaries(summary_id,project_id,scope,text,confidence,status,source_neuron_ids_json,created_at,updated_at) VALUES('named-secret','forget-me','turn_window','named private summary',1,'provisional','[]',1,1),('named-keep','keep-me','turn_window','retained summary',1,'provisional','[]',1,1)`).run();
    db.prepare(`INSERT INTO pipeline_nonfatal_events(event_id,kind,project_id,message,occurred_at) VALUES('named-pipeline','test','forget-me','named private pipeline',1)`).run();
    db.prepare(`INSERT INTO ingestion_processed_records(
      record_hash,source_id,source_path,source_type,content_hash,content_window_start,
      content_window_end,processed_at,neuron_id,project_scope
    ) VALUES('dangling-forget','source','/private','conversation_markdown','secret',0,1,1,NULL,'forget-me')`).run();
    db.prepare(`INSERT INTO policy_executions(
      execution_id,project_scope,idempotency_key,policy,action,status,attempt_count,detail,created_at,updated_at
    ) VALUES('forget-policy','forget-me','forget-key','private','allow','executed',1,'private policy detail',1,1)`).run();
    db.exec(`CREATE TABLE IF NOT EXISTS pending_entity_resolution_quarantine(
      pending_id TEXT PRIMARY KEY,record_json TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL,
      project_scope TEXT NOT NULL DEFAULT '',implicated_scopes_json TEXT NOT NULL DEFAULT '[]',
      context_neuron_id TEXT,scope_resolved INTEGER NOT NULL DEFAULT 0
    )`);
    db.prepare(`INSERT INTO pending_entity_resolution_quarantine(
      pending_id,record_json,reason,created_at,project_scope,implicated_scopes_json,context_neuron_id,scope_resolved
    ) VALUES('forget-pending',?,'pending_context_unproven',1,'forget-me','["forget-me"]',?,1)`)
      .run(JSON.stringify({ context_neuron_id: forgotten.id, reference_text: 'private pending detail' }), forgotten.id);

    const result = await kernel.forgetUser('forget-me', 'user_requested');

    expect(result.deleted.neurons).toBe(1);
    expect(result.deleted.activations).toBe(1);
    expect(result.deleted.episodes).toBeGreaterThan(0);
    expect(result.deleted.brainProjections).toBeGreaterThan(0);
    expect(result.deleted.entityRecords).toBeGreaterThan(0);
    expect(kernel.recall('delete this project memory', { projectId: 'forget-me' }).rawEvidence).toHaveLength(0);
    expect(kernel.recall('keep this project memory', { projectId: 'keep-me' }).rawEvidence.length).toBeGreaterThan(0);
    expect(kernel.activationStore.getTop({ projectId: 'forget-me' })).toHaveLength(0);
    expect(kernel.buildMemoryMap({ projectId: 'forget-me' }).counters.activationHotspots).toBe(0);
    expect(kernel.runMaintenanceTick({ projectId: 'forget-me' }).chargeVector.activationHotspots).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM neurons WHERE project_id='forget-me'`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM neurons WHERE content LIKE '%delete this project memory%'`).get()).toEqual({ count: 0 });
    for (const table of [
      'prospective_memories', 'context_strategy_outcomes', 'context_activation_receipts', 'memory_timeline_entries',
      'belief_graph_nodes', 'entity_merge_candidates', 'memory_governance_plans',
      'memory_episodes', 'episode_dream_jobs', 'episode_closure_receipts', 'episode_ingest_keys',
    ]) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE project_id = ?`).get('forget-me')).toEqual({ count: 0 });
    }
    expect(db.prepare(`SELECT COUNT(*) AS count FROM time_buckets WHERE project_id = ?`).get('forget-me')).toEqual({ count: 0 });
    expect(db.prepare(`SELECT summary_id FROM deep_write_summaries`).all()).toEqual([{ summary_id: 'named-keep' }]);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM pipeline_nonfatal_events WHERE project_id='forget-me'`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM ingestion_processed_records WHERE project_scope='forget-me'`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM policy_executions WHERE project_scope='forget-me'`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM pending_entity_resolution_quarantine WHERE project_scope='forget-me'`).get()).toEqual({ count: 0 });
    expect(kernel.entityStore.findByEntityId(forgottenEntity.entityId)).toBeNull();
    expect(kernel.entityStore.findByEntityId(legacyMentionOnlyEntity.entityId)).toBeNull();
    expect(kernel.entityStore.findByEntityId(keptEntity.entityId)).not.toBeNull();
    expect(kernel.entityStore.findByEntityId(otherProjectOwnedEntity.entityId)).not.toBeNull();
    expect(kernel.entityStore.findByEntityId(sharedLegacyEntity.entityId)).not.toBeNull();
    expect(kernel.entityStore.listTimeline({ entityId: sharedLegacyEntity.entityId }).map((item) => item.projectId)).toEqual(['keep-me']);
    expect(kernel.entityStore.findByEntityId(sharedLegacyEntity.entityId)?.aliases).not.toContain('Shared Legacy Alias');
    expect(db.prepare(`SELECT aliases_json,metadata_json FROM entity_instances WHERE instance_id=?`).get(sharedLegacyEntity.entityId)).toEqual({ aliases_json: '[]', metadata_json: '{}' });
    const canonical = db.prepare(`SELECT aliases_json, metadata_json FROM entities WHERE entity_id = ?`)
      .get(keptEntity.canonicalEntityId!) as { aliases_json: string; metadata_json: string };
    expect(canonical.aliases_json).not.toContain('Forgotten Alias');
    expect(canonical.aliases_json).toContain('Kept Alias');
    expect(canonical.metadata_json).not.toContain('forget-me');
    expect(kernel.getGovernanceAudit('forget-me')[0]?.action).toBe('forgetUser');
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('forgetUser erases optional file/user-model stores and rebuilds touched shared canonical entities', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'memory.db');
    const secret = 'OPTIONAL_PRIVATE_TOKEN_8e31';
    const kernel = createMemoryKernel({ dbPath });
    const neuron = await kernel.ingest({ projectId: 'a', content: `${secret} neuron` });
    const db = kernel.factStore.getDatabase();
    new FileAssetStore(db).upsert({ assetId: 'asset-a', projectId: 'a', filePath: `/tmp/${secret}.txt`, originalName: secret, sizeBytes: 1, contentHash: 'hash', mtimeMs: 1 });
    new FileBlockStore(db);
    new FileChunkStore(db);
    new UserModelStore(db);
    db.prepare(`INSERT INTO file_blocks(block_id,asset_id,block_index,kind,text,created_at) VALUES('block-a','asset-a',0,'paragraph',?,1)`).run(secret);
    db.prepare(`INSERT INTO file_chunks(chunk_id,asset_id,neuron_id,chunk_index,block_start_index,block_end_index,kind,text_hash,created_at) VALUES('chunk-a','asset-a',?,0,0,0,'paragraph','hash',1)`).run(neuron.id);
    db.exec(`INSERT INTO file_chunk_edges VALUES('chunk-a','chunk-a','next_chunk',1,1)`);
    db.prepare(`INSERT INTO user_insights(id,project_id,category,content,confidence,evidence_neuron_ids,created_at,last_confirmed_at) VALUES('insight-a','a','preference',?,1,?,1,1)`).run(secret, JSON.stringify([neuron.id]));
    db.exec(`
      INSERT INTO entities(entity_id,canonical_name,type,aliases_json,status,metadata_json,created_at,updated_at) VALUES('canonical-shared', '${secret}', 'device', '["${secret}"]', 'active', '{"private":"${secret}"}', 1, 1);
      INSERT INTO entity_instances(instance_id,canonical_entity_id,canonical_name,type,aliases_json,status,created_at,updated_at,metadata_json) VALUES('shared-instance','canonical-shared','${secret}','device','["${secret}"]','active',1,1,'{}');
      INSERT INTO entity_mentions(mention_id,entity_id,project_id,mention_type,created_at) VALUES('mention-a','shared-instance','a','explicit',1),('mention-b','shared-instance','b','explicit',2);
      INSERT INTO entity_aliases(alias_id,entity_id,project_id,alias_text,normalized_alias,created_at,updated_at) VALUES('alias-b','shared-instance','b','safe-name','safe-name',1,1);
    `);

    await kernel.forgetUser('a');
    for (const table of ['file_assets','file_blocks','file_chunks','file_chunk_edges','user_insights']) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
    expect(db.prepare(`SELECT canonical_name,aliases_json,metadata_json FROM entities WHERE entity_id='canonical-shared'`).get()).toEqual({
      canonical_name: 'safe-name', aliases_json: '["safe-name"]', metadata_json: '{}',
    });
    kernel.close();
    expect(readFileSync(dbPath).includes(Buffer.from(secret))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  test('forgetUser physically erases global memory from sqlite and exported snapshots', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'memory.db');
    const snapshotPath = join(dir, 'after-forget.snap');
    const secret = 'GLOBAL_ERASURE_TOKEN_7c6437f4';
    const kernel = createMemoryKernel({ dbPath, projectTimeZone: 'UTC' });
    const forgotten = await kernel.ingest({ content: `${secret} private projectless memory`, createdAt: 1000 });
    const rawEvent = kernel.recordRawEvent({ threadId: 'global-private', role: 'user', content: `${secret} raw ledger evidence`, occurredAt: 1000 });
    const episodeMessage = kernel.appendEpisodeMessage({ projectId: '', sessionId: 'secret-session', sourceAgent: 'test', role: 'user', text: `${secret} episode`, externalMessageId: 'secret-message' });
    await kernel.ingest({ projectId: 'keep-project', content: 'ordinary retained memory', createdAt: 2000 });
    const db = kernel.factStore.getDatabase();
    db.prepare(`INSERT INTO deep_write_summaries(summary_id,project_id,scope,text,confidence,status,source_neuron_ids_json,created_at,updated_at) VALUES('secret-summary','','turn_window',?,1,'provisional','[]',1,1)`).run(`${secret} summary`);
    db.prepare(`INSERT INTO deep_write_runs(run_id,project_id,source_neuron_ids_json,mode,prompt_hash,output_hash,status,error,created_at,updated_at) VALUES('secret-run','','[]','shadow','p','o','succeeded',?,1,1)`).run(`${secret} run error`);
    db.prepare(`INSERT INTO deep_write_candidates(candidate_id,run_id,candidate_type,status,confidence,content_json,evidence_json,status_reason,created_at,updated_at) VALUES('secret-candidate','secret-run','belief','needs_confirmation',1,?,?,?,1,1)`).run(JSON.stringify({ secret }), JSON.stringify({ secret }), `${secret} status`);
    db.prepare(`INSERT INTO deep_write_candidate_reviews(review_id,candidate_id,project_id,action,actor,reason,from_status,to_status,decision_json,created_at) VALUES('secret-review','secret-candidate','','defer','tester',?,'needs_confirmation','needs_confirmation',?,1)`).run(`${secret} review`, JSON.stringify({ secret }));
    db.prepare(`INSERT INTO pipeline_nonfatal_events(event_id,kind,project_id,message,details_json,occurred_at) VALUES('secret-pipeline','test','',?,?,1)`).run(`${secret} pipeline`, JSON.stringify({ secret }));
    db.exec(`CREATE TABLE IF NOT EXISTS reasoning_chains(id TEXT PRIMARY KEY,outcome TEXT NOT NULL,project_id TEXT,created_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS reasoning_steps(chain_id TEXT NOT NULL,neuron_id TEXT NOT NULL,role TEXT NOT NULL,step_order INTEGER NOT NULL,PRIMARY KEY(chain_id,neuron_id));`);
    db.prepare(`INSERT INTO reasoning_chains VALUES('secret-chain',?,'',1)`).run(`${secret} reasoning outcome`);
    db.prepare(`INSERT INTO reasoning_steps VALUES('secret-chain',?,'evidence',0)`).run(forgotten.id);
    db.exec(`PRAGMA foreign_keys=OFF`);
    db.prepare(`INSERT INTO memory_frame_reviews(review_id,frame_id,project_id,action,actor,reason,created_at) VALUES('secret-frame-review','legacy-frame','','reject','tester',?,1)`).run(`${secret} frame review`);
    db.prepare(`INSERT INTO memory_atlas_alias_supports(support_id,alias_id,project_id,node_id,source_frame_id,evidence_event_ids_json,status,created_at,payload_json) VALUES('secret-alias-support','secret-alias','','secret-node','secret-frame',?,'active',1,?)`).run(JSON.stringify([`${secret}-event`]), JSON.stringify({ secret }));
    db.prepare(`INSERT INTO governance_audit_log VALUES('old-secret-audit','forgetUser','',?,?,1)`).run(`${secret} old reason`, JSON.stringify({ secret }));
    db.prepare(`INSERT INTO beliefs(id,project_id,scope,subject,predicate,object_value,canonical_key,source_neuron_id,valid_from,created_at,updated_at) VALUES('secret-belief',NULL,'global',?,?,?,'secret-key',?,1,1,1)`).run(`${secret} subject`, `${secret}.predicate`, `${secret} object`, forgotten.id);
    db.prepare(`INSERT INTO belief_evidence(belief_id,neuron_id,event_id,evidence_type,created_at) VALUES('secret-belief',?,NULL,'source',1)`).run(forgotten.id);
    db.prepare(`INSERT INTO topic_nodes(topic_id,project_id,topic_path,canonical_name,ontology_class,status,created_by,confidence,evidence_event_ids_json,evidence_episode_ids_json,last_used_at,merge_candidates_json,created_at,updated_at) VALUES('secret-topic','',?,?,'custom','active','user',1,?,'[]',1,'[]',1,1)`).run(`${secret}/path`, `${secret} topic`, JSON.stringify([`${secret}-event`]));
    db.prepare(`INSERT INTO topic_aliases(alias_id,project_id,normalized_alias,alias,topic_id,status,created_by,confidence,evidence_event_ids_json,created_at,updated_at) VALUES('secret-topic-alias','',?,?, 'secret-topic','active','user',1,?,1,1)`).run(`${secret}-alias`, `${secret} alias`, JSON.stringify([`${secret}-event`]));
    db.prepare(`INSERT INTO topic_relations(relation_id,project_id,source_topic_id,relation,target_topic_id,status,created_by,confidence,evidence_event_ids_json,evidence_episode_ids_json,created_at,updated_at) VALUES('secret-topic-relation','','secret-topic',?,'secret-topic','active','user',1,?,'[]',1,1)`).run(`${secret} relation`, JSON.stringify([`${secret}-event`]));
    db.prepare(`INSERT INTO topic_operations(operation_id,project_id,operation_type,actor,target_topic_id,payload_json,before_json,after_json,inverse_operation_json,status,evidence_event_ids_json,created_at) VALUES('secret-topic-operation','','rename','user','secret-topic',?,?,?,?,'applied',?,1)`).run(JSON.stringify({ secret }), JSON.stringify({ secret }), JSON.stringify({ secret }), JSON.stringify({ secret }), JSON.stringify([`${secret}-event`]));
    db.exec(`CREATE TABLE IF NOT EXISTS chat_sessions(session_id TEXT PRIMARY KEY,project_id TEXT,created_at INTEGER,last_active INTEGER,turn_count INTEGER); CREATE TABLE IF NOT EXISTS chat_turns(turn_id TEXT PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,timestamp INTEGER,entity_hints TEXT);`);
    db.prepare(`INSERT INTO chat_sessions VALUES('secret-chat',NULL,1,1,1)`).run();
    db.prepare(`INSERT INTO chat_turns(turn_id,session_id,role,content,timestamp,entity_hints) VALUES('secret-turn','secret-chat','user',?,1,'[]')`).run(`${secret} transcript`);
    db.exec(`CREATE TABLE IF NOT EXISTS episode_dream_attempts(attempt_id TEXT PRIMARY KEY,episode_id TEXT NOT NULL,payload_json TEXT);`);
    db.prepare(`INSERT INTO episode_dream_attempts VALUES('secret-attempt',?,?)`).run(episodeMessage.episodeId!, JSON.stringify({ secret }));
    db.prepare(`INSERT INTO topology_identity_quarantine(quarantine_id,identity_type,old_parent_id,project_scope,entry_json,reason,created_at,implicated_scopes_json) VALUES('secret-quarantine','task','old','keep-project',?,'conflict',1,?)`).run(JSON.stringify({ fact_id: `${secret}-fact` }), JSON.stringify(['keep-project', '']));
    db.exec(`
      CREATE TABLE scheduled_jobs(job_id TEXT PRIMARY KEY,payload_json TEXT NOT NULL);
      CREATE TABLE scheduled_job_runs(run_id TEXT PRIMARY KEY,job_id TEXT,error TEXT,result_json TEXT);
      CREATE TABLE notification_rules(rule_id TEXT PRIMARY KEY,workspace_id TEXT,trigger_json TEXT,channel_config_json TEXT,template TEXT);
      CREATE TABLE notification_records(notification_id TEXT PRIMARY KEY,rule_id TEXT,payload_json TEXT,error TEXT);
      CREATE TABLE workspaces(id TEXT PRIMARY KEY,config_json TEXT,name TEXT);
      CREATE TABLE workspace_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE trace_events(id TEXT PRIMARY KEY,project_id TEXT,payload TEXT);
      CREATE TABLE meta_proposals(id TEXT PRIMARY KEY,summary TEXT,evidence TEXT,suggested_change TEXT);
      CREATE TABLE meta_observations(id TEXT PRIMARY KEY,project_id TEXT,neuron_id TEXT,fact_id TEXT,content TEXT,evidence_event_ids TEXT);
    `);
    db.prepare(`INSERT INTO scheduled_jobs VALUES('secret-job',?)`).run(JSON.stringify({ projectId: '', secret }));
    db.prepare(`INSERT INTO scheduled_job_runs VALUES('secret-job-run','secret-job',?,?)`).run(secret, JSON.stringify({ secret }));
    db.prepare(`INSERT INTO notification_rules VALUES('secret-rule','',?,?,?)`).run(JSON.stringify({ projectId: '', secret }), JSON.stringify({ secret }), secret);
    db.prepare(`INSERT INTO notification_records VALUES('secret-notification','secret-rule',?,?)`).run(JSON.stringify({ secret }), secret);
    db.prepare(`INSERT INTO workspaces VALUES('',?,?)`).run(JSON.stringify({ projectId: '', secret }), secret);
    db.prepare(`INSERT INTO workspace_settings VALUES('project::secret',?)`).run(JSON.stringify({ projectId: '', secret }));
    db.prepare(`INSERT INTO trace_events VALUES('secret-trace',NULL,?)`).run(JSON.stringify({ secret }));
    db.prepare(`INSERT INTO meta_proposals VALUES('secret-proposal',?,?,?)`).run(secret, JSON.stringify([{ traceEventId: 'secret-trace', note: secret }]), JSON.stringify({ secret }));
    db.prepare(`INSERT INTO meta_observations VALUES('secret-observation',NULL,?,NULL,?,'[]')`).run(forgotten.id, secret);
    db.prepare(`INSERT INTO meta_observations VALUES('secret-observation-evidence',NULL,NULL,NULL,?,?)`).run(secret, JSON.stringify([rawEvent.eventId]));
    db.prepare(`INSERT INTO ingestion_processed_records(record_hash,source_id,source_path,source_type,content_hash,content_window_start,content_window_end,processed_at,neuron_id) VALUES('secret-ingest',?,?, 'test','hash',0,1,1,?)`).run(secret, secret, forgotten.id);
    db.exec(`INSERT OR REPLACE INTO dream_ledger_state VALUES('all',NULL,10,10,10),('scope:0:','',20,20,20),('scope:1:a','a',30,30,30)`);
    db.exec(`PRAGMA foreign_keys=ON`);

    const result = await kernel.forgetUser('', `${secret} raw audit reason`);
    expect(result.deleted.neurons).toBe(1);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM neurons WHERE project_id IS NULL`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM memory_events WHERE project_id IS NULL`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM neurons WHERE content LIKE ?`).get(`%${secret}%`)).toEqual({ count: 0 });
    for (const table of ['deep_write_summaries','deep_write_runs','deep_write_candidates','deep_write_candidate_reviews','pipeline_nonfatal_events','reasoning_chains','reasoning_steps','memory_frame_reviews','memory_atlas_alias_supports','beliefs','belief_evidence','topic_nodes','topic_aliases','topic_relations','topic_operations','chat_sessions','chat_turns','episode_dream_attempts','topology_identity_quarantine','scheduled_jobs','scheduled_job_runs','notification_rules','notification_records','workspaces','workspace_settings','meta_proposals','meta_observations','ingestion_processed_records']) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
    expect(db.prepare(`SELECT project_key FROM dream_ledger_state ORDER BY project_key`).all()).toEqual([{ project_key: 'all' }, { project_key: 'scope:1:a' }]);
    expect(db.prepare(`SELECT reason FROM governance_audit_log`).get()).toEqual({ reason: 'privacy_erasure_requested' });

    const next = await kernel.ingest({ content: 'new global memory after privacy erasure', createdAt: 3000 });
    expect(next.prev_hash).not.toBe(forgotten.self_hash);
    await kernel.exportSnapshot(snapshotPath);
    kernel.close();

    expect(readFileSync(dbPath).includes(Buffer.from(secret))).toBe(false);
    expect(readFileSync(snapshotPath).includes(Buffer.from(secret))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
