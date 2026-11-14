import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import {
  SOUL_AUDIT_ACTIONS,
  SOUL_CONTRACT_VERSION,
  SOUL_ENDPOINTS,
  SOUL_ERROR_CODES,
  SOUL_INJECTION_RULES,
  SOUL_MAX_TOKENS,
  SOUL_VERSION_FIELDS,
  SoulError,
  soulTokens,
} from '../src/soul/index.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * The F17 soul contract (#194): a versioned per-agent table, an owner-only write face, an agent that
 * may read and propose but never save, and an injection that is byte-stable until the owner edits it.
 *
 * The document's frozen tables are read back and compared with the code's lists. The behaviour tests
 * are the ticket's discriminators: edit, rollback and audit; an agent write refused; two agents
 * isolated; a proposal that does not change the current soul; and the length limit.
 */

const scratch = makeTempDir('cogmem-soul-');
const dbPath = join(scratch, 'memory.db');
let kernel: MemoryKernel;

beforeAll(() => {
  kernel = createMemoryKernel({ dbPath, projectTimeZone: 'UTC' });
});

afterAll(() => {
  kernel.close();
});

const markdown = readFileSync(fileURLToPath(new URL('../docs/soul-storage.md', import.meta.url)), 'utf8');

function sectionAfter(heading: string): string {
  return markdown.split(heading)[1]?.split(/\n#{2,3} /)[0] ?? '';
}

function backtickedFirstColumn(section: string): string[] {
  return [...section.matchAll(/^\|\s*`([^`]+)`/gmu)].map((match) => match[1]!);
}

function endpointRows(section: string): string[] {
  return [...section.matchAll(/^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*(?:yes|no)\s*\|/gmu)]
    .map((match) => `${match[2]} ${match[1]}`);
}

describe('the contract document and the frozen lists agree', () => {
  test('the version-field table is exactly SOUL_VERSION_FIELDS, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## The version table (frozen)'))).toEqual([...SOUL_VERSION_FIELDS]);
  });

  test('the endpoint table is exactly SOUL_ENDPOINTS, in order', () => {
    expect(endpointRows(sectionAfter('## Endpoints (frozen)'))).toEqual([...SOUL_ENDPOINTS]);
  });

  test('the audit table is exactly SOUL_AUDIT_ACTIONS, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Audit events (frozen)'))).toEqual([...SOUL_AUDIT_ACTIONS]);
  });

  test('the injection table is exactly SOUL_INJECTION_RULES, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Injection into the pinned lane (frozen)'))).toEqual([...SOUL_INJECTION_RULES]);
  });

  test('the error table is exactly SOUL_ERROR_CODES, in order', () => {
    expect(backtickedFirstColumn(sectionAfter('## Errors (frozen)'))).toEqual([...SOUL_ERROR_CODES]);
  });

  test('the version is 1 and the length limit is 2000 tokens, rejected rather than truncated', () => {
    expect(SOUL_CONTRACT_VERSION).toBe(1);
    expect(SOUL_MAX_TOKENS).toBe(2000);
    expect(sectionAfter('## Length limit (frozen)')).toContain('rejected');
    expect(sectionAfter('## Length limit (frozen)')).toContain(String(SOUL_MAX_TOKENS));
  });
});

describe('versions, rollback and audit (#194 discriminator 1)', () => {
  test('the installer seed is version 0 and a re-seed writes nothing', () => {
    const first = kernel.soul.ensureDefault('agent-seed', 'v0 soul\n', 1_000);
    const second = kernel.soul.ensureDefault('agent-seed', 'v0 soul\n', 2_000);
    expect(first.version).toBe(0);
    expect(first.supersedes).toBeNull();
    expect(first.createdBy).toBe('installer');
    expect(second).toEqual(first);
    expect(kernel.soul.read('agent-seed')?.content).toBe('v0 soul\n');
  });

  test('a save appends a version with supersedes, the current is the latest, and the audit row names it', () => {
    kernel.soul.ensureDefault('agent-a', 'soul v0\n', 1_000);
    const saved = kernel.soul.save({ agentId: 'agent-a', content: 'soul v1\n', actor: 'user', reason: 'shorter', now: 2_000 });
    expect(saved.version).toBe(1);
    expect(saved.supersedes).toBe(0);
    expect(saved.createdBy).toBe('user');
    expect(saved.reason).toBe('shorter');
    expect(kernel.soul.read('agent-a')?.content).toBe('soul v1\n');
    expect(kernel.soul.history('agent-a').map((row) => row.version)).toEqual([1, 0]);

    const audit = kernel.soul.audit('agent-a');
    const row = audit.find((entry) => entry.action === 'soul_save' && entry.version === 1);
    expect(row).toBeDefined();
    expect(row!.supersedes).toBe(0);
    expect(row!.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(row!.reason).toBe('shorter');
  });

  test('a rollback appends a new version with the old content, and the old rows remain', () => {
    kernel.soul.ensureDefault('agent-r', 'rollback v0\n', 1_000);
    kernel.soul.save({ agentId: 'agent-r', content: 'rollback v1\n', actor: 'user', now: 2_000 });
    const rolled = kernel.soul.rollback({ agentId: 'agent-r', version: 0, actor: 'user', reason: 'undo', now: 3_000 });
    expect(rolled.version).toBe(2);
    expect(rolled.content).toBe('rollback v0\n');
    expect(rolled.supersedes).toBe(1);
    expect(kernel.soul.history('agent-r').map((row) => row.version)).toEqual([2, 1, 0]);
    expect(kernel.soul.audit('agent-r').some((entry) => entry.action === 'soul_rollback' && entry.version === 2 && entry.fromVersion === 0)).toBe(true);
    expect(() => kernel.soul.rollback({ agentId: 'agent-r', version: 2, actor: 'user' })).toThrow('soul_version_is_current');
    expect(() => kernel.soul.rollback({ agentId: 'agent-r', version: 99, actor: 'user' })).toThrow('soul_version_unknown');
  });
});

describe('the agent may read and propose, never save (#194 discriminator 2)', () => {
  test('an agent actor is refused, and the backend has no save method', () => {
    kernel.soul.ensureDefault('agent-w', 'write v0\n', 1_000);
    expect(() => kernel.soul.save({ agentId: 'agent-w', content: 'agent edit\n', actor: 'agent' })).toThrow('soul_agent_write_forbidden');
    expect(() => kernel.soul.rollback({ agentId: 'agent-w', version: 0, actor: 'agent' })).toThrow('soul_agent_write_forbidden');
    expect(() => kernel.soul.save({ agentId: 'agent-w', content: 'x', actor: 'owner' as never })).toThrow('soul_writer_required');
    expect(kernel.soul.read('agent-w')?.content).toBe('write v0\n');

    const backend = new KernelAgentMemoryBackend(kernel, { agentId: 'agent-w' });
    expect((backend as unknown as { saveSoul?: unknown }).saveSoul).toBeUndefined();
    expect((backend as unknown as { save?: unknown }).save).toBeUndefined();
  });

  test('a proposal is stored in the audit ledger, surfaced on the read, and never changes the current soul', () => {
    kernel.soul.ensureDefault('agent-p', 'proposal v0\n', 1_000);
    const backend = new KernelAgentMemoryBackend(kernel, { agentId: 'agent-p' });
    const proposal = backend.proposeSoulEdit({ content: 'proposal v1\n', reason: 'shorter' });
    expect(proposal.content).toBe('proposal v1\n');
    expect(kernel.soul.read('agent-p')?.content).toBe('proposal v0\n');
    expect(backend.soul().proposal?.content).toBe('proposal v1\n');
    expect(kernel.soul.audit('agent-p').some((entry) => entry.action === 'soul_edit_proposed')).toBe(true);
  });

  test('a backend without a bound agent cannot read or propose', () => {
    const backend = new KernelAgentMemoryBackend(kernel);
    expect(() => backend.soul()).toThrow('agent_id_required');
    expect(() => backend.proposeSoulEdit({ content: 'x' })).toThrow('agent_id_required');
  });
});

describe('two agents are isolated (#194 discriminator 3)', () => {
  test('read, history, proposal and audit never cross the agent boundary', () => {
    kernel.soul.ensureDefault('iso-a', 'A soul\n', 1_000);
    kernel.soul.ensureDefault('iso-b', 'B soul\n', 1_000);
    kernel.soul.save({ agentId: 'iso-a', content: 'A v1\n', actor: 'user', now: 2_000 });
    kernel.soul.save({ agentId: 'iso-b', content: 'B v1\n', actor: 'user', now: 2_000 });
    const a = new KernelAgentMemoryBackend(kernel, { agentId: 'iso-a' });
    const b = new KernelAgentMemoryBackend(kernel, { agentId: 'iso-b' });
    a.proposeSoulEdit({ content: 'A proposal\n' });
    b.proposeSoulEdit({ content: 'B proposal\n' });

    expect(a.soul().current?.content).toBe('A v1\n');
    expect(b.soul().current?.content).toBe('B v1\n');
    expect(a.soul().versions.every((row) => row.agentId === 'iso-a')).toBe(true);
    expect(b.soul().versions.every((row) => row.agentId === 'iso-b')).toBe(true);
    expect(a.soul().proposal?.content).toBe('A proposal\n');
    expect(b.soul().proposal?.content).toBe('B proposal\n');
    expect(kernel.soul.audit('iso-a').every((row) => row.agentId === 'iso-a')).toBe(true);
    expect(kernel.soul.audit('iso-b').every((row) => row.agentId === 'iso-b')).toBe(true);
  });
});

describe('the length limit is measured and enforced (#194 length rule)', () => {
  test('the estimate counts CJK as one token and Latin as four characters', () => {
    expect(soulTokens('abcd')).toBe(1);
    expect(soulTokens('你好')).toBe(2);
    expect(soulTokens('')).toBe(0);
  });

  test('content at the limit is accepted; one token over is rejected, never truncated', () => {
    kernel.soul.ensureDefault('limit-a', 'limit v0\n', 1_000);
    const atLimit = '你'.repeat(SOUL_MAX_TOKENS);
    expect(soulTokens(atLimit)).toBe(SOUL_MAX_TOKENS);
    expect(kernel.soul.save({ agentId: 'limit-a', content: atLimit, actor: 'user' }).content).toBe(atLimit);
    const over = '你'.repeat(SOUL_MAX_TOKENS + 1);
    expect(() => kernel.soul.save({ agentId: 'limit-a', content: over, actor: 'user' })).toThrow('soul_too_long');
    expect(kernel.soul.read('limit-a')?.content).toBe(atLimit);
  });

  test('empty content is refused', () => {
    expect(() => kernel.soul.save({ agentId: 'limit-a', content: '   ', actor: 'user' })).toThrow('soul_content_required');
  });

  test('a SoulError carries its code', () => {
    try {
      kernel.soul.save({ agentId: '', content: 'x', actor: 'user' });
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(SoulError);
      expect((error as SoulError).code).toBe('agent_id_required');
    }
  });
});
