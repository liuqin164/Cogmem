import { expect, test } from 'bun:test';
import packageMetadata from '../package.json';
import { CORE_VERSION } from '../src/version.js';

test('runtime and MCP version use package metadata', () => {
  expect(CORE_VERSION).toBe(packageMetadata.version);
});

test('core public entrypoint exposes backend primitives', async () => {
  const api = await import('../src/public.js');

  expect(typeof api.createMemoryKernel).toBe('function');
  expect(typeof api.createMemoryKernelFromConfig).toBe('function');
  expect(typeof api.loadCogmemConfig).toBe('function');
  expect(typeof api.KernelAgentMemoryBackend).toBe('function');
  expect(typeof api.OpenClawWorkspaceProfile).toBe('function');
  expect(typeof api.HermesWorkspaceProfile).toBe('function');
  expect(typeof api.explainRecallWithKernel).toBe('function');
  expect(typeof api.listCogmemMcpTools).toBe('function');
  expect(typeof api.callCogmemMcpTool).toBe('function');
  expect(typeof api.UniverseNavigator).toBe('function');
  expect(typeof api.PulseRetrievalEngine).toBe('function');
  expect(typeof api.TemporalBranchSearch).toBe('function');
  expect(typeof api.NarrativeRecallAssembler).toBe('function');
  expect('createMemoryKernelFromEnv' in api).toBe(false);
  expect('loadAgentBrainEnv' in api).toBe(false);
});
