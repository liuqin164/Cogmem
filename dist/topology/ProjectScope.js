export const GLOBAL_PROJECT_SCOPE = '';
export function projectScope(projectId) {
    return projectId ?? GLOBAL_PROJECT_SCOPE;
}
export function projectQueryValue(projectId) {
    return projectId === undefined ? null : projectScope(projectId);
}
export function matchesProjectScope(requestedProjectId, actualProjectId) {
    return requestedProjectId === undefined
        || projectScope(actualProjectId ?? undefined) === projectScope(requestedProjectId);
}
