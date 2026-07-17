export const GLOBAL_PROJECT_SCOPE = '';
export function projectScope(projectId) {
    return projectId ?? GLOBAL_PROJECT_SCOPE;
}
