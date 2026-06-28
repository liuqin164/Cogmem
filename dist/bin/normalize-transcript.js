#!/usr/bin/env bun
import { extname, resolve } from 'node:path';
import { normalizeAppPrivateMixedEventExport, normalizeDelimitedRecords, normalizeJsonArrayRecords, normalizeJsonlMixedEventLogExport, normalizeJsonlRecords, writeNormalizedConversationMarkdown, } from '../utils/ConversationMarkdownNormalization.js';
import { printCliJson } from './CliJson.js';
const USAGE = [
    'Usage: cogmem-normalize-transcript --input <file> --output <file> [--family json-array|jsonl|csv|tsv|app-private-mixed-event|jsonl-mixed-event-log] [--title <title>] [--dry-run] [--json]',
    '',
    'This command only normalizes transcript exports into conversation Markdown with source-ref anchors.',
    'It does not open a memory database, run recall, or modify agent runtime state.',
].join('\n');
export async function runNormalizeTranscript(argv) {
    const args = parseArgs(argv);
    if (args.values.help === true || args.values.h === true) {
        console.log(USAGE);
        return;
    }
    const inputPath = resolve(requireString(args, 'input'));
    const outputPath = resolve(requireString(args, 'output'));
    const title = stringArg(args, 'title') || 'Normalized Conversation Export';
    const dryRun = args.values['dry-run'] === true;
    const normalized = normalizeInput(inputPath, stringArg(args, 'family'), stringArg(args, 'format'));
    if (!dryRun) {
        writeNormalizedConversationMarkdown(outputPath, title, normalized.family, normalized.messages, normalized.markers);
    }
    const sourceRefs = normalized.messages
        .map((message) => message.source)
        .filter((source) => Boolean(source));
    const result = {
        inputPath,
        outputPath,
        title,
        family: normalized.family,
        dryRun,
        written: !dryRun,
        messageCount: normalized.messages.length,
        sourceRefCount: sourceRefs.length,
        sourceRefs,
        markers: normalized.markers,
    };
    if (args.values.json === true) {
        printCliJson('normalize-transcript', result);
    }
    else {
        printHumanSummary(result);
    }
    return result;
}
function normalizeInput(inputPath, familyArg, formatArg) {
    const family = resolveFamily(inputPath, familyArg, formatArg);
    switch (family) {
        case 'jsonl_transcript_export':
            return { family, messages: normalizeJsonlRecords(inputPath), markers: [] };
        case 'json_array_transcript_export':
            return { family, messages: normalizeJsonArrayRecords(inputPath), markers: [] };
        case 'csv_transcript_export': {
            const normalized = normalizeDelimitedRecords(inputPath, 'csv');
            return { family: normalized.family, messages: normalized.messages, markers: [] };
        }
        case 'tsv_transcript_export': {
            const normalized = normalizeDelimitedRecords(inputPath, 'tsv');
            return { family: normalized.family, messages: normalized.messages, markers: [] };
        }
        case 'app_private_mixed_event_export':
            return normalizeAppPrivateMixedEventExport(inputPath);
        case 'jsonl_mixed_event_log_export':
            return normalizeJsonlMixedEventLogExport(inputPath);
    }
}
function resolveFamily(inputPath, familyArg, formatArg) {
    if (familyArg)
        return normalizeFamilyAlias(familyArg);
    if (formatArg)
        return normalizeFamilyAlias(formatArg);
    const ext = extname(inputPath).toLowerCase();
    if (ext === '.json')
        return 'json_array_transcript_export';
    if (ext === '.jsonl')
        return 'jsonl_transcript_export';
    if (ext === '.csv')
        return 'csv_transcript_export';
    if (ext === '.tsv')
        return 'tsv_transcript_export';
    throw new Error('Unable to infer transcript family. Pass --family json-array|jsonl|csv|tsv|app-private-mixed-event|jsonl-mixed-event-log.');
}
function normalizeFamilyAlias(value) {
    const normalized = value.trim().toLowerCase().replace(/_/g, '-');
    const aliases = {
        'json': 'json_array_transcript_export',
        'json-array': 'json_array_transcript_export',
        'json-array-transcript-export': 'json_array_transcript_export',
        'jsonl': 'jsonl_transcript_export',
        'jsonl-transcript-export': 'jsonl_transcript_export',
        'csv': 'csv_transcript_export',
        'csv-transcript-export': 'csv_transcript_export',
        'tsv': 'tsv_transcript_export',
        'tsv-transcript-export': 'tsv_transcript_export',
        'app-private-mixed-event': 'app_private_mixed_event_export',
        'app-private-mixed-event-export': 'app_private_mixed_event_export',
        'jsonl-mixed': 'jsonl_mixed_event_log_export',
        'jsonl-mixed-event-log': 'jsonl_mixed_event_log_export',
        'jsonl-mixed-event-log-export': 'jsonl_mixed_event_log_export',
    };
    const family = aliases[normalized];
    if (!family) {
        throw new Error(`Unsupported --family: ${value}`);
    }
    return family;
}
function parseArgs(argv) {
    const values = {};
    const args = argv[0] === '--' ? argv.slice(1) : argv;
    for (let index = 0; index < args.length; index += 1) {
        const item = args[index];
        if (!item.startsWith('--'))
            continue;
        const key = item.slice(2);
        const next = args[index + 1];
        if (!next || next.startsWith('--')) {
            values[key] = true;
        }
        else {
            values[key] = next;
            index += 1;
        }
    }
    return { values };
}
function requireString(args, key) {
    const value = args.values[key];
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Missing required --${key}. ${USAGE}`);
    }
    return value;
}
function stringArg(args, key) {
    const value = args.values[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function printHumanSummary(result) {
    console.log(`cogmem transcript normalization ${result.dryRun ? 'dry-run' : 'complete'}`);
    console.log(`input: ${result.inputPath}`);
    console.log(`output: ${result.outputPath}`);
    console.log(`family: ${result.family}`);
    console.log(`messages: ${result.messageCount}`);
    console.log(`source refs: ${result.sourceRefCount}`);
    console.log(`written: ${result.written}`);
}
if (import.meta.main) {
    runNormalizeTranscript(process.argv.slice(2)).catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
