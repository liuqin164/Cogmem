import type { EpisodeType, TurnRelation } from './EpisodeTypes.js';

export interface TurnRelationDecision {
  relation: TurnRelation;
  confidence: number;
  episodeType: EpisodeType;
  importance: number;
  rationale: string;
}

const NOISE = /^\s*(hi|hello|hey|你好|在吗|谢谢|好的|好|ok|okay|嗯|收到|明白了)[。.!！?？\s]*$/iu;
const CORRECTION = /^\s*(不对|不是|不，|不是这样|纠正|更正|我(?:的)?意思是|actually|correction|no,)/iu;
const CONTINUATION = /^\s*(继续|接着|然后呢|上面那个|刚才说的|go on|continue|and then)/iu;
const TOPIC_SWITCH = /^\s*(换个话题|换一个话题|另一个问题|另外一个问题|说点别的|题外话|new topic|switch topics?|on another topic|unrelated question)/iu;
const CLOSURE = /(就这样|按这个(?:方案)?做|方案确认|到这里|先这样|结论就是|done|that settles it|proceed with this)/iu;
const PREFERENCE = /(请以后|以后请|始终|总是|偏好|喜欢|希望|不要|别|必须|一定要|边界|local-first|prefer|always|never|must|do not)/iu;
const GOAL = /(长期目标|目标是|计划要|希望最终|goal|objective)/iu;
const DECISION = /(决定|确定采用|选用|按.+方案|decision|decide|chosen)/iu;
const PROSPECTIVE = /(提醒我|记得在|明天|下周|到时候|remind me|tomorrow|next week)/iu;
const DEBUGGING = /(bug|错误|失败|报错|根因|修复|debug|exception)/iu;

export function classifyTurnRelation(text: string): TurnRelationDecision {
  const input = String(text || '').trim();
  if (!input || NOISE.test(input)) return decision('noise', 0.98, 'general', 0.05, 'deterministic_noise');
  if (TOPIC_SWITCH.test(input)) return decision('switches_topic', 0.96, inferEpisodeType(input), inferImportance(input), 'explicit_topic_switch');
  if (CORRECTION.test(input)) return decision('corrects_previous', 0.94, 'correction', 0.9, 'explicit_correction');
  if (CLOSURE.test(input)) return decision('closes_episode', 0.92, inferEpisodeType(input), inferImportance(input), 'explicit_user_closure');
  if (CONTINUATION.test(input)) return decision('continues_previous', 0.92, inferEpisodeType(input), inferImportance(input), 'explicit_continuation');
  if (PROSPECTIVE.test(input)) return decision('confirms_future_intent', 0.82, 'prospective', 0.86, 'prospective_signal');
  return decision('continues_previous', 0.62, inferEpisodeType(input), inferImportance(input), 'bounded_session_continuity');
}

function inferEpisodeType(text: string): EpisodeType {
  if (CORRECTION.test(text)) return 'correction';
  if (PREFERENCE.test(text)) return 'preference';
  if (GOAL.test(text)) return 'goal';
  if (DECISION.test(text)) return 'decision';
  if (PROSPECTIVE.test(text)) return 'prospective';
  if (DEBUGGING.test(text)) return 'debugging';
  if (/(路线|计划|策略|roadmap|plan)/iu.test(text)) return 'planning';
  return 'discussion';
}

function inferImportance(text: string): number {
  if (CORRECTION.test(text) || PREFERENCE.test(text) || GOAL.test(text) || DECISION.test(text) || PROSPECTIVE.test(text)) return 0.9;
  if (DEBUGGING.test(text)) return 0.78;
  return 0.55;
}

function decision(relation: TurnRelation, confidence: number, episodeType: EpisodeType, importance: number, rationale: string): TurnRelationDecision {
  return { relation, confidence, episodeType, importance, rationale };
}
