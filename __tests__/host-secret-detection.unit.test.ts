import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';
import type { HostIdentity } from '../src/host/bridge/HostBridge.js';
import { rememberForHost } from '../src/host/bridge/HostBridge.js';
import { makeTempDir } from './helpers/tmp.js';

const IDENTITY: HostIdentity = {
  agentId: 'hermes', projectId: 'proj-hermes', sessionId: 'hermes-session', memorySource: 'hermes-plugin',
};
/** Literals, not placeholders: the pattern set deliberately ignores `<your-key>` and `${VAR}`. */
// Plain literals. `API_KEY=...` is counted twice on purpose: the key ends in _KEY, so the generic
// assignment rule and the API-key rule both match it — three findings for two assignments.
const ENV_TOOL_RESULT = ['API_KEY=abc123def456ghi789', 'DB_PASSWORD=correcthorsebattery', '# service config'].join('\n');
const GHP_TOKEN = 'ghp_abcdefghijklmnopqrstuvwx';
const NEGATIVES = [
  '这一节讨论密码轮换策略：password 应当定期更换，并记录在运维手册里。',
  'token = getToken()',
  'API_KEY=<your-key>',
  'password: xxx',
  '把 password 这个词写进词汇表。',
  'DB_SECRET=${MY_SECRET}',
];

type Kernel = ReturnType<typeof createMemoryKernel>;
const markRows = (kernel: Kernel): Array<{ u: number | null; a: number | null }> =>
  kernel.factStore.getDatabase().prepare(`
    SELECT json_extract(payload_json, '$.metadata.secretFindings.total') AS u,
           json_extract(payload_json, '$.metadata.secretFindingsAssistant.total') AS a
      FROM memory_events
  `).all() as Array<{ u: number | null; a: number | null }>;

/** doctor's count for the same database, which is the third of the three places that must agree. */
function doctorCount(dbPath: string, dir: string): number | undefined {
  const configPath = join(dir, 'config.toml');
  writeFileSync(configPath, [
    '[core]', `db_path = ${JSON.stringify(dbPath)}`, 'vector_backend = "sqlite-vec"', 'vector_dimension = 384',
    '[paths]', `embeddings_dir = ${JSON.stringify(join(dir, 'embeddings'))}`, `snapshots_dir = ${JSON.stringify(join(dir, 'snapshots'))}`, `logs_dir = ${JSON.stringify(join(dir, 'logs'))}`,
    '[embedding]', 'provider = "deterministic_local"', 'model = "deterministic_local"',
    '[memory_model]', 'provider = "rule_only"', 'model = "rule_only"',
    '[reasoning_model]', 'provider = "rule_only"', 'model = "rule_only"',
  ].join('\n') + '\n');
  const run = spawnSync('bun', [join(import.meta.dir, '..', 'src', 'bin', 'cogmem.ts'), 'doctor', '--config', configPath, '--json'], { encoding: 'utf8' });
  return (JSON.parse(run.stdout) as { secretFindings?: { markedEvents?: number } }).secretFindings?.markedEvents;
}

describe('secrets on the write path', () => {
  test('a tool result shaped like a .env file agrees in all three places', async () => {
    const dir = makeTempDir('cogmem-secret-tool-');
    const dbPath = join(dir, 'brain.db');
    const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
    try {
      const result = await rememberForHost({ kernel, memory: new KernelAgentMemoryBackend(kernel) }, {
        sessionId: 's-tool', userText: 'run the config check', assistantText: 'done',
        // Paired: an observation without its call is not written at all.
        toolCalls: [{ toolCallId: 't1', input: 'read .env' }],
        toolResults: [{ toolCallId: 't1', output: ENV_TOOL_RESULT }],
      }, {}, IDENTITY);
      expect(result.hygiene.secretFindings).toEqual({ total: 3, events: 1 });
      const marked = markRows(kernel).filter((row) => row.u !== null);
      expect(marked).toHaveLength(1);
      expect(marked[0]!.u).toBe(3);
      expect(doctorCount(dbPath, dir)).toBe(1);
    } finally {
      kernel.close();
    }
  });

  test('a user turn carrying a token agrees in all three places', async () => {
    const dir = makeTempDir('cogmem-secret-user-');
    const dbPath = join(dir, 'brain.db');
    const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
    try {
      const result = await rememberForHost({ kernel, memory: new KernelAgentMemoryBackend(kernel) }, {
        sessionId: 's-user', userText: `注意 ${GHP_TOKEN} 要轮换`, assistantText: 'noted',
      }, {}, IDENTITY);
      expect(result.hygiene.secretFindings).toEqual({ total: 1, events: 1 });
      // Exactly one event carries it: the turn metadata channel is shared, so the assistant's own
      // findings travel under their own key and the user's do not ride along.
      expect(markRows(kernel).filter((row) => row.u !== null)).toHaveLength(1);
      expect(doctorCount(dbPath, dir)).toBe(1);
    } finally {
      kernel.close();
    }
  });

  test('the snake_case payload the hosts also send is paired, written and scanned', async () => {
    const dir = makeTempDir('cogmem-secret-snake-');
    const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
    try {
      const result = await rememberForHost({ kernel, memory: new KernelAgentMemoryBackend(kernel) }, {
        sessionId: 's-snake', userText: 'check the env', assistantText: 'done',
        tool_calls: [{ tool_call_id: 't1', input: 'read .env' }],
        tool_results: [{ tool_call_id: 't1', output: ENV_TOOL_RESULT }],
      }, {}, IDENTITY);
      expect(result.hygiene.secretFindings).toEqual({ total: 3, events: 1 });
    } finally {
      kernel.close();
    }
  });

  test('the negative set counts as nothing and marks no event', async () => {
    const dir = makeTempDir('cogmem-secret-negative-');
    const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
    try {
      const result = await rememberForHost({ kernel, memory: new KernelAgentMemoryBackend(kernel) }, {
        sessionId: 's-neg', userText: NEGATIVES.join('\n'), assistantText: NEGATIVES.join('\n'),
        toolCalls: [{ toolCallId: 't1', input: 'read notes' }],
        toolResults: [{ toolCallId: 't1', output: NEGATIVES.join('\n') }],
      }, {}, IDENTITY);
      expect(result.hygiene.secretFindings).toEqual({ total: 0, events: 0 });
      expect(markRows(kernel).every((row) => row.u === null && row.a === null)).toBe(true);
    } finally {
      kernel.close();
    }
  });
});
