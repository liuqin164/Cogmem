export type MemoryAtlasNodeType = 'project' | 'topic' | 'entity' | 'cluster' | 'episode' | 'belief' | 'action' | 'time' | 'event';

export interface MemoryAtlasEvidence {
  eventId: string;
  drilldown: string;
  excerpt?: string;
}

export interface MemoryAtlasNode {
  id: string;
  projectId: string;
  nodeType: MemoryAtlasNodeType;
  memoryKind?: string;
  sourceId: string;
  label: string;
  summary?: string;
  topicPath?: string;
  confidence: number;
  supportCount: number;
  status: string;
  occurredAt?: number;
  activation: number;
  score: number;
  evidenceCount: number;
  /** Total source evidence known for this node. */
  evidenceTotal: number;
  /** Number of evidence records returned in this response. */
  evidenceReturned?: number;
}

export interface MemoryAtlasEdge {
  source: string;
  relation: string;
  target: string;
  confidence: number;
  evidenceEventIds: string[];
}

export interface MemoryAtlasNextAction {
  label: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface MemoryAtlasSlice {
  version: 'memory_atlas.v1';
  projectId: string;
  query?: string;
  nodes: MemoryAtlasNode[];
  edges: MemoryAtlasEdge[];
  nextActions: MemoryAtlasNextAction[];
  warnings: string[];
  facets?: {
    time?: { from: number; to: number; label: string };
    target?: string;
    memoryKinds: string[];
    keywords: string[];
  };
  coldMemoryResurrected?: boolean;
}

export interface MemoryAtlasNodeDetail extends MemoryAtlasNode {
  evidence: MemoryAtlasEvidence[];
  neighbors: MemoryAtlasEdge[];
}

export interface MemoryAtlasAction {
  id: string;
  frameType: string;
  action: string;
  targetLabel?: string;
  topicPath?: string;
  episodeId?: string;
  occurredAt: number;
  confidence: number;
  evidence: MemoryAtlasEvidence[];
}

export interface MemoryAtlasTimelineResult {
  version: 'memory_atlas.v1';
  projectId: string;
  query: string;
  range?: { from: number; to: number; label: string };
  temporalResurrection: boolean;
  nodes: MemoryAtlasNodeDetail[];
  actions: MemoryAtlasAction[];
  warnings: string[];
}

export interface MemoryAtlasPathResult {
  version: 'memory_atlas.v1';
  projectId: string;
  from: string;
  to: string;
  path: MemoryAtlasNode[];
  edges: MemoryAtlasEdge[];
  truncated: boolean;
}

export interface MemoryAtlasQueryOptions {
  projectId: string;
  limit?: number;
  includeEvidence?: boolean;
  evidenceLimit?: number;
  now?: number;
  refresh?: boolean;
  staleOk?: boolean;
}
