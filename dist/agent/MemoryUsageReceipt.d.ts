import type { AgentRecallItem, AgentRecallSourceAnchor } from './AgentMemoryBackend.js';
export interface MemoryUsageReceiptSourceAnchor {
    memoryId?: string;
    eventId?: string;
    sessionId?: string;
    role?: string;
}
export interface MemoryUsageReceipt {
    sessionId: string;
    turnId: string;
    createdAt: number;
    userQueryDigest: string;
    assistantAnswerDigest: string;
    usedMemoryIds: string[];
    sourceAnchors: MemoryUsageReceiptSourceAnchor[];
    usedThemes: string[];
    workingConclusion?: string;
    ttlTurns: number;
    compileAllowed: false;
}
export interface CreateMemoryUsageReceiptInput {
    sessionId: string;
    turnId?: string;
    createdAt?: number;
    userText: string;
    assistantText: string;
    recallItems?: Array<Pick<AgentRecallItem, 'id' | 'text' | 'tags'> & {
        sourceAnchor?: AgentRecallSourceAnchor;
    }>;
    ttlTurns?: number;
}
export declare function createMemoryUsageReceipt(input: CreateMemoryUsageReceiptInput): MemoryUsageReceipt;
export declare function formatMemoryUsageBridge(receipt: MemoryUsageReceipt, maxChars?: number): string;
export declare function shouldInjectMemoryUsageBridge(query: string, receipt: MemoryUsageReceipt): boolean;
//# sourceMappingURL=MemoryUsageReceipt.d.ts.map