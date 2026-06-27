const STOP_WORDS = new Set(['我', '你', '让', '对', '的', '年', '做过', '什么', '去年', '今年', 'the', 'a', 'an', 'what', 'did', 'do', 'to', 'last', 'year']);
const ACTION_MARKERS = /配置|连接|安装|修复|更新|升级|比较|操作|设置|调试|configure|connect|install|repair|fix|update|upgrade|compare|setup|debug/iu;
const MEMORY_KIND_MARKERS = [
    [/决策|决定|decision/iu, 'decision'], [/修正|纠正|correction/iu, 'correction'],
    [/目标|goal/iu, 'goal'], [/偏好|preference/iu, 'preference'], [/计划|plan/iu, 'plan'],
    [/事件|经历|event/iu, 'event'], [/证据|原文|evidence/iu, 'evidence'],
    [/人物|person/iu, 'person'], [/地点|place/iu, 'place'], [/项目|project/iu, 'project'],
    [ACTION_MARKERS, 'action'],
];
export function compileAtlasQuery(query, now = Date.now()) {
    const text = String(query || '').trim().slice(0, 1000);
    const tokens = Array.from(new Set((text.match(/[\p{L}\p{N}_-]+/gu) || [])
        .map((item) => item.trim())
        .filter((item) => item.length > 1 && !STOP_WORDS.has(item.toLowerCase())))).slice(0, 24);
    const explicitYear = text.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/u)?.[1];
    let range;
    if (explicitYear) {
        const year = Number(explicitYear);
        range = { from: Date.UTC(year, 0, 1), to: Date.UTC(year + 1, 0, 1), label: explicitYear };
    }
    else if (/去年|last year/iu.test(text)) {
        const year = new Date(now).getUTCFullYear() - 1;
        range = { from: Date.UTC(year, 0, 1), to: Date.UTC(year + 1, 0, 1), label: String(year) };
    }
    const target = tokens.find((token) => /^[A-Z][\p{L}\p{N}_.-]*$/u.test(token))
        ?? tokens.find((token) => !/^\d{4}$/u.test(token)
            && !ACTION_MARKERS.test(token)
            && !MEMORY_KIND_MARKERS.some(([pattern]) => pattern.test(token)));
    const memoryKinds = MEMORY_KIND_MARKERS.filter(([pattern]) => pattern.test(text)).map(([, kind]) => kind);
    const keywords = tokens.filter((token) => token !== target
        && token !== explicitYear
        && !ACTION_MARKERS.test(token)
        && !MEMORY_KIND_MARKERS.some(([pattern]) => pattern.test(token)));
    return { text, tokens, keywords, target, actionIntent: ACTION_MARKERS.test(text), range, memoryKinds };
}
export function actionMarker(value) {
    return actionMarkers(value)[0];
}
export function actionMarkers(value) {
    const matches = value.match(new RegExp(ACTION_MARKERS.source, 'giu')) || [];
    return Array.from(new Set(matches.map((match) => match.toLocaleLowerCase()))).map((action) => ({
        frameType: frameTypeForAction(action),
        action,
    }));
}
function frameTypeForAction(lower) {
    const frameType = /修复|fix|repair|调试|debug/u.test(lower) ? 'repair'
        : /安装|install/u.test(lower) ? 'install'
            : /连接|connect/u.test(lower) ? 'connect'
                : /更新|升级|update|upgrade/u.test(lower) ? 'update'
                    : /比较|compare/u.test(lower) ? 'compare'
                        : /配置|设置|configure|setup/u.test(lower) ? 'configuration'
                            : 'operation';
    return frameType;
}
