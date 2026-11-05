import { accessSync, chmodSync, constants, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * One file an adapter owns: where it goes, what it holds, and how it must be mode'd.
 *
 * Ownership is the path and nothing else. There is no manifest file recording what was
 * installed — a state file whose only job is remembering what another state file says is
 * the second system the review gates reject, and it drifts from the artifacts it
 * describes. An adapter re-derives its own paths, and `connect <host> --remove` checks
 * the content before deleting, which is what makes the ownership real rather than
 * recorded (#116).
 */
export interface OwnedFile {
  path: string;
  content: string;
  mode?: number;
}

export interface WriteOwnedFilesResult {
  written: string[];
  /** Paths that already existed and were replaced. */
  replaced: string[];
}

/**
 * Write the files an adapter owns, or none of them.
 *
 * **Preflight**: every parent directory is created and checked for writability before a
 * single byte is written, so an install that cannot finish does not leave a half-written
 * artifact behind.
 *
 * **Rollback**: the previous content is held in memory for the duration of the write, and
 * restored if any write fails. It is dropped on success, which is the other half of this:
 * the adapters used to leave `<path>.cogmem.bak-<timestamp>` beside every file they
 * touched, so every `connect` added files forever, nothing ever removed them, and the one
 * that held the content you wanted was indistinguishable from the other nine.
 *
 * A preflight failure may create the directories it was checking. It never writes a file.
 */
export function writeOwnedFiles(files: OwnedFile[]): WriteOwnedFilesResult {
  for (const file of files) preflight(file);
  const previous = new Map<string, { content: string; mode: number }>();
  const created: string[] = [];
  const written: string[] = [];
  const replaced: string[] = [];
  try {
    for (const file of files) {
      if (existsSync(file.path)) {
        previous.set(file.path, { content: readFileSync(file.path, 'utf8'), mode: statSync(file.path).mode & 0o777 });
        replaced.push(file.path);
      } else {
        created.push(file.path);
      }
      mkdirSync(dirname(file.path), { recursive: true });
      writeFileSync(file.path, file.content, 'utf8');
      if (file.mode !== undefined) chmodSync(file.path, file.mode);
      written.push(file.path);
    }
    return { written, replaced };
  } catch (error) {
    rollBack(previous, created);
    throw new Error(`install_write_failed: ${message(error)} (restored ${previous.size}, removed ${created.length})`);
  }
}

function preflight(file: OwnedFile): void {
  const dir = dirname(file.path);
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
  } catch (error) {
    throw new Error(`install_preflight_failed: cannot write into ${dir}: ${message(error)}`);
  }
  if (existsSync(file.path)) {
    try {
      accessSync(file.path, constants.W_OK);
    } catch (error) {
      throw new Error(`install_preflight_failed: cannot write ${file.path}: ${message(error)}`);
    }
  }
}

/** Put back what was there, and take away what this call introduced. */
function rollBack(previous: Map<string, { content: string; mode: number }>, created: string[]): void {
  for (const path of created) {
    try {
      rmSync(path, { force: true });
    } catch {
      // Best effort: a rollback that throws replaces the original failure with a worse one.
    }
  }
  for (const [path, before] of previous) {
    try {
      writeFileSync(path, before.content, 'utf8');
      chmodSync(path, before.mode);
    } catch {
      // Same: the caller already has the real error.
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Remove a file this adapter owns, and only when it still holds what this adapter wrote. */
export function removeOwnedFile(path: string, stillOurs: (content: string) => boolean): 'removed' | 'absent' | 'not_ours' {
  if (!existsSync(path)) return 'absent';
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return 'not_ours';
  }
  if (!stillOurs(content)) return 'not_ours';
  rmSync(path, { force: true });
  return 'removed';
}
