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
| Which hosts to wire | Enabling a host edits another program's configuration. |

`--agent` defaults to `none`, so nothing on the machine is touched unless you name it. The
distinctions between unattended, agent-driven and interactive installs are specified in
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
`WARN — installed but degraded` back to `OK — installed and working`. If you also want a host
wired, name it explicitly with `--agent openclaw`, `--agent hermes`, `--agent pi`, or
`--agent all`.

### Route A: the wizard

Run `cogmem init` with no `--yes`. The wizard asks for the provider, the key and the passphrase.
There is deliberately **no `--provider` flag**: `cogmem init --help` lists
`--agent --auto --config --dry-run --home --json --no-probe --project --register-agent --rotate --scope --vector-dimension --yes`,
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

A `github:` or `git+https:` spec is treated as source: the package is installed with lifecycle
scripts off, built where it landed and relinked, because bun does not install a git dependency's
devDependencies before its `prepare` and the build would otherwise fail and roll the install back.

If the next command reports `cogmem: command not found`, the CLI was linked into a directory
outside your `PATH`. The installer prints the exact `export` line to fix it, and `cogmem doctor`
reports the same directory as a WARN.
