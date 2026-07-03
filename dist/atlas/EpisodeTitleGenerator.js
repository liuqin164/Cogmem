import { eventTextForMemory } from '../episode/CogmemBlockStripper.js';
const TITLE_RULES = [
    {
        id: 'memory_context_blackbox',
        test: (text) => /(cogmem memory context|memory context|sourcecontext|source context|原文下钻|上下文.*黑盒|记忆上下文|摘要.*原话|记忆黑盒)/i.test(text) &&
            !/(database locked|zombie|卡死|atlas|节点|事件名称|manual recall.*before_prompt_build|手动.*recall.*自动注入)/i.test(text),
        displayTitle: 'CogMem Memory Context 黑盒与原文下钻',
        oneLineSummary: '用户指出注入的 CogMem Memory Context 像黑盒，需要能从摘要下钻到原始对话。',
        topicHints: ['memory-blackbox', 'source-drilldown', 'context-injection'],
        issueHints: ['memory-context-blackbox'],
        eventKind: 'diagnostic',
        userIntent: 'inspect_original_context',
        confidence: 0.92,
    },
    {
        id: 'graph_runtime_blackbox',
        test: (text) => /(memory graph|graph.*卡死|卡死|database locked|sqlite.*lock|zombie|僵尸进程|锁冲突)/i.test(text),
        displayTitle: 'memory graph 卡死与数据库锁',
        oneLineSummary: '用户遇到 memory graph 卡死、SQLite 锁冲突或残留进程，导致图谱与召回命令不稳定。',
        topicHints: ['memory-blackbox', 'graph-runtime', 'sqlite-locks'],
        issueHints: ['graph-runtime-blackbox'],
        eventKind: 'bug',
        userIntent: 'debug_graph_runtime',
        confidence: 0.9,
    },
    {
        id: 'atlas_readability_blackbox',
        test: (text) => /(atlas|图谱|节点|事件名称|父主题|多维|facet|canonical|可读性|label|标题)/i.test(text),
        displayTitle: 'Atlas 节点命名与多维导航',
        oneLineSummary: '用户要求 Atlas 节点拥有清晰事件标题，并通过时间、主题、issue、实体等 facet 导航到同一份 canonical episode。',
        topicHints: ['memory-blackbox', 'atlas-readability', 'facet-navigation'],
        issueHints: ['atlas-readability'],
        eventKind: 'plan',
        userIntent: 'improve_atlas_navigation',
        confidence: 0.88,
    },
    {
        id: 'auto_injection_mismatch',
        test: (text) => /((manual recall|手动.*recall|CLI).*(自动注入|before_prompt_build|OpenClaw)|(自动注入|before_prompt_build|OpenClaw).*(manual recall|手动.*recall|CLI)|注入.*不一致|selected.*different|选择.*不同)/i.test(text),
        displayTitle: '自动注入与手动 recall 不一致',
        oneLineSummary: '用户发现 OpenClaw 自动注入与手动 recall 的记忆选择不一致，需要暴露选择依据和匹配 facet。',
        topicHints: ['context-injection', 'memory-blackbox', 'openclaw'],
        issueHints: ['auto-injection-mismatch'],
        eventKind: 'diagnostic',
        userIntent: 'align_auto_injection',
        confidence: 0.89,
    },
];
export class EpisodeTitleGenerator {
    generate(input) {
        const userEvents = input.events.filter((event) => event.role === 'user');
        const assistantEvents = input.events.filter((event) => event.role === 'assistant' || event.role === 'agent');
        const userText = normalizeText(userEvents.map(eventTextForMemory).join('\n'));
        const assistantText = normalizeText(assistantEvents.map(eventTextForMemory).join('\n'));
        const summaryText = normalizeText([input.summary, input.topicPath, input.episodeType].filter(Boolean).join('\n'));
        const preferredText = [userText, summaryText, assistantText].filter(Boolean).join('\n');
        const matchedRule = TITLE_RULES.find((rule) => rule.test(preferredText));
        const localDate = inferLocalDate(input.events, input.startedAt);
        const sourceEventIds = sourceIdsFor(userEvents.length > 0 ? userEvents : input.events);
        if (matchedRule) {
            return {
                displayTitle: boundTitle(matchedRule.displayTitle),
                oneLineSummary: matchedRule.oneLineSummary,
                topicHints: matchedRule.topicHints,
                issueHints: matchedRule.issueHints,
                eventKind: matchedRule.eventKind,
                userIntent: matchedRule.userIntent,
                localDate,
                confidence: matchedRule.confidence,
                reviewNeeded: matchedRule.confidence < 0.65,
                sourceEventIds,
                generatorTrace: {
                    usedUserText: userText.length > 0,
                    usedAssistantText: userText.length === 0 && assistantText.length > 0,
                    fallback: false,
                    matchedRules: [matchedRule.id],
                },
            };
        }
        const fallbackTitle = fallbackDisplayTitle({ userText, summaryText, topicPath: input.topicPath, episodeType: input.episodeType });
        return {
            displayTitle: fallbackTitle,
            oneLineSummary: fallbackSummary({ userText, summaryText, topicPath: input.topicPath }),
            topicHints: inferTopicHints(preferredText),
            issueHints: [],
            eventKind: normalizeKind(input.episodeType) ?? 'explanation',
            localDate,
            confidence: 0.55,
            reviewNeeded: true,
            sourceEventIds,
            generatorTrace: {
                usedUserText: userText.length > 0,
                usedAssistantText: userText.length === 0 && assistantText.length > 0,
                fallback: true,
                matchedRules: [],
            },
        };
    }
}
function normalizeText(text) {
    return text.replace(/\s+/g, ' ').trim();
}
function sourceIdsFor(events) {
    return events.map((event) => event.eventId).filter(Boolean).slice(0, 20);
}
function inferLocalDate(events, startedAt) {
    for (const event of events) {
        const candidate = event.localDate;
        if (candidate && /^\d{4}-\d{2}-\d{2}$/.test(candidate))
            return candidate;
    }
    const timestamp = events.find((event) => Number.isFinite(event.occurredAt))?.occurredAt ?? startedAt;
    if (!timestamp || !Number.isFinite(timestamp))
        return undefined;
    return new Date(timestamp).toISOString().slice(0, 10);
}
function boundTitle(title) {
    const clean = normalizeText(title).replace(/[0-9a-f]{8}-[0-9a-f-]{12,}/gi, '').trim();
    if (/[^\x00-\x7F]/.test(clean))
        return clean.length > 32 ? `${clean.slice(0, 31)}…` : clean;
    const words = clean.split(/\s+/);
    return words.length > 12 ? words.slice(0, 12).join(' ') : clean;
}
function fallbackDisplayTitle(input) {
    const source = input.userText || input.summaryText || input.topicPath || input.episodeType || 'Untitled episode';
    const firstSentence = source.split(/[。.!?\n]/).find(Boolean) ?? source;
    const title = boundTitle(firstSentence);
    if (!title || /^episode[:\s-]*[0-9a-f-]+$/i.test(title))
        return '未命名记忆事件';
    return title;
}
function fallbackSummary(input) {
    const source = input.summaryText || input.userText || input.topicPath || '该 episode 缺少可读摘要，需要人工复核。';
    const sentence = source.split(/[。.!?\n]/).find(Boolean) ?? source;
    return normalizeText(sentence).slice(0, 140);
}
function inferTopicHints(text) {
    const hints = new Set();
    if (/cogmem|记忆|memory/i.test(text))
        hints.add('memory');
    if (/openclaw/i.test(text))
        hints.add('openclaw');
    if (/hermes/i.test(text))
        hints.add('hermes');
    return Array.from(hints);
}
function normalizeKind(kind) {
    if (!kind)
        return undefined;
    const normalized = kind.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return normalized || undefined;
}
