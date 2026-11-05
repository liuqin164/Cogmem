# Host plugin hooks for record-after-turn + distribution

Research for the memory plugin's **RECORD** half (write the finished exchange to
an external store) and its **DISTRIBUTION** shape. Primary sources only: vendor
docs and raw repository files, retrieved 2026-10-24.

- `NousResearch/hermes-agent` @ `bac34e9e9946c9c6a9ce7ce64efadd47f8fa375b` (main)
- `earendil-works/pi` @ `1e42501bb335789b8c5971d5810a49c0a40064d0` (main)
- Claude Code docs at `code.claude.com/docs` (undated; retrieved 2026-10-24)

Items that are not stated in a primary source are marked **[unconfirmed]** and
are not inferred.

## Summary table

| | Hermes | pi | Claude Code |
|---|---|---|---|
| **Post-answer / record hook** | `post_llm_call` (plugin hook; observers, fires once per successful non-interrupted turn) | `turn_end` (after one model response and its tool calls); `agent_settled` / `agent_end` for run end; `message_end` for the assistant message | `Stop` (main agent finished responding); `SubagentStop` for subagents; `StopFailure` if the turn died on an API error; `SessionEnd` only at session end |
| **Does it carry the text?** | Yes: `user_message`, `assistant_response`, `conversation_history` | Yes: `turn_end.message` (AgentMessage), `turn_end.toolResults`, `agent_end.messages`; `message_end.message` | `last_assistant_message` (final text) + `transcript_path`; the transcript may lag, so the docs say use `last_assistant_message` |
| **Plugin shape** | `~/.hermes/plugins/<name>/` with `plugin.yaml` + `__init__.py` (`register(ctx)`); or portable Agent Plugins v1 dir with root `plugin.json` | npm/git/local "Pi package": conventional `extensions/`, `skills/`, `prompts/`, `themes/` dirs, or explicit `pi` key in `package.json`; `pi-package` keyword for gallery discovery | plugin dir with `.claude-plugin/plugin.json`; components in `hooks/hooks.json`, `skills/`, `agents/`, `.mcp.json`; published via a marketplace repo with `.claude-plugin/marketplace.json` |
| **Catalog / registry** | Plugin catalog in-repo (`plugin-catalog/`), browsable at `/docs/plugins`; `hermes plugins install <name>` | Gallery at `pi.dev/packages` (titled "Package Catalog"); discovery keyed on the npm `pi-package` keyword; installs come from npm/git/local, not the gallery | Marketplaces: `.claude-plugin/marketplace.json` in a git repo / hosted URL / local path; Anthropic's own marketplaces documented |
| **Scripted install** | `hermes plugins install <source> --enable\|--no-enable [--ref <40-hex sha>] [--force] [--yes-deps]`; `hermes plugins update --yes` | `pi install npm:<pkg>` / `git:` / local path; `--local` writes project settings; `pi -e <pkg>` for one invocation | `claude plugin marketplace add <source>` then `claude plugin install <plugin>@<marketplace> --scope user --json [-y] [--config k=v]` |
| **Secrets / config** | `requires_env:` in `plugin.yaml` (`.env`, prompted at install); `config_schema` with `type: secret, env: VAR`, read via `get_secret("VAR")` from `agent.secret_scope`; `ctx.get_config` / `ctx.set_config` for non-secrets | Provider keys from the environment (`ANTHROPIC_API_KEY`, …) or `<agent-dir>/auth.json`; extensions call `pi.getSettings()` and `pi.getFlag(name)`; `pi auth print-api-key` | `userConfig` in `plugin.json`; non-sensitive values land in `settings.json` `pluginConfigs`, `sensitive: true` values in the OS secure store; hook processes receive `CLAUDE_PLUGIN_OPTION_<KEY>` |

## Hermes

### Record hook

`post_llm_call` — the only plugin hook that fires after the assistant produced
its final answer, and it is the documented "sync to external memory" hook.

- Timing: once per turn, after the tool-calling loop, only on successful turns;
  it does **not** fire when the turn was interrupted.
  Source call site: `agent/turn_finalizer.py`, function `_apply_output_hooks()`
  (guarded by "not persist-disabled").
- Exact payload, from the call site:

```python
_invoke_hook_safely(
    "post_llm_call", logger,
    session_id=agent.session_id,
    task_id=effective_task_id,
    turn_id=turn_id,
    user_message=original_user_message,
    assistant_response=final_response,
    conversation_history=list(messages),
    model=agent.model,
    platform=platform,
)
```

`PluginManager` additionally adds `telemetry_schema_version="hermes.observer.v1"`
to every plugin-hook callback.

Related, and useful to distinguish:

- `transform_llm_output` — a *transform* that runs **before** `post_llm_call` and
  final delivery; first non-empty string replaces the response. Fields:
  `response_text`, `session_id`, `model`, `platform`.
- `on_session_end` — fires at the end of **every** `run_conversation()` call, not
  at real session end (the docs say so explicitly). Payload from
  `agent/turn_finalizer.py`: `session_id`, `task_id`, `turn_id`, `completed`,
  `failed`, `interrupted`, `turn_exit_reason`, `model`, `platform`; CLI exit
  paths add `reason`/`api_request_id` and may omit fields.
- `agent_loop_stopped` — fires only when a running turn is interrupted (gateway
  `/stop`, `/new` fast-path, TUI/desktop `session.interrupt`); no CLI equivalent.
  Fields: `session_key`, `platform`, `reason`, `invalidation_reason`.

### All lifecycle hook names

`hermes_cli/plugins.py` defines `VALID_HOOKS`, the source of truth for plugin and
shell hooks. Full set at the recorded SHA (grouped as in the file):

```
pre_tool_call, post_tool_call, transform_terminal_output, transform_tool_result,
transform_llm_output, pre_llm_call, post_llm_call,
on_stream_start, on_stream_delta, on_stream_end, on_interim_message,
pre_verify, pre_api_request, post_api_request, api_request_error,
pre_auxiliary_call, post_auxiliary_call, transform_api_error_classification,
on_session_start, on_session_end, on_session_finalize, on_session_reset, on_session_delete,
on_skill_lifecycle, subagent_start, subagent_stop,
pre_gateway_dispatch, post_gateway_admission, agent_loop_stopped,
pre_approval_request, post_approval_response, on_human_input_request, on_human_input_resolved,
on_room_member_activity, pre_transcription,
kanban_task_claimed, kanban_task_completed, kanban_task_blocked,
on_kanban_worker_spawned, on_kanban_worker_exited, on_kanban_worker_stale_claim,
on_kanban_task_updated, on_kanban_dispatch_tick,
gateway_platform_event, pre_command, post_compaction
```

Two further hook systems have their own, smaller event sets:

- **Gateway hooks** (`~/.hermes/hooks/<name>/HOOK.yaml` + `handler.py`,
  gateway-only, trusted-by-placement): `gateway:startup`, `session:start`,
  `session:end`, `session:reset`, `session:compress`, `agent:start`, `agent:step`,
  `agent:end` (context "same keys as `agent:start`, plus `response` truncated to
  500 chars"), `reaction:added`, `reaction:removed`, `command:*`.
  `agent:end` is a post-turn signal but gateway-only and truncated, so it cannot
  carry a full exchange.
- **Shell hooks and outbound webhooks** subscribe to the plugin-hook set above
  (`hooks:` / `hooks.outbound:` in `profile config.yaml`); they add no new event
  names. Outbound webhook bodies add `delivery_id`, `timestamp`, `profile`, and
  an HMAC header `X-Hermes-Signature-256` when `secret_env` is set.

### Distribution

- Native plugin = directory under `~/.hermes/plugins/<plugin-name>/` (flat, or one
  category level) containing `plugin.yaml` **and** `__init__.py` that exposes
  `register(ctx)`. Anything deeper is ignored.
- `plugin.yaml` (simple form): `name`, `version`, `description`,
  `provides_tools`, `provides_hooks`; optional `author`, `requires_env`,
  `capabilities`, `config_schema`, plus a manifest-v2 schema
  (`manifest_version`, `api_version`, `requires_plugins`, …).
- Portable Agent Plugins v1 packages use a root `plugin.json` plus `skills/` and
  `mcp.json`; they do not import Python and need no `__init__.py`, and are
  disabled until explicitly enabled. Hermes-specific settings go under
  `extensions."com.nousresearch.hermes"`.
- Catalog: entries are YAML files in the hermes-agent repo's `plugin-catalog/`
  directory; each pins `repo` + a 40-hex `sha`, with `tier`, `category`,
  `capabilities`, `requires_hermes`, `platforms`. Browse at `/docs/plugins`.
- Install: `hermes plugins install <name>` (catalog entry), `hermes plugins install
  owner/repo` (custom/unreviewed), `--ref <full 40-char SHA>` to pin, `--force` to
  reinstall, `--enable` / `--no-enable` to skip the "Enable 'name' now? [y/N]"
  prompt. `hermes plugins update --yes` skips its confirmation.
- Headless dependency consent: `--yes-deps` answers the Python-dependency question
  up front ("for a headless install (CI, SSH automation, a container entrypoint)");
  `--no-deps` installs without consent and leaves the plugin disabled.
- **[unconfirmed]** No documented flag to answer the interactive `requires_env`
  credential prompt non-interactively. The docs only state that missing
  `requires_env` variables are prompted for during `hermes plugins install` and
  saved to `.env`. Whether a fully non-interactive install silently leaves them
  unset is not stated in the docs.

### Secrets

- `requires_env:` — simple list or rich entries with `name`, `description`,
  `url`, `secret: true`. "If `WEATHER_API_KEY` isn't set, the plugin is disabled
  with a clear message." Values are saved to `.env` at install.
- `config_schema` supports `type: secret` with `env: MY_PLUGIN_API_KEY`; the value
  is stored through the same credential route as provider API keys and read by the
  plugin with `get_secret("MY_PLUGIN_API_KEY")` from `agent.secret_scope`.
  "Secrets never touch `config.yaml`," and plugins must not read `.env`,
  `auth.json`, or other tools' credential files ("catalog rule 11").
- Non-secret settings: `ctx.get_config("key", default=...)` /
  `ctx.set_config(...)` under `plugins.entries.<plugin-id>.settings`; plugin-owned
  runtime state via `ctx.state` under `<HERMES_HOME>/plugin-data/`.

Sources: [hooks guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/hooks.md),
[build a plugin](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/plugins/index.md),
[plugins guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/plugins.md),
[plugin catalog](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/plugin-catalog.md),
[`hermes_cli/plugins.py`](https://github.com/NousResearch/hermes-agent/blob/main/hermes_cli/plugins.py),
[`agent/turn_finalizer.py`](https://github.com/NousResearch/hermes-agent/blob/main/agent/turn_finalizer.py).

## pi

### Record hook

The extension API is `ExtensionAPI.on(event, handler)` in
`packages/coding-agent/src/core/extensions/types.ts`. The post-response / run-end
events are:

| Event | Payload (exact fields) | When |
|---|---|---|
| `turn_end` | `type`, `turnIndex`, `message` (AgentMessage), `toolResults` (ToolResultMessage[]), `messageEntryId`, `toolResultEntryIds`, plus `BoundaryState` (`entries`, `continue`, `context`, `outcome`) | After one model response **and its tool calls**; the docs' intent table says "Act after one model response and its tool calls" |
| `message_end` | `type`, `message` (AgentMessage) | When any message ends (user, assistant, or toolResult) |
| `agent_end` | `type`, `messages` (AgentMessage[]) | When one low-level agent run ends |
| `agent_settled` | `type`, `aborted` (boolean) | After a run has fully settled and no automatic retry, compaction, or queued continuation will run |
| `agent_before_settle` | `type` + `BoundaryState` | Before final settlement; can append entries or request one more continuation |
| `after_provider_response` | `type`, `status`, `headers` | After the provider response arrives, before the stream is consumed |

Caveat stated in the docs: "Retries, recovery, compaction, and queued messages can
start another agent run after `agent_end`, so `agent_end` is not a final-idle
signal." `agent_settled` is the event the docs recommend for "notification work
after automatic processing has stopped".

The event groups documented for the lifecycle (input preparation, agent run,
model turn, provider call, message lifecycle, tool execution, settlement) list
the complete set: `input`, `before_agent_start`; `agent_start`, `agent_end`;
`turn_start`, `context`, `context_with_system`, `turn_end`;
`before_provider_headers`, `before_provider_request`, `after_provider_response`,
`provider_stream_event`; `message_start`, `message_update`, `message_end`;
`tool_execution_start`, `tool_call`, `tool_execution_update`, `tool_result`,
`tool_execution_end`; `agent_before_settle`, `agent_settled`. The remaining
events accepted by `ExtensionAPI.on`: `project_trust`, `session_start`,
`session_info_changed`, `session_before_switch`, `session_before_fork`,
`session_before_compact`, `session_compact`, `session_compact_failed`,
`session_shutdown`, `resources_discover`, `session_before_tree`, `session_tree`,
`mcp_servers_change`, `cache_warming_decision`, `ui_prompt_start`,
`ui_prompt_end`, `model_select`, `thinking_level_select`, `user_bash`.

### Distribution

- A "Pi package" is an ordinary directory or npm package. Conventional layout:
  `package.json`, `extensions/`, `skills/`, `prompts/`, `themes/`. Explicit
  manifest under the `pi` key:

```json
{
  "name": "my-pi-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./src/extension.ts"],
    "skills": ["./resources/skills"],
    "prompts": ["./resources/prompts/*.md"],
    "themes": ["./resources/themes/*.json"]
  }
}
```

- The `pi-package` keyword "makes an npm package eligible for discovery in the Pi
  package gallery" (`https://pi.dev/packages`, whose page title is "Package
  Catalog"). Optional `pi.image` / `pi.video` add previews.
- Install: `pi install npm:@example/pi-tools@1.0.0`, `pi install
  git:github.com/example/pi-tools@v1`, `pi install ./local-package`. Personal
  installs are written to `~/.pi/agent/settings.json`; `--local`/`-l` writes
  `.pi/settings.json` instead. `pi list`, `pi remove <source>`, `pi update
  --extensions`, `pi config` (interactive toggle), and `pi -e <pkg>` for a
  one-invocation trial.
- Project packages "are installed and loaded only after project trust is
  resolved"; `-a`/`--approve` trusts project-local files for one command.
- **[unconfirmed]** No `--yes`-style prompt-suppression flag for `pi install` is
  documented in `packages.md` or `cli.md`. Personal-scope installs are described
  purely as writing a settings entry; no interactive prompt is documented for
  them. Whether a `npm:` install can prompt in some environment is not stated.

### Secrets

- Provider credentials: environment variables (table in `providers.md`, e.g.
  `ANTHROPIC_API_KEY`) or `<agent-dir>/auth.json`, where a `key` may be a
  `!command` that resolves the secret without writing it to disk.
  `pi auth print-api-key --provider <p>` and `pi auth print-bearer-token` print
  resolved credentials (`--json` for `auth check`).
- Extension-side: `pi.getSettings()` returns the effective merged settings
  (global + project); `pi.registerFlag(...)` / `pi.getFlag(name)` give an
  extension its own CLI flags; `pi.registerCommand` for slashed commands.
  `<agent-dir>` defaults to `~/.pi/agent` and is overridable with
  `PI_CODING_AGENT_DIR`.
- **[unconfirmed]** No dedicated per-extension secret store is documented for pi
  extensions; the documented sources are the process environment, `auth.json`, and
  settings via `getSettings()`.

Sources: [extensions docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md),
[extension types](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts),
[Pi packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md),
[CLI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md),
[environment variables](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/environment-variables.md),
[providers](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md),
[configuration](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/configuration.md),
[package gallery](https://pi.dev/packages).

## Claude Code

### Record hook

`Stop` — "Runs when the main Claude Code agent has finished responding. Does not
run if the stoppage occurred due to a user interrupt. API errors fire
`StopFailure` instead."

- Common input fields on every hook (stdin JSON): `session_id`, `prompt_id`,
  `transcript_path`, `cwd`, `scratchpad_dir`, `permission_mode`, `effort`,
  `hook_event_name`, and where applicable `agent_id` / `agent_type`.
- `Stop` adds: `stop_hook_active`, `last_assistant_message`, `background_tasks`
  (array of `id`, `type`, `status`, `description`, `command`, `agent_type`,
  `server`, `tool`, `name`), `session_crons` (array of `id`, `schedule`,
  `recurring`, `prompt`).
- "The `last_assistant_message` field contains the text content of Claude's final
  response, so hooks can access it without parsing the transcript file… the
  transcript file isn't guaranteed to include the final message at Stop time on
  all versions."
- `SubagentStop` adds `stop_hook_active`, `agent_id`, `agent_type`,
  `agent_transcript_path`, `last_assistant_message`; `transcript_path` is the main
  session's transcript, `agent_transcript_path` the subagent's own file under
  `subagents/`.
- `StopFailure` runs instead of `Stop` when the turn ends on an API error; its
  output and exit code are ignored apart from `terminalSequence`.
- `SessionEnd` is session-scoped, not turn-scoped: input is the common fields plus
  `reason` (`clear`, `resume`, `logout`, `prompt_input_exit`, `other`), no decision
  control, default timeout 1.5 s (raisable per-hook up to 60 s or via
  `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS`).

### Distribution

- A plugin is a directory whose root holds component dirs and whose
  `.claude-plugin/plugin.json` is the manifest: `hooks/hooks.json` (top-level
  `"hooks"` key, same shape as settings), `skills/`, `commands/`, `agents/`,
  `.mcp.json`. Hooks also load from the manifest `hooks` key.
- A marketplace is a repo/dir with `.claude-plugin/marketplace.json`. Required
  top-level keys: `name`, `owner` (with `name`), `plugins` (array). Optional:
  `$schema`, `description`, `version`, `metadata.pluginRoot`,
  `forceRemoveDeletedPlugins`, `allowCrossMarketplaceDependenciesOn`, `renames`.
  Each plugin entry requires `name` and `source`, and may carry `description`,
  `version`, `category`, `tags`, `strict`, `relevance`, `dependencies`,
  `defaultEnabled`, `displayName`, `metadata`, `headers`, `headersHelper`.
  Marketplace names have a long reserved-name list (official Anthropic names,
  `npm`, `github`, `inline`, `builtin`, `skills-dir`, `synced`, …).
- Install, non-interactively from a shell:

```bash
claude plugin marketplace add <owner/repo | git url | hosted marketplace.json | local path>
claude plugin install <plugin>@<marketplace> --scope user --json
```

  `--scope` is `user` (default), `project`, or `local`; `--json` prints one JSON
  object on the last stdout line (`command`, `outcome`, `message`, plus
  `pluginId`/`scope`/`failureCode`); `-y`/`--yes` accepts a marketplace-declared
  install command without the prompt; `--config key=value` sets a `userConfig`
  option (or `<server>.<key>` for a bundled MCP server). Without a TTY and without
  `-y` or `--accept-command`, an install whose entry runs a command is refused
  with exit code 1. One-session loading: `--plugin-dir`, `--plugin-dir` folder,
  `--plugin-url`, or `CLAUDE_CODE_PLUGIN_DIRS`.

### Secrets

- `userConfig` in `plugin.json` declares values Claude Code prompts for when the
  plugin is enabled. Each field needs `type` (`string`, `number`, `boolean`,
  `directory`, `file`), `title`, `description`; optional `required`, `default`,
  `options`, `multiple`, `min`/`max`, and `sensitive`.
- "Non-sensitive values are saved under `pluginConfigs` in the user's
  `settings.json`. Sensitive values go to the platform's secure credential store
  instead."
- References: `${user_config.KEY}` substituted in MCP/LSP config, exec-form hook
  `args`, and skill/agent content (sensitive values become a placeholder in
  content); `CLAUDE_PLUGIN_OPTION_<KEY>` (uppercased) is exported to hook
  processes for every option.
- Path variables for plugin code: `${CLAUDE_PLUGIN_ROOT}` (installation dir),
  `${CLAUDE_PLUGIN_DATA}` (`~/.claude/plugins/data/<id>/`, survives updates),
  `${CLAUDE_PROJECT_DIR}`. Hook processes get all three plus the option vars; the
  Bash tool does not.
- Hook processes inherit the parent environment, minus `OTEL_*` exporter vars,
  minus variables stripped when `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`, and minus
  Anthropic credentials in HIPAA-configured sessions.

Sources: [Hooks reference](https://code.claude.com/docs/en/hooks),
[Create a plugin](https://code.claude.com/docs/en/plugins/create),
[Plugin components](https://code.claude.com/docs/en/plugins/components),
[Plugin manifest reference](https://code.claude.com/docs/en/plugins/manifest-reference),
[Marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference),
[Install and manage plugins](https://code.claude.com/docs/en/plugins/install),
[Plugin CLI reference](https://code.claude.com/docs/en/plugins/cli-reference),
[CLI reference](https://code.claude.com/docs/en/cli-reference),
[Environment variables](https://code.claude.com/docs/en/env-vars).
