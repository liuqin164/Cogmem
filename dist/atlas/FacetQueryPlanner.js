const ISSUE_RULES = [
    {
        value: 'memory-context-blackbox',
        label: 'Memory Context 黑盒',
        test: (text) => /(memory context|sourcecontext|source context|上下文.*黑盒|记忆上下文|原文下钻|摘要.*原话)/i.test(text),
    },
    {
        value: 'graph-runtime-blackbox',
        label: 'Graph Runtime 黑盒',
        test: (text) => /(memory graph|graph.*卡死|database locked|sqlite.*lock|zombie|僵尸进程|锁冲突|卡死)/i.test(text),
    },
    {
        value: 'atlas-readability',
        label: 'Atlas 可读性黑盒',
        test: (text) => /(atlas|图谱|节点|事件名称|父主题|多维|facet|canonical|可读性|标题)/i.test(text),
    },
    {
        value: 'auto-injection-mismatch',
        label: '自动注入不一致',
        test: (text) => /(自动注入|before_prompt_build|manual recall|手动.*recall|注入.*不一致|COGMEM_RECALL_CONTEXT)/i.test(text),
    },
];
const TOPIC_RULES = [
    {
        value: 'memory-blackbox',
        label: '记忆黑盒',
        test: (text) => /(记忆黑盒|memory.*blackbox|memory context|sourcecontext|graph.*卡死|atlas|自动注入|上下文.*黑盒)/i.test(text),
    },
    {
        value: 'source-drilldown',
        label: '原文下钻',
        test: (text) => /(sourcecontext|source context|原文下钻|原话|摘要.*原文)/i.test(text),
    },
    {
        value: 'context-injection',
        label: '上下文注入',
        test: (text) => /(自动注入|context injection|before_prompt_build|COGMEM_RECALL_CONTEXT|注入)/i.test(text),
    },
];
export class FacetQueryPlanner {
    plan(query, options) {
        const normalized = query.trim();
        const facets = [];
        const timeFacet = parseTimeFacet(normalized, options.now ?? Date.now());
        if (timeFacet)
            facets.push(withNodeId(timeFacet, options.projectId));
        const timeline = /(后来|继续|timeline|演化|发展|之后)/i.test(normalized);
        const matchedIssueValues = new Set();
        for (const rule of TOPIC_RULES) {
            if (rule.test(normalized)) {
                facets.push(withNodeId({ type: 'topic', value: `PROJECT/${options.projectId}/${rule.value}`, label: rule.label, relation: 'ABOUT_TOPIC' }, options.projectId));
            }
        }
        for (const rule of ISSUE_RULES) {
            if (rule.test(normalized)) {
                facets.push(withNodeId({ type: 'issue', value: rule.value, label: rule.label, relation: 'PART_OF_ISSUE' }, options.projectId));
                matchedIssueValues.add(rule.value);
            }
        }
        if (!timeline && isBroadMemoryBlackbox(normalized) && matchedIssueValues.size === 0) {
            facets.push(withNodeId({ type: 'issue', value: 'memory-context-blackbox', label: 'Memory Context 黑盒', relation: 'PART_OF_ISSUE' }, options.projectId));
        }
        for (const entity of ['Cogmem', 'OpenClaw', 'Hermes']) {
            if (new RegExp(entity, 'i').test(normalized)) {
                facets.push({ type: 'entity', value: `facet:${entity.toLowerCase()}`, label: entity, nodeId: `entity:facet:${entity.toLowerCase()}`, relation: 'INVOLVES_ENTITY' });
            }
        }
        for (const facet of parseKindFacets(normalized, options.projectId))
            facets.push(facet);
        return {
            intent: /聊过|记得|还记得|讨论|原话|那次/i.test(normalized) ? 'historical_discussion' : 'graph_search',
            operator: 'intersection',
            facets: dedupeFacets(facets),
            temporalIntent: timeline ? 'timeline' : undefined,
            groupBy: timeline ? 'time' : timeFacet && facets.length === 1 ? 'topic' : facets.some((facet) => facet.type === 'issue') ? 'issue' : undefined,
            exactness: 'strict',
            requiresIntersection: facets.length > 1,
            keywords: extractKeywords(normalized),
            query: normalized,
        };
    }
}
function isBroadMemoryBlackbox(query) {
    return /(记忆黑盒|memory.*blackbox)/i.test(query) &&
        !/(memory graph|graph|database locked|sqlite|zombie|僵尸|卡死|atlas|图谱|节点|事件名称|自动注入|before_prompt_build|manual recall|手动.*recall)/i.test(query);
}
function parseKindFacets(query, projectId) {
    const facets = [];
    const memoryKindRules = [
        ['bug', /(bug|问题|卡死|failure|故障|错误|报错)/i],
        ['decision', /(decision|决定|方案|结论)/i],
        ['plan', /(计划|下一步|策略|plan)/i],
    ];
    const actionKindRules = [
        ['implemented', /(修复|实现|implemented|合并|发布|升级)/i],
        ['reviewed', /(检查|审查|review)/i],
        ['debugged', /(debug|排查|卡死|locked|zombie)/i],
    ];
    for (const [value, test] of memoryKindRules) {
        if (test.test(query))
            facets.push(withNodeId({ type: 'memoryKind', value, label: value, relation: 'HAS_MEMORY_KIND' }, projectId));
    }
    for (const [value, test] of actionKindRules) {
        if (test.test(query))
            facets.push(withNodeId({ type: 'actionKind', value, label: value, relation: 'HAS_ACTION_KIND' }, projectId));
    }
    return facets;
}
function parseTimeFacet(query, now) {
    const currentYear = new Date(now).getUTCFullYear();
    const isoDay = query.match(/(20\d{2})[-年\/.](\d{1,2})[-月\/.](\d{1,2})日?/);
    if (isoDay)
        return dayFacet(Number(isoDay[1]), Number(isoDay[2]), Number(isoDay[3]));
    const cnDay = query.match(/(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})(?:号|日)?/);
    if (cnDay)
        return dayFacet(cnDay[1] ? Number(cnDay[1]) : currentYear, Number(cnDay[2]), Number(cnDay[3]));
    const isoMonth = query.match(/(20\d{2})[-年\/.](\d{1,2})月?/);
    if (isoMonth)
        return monthFacet(Number(isoMonth[1]), Number(isoMonth[2]));
    const year = query.match(/\b(20\d{2})\b|((20\d{2})年)/);
    if (year)
        return yearFacet(Number(year[1] ?? year[3]));
    if (/去年/.test(query))
        return yearFacet(currentYear - 1);
    return undefined;
}
function dayFacet(year, month, day) {
    const label = `${year}-${pad(month)}-${pad(day)}`;
    return {
        type: 'time',
        value: label,
        label,
        relation: 'OCCURRED_ON',
        granularity: 'day',
        from: Date.UTC(year, month - 1, day),
        to: Date.UTC(year, month - 1, day + 1),
    };
}
function monthFacet(year, month) {
    const label = `${year}-${pad(month)}`;
    return {
        type: 'time',
        value: label,
        label,
        relation: 'OCCURRED_IN',
        granularity: 'month',
        from: Date.UTC(year, month - 1, 1),
        to: Date.UTC(year, month, 1),
    };
}
function yearFacet(year) {
    const label = String(year);
    return {
        type: 'time',
        value: label,
        label,
        relation: 'OCCURRED_IN',
        granularity: 'year',
        from: Date.UTC(year, 0, 1),
        to: Date.UTC(year + 1, 0, 1),
    };
}
function withNodeId(facet, projectId) {
    return {
        ...facet,
        nodeId: `${facet.type}:${projectId}:${facet.value}`,
    };
}
function dedupeFacets(facets) {
    const seen = new Set();
    return facets.filter((facet) => {
        const key = `${facet.type}:${facet.value}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function extractKeywords(query) {
    return query
        .split(/[^\p{L}\p{N}_-]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
        .slice(0, 8);
}
function pad(value) {
    return String(value).padStart(2, '0');
}
