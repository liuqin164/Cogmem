import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const read = (file: string): string => readFileSync(join(root, file), 'utf8');

describe('the session identity trust boundary is documented', () => {
  test('mcp-hosts documents the header and the narrow-only rule', () => {
    const hosts = read('docs/mcp-hosts.md');
    expect(hosts, 'the header must be named').toContain('x-cogmem-identity');
    expect(hosts, 'the unauthenticated rule must be stated').toMatch(/narrow.{0,80}(never|not).{0,40}widen/is);
    expect(hosts, 'the project mismatch error must be named').toContain('project_scope_violation');
    expect(hosts, 'the unknown profile error must be named').toContain('unknown_tool_profile');
  });

  test('SECURITY.md states the header is not authentication', () => {
    const security = read('SECURITY.md');
    expect(security, 'the header must be named').toContain('x-cogmem-identity');
    expect(security, 'the threat-side rule must be stated').toMatch(/not an authentication mechanism|not authentication/i);
    expect(security, 'widening must be bounded by the token').toMatch(/narrow.{0,60}(never|not).{0,30}widen/is);
  });
});
