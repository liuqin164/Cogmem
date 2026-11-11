import { expect, test } from 'bun:test';

import * as publicApi from '../src/public.js';

test('public API does not expose internal-only implementation modules', () => {
  expect(Object.hasOwn(publicApi, 'MemoryKernel')).toBe(true);
  expect(Object.hasOwn(publicApi, 'createMemoryKernel')).toBe(true);
  expect(Object.hasOwn(publicApi, 'createMemoryKernelFromConfig')).toBe(true);
  expect(Object.hasOwn(publicApi, 'loadCogmemConfig')).toBe(true);
  expect(Object.hasOwn(publicApi, 'KernelAgentMemoryBackend')).toBe(true);
  expect(Object.hasOwn(publicApi, 'compileAgentRecallQuery')).toBe(true);
  expect(Object.hasOwn(publicApi, 'explainRecallWithKernel')).toBe(true);
  // The MCP tool registry left the public entry with its surface (R2 of #200).
  expect(Object.hasOwn(publicApi, 'listCogmemMcpTools')).toBe(false);
  expect(Object.hasOwn(publicApi, 'callCogmemMcpTool')).toBe(false);

  expect(Object.hasOwn(publicApi, 'createMemoryKernelFromEnv')).toBe(false);
  expect(Object.hasOwn(publicApi, 'loadAgentBrainEnv')).toBe(false);
  expect(Object.hasOwn(publicApi, 'applyCogmemConfigToEnv')).toBe(false);
  expect(Object.hasOwn(publicApi, 'EventStore')).toBe(false);
  expect(Object.hasOwn(publicApi, 'CompilerConfidenceStore')).toBe(false);
  expect(Object.hasOwn(publicApi, 'DeepWriteCandidateStore')).toBe(false);
});
