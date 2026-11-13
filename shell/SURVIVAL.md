# 7-day survival run: start script and care notes

**Not started in this round.** Stage-one acceptance is the shell prototype and its kill test; Susan
starts and watches the 7-day run after that, per the #165 dispatch.

## Start

```sh
cd shell
bun install
./scripts/survival-start.sh          # writes .cogmem-shell/ logs and a pid file
```

The script runs `bun run src/cli.ts start` with `nohup`, keeps stdout/stderr in
`.cogmem-shell/survival.log`, and writes the pid to `.cogmem-shell/survival.pid`.

## Watch

- `tail -f .cogmem-shell/survival.log` — the CLI's own lines.
- `.cogmem-shell/shell-events.jsonl` — every transition, cage violation, capture, dream and
  emergence decision (the state machine's evidence). Watch for `capture_failed` (a turn's ledger
  write failed, with the counts of what was lost) and `agent_end_hook_failed` (the run then ends as
  `run_error` instead of being wedged in RUNNING) — `README.md` has the flush policy.
- `.cogmem-shell/checkpoint.json` — `state`, `activeRunId`, `wakeIntents`, `history`.
- `cat .cogmem-shell/runtime.lock` — the owning pid; a live pid with a second `start` must be
  refused (`runtime_lock_held`).
- Memory curve: `ps -o rss= -p $(cat .cogmem-shell/survival.pid)` once a day.

## Recovery drill (already run once in this round)

```sh
kill -9 $(cat .cogmem-shell/survival.pid)     # while a run is in flight
./scripts/survival-start.sh                   # state returns to IDLE, wake intents survive
```

What to report if the state machine misbehaves: the last `transition` records plus the
`checkpoint.json` at the time — that pair is the whole diagnosis.

## Storage contract (round 14, #165)

The two files under `.cogmem-shell/` are read differently on purpose:

- `checkpoint.json` is **state**: every publish is a temp write + fsync + rename (fsync of the
  directory last), so a kill leaves the previous complete checkpoint or the new one, never a half
  file. One previous generation is kept as `checkpoint.json.prev` (a hard link, so it costs no data
  write). A live file damaged from outside falls back one generation and writes
  `checkpoint_corrupt_recovered` in the trace, keeping the damaged bytes as
  `checkpoint.json.corrupt`; if both generations are unreadable the shell refuses to start
  (`checkpoint_corrupt`, exit 1) with the machine left in DORMANT and no lock held. Deleting
  `checkpoint.json` is still a reset, not a resurrection.
- `shell-events.jsonl` is **evidence**: append-only, not fsynced, and read tolerantly — a malformed
  line is skipped, a torn final line is dropped and terminated, and the damage is written down once
  as a `trace_corrupt` record. A log where nothing parses is moved aside to
  `shell-events.jsonl.corrupt` and a fresh log records the loss.

Sizes measured on this box (round 14): the checkpoint is capped at ~52 KiB (200 history records
plus capped runtime fields) and a save at that cap is ~4 ms; a 10-tool-call run writes ~15
checkpoints and ~1.7 KiB of trace. The trace read is a full re-read (~7 ms/MB) and happens on
attach and `/dream` only.

## What makes the run fail (guidance's first-priority list)

A wrong transition, a lost state, two RUNNING hosts, or a dream colliding with a run.
