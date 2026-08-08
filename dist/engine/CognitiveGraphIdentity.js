import { createHash } from 'node:crypto';
export function cognitiveNodeId(projectId, nodeType, nodeKey) {
    return `cgnode-${createHash('sha256')
        .update(`${projectId ?? ''}\0${nodeType}\0${nodeKey}`)
        .digest('hex')
        .slice(0, 32)}`;
}
export function cognitiveEdgeId(input) {
    return `cgedge-${createHash('sha256')
        .update(`${input.projectId ?? ''}\0${input.sourceNodeId}\0${input.targetNodeId}\0${input.edgeType}`)
        .digest('hex')
        .slice(0, 32)}`;
}
