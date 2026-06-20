import { ClaimKeyGenerator } from './ClaimKeyGenerator.js';
import { TopicPathRegistry } from './TopicPathRegistry.js';
const TOPIC_PATH_REGISTRY = new TopicPathRegistry();
const CLAIM_KEY_GENERATOR = new ClaimKeyGenerator();
const PROJECT_ALIASES = [
    { canonical: 'Cogmem', aliases: ['cogmem', 'memory kernel', '记忆内核', 'agent brain'] },
    { canonical: 'OpenClaw', aliases: ['openclaw', 'lobster'] },
    { canonical: 'Hermes', aliases: ['hermes'] },
];
const GENERIC_PROJECT_RE = /([A-Z][A-Za-z0-9_-]{2,})(?:\s*(?:项目|工程|仓库|插件|应用|工具|project|repo|repository|app|plugin|tool))/;
export class BindingClassifier {
    classify(text) {
        const normalized = normalizeForBinding(text);
        if (!isHighValueText(normalized))
            return [];
        const projects = detectProjects(normalized);
        const lowered = normalized.toLowerCase();
        const decisions = [];
        for (const project of projects) {
            const projectLower = project.canonical.toLowerCase();
            if (project.canonical === 'Cogmem' && hasMemoryWritePipelineCue(lowered)) {
                decisions.push(projectDecision({
                    project,
                    suffix: 'memory-write-pipeline',
                    summary: 'Cogmem write-time memory association, classification, and raw-event binding.',
                    bindingType: bindingTypeFor(normalized, 'diagnostic'),
                    signal: signalForClaim(normalized, 'memory_write_pipeline'),
                    claimKey: claimKeyFor(normalized, 'memory-write-pipeline'),
                    confidence: 0.88,
                }));
            }
            if (project.canonical === 'Cogmem' && hasContextHygieneCue(normalized)) {
                decisions.push(projectDecision({
                    project,
                    suffix: 'recall-context-hygiene',
                    summary: 'Cogmem context hygiene boundaries for volatile recall, bridges, and session state.',
                    bindingType: bindingTypeFor(normalized, 'boundary'),
                    signal: signalForClaim(normalized, 'context_hygiene'),
                    claimKey: claimKeyFor(normalized, 'context-hygiene'),
                    confidence: 0.86,
                }));
            }
            if (project.canonical === 'OpenClaw' || lowered.includes('openclaw')) {
                decisions.push(projectDecision({
                    project,
                    suffix: 'integration',
                    summary: `${project.canonical} integration boundaries and agent memory behavior.`,
                    bindingType: bindingTypeFor(normalized, 'about'),
                    signal: 'project_integration',
                    claimKey: claimKeyFor(normalized, 'integration'),
                    confidence: 0.8,
                }));
            }
            const genericTopic = genericProjectTopic(normalized, project.canonical);
            if (genericTopic) {
                decisions.push(projectDecision({
                    project,
                    suffix: genericTopic.suffix,
                    summary: genericTopic.summary,
                    bindingType: bindingTypeFor(normalized, genericTopic.bindingType),
                    signal: genericTopic.signal,
                    claimKey: claimKeyFor(normalized, genericTopic.suffix),
                    confidence: genericTopic.confidence,
                }));
            }
            if (projectLower === 'cogmem' && hasOpenClawCue(lowered)) {
                decisions.push(projectDecision({
                    project: { canonical: 'OpenClaw', aliases: ['openclaw'] },
                    suffix: 'integration',
                    summary: 'OpenClaw integration boundaries and agent memory behavior.',
                    bindingType: bindingTypeFor(normalized, 'about'),
                    signal: 'project_integration',
                    claimKey: claimKeyFor(normalized, 'integration'),
                    confidence: 0.8,
                }));
            }
        }
        if (/local-first|本地优先|隐私|离线|privacy|offline/.test(lowered)) {
            decisions.push({
                topicPath: 'PERSON/user/durable-preferences',
                topicType: 'person',
                summary: 'Explicit durable user preferences, boundaries, and operating constraints.',
                bindingType: bindingTypeFor(normalized, 'preference'),
                signal: 'user_durable_preference',
                claimKey: claimKeyFor(normalized, 'durable-preferences'),
                confidence: 0.78,
                entityName: 'user',
                entityType: 'person',
                aliases: ['用户'],
            });
        }
        return uniqueTopicDecisions(decisions);
    }
    isBindableText(text) {
        return this.classify(text).length > 0;
    }
}
export function normalizeForBinding(text) {
    return String(text || '')
        .replace(/<COGMEM_RECALL_CONTEXT\b[\s\S]*?<\/COGMEM_RECALL_CONTEXT>/g, ' ')
        .replace(/<COGMEM_TURN_BRIDGE\b[\s\S]*?<\/COGMEM_TURN_BRIDGE>/g, ' ')
        .replace(/<COGMEM_SESSION_STATE\b[\s\S]*?<\/COGMEM_SESSION_STATE>/g, ' ')
        .replace(/<COGMEM_STRATEGY_CONTEXT\b[\s\S]*?<\/COGMEM_STRATEGY_CONTEXT>/g, ' ')
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
        'project',
        'architecture',
        'deploy',
        'timeline',
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
        '架构',
        '部署',
        '时间线',
        '写入',
        '存储',
        '分类',
        '关联',
        '项目',
    ].some((needle) => lowered.includes(needle.toLowerCase()));
}
function detectProjects(text) {
    const lowered = text.toLowerCase();
    const detected = [];
    for (const project of PROJECT_ALIASES) {
        if (project.aliases.some((alias) => lowered.includes(alias.toLowerCase()))) {
            detected.push(project);
        }
    }
    if (!detected.some((project) => project.canonical === 'Cogmem')
        && /memory-write|memory-storage|context hygiene|COGMEM_RECALL_CONTEXT|记忆写入/.test(text)) {
        detected.push(PROJECT_ALIASES[0]);
    }
    const generic = text.match(GENERIC_PROJECT_RE)?.[1];
    if (generic && !detected.some((project) => project.canonical.toLowerCase() === generic.toLowerCase())) {
        detected.push({ canonical: generic, aliases: [generic] });
    }
    return detected;
}
function genericProjectTopic(text, projectName) {
    const lowered = text.toLowerCase();
    if (/架构|architecture|设计|design|插件|plugin/.test(lowered)) {
        return {
            suffix: 'architecture',
            summary: `${projectName} architecture, design boundaries, and component organization.`,
            signal: 'project_architecture',
            bindingType: 'decision',
            confidence: 0.76,
        };
    }
    if (/部署|deploy|发布|release/.test(lowered)) {
        return {
            suffix: 'release-operations',
            summary: `${projectName} deployment, release, and operational constraints.`,
            signal: 'project_release_operations',
            bindingType: 'decision',
            confidence: 0.74,
        };
    }
    if (/时间线|timeline|里程碑|milestone/.test(lowered)) {
        return {
            suffix: 'timeline',
            summary: `${projectName} timeline, milestones, and temporal project state.`,
            signal: 'project_timeline',
            bindingType: 'about',
            confidence: 0.72,
        };
    }
    if (/问题|风险|bug|error|fail|不稳|漂移|污染/.test(lowered)) {
        return {
            suffix: 'known-risks',
            summary: `${projectName} diagnostics, risks, and unresolved project issues.`,
            signal: signalForClaim(text, 'project_diagnostic'),
            bindingType: 'diagnostic',
            confidence: 0.74,
        };
    }
    return undefined;
}
function projectDecision(input) {
    return {
        topicPath: TOPIC_PATH_REGISTRY.resolveProjectPath(input.project.canonical, input.suffix),
        topicType: 'project',
        summary: input.summary,
        bindingType: input.bindingType,
        signal: input.signal,
        claimKey: input.claimKey,
        confidence: input.confidence,
        entityName: input.project.canonical,
        entityType: 'project',
        aliases: input.project.aliases,
    };
}
function hasMemoryWritePipelineCue(lowered) {
    return /写入|存储|表格|大脑|历史|关联|分类|绑定|write|storage|pipeline|brain|table|classif|binding/.test(lowered);
}
function hasContextHygieneCue(text) {
    return /COGMEM_RECALL_CONTEXT|COGMEM_TURN_BRIDGE|COGMEM_SESSION_STATE|COGMEM_STRATEGY_CONTEXT|context hygiene|recall block|上下文|污染|长期记忆|清洗|注入/.test(text);
}
function hasOpenClawCue(lowered) {
    return lowered.includes('openclaw');
}
function bindingTypeFor(text, fallback) {
    const lowered = text.toLowerCase();
    if (/纠正|不对|错了|更正|correct|wrong/.test(lowered))
        return 'correction';
    if (/不要|不能|禁止|必须|边界|must not|never|forbid|boundary/.test(lowered))
        return 'boundary';
    if (/决定|方案|策略|decision|decide/.test(lowered))
        return 'decision';
    if (/请记住|以后|偏好|prefer|local-first|本地优先/.test(lowered))
        return 'preference';
    if (/目标|希望|goal|want/.test(lowered))
        return 'goal';
    if (/问题|风险|不像|表格|漂移|problem|risk|diagnos/.test(lowered))
        return 'diagnostic';
    return fallback;
}
function signalForClaim(text, fallback) {
    const lowered = text.toLowerCase();
    if (/分类树|分类.*漂移|topic.*drift|tree.*drift|memory-storage|memory-write/.test(lowered))
        return 'classification_drift';
    if (/历史|关联|binding|旧记忆|old memory|table|表格|孤立/.test(lowered))
        return 'historical_binding';
    if (/污染|上下文|recall_context|turn_bridge|session_state/.test(lowered))
        return 'context_pollution_boundary';
    return fallback;
}
function claimKeyFor(text, fallback) {
    return CLAIM_KEY_GENERATOR.generate(text, signalForClaim(text, fallback));
}
function uniqueTopicDecisions(decisions) {
    const seen = new Set();
    return decisions.filter((decision) => {
        const key = `${decision.topicPath}:${decision.bindingType}:${decision.claimKey}:${decision.entityName || ''}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
