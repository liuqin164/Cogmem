/**
 * §10 items 1 and 5: fixed-size layout snapshots for the five lifecycle states at 80×24 and 120×40,
 * plus the NO_COLOR degradation.
 *
 * The snapshots are golden files under `test/snapshots/`. Regenerate them deliberately with
 * `COG_UPDATE_SNAPSHOTS=1 bun test test/tui-layout.test.ts`, then read the diff: a snapshot that
 * changes without a spec change is the failure this file exists to catch.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cellWidth, defaultRenderEnv, frameText, rowText, serializeFrame } from '../src/tui/frame.ts';
import { renderTui } from '../src/tui/layout.ts';
import type { Lifecycle } from '../src/tui/view.ts';
import { fixtureEditor, fixtureView, withFixedClock } from './tui-fixture.ts';

const LIFECYCLES: Lifecycle[] = ['DORMANT', 'WAKING', 'IDLE', 'RUNNING', 'DREAMING'];

function snapshot(name: string, actual: string): void {
  const path = join(import.meta.dir, 'snapshots', name);
  if (process.env.COG_UPDATE_SNAPSHOTS === '1') {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, actual, 'utf8');
    return;
  }
  expect(readFileSync(path, 'utf8')).toBe(actual);
}

describe('layout snapshots (spec §10.1)', () => {
  for (const size of [{ width: 80, height: 24 }, { width: 120, height: 40 }]) {
    for (const lifecycle of LIFECYCLES) {
      test(`${size.width}×${size.height} ${lifecycle}`, () => {
        const text = withFixedClock(() => {
          const frame = renderTui(fixtureView(lifecycle), fixtureEditor('正在输入'), size, defaultRenderEnv({ TERM: 'xterm-256color' } as NodeJS.ProcessEnv));
          // Every row is exactly the frame width; a ragged row is how a terminal layout garbles.
          for (const row of frame.rows) expect(cellWidth(rowText(row))).toBe(size.width);
          return frameText(frame);
        });
        snapshot(`tui-${size.width}x${size.height}-${lifecycle}.txt`, `${text}\n`);
      });
    }
  }
});

describe('degradation (spec §10.5, §9)', () => {
  test('NO_COLOR emits no escape sequence and still shows every section', () => {
    const env = defaultRenderEnv({ NO_COLOR: '1', TERM: 'xterm-256color' } as NodeJS.ProcessEnv);
    expect(env.color).toBe(false);
    const { text, serialized } = withFixedClock(() => {
      const frame = renderTui(fixtureView('IDLE'), fixtureEditor('正在输入'), { width: 80, height: 24 }, env);
      return { text: frameText(frame), serialized: serializeFrame(frame, env) };
    });
    expect(serialized).not.toContain('\u001b');
    // The golden is LF-joined like every other snapshot, so a checkout on any platform matches.
    snapshot('tui-nocolor-80x24.txt', `${text}\n`);
  });

  test('TERM=dumb degrades borders and markers to ASCII', () => {
    const env = defaultRenderEnv({ TERM: 'dumb' } as NodeJS.ProcessEnv);
    expect(env).toEqual({ color: false, unicode: false });
    const frame = withFixedClock(() => renderTui(fixtureView('IDLE'), fixtureEditor(''), { width: 80, height: 24 }, env));
    const text = frameText(frame);
    expect(text).toContain('+');
    expect(text).not.toMatch(/[┌┐└┘─│▌✦▮▯⏳]/u);
  });

  test('the colored path is real: it does contain the palette', () => {
    const env = defaultRenderEnv({ TERM: 'xterm-256color' } as NodeJS.ProcessEnv);
    const frame = withFixedClock(() => renderTui(fixtureView('IDLE'), fixtureEditor(''), { width: 80, height: 24 }, env));
    expect(serializeFrame(frame, env)).toContain('\u001b[');
  });
});

describe('small window (spec §1)', () => {
  test('below 60×16 the frame keeps status, last messages and the input, and says so', () => {
    const frame = withFixedClock(() => renderTui(fixtureView('IDLE'), fixtureEditor('草稿'), { width: 40, height: 12 }, defaultRenderEnv({ TERM: 'xterm' } as NodeJS.ProcessEnv)));
    const text = frameText(frame);
    expect(text).toContain('窗口太小');
    expect(text).toContain('草稿');
    expect(text.split('\n')).toHaveLength(12);
  });
});

describe('state-specific rendering (spec §2, §4, §8)', () => {
  test('the status bar names the lifecycle in human words and shows the next wake', () => {
    const words: Record<Lifecycle, string> = { DORMANT: '待机', WAKING: '唤醒中', IDLE: '空闲', RUNNING: '工作中', DREAMING: '做梦中' };
    for (const lifecycle of LIFECYCLES) {
      const text = withFixedClock(() => frameText(renderTui(fixtureView(lifecycle), fixtureEditor(''), { width: 120, height: 40 }, defaultRenderEnv({ TERM: 'xterm' } as NodeJS.ProcessEnv))));
      expect(text.split('\n')[0]).toContain(words[lifecycle]);
      expect(text.split('\n')[0]).toContain('下次唤醒 明早 07:00');
    }
  });

  test('RUNNING carries the work indicator with both cage budget bars', () => {
    const text = withFixedClock(() => frameText(renderTui(fixtureView('RUNNING'), fixtureEditor(''), { width: 120, height: 40 }, defaultRenderEnv({ TERM: 'xterm' } as NodeJS.ProcessEnv))));
    expect(text).toContain('⏳ bash');
    expect(text).toContain('回合 ▮▮▯▯▯ 2/6');
    expect(text).toContain('token ▮▯▯▯▯ 3.1k/20.0k');
    expect(text).toContain('已用 3.0s');
  });

  test('DREAMING is a sleep screen with a phase and both legal actions, not a black frame', () => {
    const text = withFixedClock(() => frameText(renderTui(fixtureView('DREAMING'), fixtureEditor(''), { width: 120, height: 40 }, defaultRenderEnv({ TERM: 'xterm' } as NodeJS.ProcessEnv))));
    expect(text).toContain('它在做梦');
    expect(text).toContain('已进行 1m · 阶段：编译');
    expect(text).toContain('[等它醒] 留屏观察');
    expect(text).toContain('[任意键] 唤醒它');
  });

  test('a tool block is one collapsed line by default and expands on request', () => {
    const view = fixtureView('IDLE');
    const collapsed = withFixedClock(() => frameText(renderTui(view, fixtureEditor(''), { width: 100, height: 30 }, defaultRenderEnv({ TERM: 'xterm' } as NodeJS.ProcessEnv))));
    expect(collapsed).toContain('▸ bash ls -la · 完成 · 500ms');
    const tool = view.entries.find((entry) => entry.kind === 'tool');
    if (tool?.kind === 'tool') tool.block.expanded = true;
    const expanded = withFixedClock(() => frameText(renderTui(view, fixtureEditor(''), { width: 100, height: 30 }, defaultRenderEnv({ TERM: 'xterm' } as NodeJS.ProcessEnv))));
    expect(expanded).toContain('▾ bash ls -la · 完成 · 500ms');
    expect(expanded).toContain('file-a');
  });

  test('an emergence message is visually distinct and names its reason category', () => {
    const text = withFixedClock(() => frameText(renderTui(fixtureView('IDLE'), fixtureEditor(''), { width: 100, height: 30 }, defaultRenderEnv({ TERM: 'xterm' } as NodeJS.ProcessEnv))));
    expect(text).toContain('✦ 主动 · 承诺到期');
    expect(text).toContain('│ 你上次说的那件事，我想提醒你。');
  });
});
