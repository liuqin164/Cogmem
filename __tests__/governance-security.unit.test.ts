import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AesGcmEncryptionProvider, PiiRedactor, createMemoryKernel } from '../src/public.js';

function tempDir(): string {
  const dir = join(tmpdir(), `core-governance-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('Governance and security v1.14', () => {
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
    kernel.entityStore.recordMention({
      entityId: legacyMentionOnlyEntity.entityId, projectId: 'forget-me', mentionType: 'referenced',
    });
    const otherProjectOwnedEntity = kernel.entityStore.upsertEntity({
      canonicalName: 'Other Project Person', type: 'person', aliases: ['Other Project Alias'],
      metadata: { projectId: 'keep-me' }, instanceMode: 'new_instance',
    });
    kernel.entityStore.recordMention({
      entityId: otherProjectOwnedEntity.entityId, projectId: 'forget-me', mentionType: 'referenced',
    });
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
    expect(kernel.entityStore.findByEntityId(forgottenEntity.entityId)).toBeNull();
    expect(kernel.entityStore.findByEntityId(legacyMentionOnlyEntity.entityId)).toBeNull();
    expect(kernel.entityStore.findByEntityId(keptEntity.entityId)).not.toBeNull();
    expect(kernel.entityStore.findByEntityId(otherProjectOwnedEntity.entityId)).not.toBeNull();
    const canonical = db.prepare(`SELECT aliases_json, metadata_json FROM entities WHERE entity_id = ?`)
      .get(keptEntity.canonicalEntityId!) as { aliases_json: string; metadata_json: string };
    expect(canonical.aliases_json).not.toContain('Forgotten Alias');
    expect(canonical.aliases_json).toContain('Kept Alias');
    expect(canonical.metadata_json).not.toContain('forget-me');
    expect(kernel.getGovernanceAudit('forget-me')[0]?.action).toBe('forgetUser');
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('forgetUser physically erases global memory from sqlite and exported snapshots', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'memory.db');
    const snapshotPath = join(dir, 'after-forget.snap');
    const secret = 'GLOBAL_ERASURE_TOKEN_7c6437f4';
    const kernel = createMemoryKernel({ dbPath, projectTimeZone: 'UTC' });
    const forgotten = await kernel.ingest({ content: `${secret} private projectless memory`, createdAt: 1000 });
    kernel.recordRawEvent({ threadId: 'global-private', role: 'user', content: `${secret} raw ledger evidence`, occurredAt: 1000 });
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
    db.exec(`PRAGMA foreign_keys=ON`);

    const result = await kernel.forgetUser('', 'global_user_requested');
    expect(result.deleted.neurons).toBe(1);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM neurons WHERE project_id IS NULL`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM memory_events WHERE project_id IS NULL`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM neurons WHERE content LIKE ?`).get(`%${secret}%`)).toEqual({ count: 0 });
    for (const table of ['deep_write_summaries','deep_write_runs','deep_write_candidates','deep_write_candidate_reviews','pipeline_nonfatal_events','reasoning_chains','reasoning_steps','memory_frame_reviews']) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }

    const next = await kernel.ingest({ content: 'new global memory after privacy erasure', createdAt: 3000 });
    expect(next.prev_hash).not.toBe(forgotten.self_hash);
    await kernel.exportSnapshot(snapshotPath);
    kernel.close();

    expect(readFileSync(dbPath).includes(Buffer.from(secret))).toBe(false);
    expect(readFileSync(snapshotPath).includes(Buffer.from(secret))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
