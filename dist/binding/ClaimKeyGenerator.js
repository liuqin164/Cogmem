const CLAIM_PATTERNS = [
    { key: 'missing-historical-binding', pattern: /不看历史|没有历史关联|旧记忆|historical bind|old memor|孤立|表格/i },
    { key: 'classification-drift', pattern: /分类树.*漂移|分类.*漂移|topic.*drift|classification.*drift/i },
    { key: 'context-pollution-boundary', pattern: /上下文.*污染|context.*pollution|recall_context|turn_bridge|session_state/i },
    { key: 'source-fidelity', pattern: /原文|source.*fidel|sourcecontext|source locator/i },
];
export class ClaimKeyGenerator {
    generate(text, fallback) {
        const matched = CLAIM_PATTERNS.find((entry) => entry.pattern.test(String(text || '')));
        if (matched)
            return matched.key;
        return slug(fallback) || 'general';
    }
}
function slug(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
