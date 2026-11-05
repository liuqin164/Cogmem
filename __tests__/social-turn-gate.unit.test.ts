import { expect, test } from 'bun:test';
import { ContextCortex, type ContextCandidate } from '../src/context/ContextCortex.js';
import { classifySocialTurn, isContinuationReference, socialTurnGateSource } from '../src/context/SocialTurn.js';

/** The variants the ticket measured as leaking, plus prefixed and particle-bearing shapes of them. */
const SOCIAL_VARIANTS = [
  '这次谢谢你啦', '太感谢了', '辛苦了', '麻烦你了', '不客气', '好的收到', '嗯嗯', '回头聊',
  '谢谢', '多谢啦', '感谢感谢', '谢谢啦，辛苦了', '嗯嗯，好的，就这样吧', '你好呀，辛苦了', '麻烦你了哈', '',
];

/** Real turns: entities, numbers, questions, memory cues, task verbs. Suppressing any of these is an incident. */
const REAL_TURNS = [
  '谢谢，上次部署时间改了吗',
  '麻烦你了，发布窗口定在几点',
  '辛苦了，帮我看下这个报错',
  '多谢，归档保留期是几年',
  '好的，就按上次那个方案',
  '当时他是怎么谢我的，原话',
  '部署窗口改到几点',
  '上次部署时间改了吗',
  '这个接口的阈值是多少',
];

test('a message made only of social fillers is classified as social', () => {
  for (const variant of SOCIAL_VARIANTS) {
    expect({ variant, verdict: classifySocialTurn(variant) }).toEqual({ variant, verdict: 'social' });
  }
});

test('a message carrying any content cue is not classified as social', () => {
  for (const turn of REAL_TURNS) {
    expect({ turn, social: classifySocialTurn(turn) === 'social' }).toEqual({ turn, social: false });
  }
});

test('the shared classifier turns social turns into the empty-layer intent, and leaves the rest alone', () => {
  const cortex = new ContextCortex();
  expect(cortex.classifyIntent('这次谢谢你啦')).toBe('social');
  expect(cortex.classifyIntent('嗯嗯')).toBe('social');
  // Unchanged on purpose: the greeting intent keeps its meaning rather than dissolving into social.
  expect(cortex.classifyIntent('你好')).toBe('greeting');
  // The red line: thanks in front of a real question must not suppress it.
  expect(cortex.classifyIntent('谢谢，上次部署时间改了吗')).not.toBe('social');
  // Acceptance case 3: an acknowledgement that only points back belongs to the session layer.
  expect(cortex.classifyIntent('好的，就按上次那个方案')).toBe('short_followup');
  // Acceptance case 4: an explicit request for the original words stays reachable.
  expect(cortex.classifyIntent('当时他是怎么谢我的，原话')).toBe('exact_quote');
});

test('a social turn activates no layer at all', () => {
  const cortex = new ContextCortex();
  const candidates: ContextCandidate[] = [
    { id: 'c1', layer: 'belief', content: 'the retention window is thirty days', confidence: 0.9 },
    { id: 'c2', layer: 'graph', content: 'deploy window on the last Thursday', confidence: 0.9 },
    { id: 'c3', layer: 'vector', content: 'thanks for the help earlier', confidence: 0.9 },
  ];
  const plan = cortex.plan({ query: '这次谢谢你啦', candidates, availableTokens: 4000, projectId: 'p' });
  expect(plan.intent).toBe('social');
  expect(plan.selected).toEqual([]);
  // Emptiness has to come from the empty layer set, not from an empty budget: the plan has budget to
  // spend and hands every candidate to the suppression list instead.
  expect(plan.budgetTokens).toBeGreaterThan(0);
  const suppressed = (plan as unknown as { receipt?: { suppressed?: Array<{ id: string }> } }).receipt?.suppressed ?? [];
  expect(suppressed.map((entry) => entry.id).sort()).toEqual(candidates.map((candidate) => candidate.id).sort());

  // A real question over the same candidates is a different intent, which is what makes the empty set
  // above the gate's doing.
  const realPlan = cortex.plan({ query: '部署窗口是什么时候', candidates, availableTokens: 4000, projectId: 'p' });
  expect(realPlan.intent).not.toBe('social');
});

test('the OpenClaw plugin copy parses and agrees with the canonical rules', () => {
  // The plugin is a generated file that cannot import TypeScript, so its copy is embedded source.
  // This is what keeps it from becoming the third hand-written list: if the two ever disagree, the
  // test names the case.
  const generated = new Function(`${socialTurnGateSource()}\nreturn { classifySocialTurn, isContinuationReference };`)() as {
    classifySocialTurn: (text: string) => string;
    isContinuationReference: (text: string) => boolean;
  };
  for (const text of [...SOCIAL_VARIANTS, ...REAL_TURNS, '好的，就按上次那个方案', '你好']) {
    expect({ text, verdict: generated.classifySocialTurn(text) }).toEqual({ text, verdict: classifySocialTurn(text) });
    expect({ text, continuation: generated.isContinuationReference(text) })
      .toEqual({ text, continuation: isContinuationReference(text) });
  }
});
