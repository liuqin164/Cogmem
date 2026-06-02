export function isRecallableMemoryEvidence(neuron) {
    if (!neuron)
        return false;
    const status = neuron.metadata.status ?? 'active';
    if (status === 'active' || status === 'cold')
        return true;
    if (status === 'suspect')
        return isRawUserUtteranceEvidence(neuron);
    return false;
}
export function recallGovernanceReasonsFor(neuron) {
    const reasons = [];
    const status = neuron.metadata.status ?? 'active';
    if (isRawUserUtteranceEvidence(neuron)) {
        reasons.push('provenance:raw_user_utterance');
        if (status === 'suspect')
            reasons.push('governance:allowed_suspect_raw_evidence');
    }
    return reasons;
}
export function recallSuppressionReasonFor(neuron) {
    if (!neuron)
        return undefined;
    const status = neuron.metadata.status ?? 'active';
    if (status === 'active' || status === 'cold')
        return undefined;
    if (status === 'suspect' && isRawUserUtteranceEvidence(neuron))
        return undefined;
    if (status === 'archived')
        return 'archived';
    if (status === 'suspect' && neuron.metadata.sourceType === 'llm_inference')
        return 'suspect_llm_inference';
    if (status === 'suspect' && neuron.metadata.sourceType === 'external_tool')
        return 'suspect_external_tool_observation';
    if (status === 'suspect')
        return 'suspect_unverified_claim';
    return 'non_recallable_status';
}
export function isRawUserUtteranceEvidence(neuron) {
    const tags = neuron.metadata.tags || [];
    return neuron.metadata.sourceType === 'user_input'
        && tags.includes('reliability:raw_utterance')
        && tags.includes('role:user')
        && (tags.includes('record:raw_utterance') || tags.includes('record:conversation_message'));
}
