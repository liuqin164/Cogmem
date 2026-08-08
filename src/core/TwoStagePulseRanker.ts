// ============================================
// 二级脉冲 - 高性能检索（QueryIR 驱动）
// ============================================

import type { Neuron, QueryOptions, QueryResult } from '../types/index.js';
import type { QueryIR, TemporalConstraint } from '../types/query-ir.js';
import type { TemporalOperator, SpatialOperator } from '../types/index.js';
import { config } from '../utils/Config.js';
import { logger } from '../utils/Logger.js';
import type { IVectorStore } from '../store/IVectorStore.js';
import { ResonanceCore } from './ResonanceCore.js';
import { projectScope } from '../topology/ProjectScope.js';

export class TwoStagePulseRanker {
  private vectorStore: IVectorStore;
  private topK: number;

  constructor(vectorStore: IVectorStore, topK: number = config.vector.topK) {
    this.vectorStore = vectorStore;
    this.topK = topK;
  }

  async query(
    queryVector: number[],
    getNeuron: (id: string) => Neuron | null,
    ir: QueryIR
  ): Promise<QueryResult> {
    const startTime = Date.now();

    const semanticCandidates = await this.vectorStore.search(queryVector, this.topK);
    const candidates: Neuron[] = [];
    for (const { id } of semanticCandidates) {
      const neuron = getNeuron(id);
      if (neuron) candidates.push(neuron);
    }

    const hardFiltered = this.applyHardConstraints(candidates, ir);
    const energyMap = new Map<string, number>();
    for (const { id, score } of semanticCandidates) {
      if (hardFiltered.some(n => n.id === id)) {
        energyMap.set(id, score * config.energy.initialEnergy);
      }
    }

    const temporalOp = this.convertTemporalConstraint(ir.temporal);
    const spatialOp = this.convertSpatialConstraint(ir.spatial);
    const ranked = ResonanceCore.applyEnergyRanking(hardFiltered, energyMap, temporalOp, spatialOp);
    const sortedNeurons = ranked.sort((a, b) => b.energy - a.energy).map(r => r.neuron);

    return {
      neurons: sortedNeurons,
      totalEnergy: ResonanceCore.calculateTotalEnergy(energyMap),
      resonanceDepth: ResonanceCore.calculateResonanceDepth(energyMap),
      queryTime: Date.now() - startTime
    };
  }

  private convertTemporalConstraint(constraint: TemporalConstraint): TemporalOperator {
    if (constraint.start || constraint.end) {
      return { type: 'range', start: constraint.start, end: constraint.end };
    }
    if (constraint.relative) {
      const range = this.resolveRelativeTime(constraint.relative);
      return { type: 'range', start: range.start, end: range.end };
    }
    return { type: 'range' };
  }

  private convertSpatialConstraint(constraint: any): SpatialOperator {
    if (constraint.projectId !== undefined) {
      return { type: 'point', center: [0, 0], radius: 100 };
    }
    return { type: 'point', center: [0, 0], radius: 100 };
  }

  private resolveRelativeTime(relative: string): { start: number; end: number } {
    const now = Date.now();
    const day = 86400000;
    const today = new Date().setHours(0, 0, 0, 0);

    switch (relative) {
      case 'today': return { start: today, end: now };
      case 'yesterday': return { start: today - day, end: today };
      case 'this_week': return { start: today - (new Date(today).getDay() * day), end: now };
      case 'last_week': return { start: today - ((new Date(today).getDay() + 7) * day), end: today };
      case 'this_month': return { start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime(), end: now };
      case 'last_month': return { start: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).getTime(), end: new Date(new Date().getFullYear(), new Date().getMonth(), 0).getTime() };
      case 'this_year': return { start: new Date(new Date().getFullYear(), 0, 1).getTime(), end: now };
      case 'last_year': return {
        start: new Date(new Date().getFullYear() - 1, 0, 1).getTime(),
        end: new Date(new Date().getFullYear(), 0, 1).getTime()
      };
      case 'past_six_months': return {
        start: new Date(new Date().getFullYear(), new Date().getMonth() - 6, new Date().getDate()).getTime(),
        end: now
      };
      case 'past_year': return {
        start: new Date(new Date().getFullYear() - 1, new Date().getMonth(), new Date().getDate()).getTime(),
        end: now
      };
      case 'around_half_year_ago': {
        const center = new Date(new Date().getFullYear(), new Date().getMonth() - 6, new Date().getDate()).getTime();
        return { start: center - 30 * day, end: center + 30 * day };
      }
      default: return { start: 0, end: now };
    }
  }

  private applyHardConstraints(neurons: Neuron[], ir: QueryIR): Neuron[] {
    let filtered = neurons;

    if (ir.temporal.start !== undefined || ir.temporal.end !== undefined) {
      const start = ir.temporal.start ?? 0;
      const end = ir.temporal.end ?? Date.now();
      filtered = filtered.filter(n => {
        const ts = n.coordinates.T;
        return ts >= start && ts < end;
      });
    } else if (ir.temporal.relative) {
      const range = this.resolveRelativeTime(ir.temporal.relative);
      filtered = filtered.filter(n => {
        const ts = n.coordinates.T;
        return ts >= range.start && ts < range.end;
      });
    }

    if (ir.spatial.projectId !== undefined) {
      filtered = filtered.filter(n => projectScope(n.metadata.projectId) === projectScope(ir.spatial.projectId));
    }

    if (ir.spatial.fileType) {
      filtered = filtered.filter(n => {
        const ext = n.metadata.filePath?.split('.').pop()?.toLowerCase();
        return ext === ir.spatial.fileType?.toLowerCase();
      });
    }

    for (const kw of ir.mustMatch) {
      filtered = filtered.filter(n => n.content.toLowerCase().includes(kw.toLowerCase()));
    }

    return filtered;
  }

  setTopK(k: number): void { this.topK = k; }
  getTopK(): number { return this.topK; }
}
