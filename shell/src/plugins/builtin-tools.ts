/**
 * The four basic tools, as a plugin with no more privilege than a third-party one.
 *
 * Every tool validates its input at the trust boundary (path inside the workspace, output capped,
 * command timeout) and every output is returned as text for the capture path to redact and mark.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { NativePlugin, ToolDefinition, ToolOutcome } from './host.ts';

const MAX_READ_BYTES = 256 * 1024;
/** Pi's bash output cap: 2000 lines or 50 KiB, whichever is hit first (`truncate.js:13-14`). */
const MAX_OUTPUT_BYTES = 50 * 1024;
const MAX_OUTPUT_LINES = 2000;
/** The shell keeps a default timeout where Pi has none, so a hung command cannot wedge a run. */
const BASH_TIMEOUT_MS = 30_000;
const MAX_BASH_TIMEOUT_MS = 2_147_483_647;
const BASH_OUTPUT_DIR = '.cogmem-shell/bash-output';

export interface BuiltinToolsConfig {
  workspaceRoot: string;
}

function inside(root: string, candidate: string): string {
  const resolved = resolve(root, candidate);
  const rootResolved = resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + sep)) {
    throw new Error(`path_outside_workspace: ${candidate}`);
  }
  return resolved;
}

function asString(args: unknown, key: string, required = true): string {
  const value = (args as Record<string, unknown> | undefined)?.[key];
  if (typeof value !== 'string' || (required && value.length === 0)) throw new Error(`invalid_arguments: "${key}" must be a non-empty string`);
  return value;
}

/** Pi's bash `timeout` is optional seconds with no default (`resolveTimeoutMs`, bash.js:16-27); the
 * shell keeps its own 30s default so an unasked-for hang cannot wedge a resident run. */
function resolveBashTimeoutMs(args: unknown): number {
  const raw = (args as Record<string, unknown> | undefined)?.['timeout'];
  if (raw === undefined) return BASH_TIMEOUT_MS;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) throw new Error('invalid_arguments: "timeout" must be a finite number of seconds');
  const timeoutMs = raw * 1000;
  if (timeoutMs > MAX_BASH_TIMEOUT_MS) throw new Error(`invalid_arguments: "timeout" maximum is ${MAX_BASH_TIMEOUT_MS / 1000} seconds`);
  return timeoutMs;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** The last `maxBytes` bytes of `text`, moved forward to the next character boundary. */
function tailBytes(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, 'utf8');
  let start = buffer.length - maxBytes;
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start += 1;
  return buffer.subarray(start).toString('utf8');
}

/**
 * Keep the tail of a command's output for the model: Pi's `truncateTail`, 2000 lines or 50 KiB
 * whichever is hit first (`truncate.js:118-181`). Bash keeps the tail because that is where errors
 * and final results are. The complete text goes to a workspace file and the pointer says which
 * lines are showing, so nothing is lost silently. The cut never lands inside a line or a multi-byte
 * character, except the one documented case Pi also allows: a single line longer than the byte cap,
 * where the last bytes of that line are shown.
 */
function capBashOutput(fullText: string, workspaceRoot: string): string {
  const lines = (fullText.endsWith('\n') ? fullText.slice(0, -1) : fullText).split('\n');
  const totalLines = lines.length;
  if (totalLines <= MAX_OUTPUT_LINES && Buffer.byteLength(fullText, 'utf8') <= MAX_OUTPUT_BYTES) return fullText;

  const visible: string[] = [];
  let bytes = 0;
  let partial = false;
  let truncatedByBytes = false;
  for (let index = lines.length - 1; index >= 0 && visible.length < MAX_OUTPUT_LINES; index -= 1) {
    const line = lines[index];
    const lineBytes = Buffer.byteLength(line, 'utf8') + (visible.length > 0 ? 1 : 0);
    if (bytes + lineBytes > MAX_OUTPUT_BYTES) {
      truncatedByBytes = true;
      if (visible.length === 0) {
        visible.unshift(tailBytes(line, MAX_OUTPUT_BYTES));
        bytes = Buffer.byteLength(visible[0], 'utf8');
        partial = true;
      }
      break;
    }
    visible.unshift(line);
    bytes += lineBytes;
  }
  const shown = visible.join('\n');
  const limit = truncatedByBytes ? ` (${formatSize(MAX_OUTPUT_BYTES)} limit)` : '';
  const full = join(workspaceRoot, BASH_OUTPUT_DIR, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.log`);
  let pointer: string;
  try {
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, fullText, 'utf8');
    pointer = relative(workspaceRoot, full);
  } catch (error) {
    return `${shown}\n\n[output truncated${limit}; full output could not be written: ${error instanceof Error ? error.message : String(error)}]`;
  }
  if (partial) return `${shown}\n\n[showing the last ${formatSize(bytes)} of line ${totalLines}; full output: ${pointer}]`;
  const startLine = totalLines - visible.length + 1;
  return `${shown}\n\n[showing lines ${startLine}-${totalLines} of ${totalLines}${limit}; full output: ${pointer}]`;
}

function definitions(workspaceRoot: string): ToolDefinition[] {
  return [
    {
      name: 'read',
      description: 'Read a UTF-8 text file inside the workspace. Output is capped at 256 KiB.',
      replay: 'safe',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      execute({ args }) {
        const path = inside(workspaceRoot, asString(args, 'path'));
        const size = statSync(path).size;
        if (size > MAX_READ_BYTES) throw new Error(`file_too_large: ${size} bytes (cap ${MAX_READ_BYTES})`);
        return readFileSync(path, 'utf8');
      },
    },
    {
      name: 'write',
      description: 'Write a UTF-8 text file inside the workspace, creating parent directories.',
      replay: 'never',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
      execute({ args }) {
        const path = inside(workspaceRoot, asString(args, 'path'));
        const content = asString(args, 'content', false);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content, 'utf8');
        return `wrote ${Buffer.byteLength(content)} bytes to ${path}`;
      },
    },
    {
      name: 'edit',
      description: 'Replace exactly one occurrence of old_string with new_string in a workspace file. Fails loud when it does not match exactly once.',
      replay: 'never',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } },
        required: ['path', 'old_string', 'new_string'],
      },
      execute({ args }) {
        const path = inside(workspaceRoot, asString(args, 'path'));
        const oldString = asString(args, 'old_string');
        const newString = asString(args, 'new_string', false);
        const original = readFileSync(path, 'utf8');
        const matches = original.split(oldString).length - 1;
        if (matches !== 1) throw new Error(`edit_not_unique: old_string occurs ${matches} times in ${path}`);
        writeFileSync(path, original.replace(oldString, newString), 'utf8');
        return `edited ${path}`;
      },
    },
    {
      name: 'bash',
      replay: 'never',
      description: 'Run a bash command in the workspace, 30s timeout by default. stdout/stderr are combined; the last 2000 lines or 50 KiB (whichever is hit first) are returned, and the full text is written under .cogmem-shell/bash-output/ and named in the result. A non-zero exit is an error. The optional `timeout` is in seconds.',
      parameters: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'number' } }, required: ['command'] },
      execute({ args, signal }) {
        const command = asString(args, 'command');
        const timeoutMs = resolveBashTimeoutMs(args);
        return new Promise<ToolOutcome>((resolvePromise, rejectPromise) => {
          const child = spawn('/bin/bash', ['-lc', command], { cwd: workspaceRoot, signal, stdio: ['ignore', 'pipe', 'pipe'] });
          let output = '';
          let settled = false;
          let timer: ReturnType<typeof setTimeout>;
          // Pi appends the status after truncating (`formatOutput`, bash.js:233-253) so the tail that
          // matters is not itself pushed out of the cap, and the command's output is kept even when it
          // timed out — the process ran, and losing what it printed is not a reason to lose the result.
          const settle = (note: string | undefined, isError: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const capped = capBashOutput(output, workspaceRoot);
            resolvePromise({ output: note ? `${capped}\n\n${note}` : capped, isError });
          };
          timer = setTimeout(() => {
            child.kill('SIGKILL');
            settle(`Command timed out after ${timeoutMs / 1000} seconds`, true);
          }, timeoutMs);
          // A pipe hands over arbitrary byte boundaries, so a multi-byte character can be cut in two
          // between `data` events; decoding each chunk alone leaves U+FFFD on both halves. One decoder
          // per stream carries the unfinished bytes over to the next chunk, and `end()` flushes a
          // genuinely truncated tail as the replacement character rather than dropping it silently.
          const stdoutDecoder = new StringDecoder('utf8');
          const stderrDecoder = new StringDecoder('utf8');
          child.stdout.on('data', (chunk: Buffer) => {
            output += stdoutDecoder.write(chunk);
          });
          child.stderr.on('data', (chunk: Buffer) => {
            output += stderrDecoder.write(chunk);
          });
          child.stdout.on('end', () => {
            output += stdoutDecoder.end();
          });
          child.stderr.on('end', () => {
            output += stderrDecoder.end();
          });
          child.on('error', (error) => {
            // An abort (`signal`) arrives here: the run is unwinding, so reject and let the pipeline
            // record `tool_call_failed` rather than dressing the kill up as the command's verdict.
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            rejectPromise(error);
          });
          child.on('close', (code) => {
            if (code === null) settle('Command terminated without an exit code', true);
            else if (code === 0) settle(undefined, false);
            else settle(`Command exited with code ${code}`, true);
          });
        });
      },
    },
  ];
}

/** Registers all four; the host refuses any later plugin that tries to reuse a name. */
export function builtinToolsPlugin(): NativePlugin {
  return {
    name: 'builtin-tools',
    provide: ['builtinTools'],
    apply(ctx, config) {
      const { workspaceRoot } = config as BuiltinToolsConfig;
      for (const definition of definitions(workspaceRoot)) {
        ctx.registerTool(definition, { builtin: true });
      }
      ctx.provide('builtinTools', { names: ['read', 'write', 'edit', 'bash'] });
    },
  };
}
