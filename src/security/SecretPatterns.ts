/**
 * The one secret pattern table. `DeepWriteRedactor` consumes it, and the write-path detection counts
 * with it, so the two can never drift into disagreeing about what a secret is.
 *
 * Thresholds are deliberately strict. The counts this feeds are meant to be trusted, so a pattern
 * misses rather than inflates: a placeholder (`xxx`, `<your-key>`, `${VAR}`) and a variable reference
 * (`token = getToken()`) are not findings, and neither is the word "password" on its own.
 */
export interface SecretPattern {
  /** What this pattern is looking for, named for the operator reading the count. */
  kind: string;
  pattern: RegExp;
  /** Replacement used by the redaction path. */
  replacement: string;
}

const PLACEHOLDER = String.raw`(?!x{3,}|X{3,}|<[^>]*>|\$\{[^}]*\}|%[A-Z_]+%|\.\.\.|REDACTED|CHANGEME|change-me|your[-_]?key|placeholder|example|dummy|test)`;
/** A literal worth calling a secret: enough length and no whitespace or quoting artifacts. */
const LITERAL = String.raw`["']?${PLACEHOLDER}(?![A-Za-z0-9_]*\(\))[A-Za-z0-9_./+=:@-]{12,}`;

export const SECRET_PATTERNS: SecretPattern[] = [
  { kind: 'bearer_token', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/g, replacement: 'Bearer [REDACTED]' },
  { kind: 'openai_key', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replacement: 'sk-[REDACTED]' },
  {
    kind: 'aws_access_key',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replacement: 'AKIA[REDACTED]',
  },
  {
    kind: 'github_token',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
    replacement: 'ghp_[REDACTED]',
  },
  {
    kind: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: '[REDACTED_JWT]',
  },
  {
    kind: 'credential_url',
    // A scheme carrying credentials: user:pass@ in the authority, password part long enough to be one.
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|rediss):\/\/[^\s:@/]+:[^\s:@/]{6,}@[^\s/]+/gi,
    replacement: '[REDACTED_CREDENTIAL_URL]',
  },
  {
    kind: 'assigned_api_key',
    pattern: new RegExp(String.raw`\b[A-Za-z0-9_]*API[_-]?KEY[A-Za-z0-9_]*\s*[:=]\s*${LITERAL}`, 'gi'),
    replacement: 'API_KEY=[REDACTED]',
  },
  {
    kind: 'assigned_password',
    pattern: new RegExp(String.raw`\b(password|passwd|pwd)\s*[:=]\s*${LITERAL}`, 'gi'),
    replacement: '$1=[REDACTED]',
  },
  {
    kind: 'assigned_secret',
    // Keys ending in _SECRET / _TOKEN / _PASSWORD / _KEY, assigned a literal.
    pattern: new RegExp(String.raw`\b[A-Za-z0-9_]*(?:_SECRET|_TOKEN|_PASSWORD|_KEY)\s*[:=]\s*${LITERAL}`, 'gi'),
    replacement: '[REDACTED]',
  },
  {
    kind: 'private_key_block',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
];

/**
 * How many secrets this text appears to hold, by kind. Detection only: nothing is rewritten.
 *
 * `lastIndex` is reset per pattern because every pattern is /g and these RegExps are shared.
 */
export function countSecretFindings(text: string): { total: number; byKind: Record<string, number> } {
  const byKind: Record<string, number> = {};
  let total = 0;
  if (!text) return { total, byKind };
  for (const { kind, pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      byKind[kind] = matches.length;
      total += matches.length;
    }
  }
  return { total, byKind };
}

/**
 * Replace the secrets in a text with their redacted forms, and say how much was replaced.
 *
 * Same table and same replacement bodies as the compile-path redactor, so a value redacted here and a
 * value redacted there come out identical. Everything that is not a match is returned untouched.
 */
export function redactSecretText(text: string): { text: string; count: number; chars: number } {
  let value = text;
  let count = 0;
  let chars = 0;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    value = value.replace(pattern, (match) => {
      count += 1;
      chars += match.length;
      return replacement.includes('$1') ? match.replace(pattern, replacement) : replacement;
    });
  }
  return { text: value, count, chars };
}
