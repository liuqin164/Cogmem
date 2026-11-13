/**
 * The layout fixture: one deterministic conversation and one clock, so a lifecycle snapshot is a
 * text comparison and not a race with `Date.now`.
 */
import { LineEditor } from '../src/tui/editor.ts';
import { TuiView, type Lifecycle } from '../src/tui/view.ts';

/** 2026-11-11 07:00 UTC — a fixed instant the wake formatter can render as "明早 07:00". */
export const FIXED_NOW = Date.UTC(2026, 10, 11, 7, 0, 0);
export const TOMORROW_0700 = Date.UTC(2026, 10, 12, 7, 0, 0);

export function withFixedClock<T>(fn: () => T): T {
  const real = Date.now;
  Date.now = () => FIXED_NOW;
  try {
    return fn();
  } finally {
    Date.now = real;
  }
}

/** The same four-section conversation for every lifecycle; only the state-specific parts differ. */
export function fixtureView(lifecycle: Lifecycle): TuiView {
  const view = new TuiView();
  view.status = {
    name: 'cogmem-companion',
    lifecycle,
    kernelConnected: true,
    nextWakeAt: TOMORROW_0700,
    nextWakeReason: 'morning_after_dream',
    model: 'mg/auto/deepseek-v4.1-flash',
    workspace: '~/projects/Cogmem-spike',
    showWorkspace: true,
    contextTokens: 2_500,
    contextSweetSpot: 6_000,
    costTokens: 1_234,
    timeZone: 'UTC',
  };
  applyPair(view, 'user', '今天过得怎么样？');
  applyPair(view, 'assistant', '# 还好\n今天做了这些：\n- 读了两章书\n- 写了 `code`\n\n```ts\nconst x = 1;\n```\n**记得**蓝色。');
  view.applyEvent({ name: 'tool_execution_start', payload: { toolCallId: 'c1', toolName: 'bash', input: { command: 'ls -la' } } });
  view.applyEvent({ name: 'tool_execution_end', payload: { toolCallId: 'c1', result: { output: 'exit 0\nfile-a\nfile-b', isError: false } } });
  view.applyEvent({ name: 'companion_emergence', payload: { reason: '承诺到期' } });
  applyPair(view, 'assistant', '你上次说的那件事，我想提醒你。');
  withFixedClock(() => {
    for (const entry of view.entries) {
      if (entry.kind === 'tool') {
        entry.block.startedAt = FIXED_NOW - 500;
        entry.block.endedAt = FIXED_NOW;
      }
    }
  });
  if (lifecycle === 'RUNNING') {
    view.work = { active: true, label: 'bash', startedAt: FIXED_NOW - 3_000, turns: 2, maxTurns: 6, tokens: 3_100, maxTokens: 20_000 };
  }
  if (lifecycle === 'DREAMING') {
    // 90s elapsed: the middle phase, so the snapshot pins the phase wording too.
    setDreamingSince(view, FIXED_NOW - 90_000);
  }
  return view;
}

function applyPair(view: TuiView, role: 'user' | 'assistant', content: string): void {
  // The runtime streams an assistant draft (empty start, full end) but sends a user message whole.
  view.applyEvent({ name: 'message_start', payload: { message: { role, content: role === 'user' ? content : '' } } });
  view.applyEvent({ name: 'message_end', payload: { message: { role, content } } });
}

/** The private clock the sleep screen reads; the fixture is the only place that reaches in. */
function setDreamingSince(view: TuiView, at: number): void {
  (view as unknown as { dreamingSince?: number }).dreamingSince = at;
}

export function fixtureEditor(text = ''): LineEditor {
  const editor = new LineEditor();
  if (text !== '') editor.setText(text);
  return editor;
}
