/**
 * Tool profiles.
 *
 * A host that only needs everyday memory work should not be handed 33 tools,
 * most of which are maintenance or governance operations it will never call.
 * Profiles bound the surface; `full` remains available for admin clients.
 */
export type McpToolProfile = 'core' | 'admin' | 'full';
/** Everyday memory work: recall, record, inspect evidence. */
export declare const CORE_TOOLS: readonly ["cogmem_recall", "cogmem_remember_turn", "cogmem_episode_append", "cogmem_graph_explore", "cogmem_graph_node", "cogmem_explain_recall"];
/** Core plus the writes and maintenance operations an operator runs on purpose. */
export declare const ADMIN_TOOLS: readonly ["cogmem_recall", "cogmem_remember_turn", "cogmem_episode_append", "cogmem_graph_explore", "cogmem_graph_node", "cogmem_explain_recall", "cogmem_strategy_plan", "cogmem_episode_import", "cogmem_episode_seal", "cogmem_episode_repair", "cogmem_topic_operate", "cogmem_topic_rollback", "cogmem_dream_tick", "cogmem_dream_status", "cogmem_maintenance_tick", "cogmem_candidate_review", "cogmem_memory_frame_review", "cogmem_graph_touch", "cogmem_prospective", "cogmem_import_preview", "cogmem_import_apply", "cogmem_import_status"];
export declare function isToolAllowed(profile: McpToolProfile, toolName: string): boolean;
export declare const DEFAULT_TOOL_PROFILE: McpToolProfile;
export declare function resolveProfile(value: string | undefined): McpToolProfile;
export declare function filterToolsByProfile<T extends {
    name: string;
}>(profile: McpToolProfile, tools: T[]): T[];
/**
 * The MCP `instructions` string is product surface, not documentation: a host
 * with no pre-prompt hook has nowhere else to learn when to pull a memory. It
 * therefore may only name tools the serving profile can call — an instruction
 * that points at a filtered tool costs the model a turn on
 * `tool_not_in_profile` and teaches it to stop trusting the string.
 *
 * The string is built once, from the profile the server starts with. MCP has no
 * per-call instructions channel, so a session that narrows its profile through
 * the identity header still reads the startup profile's copy.
 */
export declare function buildMcpInstructions(profile: McpToolProfile): string;
//# sourceMappingURL=profiles.d.ts.map