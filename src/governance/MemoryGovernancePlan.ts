export type MemoryGovernanceOperationType =
  | 'BIND_EVENT'
  | 'RECLASSIFY_TOPIC'
  | 'MERGE_CLUSTER'
  | 'SPLIT_CLUSTER'
  | 'LINK_ENTITY_ALIAS'
  | 'MERGE_ENTITY'
  | 'CREATE_BELIEF'
  | 'REINFORCE_BELIEF'
  | 'SUPERSEDE_BELIEF'
  | 'REJECT_BELIEF'
  | 'CREATE_TIME_ANCHOR'
  | 'EXPIRE_TIME_ANCHOR'
  | 'CREATE_PROSPECTIVE_MEMORY'
  | 'RESOLVE_PROSPECTIVE_MEMORY';

export type MemoryEvidenceRole = 'user' | 'assistant' | 'tool' | 'system';
export type MemoryOwnership = 'user' | 'project' | 'system';

export interface MemoryGovernanceOperation {
  operationId: string;
  type: MemoryGovernanceOperationType;
  projectId?: string;
  evidenceEventIds: string[];
  sourceRole: MemoryEvidenceRole;
  ownership: MemoryOwnership;
  expectedVersion?: number;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export interface MemoryGovernancePlan {
  planId: string;
  projectId?: string;
  proposedBy: 'deterministic' | 'model_candidate' | 'operator';
  createdAt: number;
  operations: MemoryGovernanceOperation[];
}

export interface MemoryGovernanceIssue {
  code: string;
  message: string;
  operationId?: string;
}

export interface MemoryGovernanceValidationResult {
  valid: boolean;
  issues: MemoryGovernanceIssue[];
}

export interface MemoryGovernanceExecutionResult {
  planId: string;
  status: 'applied' | 'already_applied';
  appliedOperationIds: string[];
}
