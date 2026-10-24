# OpenClaw Memory Convergence Safety Design

## Goal

Release Cogmem 2.7.1 with a source-faithful OpenClaw import path, correction-aware Dream governance, bounded review-queue aging, and recall decisions that an agent can inspect without expanding normal prompt context substantially.

## Confirmed Root Causes

The June 6 fixtures expose two independent failures.

1. `ConversationMarkdownAdapter` only recognizes role lines that contain text on the same line. OpenClaw session files commonly use `assistant:` on one line and the body below it. The parser therefore appends assistant text to the preceding user event. The Dream Curator then sees assistant phrases such as `搞混了` inside a user event and creates false contradiction candidates.
2. The imported file contains adjacent duplicate assistant messages. They are currently imported as separate evidence and create duplicate compiled and Dream records.

The original diagnosis also mixed promotion with recall. Raw Ledger evidence must remain recallable even when it is not promoted. The actual agent recall route and `cogmem_explain_recall` currently expose different paths, so the agent cannot tell which path selected the injected evidence.

## Design

### Source-Faithful Import

`parseMarkdownRoleLine()` will accept an empty role body. `ConversationMarkdownAdapter` will start a new message at that boundary and append following lines to it. After parsing, it will collapse only adjacent messages with the same role and identical normalized text. Repeated user messages separated by assistant turns remain distinct. A diagnostic reports collapsed source duplicates.

### Correction-Aware Curation

Deterministic user correction signals will produce a `correction` organization candidate, not a `contradictions` memory claim. CPU governance may mark this candidate promoted as an organizational trace, but it will not create a fact, belief, or summary. Provider-generated `conflict_candidate` records remain review-only and must identify both the incoming and prior claim.

### Provider Diagnostics

Invalid memory-model output is an operational diagnostic, not uncertain memory. The Dream Curator will record a non-fatal pipeline metric and store one rejected diagnostic record for audit. A later successful provider run supersedes stale provider diagnostics. These records never occupy `needs_confirmation`.

### Review Queue Aging

`DeepWriteCandidateStore` will preserve a status reason and update time. An explicit host-owned maintenance tick will supersede `needs_confirmation` records older than a configurable TTL, default 30 days. No record is deleted. Maintenance output reports the count and reason.

### Recall Decision Trace

`KernelAgentMemoryBackend.recall()` will return a bounded decision trace with candidate counts, selected lane, and a stable reason code. `explainRecallWithKernel()` will use the same agent-facing route when `agentId` is present. MCP, CLI, OpenClaw audit logs, and the volatile recall block will expose this compact trace. Exact evidence still requires `sourceContext` drill-down.

## Safety Bounds

- No confidence threshold is relaxed.
- Raw Ledger records are never deleted or rewritten.
- Corrections do not become user beliefs automatically.
- Queue aging runs only during an explicit maintenance tick.
- Provider failures do not block deterministic Dream candidates.
- Decision traces contain counts and reason codes, not hidden model reasoning.
- Imported duplicate collapse is limited to adjacent, same-role, byte-equivalent normalized text.

## Acceptance Criteria

- The two supplied June 6 files parse into clean role-separated events.
- The 16:40 file does not create contradiction candidates from assistant self-correction text.
- An explicit user clarification creates one promoted organizational correction trace.
- Invalid provider output leaves `needs_confirmation` unchanged and records a non-fatal diagnostic.
- A maintenance tick supersedes expired review items and leaves fresh items untouched.
- Agent recall and explain-recall report the same selected lane and evidence IDs.
- OpenClaw injection includes one compact decision line and retains source locators.
- Typecheck, all Bun tests, build, package dry-run, and fixture replay pass.
