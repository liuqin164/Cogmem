/**
 * The agent's channel for handing the user a command: one tool, `propose_command`.
 *
 * It records an offer and returns — it runs nothing. That separation is the point: the model can
 * ask for `/pause`, but only the user's confirmation in the conversation reaches the dispatcher
 * (`executeProposal` in `proposals.ts`). An offer of a command that is not on the availability table
 * comes back as an error result the model can read, and the refusal is traced.
 */
import type { CommandProposals } from '../proposals.ts';
import type { NativePlugin, ToolOutcome } from './host.ts';

function field(args: unknown, key: string): string {
  const value = (args as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'string' ? value : '';
}

export function proposalPlugin(): NativePlugin {
  return {
    name: 'command-proposals',
    inject: ['proposals'],
    apply(ctx) {
      const proposals = ctx.getService<CommandProposals>('proposals');
      ctx.registerTool({
        name: 'propose_command',
        description:
          'Offer the user exactly one shell command to run, with a one-line reason. The user confirms or discards it in the conversation; it never runs on its own, and it is one-shot. Only core shell commands may be offered (/pause, /resume, /sleep, /status, /context, /dream, /upgrade, /model, /why, /memory, /soul, /commitments, /help); anything else is refused.',
        // The offer is an observation the ledger should keep; a replay after a crash must not offer it twice.
        replay: 'never',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Core command name, with or without the leading slash, e.g. "pause"' },
            args: { type: 'string', description: 'Optional argument for the command, e.g. a model route name' },
            reason: { type: 'string', description: 'One line telling the user why you are offering it' },
          },
          required: ['command', 'reason'],
        },
        execute({ args }): ToolOutcome {
          const command = field(args, 'command');
          const reason = field(args, 'reason').trim();
          if (command.trim() === '' || reason === '') {
            throw new Error('invalid_arguments: "command" and "reason" must be non-empty strings');
          }
          const { proposal, accepted } = proposals.propose({ command, args: field(args, 'args'), reason });
          const target = `/${proposal.command}${proposal.args === '' ? '' : ` ${proposal.args}`}`;
          if (!accepted) {
            return {
              output: `proposal_rejected: ${target} 不在可用命令表上，没有递给用户，也没有执行。${proposal.rejectedReason ?? ''}`.trim(),
              isError: true,
            };
          }          return {
            output: `proposal_offered: ${target} 已递给用户，等待确认或放弃（提议 ${proposal.id}）。它还没有执行；只有用户确认后才会按同一条命令路径执行。`,
            isError: false,
          };
        },
      });
    },
  };
}
