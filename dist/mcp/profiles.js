/**
 * Tool profiles.
 *
 * A host that only needs everyday memory work should not be handed 33 tools,
 * most of which are maintenance or governance operations it will never call.
 * Profiles bound the surface; `full` remains available for admin clients.
 */
/** Everyday memory work: recall, record, inspect evidence, read shared items. */
export const CORE_TOOLS = [
    'cogmem_recall',
    'cogmem_remember_turn',
    'cogmem_episode_append',
    'cogmem_graph_explore',
    'cogmem_graph_node',
    'cogmem_explain_recall',
    'cogmem_shared_subscribe',
    'cogmem_shared_explain',
];
/** Core plus the writes and maintenance operations an operator runs on purpose. */
export const ADMIN_TOOLS = [
    ...CORE_TOOLS,
    'cogmem_strategy_plan',
    'cogmem_episode_import',
    'cogmem_episode_seal',
    'cogmem_episode_repair',
    'cogmem_topic_operate',
    'cogmem_topic_rollback',
    'cogmem_dream_tick',
    'cogmem_dream_status',
    'cogmem_maintenance_tick',
    'cogmem_candidate_review',
    'cogmem_memory_frame_review',
    'cogmem_graph_touch',
    'cogmem_prospective',
    'cogmem_shared_publish',
    'cogmem_shared_retract',
    'cogmem_import_preview',
    'cogmem_import_apply',
    'cogmem_import_status',
];
export function isToolAllowed(profile, toolName) {
    if (profile === 'full')
        return true;
    const set = profile === 'core' ? CORE_TOOLS : ADMIN_TOOLS;
    return set.includes(toolName);
}
export function resolveProfile(value) {
    if (!value)
        return 'core';
    if (value === 'core' || value === 'admin' || value === 'full')
        return value;
    throw new Error(`unknown_tool_profile:${value}`);
}
export function filterToolsByProfile(profile, tools) {
    if (profile === 'full')
        return tools;
    return tools.filter((tool) => isToolAllowed(profile, tool.name));
}
