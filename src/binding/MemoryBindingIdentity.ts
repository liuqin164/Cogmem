import { createHash } from 'node:crypto';

export function memoryEntityId(
  projectId: string | undefined,
  entityType: string,
  identity: string,
): string {
  return `entity-${hash([projectId ?? '', entityType, identity.toLowerCase()].join('\0'))}`;
}

export function memoryEdgeId(input: {
  projectId?: string;
  sourceType: string;
  sourceId: string;
  relationType: string;
  targetType: string;
  targetId: string;
}): string {
  return `edge-${hash([
    input.projectId ?? '',
    input.sourceType,
    input.sourceId,
    input.relationType,
    input.targetType,
    input.targetId,
  ].join('\0'))}`;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}
