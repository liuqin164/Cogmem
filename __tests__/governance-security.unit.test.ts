import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { mkdirSync, rmSync } from 'node:fs';
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
    expect(kernel.buildMemoryMap({ projectId: 'forget-me' }).counters.activationHotspots).toBe(1);

    const result = await kernel.forgetUser('forget-me', 'user_requested');

    expect(result.deleted.neurons).toBe(1);
    expect(result.deleted.activations).toBe(1);
    expect(kernel.recall('delete this project memory', { projectId: 'forget-me' }).rawEvidence).toHaveLength(0);
    expect(kernel.recall('keep this project memory', { projectId: 'keep-me' }).rawEvidence.length).toBeGreaterThan(0);
    expect(kernel.activationStore.getTop({ projectId: 'forget-me' })).toHaveLength(0);
    expect(kernel.buildMemoryMap({ projectId: 'forget-me' }).counters.activationHotspots).toBe(0);
    expect(kernel.runMaintenanceTick({ projectId: 'forget-me' }).chargeVector.activationHotspots).toBe(0);
    expect(kernel.getGovernanceAudit('forget-me')[0]?.action).toBe('forgetUser');
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
