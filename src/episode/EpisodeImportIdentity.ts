import { createHash } from 'node:crypto';

export interface StableImportIdentityInput {
  role: string;
  text: string;
  timestamp?: number;
}

export function createStableImportIdentityFactory(sourceAgent: string, sourceSessionId: string) {
  const occurrences = new Map<string, number>();
  return (input: StableImportIdentityInput): string => {
    const normalizedText = String(input.text || '').replace(/\s+/g, ' ').trim();
    const base = createHash('sha256').update(JSON.stringify([
      sourceAgent,
      sourceSessionId,
      input.role,
      input.timestamp ?? null,
      createHash('sha256').update(normalizedText).digest('hex'),
    ])).digest('hex');
    const occurrence = (occurrences.get(base) || 0) + 1;
    occurrences.set(base, occurrence);
    return `import-${base}${occurrence > 1 ? `-${occurrence}` : ''}`;
  };
}
