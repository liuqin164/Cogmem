import { expect, test } from 'bun:test';
import { socialTurnResources } from '../src/config/LanguagePacks.js';
import { classifySocialTurn, socialTurnResidue } from '../src/context/SocialTurn.js';
import { ZH_SOCIAL_CONTENT_CUE_PATTERNS, ZH_SOCIAL_FILLER_TOKENS } from '../src/lexicon/language-packs/zh.js';

/**
 * #135 step one: the Chinese vocabulary moved into a language pack and nothing else moved with it.
 *
 * The table below was captured **before** the move, by running the classifier over these turns with the old
 * inline constants, and it is asserted as-is afterwards. Chinese behaviour is the thing this step had to leave
 * untouched, so the check is the verdicts themselves — not a claim that they look fine.
 */
const CHINESE_VERDICTS: Array<[string, string, string, string | null]> = [
    ["这次谢谢你啦", "social", "", null],
    ["太感谢了", "social", "", null],
    ["辛苦了", "social", "", null],
    ["好的", "social", "", null],
    ["收到", "social", "", null],
    ["嗯嗯", "social", "", null],
    ["在吗", "social", "", null],
    ["晚安", "social", "", null],
    ["谢谢你！", "social", "", null],
    ["上次部署时间改了吗", "real", "上次部署时间改吗", "上次"],
    ["之前那个版本为什么回滚", "real", "之前那个版本为什么回滚", "之前"],
    ["记得我说过什么吗", "real", "记得我说过什么吗", "记得"],
    ["上次那个问题修好了吗", "real", "上次那个问题修吗", "上次"],
    ["部署窗口是周二", "real", "部署窗口是周二", "周二"],
    ["把发布回滚到上一版", "real", "把发布回滚到上一版", "发布"],
    ["多久没检查告警了", "real", "多久没检查告警", "检查"],
    ["上个月的成本是多少", "real", "上个月成本是多少", "上个月"],
    ["好的，那部署时间改到周三", "real", "那部署时间改到周三", "周三"],
    ["收到，明白了", "social", "", null],
    ["嗯，那个 bug 我再看看", "real", "那个bug我再看看", "bug"],
    ["那个接口为什么超时", "real", "那个接口为什么超时", "为什么"],
    ["????", "social", "", null],
    ["……", "social", "", null],
    ["👍", "social", "👍", null],
    ["ok", "social", "", null],
    ["thanks", "social", "", null],
    ["thank you so much", "real", "somuch", "somuch"]
];

test('the Chinese pack holds exactly the vocabulary the classifier used before the move', () => {
  // Counts plus the families the ticket names; the verdict table below is what actually pins behaviour.
  expect(ZH_SOCIAL_FILLER_TOKENS.length).toBe(154); // #145 added the agreement family and the 太…啦 degree particle
  expect(ZH_SOCIAL_CONTENT_CUE_PATTERNS.length).toBe(7);
  // Tokens, not phrases: a whole sentence like 「这次谢谢你啦」 matches by segmentation, which the verdict
  // table below covers — asserting the phrase were a token would pin a fiction.
  for (const token of ['谢谢', '太感谢', '辛苦', '好的', '收到', '太']) {
    expect({ token, present: ZH_SOCIAL_FILLER_TOKENS.includes(token) }).toEqual({ token, present: true });
  }
});

test('every Chinese verdict is what it was before the vocabulary moved', () => {
  for (const [turn, verdict, residue, cue] of CHINESE_VERDICTS) {
    expect({ turn, verdict: classifySocialTurn(turn, 'zh') }).toEqual({ turn, verdict });
    expect({ turn, ...socialTurnResidue(turn, 'zh') }).toEqual({ turn, residue, ...(cue ? { cue } : {}) });
  }
});

test('the ticket example stays suppressed while a real question keeps normal recall', () => {
  expect(classifySocialTurn('这次谢谢你啦', 'zh')).toBe('social');
  expect(classifySocialTurn('上次部署时间改了吗', 'zh')).toBe('real');
});

test('an unknown language reads the default pack rather than an empty one', () => {
  for (const language of [undefined, null, '', 'zh', 'zh-CN', 'klingon']) {
    expect({ language: String(language), fillers: socialTurnResources(language).fillerTokens.length })
      .toEqual({ language: String(language), fillers: 154 });
  }
});
