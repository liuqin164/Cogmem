import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import Database from 'bun:sqlite';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DREAM_FAILURE_NIGHTS,
  HEALTH_ANOMALY_WINDOW_MS,
  HEALTH_API_METHODS,
  HEALTH_AUDIT_ACTION,
  HEALTH_CHECK_IDS,
  HEALTH_CONTRACT_VERSION,
  HEALTH_DEGRADATIONS,
  HEALTH_EVENT_TYPE,
  HEALTH_MODES,
  HEALTH_NOTICE_CONFIDENCE,
  HEALTH_NOTICE_SENSITIVITY,
  HEALTH_NOTICE_SOURCE,
  HEALTH_STATE_KEY,
} from '../src/health/index.js';
import {
  BRAIN_CONFIG_FIELDS,
  BRAIN_COUNT_FIELDS,
  BUNDLE_FORMAT,
  BUNDLE_FORMAT_VERSION,
  SNAPSHOT_FORMAT,
  SNAPSHOT_MANIFEST_VERSION,
  SNAPSHOT_RETENTION,
  SNAPSHOT_VERIFICATION_CHECKS,
  BrainBackup,
  BrainBundleError,
  restoreBrainBundle,
  type BrainConfig,
} from '../src/snapshot/index.js';
import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { MemoryObservatory } from '../src/observatory/MemoryObservatory.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * F19 (#196): the health, degradation and whole-brain backup contract, asserted against
 * `docs/health-backup.md`. The discriminators are the ticket's: three failed nights produce one
 * notice through F18's highest tier with a visible trace; a read-only database refuses writes and
 * still reads; a snapshot verifies, rotates and restores item by item; the observatory page writes
 * nothing.
 */

const markdown = readFileSync(
  fileURLToPath(new URL('../docs/health-backup.md', import.meta.url)),
  'utf8',
);

function sectionAfter(heading: string): string {
  return markdown.split(heading)[1]?.split(/\n#{2,3} /)[0] ?? '';
}

function firstColumn(section: string): string[] {
  return [...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gmu)].map((match) => match[1]!);
}

function rows(section: string): Map<string, string> {
  const table = new Map<string, string>();
  for (const match of section.matchAll(/^\|\s*([^|]+?)\s*\|(.*)\|\s*$/gmu)) {
    const key = match[1]!.trim().replace(/`/g, '');
    if (/^-+$/.test(key) || key === 'Field' || key === 'Check' || key === 'Count' || key === 'Step') continue;
    const value = match[2]!.split('|')[0]!.trim().replace(/`/g, '').replace(/\.$/u, '');
    table.set(key, value);
  }
  return table;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const NIGHT_ONE = Date.UTC(2026, 0, 1, 22);

function seedFailedNights(kernel: MemoryKernel, nights: number): void {
  const db = kernel.factStore.getDatabase();
  for (let index = 0; index < nights; index += 1) {
    db.prepare(`
      INSERT INTO episode_dream_runs
        (run_id, project_id, requested_mode, selected_mode, reason, episode_ids_json,
         candidate_ids_json, status, duration_ms, created_at)
      VALUES (?, 'p', 'auto', 'selective_compile', 'test', '[]', '[]', 'partial', 1, ?)
    `).run(`run-${index}`, NIGHT_ONE + index * DAY_MS);
  }
}

function storedHealth(db: Database): { status: string; mode: string } | undefined {
  const row = db.prepare('SELECT value FROM _meta WHERE key = ?').get(HEALTH_STATE_KEY) as { value?: string } | undefined;
  return row?.value ? JSON.parse(row.value) as { status: string; mode: string } : undefined;
}

describe('frozen tables and the code that implements them', () => {
  test('version', () => {
    const table = rows(sectionAfter('## Version (frozen)'));
    expect(table.get('contractVersion')).toBe(String(HEALTH_CONTRACT_VERSION));
    expect(table.get('snapshotRetention')).toBe(String(SNAPSHOT_RETENTION));
    expect(table.get('dreamFailureNights')).toBe(String(DREAM_FAILURE_NIGHTS));
    expect(table.get('snapshotFormat')).toBe(SNAPSHOT_FORMAT);
    expect(table.get('bundleFormat')).toBe(BUNDLE_FORMAT);
    expect(table.get('healthEventType')).toBe(HEALTH_EVENT_TYPE);
    expect(table.get('healthAuditAction')).toBe(HEALTH_AUDIT_ACTION);
    expect(table.get('healthAnomalyWindowMs')).toBe(String(HEALTH_ANOMALY_WINDOW_MS));
  });

  test('self-checks', () => {
    expect(firstColumn(sectionAfter('## Self-checks (frozen)'))).toEqual([...HEALTH_CHECK_IDS]);
    expect([...HEALTH_MODES]).toEqual(['normal', 'read_only']);
  });

  test('degradation behavior', () => {
    expect(firstColumn(sectionAfter('## Degradation behavior (frozen)'))).toEqual([...HEALTH_DEGRADATIONS]);
  });

  test('dream nights and notice candidate', () => {
    expect(firstColumn(sectionAfter('## Dream streak (frozen)'))).toEqual(['succeeded', 'failed', 'idle']);
    const notice = rows(sectionAfter('## Health notice (frozen)'));
    expect(notice.get('source')).toBe(HEALTH_NOTICE_SOURCE);
    expect(notice.get('sensitivity')).toBe(HEALTH_NOTICE_SENSITIVITY);
    expect(notice.get('confidence')).toBe(String(HEALTH_NOTICE_CONFIDENCE));
  });

  test('snapshot, counts, config and verification', () => {
    const snapshot = rows(sectionAfter('## Nightly snapshot (frozen)'));
    expect(snapshot.get('retention')).toContain(String(SNAPSHOT_RETENTION));
    expect(snapshot.get('trigger')).toContain('runNight');
    const manifest = rows(sectionAfter('## Snapshot manifest (frozen)'));
    expect(manifest.get('format')).toBe(SNAPSHOT_FORMAT);
    expect(manifest.get('version')).toBe(String(SNAPSHOT_MANIFEST_VERSION));
    expect(firstColumn(sectionAfter('## Counts (frozen)'))).toEqual([...BRAIN_COUNT_FIELDS]);
    expect(firstColumn(sectionAfter('## Configuration (frozen)'))).toEqual([...BRAIN_CONFIG_FIELDS]);
    expect(firstColumn(sectionAfter('## Verification (frozen)'))).toEqual([...SNAPSHOT_VERIFICATION_CHECKS]);
  });

  test('bundle framing', () => {
    const bundle = rows(sectionAfter('## Bundle (frozen)'));
    expect(bundle.get('format')).toBe(BUNDLE_FORMAT);
    expect(bundle.get('version')).toBe(String(BUNDLE_FORMAT_VERSION));
    expect(bundle.get('framing')).toContain('4-byte little-endian');
  });

  test('recovery drill steps and errors', () => {
    expect(firstColumn(sectionAfter('## Recovery drill (frozen)'))).toEqual([
      'export', 'restore', 'open', 'ledger', 'soul', 'profile', 'procedures', 'commitments',
    ]);
    expect(firstColumn(sectionAfter('## Errors (frozen)'))).toEqual([
      'health_read_only',
      'invalid_bundle',
      'bundle_checksum_mismatch',
      'bundle_counts_mismatch',
      'bundle_target_exists',
      'snapshot_not_found',
    ]);
  });

  test('API methods', () => {
    const methods = firstColumn(sectionAfter('## API (frozen)'));
    expect(methods.slice(0, HEALTH_API_METHODS.length)).toEqual([...HEALTH_API_METHODS]);
    for (const method of ['snapshot', 'list', 'verify', 'exportBundle'] as const) {
      expect(methods).toContain(method);
    }
  });
});

describe('health checks, transitions and the Dream-failure notice', () => {
  let dir: string;
  let kernel: MemoryKernel;

  beforeAll(() => {
    dir = makeTempDir('cogmem-health-');
    kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db') });
    seedFailedNights(kernel, 3);
  });

  afterAll(() => {
    kernel.close();
  });

  test('three failed nights degrade the streak and record one transition', () => {
    const seen: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    const subscription = kernel.events.subscribe({ types: [HEALTH_EVENT_TYPE] }, (event) => seen.push(event));
    try {
      const report = kernel.health.check({ now: NIGHT_ONE + 2 * DAY_MS });
      expect(report.status).toBe('degraded');
      expect(report.mode).toBe('normal');
      expect(report.degradations).toContain('dream_failing');
      const streak = report.checks.find((check) => check.id === 'dream_streak');
      expect(streak?.status).toBe('degraded');
      expect((streak?.detail as { streak: number }).streak).toBe(3);
      expect(seen.filter((event) => event.payload?.checkId === 'dream_streak')).toHaveLength(1);
      expect(seen.find((event) => event.payload?.checkId === 'dream_streak')?.payload)
        .toMatchObject({ checkId: 'dream_streak', status: 'degraded', mode: 'normal' });
      const audit = kernel.factStore.getDatabase().prepare(
        `SELECT COUNT(*) AS c FROM governance_audit_log WHERE action = ? AND reason = ?`,
      ).get(HEALTH_AUDIT_ACTION, 'dream_failing') as { c: number };
      expect(audit.c).toBe(1);
      expect(storedHealth(kernel.factStore.getDatabase())?.status).toBe('degraded');
      // A second check with the same answer writes no second row.
      kernel.health.check({ now: NIGHT_ONE + 2 * DAY_MS + 1 });
      const again = kernel.factStore.getDatabase().prepare(
        `SELECT COUNT(*) AS c FROM governance_audit_log WHERE action = ? AND reason = ?`,
      ).get(HEALTH_AUDIT_ACTION, 'dream_failing') as { c: number };
      expect(again.c).toBe(1);
    } finally {
      subscription.unsubscribe();
    }
  });

  test('the notice goes through F18\'s highest tier with its trace, once per streak', () => {
    const notice = kernel.health.notice({
      userState: 'in-conversation',
      channel: { reachability: 'online', interruptibility: 'high' },
      now: NIGHT_ONE + 2 * DAY_MS,
    });
    expect(notice.due).toBe(true);
    expect(notice.reason).toBe('dream_streak');
    expect(notice.streak).toBe(3);
    expect(notice.candidate?.source).toBe(HEALTH_NOTICE_SOURCE);
    expect(notice.candidate?.confidence).toBe(HEALTH_NOTICE_CONFIDENCE);
    expect(notice.decision).toMatchObject({
      decision: 'deliver',
      strength: 'proactive',
      urgency: 'high',
      reasonCode: 'urgent_in_conversation',
    });
    expect(notice.decision?.decisionTrace.steps.length).toBeGreaterThan(0);
    expect(JSON.stringify(notice.decision?.decisionTrace)).toContain('urgency');

    const second = kernel.health.notice({
      userState: 'in-conversation',
      channel: { reachability: 'online', interruptibility: 'high' },
      now: NIGHT_ONE + 2 * DAY_MS,
    });
    expect(second.due).toBe(false);
    expect(second.reason).toBe('already_notified');
  });

  test('an idle owner gets the notice queued, not spoken into an empty room', () => {
    const kernel2 = createMemoryKernel({ dbPath: join(dir, 'idle.db') });
    try {
      seedFailedNights(kernel2, 3);
      const notice = kernel2.health.notice({
        userState: 'idle',
        channel: { reachability: 'online', interruptibility: 'high' },
        now: NIGHT_ONE + 2 * DAY_MS,
      });
      expect(notice.due).toBe(true);
      expect(notice.decision).toMatchObject({ decision: 'accumulate', destination: 'next-contact' });
    } finally {
      kernel2.close();
    }
  });

  test('a read-only database degrades the write check, refuses writes and still reads', () => {
    const db = kernel.factStore.getDatabase();
    db.exec('BEGIN EXCLUSIVE');
    try {
      const report = kernel.health.check({ record: false, now: NIGHT_ONE + 3 * DAY_MS });
      expect(report.mode).toBe('read_only');
      expect(report.degradations).toContain('db_read_only');
      expect(() => kernel.health.assertWritable()).toThrow();
      try {
        kernel.health.assertWritable();
      } catch (error) {
        expect((error as { code: string }).code).toBe('health_read_only');
      }
      expect(kernel.health.lastReport()).toBeDefined();
    } finally {
      db.exec('ROLLBACK');
    }
  });
});

describe('nightly snapshot and the machine bundle', () => {
  let dir: string;
  let kernel: MemoryKernel;
  let dbPath: string;
  const config: BrainConfig = {
    vectorDimension: 8,
    projectTimeZone: 'UTC',
    memoryProvider: 'rule_only',
    reasoningProvider: 'rule_only',
  };

  beforeAll(async () => {
    dir = makeTempDir('cogmem-backup-');
    dbPath = join(dir, 'brain.db');
    kernel = createMemoryKernel({ dbPath });
    await kernel.ingest({
      content: 'the backup drill remembers this turn',
      role: 'user',
      agentId: 'a',
      projectId: 'p',
      workspaceId: 'p',
      sessionId: 's',
    });
    kernel.soul.ensureDefault('a', 'be honest about what you remember');
  });

  afterAll(() => {
    kernel.close();
  });

  test('a snapshot verifies, reports its counts and fails verification when corrupted', async () => {
    const snapshotsDir = join(dir, 'snaps');
    const backup = new BrainBackup({
      dbPath,
      snapshotsDir,
      embeddingDimension: 8,
      coreVersion: 'test',
      config,
      now: () => NIGHT_ONE,
    });
    const manifest = await backup.snapshot();
    expect(manifest).toBeDefined();
    expect(manifest!.format).toBe(SNAPSHOT_FORMAT);
    expect(manifest!.verification.ok).toBe(true);
    expect(manifest!.verification.checks).toEqual({ checksum: true, opens: true, counts: true });
    expect(manifest!.counts.events).toBeGreaterThan(0);
    expect(manifest!.soulVersions).toEqual([{ agentId: 'a', version: 0 }]);

    const files = readdirSync(snapshotsDir);
    expect(files.some((file) => file.endsWith('.snap'))).toBe(true);
    expect(files.some((file) => file.endsWith('.json'))).toBe(true);

    const snapshotPath = join(snapshotsDir, manifest!.snapshot.file);
    const bytes = readFileSync(snapshotPath);
    bytes[bytes.byteLength - 32] = bytes[bytes.byteLength - 32]! ^ 0xff;
    writeFileSync(snapshotPath, bytes);
    const manifestPath = join(snapshotsDir, manifest!.snapshot.file.replace(/\.snap$/u, '.json'));
    const verified = backup.verify(manifestPath);
    expect(verified.verification.ok).toBe(false);
    expect(verified.verification.checks.checksum).toBe(false);
  });

  test('rotation keeps the newest seven snapshots and their manifests', async () => {
    const snapshotsDir = join(dir, 'rotation');
    let now = NIGHT_ONE;
    const backup = new BrainBackup({
      dbPath,
      snapshotsDir,
      embeddingDimension: 8,
      coreVersion: 'test',
      config,
      now: () => now,
    });
    for (let index = 0; index < SNAPSHOT_RETENTION + 2; index += 1) {
      now = NIGHT_ONE + index * DAY_MS;
      expect(await backup.snapshot()).toBeDefined();
    }
    const listed = backup.list();
    expect(listed).toHaveLength(SNAPSHOT_RETENTION);
    expect(listed[0]!.createdAt > listed[listed.length - 1]!.createdAt).toBe(true);
    const files = readdirSync(snapshotsDir);
    expect(files.filter((file) => file.endsWith('.snap'))).toHaveLength(SNAPSHOT_RETENTION);
    expect(files.filter((file) => file.endsWith('.json'))).toHaveLength(SNAPSHOT_RETENTION);
  });

  test('a bundle restores into a clean directory with matching counts, and refuses damage', async () => {
    const bundlePath = join(dir, 'brain.bundle');
    const exported = await kernel.bundle.exportBundle(bundlePath);
    expect(exported.manifest.format).toBe(BUNDLE_FORMAT);
    expect(exported.manifest.counts.events).toBeGreaterThan(0);
    expect(exported.manifest.soulVersions).toEqual([{ agentId: 'a', version: 0 }]);

    const cleanDir = makeTempDir('cogmem-restore-');
    const target = join(cleanDir, 'restored', 'brain.db');
    const restored = restoreBrainBundle(bundlePath, target);
    expect(restored.counts).toEqual(exported.manifest.counts);
    expect(restored.soulVersions).toEqual(exported.manifest.soulVersions);
    const reopened = createMemoryKernel({ dbPath: target });
    try {
      expect(reopened.soul.read('a')?.content).toContain('be honest');
      const recall = new KernelAgentMemoryBackend(reopened, { agentId: 'a' })
        .recall({ query: 'backup drill', projectId: 'p', limit: 5 });
      expect(recall.items.length).toBeGreaterThan(0);
    } finally {
      reopened.close();
    }
    expect(() => restoreBrainBundle(bundlePath, target)).toThrow();

    const damaged = join(dir, 'damaged.bundle');
    const bytes = readFileSync(bundlePath);
    bytes[bytes.byteLength - 1] = bytes[bytes.byteLength - 1]! ^ 0xff;
    writeFileSync(damaged, bytes);
    try {
      restoreBrainBundle(damaged, join(cleanDir, 'damaged.db'));
      throw new Error('expected a checksum refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(BrainBundleError);
      expect((error as BrainBundleError).code).toBe('bundle_checksum_mismatch');
    }
  });

  test('the observatory health page is a zero-write read', () => {
    kernel.health.check({ now: NIGHT_ONE + DAY_MS });
    const before = createHash('sha256').update(readFileSync(dbPath)).digest('hex');
    const db = new Database(dbPath, { readonly: true });
    try {
      const observatory = new MemoryObservatory({ db });
      const health = observatory.health({ now: NIGHT_ONE + 2 * DAY_MS });
      expect(health.checked).toBe(true);
      expect((health.report as { status?: string })?.status).toBeDefined();
      expect(health.anomalies.windowMs).toBe(HEALTH_ANOMALY_WINDOW_MS);
    } finally {
      db.close();
    }
    const after = createHash('sha256').update(readFileSync(dbPath)).digest('hex');
    expect(after).toBe(before);
  });
});
