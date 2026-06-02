import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('SECURITY.md documents TOML governance settings instead of legacy PII env toggles', () => {
  const security = readFileSync(join(import.meta.dir, '..', 'SECURITY.md'), 'utf8');

  expect(security).toContain('config.toml');
  expect(security).toContain('[governance]');
  expect(security).toContain('pii_redact_email');
  expect(security).toContain('pii_redact_phone');
  expect(security).toContain('pii_redact_ssn');
  expect(security).not.toContain('COGMEM_PII_REDACT_EMAIL');
  expect(security).not.toContain('COGMEM_PII_REDACT_PHONE');
  expect(security).not.toContain('COGMEM_PII_REDACT_SSN');
});
