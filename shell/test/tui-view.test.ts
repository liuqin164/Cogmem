/**
 * §10 items 2 and 3 at the view level: a steering queue is visible and withdrawable, and a dream
 * attachment is a sleep screen. The shell-side halves live in `tui-attach.test.ts` and
 * `tui-dream.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import { defaultRenderEnv, frameText } from '../src/tui/frame.ts';
import { renderTui } from '../src/tui/layout.ts';
import { TuiView } from '../src/tui/view.ts';
import { fixtureEditor, fixtureView } from './tui-fixture.ts';

const ENV = defaultRenderEnv({ TERM: 'xterm-256color' } as NodeJS.ProcessEnv);
const SIZE = { width: 100, height: 30 };

function text(view: TuiView, editorText = ''): string {
  return frameText(renderTui(view, fixtureEditor(editorText), SIZE, ENV));
}

describe('steering visibility (spec §5, §10.2)', () => {
  test('a line sent while RUNNING queues visibly, then the bar goes and the line is in the flow', () => {
    const view = fixtureView('RUNNING');
    view.applyEvent({ name: 'companion_steering', payload: { queued: ['顺便说一句，别忘了我喜欢蓝色'] } });
    const queued = text(view);
    expect(queued).toContain('排队中 1 条 · 将在当前回合结束后注入 · Esc 撤回');

    // The turn boundary: the runtime injects it (a normal user message) and the queue empties.
    view.applyEvent({ name: 'message_start', payload: { message: { role: 'user', content: '顺便说一句，别忘了我喜欢蓝色' } } });
    view.applyEvent({ name: 'message_end', payload: { message: { role: 'user', content: '顺便说一句，别忘了我喜欢蓝色' } } });
    view.applyEvent({ name: 'companion_steering', payload: { queued: [] } });
    const injected = text(view);
    expect(injected).not.toContain('排队中');
    expect(injected).toContain('顺便说一句，别忘了我喜欢蓝色');
  });

  test('two queued lines show as two and clearing empties the bar', () => {
    const view = fixtureView('RUNNING');
    view.applyEvent({ name: 'companion_steering', payload: { queued: ['第一句', '第二句'] } });
    expect(text(view)).toContain('排队中 2 条');
    view.applyEvent({ name: 'companion_steering', payload: { queued: [] } });
    expect(text(view)).not.toContain('排队中');
  });
});

describe('scroll follow (spec §3)', () => {
  test('scrolling up stops the pull to the bottom and the footer says a message arrived', () => {
    const view = fixtureView('IDLE');
    expect(view.follow).toBe(true);
    view.scrollBy(3);
    expect(view.follow).toBe(false);
    view.applyEvent({ name: 'message_start', payload: { message: { role: 'user', content: '新的消息' } } });
    view.applyEvent({ name: 'message_end', payload: { message: { role: 'user', content: '新的消息' } } });
    expect(view.newMessages).toBe(true);
    expect(text(view)).toContain('有新消息 ↓');
    view.followTail();
    expect(view.newMessages).toBe(false);
    expect(text(view)).not.toContain('有新消息 ↓');
  });
});

describe('degraded kernel (spec §8)', () => {
  test('a disconnected kernel is a warning in the status bar and a banner in the flow', () => {
    const view = new TuiView();
    view.applyEvent({ name: 'companion_status', payload: { status: { kernelConnected: false, lifecycle: 'IDLE', name: 'cogmem', model: 'mg/x', workspace: '/w', showWorkspace: true, contextTokens: 0, contextSweetSpot: 6_000, costTokens: 0, timeZone: 'UTC' } } });
    view.applyEvent({ name: 'companion_degraded', payload: { reason: '内核断开，只读降级：能聊，不能记。' } });
    const frame = text(view);
    expect(frame).toContain('内核断开');
    expect(frame).toContain('降级：内核断开，只读降级：能聊，不能记。');
  });
});

describe('presence broadcast (spec §0, §8)', () => {
  test('the "while you were away" report is a notice, not a replay into the flow', () => {
    const view = new TuiView();
    view.pushPresence({
      awaySince: 1_000,
      awayMs: 3_600_000,
      dreams: [{ localDate: '2026-11-10', eventCount: 7, summary: '夜间整合 2026-11-10：当日共 7 条事件。' }],
      emergence: [{ id: 'm1', text: '蓝色遮阳篷的面包店', reason: 'recall item matched the last user topic' }],
      commitments: [{ candidateId: 'p1', title: '明天去看医生', status: 'completed', updatedAt: 2_000 }],
    });
    const frame = text(view);
    expect(frame).toContain('你不在时（离开 1h0m）：');
    expect(frame).toContain('做梦 2026-11-10（7 条事件）');
    expect(frame).toContain('已兑现承诺：明天去看医生');
    // Exactly one transcript entry: the report itself. Nothing was replayed as messages.
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0].kind).toBe('notice');
  });
});

describe('command receipts (spec §7)', () => {
  test('a /pause receipt is its own transcript entry, and other command results are not', () => {
    const view = fixtureView('IDLE');
    const before = view.entries.length;
    // The receipt style is the resident's flag (`CommandReply.receipt`), not a name list in the view.
    view.applyEvent({ name: 'companion_command_result', payload: { name: 'pause', text: '已暂停捕获：壳不再把新的会话内容写进内核。', receipt: true } });
    const receipt = view.entries[view.entries.length - 1];
    expect(receipt.kind).toBe('receipt');
    expect(view.entries.length).toBe(before + 1);
    // The third style is a marker of its own, not the notice bullet and not a user block.
    expect(text(view)).toContain('⌁ 已暂停捕获');

    // A command whose answer is an overlay (or nothing) does not add a transcript entry.
    view.applyEvent({ name: 'companion_command_result', payload: { name: 'status', text: '生命周期 IDLE' } });
    expect(view.entries.filter((entry) => entry.kind === 'receipt')).toHaveLength(1);
  });

  test('the status bar shows the pause marker while capture is paused', () => {
    const view = new TuiView();
    view.applyEvent({
      name: 'companion_status',
      payload: {
        status: { lifecycle: 'IDLE', name: 'cogmem', kernelConnected: true, model: 'mg/x', workspace: '/w', showWorkspace: true, contextTokens: 0, contextSweetSpot: 6_000, costTokens: 0, timeZone: 'UTC', capturePaused: true },
      },
    });
    expect(text(view)).toContain('暂停捕获');
    view.applyEvent({ name: 'companion_status', payload: { status: { capturePaused: false } } });
    expect(text(view)).not.toContain('暂停捕获');
  });
});

