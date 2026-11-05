/**
 * Tool surface audit: every advertised tool must be reachable.
 *
 * Sends one minimal call per tool and classifies the outcome. A tool that
 * answers with a validation or precondition error is reachable; a tool that
 * answers `unknown tool`, throws a TypeError or ReferenceError, or never
 * answers is a defect.
 *
 * Usage: bun evals/mcp/tool-audit.ts [--json]
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemoryKernel } from '../../src/factory.js';
import { callCogmemMcpTool, listCogmemMcpTools } from '../../src/mcp/CoreMcpTools.js';

const SAMPLES: Record<string, unknown> = {
  query: 'which storage backend did we pick for release',
  userText: 'We picked SQLite for the 4.0 release.',
  assistantText: 'Noted.',
  sessionId: 'audit-session',
  agentId: 'audit-agent',
  projectId: 'audit-project',
  collections: ['audit-collection'],
  items: [{ itemHash: 'audit-item-1', collection: 'audit-collection', payload: { text: 'audit' } }],
  itemHash: 'audit-item-1',
  limit: 5,
  depth: 1,
  episodeType: 'discussion',
  title: 'audit episode',
  importance: 0.5,
  tags: ['audit'],
  content: 'audit content',
  text: 'audit text',
  nodeId: 'audit-node',
  candidateId: 'audit-candidate',
  frameId: 'audit-frame',
  topicId: 'audit-topic',
  operation: 'status',
  direction: 'both',
  format: 'text',
  mode: 'status',
  action: 'status',
};

function sampleFor(name: string, schema: Record<string, unknown>): unknown {
  if (name in SAMPLES) return SAMPLES[name];
  const type = schema?.type;
  if (type === 'array') return [];
  if (type === 'number' || type === 'integer') return 1;
  if (type === 'boolean') return false;
  if (type === 'object') return {};
  if (Array.isArray(schema?.enum) && schema.enum.length > 0) return schema.enum[0];
  return `audit-${name}`;
}

function buildArgs(tool: { inputSchema?: { properties?: Record<string, Record<string, unknown>>; required?: string[] } }): Record<string, unknown> {
  const properties = tool.inputSchema?.properties ?? {};
  const required = tool.inputSchema?.required ?? [];
  const args: Record<string, unknown> = {};
  for (const name of required) {
    args[name] = sampleFor(name, properties[name] ?? {});
  }
  return args;
}

export type Verdict = 'ok' | 'reachable' | 'defect';

export interface Row {
  tool: string;
  verdict: Verdict;
  detail: string;
  ms: number;
}

export function classify(result: { isError?: boolean; structuredContent?: unknown; content?: Array<{ text?: string }> }): { verdict: Verdict; detail: string } {
  const text = result.content?.[0]?.text ?? '';
  const error = (result.structuredContent as { error?: string } | undefined)?.error ?? '';
  const message = `${error} ${text}`.trim();

  if (!result.isError) return { verdict: 'ok', detail: 'returned without error' };
  if (/unknown cogmem tool|unknown tool|not implemented|undefined is not a function/i.test(message)) {
    return { verdict: 'defect', detail: message.slice(0, 160) };
  }
  if (/TypeError|Cannot read|is not a function/i.test(message)) {
    return { verdict: 'defect', detail: message.slice(0, 160) };
  }
  if (/ReferenceError|is not defined/i.test(message)) {
    return { verdict: 'defect', detail: message.slice(0, 160) };
  }
  return { verdict: 'reachable', detail: message.slice(0, 120) };
}

async function run(): Promise<void> {
  const json = process.argv.includes('--json');
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-tool-audit-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db') });
  const tools = listCogmemMcpTools();
  const rows: Row[] = [];

  for (const tool of tools) {
    const started = performance.now();
    let result;
    try {
      result = await callCogmemMcpTool(tool.name, buildArgs(tool), { kernel, hostId: 'audit-host' });
    } catch (error) {
      rows.push({
        tool: tool.name,
        verdict: 'defect',
        detail: `threw: ${error instanceof Error ? error.message : String(error)}`.slice(0, 160),
        ms: Math.round(performance.now() - started),
      });
      continue;
    }
    const { verdict, detail } = classify(result);
    rows.push({ tool: tool.name, verdict, detail, ms: Math.round(performance.now() - started) });
  }

  kernel.close();
  rmSync(dir, { recursive: true, force: true });

  if (json) {
    console.log(JSON.stringify({ total: rows.length, rows }, null, 2));
  } else {
    const width = Math.max(...rows.map((row) => row.tool.length));
    for (const row of rows) {
      console.log(`${row.tool.padEnd(width)}  ${row.verdict.padEnd(9)}  ${String(row.ms).padStart(4)}ms  ${row.detail}`);
    }
  }

  const defects = rows.filter((row) => row.verdict === 'defect');
  const summary = {
    total: rows.length,
    ok: rows.filter((row) => row.verdict === 'ok').length,
    reachable: rows.filter((row) => row.verdict === 'reachable').length,
    defect: defects.length,
    slowest: rows.slice().sort((a, b) => b.ms - a.ms)[0]?.tool,
  };
  console.log(`\n${JSON.stringify(summary)}`);
  process.exitCode = defects.length > 0 ? 1 : 0;
}

// Only run when executed directly; importing this module must not start a kernel
// or overwrite process.exitCode for the importing test process.
if (import.meta.main) await run();
