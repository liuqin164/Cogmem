/**
 * Append-only JSONL trace: transitions, hook decisions, cage violations, capture outcomes.
 *
 * The trace is evidence, not state. A trace write that fails does not halt the shell (unlike the
 * checkpoint, where a failed write means the recovered state would be a lie), but it does say so on
 * stderr once, because a silently missing trace is how a spike loses the kill test's story.
 *
 * Damage tolerance follows Pi's session loader (`session-manager.ts`, `loadEntriesFromFile`): every
 * parseable record is kept, a malformed line is skipped instead of voiding the file — with one
 * deliberate difference. Pi skips in silence; here the damage is written down (`trace_corrupt`) once
 * per damaged byte range, because this log is the evidence the kill matrix reads back.
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface TraceRecord {
  at: number;
  kind: string;
  [key: string]: unknown;
}

export interface TraceScan {
  /** Every record that parsed; malformed lines are skipped, never fatal. */
  records: TraceRecord[];
  /** Byte offsets of malformed complete lines. */
  damaged: number[];
  /** The file does not end on a record boundary, so the next append would be glued onto the tail. */
  unterminated: boolean;
  /** The final line was torn by a kill mid-append and does not parse. */
  tailTruncated: boolean;
  /** Nothing parsed at all while the file was non-empty: total loss, moved aside by `recover()`. */
  totalLoss: boolean;
  bytes: number;
}

export class TraceLog {
  readonly path: string;
  private warned = false;
  /** Byte ranges already reported; keyed by offset so a repeated read cannot grow the log. */
  private readonly reportedDamage = new Set<number>();

  constructor(readonly dir: string, fileName = 'shell-events.jsonl') {
    this.path = join(dir, fileName);
  }

  append(kind: string, record: Record<string, unknown> = {}, now = Date.now()): void {
    // `at` and `kind` win over anything a caller put in `record`: a scheduled time belongs in its
    // own field (scheduledAt), never as the time the record was written.
    const entry: TraceRecord = { ...record, at: now, kind };
    try {
      mkdirSync(this.dir, { recursive: true });
      appendFileSync(this.path, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (error) {
      if (!this.warned) {
        this.warned = true;
        console.error(`[companion-shell] trace write failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Test/CLI helper: every parseable record. A malformed line is skipped and the rest survives —
   * returning `[]` for the whole file on one bad byte is how evidence disappears silently.
   */
  read(): TraceRecord[] {
    return this.scan().records;
  }

  /**
   * The log's recovery entry: the same tolerant read, plus the one-time record of the damage and the
   * repair of a torn tail. A file that ends mid-record is terminated with a newline, exactly as Pi's
   * session loader repairs a truncated final line, so the next append cannot be glued onto the
   * fragment; the damaged byte range is written down once.
   */
  recover(): TraceScan & { reported: boolean } {
    return this.recoverOnce(false);
  }

  private recoverOnce(moved: boolean): TraceScan & { reported: boolean } {
    const scan = this.scan();
    if (scan.totalLoss && !moved) {
      // Total loss: nothing in this file can be read back. Move the bytes aside so the shell keeps a
      // log it can write to, and say so loudly rather than running on with no evidence at all.
      try {
        renameSync(this.path, `${this.path}.corrupt`);
      } catch {
        // The move is hygiene; the record below is the part that matters.
      }
      this.append('trace_corrupt', { totalLoss: true, skipped: scan.damaged.length, bytes: scan.bytes });
      return { ...this.scan(), totalLoss: true, reported: true };
    }
    let reported = false;
    const fresh = scan.damaged.filter((offset) => !this.reportedDamage.has(offset));
    if (scan.unterminated) {
      // Pi's rule (`loadEntriesFromFile`): a non-empty file that does not end in a newline gets one.
      // Without it the record this method is about to append — or any later append — would land on
      // the torn line and take a parseable record down with it.
      try {
        appendFileSync(this.path, '\n', 'utf8');
      } catch {
        // Best effort; the report below still lands on a fresh line unless the file is unwritable.
      }
    }
    if (fresh.length > 0) {
      for (const offset of scan.damaged) this.reportedDamage.add(offset);
      this.append('trace_corrupt', {
        skipped: fresh.length,
        totalSkipped: scan.damaged.length,
        tailTruncated: scan.tailTruncated,
        kept: scan.records.length,
        bytes: scan.bytes,
      });
      reported = true;
    }
    return { ...scan, reported };
  }

  /** One read of the file, line by line, with byte offsets so a report is idempotent. */
  private scan(): TraceScan {
    let raw: string;
    let bytes: number;
    try {
      raw = readFileSync(this.path, 'utf8');
      bytes = statSync(this.path).size;
    } catch {
      return { records: [], damaged: [], unterminated: false, tailTruncated: false, totalLoss: false, bytes: 0 };
    }
    const records: TraceRecord[] = [];
    const damaged: number[] = [];
    let offset = 0;
    let torn = false;
    const lines = raw.split('\n');
    const unterminated = raw.length > 0 && !raw.endsWith('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const lineOffset = offset;
      offset += Buffer.byteLength(line, 'utf8') + 1;
      if (line === '') continue;
      try {
        records.push(JSON.parse(line) as TraceRecord);
      } catch {
        damaged.push(lineOffset);
        // Only the final line can be a torn write; a bad line in the middle is a bad record.
        if (index === lines.length - 1 && unterminated) torn = true;
      }
    }
    return { records, damaged, unterminated, tailTruncated: torn, totalLoss: records.length === 0 && damaged.length > 0, bytes };
  }
}
