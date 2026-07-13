import type { BeliefRecord, Neuron } from './index.js';
import type { EntityTimelineItem } from '../store/EntityStore.js';
import type { EventRecord, FactRecord } from '../store/FactStore.js';
import type { FileEvidence } from '../assets/index.js';
import type { SkillCandidateLike } from './ExtensionPoints.js';
import type { MemoryAtlasSlice } from '../atlas/MemoryAtlasTypes.js';
import type { MemoryQueryFrameV1 } from '../semantic/MemoryFrameTypes.js';
export interface BrainRecallResult {
    query: string;
    atlas?: MemoryAtlasSlice;
    queryFrame?: MemoryQueryFrameV1;
    strategy: {
        primaryLevel: 'compiled_memory' | 'raw_evidence' | 'recent_unprocessed_sources';
        fallbackUsed: boolean;
        vectorSearchUsed?: boolean;
    };
    compiledMemory: {
        beliefs: BeliefRecord[];
        facts: FactRecord[];
        events: EventRecord[];
        entityTimeline: EntityTimelineItem[];
    };
    rawEvidence: Neuron[];
    fallbackSnippets: Array<{
        sourceId: string;
        sourcePath: string;
        text: string;
        timestamp: number;
        sourceType: 'conversation_markdown' | 'soul_markdown' | 'hermes_state_db' | 'openclaw_daily_memory' | 'openclaw_session' | 'openclaw_memory_index' | 'openclaw_user_profile' | 'openclaw_persona';
    }>;
    profileSignals: Array<{
        neuronId: string;
        sourcePath?: string;
        text: string;
        tags: string[];
        namespace: 'user_profile' | 'agent_persona';
    }>;
    profileSurface: {
        userProfile: Array<{
            neuronId: string;
            sourcePath?: string;
            label: string;
            value: string;
            section?: string;
        }>;
        agentPersona: Array<{
            neuronId: string;
            sourcePath?: string;
            label: string;
            value: string;
            section?: string;
        }>;
    };
    summaries?: Array<{
        summaryId: string;
        text: string;
        scope: string;
        windowStart?: number;
        windowEnd?: number;
        confidence: number;
    }>;
    fileEvidence?: FileEvidence[];
    skillCandidates?: SkillCandidateLike[];
    topicRouteInfo?: {
        matchedTopicPath: string | null;
        confidence: number;
        fallbackToGlobal: boolean;
    };
}
//# sourceMappingURL=BrainRecallResult.d.ts.map