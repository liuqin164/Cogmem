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
});
