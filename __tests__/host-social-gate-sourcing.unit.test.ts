import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installHermesAutoMemoryHook } from '../src/host/hermes/HermesAutoMemoryHook.js';
import { installPiAutoMemoryExtension } from '../src/host/pi/PiAutoMemoryExtension.js';
import { classifySocialTurn, isContinuationReference } from '../src/context/SocialTurn.js';
import { makeTempDir } from './helpers/tmp.js';

const GATE_START = '// --- social-turn gate: generated from src/context/SocialTurn.ts ---';
const GATE_END = '// --- end social-turn gate ---';

/**
 * Pull the inlined gate out of a file that was written to a host and run it.
 *
 * These files run standalone inside pi and hermes, so they cannot import the package: the rules are
 * generated into them. That is exactly the place a third hand-written list can reappear, so the test
 * reads the artifact that lands on the host and compares its verdicts with the canonical module.
 */
function installedGate(source: string): { classifySocialTurn: (text: string) => string; isContinuationReference: (text: string) => boolean } {
  const start = source.indexOf(GATE_START);
  const end = source.indexOf(GATE_END);
  expect({ hasGate: start >= 0 && end > start }).toEqual({ hasGate: true });
  const body = source.slice(start, end + GATE_END.length);
  return new Function(`${body}\nreturn { classifySocialTurn, isContinuationReference };`)() as {
    classifySocialTurn: (text: string) => string;
    isContinuationReference: (text: string) => boolean;
  };
}

const CASES = [
  '这次谢谢你啦', '太感谢了', '辛苦了', '不客气', '好的收到', '嗯嗯', '回头聊', '谢谢你啦',
  '谢谢，上次部署时间改了吗', '麻烦你了，发布窗口定在几点', '好的，就按上次那个方案', '部署窗口改到几点',
];

function expectSameAsCanonical(source: string): void {
  const gate = installedGate(source);
  for (const text of CASES) {
    expect({ text, verdict: gate.classifySocialTurn(text) }).toEqual({ text, verdict: classifySocialTurn(text) });
    expect({ text, continuation: gate.isContinuationReference(text) })
      .toEqual({ text, continuation: isContinuationReference(text) });
  }
}

test('the pi extension that lands on disk carries the shared rules, not its own list', () => {
  const dir = makeTempDir('cogmem-pi-gate-');
  const configPath = join(dir, 'settings.json');
  writeFileSync(configPath, '{}\n');
  const installed = installPiAutoMemoryExtension({
    configPath, project: 'p', workspaceRoot: dir, command: 'cogmem',
  });
  const source = readFileSync(installed.extensionPath, 'utf8');
  // The hand-written list this replaces is gone: no thanks/greeting regex survives in the artifact.
  expect(source).not.toContain('ok|okay|thanks|thank you');
  expect(source).toContain('太感谢了');
  expectSameAsCanonical(source);
});

test('the hermes hook that lands on disk carries the shared rules, not its own list', () => {
  const dir = makeTempDir('cogmem-hermes-gate-');
  const configPath = join(dir, 'config.yaml');
  writeFileSync(configPath, 'model: test\n');
  mkdirSync(join(dir, 'hooks'), { recursive: true });
  const installed = installHermesAutoMemoryHook({
    configPath, project: 'p', workspaceRoot: dir, command: 'cogmem', bunPath: process.execPath, dryRun: false,
  });
  const source = readFileSync(installed.hookPath, 'utf8');
  expect(source).not.toContain('ok|okay|thanks|thank you');
  expect(source).toContain('太感谢了');
  expectSameAsCanonical(source);
});
