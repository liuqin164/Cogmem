import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createMemoryKernel } from '../src/factory.js';
import { EventStore } from '../src/store/EventStore.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * doctor's marked-event count, pinned by test rather than by a one-off run.
 *
 * The marks are seeded through the event store because that is the path that writes them into the
 * ledger the query reads: two events under `secretFindings`, one under the assistant key, and three
 * unmarked events mixed in so a count that simply counted rows would be wrong.
 */
test('doctor counts exactly the events carrying a secret mark, under either key', () => {
  const dir = makeTempDir('cogmem-doctor-marks-');
  const dbPath = join(dir, 'memory.db');
  createMemoryKernel({ dbPath }).close();
  const store = new EventStore(dbPath);
  let ordinal = 0;
  const append = (metadata?: Record<string, unknown>): void => {
    ordinal += 1;
    store.append({
      streamType: 'thread', streamId: 't', eventType: 'RAW_EVENT_RECORDED', projectId: 'p',
      threadId: 't', sessionId: 's', threadSeq: ordinal, eventOrdinal: ordinal, role: 'user',
      occurredAt: 1_700_000_000_000 + ordinal, payload: { text: `turn ${ordinal}`, ...(metadata ? { metadata } : {}) },
    });
  };
  append({ secretFindings: { total: 2, byKind: { assigned_api_key: 1, assigned_password: 1 } } });
  // A tool result redacted on the way in: marked, and carrying the write-time redaction record.
  append({ secretFindings: { total: 1, byKind: { openai_key: 1 } }, redaction: { count: 1, chars: 27 } });
  append({ secretFindings: { total: 1, byKind: { github_token: 1 } } });
  append({ secretFindingsAssistant: { total: 3, byKind: { jwt: 3 } } });
  append();
  append();
  append();

  const configPath = join(dir, 'config.toml');
  writeFileSync(configPath, [
    '[core]', `db_path = ${JSON.stringify(dbPath)}`, 'vector_backend = "sqlite-vec"', 'vector_dimension = 384',
    '[paths]', `embeddings_dir = ${JSON.stringify(join(dir, 'embeddings'))}`, `snapshots_dir = ${JSON.stringify(join(dir, 'snapshots'))}`, `logs_dir = ${JSON.stringify(join(dir, 'logs'))}`,
    '[embedding]', 'provider = "deterministic_local"', 'model = "deterministic_local"',
    '[memory_model]', 'provider = "rule_only"', 'model = "rule_only"',
    '[reasoning_model]', 'provider = "rule_only"', 'model = "rule_only"',
  ].join('\n') + '\n');

  const run = spawnSync('bun', [join(import.meta.dir, '..', 'src', 'bin', 'cogmem.ts'), 'doctor', '--config', configPath, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: dir },
  });
  const payload = JSON.parse(run.stdout) as { secretFindings?: { markedEvents?: number; redactedOnWrite?: number; markedOnly?: number } };
  // Four seeded with a mark now; the other three carry none. One of the four was redacted on write.
  expect(payload.secretFindings?.markedEvents).toBe(4);
  expect(payload.secretFindings?.redactedOnWrite).toBe(1);
  expect(payload.secretFindings?.markedOnly).toBe(3);
});
