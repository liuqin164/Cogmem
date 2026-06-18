import { describe, expect, it } from 'bun:test';
import { ConversationMarkdownAdapter } from '../src/adapters/conversation/ConversationMarkdownAdapter.js';
import { SoulMarkdownAdapter } from '../src/adapters/soul/SoulMarkdownAdapter.js';
import type { SourceDefinition, SourceFileSnapshot } from '../src/adapters/types.js';

function makeSnapshot(
  adapterKind: SourceDefinition['adapterKind'],
  sourcePath: string,
  content: string
): SourceFileSnapshot {
  return {
    sourceId: `${adapterKind}-test`,
    adapterKind,
    sourcePath,
    projectId: 'adapter-v3',
    fileHash: 'hash',
    fileMtimeMs: new Date('2026-04-16T10:00:00+09:00').getTime(),
    fileSize: content.length,
    readAt: Date.now(),
    content
  };
}

describe('Markdown source adapters v3 hardening', () => {
  it('parses drifted conversation layouts with Human/AI/Q/A roles, day headings, and partial timestamps', () => {
    const adapter = new ConversationMarkdownAdapter();
    const source: SourceDefinition = {
      sourceId: 'conversation-v3',
      adapterKind: 'conversation_markdown',
      sourcePath: '/tmp/drifted-conversation.md',
      projectId: 'adapter-v3'
    };
    const content = [
      '# 2026-04-15',
      'Human: I bought another monitor.',
      'AI: Which one?',
      'Q: the new one',
      'A: logged',
      '09:13 Human: this project is also called payment-core project.'
    ].join('\n');

    const adapted = adapter.adapt(source, makeSnapshot('conversation_markdown', source.sourcePath, content));

    expect(adapted.records).toHaveLength(5);
    expect(adapted.records.some((record) => record.text.includes('payment-core project'))).toBe(true);
    expect(adapted.diagnostics || []).toHaveLength(0);
  });

  it('emits a clear contract diagnostic when a conversation file cannot be parsed', () => {
    const adapter = new ConversationMarkdownAdapter();
    const source: SourceDefinition = {
      sourceId: 'conversation-bad',
      adapterKind: 'conversation_markdown',
      sourcePath: '/tmp/not-a-transcript.md',
      projectId: 'adapter-v3'
    };
    const content = [
      '# Catch-up',
      'This is a loose note with no role prefixes.',
      'Still useful, but not a transcript.'
    ].join('\n');

    const adapted = adapter.adapt(source, makeSnapshot('conversation_markdown', source.sourcePath, content));

    expect(adapted.records).toHaveLength(0);
    expect(adapted.diagnostics?.some((item) => item.code === 'conversation_contract_mismatch')).toBe(true);
  });

  it('parses empty role headers and collapses only adjacent exact duplicate messages', () => {
    const adapter = new ConversationMarkdownAdapter();
    const source: SourceDefinition = {
      sourceId: 'openclaw-empty-role-body',
      adapterKind: 'conversation_markdown',
      sourcePath: '/tmp/2026-06-06-1640.md',
      projectId: 'adapter-v3'
    };
    const content = [
      '# Session: 2026-06-06 16:40:37 UTC',
      'user: 我问你的原话是什么',
      'assistant:',
      '',
      '你的原话是黑盒问题。',
      'assistant: 你的原话是黑盒问题。',
      'user: 在吗',
      'assistant:',
      '在！有什么事？',
      'user: 在吗',
      'assistant: 在！有什么事？',
    ].join('\n');

    const adapted = adapter.adapt(source, makeSnapshot('conversation_markdown', source.sourcePath, content));

    expect(adapted.records.map((record) => [record.role, record.text])).toEqual([
      ['user', '我问你的原话是什么'],
      ['agent', '你的原话是黑盒问题。'],
      ['user', '在吗'],
      ['agent', '在！有什么事？'],
      ['user', '在吗'],
      ['agent', '在！有什么事？'],
    ]);
    const sessionStartedAt = Date.parse('2026-06-06T16:40:37Z');
    expect(adapted.records[0]?.timestamp).toBeGreaterThanOrEqual(sessionStartedAt);
    expect(adapted.records[0]?.timestamp).toBeLessThan(sessionStartedAt + 1000);
    expect(adapted.records.every((record, index, records) => (
      index === 0 || record.timestamp > records[index - 1]!.timestamp
    ))).toBe(true);
    expect(adapted.diagnostics?.some((item) => item.code === 'conversation_adjacent_duplicate_collapsed')).toBe(true);
  });

  it('keeps soul-style files ingestable under missing frontmatter, setext headings, and mixed message-like lines', () => {
    const adapter = new SoulMarkdownAdapter();
    const source: SourceDefinition = {
      sourceId: 'soul-v3',
      adapterKind: 'soul_markdown',
      sourcePath: '/tmp/drifted-soul.md',
      projectId: 'adapter-v3'
    };
    const content = [
      'Summary',
      '-------',
      '- Priority: payments reliability',
      '',
      'Reflection:',
      'Human: keep this short.',
      'AI: okay.',
      '',
      'Notes',
      '-----',
      'Constraint: do not auto-delete configs.'
    ].join('\n');

    const adapted = adapter.adapt(source, makeSnapshot('soul_markdown', source.sourcePath, content));

    expect(adapted.records.length).toBeGreaterThanOrEqual(3);
    expect(adapted.records.some((record) => record.kind === 'raw_utterance')).toBe(true);
    expect(adapted.records.some((record) => record.text.includes('payments reliability'))).toBe(true);
    expect(adapted.diagnostics?.some((item) => item.code === 'soul_missing_frontmatter_fields')).toBe(true);
  });
});
