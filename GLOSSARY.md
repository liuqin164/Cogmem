# Cog

A resident companion agent with a governed long-term memory kernel on your own machine: it keeps what happened, and later puts the relevant part back in front of the agent without being searched for.

## Language

### Soul

**Soul**（人格文本）:
The companion's own persona text, stored per agent in the kernel's versioned `soul_versions` table
and injected verbatim at the head of the pinned lane. A save appends a version with `supersedes`;
the owner writes, the agent may only read and propose.
_Avoid_: system prompt, persona file, character sheet

### Surfacing

**Pulse**（二级脉冲）:
A memory arriving in two waves — a direct hit, then an associative spread that brings neighbouring context with it.
_Avoid_: search, query, lookup

**Pulse 1**:
The direct wave: a cue activates the memories it names or nearly names.
_Avoid_: exact match, keyword hit, top-k

**Pulse 2**:
The associative wave: the direct hit spreads along time, people, place and topic, returning context the cue never mentioned.
_Avoid_: expansion, neighbour lookup, rerank

**Emergence**（浮现）:
A memory being present before it is asked for. The agent does not search; the relevant memory is already in front of it.
_Avoid_: auto-recall, injection, preload

**Surfacing candidate**（浮现候选）:
A memory or commitment the kernel offers the shell with its source refs, reason, confidence, freshness and sensitivity tier. The kernel gives candidates; the shell decides whether to speak.
_Avoid_: notification, suggestion, push

**Sensitivity tier**（敏感度档位）:
The deterministic grade on a surfacing candidate: `daily` (ordinary), `private` (withheld from the proactive channel by default), or `high` (withheld from proactive; keychain-marked content is hard-withheld from both channels).
_Avoid_: privacy level, secret flag, redaction class

**Occasion**（场合）:
Where the companion is speaking: `private` (the owner alone), `group` (the owner and other people),
or `public` (an unbounded audience). A connection's occasion is declared by its channel contract at
registration and resolved from that binding; a caller never declares it per call.
_Avoid_: context, environment, mode

**Cold memory**:
A memory nothing has touched for a long time. It stays reachable: coldness lowers how readily it surfaces, never whether it exists.
_Avoid_: expired, stale, deleted

### Session context

**Session digest**:
The mechanical index of a session's older turns: every entry is the ledger row's exact text with its `sourceRefs`, never a summary. A turn leaves the verbatim tail by a pure rule, not a model.
_Avoid_: summary, recap, compression

**Session recall**:
Paging one session's ledger verbatim, newest first, by time, topic or keyword. It is recall in the session domain, not a second search engine.
_Avoid_: transcript replay, history search

**Context budget**:
The per-turn projection of the pinned/profile/digest/working-set/recall/tail lanes onto a target token bandwidth read from the model configuration. A lane over budget becomes browse-only; it is never deleted or paraphrased.
_Avoid_: truncation, summarise-and-drop, sliding window

### Locating a memory

**Facet**:
One of the six ways a person locates a memory: time, person, place, event, topic, state. This is the vocabulary the product speaks in.
_Avoid_: dimension, filter, tag, slot

**Dimension**:
One of the thirteen axes the memory graph stores a node on. Storage vocabulary only; a person never names one.
_Avoid_: facet, column, axis

### Remembering

**Episode**（会话片段）:
A bounded stretch of one conversation, cut where the conversation pauses. The unit memory is built from.
_Avoid_: session, thread, chunk, batch

**Memory Atlas**（记忆图谱）:
The derived graph of nodes and edges that recall reads to locate a memory by facet. Built from the ledger, never the source of truth.
_Avoid_: facet layer, index, knowledge graph

**Frame**（记忆帧）:
One structured reading of a single episode: its people, time, events, decisions and corrections. The atlas is projected from frames — the reading model writes frames, never nodes.
_Avoid_: summary, extraction, parse, record

**Dream**:
The step that reads one sealed episode and produces its frame. Model-driven when a provider is configured, rule-only otherwise.
_Avoid_: curation, compile, distill, consolidate

**Night**（夜间跑）:
One operation that seals what has gone quiet, Dreams a bounded number of those episodes, and projects them — safe to re-run.
_Avoid_: nightly batch, nightly run, cron job, dream job

**Incremental projection**（增量投影）:
Adding one episode's nodes and edges to the atlas without recomputing the rest. The unit is one episode, never the corpus.
_Avoid_: reindex, refresh, resync

### Time

**Time context**（时间语境）:
The block the kernel hands the shell at wake or turn start: the instant, how long since the last
interaction and since the owner last spoke, the day/week position, the ledger's density and rhythm
signals, and the nearest anchor. Computed from the ledger, never queried by the agent.
_Avoid_: timestamp, clock reading, prompt variable

**Wake intention**（醒来意图）:
The agent's own "wake me at this instant, for this reason, about this". A first-class ledger record —
set, cancelled and fired are rows — so the audit is the ledger and firing exactly once survives a
restart. Distinct from a prospective memory, which is a candidate about the owner's future that only
the owner can confirm.
_Avoid_: alarm, cron entry, schedule config, timer

### Conversation

**Conversation turn**（对话回合）:
One thing said, by one speaker, in one thread of one session, through one **channel** (the medium it
arrived by: `terminal`, `telegram`, …). A first-class ledger record rather than a shell's private
encoding of a message, so the recall side can ask who spoke instead of guessing from the text.
_Avoid_: message, utterance, transcript line, chat log entry

**Speaker**（说话人）:
Who said a conversation turn: the **owner**, an **other** (a human who is neither the owner nor the
agent), or the **agent** itself. A fact on the turn and distinct from the ledger's coarse `role`,
which the owner shares with every human the kernel used to see.
_Avoid_: user, author, actor, participant

**Capture lane**（捕获车道）:
Where a ledger row came from — `conversation` or `tool` — written on the row itself instead of kept
in a second store. Two capture paths, one ledger.
_Avoid_: stream, table, queue, lane marker

### People

**Person entity**（人物实体）:
A person the companion remembers by a stable id: the full name, the aliases that resolve to them (a
nickname, a relational term such as 老婆), the relation edges between people, versioned attributes,
and the memories attached to them. Stored as an entity row of type `person` rather than a second
store, and distinct from the `person` **facet**, which locates a memory on the atlas — though a
facet query that names a person resolves through this layer, so a nickname and the names a merge
moved onto the survivor are entrances too.
_Avoid_: contact, profile, character, user

### Understanding

**Health report**（健康报告）:
The companion's own answer about four parts — model route, Dream streak, database writability and kernel integrity — each `ok` or `degraded`, plus the mode they imply. A change is recorded once in the audit ledger and announced as a `health-changed` event; the report itself is a `_meta` value, not a second store. A degraded part names exactly one behavior, and the principle is that admitting sickness is cheaper than pretending normal with bad memory.
_Avoid_: heartbeat, status ping, install gate, smoke test

**Read-only companion mode**（只读陪伴模式）:
The mode a healthy process enters when the database refuses a write transaction: agent-facing writes are refused with `health_read_only`, while recall, the compiled books and the observatory keep reading, and both `doctor` and the health report name the mode. It is a state the companion says out loud, not a crash.
_Avoid_: offline mode, degraded fallback, maintenance mode

**Brain snapshot**（整脑快照）:
The nightly copy of the whole database after Dream — the existing `.snap` DB copy plus a JSON manifest carrying the five counts, the soul versions and the four configuration values it takes to open the brain again. Every copy is verified (checksum, opens, counts) before it is reported, and the newest seven are kept. It is not the human-readable archive of F9.
_Avoid_: backup file, dump, archive, export

**Brain bundle**（整脑搬家包）:
The machine-restorable form of a brain: a 4-byte manifest length, the JSON manifest and the snapshot's DB bytes, restored by verifying the checksum and every count before the file is moved into place. It is deliberately separate from the human-readable F9 archive — one is for a person to read, this one is for a machine to restore — and it shares the snapshot's copy and verification rather than inventing a second format.
_Avoid_: export archive, migration file, transfer zip

**Profile**（画像）:
The companion's long-term understanding of the owner, compiled into four ledgers — facts, preferences, relations, ongoing items — every entry carrying the raw events it was compiled from. The owner corrects an entry and that ledger recompiles; the profile is recalled under its own priority and decay rather than mixed with ordinary compiled memory. Stored as ledger rows, not a second store, and distinct from a **Person entity**, which is who someone else is.
_Avoid_: user model, persona, character sheet, summary

**Procedure book**（做法册）:
How a project's work actually got done, compiled from its own attempts and the guides imported from elsewhere: steps, tool choices, the owner's corrections, and a grade of `tentative` or `established`. It is recalled by the task description, never by a skill's name, and a checklist entry hit by the task is delivered whole. Stored as ledger rows, not a skill catalogue.
_Avoid_: skill directory, playbook index, tool registry

**Commitment book**（承诺册）:
The promises said out loud — the owner's, the agent's own, and a third party's promise reported to the owner — each with its due instant or event condition, its completion evidence and the turn it came from. Its two disciplines are announce once per due occurrence and ask once when the evidence is ambiguous; a dismissed reminder is silenced for that occurrence, not deleted.
_Avoid_: todo list, task tracker, reminder queue

### Scope

**Drill-down**（下钻）:
Following a surfaced memory back to the words that produced it. Within one project it is always available; across projects it is never available; a forgotten memory is gone for good.
_Avoid_: trace, lookup, citation

### Installing

**Install actor**（安装执行者）:
Who carries out one install step: an **Agent** (runs unattended), an **Operator** (a person at the keyboard), or the **Host** (the agent runtime itself, reloading its own gateway). Every install step names exactly one.
_Avoid_: user, runner, executor, role

**Install path**（安装路径）:
One of exactly two routes to a working install: the **Operator path** (installer, then the wizard) and the **Agent path** (installer, then a non-interactive setup).
_Avoid_: method, option, flavor, mode

**Setting tier**（设置档位）:
Who may decide one setup setting: **Agent-decidable** (a safe default exists and a wrong choice destroys nothing), **Human-required** (a key, a passphrase, or money), or **Settle-later** (changeable afterwards with no data loss).
_Avoid_: required/optional, basic/advanced

**Install gate**（安装收口）:
The single check install and update end on. It answers not installed, OK, WARN (installed but degraded) or FAIL, and always names the next step.
_Avoid_: health check, smoke test, verification

**Workspace**（工作区）:
The directory an install shares with an agent, identified by the `.cogmem/` directory it contains. Its configuration travels with it, so one install on a machine serves several Workspaces and each resolves its own.
_Avoid_: project, repo, working directory, workspace directory, workspaceDir

### Candidates

**Promotion target**（提升目标）:
What a candidate became, was replaced by, or is about. Its type names one of three classes: the referent (`fact`, `belief`, `summary`, `entity`, `graph_edge`, `replacement_candidate`), the locator the candidate is about (`semantic_tags`, `indexing_decision`, `semantic_relation`, `edge_adjustment`), or, for a candidate retired without a successor, the reason class (`review_queue_expiry`, `diagnostic_conclusion`).
A referent id is the id of a stored row; a locator id is an event id (`evt-…`) or a topic path (`memory/auditability`), never a row id; a reason class carries no id. The id is empty when the candidate names none of those, and it never points at the row itself.
_Avoid_: parent, source, status reason

