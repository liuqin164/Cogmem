import { expect, test } from 'bun:test';
import { socialTurnResources } from '../src/config/LanguagePacks.js';
import { classifySocialTurn, isContinuationReference } from '../src/context/SocialTurn.js';

/**
 * #135: English is measured the way Chinese is, on the same turns.
 *
 * The Chinese rows are the repository's own — the social and content turns `social-turn-gate` already uses — and
 * each has an English counterpart, so the two coverage figures come from one construction rather than two
 * differently-built sets. The red line is false suppression: a turn carrying content must never be suppressed, in
 * either language. The 96.9% the ticket cites has no fixture in this repository; what is asserted is the
 * comparison the ticket asks for — English not below Chinese — and both numbers are printed.
 */
const SOCIAL: Array<[string, string]> = [
  // The variants #145's decision called out by name: the English side leaked three of four, the Chinese one, so the
  // pairs are added together to keep the two languages aligned rather than fixing one side into a new asymmetry.
  ["太谢谢你啦", "thanks so much!"],
  ["好的谢谢你", "great, thanks a lot"],
  ["嗯好的谢谢", "ok cool, thanks"],
  ["太感谢啦", "thank you very much!"],
  ["你好", "hello"],
  ["你好呀，辛苦了", "hi there, good job"],
  ["嗯嗯", "yeah yeah"],
  ["回头聊", "talk later"],
  ["不客气", "you are welcome"],
  ["多谢啦", "thanks a lot"],
  ["太感谢了", "thank you so much"],
  ["好的收到", "okay, got it"],
  ["感谢感谢", "thanks thanks"],
  ["谢谢", "thanks"],
  ["谢谢啦，辛苦了", "thanks, good job"],
  ["多谢", "many thanks"],
  ["晚上好", "good evening"],
  ["早上好", "good morning"],
  ["再见", "goodbye"],
  ["好的", "okay"],
];

const CONTENT: Array<[string, string]> = [
  ["上次部署时间改了吗", "did the deploy time change last time"],
  ["多谢，归档保留期是几年", "thanks, how many years is the archive retention"],
  ["好的，就按上次那个方案", "okay, let us go with that plan from last time"],
  ["当时他是怎么谢我的，原话", "how did he thank me back then, the exact words"],
  ["谢谢，上次部署时间改了吗", "thanks, did the deploy time change last time"],
];

function measure(language: string) {
  const at = language === 'en' ? 1 : 0;
  const socialHits = SOCIAL.filter((pair) => classifySocialTurn(pair[at]!, language) === 'social').length;
  const falseSuppressions = CONTENT.filter((pair) => classifySocialTurn(pair[at]!, language) === 'social').length;
  return { coverage: socialHits / SOCIAL.length, socialHits, falseSuppressions };
}

test('neither language suppresses a turn that carries content', () => {
  for (const language of ['zh', 'en']) {
    const measured = measure(language);
    expect({ language, suppressed: measured.falseSuppressions, of: CONTENT.length })
      .toEqual({ language, suppressed: 0, of: CONTENT.length });
  }
});

test('English coverage is not below the Chinese baseline', () => {
  const zh = measure('zh');
  const en = measure('en');
  // Printed before the assertions so the numbers are visible even when one of them fails.
  console.log(`  zh 覆盖 ${(zh.coverage * 100).toFixed(1)}%（${zh.socialHits}/${SOCIAL.length}）· en 覆盖 ${(en.coverage * 100).toFixed(1)}%（${en.socialHits}/${SOCIAL.length}）· 假压制 zh ${zh.falseSuppressions} / en ${en.falseSuppressions}`);
  expect({ en: en.coverage >= zh.coverage }).toEqual({ en: true });
  expect({ floor: en.coverage >= 0.969 }).toEqual({ floor: true });
});

test('the English pack exists in every group, not just the thanks family', () => {
  const pack = socialTurnResources('en');
  expect(pack.fillerTokens.length).toBeGreaterThan(50);
  expect(pack.contentCuePatterns.length).toBeGreaterThanOrEqual(6);
  // The four groups the solution requires, exercised through the classifier rather than by inspecting the lists.
  expect(classifySocialTurn('thanks a lot', 'en')).toBe('social');
  expect(classifySocialTurn('good morning', 'en')).toBe('social');
  expect(classifySocialTurn('got it', 'en')).toBe('social');
  expect(classifySocialTurn('talk later', 'en')).toBe('social');
});

/**
 * The acknowledgement-lead group has its own guard, because the filler probe above cannot see it: `got it` is a
 * filler, so removing the ack-lead pattern would leave that probe passing. This turn is only a continuation
 * because the acknowledgement leads it.
 */
test('the English acknowledgement lead is what makes a follow-up a continuation', () => {
  // Measured behaviour, not an assumption: the filler segmentation strips spaces, so the back-reference has to
  // match the residue's joined form, and only the acknowledgement lead separates these two turns.
  expect(isContinuationReference('ok, last time', 'en')).toBe(true);
  expect(isContinuationReference('last time', 'en')).toBe(false);
});

test('an English question keeps normal recall, which is the whole point of the gate', () => {
  // The verdict is three-way (`social` | `grey` | `real`); what matters is that a question is never suppressed.
  for (const text of ['what did we decide about the deploy window', 'did the threshold change last week', 'when is the release']) {
    const verdict = classifySocialTurn(text, 'en');
    expect({ text, suppressed: verdict === 'social' }).toEqual({ text, suppressed: false });
  }
});

test('the Chinese verdicts are untouched by the English pack', () => {
  // Adding a language must not move the other one: the same rows, measured with the default language.
  expect(measure('zh').coverage).toBe(1);
  expect(classifySocialTurn('这次谢谢你啦', 'zh')).toBe('social');
  expect(classifySocialTurn('上次部署时间改了吗', 'zh')).toBe('real');
});

/**
 * #135: a project declares its language in its own config, and the vocabulary follows. The setting is
 * process-level because Cogmem resolves one project config per workspace, so this test puts it back.
 */
test('a project config declaring a language changes which vocabulary the gate reads', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { loadCogmemConfig } = await import('../src/config/CogmemConfig.js');
  const { setConfiguredLanguage } = await import('../src/config/LanguagePacks.js');
  const { makeTempDir } = await import('./helpers/tmp.js');
  const dir = makeTempDir('cogmem-language-config-');
  mkdirSync(join(dir, '.cogmem'), { recursive: true });
  writeFileSync(join(dir, '.cogmem', 'config.toml'), '[project]\nlanguage = "en"\n');
  try {
    const loaded = loadCogmemConfig({ configPath: join(dir, '.cogmem', 'config.toml'), env: { HOME: '/nonexistent' } as never });
    expect(loaded.language).toBe('en');
    setConfiguredLanguage(loaded.language);
    // With the project's language in effect, the gate reads the English vocabulary (no explicit argument).
    expect(classifySocialTurn('thanks a lot')).toBe('social');
    expect(classifySocialTurn('what did we decide about the deploy window')).not.toBe('social');
  } finally {
    setConfiguredLanguage('zh');
  }
});
