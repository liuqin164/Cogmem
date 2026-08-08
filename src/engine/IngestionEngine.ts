// @ts-nocheck
// ============================================
// 摄取引擎 - 日志/对话 → 神经元（含双重去重）
// ============================================

import type { Neuron, IngestInput, NeuronCoordinates, NeuronMetadata } from '../types/index.js';
import { NeuronFactory } from '../core/Neuron.js';
import { HashUtils } from '../utils/hash.js';
import { Embedder } from '../store/Embedder.js';
import { aaakGenerator } from '../utils/AAAKGenerator.js';
import { IMPORTANCE_STABILITY_MAP } from '../core/ImportanceLevels.js';
import { ImportanceSignalDetector } from './ImportanceSignalDetector.js';
import { config } from '../utils/Config.js';
import { projectScope } from '../topology/ProjectScope.js';

/** 去重检查结果 */
interface DedupResult {
  isDuplicate: boolean;
  existingNeuronId?: string;
  similarity?: number;
}

interface IngestRuntimeOptions {
  prevNeuronSelfHash?: string | null;
}

export class IngestionEngine {
  private embedder: Embedder;
  private projectId?: string;
  private vectorSearchFn?: (vector: number[], k: number) => Array<{ id: string; score: number }>;
  private getNeuronFn?: (id: string) => Neuron | null;
  private activateNeuronFn?: (id: string) => void;

  constructor(
    embedder: Embedder,
    projectId?: string,
    private readonly vectorDimension: number = config.vector.dimension
  ) {
    this.embedder = embedder;
    this.projectId = projectId;
  }

  /** 设置去重所需的依赖 */
  setDedupDeps(
    vectorSearchFn: (vector: number[], k: number) => Array<{ id: string; score: number }>,
    getNeuronFn: (id: string) => Neuron | null,
    activateNeuronFn: (id: string) => void
  ): void {
    this.vectorSearchFn = vectorSearchFn;
    this.getNeuronFn = getNeuronFn;
    this.activateNeuronFn = activateNeuronFn;
  }

  /** 摄取输入并创建神经元（含双重去重） */
  async ingest(
    input: IngestInput,
    options: IngestRuntimeOptions = {}
  ): Promise<{ neuron: Neuron; isDuplicate: boolean; activatedId?: string }> {
    const createdAt = input.createdAt ?? Date.now();
    const updatedAt = input.updatedAt ?? createdAt;
    // 1. 计算语义向量
    const V = await this.embedder.embed(input.content);

    // 2. 双重去重检查
    const effectiveProjectId = input.projectId ?? this.projectId;
    const dedupResult = await this.checkDuplicate(input.content, V, effectiveProjectId);
    if (dedupResult.isDuplicate && dedupResult.existingNeuronId) {
      // 高度雷同：激活旧神经元，不创建新的
      this.activateNeuronFn?.(dedupResult.existingNeuronId);
      const existingNeuron = this.getNeuronFn?.(dedupResult.existingNeuronId);
      if (existingNeuron) {
        return { neuron: existingNeuron, isDuplicate: true, activatedId: dedupResult.existingNeuronId };
      }
    }

    // 3. 计算坐标
    const coordinates: NeuronCoordinates = {
      T: createdAt,
      S: this.calculateSpatialCoordinates(input.filePath),
      V
    };

    // 4. 计算 self_hash（内容 + 时间戳 + 随机数防碰撞）
    const nonce = Math.random().toString(36).substring(2, 10);
    const selfHash = HashUtils.computeSelfHash(input.content, coordinates.T, coordinates.S);

    // 5. 计算 prev_hash
    const prevHash = HashUtils.computePrevHash(options.prevNeuronSelfHash || null);

    // 6. 创建元数据
    const detectedImportance = input.importanceLevel || ImportanceSignalDetector.detect(input.content);
    const isPinned = input.isPinned ?? detectedImportance !== 'normal';
    const metadata: NeuronMetadata = {
      projectId: effectiveProjectId,
      topicPath: input.topicPath,
      filePath: input.filePath,
      type: input.type,
      createdAt,
      updatedAt,
      tags: input.tags,
      confidence: 1.0,
      sourceType: input.sourceType || 'user_input',
      sourceEventId: input.sourceEventId,
      sourceRefs: input.sourceRefs,
      stability: IMPORTANCE_STABILITY_MAP[detectedImportance],
      repetitions: 0,
      importanceLevel: detectedImportance,
      isPinned
    };

    // 7. 创建神经元
    const neuron = NeuronFactory.create(input.content, prevHash, { ...coordinates }, metadata);
    neuron.self_hash = selfHash;

    // 8. 生成 AAAK 摘要
    const importance = this.calculateImportance(input.content);
    neuron.metadata.aaak_summary = await aaakGenerator.generateSummary(input.content, input.type, importance);

    return { neuron, isDuplicate: false };
  }

  /** 双重去重检查 */
  private async checkDuplicate(content: string, vector: number[], projectId?: string): Promise<DedupResult> {
    const SIMILARITY_THRESHOLD = 0.98;

    // 检查 1: self_hash 验证（基于内容的快速检查）
    const contentHash = HashUtils.sha256(content);
    // 这里可以维护一个内存中的 contentHash → neuronId 映射进行快速查找

    // 检查 2: 向量相似度拦截
    if (this.vectorSearchFn && this.getNeuronFn) {
      const candidates = this.vectorSearchFn(vector, 10);
      for (const { id, score } of candidates) {
        if (score >= SIMILARITY_THRESHOLD) {
          const existing = this.getNeuronFn(id);
          if (existing && projectScope(projectId) === projectScope(existing.metadata.projectId)) {
            return { isDuplicate: true, existingNeuronId: id, similarity: score };
          }
        }
      }
    }

    return { isDuplicate: false };
  }

  /** 同步摄取（用于事务） */
  ingestSync(input: IngestInput, options: IngestRuntimeOptions = {}): Neuron {
    const T = input.createdAt ?? Date.now();
    const updatedAt = input.updatedAt ?? T;
    const S = this.calculateSpatialCoordinates(input.filePath);
    const hash = HashUtils.sha256(input.content);
    const V: number[] = [];
    for (let i = 0; i < this.vectorDimension; i++) {
      V.push((hash.charCodeAt(i % hash.length) - 48) / 48 * 2 - 1);
    }

    const prevHash = HashUtils.computePrevHash(options.prevNeuronSelfHash || null);
    const detectedImportance = input.importanceLevel || ImportanceSignalDetector.detect(input.content);
    const isPinned = input.isPinned ?? detectedImportance !== 'normal';
    const metadata: NeuronMetadata = {
      projectId: input.projectId ?? this.projectId,
      topicPath: input.topicPath,
      filePath: input.filePath,
      type: input.type,
      createdAt: T,
      updatedAt,
      tags: input.tags,
      confidence: 1.0,
      sourceType: input.sourceType || 'user_input',
      sourceEventId: input.sourceEventId,
      sourceRefs: input.sourceRefs,
      stability: IMPORTANCE_STABILITY_MAP[detectedImportance],
      repetitions: 0,
      importanceLevel: detectedImportance,
      isPinned
    };

    const importance = this.calculateImportance(input.content);
    const neuron = NeuronFactory.create(input.content, prevHash, { T, S, V }, metadata);
    neuron.metadata.aaak_summary = aaakGenerator.generateSummarySync(input.content, input.type, importance);
    return neuron;
  }

  /** 批量摄取 */
  async ingestBatch(inputs: IngestInput[]): Promise<Array<{ neuron: Neuron; isDuplicate: boolean }>> {
    const results: Array<{ neuron: Neuron; isDuplicate: boolean }> = [];
    for (const input of inputs) {
      const result = await this.ingest(input);
      results.push(result);
    }
    return results;
  }

  /** 计算空间坐标 */
  private calculateSpatialCoordinates(filePath?: string): [number, number, number] {
    if (!filePath) return [0, 0, 0];
    const depth = filePath.split('/').length;
    const nameHash = HashUtils.sha256(filePath);
    const x = depth % 100;
    const y = parseInt(nameHash.substring(0, 8), 16) % 100;
    const z = this.getFileTypeCode(filePath);
    return [x, y, z];
  }

  /** 获取文件类型代码 */
  private getFileTypeCode(filePath: string): number {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const codes: Record<string, number> = {
      'ts': 1, 'js': 2, 'json': 3, 'md': 4, 'txt': 5, 'py': 6, 'rb': 7, 'go': 8, 'rs': 9
    };
    return codes[ext] || 0;
  }

  /** 计算重要性权重 */
  private calculateImportance(content: string): number {
    const len = content.length;
    if (len < 50) return 1;
    if (len < 100) return 2;
    if (len < 200) return 3;
    if (len < 500) return 4;
    return 5;
  }

  setProjectId(id: string): void { this.projectId = id; }
  getProjectId(): string | undefined { return this.projectId; }
}
