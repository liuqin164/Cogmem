export function summarizeEpisode(episode, events, evidenceEventIds) {
    const userText = events.filter((event) => event.role === 'user').map(eventText).filter(Boolean);
    const assistantText = events.filter((event) => event.role === 'assistant' || event.role === 'agent').map(eventText).filter(Boolean);
    const candidateTypes = [...new Set(episode.candidateTypes)];
    return {
        userPosition: clip(userText.join(' '), 600),
        assistantContribution: clip(assistantText.join(' '), 600),
        decision: candidateTypes.includes('decision') || episode.episodeType === 'decision'
            ? clip(userText.at(-1) || '', 400) || undefined
            : undefined,
        correction: candidateTypes.includes('correction') || episode.episodeType === 'correction'
            ? clip(userText.find((text) => /不对|不是|纠正|更正|actually|correction/iu.test(text)) || '', 400) || undefined
            : undefined,
        openQuestions: [...userText, ...assistantText].filter((text) => /[?？]\s*$/.test(text)).slice(-5).map((text) => clip(text, 240)),
        candidateTypes: candidateTypes,
        evidenceEventIds,
        evidenceAuthority: 'raw_event_ids_only',
    };
}
function eventText(event) {
    const payload = event.payload;
    return typeof payload?.text === 'string'
        ? payload.text
            .replace(/<(COGMEM_RECALL_CONTEXT|COGMEM_TURN_BRIDGE|COGMEM_SESSION_STATE|COGMEM_STRATEGY_CONTEXT)\b[\s\S]*?<\/\1>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        : '';
}
function clip(value, max) {
    return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
