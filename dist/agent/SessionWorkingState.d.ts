export interface SessionWorkingState {
    sessionId: string;
    updatedAt: number;
    currentTopic?: string;
    designDirection: string[];
    workingConclusions: string[];
    openQuestions: string[];
    maxChars: number;
    compileAllowed: false;
}
export interface UpdateSessionWorkingStateInput {
    sessionId: string;
    userText: string;
    assistantText: string;
    maxChars?: number;
    updatedAt?: number;
}
export declare function updateSessionWorkingState(previous: SessionWorkingState | undefined, input: UpdateSessionWorkingStateInput): SessionWorkingState;
export declare function formatSessionWorkingState(state: SessionWorkingState): string;
//# sourceMappingURL=SessionWorkingState.d.ts.map