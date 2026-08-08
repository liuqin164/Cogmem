// ============================================
// Metabolism - 代谢器（后台自主循环）
// 优化：SM-2 遗忘曲线 + stability/repetitions 驱动状态流转
// ============================================

import type { Neuron, NeuronStatus } from '../types/index.js';
import { MemoryGraph } from './MemoryGraph.js';
import { logger } from '../utils/Logger.js';
import { EventStore } from '../store/EventStore.js';

interface IVectorStore {
  addVector(id: string, vector: number[]): void;
  removePoint(id: string): void;
  search(vector: number[], k: number): Array<{ id: string; score: number }>;
}

export class Metabolism {
  private memoryGraph: MemoryGraph;
  private vectorStore: IVectorStore | null = null;
  private eventStore: EventStore | null = null;
  private isRunning = false;
  private lastActivityTime = Date.now();
  private silentPeriod = 30000;
  private metabolismInterval = 60000;
  private batchSize = 1000;

  constructor(memoryGraph: MemoryGraph, vectorStore?: IVectorStore, eventStore?: EventStore) {
    this.memoryGraph = memoryGraph;
    this.vectorStore = vectorStore || null;
    this.eventStore = eventStore || null;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.runMetabolismLoop();
  }

  stop(): void { this.isRunning = false; }

  recordActivity(): void { this.lastActivityTime = Date.now(); }

  getHotMemories(): Neuron[] {
    return this.memoryGraph.getAllNeurons().filter(n => n.metadata.status === 'active');
  }

  setVectorStore(vs: IVectorStore): void { this.vectorStore = vs; }
  setEventStore(es: EventStore): void { this.eventStore = es; }

  private async runMetabolismLoop(): Promise<void> {
    while (this.isRunning) {
      const elapsed = Date.now() - this.lastActivityTime;
      if (elapsed >= this.silentPeriod) {
        await this.performMetabolism();
      }
      await this.sleep(this.metabolismInterval);
    }
  }

  /** 代谢循环 */
  private async performMetabolism(): Promise<void> {
    logger.info('Metabolism: performing batch metabolism cycle');
    this.memoryGraph.transaction(() => {
      this.batchAssociateOrphans();
      this.batchReinforce();
      this.batchTransitionStates();
    });
  }

  /** 批量关联孤立神经元 */
  private batchAssociateOrphans(): void {
    const orphanIds = this.memoryGraph.getOrphanNeuronIds(this.batchSize);
    for (const id of orphanIds) {
      const neuron = this.memoryGraph.getNeuron(id);
      if (!neuron) continue;
      const similar = this.memoryGraph.findSimilarNeurons(neuron.coordinates.V, 5, neuron.metadata.projectId ?? '');
      for (const { id, score } of similar) {
        if (score > 0.8 && !this.memoryGraph.hasSynapse(neuron.id, id)) {
          this.memoryGraph.addSynapse(neuron.id, { targetId: id, type: 'Similar', weight: 0.1 });
        }
      }
    }
  }

  /** 批量强化（基于 repetitions） */
  private batchReinforce(): void {
    const thresholds = [10, 50, 100, 200, 500, 1000];
    const neuronIds = this.memoryGraph.getNeuronIdsForReinforcement(this.batchSize);
    for (const id of neuronIds) {
      const neuron = this.memoryGraph.getNeuron(id);
      if (!neuron) continue;
      const reps = neuron.metadata.repetitions || 0;
      const reached = thresholds.find(t => reps >= t);
      if (!reached) continue;
      for (const synapse of neuron.synapses) {
        const newWeight = Math.min(1.0, synapse.weight + 0.1);
        if (Math.abs(newWeight - synapse.weight) > 0.05) {
          this.memoryGraph.addSynapse(neuron.id, { ...synapse, weight: newWeight });
        }
      }
    }
  }

  /** 批量状态流转（SM-2 驱动） */
  private batchTransitionStates(): void {
    const neuronIds = this.memoryGraph.getNeuronIdsForTransition(this.batchSize);
    let hot = 0, cold = 0, archived = 0;

    for (const id of neuronIds) {
      const neuron = this.memoryGraph.getNeuron(id);
      if (!neuron) continue;

      if (neuron.metadata.isPinned) {
        const previousStatus = neuron.metadata.status || 'active';
        if (previousStatus !== 'active') {
          this.memoryGraph.updateNeuronStatus(neuron.id, 'active');
          if (this.vectorStore && previousStatus === 'archived' && neuron.coordinates.V.length > 0) {
            try {
              this.vectorStore.addVector(neuron.id, neuron.coordinates.V);
            } catch {}
          }
          this.emitLifecycleEvent(neuron, previousStatus, 'active', 1.0);
        }
        hot++;
        continue;
      }

      const stability = neuron.metadata.stability || 1.0;
      const repetitions = neuron.metadata.repetitions || 0;
      const lastActivated = neuron.metadata.lastActivated || neuron.metadata.createdAt;
      const elapsedDays = (Date.now() - lastActivated) / (1000 * 60 * 60 * 24);

      // SM-2 计算当前能量
      const currentEnergy = this.calculateSM2Energy(stability, repetitions, elapsedDays);
      
      // 状态决策
      let newStatus: 'active' | 'cold' | 'archived';
      if (currentEnergy > 0.8 || repetitions >= 100) {
        newStatus = 'active';
        hot++;
      } else if (currentEnergy >= 0.3) {
        newStatus = 'cold';
        cold++;
      } else {
        newStatus = 'archived';
        archived++;
      }

      const previousStatus = neuron.metadata.status || 'active';
      if (newStatus !== previousStatus) {
        this.memoryGraph.updateNeuronStatus(neuron.id, newStatus);

        if (this.vectorStore) {
          try {
            if (newStatus === 'archived') {
              this.vectorStore.removePoint(neuron.id);
            } else if (previousStatus === 'archived' && neuron.coordinates.V.length > 0) {
              this.vectorStore.addVector(neuron.id, neuron.coordinates.V);
            }
          } catch {}
        }

        this.emitLifecycleEvent(neuron, previousStatus, newStatus, currentEnergy);
      }
    }
    logger.info(`Metabolism: Hot=${hot}, Cold=${cold}, Archived=${archived}`);
  }

  private emitLifecycleEvent(
    neuron: Neuron,
    previousStatus: NeuronStatus,
    nextStatus: NeuronStatus,
    currentEnergy: number
  ): void {
    if (!this.eventStore) return;

    if (nextStatus === 'archived') {
      this.eventStore.append({
        streamId: neuron.id,
        streamType: 'neuron',
        eventType: 'ARCHIVED',
        projectId: neuron.metadata.projectId,
        sourceNeuronId: neuron.id,
        payload: {
          neuronId: neuron.id,
          previousStatus,
          nextStatus,
          currentEnergy,
          repetitions: neuron.metadata.repetitions || 0,
          stability: neuron.metadata.stability || 1.0
        }
      });
      return;
    }

    if (previousStatus === 'archived' && (nextStatus === 'cold' || nextStatus === 'active')) {
      this.eventStore.append({
        streamId: neuron.id,
        streamType: 'neuron',
        eventType: 'RESTORED',
        projectId: neuron.metadata.projectId,
        sourceNeuronId: neuron.id,
        payload: {
          neuronId: neuron.id,
          previousStatus,
          nextStatus,
          currentEnergy,
          repetitions: neuron.metadata.repetitions || 0,
          stability: neuron.metadata.stability || 1.0
        }
      });
    }
  }

  /** SM-2 能量计算: E = exp(-days / stability) * (1 + log10(repetitions + 1)) */
  private calculateSM2Energy(stability: number, repetitions: number, elapsedDays: number): number {
    const forgettingFactor = Math.exp(-elapsedDays / stability);
    const reinforcementFactor = 1 + Math.log10(repetitions + 1);
    return Math.min(1.0, forgettingFactor * reinforcementFactor);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
