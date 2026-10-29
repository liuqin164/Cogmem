import { describe, expect, test } from 'bun:test';

import { MemoryGraph } from '../src/core/MemoryGraph.js';
import { TopicClassifier } from '../src/recall/TopicClassifier.js';
import { createMemoryKernel } from '../src/public.js';

describe('Chinese language support v1.13', () => {
  test('TopicClassifier can classify Chinese content without pre-existing topic history', () => {
    const graph = new MemoryGraph(':memory:');
    const classifier = new TopicClassifier(graph);

    const result = classifier.classify('记忆内核需要完成快照导入、向量索引和中文召回评估。', 'zh');

    expect(result.strategy).toBe('lexical');
    expect(result.topicPath).toBe('工程/记忆内核');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    graph.close();
  });

  test('MemoryKernel.ingest applies Chinese topic paths and recall remains project-scoped', async () => {
    const kernel = createMemoryKernel();

    const neuron = await kernel.ingest({
      projectId: 'zh-project',
      content: '今天讨论记忆内核的快照导入、向量索引和中文召回评估。',
      sourceType: 'chat',
    });
    await kernel.ingest({
      projectId: 'other-project',
      content: '支付宝风控团队评审支付欺诈检测策略。',
      sourceType: 'chat',
    });

    expect(neuron.metadata.topicPath).toBe('工程/记忆内核');
    const recall = kernel.searchEvidence('中文召回评估', { projectId: 'zh-project', limit: 5 });
    expect(recall.rawEvidence.some((item) => item.content.includes('中文召回评估'))).toBe(true);
    expect(recall.rawEvidence.every((item) => item.metadata.projectId === 'zh-project')).toBe(true);
    kernel.close();
  });
});
