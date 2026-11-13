/**
 * The session log's half of the storage round (#165, round 14): the log is evidence, not state, so a
 * damaged log must never read as "nothing happened" and must never take the rest of the log with it.
 *
 * Pi's session loader is the shape this copies (`session-manager.ts` `loadEntriesFromFile`): every
 * parseable record survives, a malformed line is skipped, and a torn final line is terminated so the
 * next append cannot be glued onto it — with one deliberate difference: here the damage is written
 * down (`trace_corrupt`) once per damaged byte range, because this log is the evidence the kill
 * matrix reads back.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { TraceLog } from '../src/trace.ts';
import { makeTempDir } from './helpers.ts';

describe('session log damage is recovered and recorded, never silently swallowed', () => {
  const good = (seq: number) => `${JSON.stringify({ at: 1_760_000_000_000 + seq, kind: 'transition', seq })}\n`;

  test('a torn tail (half a record) keeps every earlier record and terminates the log for the next append', () => {
    const dir = makeTempDir();
    const trace = new TraceLog(dir);
    trace.append('transition', { seq: 1 });
    trace.append('transition', { seq: 2 });
    writeFileSync(trace.path, `${readFileSync(trace.path, 'utf8')}{"at":1760000000003,"kind":"transi`);

    // The old read returned [] for the whole file on one bad byte; the good records survive now.
    expect(trace.read().filter((record) => record.kind === 'transition').map((record) => record.seq)).toEqual([1, 2]);

    const scan = trace.recover();
    expect(scan.tailTruncated).toBe(true);
    expect(scan.damaged).toHaveLength(1);
    expect(scan.records.filter((record) => record.kind === 'transition')).toHaveLength(2);
    expect(scan.reported).toBe(true);

    const records = trace.read();
    const report = records.find((record) => record.kind === 'trace_corrupt');
    expect(report).toBeDefined();
    expect(report!.tailTruncated).toBe(true);
    expect(report!.skipped).toBe(1);
    expect(report!.kept).toBe(2);
    expect(readFileSync(trace.path, 'utf8').endsWith('\n'), 'the tail was terminated').toBe(true);

    // The next append is a record of its own — it did not glue itself to the fragment.
    trace.append('transition', { seq: 3 });
    expect(trace.read().filter((record) => record.kind === 'transition').map((record) => record.seq)).toEqual([1, 2, 3]);

    // Idempotent: a second recovery does not report the same damaged bytes again.
    expect(trace.recover().reported).toBe(false);
    expect(trace.read().filter((record) => record.kind === 'trace_corrupt')).toHaveLength(1);
  });

  test('a bad record in the middle is skipped, records after it survive, and it is reported once', () => {
    const dir = makeTempDir();
    const trace = new TraceLog(dir);
    writeFileSync(trace.path, `${good(1)}this is not json at all\n${good(2)}`);

    expect(trace.read().filter((record) => record.kind === 'transition').map((record) => record.seq)).toEqual([1, 2]);
    const scan = trace.recover();
    expect(scan.damaged).toHaveLength(1);
    expect(scan.tailTruncated, 'a middle record is not a torn tail').toBe(false);
    expect(scan.reported).toBe(true);
    const report = trace.read().find((record) => record.kind === 'trace_corrupt')!;
    expect(report.skipped).toBe(1);
    expect(report.tailTruncated).toBe(false);

    expect(trace.recover().reported).toBe(false);
    expect(trace.read().filter((record) => record.kind === 'trace_corrupt')).toHaveLength(1);
  });

  test('a multi-byte record before the damage does not shift the byte offsets (no double report)', () => {
    const dir = makeTempDir();
    const trace = new TraceLog(dir);
    trace.append('transition', { seq: 1, reason: '醒来后注入的时间上下文（中文记录，多字节）' });
    writeFileSync(trace.path, `${readFileSync(trace.path, 'utf8')}torn-here`);

    expect(trace.recover().reported).toBe(true);
    expect(trace.recover().reported).toBe(false);
    expect(trace.read().filter((record) => record.kind === 'trace_corrupt')).toHaveLength(1);
    expect(trace.read().filter((record) => record.kind === 'transition')).toHaveLength(1);
  });

  test('a log where nothing parses is moved aside and the loss is written into a fresh log', () => {
    const dir = makeTempDir();
    const trace = new TraceLog(dir);
    writeFileSync(trace.path, 'garbage\nalso garbage\n');

    const scan = trace.recover();
    expect(scan.totalLoss).toBe(true);
    expect(scan.reported).toBe(true);
    expect(existsSync(`${trace.path}.corrupt`), 'the unreadable bytes are kept').toBe(true);
    expect(readFileSync(`${trace.path}.corrupt`, 'utf8')).toBe('garbage\nalso garbage\n');
    const records = new TraceLog(dir).read();
    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe('trace_corrupt');
    expect(records[0].totalLoss).toBe(true);
    expect(records[0].skipped).toBe(2);
  });

  test('a whole final record without its newline is kept, terminated, and is not called damage', () => {
    const dir = makeTempDir();
    const trace = new TraceLog(dir);
    writeFileSync(trace.path, `${good(1)}${JSON.stringify({ at: 1_760_000_000_000, kind: 'transition', seq: 2 })}`);

    expect(trace.read().filter((record) => record.kind === 'transition').map((record) => record.seq)).toEqual([1, 2]);
    const scan = trace.recover();
    expect(scan.unterminated).toBe(true);
    expect(scan.damaged).toHaveLength(0);
    expect(scan.reported, 'a missing newline is not corruption').toBe(false);
    expect(readFileSync(trace.path, 'utf8').endsWith('\n')).toBe(true);
    trace.append('transition', { seq: 3 });
    expect(trace.read().filter((record) => record.kind === 'transition').map((record) => record.seq)).toEqual([1, 2, 3]);
  });
});
