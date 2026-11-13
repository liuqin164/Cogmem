/**
 * Command proposals (spec §7, #165 round 22): the agent hands the user one shell command to run and
 * the user decides. A proposal is an executable offer, not a message — it is structured state, it
 * lives in the transcript as its own element, and it has exactly two entries:
 *
 *  - `CommandProposals.propose` records it (and refuses a command the palette would not offer — the
 *    proposal path and the panel share the one availability rule, `commands.ts`'s
 *    `availableCoreCommand`);
 *  - `executeProposal` is the only thing that runs it, gated on a fresh user-confirmation event.
 *
 * The agent's tool never runs anything: it records the offer and says so. The user's confirmation is
 * the only key to `executeProposal`, a proposal is one-shot (executing or discarding retires it and
 * neither can be replayed), and every step lands in the trace. This is the seam the discriminating
 * test guards: an unconfirmed proposal object handed straight to `executeProposal` is refused.
 */

export type ProposalStatus = 'pending' | 'executed' | 'discarded' | 'rejected';

export interface CommandProposal {
  id: string;
  /** The core command's name, without the slash (`pause`). */
  command: string;
  args: string;
  /** One line the agent gives the user for why it is offering this. */
  reason: string;
  status: ProposalStatus;
  createdAt: number;
  /** Set once it executed: the command's own receipt text. */
  resultText?: string;
  /** Set when the command was refused at propose time (not on the availability table). */
  rejectedReason?: string;
}

/**
 * The user's decision. The agent cannot construct this — only a confirm key in the TUI (routed to
 * the resident over the control socket) does — which is what makes `executeProposal` a user gate
 * rather than a second dispatcher.
 */
export interface ProposalConfirmation {
  kind: 'user-confirm';
  proposalId: string;
  at: number;
}

/**
 * Retention for settled proposals (#165 round 23). A settled entry is kept for one reason: a late
 * confirm can be told *why* it refused (`proposal_not_pending: executed`) instead of "no such
 * proposal". That is worth a bounded amount of memory, not the process's lifetime. Pending
 * proposals are never touched by retention — nothing here can execute or discard one.
 */
// ponytail: 64 entries and 24h are sized for a companion that offers a command a few times a day and
// lives for months: 64 covers every offer of a day and more, well past when a late confirm matters,
// and the TTL releases the rest early. Constants rather than constructor options because nothing has
// needed to tune them; lift them into `CommandProposals`' options the day something does.
export const MAX_SETTLED_PROPOSALS = 64;
export const SETTLED_PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

export interface ProposalTrace {
  append(kind: string, record?: Record<string, unknown>, now?: number): void;
}

export interface ProposeInput {
  command: string;
  args?: string;
  reason: string;
}

export interface ProposeResult {
  proposal: CommandProposal;
  /** `false` when the command is not on the availability table: it never entered the pending state. */
  accepted: boolean;
}

/**
 * The proposal registry. `isAvailable` is the shared availability rule, injected so the shell can
 * hold the palette's face and the resident's face to the same table (`availableCoreCommand`).
 * `onChange` is the one place a proposal reaches the view, so a re-broadcast can never drift from
 * the registry's own state.
 */
export class CommandProposals {
  private readonly byId = new Map<string, CommandProposal>();
  private seq = 0;

  constructor(
    private readonly isAvailable: (command: string) => boolean,
    private readonly trace: ProposalTrace,
    private readonly now: () => number,
    private readonly onChange?: (proposal: CommandProposal) => void,
  ) {}

  /**
   * Bounded retention, enforced lazily at the two points that can observe it: a new offer, and a
   * lookup (which is what a late confirm is). No timer — a resident that offers nothing accumulates
   * nothing. The map's insertion order is offer order, so the head of the settled list is the oldest.
   * The TTL is measured from the offer: an offer that sat pending past the TTL is swept the next time
   * the registry prunes, once it is settled. Pending entries are skipped, never pruned.
   */
  private prune(): void {
    const at = this.now();
    const settled = [...this.byId].filter(([, proposal]) => proposal.status !== 'pending');
    const overCap = settled.length - MAX_SETTLED_PROPOSALS;
    settled.forEach(([id, proposal], index) => {
      if (index < overCap || at - proposal.createdAt > SETTLED_PROPOSAL_TTL_MS) this.byId.delete(id);
    });
  }

  propose(input: ProposeInput): ProposeResult {
    const at = this.now();
    const { command, args } = normalize(input.command, input.args);
    const id = `proposal-${at.toString(36)}-${this.seq++}`;
    const reason = input.reason.trim();
    const base = { id, command, args, reason, createdAt: at };
    if (!this.isAvailable(command)) {
      // Refused on the spot: no pending state exists, so nothing can confirm it into running. The
      // trace carries both the agent's ask and the refusal, in one record.
      const detail = `command_not_available: /${command} 不在可用命令表上（不是核心命令，或尚未实现）`;
      const proposal: CommandProposal = { ...base, status: 'rejected', rejectedReason: detail };
      this.byId.set(id, proposal);
      this.trace.append('command_proposal_rejected', { id, command, args, reason, detail }, at);
      this.onChange?.(proposal);
      this.prune();
      return { proposal, accepted: false };
    }
    const proposal: CommandProposal = { ...base, status: 'pending' };
    this.byId.set(id, proposal);
    this.trace.append('command_proposed', { id, command, args, reason }, at);
    this.onChange?.(proposal);
    this.prune();
    return { proposal, accepted: true };
  }

  /** Prunes first, so a confirm for an expired settled entry answers "no such proposal". */
  get(id: string): CommandProposal | undefined {
    this.prune();
    return this.byId.get(id);
  }

  pending(): CommandProposal[] {
    return [...this.byId.values()].filter((proposal) => proposal.status === 'pending');
  }

  /** Discard is the user's other answer: the proposal retires and can never be confirmed after it. */
  discard(id: string): CommandProposal | undefined {
    const proposal = this.byId.get(id);
    if (!proposal || proposal.status !== 'pending') return undefined;
    proposal.status = 'discarded';
    this.trace.append('command_proposal_discarded', { id, command: proposal.command }, this.now());
    this.onChange?.(proposal);
    return proposal;
  }

  /** Called by `executeProposal` when the confirmed proposal settled; keeps `onChange` in one place. */
  settled(proposal: CommandProposal): void {
    this.onChange?.(proposal);
  }
}

export interface ProposalExecutionDeps {
  /** The same dispatch a typed `/name` takes; a proposal never opens its own. */
  dispatch(command: string, args: string): Promise<{ text: string }>;
  trace: ProposalTrace;
  now(): number;
}

export interface ProposalExecution {
  ok: boolean;
  reason?: string;
  reply?: { text: string };
}

/**
 * The one execution entry. It refuses everything except a pending proposal named by a fresh
 * user-confirmation event: no confirmation, an id that does not match, a proposal already spent,
 * or no proposal at all — each refuses without dispatching, and each refusal is traced. The status
 * is flipped to `executed` before the dispatch, so a re-entrant confirm cannot run it twice.
 */
export async function executeProposal(
  proposal: CommandProposal | undefined,
  confirmation: ProposalConfirmation | undefined,
  deps: ProposalExecutionDeps,
): Promise<ProposalExecution> {
  const refuse = (reason: string): ProposalExecution => {
    deps.trace.append(
      'command_proposal_execution_refused',
      { id: proposal?.id ?? null, command: proposal?.command ?? null, reason },
      deps.now(),
    );
    return { ok: false, reason };
  };
  if (!proposal) return refuse('no_such_proposal');
  if (proposal.status !== 'pending') return refuse(`proposal_not_pending: ${proposal.status}`);
  if (!confirmation || confirmation.kind !== 'user-confirm') return refuse('user_confirmation_required');
  if (confirmation.proposalId !== proposal.id) return refuse('confirmation_id_mismatch');

  proposal.status = 'executed';
  deps.trace.append('command_proposal_confirmed', { id: proposal.id, command: proposal.command, args: proposal.args, at: confirmation.at }, deps.now());
  try {
    const reply = await deps.dispatch(proposal.command, proposal.args);
    proposal.resultText = reply.text;
    deps.trace.append('command_proposal_executed', { id: proposal.id, command: proposal.command, args: proposal.args, status: 'executed', replyChars: reply.text.length }, deps.now());
    return { ok: true, reply };
  } catch (error) {
    // A dispatch that threw still ran: the proposal is spent either way, and the failure is named.
    const message = error instanceof Error ? error.message : String(error);
    proposal.resultText = `命令 /${proposal.command} 失败：${message}`;
    deps.trace.append('command_proposal_executed', { id: proposal.id, command: proposal.command, args: proposal.args, status: 'failed', message }, deps.now());
    return { ok: true, reply: { text: proposal.resultText } };
  }
}

/** Accept `/pause`, `pause` and `/model mg-fast` alike; args in the command field are folded in. */
function normalize(command: string, args: string | undefined): { command: string; args: string } {
  const [name = '', ...rest] = command.trim().replace(/^\/+/u, '').split(/\s+/u);
  const extra = rest.join(' ').trim();
  const explicit = (args ?? '').trim();
  return { command: name.toLowerCase(), args: explicit !== '' ? explicit : extra };
}
