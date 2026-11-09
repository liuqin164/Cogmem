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

/**
 * English-context samples (#135): the same families, in the three shapes an English project actually produces —
 * a `.env` file, a request log and an error report. Detection is language-independent by design, so the point of
 * this list is to prove that the *contexts* do not hide a secret from it, and that English prose about secrets is
 * still not a secret.
 */
const ENGLISH_CONTEXT_POSITIVES: Array<[string, string, string]> = [
  ['openai_key', '.env file, env assignment', 'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwx'],
  ['aws_access_key', '.env file, key id on its own line', 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE'],
  ['credential_url', '.env file, connection string', 'DATABASE_URL=postgres://app:s3cr3tpassword@db.internal:5432/app'],
  ['bearer_token', 'request log line', 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'],
  ['github_token', 'error report line', 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwx'],
  ['jwt', 'request log line, session cookie', 'cookie: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'],
];

const ENGLISH_CONTEXT_NEGATIVES = [
  'In the incident review we discussed password rotation and agreed to revisit it next quarter.',
  'The handler calls token = getToken() and never logs the value.',
  'Set OPENAI_API_KEY=<your-key> in your shell before running the tool.',
  'The error message said "invalid credentials" and nothing else.',
  'Please read the section on secret handling before changing this file.',
  'DB_SECRET=${MY_SECRET_FROM_ENV}',
];

test('English contexts do not hide a secret from detection', () => {
  for (const [kind, where, text] of ENGLISH_CONTEXT_POSITIVES) {
    const found = countSecretFindings(text);
    expect({ where, kind, found: found.byKind[kind] ?? 0 }).toEqual({ where, kind, found: 1 });
  }
});

test('English prose about secrets is still not a secret', () => {
  for (const text of ENGLISH_CONTEXT_NEGATIVES) {
    expect({ text, total: countSecretFindings(text).total }).toEqual({ text, total: 0 });
  }
});

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
