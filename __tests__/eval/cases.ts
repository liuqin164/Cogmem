/**
 * The evaluation set: questions a person would actually ask this memory, with the
 * round that answers each one named in advance.
 *
 * A memory system that answers every question with the same memories passes any
 * test that only checks for a non-empty result, so every case here names the text
 * that must come back.
 *
 * The marker is a distinctive fragment of the answering round's heading, not the
 * issue number. An issue number is a poor marker: it appears in lists like
 * "#93/#94/#95/#96", so a round that merely mentions an issue would count as
 * having answered a question about it, and an assertion that demanded a trailing
 * space would report the real answer as missing. The heading fragment appears once
 * in the corpus and only in the round it names.
 *
 * The corpus is the project's own round ledger, which is committed — so the
 * questions and the text they are asked of are both reproducible from a clone.
 */

export interface EvalCase {
  /** The question as a person asks it, not the words of the record it answers. */
  question: string;
  /** A fragment of the answering round's heading, unique in the ledger. */
  expectsSection: string;
  /** Why this question is in the set. */
  note: string;
  /** Optional: a question the corpus cannot answer, which must not be answered. */
  unanswerable?: boolean;
}

export const EVAL_CASES: EvalCase[] = [
  {
    question: 'pi 这个智能体为什么一开始接不上 cogmem',
    expectsSection: '4.57 第 53 轮',
    note: 'Chinese question about a decision; the round is connect pi',
  },
  {
    question: '为什么全局安装后 cogmem 命令找不到',
    expectsSection: '4.54 第 50 轮',
    note: 'The shim-layout failure, asked the way a user hits it',
  },
  {
    question: 'init 在 dry-run 模式下为什么还是写了配置',
    expectsSection: '4.13 第 11 轮',
    note: 'A flag that was ignored',
  },
  {
    question: '为什么决定不再把 dist 提交到 git',
    expectsSection: '4.7 #53',
    note: 'A repository decision and its reason',
  },
  {
    question: '测试的临时目录为什么会把磁盘撑满',
    expectsSection: '4.18 第 14 轮',
    note: 'The temp-directory leak, which surfaced as a broken build',
  },
  {
    question: '两个 install path 是怎么定下来的',
    expectsSection: '4.5 #39',
    note: 'The install-path spec',
  },
  {
    question: '安装流程的终点是怎么被断言死的',
    expectsSection: '4.39 第 35 轮',
    note: 'The journey assertion, asked about the end state it checks',
  },
  {
    question: '写入工具为什么要求 agentId 这类字段',
    expectsSection: '4.51 第 47 轮',
    note: 'A design decision about identity fields',
  },
  {
    question: 'host 自己报的 agentId 为什么会导致它看不到自己的记忆',
    expectsSection: '4.50 第 46 轮',
    note: 'The identity-authority decision',
  },
  {
    question: 'connect hermes 报成功但其实没接好，是哪个问题',
    expectsSection: '4.56 第 52 轮',
    note: 'A symptom named as a person remembers it, not as the ticket titles it',
  },
  {
    question: 'cogmem update 为什么装到了错误的位置',
    expectsSection: '4.47 第 43 轮',
    note: 'The npm prefix decision',
  },
  {
    question: 'Dream 处理完了但召回还是空的',
    expectsSection: '4.44 第 40 轮',
    note: 'A symptom with a specific cause in the dream path',
  },
  {
    question: '通过 MCP 写入的一轮对话为什么永远召回不到',
    expectsSection: '4.43 第 39 轮',
    note: 'The write path that stored but did not become recallable',
  },
  {
    question: 'snapshot 导出为什么会失败',
    expectsSection: '4.9 #64',
    note: 'An operational failure with a specific cause',
  },
  {
    question: '4.0 支不支持从旧版本数据库升级',
    expectsSection: '4.3 #59',
    note: 'A clean-start decision, asked as a yes/no a user would ask',
  },
  {
    question: '多智能体共用一份记忆时怎么隔离',
    expectsSection: '4.2 #65',
    note: 'The isolation decision, asked as a design question',
  },
  {
    question: '这周午饭吃什么比较好',
    expectsSection: '',
    note: 'Nothing in the corpus answers this',
    unanswerable: true,
  },
  {
    question: '量子计算机的退相干时间一般是多少',
    expectsSection: '',
    note: 'Nothing in the corpus answers this either',
    unanswerable: true,
  },
];
