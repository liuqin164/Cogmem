export const ZH_ENTITY_TYPE_TERMS = {
  device: ['耳机', '键盘', '鼠标', '显示器'],
  project: ['项目'],
  person: ['我', '用户', '他', '她'],
  brand: ['品牌', '框架', '库'],
  issue: ['问题', '故障', '异常']
} as const;

export const ZH_RELATION_PHRASES = {
  owns: ['我有一个', '我有个'],
  purchased: ['买了一个', '又买了一个', '新买的', '重新买了', '第二个'],
  has_issue: ['有问题', '什么问题', '故障', '异常', '坏了', '断连', '杂音', '卡顿', '延迟', '闪屏'],
  worked_on: ['做过', '负责过', '参与过'],
  likes: ['喜欢'],
  dislikes: ['讨厌', '不喜欢']
} as const;

export const ZH_REFERENCE_SIGNALS = {
  newInstance: ['新买的', '新的那个', '第二个', '刚入手一个', '又买了一个'],
  updateInstance: ['那个耳机', '那个设备', '那个项目', '前一个', '之前那个', '它后来', '旧的'],
  ambiguous: ['它', '这个', '那个东西', '那个设备'],
  latest: ['新的那个', '新的设备', '新买的设备', '这个设备', '那个设备', '这个项目', '那个项目', '新项目', '新的项目', '它', '新买的耳机', '这个耳机', '那个耳机'],
  previous: ['之前那个', '前一个', '前一个设备', '旧设备', '前一个项目', '旧项目', '上一个项目', '前一个耳机', '旧耳机']
} as const;

export const ZH_SHORT_REPLY_BINDING = {
  approved: ['好的', '好', '行', '可以', '继续'],
  rejected: ['不要', '不行', '算了', '先别这个', '先别'],
  entitySelection: ['旧的那个', '就这个', '还是它']
} as const;

export const ZH_PENDING_PATTERNS = {
  action: [/要不要/i, /是否/i, /是否需要/i, /要我帮你/i],
  entity: [/哪个/i, /哪一个/i, /还是/i]
} as const;

export const ZH_LONG_TERM_SIGNAL_TERMS = ['项目', '喜欢', '讨厌', '决定', '必须', '不能', '买了', '修好了', '送人了', '在用'] as const;

export const ZH_ISSUE_KEYWORDS = {
  connectivity: ['断连', '掉线', '配对失败'],
  sound: ['杂音', '爆音', '无声', '收音发闷', '电流声'],
  performance: ['卡顿', '延迟', '慢', '不稳定', '闪屏']
} as const;

export const ZH_ISSUE_QUALIFIERS = {
  left: ['左耳'],
  right: ['右耳']
} as const;

/**
 * The Chinese social-turn vocabulary (#135), moved here verbatim from `src/context/SocialTurn.ts`.
 *
 * Detection stays language-independent and the vocabulary stays language-specific: `classifySocialTurn` has one
 * implementation and reads whichever pack the project's language selects. A test compares these lists against the
 * ones the classifier used before the move, item by item.
 */
export const ZH_SOCIAL_FILLER_TOKENS: readonly string[] = [
  // thanks — the family the ticket measured as leaking in all three hosts
  '太感谢了', '太感谢', '非常感谢', '多谢了', '多谢', '谢谢你', '谢谢您', '谢谢啦', '谢谢', '謝謝',
  '感谢你', '感谢您', '感谢啦', '感谢', '感激', '辛苦了', '辛苦您', '辛苦啦', '辛苦', '麻烦你了',
  '麻烦您了', '麻烦你', '麻烦您', '麻烦啦', '麻烦', '劳驾', '费心', '有劳', 'thanks a lot', 'thank you',
  'thanks', 'thx', 'ty', 'arigatou',
  // greetings
  '早上好', '晚上好', '中午好', '下午好', '早安', '晚安', '哈喽', '你好呀', '你好', '您好', 'hi', 'hello',
  'hey', '嗨', '在吗', '在么',
  // acknowledgements and confirmations
  '好的呢', '好的呀', '好的', '好嘞', '好滴', '好呀', '收到啦', '收到', '明白啦', '明白', '明白了',
  '了解', '知道了', '晓得', '可以', '没问题', 'okay', 'ok', 'yes', '对的呢', '对的', '好', '行', '嗯嗯嗯',
  '嗯嗯', '嗯呢', '嗯', '哦哦', '哦', '噢', '是的', '对', '妥',
  // politeness and apologies
  '不客气', '别客气', '客气了', '客气', '没事', '没关系', '没关系啦', '抱歉', '对不起', '不好意思',
  'sorry', '打扰了', '打扰', '见谅',
  // farewells and soft closers
  '回头聊', '回头见', '下次聊', '晚点聊', '先这样', '就这样', '就这样吧', '再见', '拜拜', 'bye',
  'see you', 'later', '就这样了',
  // filler, laughter, softeners, particles
  '哈哈哈哈', '哈哈哈', '哈哈', '嘿嘿', '呵呵', '嘻嘻', '笑死', '厉害了', '不错', 'hmm', 'emmm', 'ehehe',
  '这次', '这回', '啦', '呀', '呢', '吧', '嘛', '咯', '咧', '耶', '滴', '哈', '哇', '哟', '唉', '诶',
  '喂', '了', '的', '啊', '哎',
].sort((a, b) => b.length - a.length);

/** What proves there is something to look up. Generous on purpose: failing to suppress is survivable. */
export const CONTENT_CUE_PATTERNS: readonly RegExp[] = [
  /\d/,                                                                    // numbers, versions, dates
  /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/,                                         // explicit dates
  /(今天|明天|昨天|前天|后天|上周|下周|本周|上个月|下个月|今年|去年|明年|周[一二三四五六日天]|星期[一二三四五六日天]|个月|年度)/,
  /(之前|以前|上次|上回|那次|那时候|那时|当时|记得|记不记得|说过|提过|讲过|曾经|原来的|原先)/,   // memory cues
  /(什么|啥|哪个|哪一个|哪里|哪儿|谁|多少|几个|几天|几点|怎么|怎样|如何|为什么|为何|是否|吗|呢\?|？|\?)/, // content questions
  /(部署|发布|上线|回滚|修复|修改|改动|更新|升级|迁移|配置|设置|安排|决定|处理|检查|排查|评审|复盘|写|加|删|实现|支持|调研|计划|方案|时间|日期|窗口|阈值|保留|归档|清理|权限|成本|预算|容量|告警|演练|值班|契约|接口|版本|依赖)/, // task verbs and domains
  /[A-Za-z][A-Za-z0-9_-]{2,}/,                                             // latin identifiers and names
];

export const ZH_SOCIAL_CONTENT_CUE_PATTERNS: readonly RegExp[] = [
  /\d/,                                                                    // numbers, versions, dates
  /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/,                                         // explicit dates
  /(今天|明天|昨天|前天|后天|上周|下周|本周|上个月|下个月|今年|去年|明年|周[一二三四五六日天]|星期[一二三四五六日天]|个月|年度)/,
  /(之前|以前|上次|上回|那次|那时候|那时|当时|记得|记不记得|说过|提过|讲过|曾经|原来的|原先)/,   // memory cues
  /(什么|啥|哪个|哪一个|哪里|哪儿|谁|多少|几个|几天|几点|怎么|怎样|如何|为什么|为何|是否|吗|呢\?|？|\?)/, // content questions
  /(部署|发布|上线|回滚|修复|修改|改动|更新|升级|迁移|配置|设置|安排|决定|处理|检查|排查|评审|复盘|写|加|删|实现|支持|调研|计划|方案|时间|日期|窗口|阈值|保留|归档|清理|权限|成本|预算|容量|告警|演练|值班|契约|接口|版本|依赖)/, // task verbs and domains
  /[A-Za-z][A-Za-z0-9_-]{2,}/,                                             // latin identifiers and names
];

export const ZH_SOCIAL_BACK_REFERENCE = /(上次|上回|刚才|刚刚|上面|那个|这个|之前|原先|原来|前一版|刚说|刚提)/;

export const ZH_SOCIAL_NEW_CONTENT = /(部署|发布|上线|回滚|修复|改动|更新|升级|迁移|配置|安排|决定|处理|检查|排查|评审|复盘|写|实现|支持|调研|时间|日期|窗口|阈值|保留|归档|清理|权限|成本|预算|容量|告警|演练|值班|契约|接口|版本|依赖|为什么|怎么|如何|多少|几点|哪个|什么时候|是否)/;

export const ZH_SOCIAL_ACK_LEAD = /^[\s\p{P}\p{S}]*(好的|好嘞|好滴|好|行|可以|没问题|嗯|收到|ok|okay)/iu;
