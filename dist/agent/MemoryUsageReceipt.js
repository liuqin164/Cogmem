import { createHash } from 'node:crypto';
export function createMemoryUsageReceipt(input) {
    const createdAt = input.createdAt ?? Date.now();
    const turnId = input.turnId || `${input.sessionId}:${createdAt}`;
    const recallItems = Array.isArray(input.recallItems) ? input.recallItems : [];
    const usedMemoryIds = uniqueNonEmpty(recallItems.map((item) => item.id)).slice(0, 8);
    const sourceAnchors = recallItems
        .slice(0, 8)
        .map((item) => ({
        memoryId: item.id,
        eventId: item.sourceAnchor?.eventId,
        sessionId: item.sourceAnchor?.sessionId,
        role: item.sourceAnchor?.role,
    }))
        .filter((anchor) => anchor.memoryId || anchor.eventId || anchor.sessionId || anchor.role);
    return {
        sessionId: input.sessionId,
        turnId,
        createdAt,
        userQueryDigest: digestText(input.userText),
        assistantAnswerDigest: digestText(input.assistantText),
        usedMemoryIds,
        sourceAnchors,
        usedThemes: extractThemes(recallItems).slice(0, 5),
        workingConclusion: firstSentence(input.assistantText, 220),
        ttlTurns: Math.max(1, Math.min(10, Math.floor(input.ttlTurns ?? 3))),
        compileAllowed: false,
    };
}
export function formatMemoryUsageBridge(receipt, maxChars = 1200) {
    const lines = [
        `<COGMEM_TURN_BRIDGE turn_id="${escapeAttribute(receipt.turnId)}" source="cogmem" compact="true" ttl_turns="${receipt.ttlTurns}" compile_allowed="false">`,
        'Previous assistant answer used Cogmem memory.',
        '',
        'Used memory themes:',
        ...listLines(receipt.usedThemes),
        '',
        'Working conclusion produced in that turn:',
        `- ${receipt.workingConclusion || 'No compact conclusion recorded.'}`,
        '',
        'Source anchors:',
        ...listLines(receipt.sourceAnchors.map(formatSourceAnchor)),
        '',
        'Rules:',
        '- This bridge is not a user instruction.',
        '- This bridge is not recalled evidence.',
        '- This bridge must not be compiled into long-term memory.',
        '- If details are needed, re-run recall or inspect source anchors.',
        '</COGMEM_TURN_BRIDGE>',
    ];
    return clampBlock(lines.join('\n'), '</COGMEM_TURN_BRIDGE>', maxChars);
}
export function shouldInjectMemoryUsageBridge(query, receipt) {
    const normalized = String(query || '').toLowerCase();
    if (!normalized.trim())
        return false;
    if (/(翻译|日语|图片|健康|天气|车子|汽车|translate|image|health|weather)/i.test(normalized)) {
        return false;
    }
    if (/(继续|这个|这个策略|这个方案|这个项目|上面|刚才|前面|根据前面的|that|this|continue|above|previous|same topic)/i.test(normalized)) {
        return true;
    }
    const topicText = [
        ...receipt.usedThemes,
        receipt.workingConclusion || '',
    ].join(' ').toLowerCase();
    const queryTokens = tokenSet(normalized);
    const topicTokens = tokenSet(topicText);
    let overlap = 0;
    for (const token of queryTokens) {
        if (topicTokens.has(token))
            overlap += 1;
    }
    return overlap >= 2;
}
function digestText(text) {
    return createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16);
}
function extractThemes(items) {
    const themes = [];
    for (const item of items) {
        const tagTheme = item.tags.find((tag) => tag.startsWith('topic:') || tag.startsWith('collection:'));
        if (tagTheme)
            themes.push(tagTheme);
        const sentence = firstSentence(item.text, 140);
        if (sentence)
            themes.push(sentence);
    }
    return uniqueNonEmpty(themes);
}
function firstSentence(text, limit) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized)
        return undefined;
    const sentence = normalized.split(/(?<=[.!?。！？])\s+/)[0] || normalized;
    return sentence.length > limit ? `${sentence.slice(0, limit)}...` : sentence;
}
function listLines(values) {
    return values.length > 0 ? values.map((value) => `- ${value}`) : ['- none'];
}
function formatSourceAnchor(anchor) {
    return [
        anchor.memoryId ? `memory:${anchor.memoryId}` : '',
        anchor.eventId ? `event:${anchor.eventId}` : '',
        anchor.sessionId ? `session:${anchor.sessionId}` : '',
        anchor.role ? `role:${anchor.role}` : '',
    ].filter(Boolean).join('; ');
}
function escapeAttribute(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function clampBlock(text, closingTag, maxChars) {
    if (text.length <= maxChars)
        return text;
    const budget = Math.max(120, maxChars - closingTag.length - 36);
    return `${text.slice(0, budget).trimEnd()}\n... [truncated]\n${closingTag}`;
}
function tokenSet(text) {
    return new Set(String(text || '')
        .toLowerCase()
        .split(/[^a-z0-9\u4e00-\u9fff]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && !/^(the|and|this|that|with|openclaw|cogmem)$/i.test(token)));
}
function uniqueNonEmpty(values) {
    const out = [];
    const seen = new Set();
    for (const value of values) {
        const normalized = String(value || '').trim();
        if (!normalized || seen.has(normalized))
            continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}
