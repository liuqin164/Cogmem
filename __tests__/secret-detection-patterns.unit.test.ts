import { expect, test } from 'bun:test';
import { countSecretFindings } from '../src/security/SecretPatterns.js';

/** One per new family, plus the five that already existed. Detection only — nothing is rewritten. */
const POSITIVES: Array<[string, string]> = [
  ['bearer_token', 'Authorization: Bearer abcdefghijklmnopqrst'],
  ['openai_key', 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwx'],
  ['aws_access_key', 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE'.replace('EXAMPLE', 'EXAMPLX')],
  ['github_token', 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwx'],
  ['jwt', 'cookie: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'],
  ['credential_url', 'DATABASE_URL=postgres://app:s3cr3tpassword@db.internal:5432/app'],
  ['assigned_secret', 'AWS_SECRET=abcdefghijklmnopqrst'],
  ['assigned_password', 'password = hunter2hunter2hunter2'],
  ['assigned_api_key', 'API_KEY="abcdefghijklmnopqrst"'],
  ['private_key_block', '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----'],
];
/** The negative list from the ticket: discussion, a call, a placeholder, a lone word, a reference. */
const NEGATIVES = [
  '这一节讨论密码轮换策略：password 应当定期更换，并记录在运维手册里。',
  'token = getToken()',
  'API_KEY=<your-key>',
  'password: xxx',
  '把 password 这个词写进词汇表。',
  'DB_SECRET=${MY_SECRET}',
  'EXPORT_KEY=placeholder',
];

test('every secret family the ledger must notice is detected, by name', () => {
  for (const [kind, text] of POSITIVES) {
    const found = countSecretFindings(text);
    expect({ kind, detected: (found.byKind[kind] ?? 0) > 0 }).toEqual({ kind, detected: true });
  }
});

test('prose and placeholders are not counted: an inflated count is worse than a miss', () => {
  for (const text of NEGATIVES) {
    expect({ text, total: countSecretFindings(text).total }).toEqual({ text, total: 0 });
  }
});

test('a tool result shaped like a .env file reports one finding per secret it holds', () => {
  const dotenv = ['# service config', 'APP_NAME=reports', 'API_KEY=abcdefghijklmnopqrst', 'DB_PASSWORD=correcthorsebattery'].join('\n');
  const found = countSecretFindings(dotenv);
  expect(found.total).toBeGreaterThanOrEqual(2);
  expect(Object.keys(found.byKind).sort()).toEqual(['assigned_api_key', 'assigned_secret']);
});
