# Cogmem

An agent's memory kernel: it keeps what happened, and later puts the relevant part back in front of the agent without being searched for.

## Language

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

**Cold memory**:
A memory nothing has touched for a long time. It stays reachable: coldness lowers how readily it surfaces, never whether it exists.
_Avoid_: expired, stale, deleted

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

**Nightly run**（夜间跑）:
One operation that seals what has gone quiet, Dreams a bounded number of those episodes, and projects them — safe to re-run.
_Avoid_: nightly batch, cron job, dream job

**Incremental projection**（增量投影）:
Adding one episode's nodes and edges to the atlas without recomputing the rest. The unit is one episode, never the corpus.
_Avoid_: reindex, refresh, resync

### Scope

**Drill-down**（下钻）:
Following a surfaced memory back to the words that produced it. Within one project it is always available; across projects it is never available; a forgotten memory is gone for good.
_Avoid_: trace, lookup, citation

**First-class memory backend**（一等记忆后端）:
A memory subsystem the host takes as its default path rather than an optional tool: recall goes there first, and anything it surfaces can be traced back to the original words.
_Avoid_: memory plugin, vector store, RAG add-on

### Installing

**Install actor**（安装执行者）:
Who carries out one install step: an **Agent** (runs unattended), an **Operator** (a person at the keyboard), or the **Host** (the agent runtime itself, reloading its own gateway or MCP entry). Every install step names exactly one.
_Avoid_: user, runner, executor, role

**Install path**（安装路径）:
One of exactly two routes to a working install: the **Operator path** (installer, then the wizard) and the **Agent path** (installer, then a non-interactive setup).
_Avoid_: method, option, flavor, mode

**Setting tier**（设置档位）:
Who may decide one setup setting: **Agent-decidable** (a safe default exists and a wrong choice destroys nothing), **Human-required** (a key, a passphrase, or money), or **Settle-later** (changeable afterwards with no data loss).
_Avoid_: required/optional, basic/advanced

**Install gate**（安装收口）:
The single check install, update and connect all end on. It answers not installed, OK, WARN (installed but degraded) or FAIL, and always names the next step.
_Avoid_: health check, smoke test, verification

**Workspace**（工作区）:
The directory an install shares with an agent, identified by the `.cogmem/` directory it contains. Its configuration travels with it, so one install on a machine serves several Workspaces and each resolves its own.
_Avoid_: project, repo, working directory, workspace directory, workspaceDir

**Host integration**（宿主接入）:
A Host whose runtime has been wired to call Cogmem — a skill installed, a plugin or MCP entry written into the host's own config. It is a fact about files on disk, not a preference, and `connect` is what makes it true.
_Avoid_: enabled host, configured host, integration switch

### Hosts

**Host**（宿主）:
An agent runtime Cogmem is attached to. It owns the model, the prompt, and the turn; Cogmem owns none of those.
_Avoid_: client, integration, platform, backend

**Host hook**（宿主钩子）:
A point where a runtime lets outside code run inside its own turn. Which hooks exist is a property of the host, not of Cogmem.
_Avoid_: callback, event, extension point, plugin API

**Push hook**（推送钩子）:
A **Host hook** that runs before the model answers, so memory can be in the prompt without the model asking. A host may expose one and still have no Cogmem adapter using it.
_Avoid_: pre-prompt hook, injection point, auto-recall, preload

**Host adapter**（宿主适配器）:
The per-host piece that turns one host's hook into a request to the **Memory bridge** and puts the answer into the prompt.
_Avoid_: plugin, connector, driver, shim

**Memory bridge**（记忆桥）:
The single resident process holding the only connection to a memory database, which every **Host adapter** talks to.
_Avoid_: daemon, server, backend service, gateway

### Candidates

**Promotion target**（提升目标）:
What a candidate became, was replaced by, or is about. Its type names one of three classes: the referent (`fact`, `belief`, `summary`, `entity`, `graph_edge`, `replacement_candidate`), the locator the candidate is about (`semantic_tags`, `indexing_decision`, `semantic_relation`, `edge_adjustment`), or, for a candidate retired without a successor, the reason class (`review_queue_expiry`, `diagnostic_conclusion`).
A referent id is the id of a stored row; a locator id is an event id (`evt-…`) or a topic path (`memory/auditability`), never a row id; a reason class carries no id. The id is empty when the candidate names none of those, and it never points at the row itself.
_Avoid_: parent, source, status reason

