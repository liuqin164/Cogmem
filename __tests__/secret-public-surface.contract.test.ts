import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';
import { rememberForHost, type HostIdentity } from '../src/host/bridge/HostBridge.js';
import {
  SECRET_PATTERNS,
  countSecretFindings,
  redactSecretText,
  secretFindingsMetadata,
} from '../src/public.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * The #189 public redaction face: the exports the contract document freezes, and the same result
 * through the direct-kernel and HostBridge write paths.
 */

const RAW = [
  'sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
  'password = "hunter2hunter2"',
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIEowIBAAKCAQEAx7Zq8mQvN3sTpLdW1yVk9bRf4hJ2mC5nQ8wX1zA6oP',
  '-----END RSA PRIVATE KEY-----',
].join('\n');

const markdown = readFileSync(fileURLToPath(new URL('../docs/life-sensitivity.md', import.meta.url)), 'utf8');

function frozenExports(): string[] {
  const section = markdown.split('## Public redaction face (#189, frozen)')[1]?.split(/\n#{2,3} /)[0] ?? '';
  return [...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gmu)].map((match) => match[1]!);
}

describe('the public redaction face is frozen', () => {
  test('the document lists exactly the names public.ts exports', () => {
    expect(frozenExports()).toEqual(['SECRET_PATTERNS', 'countSecretFindings', 'redactSecretText', 'secretFindingsMetadata']);
    expect(typeof SECRET_PATTERNS).toBe('object');
    expect(SECRET_PATTERNS.length).toBeGreaterThan(0);
    expect(typeof countSecretFindings).toBe('function');
    expect(typeof redactSecretText).toBe('function');
    expect(typeof secretFindingsMetadata).toBe('function');
  });

  test('one text goes in, only its redacted form and the finding counts come out', () => {
    const redacted = redactSecretText(RAW);
    expect(redacted.text).not.toContain('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
    expect(redacted.text).not.toContain('hunter2hunter2');
    expect(redacted.text).not.toContain('MIIEowIBAAKCAQEA');
    expect(redacted.text).toContain('[REDACTED]');
    expect(redacted.count).toBeGreaterThanOrEqual(3);
    expect(redacted.chars).toBeGreaterThan(0);

    const findings = countSecretFindings(RAW);
    expect(findings.total).toBe(redacted.count);
    expect(findings.byKind.openai_key).toBe(1);
    expect(findings.byKind.private_key_block).toBe(1);
    expect(secretFindingsMetadata(RAW)).toEqual({ secretFindings: findings });
    expect(secretFindingsMetadata('')).toEqual({});
    expect(countSecretFindings('')).toEqual({ total: 0, byKind: {} });
    expect(redactSecretText('plain line, no key')).toEqual({ text: 'plain line, no key', count: 0, chars: 0 });
  });
});

describe('the primitive and the write paths agree', () => {
  test('direct kernel and HostBridge both store the redacted form and the mark', async () => {
    const dir = makeTempDir('cogmem-secret-public-');
    const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db') });
    try {
      const redacted = redactSecretText(RAW);
      const direct = kernel.recordRawEvent({
        projectId: 'direct',
        threadId: 'direct-thread',
        role: 'user',
        content: redacted.text,
        metadata: secretFindingsMetadata(RAW),
      });
      const directPayload = kernel.eventStore.getEvent(direct.eventId)!.payload as {
        text: string;
        metadata: { secretFindings?: { total: number } };
      };
      expect(directPayload.text).toBe(redacted.text);
      expect(directPayload.text).not.toContain('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
      expect(directPayload.metadata.secretFindings?.total).toBeGreaterThan(0);

      const identity: HostIdentity = { agentId: 'host', projectId: 'bridge', sessionId: 's', memorySource: 'test' };
      const result = await rememberForHost({ kernel, memory: new KernelAgentMemoryBackend(kernel) }, {
        sessionId: 's',
        userText: 'run the check',
        assistantText: 'done',
        toolCalls: [{ toolCallId: 't1', input: 'cat env' }],
        toolResults: [{ toolCallId: 't1', output: RAW }],
      }, {}, identity);
      expect(result.hygiene.secretFindings.total).toBeGreaterThan(0);

      const rows = kernel.factStore.getDatabase().prepare(
        `SELECT json_extract(payload_json, '$.text') AS text,
                json_extract(payload_json, '$.metadata.secretFindings.total') AS total
           FROM memory_events`,
      ).all() as Array<{ text: string | null; total: number | null }>;
      expect(rows.some((row) => row.text?.includes('[REDACTED]') && Number(row.total) > 0)).toBe(true);
      expect(rows.some((row) => row.text?.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'))).toBe(false);
    } finally {
      kernel.close();
    }
  });
});
