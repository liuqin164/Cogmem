import { computeStableHash, inferSourceTitle, normalizeMarkdownText, parseLooseDateHeading, parseMarkdownRoleLine, resolveTimestampWithContext } from '../types.js';
export class ConversationMarkdownAdapter {
    kind = 'conversation_markdown';
    adapterVersion = 'conversation-markdown-v2';
    adapt(source, snapshot, window) {
        const normalized = normalizeMarkdownText(snapshot.content);
        const lines = normalized.split('\n');
        const diagnostics = [];
        const messages = this.parseMessages(lines, snapshot.fileMtimeMs, source.sourcePath, diagnostics);
        const filteredMessages = messages.filter((message) => !window || (message.timestamp >= window.start && message.timestamp < window.end));
        const records = this.buildRecords(source, snapshot, filteredMessages);
        return {
            source,
            snapshot: {
                sourceId: snapshot.sourceId,
                adapterKind: snapshot.adapterKind,
                sourcePath: snapshot.sourcePath,
                projectId: snapshot.projectId,
                fileHash: snapshot.fileHash,
                fileMtimeMs: snapshot.fileMtimeMs,
                fileSize: snapshot.fileSize,
                readAt: snapshot.readAt
            },
            records,
            diagnostics
        };
    }
    parseMessages(lines, fallbackTime, sourcePath, diagnostics) {
        const messages = [];
        let current = null;
        let currentDateHint;
        let currentSessionStartedAt;
        let pendingSourceRef;
        let ignoredPrelude = 0;
        let collapsedAdjacentDuplicates = 0;
        const flush = () => {
            if (!current)
                return;
            const text = current.text.trim();
            if (text) {
                const lineSpan = Math.max(1, text.split('\n').length);
                const message = { ...current, text, lineEnd: current.lineNumber + lineSpan - 1 };
                const previous = messages[messages.length - 1];
                if (previous && previous.role === message.role && previous.text === message.text) {
                    collapsedAdjacentDuplicates += 1;
                }
                else {
                    messages.push(message);
                }
            }
            current = null;
        };
        lines.forEach((line, index) => {
            const sourceRefMarker = parseSourceRefMarker(line);
            if (sourceRefMarker) {
                pendingSourceRef = sourceRefMarker;
                return;
            }
            if (/^<!--\s*cogmem-[a-z0-9_-]+:/i.test(line.trim()) || /^<!--\s*cogmem-normalized\s*:/i.test(line.trim())) {
                return;
            }
            const sessionStartedAt = parseSessionStartedAt(line);
            if (sessionStartedAt !== undefined) {
                currentSessionStartedAt = sessionStartedAt;
                currentDateHint = new Date(sessionStartedAt).toISOString().slice(0, 10);
                return;
            }
            const dateHeading = parseLooseDateHeading(line);
            if (dateHeading) {
                currentDateHint = dateHeading;
                currentSessionStartedAt = undefined;
                return;
            }
            const parsed = parseMarkdownRoleLine(line);
            if (parsed) {
                flush();
                current = {
                    role: parsed.role,
                    text: parsed.text,
                    timestamp: parsed.timestamp
                        ? resolveTimestampWithContext(parsed.timestamp, fallbackTime + index, currentDateHint)
                        : (currentSessionStartedAt ?? fallbackTime) + index,
                    lineNumber: index + 1,
                    lineEnd: index + 1,
                    sourceRef: pendingSourceRef,
                };
                pendingSourceRef = undefined;
                return;
            }
            if (!current) {
                if (line.trim())
                    ignoredPrelude += 1;
                return;
            }
            current.text += `${current.text ? '\n' : ''}${line.trimEnd()}`;
        });
        flush();
        if (collapsedAdjacentDuplicates > 0) {
            diagnostics.push({
                severity: 'warning',
                code: 'conversation_adjacent_duplicate_collapsed',
                message: `Collapsed ${collapsedAdjacentDuplicates} adjacent exact duplicate message(s).`,
                filePath: sourcePath,
                adapterKind: this.kind,
                contractHint: 'Adjacent messages with the same role and identical normalized text are treated as export duplicates.',
                fallbackHint: 'Non-adjacent repeated messages remain separate chronological evidence.',
            });
        }
        if (messages.length === 0 && lines.some((line) => line.trim())) {
            diagnostics.push({
                severity: 'error',
                code: 'conversation_contract_mismatch',
                message: 'No parseable conversation messages were found.',
                filePath: sourcePath,
                adapterKind: this.kind,
                contractHint: 'Expected role-prefixed transcript lines such as "user:", "Human:", "Q:", "AI:", or "assistant:".',
                fallbackHint: 'Use repeated --conversation only for transcript-style files, or minimally normalize the markdown into role-prefixed lines before ingestion.'
            });
        }
        else if (ignoredPrelude > 0) {
            diagnostics.push({
                severity: 'warning',
                code: 'conversation_partial_prelude_ignored',
                message: `Ignored ${ignoredPrelude} non-message line(s) before the first parseable transcript turn.`,
                filePath: sourcePath,
                adapterKind: this.kind,
                contractHint: 'Intro headings and date headers are tolerated, but only role-prefixed transcript lines become episodic records.',
                fallbackHint: 'If important turns live outside the transcript shape, move them into explicit role-prefixed lines or ingest the file through --soul instead.'
            });
        }
        return messages;
    }
    buildRecords(source, snapshot, messages) {
        const sourceTitle = inferSourceTitle(source.sourcePath);
        const records = [];
        let turnCursor = 0;
        let openTurnId;
        let lastRole;
        let eventOrdinal = 0;
        for (const message of messages) {
            if (!openTurnId || message.role === 'user' || (lastRole === 'agent' && message.role !== 'agent')) {
                turnCursor += 1;
                eventOrdinal = 0;
                openTurnId = computeStableHash([source.sourceId, snapshot.fileHash, 'turn', turnCursor]);
            }
            eventOrdinal += 1;
            const sourceOffset = message.sourceRef?.sourceOffset ?? records.length + 1;
            const lineStart = message.sourceRef?.lineStart ?? message.lineNumber;
            const lineEnd = message.sourceRef?.lineEnd ?? message.lineEnd;
            const orderingConfidence = message.sourceRef?.orderingConfidence ?? 'high';
            const recordHash = computeStableHash([
                source.sourceId,
                message.role,
                message.timestamp,
                message.text
            ]);
            records.push({
                recordId: `srcmsg-${recordHash.slice(0, 16)}`,
                turnId: openTurnId,
                kind: 'conversation_message',
                role: message.role,
                text: message.text,
                timestamp: message.timestamp,
                tags: [sourceTitle, 'conversation'],
                confidenceHint: 0.92,
                sourceTypeHint: message.role === 'agent' ? 'llm_inference' : 'user_input',
                metadata: {
                    lineNumber: message.lineNumber,
                    lineStart,
                    lineEnd,
                    charStart: message.sourceRef?.charStart,
                    charEnd: message.sourceRef?.charEnd,
                    sourceOffset,
                    turnIndex: turnCursor,
                    turnSeq: turnCursor,
                    eventOrdinal,
                    orderingConfidence
                },
                provenance: {
                    sourceId: source.sourceId,
                    sourcePath: source.sourcePath,
                    sourceType: this.kind,
                    adapterVersion: this.adapterVersion,
                    fileHash: snapshot.fileHash,
                    fileMtimeMs: snapshot.fileMtimeMs,
                    recordHash,
                    reliabilityClass: 'raw_utterance',
                    lineStart,
                    lineEnd,
                    charStart: message.sourceRef?.charStart,
                    charEnd: message.sourceRef?.charEnd,
                    sourceOffset,
                    orderingConfidence
                }
            });
            lastRole = message.role;
        }
        return records;
    }
}
function parseSessionStartedAt(line) {
    const heading = line.trim().replace(/^#{1,6}\s*/, '');
    const match = heading.match(/^Session\s*:\s*(.+)$/i);
    if (!match?.[1])
        return undefined;
    const parsed = Date.parse(match[1].trim());
    return Number.isNaN(parsed) ? undefined : parsed;
}
function parseSourceRefMarker(line) {
    const match = line.trim().match(/^<!--\s*(?:cogmem|agent-brain)-source-ref:\s*([^]+?)\s*-->$/i);
    if (!match?.[1])
        return undefined;
    try {
        const parsed = JSON.parse(match[1].replace(/--&gt;/g, '-->'));
        return {
            sourceOffset: numberField(parsed.sourceOffset),
            lineStart: numberField(parsed.lineStart),
            lineEnd: numberField(parsed.lineEnd),
            charStart: numberField(parsed.charStart),
            charEnd: numberField(parsed.charEnd),
            orderingConfidence: orderingConfidenceField(parsed.orderingConfidence),
        };
    }
    catch {
        return undefined;
    }
}
function numberField(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function orderingConfidenceField(value) {
    return value === 'high' || value === 'medium' || value === 'low' ? value : undefined;
}
