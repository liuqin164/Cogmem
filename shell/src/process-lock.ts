/**
 * One resident host process per data directory: the "no two RUNNING" rule at process scope.
 *
 * A lock whose pid is gone is stale (the kill test exists precisely because SIGKILL leaves one), so
 * taking it over is recovery, not a second host. A lock whose pid is alive refuses to start, which
 * is the property a checkpoint alone cannot give.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export class RuntimeLockHeldError extends Error {
  readonly code = 'runtime_lock_held';
  constructor(readonly pid: number) {
    super(`runtime_lock_held: another companion shell (pid ${pid}) owns this data directory`);
  }
}

export interface RuntimeLock {
  pid: number;
  at: number;
}

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export class ProcessLock {
  readonly path: string;

  constructor(readonly dir: string) {
    this.path = join(dir, 'runtime.lock');
  }

  acquire(pid = process.pid, now = Date.now()): { recoveredStalePid?: number } {
    mkdirSync(this.dir, { recursive: true });
    if (existsSync(this.path)) {
      let holder: RuntimeLock | undefined;
      try {
        holder = JSON.parse(readFileSync(this.path, 'utf8')) as RuntimeLock;
      } catch {
        holder = undefined;
      }
      if (holder && holder.pid !== pid && isAlive(holder.pid)) throw new RuntimeLockHeldError(holder.pid);
      const stale = holder?.pid;
      this.write(pid, now);
      return stale === undefined ? {} : { recoveredStalePid: stale };
    }
    this.write(pid, now);
    return {};
  }

  private write(pid: number, at: number): void {
    writeFileSync(this.path, JSON.stringify({ pid, at }), 'utf8');
  }

  release(pid = process.pid): void {
    if (!existsSync(this.path)) return;
    try {
      const holder = JSON.parse(readFileSync(this.path, 'utf8')) as RuntimeLock;
      if (holder.pid === pid) rmSync(this.path, { force: true });
    } catch {
      // An unreadable lock is the next process's stale-lock problem; releasing ours is best effort.
    }
  }
}
