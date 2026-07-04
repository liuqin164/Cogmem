import { inferFirstActionKind } from './ActionKindRegistry.js';
const ENTITY_STOP_WORDS = new Set([
    'a',
    'an',
    'and',
    'are',
    'before',
    'bug',
    'context',
    'database',
    'debug',
    'exact',
    'graph',
    'install',
    'installed',
    'launch',
    'launched',
    'memory',
    'operation',
    'operations',
    'quote',
    'recall',
    'sourcecontext',
    'start',
    'started',
    'the',
    'what',
    'you',
]);
export function extractEntityCues(text, limit = 8) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    const labels = [];
    collectEntityMatches(normalized, /(?:对|给|把|关于|有关|围绕)\s*([\p{L}][\p{L}\p{N}_-]{1,48})\s*(?:做过|做了|做|启动|安装|配置|修改|重启|停止|操作|处理|执行|有关|的|什么|哪些|吗)?/giu, labels);
    collectEntityMatches(normalized, /(?:聊过|讨论过|记得|还记得|提到过)\s*([\p{L}][\p{L}\p{N}_-]{1,48})\s*(?:什么|哪些|吗|的)?/giu, labels);
    collectEntityMatches(normalized, /(?:启动|安装|配置|修改|重启|停止|执行|运行|start|started|launch|launched|boot|install|installed|setup|configure|configured|restart|stop|run|ran)\s*(?:本机安装的|本地的|the\s+)?([\p{L}][\p{L}\p{N}_-]{1,48})/giu, labels);
    collectEntityMatches(normalized, /\b([A-Z][A-Za-z0-9_-]{1,48})\b/g, labels);
    const seen = new Set();
    const cues = [];
    for (const label of labels.map(cleanEntityLabel).filter(Boolean)) {
        const id = normalizeEntityCueId(label);
        if (!id || ENTITY_STOP_WORDS.has(id) || isLikelyConceptLabel(label) || seen.has(id))
            continue;
        seen.add(id);
        cues.push({ label, id });
        if (cues.length >= limit)
            break;
    }
    return cues;
}
export function inferOperationalActionCue(text) {
    const rule = inferFirstActionKind(text);
    return rule ? { kind: rule.kind, label: rule.label, verb: rule.verb } : undefined;
}
export function normalizeEntityCueId(label) {
    return String(label || '')
        .trim()
        .toLocaleLowerCase()
        .replace(/['"“”‘’`]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-|-$/g, '');
}
function collectEntityMatches(text, regex, out) {
    for (const match of text.matchAll(regex)) {
        if (match[1])
            out.push(match[1]);
    }
}
function cleanEntityLabel(label) {
    return String(label || '')
        .replace(/^(我|你|我们)?(?:之前)?让你(?:对|给|把)?/u, '')
        .replace(/^(我们|你|我)?(?:之前)?聊过的?/u, '')
        .replace(/(聊过|讨论过|记得|还记得|提到过).*$/u, '')
        .replace(/^(本机安装的|本地的|the\s+)/i, '')
        .replace(/(做过|做了|启动|安装|配置|修改|重启|停止|操作|处理|执行)(什么|哪些|吗|么|的)?$/u, '')
        .replace(/(什么|哪些|吗|么|的)$/u, '')
        .replace(/[，。？！、；：,.?!;:()[\]{}<>]/g, '')
        .trim();
}
function isLikelyConceptLabel(label) {
    return /(黑盒|问题|方案|策略|计划|原话|上下文|记忆)$/u.test(label);
}
