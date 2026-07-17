import { NeuronFactory } from '../core/Neuron.js';
import { normalizeTopicPath } from './HierarchicalRecallRouter.js';
import { isRecallableMemoryEvidence } from './RecallGovernance.js';
const SUMMARY_TAG = 'topic_summary';
const SUMMARY_SOURCE_TAG = 'topic_summary:auto';
const SUMMARY_RUN_ID = 'topic_summary_board';
export class TopicSummaryBoard {
    memoryGraph;
    summaryStore;
    constructor(memoryGraph, summaryStore) {
        this.memoryGraph = memoryGraph;
        this.summaryStore = summaryStore;
    }
    refresh(topicPath, projectId, options = {}) {
        const normalized = normalizeTopicPath(topicPath);
        if (!normalized || !projectId)
            return null;
        const existing = this.getSummaryNeuron(normalized, projectId);
        const sourceNeurons = this.getSourceNeurons(normalized, projectId);
        if (sourceNeurons.length === 0) {
            if (existing)
                this.archiveSummaryWithoutRecallableSources(existing);
            return null;
        }
        const latestSourceAt = Math.max(...sourceNeurons.map((neuron) => neuron.metadata.updatedAt || neuron.metadata.createdAt));
        if (existing && !options.forceRebuild && (existing.metadata.updatedAt || existing.metadata.createdAt) >= latestSourceAt) {
            return existing.id;
        }
        const now = Date.now();
        const summaryText = this.buildSummaryText(normalized, sourceNeurons);
        const tags = [SUMMARY_TAG, SUMMARY_SOURCE_TAG, 'source_filter:recallable', `topic:${normalized}`];
        const sourceIds = sourceNeurons.map((neuron) => neuron.id);
        this.summaryStore.insertSummary({
            projectId,
            scope: 'project',
            text: summaryText,
            confidence: 0.86,
            status: 'verified',
            sourceNeuronIds: sourceIds,
            deepWriteRunId: SUMMARY_RUN_ID,
            deepWriteCandidateId: normalized,
            createdAt: now,
            updatedAt: now
        });
        const summaryNeuron = NeuronFactory.create(summaryText, this.memoryGraph.getLatestNeuronSelfHash(projectId) || 'genesis', { T: now, S: [0, 0, 0], V: [] }, {
            projectId,
            topicPath: normalized,
            type: 'doc',
            createdAt: now,
            updatedAt: now,
            tags: existing ? [...tags, `supersedes:${existing.id}`] : tags,
            status: 'active',
            confidence: 0.86,
            importanceLevel: 'normal',
            isPinned: false,
            sourceType: 'llm_inference'
        });
        this.memoryGraph.addNeuron(summaryNeuron);
        if (existing) {
            this.memoryGraph.updateNeuronMetadata(existing.id, {
                status: 'archived',
                updatedAt: now,
                tags: Array.from(new Set([...(existing.metadata.tags || []), `superseded_by:${summaryNeuron.id}`]))
            });
        }
        return summaryNeuron.id;
    }
    listEntries(projectId) {
        return this.memoryGraph.getTopicPaths(projectId)
            .map((path) => normalizeTopicPath(path))
            .filter((path) => Boolean(path))
            .map((topicPath) => {
            const summary = this.getSummaryNeuron(topicPath, projectId);
            if (!summary)
                return null;
            return {
                topicPath,
                projectId: summary.metadata.projectId || '',
                summaryNeuronId: summary.id,
                lastUpdatedAt: summary.metadata.updatedAt || summary.metadata.createdAt,
                coveredNeuronCount: this.getSourceNeurons(topicPath, summary.metadata.projectId).length
            };
        })
            .filter((entry) => Boolean(entry))
            .sort((a, b) => a.topicPath.localeCompare(b.topicPath));
    }
    getSummaryNeuron(topicPath, projectId) {
        const normalized = normalizeTopicPath(topicPath);
        if (!normalized)
            return null;
        const candidates = this.memoryGraph.getNeuronIdsByTopicPrefix(normalized, projectId)
            .map((id) => this.memoryGraph.getNeuron(id))
            .filter((neuron) => Boolean(neuron))
            .filter((neuron) => neuron.metadata.topicPath === normalized
            && neuron.metadata.type === 'doc'
            && (neuron.metadata.status ?? 'active') !== 'archived'
            && this.isSummaryNeuron(neuron));
        candidates.sort((a, b) => (b.metadata.updatedAt || b.metadata.createdAt) - (a.metadata.updatedAt || a.metadata.createdAt));
        return candidates[0] || null;
    }
    getSourceNeurons(topicPath, projectId) {
        return this.memoryGraph.getNeuronIdsByTopicPrefix(topicPath, projectId)
            .map((id) => this.memoryGraph.getNeuron(id))
            .filter((neuron) => Boolean(neuron))
            .filter((neuron) => !this.isSummaryNeuron(neuron))
            .filter((neuron) => isRecallableMemoryEvidence(neuron))
            .sort((a, b) => (b.metadata.updatedAt || b.metadata.createdAt) - (a.metadata.updatedAt || a.metadata.createdAt));
    }
    isSummaryNeuron(neuron) {
        return neuron.metadata.tags?.includes(SUMMARY_TAG) === true;
    }
    buildSummaryText(topicPath, sourceNeurons) {
        const samples = sourceNeurons
            .slice(0, 5)
            .map((neuron) => this.compact(neuron.content))
            .filter(Boolean);
        return [
            `Topic summary for ${topicPath}.`,
            `Covers ${sourceNeurons.length} memories.`,
            ...samples.map((sample) => `- ${sample}`)
        ].join('\n');
    }
    compact(content) {
        return content.replace(/\s+/g, ' ').trim().slice(0, 180);
    }
    archiveSummaryWithoutRecallableSources(summary) {
        const tags = summary.metadata.tags || [];
        this.memoryGraph.updateNeuronMetadata(summary.id, {
            status: 'archived',
            updatedAt: Date.now(),
            tags: Array.from(new Set([...tags, 'governance:no_recallable_topic_sources']))
        });
    }
}
