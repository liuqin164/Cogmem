# Installing Cogmem when nobody is at the keyboard

This page is for the person who comes back to an unattended install and finds recall "dumber
than expected". It says why the install stopped where it did, what the state it left is actually
capable of, and the two ways out. Nothing here is a bug report or a to-do: `rule_only` is a
legal end state, and the install gate is working when it says `WARN`.

Every command and field below was checked against `cogmem init --help` and the configuration
source. If you are reading this page from an installed package and something does not match the
`--help` you have, the `--help` is right.

## 1. Why `cogmem init --yes` stops here

Unattended, `init` settles four settings conservatively and warns about each one instead of
guessing. The warnings are the point — an unattended run tells you what it did not decide.

| Settings it will not choose | Why |
| --- | --- |
| A model provider | Choosing one for you can mean choosing who gets paid. |
| Any API key | Copying one out of your environment writes a secret to disk. |
| An encryption passphrase | Inventing one creates a database nobody can ever open again. |

The distinctions between unattended, agent-driven and interactive installs are specified in
ADR-0003, which is the authority for that sectioning; this page is the operator-facing account
of the same behaviour, and the two must not drift apart.

## 2. What `rule_only` means

What works: storing and recalling memory, with literal matching, all of it. This is a working
install, not a broken one.

What is missing: with no model provider there is no semantic matching, so a paraphrase of a
question does not find the record that answers it. `cogmem doctor` reports this as
`WARN — installed but degraded`, and names the next step. Compare that with `FAIL`, which means
something is actually wrong.

How to check it yourself: a recall result reports `semanticIndex`, so you can see whether the
semantic path ran instead of guessing from how the answers feel.

## 3. Finishing the install

Both routes end the same way — run `cogmem doctor`, and the gate must go from
`WARN — installed but degraded` back to `OK — installed and working`.

### Route A: the wizard

Run `cogmem init` with no `--yes`. The wizard asks for the provider, the key and the passphrase.
There is deliberately **no `--provider` flag**: `cogmem init --help` lists
`--config --dry-run --home --json --no-probe --project --register-agent --rotate --scope --vector-dimension --yes`,
and provider selection is the wizard's job.

### Route B: edit the configuration

The same three decisions live in `.cogmem/config.toml`. Each model role has its own section, and
each section carries `provider` and `api_key`:

```toml
[embedding]
provider = "deterministic_local"   # or "openai_compatible"

[memory_model]
provider = "openai_compatible"     # or "rule_only" / "anthropic"
base_url = "http://127.0.0.1:11434/v1"
model = "your-model"
api_key = "${COGMEM_MODEL_KEY}"

[reasoning_model]
provider = "openai_compatible"
base_url = "http://127.0.0.1:11434/v1"
model = "your-model"
api_key = "${COGMEM_MODEL_KEY}"
```

`api_key` (and `base_url`, and `model`) accept `${ENV_VAR}` interpolation, so the secret can stay
in the environment instead of the file. Valid providers are `deterministic_local` and
`openai_compatible` for `embedding`, and `rule_only`, `openai_compatible` or `anthropic` for
`memory_model` and `reasoning_model`; anything else is refused at parse time as
`invalid_model_provider` rather than silently falling back.

`memory_model` is the one that decides whether the gate is degraded: while it reads `rule_only`,
`doctor` reports the WARN. Setting it to a real provider and running `cogmem doctor` again is what
turns the gate back to `OK`.

### The language the social vocabulary speaks

Recall drops small talk before it looks anything up — `thanks so much!`, 「这次谢谢你啦」 — and the
words it matches against are **per language**. The project's own `language` selects the pack; without
it, the Chinese vocabulary is the one in use:

```toml
[project]
language = "en"        # zh is the default when nothing is declared
```

Both spellings are accepted — `[project] language` wins over a top-level `language`, the same way
`timezone` works. One language per project, so a project whose turns are English wants them declared:
measured on a fresh install, `thanks so much!` comes back with an answer while no language is declared,
and comes back empty with `residue_empty` once `language = "en"` is set.

## 4. Installer environment variables

`install.sh` installs the package and links the CLI, then stops. It never runs the wizard and
never writes config, so `curl | bash` cannot ask questions on one machine and invent answers on
another.

| Variable | What it does |
| --- | --- |
| `COGMEM_SKIP_INIT` | Still accepted, and now does nothing. |
| `COGMEM_PACKAGE_SPEC` | Selects what is installed: a version, a range, a tarball, a path, or a URL or `npm:`/`github:` location. |
| `COGMEM_NPM_SPEC`, `COGMEM_RELEASE_TARBALL` | Older names for the same setting, in that order of precedence. |
| `COGMEM_INSTALL_HOME`, `COGMEM_BIN_DIR` | Move the package home and the linked CLI, so the same script installs a locally packed build without the package itself coming from the registry — its dependencies still resolve from the registry unless they are already cached. |
| `COGMEM_UPDATE_CHECK` | `0` turns the version check off for this process, the same switch `[update] check = false` sets. |
| `COGMEM_UPDATE_REGISTRY` | The registry the version check reads, for a mirror or a private one. Defaults to `https://registry.npmjs.org`. |

A `github:` or `git+https:` spec is treated as source: the package is installed with lifecycle
scripts off, built where it landed and relinked, because bun does not install a git dependency's
devDependencies before its `prepare` and the build would otherwise fail and roll the install back.

If the next command reports `cogmem: command not found`, the CLI was linked into a directory
outside your `PATH`. The installer prints the exact `export` line to fix it, and `cogmem doctor`
reports the same directory as a WARN.

## 5. Staying current

Cogmem checks the registry for a newer release once a day, and tells you when there is one. It is
worth saying what the check does *not* do: it reads version metadata only, sends nothing about this
machine, and never waits on the network during a command — a detached helper does the read and
writes `~/.cogmem/update-check.json`, and the command you ran reads that cache and finishes. A
failed read is silent and is cached too, for an hour, so an offline machine retries tomorrow rather
than on every command.

When a newer release exists, a normal command adds one line on stderr:

```
cogmem <latest> is available (you have <current>). Run `cogmem update`; restart the resident process afterwards if one is running.
```

`cogmem doctor` reports the same thing in full, and separates three facts that an upgrade can leave
disagreeing: the **disk** version, the **latest** release, and the **serving** version of a resident
MCP process. After an update that staged a package but did not restart the service, doctor says so
explicitly — `the resident process is still serving <serving> …; the disk is at <disk>` — and `--json` carries
`version.disk`, `version.latest`, `version.updateAvailable`, `version.serving`, `version.skew` and
`version.restartRequired`.

### Turning the check off

```toml
[update]
check = false
```

Nothing is read, and no line is added to any command's output. `COGMEM_UPDATE_CHECK=0` does the same
for one process.

### Updating by hand

`cogmem update --yes` runs the whole cycle and finishes it: it stops the resident process, swaps
the package, opens the database with the new build — which is what runs an additive migration —
verifies the result through the same gate a fresh install uses, and starts the service again. When
the release is already installed it does nothing at all, so it is safe to run from a timer.

```bash
cogmem update --dry-run     # print the command and the gate, change nothing
cogmem update --yes         # stop, swap, migrate, verify, start
cogmem update --yes --stage-only   # swap and verify, but never stop or start the service
```

If any step fails, the update stops there and says which one: a stop that fails leaves the package
untouched; a failed install or a failed gate reinstalls the previous version, starts the old service
again and exits non-zero. Every run appends one line to `<.cogmem>/logs/update.jsonl` with the
from/to versions, the status, the step and the gate result.

### Opting in to automatic updates

Off unless you say otherwise, and deliberately so: a consequential act is decided by a person
(ADR-0003). Turning it on is you deciding in advance.

```toml
[update]
auto_upgrade = true
```

With it on, a check that finds a newer release stages it — swap and verify — and records that a
restart is owed. It never restarts anything, not even when the process running the service is the
one that asked: a process that kills and re-execs itself mid-upgrade is how a service ends up
neither old nor new. Restarting is the service manager's job, and the section on the resident
process in [`docs/mcp-server.md`](mcp-server.md) gives the timer and the unit that do it.

Under systemd that ordinary opt-in is not enough, because the process that would be upgraded is the
one serving requests. The upgrade degrades to check-and-report unless you add the second, separate
confirmation:

```toml
[update]
auto_upgrade = true
auto_upgrade_in_service = true   # only when the service manager owns the restart
```

One upgrade runs at a time: a lock beside the config refuses a second, and a lock left by a killed
process is cleared after an hour.

