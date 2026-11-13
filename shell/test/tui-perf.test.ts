/**
 * §10 item 4: bounded frame cost over a ten-thousand-entry transcript, and a resize that neither
 * garbles the layout nor drops the draft.
 *
 * The numbers are printed, not only asserted, so the round's report can quote a measurement instead
 * of a claim.
 */
import { describe, expect, test } from 'bun:test';
import { cellWidth, DiffRenderer, defaultRenderEnv, rowText } from '../src/tui/frame.ts';
import { renderTui, TranscriptCache, type TuiSize } from '../src/tui/layout.ts';
import { TuiView } from '../src/tui/view.ts';
import type { LineEditor } from '../src/tui/editor.ts';
import { fixtureEditor } from './tui-fixture.ts';

const ENV = defaultRenderEnv({ TERM: 'xterm-256color' } as NodeJS.ProcessEnv);

function bigView(entries: number): TuiView {
  const view = new TuiView();
  for (let index = 0; index < entries; index += 1) {
    view.push({ kind: 'user', id: `u${index}`, text: `第 ${index} 个问题：蓝色遮阳篷的面包店还开着吗？` });
    view.push({ kind: 'assistant', id: `a${index}`, text: `第 ${index} 个回答：\n- 要点一\n- 要点二\n**记得**蓝色。` });
  }
  return view;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

describe('virtualization (spec §9, §10.4)', () => {
  test('a 10k-entry transcript scrolls with bounded frame cost', () => {
    const view = bigView(10_000);
    const editor = fixtureEditor('');
    const size: TuiSize = { width: 80, height: 24 };
    const cache = new TranscriptCache(ENV);

    const buildStarted = performance.now();
    renderTui(view, editor, size, ENV, cache);
    const buildMs = performance.now() - buildStarted;
    const totalRows = cache.totalRows();
    expect(totalRows).toBeGreaterThan(10_000);

    // Warm frames: the cache is built, so what is measured is the per-scroll-frame cost.
    const samples: number[] = [];
    for (let index = 0; index < 400; index += 1) {
      view.scrollTop = (index * 37) % Math.max(1, totalRows - 20);
      view.follow = false;
      const started = performance.now();
      renderTui(view, editor, size, ENV, cache);
      samples.push(performance.now() - started);
    }
    const warmMedian = median(samples);
    const warmMax = Math.max(...samples);
    // eslint-disable-next-line no-console
    console.log(`[tui-perf] 10k entries, ${totalRows} rows: build ${buildMs.toFixed(1)}ms, warm frame median ${warmMedian.toFixed(3)}ms, max ${warmMax.toFixed(2)}ms`);
    expect(warmMedian).toBeLessThan(5);
    expect(warmMax).toBeLessThan(25);
  });

  test('the diff renderer rewrites at most the frame height, never the whole screen', () => {
    const view = bigView(2_000);
    const editor = fixtureEditor('');
    const size: TuiSize = { width: 80, height: 24 };
    const cache = new TranscriptCache(ENV);
    let bytes = 0;
    const renderer = new DiffRenderer((chunk) => {
      bytes += chunk.length;
    }, ENV);
    renderer.render(renderTui(view, editor, size, ENV, cache));
    const firstBytes = bytes;
    view.scrollTop = 400;
    view.follow = false;
    renderer.render(renderTui(view, editor, size, ENV, cache));
    expect(renderer.lastChangedRows).toBeLessThanOrEqual(size.height);
    // A patch of a mostly-shared screen must be a fraction of a full clear+repaint.
    expect(bytes - firstBytes).toBeLessThan(firstBytes);
  });

  test('streaming into the last entry does not rebuild the other ten thousand', () => {
    const view = bigView(10_000);
    const editor = fixtureEditor('');
    const size: TuiSize = { width: 80, height: 24 };
    const cache = new TranscriptCache(ENV);
    renderTui(view, editor, size, ENV, cache);
    const samples: number[] = [];
    for (let index = 0; index < 200; index += 1) {
      view.push({ kind: 'assistant', id: `stream-${index}`, text: `流式片段 ${index}` });
      const started = performance.now();
      renderTui(view, editor, size, ENV, cache);
      samples.push(performance.now() - started);
    }
    const warmMedian = median(samples);
    // eslint-disable-next-line no-console
    console.log(`[tui-perf] streaming append, warm frame median ${warmMedian.toFixed(3)}ms`);
    expect(warmMedian).toBeLessThan(5);
  });
});

describe('resize stress (spec §9, §10.4)', () => {
  test('every resize re-flows to the exact size and keeps the draft', () => {
    const view = bigView(2_000);
    const editor = fixtureEditor('还没发出的草稿\n第二行') as LineEditor;
    const cache = new TranscriptCache(ENV);
    const sizes: TuiSize[] = [
      { width: 120, height: 40 },
      { width: 80, height: 24 },
      { width: 61, height: 16 },
      { width: 200, height: 50 },
      { width: 60, height: 20 },
      { width: 40, height: 12 },
      { width: 80, height: 24 },
    ];
    const started = performance.now();
    for (let round = 0; round < 10; round += 1) {
      for (const size of sizes) {
        const frame = renderTui(view, editor, size, ENV, cache);
        expect(frame.rows).toHaveLength(size.height);
        for (const row of frame.rows) expect(cellWidth(rowText(row))).toBe(size.width);
        // The draft is editor state, not frame state; a resize cannot lose it.
        expect(editor.text).toBe('还没发出的草稿\n第二行');
      }
    }
    const elapsed = performance.now() - started;
    // eslint-disable-next-line no-console
    console.log(`[tui-perf] ${sizes.length * 10} resizes over 2k entries: ${elapsed.toFixed(1)}ms total, ${(elapsed / (sizes.length * 10)).toFixed(2)}ms each`);
    expect(elapsed).toBeLessThan(5_000);
  });

  test('the transcript stays follow-able after a shrink and regrow', () => {
    const view = bigView(500);
    const editor = fixtureEditor('');
    const cache = new TranscriptCache(ENV);
    renderTui(view, editor, { width: 120, height: 40 }, ENV, cache);
    renderTui(view, editor, { width: 40, height: 12 }, ENV, cache);
    const frame = renderTui(view, editor, { width: 80, height: 24 }, ENV, cache);
    expect(view.follow).toBe(true);
    expect(frameTextOf(frame)).toContain('第 499 个回答');
  });
});

function frameTextOf(frame: ReturnType<typeof renderTui>): string {
  return frame.rows.map((row) => rowText(row)).join('\n');
}
