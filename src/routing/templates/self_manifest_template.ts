import { asRecord, stringOrEmpty } from '../../utils/Values.js';
function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function formatEnvironmentReply(data: unknown): string {
  const env = asRecord(data);
  const runtime = asRecord(env.runtime);
  const networkPolicy = stringOrEmpty(env.networkPolicy) || 'unknown';
  return [
    '当前运行环境：',
    `• workspace: ${stringOrEmpty(env.workspaceRoot) || stringOrEmpty(env.cwd) || 'unknown'}`,
    `• platform: ${stringOrEmpty(env.platform) || 'unknown'}`,
    `• runtime: bun=${stringOrEmpty(runtime.bun) || 'unknown'}, node=${stringOrEmpty(runtime.node) || 'unknown'}`,
    `• packageManager: ${stringOrEmpty(env.packageManager) || 'unknown'}`,
    `• networkPolicy: ${networkPolicy}`
  ].join('\n');
}

export function formatModelsReply(data: unknown): string {
  const modelManifest = asRecord(data);
  const roles = arrayOfRecords(modelManifest.roles);
  if (roles.length === 0) return '当前没有可用模型信息。';
  const lines = roles.map((role) => {
    const caps = arrayOfStrings(role.capabilities).join(', ') || 'none';
    return `• ${stringOrEmpty(role.role)}: ${stringOrEmpty(role.provider)} ${stringOrEmpty(role.modelName)} [${stringOrEmpty(role.locality)}] capabilities=${caps}`;
  });
  return `当前模型能力：\n${lines.join('\n')}`;
}

export function formatFileAssetsReply(data: unknown): string {
  const fileAssets = asRecord(data);
  const supported = arrayOfStrings(fileAssets.supportedExtensions);
  const planned = arrayOfStrings(fileAssets.unsupportedPlannedKinds);
  return [
    '当前文件资产能力：',
    `• 已支持：${supported.join(', ') || 'none'}`,
    `• 已索引文件数：${Number(fileAssets.indexedAssetCount || 0)}`,
    `• 已索引 chunk 数：${Number(fileAssets.indexedChunkCount || 0)}`,
    `• 尚未实现：${planned.join(', ') || 'none'}`
  ].join('\n');
}

export function formatSelfManifestReply(data: unknown): string {
  const manifest = asRecord(data);
  const capabilities = arrayOfRecords(manifest.capabilities);
  const constraints = arrayOfRecords(manifest.constraints);
  const fileAssets = asRecord(manifest.fileAssets);
  return [
    `当前运行时自我清单：${stringOrEmpty(manifest.manifestId) || 'unknown'}`,
    `• capabilities: ${capabilities.length}`,
    `• fileAssets: ${Number(fileAssets.indexedAssetCount || 0)} files / ${Number(fileAssets.indexedChunkCount || 0)} chunks`,
    `• constraints: ${constraints.map((constraint) => stringOrEmpty(constraint.id)).filter(Boolean).join(', ') || 'none'}`
  ].join('\n');
}

