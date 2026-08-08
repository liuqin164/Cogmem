import type { MemoryAtlasNodeType } from './MemoryAtlasTypes.js';

const PROJECT_SCOPED = new Set(['topic', 'time', 'issue', 'session', 'thread', 'memoryKind', 'actionKind']);

export interface AtlasNodeEndpoint { type: string; id: string; nodeId: string; }

export function encodeAtlasNodeId(type: string, id: string, projectId: string): string {
  if (type === 'entity' && id.startsWith('facet:')) return `entity:${projectId}:${id}`;
  return PROJECT_SCOPED.has(type) ? `${type}:${projectId}:${id}` : `${type}:${id}`;
}

export function decodeAtlasNodeId(nodeId: string, projectId: string): { type: string; id: string } | null {
  for (const type of PROJECT_SCOPED) {
    const prefix = `${type}:${projectId}:`;
    if (nodeId.startsWith(prefix)) return { type, id: nodeId.slice(prefix.length) };
  }
  const entityPrefix = `entity:${projectId}:`;
  if (nodeId.startsWith(entityPrefix)) return { type: 'entity', id: nodeId.slice(entityPrefix.length) };
  const separator = nodeId.indexOf(':');
  if (separator <= 0 || separator === nodeId.length - 1) return null;
  return { type: nodeId.slice(0, separator), id: nodeId.slice(separator + 1) };
}

export function toAtlasNodeEndpoint(nodeId: string, projectId: string): AtlasNodeEndpoint | null {
  const decoded = decodeAtlasNodeId(nodeId, projectId);
  return decoded ? { ...decoded, nodeId: encodeAtlasNodeId(decoded.type, decoded.id, projectId) } : null;
}

export function fromAtlasEdgeEndpoint(type: string, id: string, projectId: string): string {
  return encodeAtlasNodeId(type, id, projectId);
}

export function isProjectScopedAtlasType(type: string): boolean {
  return PROJECT_SCOPED.has(type);
}

export type { MemoryAtlasNodeType };
