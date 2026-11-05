import { basename } from 'node:path';
import type {
  AdaptedSource,
  AdapterWindow,
  SourceAdapter,
  SourceAdapterDiagnostic,
  SourceAdapterRecord,
  SourceDefinition,
  SourceFileSnapshot,
  SourceActorRole,
  SourceRecordKind
} from '../types.js';
import {
  computeStableHash,
  inferSourceTitle,
  normalizeMarkdownText,
  parseLooseDateHeading,
  parseLooseTimestamp,
  parseMarkdownRoleLine,
  resolveTimestampWithContext
} from '../types.js';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const HEADING_RE = /^(#{1,6})\s+(.+)$/;

interface SoulSection {
  heading?: string;
  text: string;
  lineNumber: number;
}

/** The `YYYY-MM-DD` a dated filename carries (`2025-11-05.md`, `2025-11-05-suffix.md`), or undefined. */
function dateInFilename(sourcePath: string): string | undefined {
  const match = /(\d{4})-(\d{2})-(\d{2})/.exec(basename(sourcePath));
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

export class SoulMarkdownAdapter implements SourceAdapter {
  readonly kind = 'soul_markdown' as const;
  private readonly adapterVersion = 'soul-markdown-v2';

  adapt(source: SourceDefinition, snapshot: SourceFileSnapshot, window?: AdapterWindow): AdaptedSource {
    const normalized = normalizeMarkdownText(snapshot.content);
    const { frontmatter, body } = this.extractFrontmatter(normalized);
    const sections = this.parseSections(body);
    const diagnostics: SourceAdapterDiagnostic[] = [];
    const title = inferSourceTitle(source.sourcePath).toLowerCase();
    const defaultKind = this.inferDocumentKind(frontmatter.type || title);
    // A dated filename is a real date source: OpenClaw's daily memory is `memory/YYYY-MM-DD.md`, and
    // without this fallback a year of such files was dated to the import day (see the ledger).
    const filenameDate = dateInFilename(source.sourcePath);
    const defaultTimestamp = parseLooseTimestamp(
      frontmatter.created_at || frontmatter.date || filenameDate,
      snapshot.fileMtimeMs
    );

    if (!frontmatter.type && !frontmatter.created_at && !frontmatter.date) {
      diagnostics.push({
        severity: 'warning',
        code: 'soul_missing_frontmatter_fields',
        message: filenameDate
          ? `Soul-like markdown is missing type/date frontmatter; the date in the filename (${filenameDate}) was used.`
          : 'Soul-like markdown is missing type/date frontmatter and the filename carries no date; the file mtime was used.',
        filePath: source.sourcePath,
        adapterKind: this.kind,
        contractHint: 'Preferred fields are type plus created_at/date, but partial files are still ingested.',
        fallbackHint: 'If time placement matters, add frontmatter or pass the file through the correct daily window.'
      });
    }

    const allRecords = sections
      .flatMap((section, index) => this.sectionToRecords(source, snapshot, section, {
        defaultKind,
        defaultTimestamp: defaultTimestamp + index,
        projectId: frontmatter.project_id
      }));
    const records = allRecords
      .filter((record) => !window || (record.timestamp >= window.start && record.timestamp < window.end));

    return {
      source: {
        ...source,
        projectId: source.projectId || frontmatter.project_id
      },
      snapshot: {
        sourceId: snapshot.sourceId,
        adapterKind: snapshot.adapterKind,
        sourcePath: snapshot.sourcePath,
        projectId: source.projectId || frontmatter.project_id,
        fileHash: snapshot.fileHash,
        fileMtimeMs: snapshot.fileMtimeMs,
        fileSize: snapshot.fileSize,
        readAt: snapshot.readAt
      },
      records,
      diagnostics: allRecords.length > 0
        ? diagnostics
        : [
            ...diagnostics,
            {
              severity: 'error',
              code: 'soul_contract_mismatch',
              message: 'No ingestable soul/reflection/note content was found.',
              filePath: source.sourcePath,
              adapterKind: this.kind,
              contractHint: 'Expected headings, note paragraphs, or message-like lines inside a markdown note.',
              fallbackHint: 'Use repeated --soul for note-style files; if this is actually a transcript, pass it through --conversation instead.'
            }
          ]
    };
  }

  private extractFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
    const match = content.match(FRONTMATTER_RE);
    if (!match) return { frontmatter: {}, body: content };

    const frontmatter: Record<string, string> = {};
    for (const line of match[1].split('\n')) {
      const separator = line.indexOf(':');
      if (separator === -1) continue;
      const key = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      if (key) frontmatter[key] = value;
    }

    return {
      frontmatter,
      body: content.slice(match[0].length).trim()
    };
  }

  private parseSections(body: string): SoulSection[] {
    const lines = body.split('\n');
    const sections: SoulSection[] = [];
    let current: SoulSection | null = null;
    let skipNextLine = false;

    const flush = (): void => {
      if (!current) return;
      const text = current.text.trim();
      if (text) sections.push({ ...current, text });
      current = null;
    };

    lines.forEach((line, index) => {
      if (skipNextLine) {
        skipNextLine = false;
        return;
      }
      const headingMatch = line.match(HEADING_RE) || this.matchLooseHeading(lines, index);
      if (headingMatch) {
        flush();
        const heading = headingMatch[2]?.trim() || headingMatch[1]?.trim();
        if (!heading) return;
        if (/^[-=]{3,}$/.test(lines[index + 1]?.trim() || '')) skipNextLine = true;
        current = {
          heading,
          text: '',
          lineNumber: index + 1
        };
        return;
      }

      if (!current) {
        current = {
          heading: undefined,
          text: '',
          lineNumber: index + 1
        };
      }
      current.text += `${current.text ? '\n' : ''}${line}`;
    });

    flush();
    return sections;
  }

  private sectionToRecords(
    source: SourceDefinition,
    snapshot: SourceFileSnapshot,
    section: SoulSection,
    defaults: {
      defaultKind: SourceRecordKind;
      defaultTimestamp: number;
      projectId?: string;
    }
  ): SourceAdapterRecord[] {
    const records: SourceAdapterRecord[] = [];
    const lines = section.text.split('\n');
    let currentMessage: {
      role: SourceActorRole;
      text: string;
      timestamp: number;
      lineNumber: number;
    } | null = null;
    let currentDateHint = parseLooseDateHeading(section.heading || '') || undefined;

    const pushMessage = (): void => {
      if (!currentMessage) return;
      const text = currentMessage.text.trim();
      if (!text) return;
      records.push(this.makeRecord(source, snapshot, {
        kind: 'raw_utterance',
        role: currentMessage.role,
        text,
        timestamp: currentMessage.timestamp,
        lineNumber: currentMessage.lineNumber,
        sectionHeading: section.heading
      }));
      currentMessage = null;
    };

    lines.forEach((line, index) => {
      const headingDate = parseLooseDateHeading(line);
      if (headingDate) {
        currentDateHint = headingDate;
        return;
      }

      const parsed = parseMarkdownRoleLine(line);
      if (parsed) {
        pushMessage();
        currentMessage = {
          role: parsed.role,
          text: parsed.text,
          timestamp: resolveTimestampWithContext(parsed.timestamp, defaults.defaultTimestamp + index, currentDateHint),
          lineNumber: section.lineNumber + index
        };
        return;
      }

      if (currentMessage) {
        currentMessage.text += `${currentMessage.text ? '\n' : ''}${line.trimEnd()}`;
      }
    });

    pushMessage();

    const residual = lines
      .filter((line) => !parseMarkdownRoleLine(line) && !parseLooseDateHeading(line))
      .join('\n')
      .trim();
    if (residual) {
      records.push(this.makeRecord(source, snapshot, {
        kind: this.inferSectionKind(section.heading, defaults.defaultKind),
        text: residual,
        timestamp: defaults.defaultTimestamp,
        lineNumber: section.lineNumber,
        sectionHeading: section.heading
      }));
    }

    return records;
  }

  private makeRecord(
    source: SourceDefinition,
    snapshot: SourceFileSnapshot,
    input: {
      kind: SourceRecordKind;
      text: string;
      timestamp: number;
      lineNumber: number;
      sectionHeading?: string;
      role?: SourceActorRole;
    }
  ): SourceAdapterRecord {
    const recordHash = computeStableHash([
      source.sourceId,
      input.kind,
      input.role,
      input.timestamp,
      input.text
    ]);
    const title = inferSourceTitle(source.sourcePath);
    const reliabilityClass = input.kind === 'raw_utterance'
      ? 'raw_utterance'
      : input.kind === 'reflection'
        ? 'reflection'
        : 'self_summary';

    return {
      recordId: `soul-${recordHash.slice(0, 16)}`,
      kind: input.kind,
      role: input.role,
      text: input.text,
      timestamp: input.timestamp,
      tags: [title, 'soul', reliabilityClass],
      confidenceHint: reliabilityClass === 'raw_utterance' ? 0.76 : reliabilityClass === 'reflection' ? 0.58 : 0.64,
      sourceTypeHint: reliabilityClass === 'raw_utterance'
        ? (input.role === 'agent' ? 'llm_inference' : 'user_input')
        : 'llm_inference',
      metadata: {
        lineNumber: input.lineNumber,
        sectionHeading: input.sectionHeading
      },
      provenance: {
        sourceId: source.sourceId,
        sourcePath: source.sourcePath,
        sourceType: this.kind,
        adapterVersion: this.adapterVersion,
        fileHash: snapshot.fileHash,
        fileMtimeMs: snapshot.fileMtimeMs,
        recordHash,
        reliabilityClass
      }
    };
  }

  private inferDocumentKind(token?: string): SourceRecordKind {
    const lowered = (token || '').toLowerCase();
    if (/reflect|reflection|retro|retrospective|catch-up|复盘|反思/.test(lowered)) return 'reflection';
    if (/summary|memory-summary|wrap-up|digest|总结|摘要|概览/.test(lowered)) return 'self_summary';
    return 'note';
  }

  private inferSectionKind(heading: string | undefined, fallback: SourceRecordKind): SourceRecordKind {
    if (!heading) return fallback;
    return this.inferDocumentKind(heading);
  }

  private matchLooseHeading(lines: string[], index: number): RegExpMatchArray | null {
    const current = lines[index]?.trim();
    const next = lines[index + 1]?.trim();
    if (!current || !next) return null;

    const setext = current.match(/^([A-Za-z][A-Za-z /_-]{1,40}|[\u4e00-\u9fa5A-Za-z0-9 /_-]{1,20})$/);
    if (setext && /^[-=]{3,}$/.test(next)) return [current, '#', current] as unknown as RegExpMatchArray;

    const labeled = current.match(/^(Summary|Reflection|Notes|Memory Notes|Catch[- ]?Up|Persona|Identity|User Profile|用户画像|人格|反思|总结|备注)\s*:?$/i);
    if (labeled) return [current, '#', labeled[1]] as unknown as RegExpMatchArray;

    return null;
  }
}
