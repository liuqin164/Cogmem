/**
 * The session-context face: the three primitives behind one kernel service.
 *
 * `digest` compiles the mechanical session document, `recall` pages the session ledger verbatim,
 * and `assemble` projects both (plus the caller's pinned/profile/working-set/recall material) onto
 * the target bandwidth. The assembly writes a `session.context.assemble` trace row only when a lane
 * was downgraded, so "why is the context this long" is answerable after the fact.
 *
 * The written contract is `docs/session-context.md`, held by
 * `__tests__/session-context.contract.test.ts`.
 */
import type Database from 'bun:sqlite';

import { TraceStore } from '../observability/TraceStore.js';
import { TraceWriter } from '../observability/TraceWriter.js';
import { buildSessionDigest, type SessionDigest } from './SessionDigest.js';
import { requireSessionText } from './SessionErrors.js';
import { readSessionTurns, type SessionTurn } from './SessionLedger.js';
import { recallSession, type SessionRecallInput, type SessionRecallPage } from './SessionRecall.js';
import {
  assembleSessionContext,
  type AssembleSessionContextInput,
  type SessionContextAssembly,
  type SessionContextItem,
} from './SessionContextAssembler.js';

export const SESSION_CONTEXT_CONTRACT_VERSION = 1;

/** The face's methods, frozen by `docs/session-context.md`. */
export const SESSION_CONTEXT_API_METHODS = ['digest', 'recall', 'assemble'] as const;

export interface SessionDigestInput {
  projectId: string;
  agentId: string;
  sessionId: string;
  /** How many recent turns stay verbatim. */
  tailTurns?: number;
}

export interface SessionContextServiceOptions {
  /**
   * The open loops that must survive a restart: F2 wake intentions and F6 candidates. The kernel
   * wires this to the services that own them; the session face does not import either one.
   */
  openLoops?: (input: { projectId: string; agentId: string; sessionId: string; now: number }) => SessionContextItem[];
}

export class SessionContextService {
  private traceStore: TraceStore | null = null;
  private traceWriter: TraceWriter | null = null;

  constructor(private readonly db: Database, private readonly options: SessionContextServiceOptions = {}) {}

  /** The mechanical digest and the verbatim tail. No model is called. */
  digest(input: SessionDigestInput): SessionDigest {
    const { projectId, agentId, sessionId } = requireScope(input);
    const read = readSessionTurns(this.db, { projectId, agentId, sessionId });
    return buildSessionDigest(read.turns, { sessionId, tailTurns: input.tailTurns, truncated: read.truncated });
  }

  /** The session ledger, paged verbatim. */
  recall(input: SessionRecallInput): SessionRecallPage {
    return recallSession(this.db, input);
  }

  /** The per-turn projection: lanes in frozen order, fitted to `targetTokens`. */
  assemble(input: AssembleSessionContextInput): SessionContextAssembly {
    const { projectId, agentId, sessionId } = requireScope(input);
    const read = readSessionTurns(this.db, { projectId, agentId, sessionId });
    const digest = buildSessionDigest(read.turns, { sessionId, tailTurns: input.tailTurns, truncated: read.truncated });
    const openLoops = [...(input.openLoops ?? []), ...this.openLoops({ projectId, agentId, sessionId })];
    const assembly = assembleSessionContext({ ...input, projectId, agentId, sessionId, openLoops }, digest);
    if (assembly.decisionTrace.length > 0) this.recordTrace(assembly);
    return assembly;
  }

  private openLoops(input: { projectId: string; agentId: string; sessionId: string }): SessionContextItem[] {
    if (!this.options.openLoops) return [];
    try {
      return this.options.openLoops({ ...input, now: Date.now() });
    } catch {
      // Open loops are a convenience lane; a failing source must not fail the turn's assembly.
      return [];
    }
  }

  private recordTrace(assembly: SessionContextAssembly): void {
    try {
      if (!this.traceStore) {
        this.traceStore = new TraceStore(this.db);
        this.traceStore.initSchema();
        this.traceWriter = new TraceWriter(this.traceStore);
      }
      this.traceWriter!.emit({
        projectId: assembly.projectId,
        eventType: 'session.context.assemble',
        payload: {
          sessionId: assembly.sessionId,
          agentId: assembly.agentId,
          targetTokens: assembly.targetTokens,
          usedTokens: assembly.usedTokens,
          downgrades: assembly.decisionTrace,
        },
      });
    } catch {
      // The returned `decisionTrace` is authoritative; the stored row is the audit copy.
    }
  }
}

function requireScope(input: { projectId: string; agentId: string; sessionId: string }): {
  projectId: string;
  agentId: string;
  sessionId: string;
} {
  return {
    projectId: requireSessionText(input.projectId, 'project_id_required'),
    agentId: requireSessionText(input.agentId, 'agent_id_required'),
    sessionId: requireSessionText(input.sessionId, 'session_id_required'),
  };
}

export type { SessionTurn };
