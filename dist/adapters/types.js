import { createHash } from 'crypto';
import { basename } from 'node:path';
export function computeStableHash(parts) {
    const hash = createHash('sha256');
    for (const part of parts) {
        hash.update(String(part ?? ''));
        hash.update('\u241f');
    }
    return hash.digest('hex');
}
export function inferSourceTitle(sourcePath) {
    return basename(sourcePath).replace(/\.md$/i, '');
}
export function normalizeMarkdownText(text) {
    return text
        .replace(/\r\n/g, '\n')
        .replace(/\u00a0/g, ' ')
        .trim();
}
export function parseLooseTimestamp(raw, fallback) {
    if (!raw)
        return fallback;
    const direct = Date.parse(raw);
    if (!Number.isNaN(direct))
        return direct;
    const normalized = raw
        .trim()
        .replace(/\./g, '-')
        .replace(/\//g, '-')
        .replace(/\s+/g, ' ');
    const retry = Date.parse(normalized);
    if (!Number.isNaN(retry))
        return retry;
    return fallback;
}
const ROLE_ALIASES = {
    user: 'user',
    human: 'user',
    customer: 'user',
    client: 'user',
    q: 'user',
    question: 'user',
    agent: 'agent',
    assistant: 'agent',
    ai: 'agent',
    bot: 'agent',
    model: 'agent',
    a: 'agent',
    answer: 'agent',
    system: 'system',
    sys: 'system',
    narrator: 'narrator',
    note: 'narrator',
    notes: 'narrator',
    memo: 'narrator'
};
export function parseMarkdownRoleLine(line) {
    const trimmed = line.trim();
    if (!trimmed)
        return null;
    const patterns = [
        /^(?:[-*]|\d+\.)?\s*(?:\[(?<timestamp>[^\]]+)\]|\((?<timestampAlt>[^)]+)\)|(?<timestampLead>(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?(?:\s*[+-]\d{2}:?\d{2})?)?|\d{1,2}:\d{2}(?::\d{2})?)))?\s*(?<role>[A-Za-z][A-Za-z _-]{0,24})\s*[:：\-]\s*(?<text>.*)\s*$/i,
        /^(?<role>[A-Za-z][A-Za-z _-]{0,24})\s*(?:\[(?<timestamp>[^\]]+)\]|\((?<timestampAlt>[^)]+)\))?\s*[:：\-]\s*(?<text>.*)\s*$/i
    ];
    for (const pattern of patterns) {
        const match = trimmed.match(pattern);
        if (!match?.groups?.role || match.groups.text === undefined)
            continue;
        const rawRole = match.groups.role.trim().toLowerCase().replace(/\s+/g, ' ');
        const role = ROLE_ALIASES[rawRole] || ROLE_ALIASES[rawRole.replace(/\s+/g, '')];
        if (!role)
            continue;
        return {
            role,
            rawRole,
            text: match.groups.text.trim(),
            timestamp: match.groups.timestamp || match.groups.timestampAlt || match.groups.timestampLead
        };
    }
    return null;
}
export function parseLooseDateHeading(line) {
    const trimmed = line.trim();
    if (!trimmed)
        return null;
    if (/^(?:[-*]|\d+\.)\s/.test(trimmed))
        return null;
    const normalizedHeading = trimmed.replace(/^#{1,6}\s+/, '').trim();
    const direct = normalizedHeading.match(/^(?:day\s*\d+\s*[:：-]?\s*)?(?<date>\d{4}[-/.]\d{1,2}[-/.]\d{1,2})$/i);
    if (direct?.groups?.date)
        return direct.groups.date.replace(/[/.]/g, '-');
    const zh = normalizedHeading.match(/^(?<year>\d{4})年(?<month>\d{1,2})月(?<day>\d{1,2})日$/);
    if (!zh?.groups)
        return null;
    return [
        zh.groups.year,
        zh.groups.month.padStart(2, '0'),
        zh.groups.day.padStart(2, '0')
    ].join('-');
}
export function resolveTimestampWithContext(raw, fallback, currentDateHint) {
    if (!raw) {
        if (!currentDateHint)
            return fallback;
        return parseLooseTimestamp(`${currentDateHint}T00:00:00`, fallback);
    }
    const trimmed = raw.trim();
    if (currentDateHint) {
        const timeOnly = trimmed.match(/^(?<hour>\d{1,2}):(?<minute>\d{2})(?::(?<second>\d{2}))?$/);
        if (timeOnly?.groups) {
            const hh = timeOnly.groups.hour.padStart(2, '0');
            const mm = timeOnly.groups.minute;
            const ss = (timeOnly.groups.second || '00').padStart(2, '0');
            return parseLooseTimestamp(`${currentDateHint}T${hh}:${mm}:${ss}`, fallback);
        }
        const monthDay = trimmed.match(/^(?<month>\d{1,2})[-/.](?<day>\d{1,2})\s+(?<hour>\d{1,2}):(?<minute>\d{2})(?::(?<second>\d{2}))?$/);
        if (monthDay?.groups) {
            const year = currentDateHint.slice(0, 4);
            const month = monthDay.groups.month.padStart(2, '0');
            const day = monthDay.groups.day.padStart(2, '0');
            const hh = monthDay.groups.hour.padStart(2, '0');
            const mm = monthDay.groups.minute;
            const ss = (monthDay.groups.second || '00').padStart(2, '0');
            return parseLooseTimestamp(`${year}-${month}-${day}T${hh}:${mm}:${ss}`, fallback);
        }
    }
    return parseLooseTimestamp(trimmed, fallback);
}
export function buildEpisodeEnvelope(source, record) {
    const type = record.kind === 'raw_utterance' || record.kind === 'conversation_message' ? 'chat' : 'doc';
    const sourceRef = buildSourceRef(source, record);
    return {
        record,
        ingestInput: {
            content: record.text,
            projectId: source.projectId,
            filePath: source.sourcePath,
            type,
            createdAt: record.timestamp,
            updatedAt: record.timestamp,
            sourceType: record.sourceTypeHint,
            sourceRefs: [sourceRef],
            tags: Array.from(new Set([
                ...(source.tags || []),
                ...record.tags,
                `source:${record.provenance.sourceType}`,
                `reliability:${record.provenance.reliabilityClass}`,
                `role:${record.role || 'narrator'}`,
                `record:${record.kind}`
            ]))
        }
    };
}
function buildSourceRef(source, record) {
    const sourceOffset = numberField(record.metadata?.sourceOffset) ?? record.provenance.sourceOffset;
    const threadSeq = numberField(record.metadata?.threadSeq) ?? sourceOffset;
    return {
        sourceId: record.provenance.sourceId,
        sourcePath: record.provenance.sourcePath,
        sourceType: record.provenance.sourceType,
        recordId: record.recordId,
        contentHash: record.provenance.recordHash,
        threadId: stringField(record.metadata?.threadId) ?? stringField(source.metadata?.threadId) ?? source.sourceId,
        sessionId: stringField(record.metadata?.sessionId) ?? stringField(source.metadata?.sessionId),
        turnId: record.turnId,
        role: record.role === 'agent' ? 'assistant' : record.role,
        threadSeq,
        turnSeq: numberField(record.metadata?.turnSeq) ?? numberField(record.metadata?.turnIndex),
        eventOrdinal: numberField(record.metadata?.eventOrdinal),
        sourceOffset,
        lineStart: numberField(record.metadata?.lineStart) ?? numberField(record.metadata?.lineNumber) ?? record.provenance.lineStart,
        lineEnd: numberField(record.metadata?.lineEnd) ?? numberField(record.metadata?.lineNumber) ?? record.provenance.lineEnd,
        charStart: numberField(record.metadata?.charStart) ?? record.provenance.charStart,
        charEnd: numberField(record.metadata?.charEnd) ?? record.provenance.charEnd,
        orderingConfidence: (stringField(record.metadata?.orderingConfidence)
            ?? record.provenance.orderingConfidence
            ?? 'low'),
    };
}
function numberField(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function stringField(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
