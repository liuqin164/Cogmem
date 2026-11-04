import { SECRET_PATTERNS as SECRET_PATTERN_TABLE } from '../security/SecretPatterns.js';
export interface DeepWriteRedactionResult<T> {
  value: T;
  redactionCount: number;
}

export interface CustomRedactor {
  redact(input: unknown): { value: unknown; redactionCount: number };
}

// One table for the whole repository: the write-path detection in src/security/SecretPatterns.ts
// and the redaction here read the same definitions, so they cannot drift apart.
const SECRET_PATTERNS: Array<[RegExp, string]> = SECRET_PATTERN_TABLE.map(({ pattern, replacement }) => [pattern, replacement]);

function redactString(input: string): { value: string; count: number } {
  let value = input;
  let count = 0;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    value = value.replace(pattern, (match) => {
      count += 1;
      return typeof replacement === 'string' && replacement.includes('$1')
        ? match.replace(pattern, replacement)
        : replacement;
    });
  }
  return { value, count };
}

function redactValue(value: unknown): { value: unknown; count: number } {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) {
    let count = 0;
    const redacted = value.map((item) => {
      const result = redactValue(item);
      count += result.count;
      return result.value;
    });
    return { value: redacted, count };
  }
  if (value && typeof value === 'object') {
    let count = 0;
    const redacted: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const result = redactValue(child);
      count += result.count;
      redacted[key] = result.value;
    }
    return { value: redacted, count };
  }
  return { value, count: 0 };
}

export class DeepWriteRedactor {
  redact<T>(input: T): DeepWriteRedactionResult<T> {
    const result = redactValue(input);
    return {
      value: result.value as T,
      redactionCount: result.count
    };
  }
}
