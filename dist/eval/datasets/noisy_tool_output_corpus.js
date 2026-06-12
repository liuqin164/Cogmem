export function generateNoisyCorpus(size) {
    const items = [];
    for (let index = 0; index < size; index += 1) {
        const mode = index % 4;
        if (mode === 0) {
            items.push({
                id: `noisy-${index}`,
                capabilityId: 'web_fetch',
                taskId: `task-${Math.floor(index / 4)}`,
                success: false,
                callCountThisTask: 0,
                rawOutput: `ERROR duplicate retry ${index}`,
                shouldFilter: true,
                reason: 'fetch_failed',
            });
            continue;
        }
        if (mode === 1) {
            items.push({
                id: `noisy-${index}`,
                capabilityId: 'web_fetch',
                taskId: `task-${Math.floor(index / 4)}`,
                success: true,
                callCountThisTask: 0,
                rawOutput: ` short contradictory ${index} `,
                shouldFilter: true,
                reason: 'output_too_short',
            });
            continue;
        }
        if (mode === 2) {
            items.push({
                id: `noisy-${index}`,
                capabilityId: 'web_fetch',
                taskId: `task-${Math.floor(index / 4)}`,
                success: true,
                callCountThisTask: 5,
                rawOutput: `Repeated tool transcript ${index}. This is long enough to pass the length threshold, but it should still be filtered because the call limit was already reached.`,
                shouldFilter: true,
                reason: 'call_limit_reached',
            });
            continue;
        }
        items.push({
            id: `noisy-${index}`,
            capabilityId: 'web_fetch',
            taskId: `task-${Math.floor(index / 4)}`,
            success: true,
            callCountThisTask: 1,
            rawOutput: `Accepted tool transcript ${index}. It includes duplicate headers, contradictory fragments, and repeated footer lines, but it is still long enough and under the task call limit so ObservationFilter should ingest it.`,
            shouldFilter: false,
            reason: 'accepted',
        });
    }
    return {
        name: `noisy-tool-output-${size}`,
        items,
    };
}
