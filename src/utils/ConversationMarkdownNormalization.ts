import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type NormalizationFamily =
  | 'jsonl_transcript_export'
  | 'json_array_transcript_export'
  | 'csv_transcript_export'
  | 'tsv_transcript_export'
  | 'app_private_mixed_event_export'
  | 'jsonl_mixed_event_log_export';

export type NormalizedSourceFamily = 'normalized_conversation_markdown';

export interface NormalizationMetadata {
  isNormalized: boolean;
  contractVersion?: 'v1';
  normalizedSourceFamily?: NormalizedSourceFamily;
  originalInputFamily?: NormalizationFamily;
  title?: string;
  onboardingPath?: string;
}

export interface NormalizedMessage {
  role: 'user' | 'agent' | 'system' | 'narrator';
  text: string;
  timestamp: string;
  source?: NormalizedMessageSource;
}

export interface NormalizedMessageSource {
  sourceOffset: number;
  lineStart?: number;
  lineEnd?: number;
  charStart?: number;
  charEnd?: number;
  orderingConfidence?: 'high' | 'medium' | 'low';
}

export interface ExportBridgeMarker {
  key: string;
  value: string;
}

export interface ExportBridgeContext<TRecord, TRoot = unknown> {
  index: number;
  record: TRecord;
  root: TRoot;
  inputFamily: NormalizationFamily;
}

export interface ExportBridgeRecipe<TRecord, TRoot = unknown> {
  inputFamily: NormalizationFamily;
  selectRecords?: (input: TRoot) => TRecord[];
  isMessageCandidate?: (record: TRecord, context: ExportBridgeContext<TRecord, TRoot>) => boolean;
  mapRole: (record: TRecord, context: ExportBridgeContext<TRecord, TRoot>) => string | undefined;
  extractText: (record: TRecord, context: ExportBridgeContext<TRecord, TRoot>) => string | undefined;
  resolveTimestamp: (record: TRecord, context: ExportBridgeContext<TRecord, TRoot>) => string;
  emitMarkers?: (record: TRecord, context: ExportBridgeContext<TRecord, TRoot>) => ExportBridgeMarker[] | undefined;
}

export interface ExportBridge<TRecord, TRoot = unknown> {
  readonly inputFamily: NormalizationFamily;
  normalizeRoot: (input: TRoot) => NormalizedMessage[];
  normalizeRecords: (records: TRecord[], root?: TRoot) => NormalizedMessage[];
  collectMarkers: (records: TRecord[], root?: TRoot) => ExportBridgeMarker[];
  collectRootMarkers: (input: TRoot) => ExportBridgeMarker[];
}

export interface BridgeNormalizationResult {
  family: NormalizationFamily;
  messages: NormalizedMessage[];
  markers: ExportBridgeMarker[];
}

type LooseRecord = Record<string, unknown>;

const NORMALIZED_SOURCE_FAMILY: NormalizedSourceFamily = 'normalized_conversation_markdown';
const NORMALIZATION_CONTRACT_VERSION = 'v1';
const DEFAULT_ONBOARDING_PATH = 'export/preprocess -> normalize -> batch:preflight -> batch:consolidate --strict -> recall';

export function normalizeRole(input: string | undefined): 'user' | 'agent' | 'system' | 'narrator' {
  const lowered = (input || '').trim().toLowerCase();
  if (['assistant', 'agent', 'ai', 'bot', 'model'].includes(lowered)) return 'agent';
  if (['system', 'sys'].includes(lowered)) return 'system';
  if (['narrator', 'note', 'notes', 'memo'].includes(lowered)) return 'narrator';
  return 'user';
}

export function pickMessageText(item: LooseRecord): string {
  const direct = coerceText(item.content) || coerceText(item.text) || coerceText(item.message);
  return direct.trim();
}

export function pickTimestamp(item: LooseRecord, fallback: number): string {
  const raw = coerceText(item.occurredAt)
    || coerceText(item.occurred_at)
    || coerceText(item.timestamp)
    || coerceText(item.created_at)
    || coerceText(item.createdAt)
    || coerceText(item.sentAt)
    || coerceText(item.sent_at)
    || coerceText(item.time)
    || coerceText(item.InsertTime)
    || coerceText(item.insertTime)
    || coerceText(item.insert_time);
  const date = raw ? parseTimestampDate(raw, fallback) : new Date(fallback);
  const usable = Number.isNaN(date.getTime()) ? new Date(fallback) : date;
  return usable.toISOString();
}

export function writeNormalizedConversationMarkdown(
  outputPath: string,
  title: string,
  family: NormalizationFamily,
  messages: NormalizedMessage[],
  markers: ExportBridgeMarker[] = []
): void {
  assertNormalizedMessages(messages, family);
  const uniqueMarkers = dedupeMarkers(markers);
  const content = [
    `# ${title}`,
    '',
    '<!-- cogmem-normalized: true -->',
    `<!-- cogmem-normalization-contract: ${NORMALIZATION_CONTRACT_VERSION} -->`,
    `<!-- cogmem-normalized-source-family: ${NORMALIZED_SOURCE_FAMILY} -->`,
    `<!-- cogmem-original-input-family: ${family} -->`,
    `<!-- cogmem-normalized-from: ${family} -->`,
    `<!-- cogmem-normalized-title: ${escapeMarkerValue(title)} -->`,
    `<!-- cogmem-onboarding-path: ${DEFAULT_ONBOARDING_PATH} -->`,
    ...uniqueMarkers.map((marker) => `<!-- ${marker.key}: ${escapeMarkerValue(marker.value)} -->`),
    '',
    ...messages.flatMap((message) => [
      message.source ? `<!-- cogmem-source-ref: ${escapeMarkerValue(JSON.stringify(message.source))} -->` : undefined,
      `- [${message.timestamp}] ${message.role}: ${message.text}`,
    ].filter((line): line is string => Boolean(line)))
  ].join('\n');

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content);
}

export function normalizeJsonlRecords(inputPath: string): NormalizedMessage[] {
  const input = readFileSync(inputPath, 'utf8').replace(/\r\n/g, '\n');
  let sourceOffset = 0;
  return input.split('\n').flatMap((line, lineIndex) => {
    if (!line.trim()) return [];
    const parsed = asLooseRecord(JSON.parse(line) as LooseRecord);
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages.map((item) => asLooseRecord(item))
      : [];
    if (messages.length > 0) {
      return messages.flatMap((message, messageIndex) => {
        sourceOffset += 1;
        return normalizeLooseRecordWithParent(message, parsed, sourceOffset - 1, {
          sourceOffset,
          lineStart: lineIndex + 1,
          lineEnd: lineIndex + 1,
          orderingConfidence: 'high',
        }, messageIndex);
      });
    }
    sourceOffset += 1;
    return normalizeLooseRecord(parsed, sourceOffset - 1, {
      sourceOffset,
      lineStart: lineIndex + 1,
      lineEnd: lineIndex + 1,
      orderingConfidence: 'high',
    });
  });
}

export function normalizeJsonArrayRecords(inputPath: string): NormalizedMessage[] {
  const parsed = JSON.parse(readFileSync(inputPath, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Expected a top-level JSON array.');
  }
  return parsed.flatMap((item, index) => normalizeLooseRecord(asLooseRecord(item), index, {
    sourceOffset: index + 1,
    orderingConfidence: 'high',
  }));
}

export function normalizeDelimitedRecords(inputPath: string, format?: 'csv' | 'tsv'): {
  family: NormalizationFamily;
  messages: NormalizedMessage[];
} {
  const input = readFileSync(inputPath, 'utf8').replace(/\r\n/g, '\n');
  const delimiter = resolveDelimiter(inputPath, input, format);
  const family: NormalizationFamily = delimiter === '\t' ? 'tsv_transcript_export' : 'csv_transcript_export';
  const rows = parseDelimited(input, delimiter);
  if (rows.length === 0) {
    throw new Error('Expected a header row plus at least one transcript row.');
  }

  const headers = rows[0].cells.map((cell) => normalizeHeader(cell));
  const messages = rows.slice(1).flatMap((row, index) => {
    const record: LooseRecord = {};
    headers.forEach((header, columnIndex) => {
      if (!header) return;
      record[header] = row.cells[columnIndex] ?? '';
    });
    return normalizeLooseRecord(record, index, {
      sourceOffset: index + 1,
      lineStart: row.lineStart,
      lineEnd: row.lineEnd,
      orderingConfidence: 'high',
    });
  });

  return { family, messages };
}

export function parseNormalizationMetadata(markdown: string): NormalizationMetadata {
  const legacyFamily = readAnyMarker(markdown, 'cogmem-normalized-from', 'agent-brain-normalized-from');
  const originalInputFamily = readAnyMarker(markdown, 'cogmem-original-input-family', 'agent-brain-original-input-family') || legacyFamily;
  const normalizedSourceFamily = readAnyMarker(markdown, 'cogmem-normalized-source-family', 'agent-brain-normalized-source-family');
  const contractVersion = readAnyMarker(markdown, 'cogmem-normalization-contract', 'agent-brain-normalization-contract');
  const normalizedValue = readAnyMarker(markdown, 'cogmem-normalized', 'agent-brain-normalized');
  const title = readAnyMarker(markdown, 'cogmem-normalized-title', 'agent-brain-normalized-title');
  const onboardingPath = readAnyMarker(markdown, 'cogmem-onboarding-path', 'agent-brain-onboarding-path');
  const family = originalInputFamily as NormalizationFamily | undefined;

  if (
    family !== 'jsonl_transcript_export'
    && family !== 'json_array_transcript_export'
    && family !== 'csv_transcript_export'
    && family !== 'tsv_transcript_export'
    && family !== 'app_private_mixed_event_export'
    && family !== 'jsonl_mixed_event_log_export'
  ) {
    return {
      isNormalized: normalizedValue === 'true' || Boolean(legacyFamily)
    };
  }

  return {
    isNormalized: normalizedValue === 'true' || Boolean(legacyFamily),
    contractVersion: contractVersion === NORMALIZATION_CONTRACT_VERSION ? NORMALIZATION_CONTRACT_VERSION : undefined,
    normalizedSourceFamily: normalizedSourceFamily === NORMALIZED_SOURCE_FAMILY ? NORMALIZED_SOURCE_FAMILY : undefined,
    originalInputFamily: family,
    title,
    onboardingPath
  };
}

export function normalizeAppPrivateMixedEventExport(inputPath: string): BridgeNormalizationResult {
  const parsed = JSON.parse(readFileSync(inputPath, 'utf8')) as LooseRecord;
  return normalizeEventExportToConversationMarkdown<LooseRecord, LooseRecord>(parsed, createExportBridge<LooseRecord, LooseRecord>({
    inputFamily: 'app_private_mixed_event_export',
    selectRecords: (root) => {
      const events = root.events;
      return Array.isArray(events) ? events.map((item) => asLooseRecord(item)) : [];
    },
    isMessageCandidate: (event) => {
      const eventKind = coerceText(event.kind) || coerceText(event.type) || coerceText(event.eventType);
      return eventKind.toLowerCase() === 'message';
    },
    mapRole: (event) => {
      const actor = asLooseRecord(event.actor);
      return coerceText(actor.role) || coerceText(actor.type) || coerceText(event.role);
    },
    extractText: (event) => {
      const body = asLooseRecord(event.body);
      return (
        coerceText(body.text)
        || coerceText(body.content)
        || coerceText(body.message)
        || coerceText(event.text)
        || coerceText(event.message)
      ).trim();
    },
    resolveTimestamp: (event, context) => pickTimestamp({
      timestamp: coerceText(event.occurred_at) || coerceText(event.timestamp),
      created_at: coerceText(event.created_at),
      createdAt: coerceText(event.createdAt),
      time: coerceText(event.time)
    }, Date.now() + context.index * 1000),
    emitMarkers: (event) => {
      const actor = asLooseRecord(event.actor);
      const kind = coerceText(event.kind) || coerceText(event.type) || coerceText(event.eventType);
      return [
        { key: 'cogmem-bridge-input-family', value: 'app_private_mixed_event_export' },
        { key: 'cogmem-bridge-event-selector', value: 'kind/type/eventType == message' },
        { key: 'cogmem-bridge-role-source', value: coerceText(actor.role) ? 'actor.role' : coerceText(actor.type) ? 'actor.type' : 'event.role' },
        { key: 'cogmem-bridge-text-source', value: pickFirstMarkerValue([
          [coerceText(asLooseRecord(event.body).text), 'body.text'],
          [coerceText(asLooseRecord(event.body).content), 'body.content'],
          [coerceText(asLooseRecord(event.body).message), 'body.message'],
          [coerceText(event.text), 'event.text'],
          [coerceText(event.message), 'event.message']
        ]) || 'unknown' },
        { key: 'cogmem-bridge-timestamp-source', value: pickFirstMarkerValue([
          [coerceText(event.occurred_at), 'occurred_at'],
          [coerceText(event.timestamp), 'timestamp'],
          [coerceText(event.created_at), 'created_at'],
          [coerceText(event.createdAt), 'createdAt'],
          [coerceText(event.time), 'time']
        ]) || 'normalization_fallback' }
      ];
    }
  }));
}

export function normalizeJsonlMixedEventLogExport(inputPath: string): BridgeNormalizationResult {
  const input = readFileSync(inputPath, 'utf8').replace(/\r\n/g, '\n');
  const events = input
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => asLooseRecord(JSON.parse(line) as LooseRecord));
  return normalizeEventExportToConversationMarkdown<LooseRecord, LooseRecord[]>(events, createExportBridge<LooseRecord, LooseRecord[]>({
    inputFamily: 'jsonl_mixed_event_log_export',
    selectRecords: (root) => root,
    isMessageCandidate: (event) => {
      const eventType = (coerceText(event.type) || coerceText(event.kind)).toLowerCase();
      return (
        eventType === 'message'
        || eventType === 'message.created'
        || eventType === 'message.appended'
      );
    },
    mapRole: (event) => {
      const payload = asLooseRecord(event.payload);
      const actor = asLooseRecord(event.actor);
      return coerceText(payload.role) || coerceText(actor.role) || coerceText(actor.type) || coerceText(event.role);
    },
    extractText: (event) => {
      const payload = asLooseRecord(event.payload);
      return (
        coerceText(payload.text)
        || coerceText(payload.content)
        || coerceText(payload.message)
        || coerceText(event.message)
        || coerceText(event.text)
      ).trim();
    },
    resolveTimestamp: (event, context) => {
      const payload = asLooseRecord(event.payload);
      return pickTimestamp({
        timestamp: coerceText(payload.timestamp) || coerceText(event.timestamp),
        created_at: coerceText(event.created_at) || coerceText(payload.created_at),
        createdAt: coerceText(event.createdAt) || coerceText(payload.createdAt),
        time: coerceText(event.time)
      }, Date.now() + context.index * 1000);
    },
    emitMarkers: (event) => {
      const payload = asLooseRecord(event.payload);
      return [
        { key: 'cogmem-bridge-input-family', value: 'jsonl_mixed_event_log_export' },
        { key: 'cogmem-bridge-event-selector', value: 'type/kind in message-like events with text payload' },
        { key: 'cogmem-bridge-role-source', value: pickFirstMarkerValue([
          [coerceText(payload.role), 'payload.role'],
          [coerceText(asLooseRecord(event.actor).role), 'actor.role'],
          [coerceText(asLooseRecord(event.actor).type), 'actor.type'],
          [coerceText(event.role), 'event.role']
        ]) || 'user_fallback' },
        { key: 'cogmem-bridge-text-source', value: pickFirstMarkerValue([
          [coerceText(payload.text), 'payload.text'],
          [coerceText(payload.content), 'payload.content'],
          [coerceText(payload.message), 'payload.message'],
          [coerceText(event.message), 'event.message'],
          [coerceText(event.text), 'event.text']
        ]) || 'unknown' },
        { key: 'cogmem-bridge-timestamp-source', value: pickFirstMarkerValue([
          [coerceText(payload.timestamp), 'payload.timestamp'],
          [coerceText(event.timestamp), 'event.timestamp'],
          [coerceText(event.created_at), 'event.created_at'],
          [coerceText(payload.created_at), 'payload.created_at'],
          [coerceText(event.createdAt), 'event.createdAt'],
          [coerceText(payload.createdAt), 'payload.createdAt'],
          [coerceText(event.time), 'event.time']
        ]) || 'normalization_fallback' }
      ];
    }
  }));
}

export function createExportBridge<TRecord, TRoot = TRecord[]>(
  recipe: ExportBridgeRecipe<TRecord, TRoot>
): ExportBridge<TRecord, TRoot> {
  const createContext = (record: TRecord, index: number, root: TRoot, records: TRecord[]): ExportBridgeContext<TRecord, TRoot> => ({
    index,
    record,
    root,
    inputFamily: recipe.inputFamily
  });

  const normalizeRecords = (records: TRecord[], root?: TRoot): NormalizedMessage[] => records.flatMap((record, index) => {
    const resolvedRoot = (root ?? records as unknown as TRoot);
    const context = createContext(record, index, resolvedRoot, records);
    if (recipe.isMessageCandidate && !recipe.isMessageCandidate(record, context)) {
      return [];
    }

    const text = (recipe.extractText(record, context) || '').trim();
    if (!text) return [];

    return [{
      role: normalizeRole(recipe.mapRole(record, context)),
      text,
      timestamp: recipe.resolveTimestamp(record, context),
      source: {
        sourceOffset: context.index + 1,
        orderingConfidence: 'high',
      },
    }];
  });

  const normalizeRoot = (input: TRoot): NormalizedMessage[] => {
    const records = recipe.selectRecords ? recipe.selectRecords(input) : input as unknown as TRecord[];
    return normalizeRecords(records, input);
  };

  const collectMarkers = (records: TRecord[], root?: TRoot): ExportBridgeMarker[] => {
    if (!recipe.emitMarkers) return [];
    const resolvedRoot = (root ?? records as unknown as TRoot);
    return dedupeMarkers(records.flatMap((record, index) => {
      const context = createContext(record, index, resolvedRoot, records);
      if (recipe.isMessageCandidate && !recipe.isMessageCandidate(record, context)) {
        return [];
      }
      return recipe.emitMarkers?.(record, context) || [];
    }));
  };

  const collectRootMarkers = (input: TRoot): ExportBridgeMarker[] => {
    const records = recipe.selectRecords ? recipe.selectRecords(input) : input as unknown as TRecord[];
    return collectMarkers(records, input);
  };

  return {
    inputFamily: recipe.inputFamily,
    normalizeRoot,
    normalizeRecords,
    collectMarkers,
    collectRootMarkers
  };
}

export function normalizeEventExportToConversationMarkdown<TRecord, TRoot = TRecord[]>(
  input: TRoot,
  bridge: ExportBridge<TRecord, TRoot>
): BridgeNormalizationResult {
  const messages = bridge.normalizeRoot(input);
  assertBridgeMessages(messages, bridge.inputFamily);
  return {
    family: bridge.inputFamily,
    messages,
    markers: bridge.collectRootMarkers(input)
  };
}

function assertBridgeMessages(messages: NormalizedMessage[], family: NormalizationFamily): void {
  if (messages.length > 0) return;
  throw new Error(
    `Bridge normalization failed for ${family}: no message records were produced. Check selectRecords, isMessageCandidate, extractText, resolveTimestamp, and confirm the export exposes stable text/timestamp fields.`
  );
}

function assertNormalizedMessages(messages: NormalizedMessage[], family: NormalizationFamily): void {
  if (messages.length === 0) {
    throw new Error(`Normalization failed for ${family}: no conversation messages were produced.`);
  }

  for (const [index, message] of messages.entries()) {
    if (!message.text.trim()) {
      throw new Error(`Normalization failed for ${family}: message ${index} is missing text.`);
    }
    const timestamp = new Date(message.timestamp);
    if (Number.isNaN(timestamp.getTime())) {
      throw new Error(`Normalization failed for ${family}: message ${index} has an invalid timestamp.`);
    }
  }
}

function readAnyMarker(markdown: string, ...markers: string[]): string | undefined {
  for (const marker of markers) {
    const value = readMarker(markdown, marker);
    if (value) return value;
  }
  return undefined;
}

function readMarker(markdown: string, marker: string): string | undefined {
  const pattern = new RegExp(`<!--\\s*${marker}:\\s*([^]+?)\\s*-->`, 'i');
  const match = markdown.match(pattern);
  return match?.[1]?.trim();
}

function escapeMarkerValue(value: string): string {
  return value.replace(/-->/g, '--&gt;').trim();
}

function dedupeMarkers(markers: ExportBridgeMarker[]): ExportBridgeMarker[] {
  const seen = new Set<string>();
  const output: ExportBridgeMarker[] = [];
  for (const marker of markers) {
    const key = marker.key.trim();
    const value = marker.value.trim();
    if (!key || !value) continue;
    const identity = `${key}::${value}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    output.push({ key, value });
  }
  return output;
}

function normalizeLooseRecord(item: LooseRecord, index: number, source?: NormalizedMessageSource): NormalizedMessage[] {
  const text = pickMessageText(item);
  if (!text) return [];
  return [{
    role: normalizeRole(coerceText(item.role)),
    text,
    timestamp: pickTimestamp(item, Date.now() + index * 1000),
    source: source ?? {
      sourceOffset: index + 1,
      orderingConfidence: 'high',
    },
  }];
}

function normalizeLooseRecordWithParent(
  item: LooseRecord,
  parent: LooseRecord,
  index: number,
  source: NormalizedMessageSource,
  messageIndex: number,
): NormalizedMessage[] {
  const text = pickMessageText(item);
  if (!text) return [];
  const parentTimestamp = pickTimestamp(parent, Date.now() + index * 1000 + messageIndex);
  const parentFallback = Date.parse(parentTimestamp);
  const timestamp = pickTimestamp(item, Number.isNaN(parentFallback) ? Date.now() + index * 1000 : parentFallback);
  return [{
    role: normalizeRole(coerceText(item.role) || coerceText(item.sender) || coerceText(item.author)),
    text,
    timestamp,
    source,
  }];
}

function coerceText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object' && typeof (entry as LooseRecord).text === 'string') {
          return (entry as LooseRecord).text as string;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (value && typeof value === 'object' && typeof (value as LooseRecord).text === 'string') {
    return (value as LooseRecord).text as string;
  }
  return '';
}

function parseTimestampDate(raw: string, fallback: number): Date {
  const trimmed = raw.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
    }
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? new Date(fallback) : parsed;
}

function pickFirstMarkerValue(candidates: Array<[string, string]>): string | undefined {
  for (const [value, label] of candidates) {
    if (value.trim()) return label;
  }
  return undefined;
}

function asLooseRecord(value: unknown): LooseRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as LooseRecord;
}

function resolveDelimiter(inputPath: string, input: string, format?: 'csv' | 'tsv'): ',' | '\t' {
  if (format === 'csv') return ',';
  if (format === 'tsv') return '\t';
  if (inputPath.toLowerCase().endsWith('.tsv')) return '\t';
  const firstLine = input.split('\n').find((line) => line.trim()) || '';
  return firstLine.includes('\t') ? '\t' : ',';
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

interface DelimitedRow {
  cells: string[];
  lineStart: number;
  lineEnd: number;
}

function parseDelimited(input: string, delimiter: ',' | '\t'): DelimitedRow[] {
  const rows: DelimitedRow[] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let lineNumber = 1;
  let rowStartLine = 1;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell);
      cell = '';
      continue;
    }

    if (!inQuotes && char === '\n') {
      row.push(cell);
      if (row.some((value) => value.trim())) {
        rows.push({ cells: row, lineStart: rowStartLine, lineEnd: lineNumber });
      }
      row = [];
      cell = '';
      lineNumber += 1;
      rowStartLine = lineNumber;
      continue;
    }

    if (char === '\n') lineNumber += 1;
    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.trim())) {
    rows.push({ cells: row, lineStart: rowStartLine, lineEnd: lineNumber });
  }

  return rows;
}
