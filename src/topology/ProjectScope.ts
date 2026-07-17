export const GLOBAL_PROJECT_SCOPE = '' as const;

export function projectScope(projectId?: string): string {
  return projectId ?? GLOBAL_PROJECT_SCOPE;
}

