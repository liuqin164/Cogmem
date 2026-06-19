const SEGMENT_ALIASES = [
    { canonical: 'memory-write-pipeline', aliases: ['memory storage', 'memory write', 'memory pipeline', '记忆写入', '记忆存储', '写入管线'] },
    { canonical: 'recall-context-hygiene', aliases: ['context hygiene', 'recall context', '上下文卫生', '记忆注入边界'] },
    { canonical: 'integration', aliases: ['integration', '集成', '接入'] },
    { canonical: 'architecture', aliases: ['architecture', 'design', '架构', '设计'] },
    { canonical: 'release-operations', aliases: ['release', 'deploy', '发布', '部署'] },
    { canonical: 'timeline', aliases: ['timeline', 'milestone', '时间线', '里程碑'] },
    { canonical: 'known-risks', aliases: ['risk', 'diagnostic', 'bug', '问题', '风险'] },
];
export class TopicPathRegistry {
    resolveProjectPath(projectName, candidate) {
        const normalizedCandidate = normalizeLookup(candidate);
        const known = SEGMENT_ALIASES.find((entry) => (entry.canonical === normalizedCandidate
            || entry.aliases.some((alias) => normalizeLookup(alias) === normalizedCandidate)));
        const project = safeSegment(projectName, 'unknown-project');
        const segment = known?.canonical || safeSegment(candidate, 'general');
        return `PROJECT/${project}/${segment}`;
    }
    canonicalSegment(candidate) {
        return this.resolveProjectPath('project', candidate).split('/').at(-1) || 'general';
    }
}
function normalizeLookup(value) {
    return String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}
function safeSegment(value, fallback) {
    const normalized = String(value || '')
        .normalize('NFKC')
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-+/g, '-');
    return normalized || fallback;
}
