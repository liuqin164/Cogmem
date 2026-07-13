const DIMENSION_WORDS = [
    ['actor', /^(who|谁|谁参与|actor|作者)$/iu],
    ['project', /^(project|项目|仓库|repo)$/iu],
    ['topic', /^(topic|主题|话题)$/iu],
    ['issue', /^(issue|问题|故障|bug)$/iu],
    ['event', /^(event|事件|发生|升级)$/iu],
    ['task', /^(task|任务|待办|方案)$/iu],
    ['entity', /^(entity|实体|对象)$/iu],
    ['location', /^(where|地点|位置)$/iu],
];
const FRAME_KEYS = {
    actor: 'actors', project: 'projects', topic: 'topics', issue: 'issues', event: 'events', task: 'tasks', entity: 'entities', location: 'locations',
};
export class MultidimensionalQueryPlanner {
    plan(query, now = Date.now()) {
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
        const time = this.timeRange(text, now);
        const frame = {
            schemaVersion: 'memory_query_frame.v1',
            intent,
            requireRawEvidence: intent === 'source_drilldown' || /原文|证据|哪段|source|evidence/iu.test(text),
            ...facets,
        };
        if (time)
            frame.time = time;
        return frame;
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
    timeRange(query, now) {
        const year = query.match(/\b(20\d{2})\b/u)?.[1];
        if (year) {
            const from = Date.UTC(Number(year), 0, 1);
            return { from, to: Date.UTC(Number(year) + 1, 0, 1), expressions: [year] };
        }
        if (/今天|today/iu.test(query)) {
            const start = new Date(now);
            start.setUTCHours(0, 0, 0, 0);
            return { from: start.getTime(), to: start.getTime() + 86400000, expressions: ['today'] };
        }
        return undefined;
    }
}
