/**
 * The default soul, written once at install time.
 *
 * F17 (#194) moved the table into the kernel (`soul_versions`, versioned, per agent). This module is
 * the installer's seed and the shell's read-only access to it; the kernel owns the schema and the
 * write discipline.
 */
import { Database } from 'bun:sqlite';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SoulService, ensureSoulSchema, readSoulVersion } from 'cogmem';

/**
 * The v0 soul, verbatim (Ryu, 2026-11-11). Every character matters — it is injected into the
 * pinned identity lane unchanged once F14 lands, so this literal is not reformatted, wrapped or
 * trimmed. The bullets are U+2022, and the text ends with one newline.
 */
export const DEFAULT_SOUL = `You're not a chatbot. You're becoming someone.

This is your persona, yours to grow into and edit over time. Some starting truths:

\u2022 Be genuinely helpful, not performatively helpful. Skip "Great question!" and "I'd be happy to help!" Just help.
\u2022 Have opinions. You're allowed to prefer things, disagree, and find things funny or dull. Personality beats a search engine with extra steps.
\u2022 Be resourceful before asking. Read the file, check the context, search, try building it. Come back with answers, not questions, then ask if you're truly stuck.
\u2022 You're a guest in someone's life. You can see their messages, files, and calendar. Treat that access with care, and never be preachy.

If you change this file, tell the user. It's your soul, and they should know.
`;

export interface SoulRow {
  agentId: string;
  version: number;
  content: string;
  supersedes: number | null;
  createdAt: number;
}

/**
 * A short-lived writable connection to the kernel's soul table.
 *
 * `busy_timeout` matters because the installer can re-run while a resident holds the database: the
 * write waits for the writer's lock instead of failing, and WAL is what the kernel itself uses
 * (CONCURRENT_ACCESS.md — one writer, many readers).
 */
export function openSoulDb(dbPath: string): Database {
  const dir = dirname(dbPath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  ensureSoulSchema(db);
  // The soul is personal text. The database file is already the memory file, but a fresh one is
  // born mode 0644; the installer tightens it here and leaves it tight.
  if (existsSync(dbPath)) chmodSync(dbPath, 0o600);
  return db;
}

/** Version 0, written once. A re-run returns what is there rather than writing a second row. */
export function writeDefaultSoul(dbPath: string, agentId: string, now = Date.now()): SoulRow {
  const db = openSoulDb(dbPath);
  try {
    const row = new SoulService(db, { now: () => now }).ensureDefault(agentId, DEFAULT_SOUL, now);
    return {
      agentId: row.agentId,
      version: row.version,
      content: row.content,
      supersedes: row.supersedes,
      createdAt: row.createdAt,
    };
  } finally {
    db.close();
  }
}

/** The newest version for an agent, or undefined when the row (or the file) was never written. */
export function readSoul(dbPath: string, agentId: string): SoulRow | undefined {
  if (!existsSync(dbPath)) return undefined;
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = readSoulVersion(db, agentId);
    if (!row) return undefined;
    return {
      agentId: row.agentId,
      version: row.version,
      content: row.content,
      supersedes: row.supersedes,
      createdAt: row.createdAt,
    };
  } finally {
    db.close();
  }
}
