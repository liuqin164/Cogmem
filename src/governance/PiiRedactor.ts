export interface PiiFinding {
  type: 'email' | 'phone' | 'ssn';
  value: string;
}

export interface RedactionPolicy {
  email?: boolean;
  phone?: boolean;
  ssn?: boolean;
}

export interface RedactionResult {
  text: string;
  findings: PiiFinding[];
}

/** What a reader can still tell about text that has been through redaction. */
export interface RedactionMarks {
  /** How many values were removed. */
  count: number;
  /** How many characters they occupied, counting only markers that recorded it. */
  chars: number;
}

/**
 * Read the marks a redacted text carries.
 *
 * The count is what makes an altered text identifiable at all — a reader who is handed
 * `BEACON-[REDACTED_PHONE]` and nothing else has to decide whether the value they are
 * reading is the value that was written, and the honest answer is "no, and here is how
 * much was taken out". Text redacted before the length was recorded still counts, and
 * contributes nothing to `chars` (#115).
 */
export function readRedactionMarks(text: string): RedactionMarks {
  // Both redactors write into the same text: this one writes `[REDACTED_PHONE:11]`, and
  // the deep-write redactor writes `Bearer [REDACTED]` and `[REDACTED_PRIVATE_KEY]`. A
  // reader does not care which of them ran, only that something was removed.
  const marks = String(text ?? '').match(/\[REDACTED(?:_[A-Z]+)*(?::\d+)?\]/g) ?? [];
  let chars = 0;
  for (const mark of marks) {
    const recorded = /:(\d+)\]$/.exec(mark);
    if (recorded) chars += Number(recorded[1]);
  }
  return { count: marks.length, chars };
}

export class PiiRedactor {
  constructor(private readonly policy: RedactionPolicy = {}) {}

  redact(input: string): RedactionResult {
    const enabled = {
      email: this.policy.email !== false,
      phone: this.policy.phone !== false,
      ssn: this.policy.ssn !== false,
    };
    let text = input;
    const findings: PiiFinding[] = [];

    if (enabled.email) {
      text = this.replace(text, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 'email', 'REDACTED_EMAIL', findings);
    }
    if (enabled.phone) {
      // Chinese mainland mobile: optional +86 prefix, 1[3-9]x xxxxxxxx
      text = this.replace(text, /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d[-\s]?\d{4}[-\s]?\d{4}(?!\d)/g, 'phone', 'REDACTED_PHONE', findings);
      // North-American NANP: +1 / 1 optional, (NXX) NXX-XXXX or NXX-NXX-XXXX
      // Note: N = 2-9, X = 0-9
      text = this.replace(text, /(?<!\d)(?:\+?1[-.\s]?)?\(?\b[2-9]\d{2}\)?[-.\s]?[2-9]\d{2}[-.\s]?\d{4}\b(?!\d)/g, 'phone', 'REDACTED_PHONE', findings);
      // International E.164 fallback: +CC followed by 6-14 digits (catches most other countries)
      text = this.replace(text, /\+(?!86\b|1\b)[1-9]\d{0,2}[-\s]?\d{4,14}(?!\d)/g, 'phone', 'REDACTED_PHONE', findings);
    }
    if (enabled.ssn) {
      text = this.replace(text, /\b\d{3}-\d{2}-\d{4}\b/g, 'ssn', 'REDACTED_SSN', findings);
    }

    return { text, findings };
  }

  private replace(
    input: string,
    pattern: RegExp,
    type: PiiFinding['type'],
    replacement: string,
    findings: PiiFinding[]
  ): string {
    return input.replace(pattern, (value) => {
      findings.push({ type, value });
      // The length belongs in the marker: it is what tells a reader that a value was
      // removed and how long it was, rather than leaving them to read a mangled
      // identifier as the real one (#115). `findings` still carries the value itself
      // for the callers that record what kind of data was found.
      return `[${replacement}:${value.length}]`;
    });
  }
}
