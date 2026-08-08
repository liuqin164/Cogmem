import { createHash } from 'node:crypto';
import type { CognitiveEdgeType, CognitiveNodeType } from '../types/index.js';

export function cognitiveNodeId(projectId: string | undefined, nodeType: CognitiveNodeType, nodeKey: string): string {
  return `cgnode-${createHash('sha256')
    .update(`${projectId ?? ''}\0${nodeType}\0${nodeKey}`)
    .digest('hex')
    .slice(0, 32)}`;
}

export function cognitiveEdgeId(input: {
  projectId?: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: CognitiveEdgeType;
}): string {
  return `cgedge-${createHash('sha256')
    .update(`${input.projectId ?? ''}\0${input.sourceNodeId}\0${input.targetNodeId}\0${input.edgeType}`)
    .digest('hex')
    .slice(0, 32)}`;
}
