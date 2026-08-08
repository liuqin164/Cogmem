export const GLOBAL_PROJECT_SCOPE = '' as const;

export function projectScope(projectId?: string): string {
  return projectId ?? GLOBAL_PROJECT_SCOPE;
}

export function projectQueryValue(projectId?: string): string | null {
  return projectId === undefined ? null : projectScope(projectId);
}

export function matchesProjectScope(
  requestedProjectId: string | undefined,
  actualProjectId: string | null | undefined
): boolean {
  return requestedProjectId === undefined
    || projectScope(actualProjectId ?? undefined) === projectScope(requestedProjectId);
}
