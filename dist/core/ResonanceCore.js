// ============================================
// 共振核心 - 能量传导算法（含推理链强化 + 置信度乘数）
// ============================================
import { config } from '../utils/Config.js';
import { projectScope } from '../topology/ProjectScope.js';
export class ResonanceCore {
    static chainStore = null;
    static setChainStore(store) {
        this.chainStore = store;
    }
    /** 能量传导（含推理链强化 + 置信度乘数） */
    static async propagateEnergy(anchorNeuron, getNeuron, maxHops = 5) {
        const energyMap = new Map();
        const queue = [
            { neuronId: anchorNeuron.id, energy: config.energy.initialEnergy, hops: 0 }
        ];
        const visited = new Set();
        while (queue.length > 0) {
            const { neuronId, energy, hops } = queue.shift();
            if (visited.has(neuronId) || hops > maxHops)
                continue;
            visited.add(neuronId);
            const neuron = getNeuron(neuronId);
            if (!neuron || neuron.metadata.status === 'suspect')
                continue;
            if (projectScope(neuron.metadata.projectId) !== projectScope(anchorNeuron.metadata.projectId))
                continue;
            if (neuron.metadata.status === 'cold' || neuron.metadata.status === 'archived')
                continue;
            // 置信度乘数
            const confidence = neuron.metadata.confidence ?? 1.0;
            const decayedEnergy = this.calculateDecayedEnergy(energy, hops) * confidence;
            const existing = energyMap.get(neuronId) || 0;
            energyMap.set(neuronId, Math.max(existing, decayedEnergy));
            for (const synapse of neuron.synapses) {
                const target = getNeuron(synapse.targetId);
                if (!target || projectScope(target.metadata.projectId) !== projectScope(anchorNeuron.metadata.projectId))
                    continue;
                // 推理链强化：同一链内 Sequence 突触衰减系数提升至 0.85
                const decayFactor = this.getDecayFactor(synapse, neuronId);
                const nextEnergy = decayedEnergy * synapse.weight * decayFactor;
                queue.push({ neuronId: synapse.targetId, energy: nextEnergy, hops: hops + 1 });
            }
        }
        return energyMap;
    }
    /** 获取衰减系数（推理链强化） */
    static getDecayFactor(synapse, sourceId) {
        if (synapse.type === 'Sequence' && this.chainStore) {
            if (this.chainStore.areNeuronsInSameChain(sourceId, synapse.targetId)) {
                return 0.85; // 同一推理链，强化
            }
        }
        return this.getSynapseDecay(synapse.type);
    }
    /** 突触类型衰减系数 */
    static getSynapseDecay(type) {
        const DECAY = {
            'Caused_by': 0.9,
            'Sequence': 0.6,
            'Similar': 0.75,
            'Referenced': 0.8,
            'Overrides': 0.95,
            'Default': 0.8
        };
        return DECAY[type] || DECAY.Default;
    }
    static calculateDecayedEnergy(initialEnergy, hops) {
        return initialEnergy * Math.pow(0.8, hops);
    }
    /** 应用能量排序（含置信度） */
    static applyEnergyRanking(candidates, energyMap, temporalOp, spatialOp) {
        const overriddenIds = new Set();
        for (const neuron of candidates) {
            const overrides = neuron.synapses.filter(s => s.type === 'Overrides');
            for (const override of overrides) {
                overriddenIds.add(override.targetId);
            }
        }
        const filtered = candidates.filter(n => !overriddenIds.has(n.id));
        return filtered.map(neuron => {
            let energy = energyMap.get(neuron.id) || 50;
            // 置信度加成
            const confidence = neuron.metadata.confidence ?? 1.0;
            energy *= confidence;
            if (temporalOp)
                energy += this.calculateTemporalEnergy(neuron, temporalOp);
            if (spatialOp)
                energy += this.calculateSpatialEnergy(neuron, spatialOp);
            return { neuron, energy };
        }).sort((a, b) => b.energy - a.energy);
    }
    static calculateTemporalEnergy(neuron, op) {
        const ts = neuron.coordinates.T;
        if (op.type === 'range' && op.start && op.end) {
            return (ts >= op.start && ts <= op.end) ? 50 : Math.max(-30, 50 - Math.min(Math.abs(ts - op.start), Math.abs(ts - op.end)) / 30 * 50);
        }
        if (op.type === 'dynamic' && op.threshold) {
            return ts >= op.threshold ? 50 : Math.max(-30, 50 - (op.threshold - ts) / 30 * 50);
        }
        return 0;
    }
    static calculateSpatialEnergy(neuron, op) {
        const [x, y] = neuron.coordinates.S;
        if (op.type === 'point' && op.center) {
            const dist = Math.sqrt(Math.pow(x - op.center[0], 2) + Math.pow(y - op.center[1], 2));
            return dist <= (op.radius || 10) ? 40 : Math.max(-20, 40 - dist * 2);
        }
        if (op.type === 'gravity' && op.center) {
            const dist = Math.sqrt(Math.pow(x - op.center[0], 2) + Math.pow(y - op.center[1], 2));
            return Math.max(0, 40 * (op.weight || 0.1) / (1 + dist / 100));
        }
        return 0;
    }
    static calculateTotalEnergy(energyMap) {
        return Array.from(energyMap.values()).reduce((sum, e) => sum + e, 0);
    }
    static calculateResonanceDepth(energyMap) {
        return Array.from(energyMap.values()).filter(e => e > 0).length;
    }
}
