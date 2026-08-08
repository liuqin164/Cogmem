import { localDateFor, localDateRange, nextCivilDate, resolveTimeZone } from '../utils/LocalDateContext.js';
const DIMENSION_WORDS = [
    ['actor', /^(who|谁|谁参与(?:了)?|actor|作者)$/iu],
    ['project', /^(project|项目|仓库|repo)$/iu],
    ['topic', /^(topic|主题|话题)$/iu],
    ['issue', /^(issue|问题|故障|bug)$/iu],
    ['event', /^(event|事件|发生|升级)$/iu],
    ['task', /^(task|任务|待办|方案)$/iu],
    ['entity', /^(entity|实体|对象)$/iu],
    ['location', /^(where|地点|位置)$/iu],
];
const FRAME_KEYS = {
    actor: 'actors', project: 'projects', topic: 'topics', issue: 'issues', event: 'events', task: 'tasks', entity: 'entities', object: 'objects', location: 'locations',
};
export class MultidimensionalQueryPlanner {
    plan(query, context = {}) {
        const options = typeof context === 'number' ? { now: context } : context;
        const text = query.trim();
        const tokens = text.match(/[\p{L}\p{N}_-]+/gu)?.filter((token) => token.length > 1).slice(0, 24) ?? [];
        const facets = {};
        for (const token of tokens) {
            const dimension = DIMENSION_WORDS.find(([, pattern]) => pattern.test(token))?.[0];
            const key = dimension ? FRAME_KEYS[dimension] : undefined;
            if (key)
                (facets[key] ??= []).push({ label: token, dimension, confidence: 0.7 });
        }
        const intent = this.intent(text);
        const time = this.timeRange(text, options);
        const states = this.states(text);
        const frame = {
            schemaVersion: 'memory_query_frame.v1',
            intent,
            requireRawEvidence: intent === 'source_drilldown' || /原文|证据|哪段|source|evidence/iu.test(text),
            ...facets,
        };
        if (time)
            frame.time = time;
        if (states.length)
            frame.states = states;
        return frame;
    }
    states(query) {
        const values = new Set();
        const patterns = [
            ['completed', /完成|已解决|done|completed|resolved|完了/iu],
            ['in_progress', /进行中|处理中|进展|in[ -]?progress|working/iu],
            ['blocked', /阻塞|卡住|blocked|stuck/iu],
            ['planned', /计划|规划|planned|planning/iu],
        ];
        for (const [state, pattern] of patterns)
            if (pattern.test(query))
                values.add(state);
        return [...values];
    }
    intent(query) {
        if (/哪段|原文|证据|drill|source/iu.test(query))
            return 'source_drilldown';
        if (/什么时候|何时|when|timeline|时间|\b20\d{2}\b/iu.test(query))
            return 'historical_summary';
        if (/为什么|原因|because|cause|blocked|阻塞/iu.test(query))
            return 'causal_explanation';
        if (/状态|进度|完成|status|current/iu.test(query))
            return 'status_check';
        if (/之前|继续|follow|上下文|continu/iu.test(query))
            return 'continuity';
        if (/偏好|喜欢|preference/iu.test(query))
            return 'preference_recall';
        return 'exact_lookup';
    }
    timeRange(query, options) {
        const now = options.now ?? Date.now();
        const month = query.match(/(?:20\d{2}[年/-]?)?(\d{1,2})月|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/iu);
        if (month) {
            const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
            const raw = month[1] ?? month[0].slice(0, 3).toLocaleLowerCase('en');
            const monthIndex = month[1] ? Number(raw) - 1 : monthNames.indexOf(raw);
            if (monthIndex >= 0 && monthIndex < 12) {
                const yearValue = Number(query.match(/\b(20\d{2})\b/u)?.[1] ?? localYear(options));
                const [endYear, endMonth] = monthIndex === 11 ? [yearValue + 1, 1] : [yearValue, monthIndex + 2];
                const range = localDateRange(yearValue, monthIndex + 1, 1, endYear, endMonth, 1, options.timeZone);
                return { ...range, expressions: [month[0]] };
            }
        }
        const year = query.match(/\b(20\d{2})\b/u)?.[1];
        if (year) {
            const range = localDateRange(Number(year), 1, 1, Number(year) + 1, 1, 1, options.timeZone);
            return { ...range, expressions: [year] };
        }
        if (/今天|today/iu.test(query)) {
            const date = options.localDateNow ?? localDateFor(now, options.timeZone);
            const [year, monthValue, day] = date.split('-').map(Number);
            const next = nextCivilDate(year, monthValue, day, 1, options.timeZone);
            return { ...localDateRange(year, monthValue, day, ...next, options.timeZone), expressions: ['today'] };
        }
        return undefined;
    }
}
function localYear(options) {
    const explicit = options.localDateNow?.match(/^(20\d{2})-/u)?.[1];
    if (explicit)
        return Number(explicit);
    return Number(localDateFor(options.now ?? Date.now(), resolveTimeZone(options.timeZone)).slice(0, 4));
}
