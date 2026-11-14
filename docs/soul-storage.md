# Soul storage and the star-sea editor (v1)

A soul is the companion's own persona text. It is stored per agent, versioned, and injected verbatim
at the head of the pinned lane on every turn. The owner edits it through the observatory; the agent
may read its own soul and propose an edit, but it may never save one. This document is the contract
for that face. The code is `src/soul/`, reached as `MemoryKernel.soul`; the HTTP face is
`/observatory/soul`, held by `__tests__/soul-storage.contract.test.ts` and
`__tests__/observatory-soul.unit.test.ts`. Version: `SOUL_CONTRACT_VERSION = 1`.

## The version table (frozen)

`soul_versions` is the only storage. A save appends a row; nothing is updated or deleted. The current
version is the highest `version` for an agent, and `supersedes` names the version it replaced.

| Field | Means |
|---|---|
| `agentId` | The identity the row belongs to. Reads filter on it; another agent's rows are invisible. |
| `version` | Monotonic per agent, starting at 0 for the installer's default. |
| `content` | The soul text, byte for byte. Never trimmed, compiled or paraphrased on read. |
| `supersedes` | The previous version this row replaces, or `null` for the first row. |
| `createdAt` | The instant the row was written. |
| `createdBy` | `installer` for the seeded default, `user` for an owner save or rollback. |
| `reason` | The optional reason supplied with a save or rollback. |
| `tokenCount` | The read's estimate under `soulTokens`, not stored. |

The table is created `IF NOT EXISTS` by the kernel. There is no migration from the shell's interim
`companion_soul` table: 4.x has no soul users, and the installer seeds the kernel table on a fresh
install. The default text is Ryu's 2026-11-11 file and is not changed by this face.

## Writes and rollback (frozen)

Only the owner writes. `save` takes `actor: 'user'` and appends a new version whose `supersedes` is
the current version. `rollback` also takes `actor: 'user'`, copies an older version's content into a
new version, and leaves the old rows in place. Rolling back to the current version is refused rather
than written as a duplicate. An edit made through the observatory is effective on the next turn.

| Method | Actor | Effect |
|---|---|---|
| `save` | `user` | Append `max(version)+1`, `supersedes = current.version`, `createdBy = user`. |
| `rollback` | `user` | Append `max(version)+1` with an older version's `content`, `supersedes = current.version`. |
| `ensureDefault` | installer | Append version 0 only when the agent has no rows. |

`actor: 'agent'` is refused with `soul_agent_write_forbidden`. A missing or unknown actor is refused
with `soul_writer_required`. The agent-facing backend exposes `soul` (read) and `proposeSoulEdit`;
it exposes no save or rollback method.

## The agent's face (frozen)

`KernelAgentMemoryBackend` is constructed with the connection's own `agentId`. Its soul face has no
agent parameter, so a connection cannot ask for another identity's soul:

| Method | Answer |
|---|---|
| `soul()` | `{ current, versions, proposal }` for the bound agent. |
| `proposeSoulEdit({ content, reason? })` | Append a `soul_edit_proposed` audit row; the current soul is unchanged. |

A proposal is a draft for the owner. It is stored in the existing `governance_audit_log` and shown
in the soul editor; no new queue or table is created. It is not applied until the owner saves a new
version.

## Endpoints (frozen)

All are loopback-only, like every observatory endpoint. The two `POST` routes are the observatory's
only write exception; every other route answers `GET`/`HEAD` and writes nothing.

| Endpoint | Method | Writes | Answer |
|---|---|---|---|
| `/observatory/soul` | `GET` | no | The selected agent's current version, version history, latest proposal and audit rows. `agent` is required; there is no merged soul view. |
| `/observatory/soul` | `POST` | yes | Save a new version. Body `{ agentId, content, reason? }`; `actor` is the owner by construction of this route. |
| `/observatory/soul/rollback` | `POST` | yes | Roll back to a named version. Body `{ agentId, version, reason? }`. |

The `GET` reads through the kernel's soul read face. The `POST` routes call the kernel's governance
save/rollback with `actor: 'user'`; the observatory's read-only connection and every other endpoint
are untouched. A non-soul `POST` remains `405` with `Allow: GET, HEAD`.

## Audit events (frozen)

Every write appends one row to `governance_audit_log`. The row names the agent, the new version and
the content hash; save and rollback rows do not duplicate the soul text. A proposal row carries the
proposed text so the owner can read it back.

| Action | When | Payload |
|---|---|---|
| `soul_save` | An owner save appended a version. | `agentId`, `version`, `supersedes`, `contentHash`, `bytes`, `tokens` |
| `soul_rollback` | An owner rollback appended a version. | `agentId`, `version`, `supersedes`, `fromVersion`, `contentHash`, `bytes`, `tokens` |
| `soul_edit_proposed` | The agent drafted an edit. | `agentId`, `content`, `contentHash`, `bytes`, `tokens`, `reason?` |

`audit(agentId)` returns only that agent's rows, newest first. A save is auditable by version, and a
rollback is reversible because the version it copied still exists.

## Injection into the pinned lane (frozen)

| Rule | Value |
|---|---|
| `position` | The soul is the first item of the pinned lane, before identity and rules. |
| `verbatim` | The current version's `content` is injected byte for byte; no compile, paraphrase or trim. |
| `stability` | At one version, consecutive turns carry byte-identical pinned bytes. |
| `effective` | A saved version is read on the next turn; the process does not need a restart. |
| `cache` | One provider-prefix cache invalidation per edit is acceptable. |

The pinned lane remains the stable prefix described by `docs/session-context.md`. F14 consumes the
soul read face only; it does not change the lane order or the budget rules.

## Length limit (frozen)

The limit is `SOUL_MAX_TOKENS = 2000`. `soulTokens` estimates four Latin characters per token and one
CJK character per token, the same rough order as the editor displays. Over the limit the save is
**rejected** with `soul_too_long`; the content is never silently truncated. The editor shows the live
estimate and the limit beside the text area, and disables the save button while over the limit.

## Errors (frozen)

| Code | When |
|---|---|
| `agent_id_required` | The call names no agent. |
| `soul_content_required` | The content is not a non-empty string. |
| `soul_too_long` | The estimate exceeds `SOUL_MAX_TOKENS`. |
| `soul_agent_write_forbidden` | An agent tried to save or roll back a soul. |
| `soul_writer_required` | The write did not name the owner actor. |
| `soul_version_unknown` | A rollback named a version that agent does not have. |
| `soul_version_is_current` | A rollback named the version already current. |

## Zero-write proof under the revised rule (frozen)

The observatory's read path is still zero-write, with one named exception. The proof hashes the
database file and its `-wal` file before and after a traversal of every `GET`/`HEAD` route,
including `/observatory/soul`; all hashes must be unchanged. It then calls the two soul `POST`
routes and requires the fingerprint to move and the audit row to exist. The same test reads the
observatory's own modules back and refuses a SQL write statement outside the kernel's soul service.
Every other `POST` must still be `405`. This is the revised contract from #136: only
`/observatory/soul` and `/observatory/soul/rollback` may write.

## What this face does not do

It does not change the default soul text. It does not migrate `companion_soul`; there are no users
to migrate. It does not let the agent save, roll back or approve its own proposal. It does not add a
queue for proposals: the audit ledger is the store and the soul editor is the surface. It does not
change F14's lane order, budget rules or `src/surfacing/` gates.
