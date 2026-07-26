// ============================================
// 反思模块 - 突触权重更新 + 短期转长期记忆 + SM-2 遗忘曲线
// ============================================
import { SynapseUtils } from './Synapse.js';
import { logger } from '../utils/Logger.js';
import { projectScope } from '../topology/ProjectScope.js';
export class Reflection {
    memoryGraph;
    activationLog = new Map();
    coOccurrenceMap = new Map();
    constructor(memoryGraph) {
        this.memoryGraph = memoryGraph;
    }
    /** 每日权重更新 */
    async dailyWeightUpdate() {
        logger.info('Running daily weight update...');
        const coOccurrences = await this.findCoOccurrences();
        for (const [pair, count] of coOccurrences) {
            const [sourceId, targetId] = pair;
            const synapse = this.getSynapse(sourceId, targetId);
            if (synapse) {
                const strengthened = SynapseUtils.strengthen(synapse, count * 0.1);
                this.updateSynapse(sourceId, strengthened);
            }
        }
        // SM-2 遗忘曲线
        await this.applySM2Forgetting();
        this.coOccurrenceMap.clear();
        logger.info('Daily weight update completed');
    }
    /** 动态触发：频繁激活 → 短期转长期 + 增加 stability */
    onNeuronActivated(neuronId) {
        const now = Date.now();
        const activations = this.activationLog.get(neuronId) || [];
        activations.push(now);
        const recent = activations.filter(t => now - t < 3600000);
        this.activationLog.set(neuronId, recent);
        const neuron = this.memoryGraph.getNeuron(neuronId);
        if (neuron) {
            // 更新激活计数
            const newCount = (neuron.metadata.activationCount || 0) + 1;
            // SM-2: 增加 stability（稳定性），上限 2.5
            const newStability = Math.min(2.5, (neuron.metadata.stability || 1.0) + 0.1);
            const newRepetitions = (neuron.metadata.repetitions || 0) + 1;
            this.memoryGraph.updateNeuronMetadata(neuronId, {
                lastActivated: now,
                activationCount: newCount,
                stability: newStability,
                repetitions: newRepetitions,
            });
        }
        if (recent.length >= 5) {
            this.boostSynapses(neuronId);
            if (neuron)
                this.detectAndCreateOverrides(neuron);
        }
        this.recordCoOccurrence(neuronId);
    }
    /** SM-2 遗忘曲线: CurrentWeight = BaseWeight * exp(-elapsedTime_in_days / stability) */
    async applySM2Forgetting() {
        const allNeurons = this.memoryGraph.getAllNeurons();
        const now = Date.now();
        for (const neuron of allNeurons) {
            const lastActivated = neuron.metadata.lastActivated || neuron.metadata.createdAt;
            const stability = neuron.metadata.stability || 1.0;
            const elapsedDays = (now - lastActivated) / (1000 * 60 * 60 * 24);
            for (const synapse of neuron.synapses) {
                // SM-2 公式
                const decayFactor = Math.exp(-elapsedDays / stability);
                const newWeight = synapse.weight * decayFactor;
                this.memoryGraph.addSynapse(neuron.id, { ...synapse, weight: Math.max(0, newWeight) });
            }
        }
        logger.info(`SM-2 forgetting applied to ${allNeurons.length} neurons`);
    }
    /** 检测并创建 Overrides 突触 */
    detectAndCreateOverrides(newNeuron, vectorSearchFn) {
        const conflicting = this.findConflictingNeurons(newNeuron, vectorSearchFn);
        for (const oldNeuron of conflicting) {
            const timeDiffDays = (newNeuron.metadata.createdAt - oldNeuron.metadata.createdAt) / (1000 * 60 * 60 * 24);
            const dynamicWeight = Math.min(0.5 + Math.abs(timeDiffDays) * 0.05, 1.0);
            this.memoryGraph.addSynapse(newNeuron.id, {
                targetId: oldNeuron.id,
                type: 'Overrides',
                weight: dynamicWeight
            });
            logger.debug(`Created override: ${newNeuron.id} → ${oldNeuron.id}`);
        }
    }
    /** 查找冲突的旧记忆（向量检索 + 极性碰撞） */
    findConflictingNeurons(newNeuron, vectorSearchFn) {
        const conflicting = [];
        const SIMILARITY_THRESHOLD = 0.85;
        const TIME_WINDOW_DAYS = 30;
        const now = Date.now();
        const windowStart = now - TIME_WINDOW_DAYS * 24 * 60 * 60 * 1000;
        // 向量检索优先
        if (vectorSearchFn && newNeuron.coordinates.V.length > 0) {
            const candidates = vectorSearchFn(newNeuron.coordinates.V, 50);
            for (const { id, score } of candidates) {
                if (score < SIMILARITY_THRESHOLD)
                    continue;
                const old = this.memoryGraph.getNeuron(id);
                if (!old || old.id === newNeuron.id)
                    continue;
                if (projectScope(old.metadata.projectId) !== projectScope(newNeuron.metadata.projectId))
                    continue;
                if (old.metadata.createdAt < windowStart)
                    continue;
                if (old.metadata.type !== newNeuron.metadata.type)
                    continue;
                if (this.checkPolarityCollision(newNeuron, old)) {
                    conflicting.push(old);
                }
            }
        }
        return conflicting;
    }
    /** 极性碰撞检测 */
    checkPolarityCollision(a, b) {
        const pos = ['是', '会', '能', '正确', 'yes', 'true', '确认'];
        const neg = ['不是', '不会', '不能', '错误', 'no', 'false', '否认', '取消'];
        const aLower = a.content.toLowerCase();
        const bLower = b.content.toLowerCase();
        const aHasPos = pos.some(k => aLower.includes(k));
        const aHasNeg = neg.some(k => aLower.includes(k));
        const bHasPos = pos.some(k => bLower.includes(k));
        const bHasNeg = neg.some(k => bLower.includes(k));
        return (aHasPos && bHasNeg) || (aHasNeg && bHasPos);
    }
    // --- 原有方法保留 ---
    async findCoOccurrences() {
        const coOccurrences = new Map();
        for (const [neuronId, relatedIds] of this.coOccurrenceMap) {
            for (const relatedId of relatedIds.keys()) {
                const pair = [neuronId, relatedId].sort().join('-');
                coOccurrences.set(pair, (coOccurrences.get(pair) || 0) + 1);
            }
        }
        return coOccurrences;
    }
    recordCoOccurrence(neuronId) {
        if (!this.coOccurrenceMap.has(neuronId)) {
            this.coOccurrenceMap.set(neuronId, new Map());
        }
        const related = this.coOccurrenceMap.get(neuronId);
        const synapses = this.memoryGraph.getSynapses(neuronId);
        for (const synapse of synapses) {
            related.set(synapse.targetId, (related.get(synapse.targetId) || 0) + 1);
        }
    }
    boostSynapses(neuronId) {
        const synapses = this.memoryGraph.getSynapses(neuronId);
        for (const synapse of synapses) {
            this.updateSynapse(neuronId, SynapseUtils.strengthen(synapse, 0.2));
        }
    }
    getSynapse(sourceId, targetId) {
        return this.memoryGraph.getSynapses(sourceId).find(s => s.targetId === targetId) || null;
    }
    updateSynapse(sourceId, synapse) {
        this.memoryGraph.addSynapse(sourceId, synapse);
    }
    async createAnchor(neuronIds, projectId) {
        return this.memoryGraph.createAnchor(neuronIds, projectId);
    }
    getActivationStats() {
        let total = 0;
        const top = [];
        for (const [id, acts] of this.activationLog) {
            total += acts.length;
            top.push({ id, count: acts.length });
        }
        top.sort((a, b) => b.count - a.count);
        return { totalActivations: total, activeNeurons: this.activationLog.size, topActivated: top.slice(0, 10) };
    }
    cleanupOldActivations(maxAge = 86400000) {
        const now = Date.now();
        for (const [id, acts] of this.activationLog) {
            const recent = acts.filter(t => now - t < maxAge);
            if (recent.length === 0)
                this.activationLog.delete(id);
            else
                this.activationLog.set(id, recent);
        }
    }
}
