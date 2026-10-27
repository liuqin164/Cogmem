/**
 * The evaluation set: questions a person would actually ask this memory, with the
 * record that answers each one named in advance.
 *
 * A memory system that answers every question with the same memories passes any
 * test that only checks for a non-empty result, so every case here names the issue
 * whose text must come back and the lane it must not be answered from. The corpus
 * is the project's own history — real issues and real review comments — which means
 * the answer exists in the text and was written by someone who was not trying to
 * make the search look good.
 */

export interface EvalCase {
  /** The question as a person asks it, not the words of the record it answers. */
  question: string;
  /** The issue number whose text must be among the results. */
  expectsIssue: number;
  /** Why this question is in the set. */
  note: string;
  /** Optional: a question the corpus cannot answer, which must not be answered. */
  unanswerable?: boolean;
}

export const EVAL_CASES: EvalCase[] = [
  {
    question: 'pi 这个智能体为什么一开始接不上 cogmem',
    expectsIssue: 95,
    note: 'Chinese question about a decision; the record says connect has no pi target',
  },
  {
    question: 'connect hermes 报成功但其实没接好，是哪个问题',
    expectsIssue: 96,
    note: 'A symptom named as a person remembers it, not as the ticket titles it',
  },
  {
    question: '为什么全局安装后 cogmem 命令找不到',
    expectsIssue: 94,
    note: 'The shim-layout failure, asked the way a user hits it',
  },
  {
    question: '写入工具为什么要求 agentId 这类字段',
    expectsIssue: 93,
    note: 'A design decision about identity fields',
  },
  {
    question: 'host 自己报的 agentId 为什么会导致它看不到自己的记忆',
    expectsIssue: 92,
    note: 'The identity-authority decision',
  },
  {
    question: 'CI 为什么不在 4.0 分支上跑',
    expectsIssue: 47,
    note: 'Short factual question about CI wiring',
  },
  {
    question: '4.0 支不支持从旧版本数据库升级',
    expectsIssue: 59,
    note: 'A clean-start decision, asked as a yes/no a user would ask',
  },
  {
    question: 'snapshot 导出为什么会失败',
    expectsIssue: 64,
    note: 'An operational failure with a specific cause',
  },
  {
    question: 'init 在 dry-run 模式下为什么还是写了配置',
    expectsIssue: 69,
    note: 'A flag that was ignored',
  },
  {
    question: '为什么决定不再把 dist 提交到 git',
    expectsIssue: 53,
    note: 'A repository decision and its reason',
  },
  {
    question: '多智能体共用一份记忆时怎么隔离',
    expectsIssue: 65,
    note: 'The isolation decision, asked as a design question',
  },
  {
    question: '共享记忆默认是开着的吗',
    expectsIssue: 66,
    note: 'A default-value question about shared memory',
  },
  {
    question: 'remember 队列为什么没把对话写进记忆',
    expectsIssue: 91,
    note: 'The queue drainer failure',
  },
  {
    question: 'openclaw 拒绝加载插件是怎么回事',
    expectsIssue: 90,
    note: 'The plugin id failure',
  },
  {
    question: 'cogmem update 为什么装到了错误的位置',
    expectsIssue: 89,
    note: 'The npm prefix decision',
  },
  {
    question: 'Dream 处理完了但召回还是空的',
    expectsIssue: 88,
    note: 'A symptom with a specific cause in the dream path',
  },
  {
    question: '通过 MCP 写入的一轮对话为什么永远召回不到',
    expectsIssue: 87,
    note: 'The write path that stored but did not become recallable',
  },
  {
    question: '测试的临时目录为什么会把磁盘撑满',
    expectsIssue: 70,
    note: 'The temp-directory leak, which surfaced as a broken build',
  },
  {
    question: '两个 install path 是怎么定下来的',
    expectsIssue: 39,
    note: 'The install-path spec',
  },
  {
    question: '为什么要给复杂度设预算',
    expectsIssue: 52,
    note: 'The complexity budget question',
  },
  {
    question: '安装流程的终点是怎么被断言死的',
    expectsIssue: 82,
    note: 'The journey assertion, asked about the end state it checks',
  },
  {
    question: '为什么宿主上报的身份不能覆盖连接凭证',
    expectsIssue: 65,
    note: 'The identity trust boundary',
  },
  {
    question: '这周午饭吃什么比较好',
    expectsIssue: -1,
    note: 'Nothing in the corpus answers this',
    unanswerable: true,
  },
  {
    question: '量子计算机的退相干时间一般是多少',
    expectsIssue: -1,
    note: 'Nothing in the corpus answers this either',
    unanswerable: true,
  },
];
