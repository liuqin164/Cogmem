import type { CommitmentOwner } from '../../src/commitment/CommitmentRecognition.js';
import type { MemoryEventRole } from '../../src/types/index.js';

/**
 * The F16 seed evaluation set (#193): explicit promises that must be captured and ordinary talk
 * that must not be. It is written as data so the recognition gate measures precision and recall
 * instead of trusting the rules by inspection.
 *
 * The samples are deliberately varied: first person and third party, explicit dates and event
 * conditions, Chinese and English, each beside the shapes that look similar but are not promises
 * (questions, requests, hypotheticals, hedges, habits, the past, negations, third-party plans).
 */

export const COMMITMENT_SEED_NOW = Date.UTC(2026, 10, 15, 9);

export interface CommitmentSeedPositive {
  text: string;
  role: MemoryEventRole;
  owner: CommitmentOwner;
  due: 'time' | 'condition' | 'none';
}

export interface CommitmentSeedNegative {
  text: string;
  role: MemoryEventRole;
}

export const COMMITMENT_SEED_POSITIVES: CommitmentSeedPositive[] = [
  { text: '我明天把文件发你。', role: 'user', owner: 'user', due: 'time' },
  { text: '周五前我会回那封邮件。', role: 'user', owner: 'user', due: 'time' },
  { text: '下个月我去续约。', role: 'user', owner: 'user', due: 'time' },
  { text: '我今晚把方案改完发给你。', role: 'user', owner: 'user', due: 'time' },
  { text: '我后天上午联系房东。', role: 'user', owner: 'user', due: 'time' },
  { text: '我会在周三前确认会议室。', role: 'user', owner: 'user', due: 'time' },
  { text: '我三天后把报告交上去。', role: 'user', owner: 'user', due: 'time' },
  { text: '等发货后我再联系你。', role: 'user', owner: 'user', due: 'condition' },
  { text: '收到货以后我马上处理退款。', role: 'user', owner: 'user', due: 'condition' },
  { text: '我下周一之前把预算表更新好。', role: 'user', owner: 'user', due: 'time' },
  { text: '我这周会把测试补上。', role: 'user', owner: 'user', due: 'time' },
  { text: '我月底前提交申请。', role: 'user', owner: 'user', due: 'time' },
  { text: '我稍后把链接发你。', role: 'user', owner: 'user', due: 'time' },
  { text: '我尽快回复你。', role: 'user', owner: 'user', due: 'time' },
  { text: '我来安排下周的会议。', role: 'user', owner: 'user', due: 'time' },
  { text: '我会跟进这件事。', role: 'user', owner: 'user', due: 'none' },
  { text: "I'll send you the file tomorrow.", role: 'user', owner: 'user', due: 'time' },
  { text: 'I will reply to the email by Friday.', role: 'user', owner: 'user', due: 'time' },
  { text: '他说明天给我答复。', role: 'user', owner: 'third-party', due: 'time' },
  { text: '客服承诺周五前回复我。', role: 'user', owner: 'third-party', due: 'time' },
  { text: '朋友说下周还我钱。', role: 'user', owner: 'third-party', due: 'time' },
  { text: '我明天把合同寄给你。', role: 'user', owner: 'user', due: 'time' },
  { text: '我周五前把发票开好。', role: 'user', owner: 'user', due: 'time' },
  { text: '下周三我会把材料交到窗口。', role: 'user', owner: 'user', due: 'time' },
  { text: '我会在会议结束后把纪要发给大家。', role: 'user', owner: 'user', due: 'condition' },
  { text: '我明天上午十点前把材料放到你桌上。', role: 'user', owner: 'user', due: 'time' },
  { text: '我下周把发票寄给你。', role: 'user', owner: 'user', due: 'time' },
  { text: "I'll update the budget sheet next week.", role: 'user', owner: 'user', due: 'time' },
  // The agent's own promises are the symmetric case: same rules, owner `agent`.
  { text: '我明天把结果发你。', role: 'assistant', owner: 'agent', due: 'time' },
  { text: '我会在周五前把报告整理好。', role: 'assistant', owner: 'agent', due: 'time' },
];

export const COMMITMENT_SEED_NEGATIVES: CommitmentSeedNegative[] = [
  { text: '我昨天已经把文件发你了。', role: 'user' },
  { text: '如果明天下雨，我就不去了。', role: 'user' },
  { text: '他说他明天要去跑步。', role: 'user' },
  { text: '我一般周五交报告。', role: 'user' },
  { text: '你明天能发我一份吗？', role: 'user' },
  { text: '我不会去参加那个会。', role: 'user' },
  { text: '我可能会晚点到。', role: 'user' },
  { text: '上周我回了那封邮件。', role: 'user' },
  { text: '今天好累。', role: 'user' },
  { text: '我们下周去爬山吧。', role: 'user' },
  { text: '他明天要去跑步。', role: 'user' },
  { text: '我上周答应过他的。', role: 'user' },
  { text: '你觉得我明天该发吗？', role: 'user' },
  { text: '要是能早点下班就好了。', role: 'user' },
  { text: '明天是周五。', role: 'user' },
  { text: '我平时用 vim。', role: 'user' },
  { text: '他可能明天来。', role: 'user' },
  { text: '这次就不麻烦你了。', role: 'user' },
  { text: '我昨天忘了回邮件。', role: 'user' },
  { text: '我们上次说好一起吃饭。', role: 'user' },
  { text: '客户说他们的预算还没批。', role: 'user' },
  { text: '我希望明天能发出去。', role: 'user' },
  { text: '明天记得带伞。', role: 'user' },
  { text: 'I sent the file yesterday.', role: 'user' },
  { text: 'She said she will go running tomorrow.', role: 'user' },
  { text: 'Could you send it tomorrow?', role: 'user' },
  { text: 'I usually reply on Fridays.', role: 'user' },
  { text: '我明天可能不去。', role: 'user' },
  { text: '我们要不要明天发？', role: 'user' },
  { text: '我要去吃饭了。', role: 'user' },
  { text: '这件事我上周就处理了。', role: 'user' },
  { text: '如果周五前没收到，我再联系你。', role: 'user' },
  { text: '他说明天会下雨。', role: 'user' },
  { text: '我明天想去跑步。', role: 'user' },
  { text: '我下周休假。', role: 'user' },
  { text: '我明天有个会。', role: 'user' },
  { text: '他说周五前给我答复的可能性不大。', role: 'user' },
  { text: '我周五前应该能发你。', role: 'user' },
  { text: '我尽量明天发你。', role: 'user' },
  { text: '我明天不一定能发你。', role: 'user' },
];
