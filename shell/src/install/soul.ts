/**
 * The default soul, written once at install time, and the shell-owned table it lives in.
 *
 * F17 (#194) puts a versioned soul table in the memory kernel and a star-sea editor on top of it.
 * Neither has landed, and this round's hard boundary is *no kernel change*, so the installer writes
 * the row into a table it owns, in the same database file the kernel opens. Same file on purpose:
 * when F17 lands, the row is already where the migration needs to read it from.
 *
 * `ponytail:` interim shell-owned table. F17 moves it into the kernel (`soul`, versioned, per
 * agent); this table is the seed, not the destination.
 */
import { Database } from 'bun:sqlite';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companion_soul (
  agent_id   TEXT    NOT NULL,
  version    INTEGER NOT NULL,
  content    TEXT    NOT NULL,
  supersedes INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, version)
)`;

/**
 * A short-lived connection to the soul table.
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
  db.exec(SCHEMA);
  // The soul is personal text. The database file is already the memory file, but a fresh one is
  // born mode 0644; the installer tightens it here and leaves it tight.
  if (existsSync(dbPath)) chmodSync(dbPath, 0o600);
  return db;
}

/** Version 0, written once. A re-run returns what is there rather than writing a second row. */
export function writeDefaultSoul(dbPath: string, agentId: string, now = Date.now()): SoulRow {
  const db = openSoulDb(dbPath);
  try {
    const existing = readSoulRow(db, agentId);
    if (existing) return existing;
    db.prepare(
      'INSERT INTO companion_soul (agent_id, version, content, supersedes, created_at) VALUES (?, 0, ?, NULL, ?)',
    ).run(agentId, DEFAULT_SOUL, now);
    return { agentId, version: 0, content: DEFAULT_SOUL, supersedes: null, createdAt: now };
  } finally {
    db.close();
  }
}

/** The newest version for an agent, or undefined when the row (or the file) was never written. */
export function readSoul(dbPath: string, agentId: string): SoulRow | undefined {
  if (!existsSync(dbPath)) return undefined;
  const db = new Database(dbPath, { readonly: true });
  try {
    return readSoulRow(db, agentId);
  } finally {
    db.close();
  }
}

function readSoulRow(db: Database, agentId: string): SoulRow | undefined {
  const row = db
    .prepare('SELECT agent_id, version, content, supersedes, created_at FROM companion_soul WHERE agent_id = ? ORDER BY version DESC LIMIT 1')
    .get(agentId) as { agent_id: string; version: number; content: string; supersedes: number | null; created_at: number } | undefined;
  if (!row) return undefined;
  return { agentId: row.agent_id, version: row.version, content: row.content, supersedes: row.supersedes, createdAt: row.created_at };
}
