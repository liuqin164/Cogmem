import type { ChatSessionLike } from '../types/ExtensionPoints.js';
export interface SessionContextSelectionInput {
    session?: ChatSessionLike;
    query: string;
    projectId?: string;
    maxChars?: number;
}
type SessionTurn = ReturnType<ChatSessionLike['getRecentTurns']>[number];
export declare function selectCueDrivenSessionTurns(input: SessionContextSelectionInput): SessionTurn[];
export declare function buildCueDrivenSessionContext(input: SessionContextSelectionInput): string;
export {};
//# sourceMappingURL=SessionContextSelector.d.ts.map