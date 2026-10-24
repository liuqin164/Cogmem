/** Anything that arrived as JSON and cannot be trusted to have a shape. */
type Payload = any;
export interface TruncationMeta {
    text: string;
    truncated: boolean;
    originalChars: number;
    visibleChars: number;
    truncatedAtChar: number;
    remainingChars: number;
}
export interface FormattedContextEvent {
    line: string;
    truncation: TruncationMeta;
}
/**
 * Which kind of navigation the user is asking for. `atlas_explore` means the
 * question is about the shape of memory (what do I remember, project state,
 * history, relations); `direct_fact` means it is about one fact.
 */
export declare function classifyMemoryNavigationIntent(query: Payload): 'atlas_explore' | 'direct_fact';
export declare function truncateLineWithMeta(value: Payload, limit: number): TruncationMeta;
export declare function formatSourceRange(sourceRange: Payload): string;
/** The short name a window line uses for one event. */
export declare function contextEventLabel(event: Payload): string;
/** Drop events already accounted for, keeping first-seen order. */
export declare function uniqueWindowEvents(events: Payload[], seenEventIds: Set<string>): Payload[];
export declare function formatSourceWindow(window: Payload, context: Payload): string;
/**
 * One `sourceContext`/`sourceBefore`/`sourceAfter` line, plus how much of it
 * survived, so a caller can report the truncation it is about to be judged on.
 */
export declare function formatContextEvent(event: Payload, limit: number): FormattedContextEvent;
/** One `selectedMemoryCards` entry. */
export declare function formatAtlasCard(card: Payload): string;
/** The one-line `recallDecision` field: which lane answered, and what it cost. */
export declare function formatRecallDecision(trace: Payload): string;
/** Keep the closing tag visible when the block must be shortened. */
export declare function clampRecallContext(text: string, maxChars: number): string;
/**
 * The Atlas block: a bounded navigation map. It is explicitly marked as
 * non-evidence — it names nodes and paths, and every claim is supposed to be
 * drilled down to a raw event id before it is repeated.
 */
export declare function formatAtlasContext(result: Payload, maxChars: number): string;
/** The item projection the recall block renders. */
export declare function compactRecallItems(items: Payload[], config: Payload): Payload[];
/** Adapt a recall item into the shape the context planner reasons about. */
export declare function contextCandidateFromRecallItem(item: Payload): Payload;
/**
 * The recall block itself.
 *
 * Its rules are stated inside the block rather than in a host's system prompt,
 * because the block is what a hook can inject; the model has to be told that
 * this text is background memory and not a user instruction or current intent,
 * and that it must not be persisted back as new memory.
 */
export declare function formatRecallContext(result: Payload, config: Payload): string;
export {};
//# sourceMappingURL=RecallBlock.d.ts.map