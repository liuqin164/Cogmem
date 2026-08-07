export function isRecallableMemoryEvidence(neuron) {
    if (!neuron)
        return false;
    if (isOperationalNoiseMemoryEvidence(neuron))
        return false;
    if (isImportedSummarySupportMemoryEvidence(neuron))
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
    if (isOperationalNoiseMemoryEvidence(neuron))
        return 'operational_noise';
    if (isImportedSummarySupportMemoryEvidence(neuron))
        return 'imported_summary_support';
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
export function isOperationalNoiseMemoryEvidence(neuron) {
    const tags = neuron.metadata.tags || [];
    if (tags.some((tag) => (tag === 'operational_noise'
        || tag === 'record:heartbeat'
        || tag === 'system:heartbeat'
        || tag === 'routine:heartbeat'))) {
        return true;
    }
    return isOperationalNoiseText(neuron.content);
}
export function isImportedSummarySupportMemoryEvidence(neuron) {
    const tags = neuron.metadata.tags || [];
    return tags.includes('governance:imported_summary_support')
        || (tags.includes('source_class:daily_memory')
            && tags.includes('provenance:imported_summary'));
}
export function isOperationalNoiseText(text) {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized)
        return false;
    return [
        /\[openclaw heartbeat poll\]/i,
        /^heartbeat_ok$/i,
        /\bheartbeat_ok\b/i,
        /\bheartbeat poll\b/i,
        /please complete your identity setup/i,
        /test your telegram bot by searching for it/i,
        /\broutine system ping\b/i,
    ].some((pattern) => pattern.test(normalized));
}
export function recallableNeuronSql(alias, columns) {
    const tagSet = (values) => columns.has('tags')
        ? `EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(${alias}.tags) THEN ${alias}.tags ELSE '[]' END) WHERE value IN (${values.map(sqlString).join(',')}))`
        : '0';
    const rawUser = columns.has('source_type') && columns.has('tags')
        ? `${alias}.source_type='user_input'
      AND ${tagSet(['reliability:raw_utterance'])}
      AND ${tagSet(['role:user'])}
      AND ${tagSet(['record:raw_utterance', 'record:conversation_message'])}`
        : '0';
    const status = columns.has('status')
        ? `(COALESCE(${alias}.status,'active') IN ('active','cold') OR (COALESCE(${alias}.status,'active')='suspect' AND ${rawUser}))`
        : '1';
    const imported = `(${tagSet(['governance:imported_summary_support'])} OR (${tagSet(['source_class:daily_memory'])} AND ${tagSet(['provenance:imported_summary'])}))`;
    const noiseTags = tagSet(['operational_noise', 'record:heartbeat', 'system:heartbeat', 'routine:heartbeat']);
    const text = `lower(trim(${alias}.content))`;
    const noiseText = columns.has('content')
        ? `(instr(${text},'[openclaw heartbeat poll]')>0
      OR ${sqlAsciiWordBoundary(text, 'heartbeat_ok')}
      OR ${sqlAsciiWordBoundary(text, 'heartbeat poll')}
      OR instr(${text},'please complete your identity setup')>0
      OR instr(${text},'test your telegram bot by searching for it')>0
      OR ${sqlAsciiWordBoundary(text, 'routine system ping')})`
        : '0';
    return `${status} AND NOT (${noiseTags} OR ${noiseText}) AND NOT ${imported}`;
}
function sqlString(value) {
    return `'${value.replaceAll("'", "''")}'`;
}
function sqlAsciiWordBoundary(expression, value) {
    const escaped = value.replaceAll('[', '[[]').replaceAll('*', '[*]').replaceAll('?', '[?]');
    return `(${expression}=${sqlString(value)}
    OR ${expression} GLOB ${sqlString(`${escaped}[^a-z0-9_]*`)}
    OR ${expression} GLOB ${sqlString(`*[^a-z0-9_]${escaped}`)}
    OR ${expression} GLOB ${sqlString(`*[^a-z0-9_]${escaped}[^a-z0-9_]*`)})`;
}
