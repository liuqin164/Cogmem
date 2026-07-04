export const ACTION_KIND_RULES = [
    { kind: 'started', label: '启动', verb: '启动', pattern: /启动|start|started|launch|launched|boot/i },
    { kind: 'installed', label: '安装', verb: '安装', pattern: /安装|install|installed|setup/i },
    { kind: 'configured', label: '配置', verb: '配置', pattern: /配置|config|configured|设置|修改配置|修改/i },
    { kind: 'restarted', label: '重启', verb: '重启', pattern: /重启|restart|restarted/i },
    { kind: 'stopped', label: '停止', verb: '停止', pattern: /停止|stop|stopped/i },
    { kind: 'operated', label: '操作', verb: '操作', pattern: /操作|处理|执行|运行|run|ran/i },
    { kind: 'implemented', label: '实现', verb: '实现', pattern: /修复|fixed|implemented|实现|提交|升级|upgrade|合并|发布/i },
    { kind: 'reviewed', label: '审查', verb: '审查', pattern: /review|审查|检查/i },
    { kind: 'decided', label: '决定', verb: '决定', pattern: /决定|decided|方案|策略|结论/i },
    { kind: 'debugged', label: '排查', verb: '排查', pattern: /debug|排查|卡死|locked|zombie|报错|错误/i },
];
export function inferActionKinds(text) {
    return ACTION_KIND_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.kind);
}
export function inferFirstActionKind(text) {
    return ACTION_KIND_RULES.find((rule) => rule.pattern.test(text));
}
