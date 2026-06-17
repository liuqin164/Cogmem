export class MemoryBindingService {
    store;
    constructor(store) {
        this.store = store;
    }
    bindRawEvent(event) {
        const payload = event.payload;
        const text = typeof payload.text === 'string'
            ? payload.text
            : typeof payload.output === 'string'
                ? payload.output
                : typeof payload.title === 'string'
                    ? payload.title
                    : JSON.stringify(event.payload);
        return this.bindEvent({
            eventId: event.eventId,
            projectId: event.projectId,
            role: event.role,
            rawEventType: event.rawEventType,
            text,
            occurredAt: event.occurredAt,
        });
    }
    bindEvent(input) {
        if (input.role !== 'user')
            return [];
        if (input.rawEventType && input.rawEventType !== 'message')
            return [];
        const text = normalizeForBinding(input.text);
        if (!isHighValueText(text))
            return [];
        const decisions = classifyTopics(text);
        if (decisions.length === 0)
            return [];
        const createdAt = input.occurredAt ?? Date.now();
        const bindings = [];
        for (const decision of decisions) {
            const entity = decision.entityName
                ? this.store.upsertEntity({
                    projectId: input.projectId,
                    canonicalName: decision.entityName,
                    entityType: decision.entityType || 'concept',
                    aliases: decision.aliases,
                    stablePath: entityStablePath(decision.entityType || 'concept', decision.entityName),
                    now: createdAt,
                })
                : undefined;
            this.store.upsertTopic({
                projectId: input.projectId,
                topicPath: decision.topicPath,
                topicType: decision.topicType,
                summary: decision.summary,
                now: createdAt,
            });
            const binding = {
                eventId: input.eventId,
                projectId: input.projectId,
                role: input.role,
                rawEventType: input.rawEventType,
                entityId: entity?.entityId,
                entityName: entity?.canonicalName,
                entityType: entity?.entityType,
                topicPath: decision.topicPath,
                bindingType: decision.bindingType,
                confidence: decision.confidence,
                source: 'deterministic',
                signal: decision.signal,
                createdAt,
            };
            bindings.push(this.store.insertBinding(binding));
        }
        return bindings;
    }
}
function normalizeForBinding(text) {
    return String(text || '')
        .replace(/<COGMEM_RECALL_CONTEXT\b[\s\S]*?<\/COGMEM_RECALL_CONTEXT>/g, ' ')
        .replace(/<COGMEM_TURN_BRIDGE\b[\s\S]*?<\/COGMEM_TURN_BRIDGE>/g, ' ')
        .replace(/<COGMEM_SESSION_STATE\b[\s\S]*?<\/COGMEM_SESSION_STATE>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function isHighValueText(text) {
    const lowered = text.toLowerCase();
    if (text.length < 8)
        return false;
    if (/^(ok|okay|yes|no|thanks|thank you|continue|go on)$/i.test(text))
        return false;
    if (/^(好的|好|嗯|继续|谢谢|可以|收到|明白|是的|不是)$/.test(text))
        return false;
    return [
        'remember',
        'prefer',
        'must',
        'never',
        'boundary',
        'decision',
        'correct',
        'wrong',
        'problem',
        'cogmem',
        'openclaw',
        'memory',
        'pipeline',
        'local-first',
        '请记住',
        '以后',
        '不要',
        '必须',
        '边界',
        '决定',
        '纠正',
        '不对',
        '问题',
        '记忆',
        '写入',
        '存储',
        '分类',
        '关联',
        '项目',
    ].some((needle) => lowered.includes(needle.toLowerCase()));
}
function classifyTopics(text) {
    const lowered = text.toLowerCase();
    const decisions = [];
    const mentionsCogmem = lowered.includes('cogmem') || text.includes('记忆');
    const mentionsOpenClaw = lowered.includes('openclaw');
    if (mentionsCogmem && /写入|存储|表格|大脑|历史|关联|分类|绑定|write|storage|pipeline|brain|table|classif|binding/.test(lowered)) {
        decisions.push({
            topicPath: 'PROJECT/Cogmem/memory-write-pipeline',
            topicType: 'project',
            summary: 'Cogmem write-time memory association, classification, and raw-event binding.',
            bindingType: bindingTypeFor(text, 'diagnostic'),
            signal: 'memory_write_pipeline',
            confidence: 0.88,
            entityName: 'Cogmem',
            entityType: 'project',
            aliases: ['cogmem', 'memory kernel'],
        });
    }
    if (mentionsCogmem
        && /COGMEM_RECALL_CONTEXT|COGMEM_TURN_BRIDGE|COGMEM_SESSION_STATE|context hygiene|recall block|上下文|污染|长期记忆|清洗|注入/.test(text)) {
        decisions.push({
            topicPath: 'PROJECT/Cogmem/recall-context-hygiene',
            topicType: 'project',
            summary: 'Cogmem context hygiene boundaries for volatile recall, bridges, and session state.',
            bindingType: bindingTypeFor(text, 'boundary'),
            signal: 'context_hygiene',
            confidence: 0.86,
            entityName: 'Cogmem',
            entityType: 'project',
            aliases: ['cogmem', 'context hygiene'],
        });
    }
    if (mentionsOpenClaw || (mentionsCogmem && /openclaw/i.test(text))) {
        decisions.push({
            topicPath: 'PROJECT/Cogmem/openclaw-integration',
            topicType: 'project',
            summary: 'OpenClaw integration boundaries and agent memory behavior.',
            bindingType: bindingTypeFor(text, 'about'),
            signal: 'openclaw_integration',
            confidence: 0.8,
            entityName: 'OpenClaw',
            entityType: 'project',
            aliases: ['openclaw'],
        });
    }
    if (/local-first|本地优先|隐私|离线|privacy|offline/.test(lowered)) {
        decisions.push({
            topicPath: 'PERSON/user/durable-preferences',
            topicType: 'person',
            summary: 'Explicit durable user preferences, boundaries, and operating constraints.',
            bindingType: bindingTypeFor(text, 'preference'),
            signal: 'user_durable_preference',
            confidence: 0.78,
            entityName: 'user',
            entityType: 'person',
            aliases: ['用户'],
        });
    }
    return uniqueTopicDecisions(decisions);
}
function bindingTypeFor(text, fallback) {
    const lowered = text.toLowerCase();
    if (/不要|不能|禁止|边界|must not|never|forbid|boundary/.test(lowered))
        return 'boundary';
    if (/纠正|不对|错了|更正|correct|wrong/.test(lowered))
        return 'correction';
    if (/决定|方案|策略|decision|decide/.test(lowered))
        return 'decision';
    if (/请记住|以后|偏好|prefer|local-first|本地优先/.test(lowered))
        return 'preference';
    if (/目标|希望|goal|want/.test(lowered))
        return 'goal';
    if (/问题|风险|不像|表格|problem|risk|diagnos/.test(lowered))
        return 'diagnostic';
    return fallback;
}
function uniqueTopicDecisions(decisions) {
    const seen = new Set();
    return decisions.filter((decision) => {
        const key = `${decision.topicPath}:${decision.bindingType}:${decision.entityName || ''}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function entityStablePath(entityType, canonicalName) {
    if (entityType === 'project')
        return `PROJECT/${canonicalName}`;
    if (entityType === 'person')
        return `PERSON/${canonicalName}`;
    return `${entityType.toUpperCase()}/${canonicalName}`;
}
