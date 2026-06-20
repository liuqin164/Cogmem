const NOISE = /^\s*(hi|hello|hey|你好|在吗|谢谢|好的|好|ok|okay|嗯|收到|明白了)[。.!！?？\s]*$/iu;
const CORRECTION = /^\s*(不对|不是|不，|不是这样|纠正|更正|我(?:的)?意思是|actually|correction|no,)/iu;
const CONTINUATION = /^\s*(继续|接着|然后呢|上面那个|刚才说的|go on|continue|and then|続けて|そのまま)/iu;
const EXPLICIT_SWITCH = /^\s*(换个话题|换一个话题|另一个问题|另外一个问题|说点别的|题外话|new topic|switch topics?|on another topic|unrelated question)/iu;
const SUBTOPIC = /^\s*(另外|同时|还有|以及|顺便|also|additionally|and for|それと|また)/iu;
const CLOSURE = /(就这样|按这个(?:方案)?做|方案确认|到这里|先这样|结论就是|done|that settles it|proceed with this)/iu;
const PREFERENCE = /(请以后|以后请|始终|总是|偏好|喜欢|希望|不要|别|必须|一定要|边界|local-first|prefer|always|never|must|do not)/iu;
const GOAL = /(长期目标|目标是|计划要|希望最终|goal|objective)/iu;
const DECISION = /(决定|确定采用|选用|按.+方案|decision|decide|chosen|确认采用)/iu;
const PROSPECTIVE = /(提醒我|记得在|明天|下周|到时候|remind me|tomorrow|next week)/iu;
const DEBUGGING = /(bug|错误|失败|报错|根因|修复|debug|exception)/iu;
const SHORT_ACCEPT = /^\s*(对|是|可以|确认|就这个|第二个|第[一二三四五六七八九十\d]+个|yes|yep|correct|sounds good|そう|はい)[。.!！\s]*$/iu;
const SHORT_REJECT = /^\s*(不对|不是|不行|不要|否|no|nope|違う|いいえ)[。.!！\s]*$/iu;
const ASSISTANT_PROPOSAL = /(建议|可以选|选项|should we|recommend|option|propose|どうですか)|(?:方案|采用|下一版).{0,80}(?:吗|[?？])/iu;
const ASSISTANT_QUESTION = /[?？]\s*$|(?:是否|要不要|可以吗|确认吗|which|what|when|do you|should we)/iu;
const MEMORY_DOMAIN = /(cogmem|memory|记忆|dream|episode|hermes|openclaw|mcp|belief|context|召回|治理)/iu;
const CAR_DOMAIN = /(汽车|车子|烧机油|机油|发动机|轮胎|刹车|car|engine|oil)/iu;
const HEALTH_DOMAIN = /(健康|症状|医生|药|疼|发烧|medical|health)/iu;
const TRANSLATION_DOMAIN = /(翻译|日语|英语|translate|translation)/iu;
export function classifyTurnRelation(input) {
    const context = typeof input === 'string' ? { currentUserText: input } : input;
    const text = String(context.currentUserText || '').trim();
    const previousAssistant = String(context.previousAssistantText || '').trim();
    const signals = [];
    if (!text || NOISE.test(text))
        return decision('noise', 0.98, 'general', 0.05, 'deterministic_noise', ['noise'], false, []);
    if (SHORT_ACCEPT.test(text) && previousAssistant && (ASSISTANT_PROPOSAL.test(previousAssistant) || ASSISTANT_QUESTION.test(previousAssistant))) {
        signals.push('short_accept', ASSISTANT_PROPOSAL.test(previousAssistant) ? 'assistant_proposal' : 'assistant_question');
        return decision('accepts_assistant_proposal', 0.91, inferEpisodeType(previousAssistant), 0.88, 'assistant_context_acceptance', signals, false, inferCandidateTypes(previousAssistant));
    }
    if (SHORT_REJECT.test(text) && previousAssistant) {
        return decision('rejects_assistant_proposal', 0.9, 'correction', 0.9, 'assistant_context_rejection', ['short_reject', 'assistant_context'], false, ['correction']);
    }
    if (CORRECTION.test(text)) {
        return decision('corrects_previous', 0.94, 'correction', 0.9, 'explicit_correction', ['correction_marker'], false, ['correction']);
    }
    if (EXPLICIT_SWITCH.test(text)) {
        const active = `${context.activeEpisodeSummary || ''} ${context.activeEpisodeTopicPath || ''}`;
        const shift = classifySwitch(text, active);
        if (shift === 'hard')
            return { ...decision('hard_topic_switch', 0.94, inferEpisodeType(text), inferImportance(text), 'cross_domain_topic_switch', ['explicit_topic_switch', 'cross_domain'], true, inferCandidateTypes(text)), switchKind: shift };
        return { ...decision('ambiguous_shift', 0.54, inferEpisodeType(text), inferImportance(text), 'ambiguous_topic_switch', ['explicit_topic_switch', 'domain_uncertain'], true, inferCandidateTypes(text), true), switchKind: shift };
    }
    if (SUBTOPIC.test(text) && sameDomain(text, `${context.activeEpisodeSummary || ''} ${context.activeEpisodeTopicPath || ''}`)) {
        return { ...decision('subtopic_shift', 0.86, inferEpisodeType(text), inferImportance(text), 'same_domain_subtopic', ['subtopic_marker', 'same_domain'], false, inferCandidateTypes(text)), switchKind: 'subtopic' };
    }
    if (CLOSURE.test(text))
        return decision('closes_episode', 0.92, inferEpisodeType(text), inferImportance(text), 'explicit_user_closure', ['closure_marker'], true, inferCandidateTypes(text));
    if (CONTINUATION.test(text))
        return decision('continues_previous', 0.92, inferEpisodeType(text), inferImportance(text), 'explicit_continuation', ['continuation_marker'], false, inferCandidateTypes(text));
    if (previousAssistant && ASSISTANT_QUESTION.test(previousAssistant) && text.length <= 200) {
        return decision('answers_assistant_question', 0.82, inferEpisodeType(text), inferImportance(text), 'assistant_context_answer', ['assistant_question', 'bounded_answer'], false, inferCandidateTypes(text));
    }
    if (PROSPECTIVE.test(text))
        return decision('confirms_future_intent', 0.82, 'prospective', 0.86, 'prospective_signal', ['prospective_marker'], false, ['prospective']);
    const candidateTypes = inferCandidateTypes(text);
    const highValueAmbiguous = candidateTypes.length > 0;
    return decision('continues_previous', highValueAmbiguous ? 0.68 : 0.62, inferEpisodeType(text), inferImportance(text), 'bounded_session_continuity', highValueAmbiguous ? ['high_value_ambiguous'] : ['session_continuity'], false, candidateTypes, highValueAmbiguous);
}
export function classifyAssistantRelation(text, role = 'assistant') {
    const input = String(text || '').trim();
    if (role === 'tool')
        return 'tool_result_context';
    if (/^\s*(总结|小结|结论|summary|recap)[:：]/iu.test(input))
        return 'assistant_summary';
    if (/^\s*(我的意思是|换句话说|澄清|clarif|to clarify)/iu.test(input))
        return 'assistant_clarification';
    if (ASSISTANT_PROPOSAL.test(input))
        return 'assistant_proposal';
    if (ASSISTANT_QUESTION.test(input))
        return 'assistant_question';
    return 'assistant_response';
}
/** Background-only semantic review. The reviewer can suggest classification fields but cannot mutate memory. */
export async function classifyTurnRelationHybrid(context, reviewer) {
    const cpuDecision = classifyTurnRelation(context);
    if (!cpuDecision.needsLlmReview || !reviewer)
        return cpuDecision;
    let value;
    try {
        value = await reviewer.review({ context, cpuDecision });
    }
    catch {
        return { ...cpuDecision, signals: [...cpuDecision.signals, 'advisory_review_failed'] };
    }
    if (!value || typeof value !== 'object')
        return cpuDecision;
    const record = value;
    const relation = isTurnRelation(record.relation) ? record.relation : cpuDecision.relation;
    const confidence = typeof record.confidence === 'number' && Number.isFinite(record.confidence)
        ? Math.max(0, Math.min(record.confidence, 1))
        : cpuDecision.confidence;
    const candidateTypes = Array.isArray(record.candidateTypes)
        ? record.candidateTypes.filter(isEpisodeCandidateType)
        : cpuDecision.candidateTypes;
    return {
        ...cpuDecision,
        relation,
        confidence,
        candidateTypes: [...new Set(candidateTypes)],
        closureCandidate: typeof record.closureCandidate === 'boolean' ? record.closureCandidate : cpuDecision.closureCandidate,
        signals: [...new Set([...cpuDecision.signals, 'advisory_review_applied'])],
        rationale: typeof record.rationale === 'string' ? record.rationale.slice(0, 240) : cpuDecision.rationale,
    };
}
function classifySwitch(text, active) {
    const nextDomain = domainOf(text);
    const activeDomain = domainOf(active);
    return nextDomain && activeDomain && nextDomain !== activeDomain ? 'hard' : 'ambiguous';
}
function sameDomain(text, active) {
    const nextDomain = domainOf(text);
    const activeDomain = domainOf(active);
    return Boolean(nextDomain && activeDomain && nextDomain === activeDomain);
}
function domainOf(text) {
    if (MEMORY_DOMAIN.test(text))
        return 'memory';
    if (CAR_DOMAIN.test(text))
        return 'car';
    if (HEALTH_DOMAIN.test(text))
        return 'health';
    if (TRANSLATION_DOMAIN.test(text))
        return 'translation';
    return undefined;
}
function inferCandidateTypes(text) {
    const types = [];
    if (PREFERENCE.test(text))
        types.push('preference');
    if (GOAL.test(text))
        types.push('goal');
    if (DECISION.test(text))
        types.push('decision', 'temporal');
    if (CORRECTION.test(text))
        types.push('correction');
    if (PROSPECTIVE.test(text))
        types.push('prospective');
    return [...new Set(types)];
}
function isEpisodeCandidateType(value) {
    return value === 'belief' || value === 'entity' || value === 'temporal' || value === 'prospective'
        || value === 'correction' || value === 'preference' || value === 'goal' || value === 'decision';
}
function isTurnRelation(value) {
    return typeof value === 'string' && new Set([
        'continues_previous', 'clarifies_previous', 'corrects_previous', 'answers_assistant_question',
        'accepts_assistant_proposal', 'rejects_assistant_proposal', 'assistant_response', 'assistant_proposal',
        'assistant_summary', 'assistant_question', 'assistant_clarification', 'tool_result_context',
        'hard_topic_switch', 'subtopic_shift', 'ambiguous_shift', 'switches_topic', 'starts_new_topic',
        'returns_to_old_topic', 'confirms_future_intent', 'closes_episode', 'noise',
    ]).has(value);
}
function inferEpisodeType(text) {
    if (CORRECTION.test(text))
        return 'correction';
    if (PREFERENCE.test(text))
        return 'preference';
    if (GOAL.test(text))
        return 'goal';
    if (DECISION.test(text))
        return 'decision';
    if (PROSPECTIVE.test(text))
        return 'prospective';
    if (DEBUGGING.test(text))
        return 'debugging';
    if (/(路线|计划|策略|roadmap|plan)/iu.test(text))
        return 'planning';
    return 'discussion';
}
function inferImportance(text) {
    if (CORRECTION.test(text) || PREFERENCE.test(text) || GOAL.test(text) || DECISION.test(text) || PROSPECTIVE.test(text))
        return 0.9;
    if (DEBUGGING.test(text))
        return 0.78;
    return 0.55;
}
function decision(relation, confidence, episodeType, importance, rationale, signals, closureCandidate, candidateTypes, needsLlmReview = false) {
    return { relation, confidence, episodeType, importance, rationale, signals, needsLlmReview, candidateTypes, closureCandidate };
}
