import { createHash } from 'node:crypto';
export function createStableImportIdentityFactory(sourceAgent, sourceSessionId) {
    const occurrences = new Map();
    return (input) => {
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
