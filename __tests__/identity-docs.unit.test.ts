import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const read = (file: string): string => readFileSync(join(root, file), 'utf8');

describe('the session identity trust boundary is documented', () => {
  test('mcp-hosts states the launch-profile ceiling and the binding rules', () => {
    const hosts = read('docs/mcp-hosts.md');
    expect(hosts, 'the header must be named').toContain('x-cogmem-identity');
    expect(hosts, 'the ceiling must be the launch profile, not the session').toContain('launched');
    expect(hosts, 'the per-call read must be stated').toContain('every call');
    expect(hosts, 'the project binding error must be named').toContain('project_scope_violation');
    expect(hosts, 'the unknown profile error must be named').toContain('unknown_tool_profile');
    expect(hosts, 'the malformed-header consequence must be stated').toContain('unbound');
  });

  test('SECURITY.md states the header is not authentication and names the token boundary', () => {
    const security = read('SECURITY.md');
    expect(security, 'the header must be named').toContain('x-cogmem-identity');
    expect(security, 'the threat-side rule must be stated').toMatch(/not an\s+authentication mechanism/i);
    expect(security, 'the token must be named as the boundary').toMatch(/token,\s+not the header, is the boundary/i);
    expect(security, 'the launch-profile ceiling must be stated').toContain('launched with');
    expect(security, 'the per-call and malformed cases must be stated').toContain('per call');
  });

  test('mcp-hosts carries the multi-bot deployment model (#149)', () => {
    const hosts = read('docs/mcp-hosts.md');
    const flat = hosts.replace(/\s+/g, ' ');
    // The contract: identity follows the connection, so a shared credential is one
    // agent — and the anti-pattern has to be named as silent, because nothing
    // reports it.
    expect(flat, 'the chapter must exist').toContain('## Multi-bot deployment');
    expect(flat, 'the contract must be stated').toContain('A bot is an agent to Cogmem, and an agent is whatever presents the credential');
    expect(flat, 'the shared-credential merge must be called silent').toContain('Several bots sharing one credential are one agent, and the merge is silent');
    // Both topologies, with the single-writer reason for the HTTP one.
    expect(flat, 'the recommended topology must be stated').toContain('one process owns the single writer');
    expect(flat, 'the stdio trade must be stated').toContain('every process opens the same file');
    // One identity boundary per host, so a reader can configure two bots on two hosts.
    for (const boundary of ['## Hermes', '## OpenClaw', '## pi']) expect(hosts).toContain(boundary);
    for (const claim of ['a **Profile**: its own `config.yaml`', '`mcp.servers` is one global map', 'pi has no agent concept']) {
      expect(flat, `the host boundary must be stated: ${claim}`).toContain(claim);
    }
    expect(flat, 'sub-agents must be addressed').toContain('inherits the parent');
    expect(flat, 'the survey source must be labelled').toContain('2026-11-07');
  });
});
