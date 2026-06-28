export const CLI_JSON_SCHEMA_VERSION = 'cogmem.cli.v1';
export function formatCliJson(command, payload, options = {}) {
    const queue = options.queue;
    const output = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? { ...payload, schemaVersion: CLI_JSON_SCHEMA_VERSION, command }
        : { schemaVersion: CLI_JSON_SCHEMA_VERSION, command, items: Array.isArray(payload) ? payload : [payload] };
    if (queue) {
        output.candidate = finiteCounter(queue.candidate);
        output.promoted = finiteCounter(queue.promoted);
        output.needs_confirmation = finiteCounter(queue.needs_confirmation ?? queue.needsConfirmation);
        output.beliefs = finiteCounter(options.beliefs);
    }
    return output;
}
export function printCliJson(command, payload, options = {}) {
    console.log(JSON.stringify(formatCliJson(command, payload, options), null, 2));
}
function finiteCounter(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}
