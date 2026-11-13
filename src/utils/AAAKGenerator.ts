// ============================================
// AAAK (AI-to-AI Knowledge) 摘要生成器
// ============================================

import { logger } from '../utils/Logger.js';

/**
 * AAAK 格式转换规则：
 * - | : 维度分隔符
 * - : : 属性定义
 * - > : 优选/比较
 * - → : 因果/流转
 * - () : 细节补充
 * - ★ : 权重标记
 */
export class AAAKGenerator {
  /**
   * 生成 AAAK 格式摘要
   * @param content 原始内容
   * @param type 神经元类型（code/chat/doc/command）
   * @param importance 重要性权重 1-5
   */
  async generateSummary(content: string, type: string = 'chat', importance: number = 3): Promise<string> {
    try {
      // 简单实现：基于规则提取关键信息
      // 后续可以集成本地 LLM 进行更智能的摘要
      const summary = this.ruleBasedCompress(content, type, importance);
      logger.debug(`AAAK: generated summary (${summary.length} chars from ${content.length})`);
      return summary;
    } catch (error) {
      logger.error('AAAK generation failed:', error);
      return content; // 回退到原始内容
    }
  }

  /**
   * 同步生成 AAAK 格式摘要（用于事务）
   */
  generateSummarySync(content: string, type: string = 'chat', importance: number = 3): string {
    return this.ruleBasedCompress(content, type, importance);
  }

  /**
   * 基于规则的 AAAK 压缩
   */
  private ruleBasedCompress(content: string, type: string, importance: number): string {
    const stars = '★'.repeat(importance);
    
    switch (type) {
      case 'code':
        return this.compressCode(content, stars);
      case 'chat':
        return this.compressChat(content, stars);
      case 'doc':
        return this.compressDoc(content, stars);
      case 'command':
        return this.compressCommand(content, stars);
      default:
        return this.compressGeneric(content, stars);
    }
  }

  /**
   * 压缩代码类型内容
   */
  private compressCode(content: string, stars: string): string {
    // 提取关键代码元素
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    
    // 提取函数名、类名
    const functions = content.match(/(?:function|const|let|class|def|async)\s+(\w+)/g) || [];
    const imports = content.match(/import\s+.*?from\s+['"](.+?)['"]/g) || [];
    
    let summary = '';
    if (functions.length > 0) {
      summary += 'FUNC:' + functions.slice(0, 5).join(', ');
    }
    if (imports.length > 0) {
      if (summary) summary += ' | ';
      summary += 'IMP:' + imports.slice(0, 3).join(', ');
    }
    
    // 添加文件路径信息
    if (content.includes('//') || content.includes('/*')) {
      const comments = content.match(/\/\/(.+)$|\/\*(.+)\*\//g);
      if (comments && comments.length > 0) {
        if (summary) summary += ' | ';
        summary += 'NOTE:' + comments[0].replace(/\/\/|\/\*|\*\//g, '').trim().slice(0, 50);
      }
    }
    
    return summary ? `${summary} | ${stars}` : `${stars}`;
  }

  /**
   * 压缩对话类型内容
   */
  private compressChat(content: string, stars: string): string {
    // 提取关键信息
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    
    // 提取人物
    const users = content.match(/(?:^|\s)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?=\s|$|:)/g) || [];
    const userMatches = users.map(u => u.trim()).filter(u => u.length > 2).slice(0, 3);
    
    // 提取决策关键词
    const decisions = content.match(/(?:决定|决定|decision|decided|选择|choose|使用|using|采用|adopt)/gi) || [];
    
    // 提取项目/技术关键词
    const projects = content.match(/(?:PROJ|Project|项目)[:\s]+(\w+)/gi) || [];
    const techs = content.match(/(?:使用|using|技术|tech)[:\s]+(\w+)/gi) || [];
    
    let summary = '';
    if (userMatches.length > 0) {
      summary += 'USERS:' + userMatches.join(', ');
    }
    if (decisions.length > 0) {
      if (summary) summary += ' | ';
      summary += 'DECISION:' + decisions[0];
    }
    if (projects.length > 0 || techs.length > 0) {
      if (summary) summary += ' | ';
      summary += 'PROJ:' + (projects[0] || '') + ' TECH:' + (techs[0] || '');
    }
    
    // 提取因果关系
    //
    // A line scan, not `content.match(/(.+?)\s*(?:因为|…)(.+)/i)`. That pattern re-expands its lazy
    // group from every start offset looking for a marker that may not be there, which is quadratic on
    // a long newline-free line — measured through `captureConversationTurn`: 4 KB 187 ms, 16 KB
    // 1.8 s, 64 KB 26 s, against 72/112/291 ms for the same bytes split into lines (#199). This code
    // only reads the first match, and the first match is the first line holding a marker: the
    // `.+?`-prefix and `.+`-suffix cannot cross a newline, so the scan answers the same question in
    // one linear pass. `index > 0` and a non-empty tail keep the match's two guards.
    const causeLine = firstLineWithCause(content);
    if (causeLine !== undefined) {
      if (summary) summary += ' | ';
      summary += `→${causeLine.slice(0, 50)}`;
    }
    
    return summary ? `${summary} | ${stars}` : `${stars}`;
  }

  /**
   * 压缩文档类型内容
   */
  private compressDoc(content: string, stars: string): string {
    // 提取标题
    const titleMatch = content.match(/(?:^#?\s*(.+)$)/m);
    const title = titleMatch ? titleMatch[1].trim().slice(0, 30) : '';
    
    // 提取关键点
    const bullets = content.match(/(?:^[-*]\s*(.+)$)/gm) || [];
    const keyPoints = bullets.slice(0, 3).map(b => b.replace(/^[-*]\s*/, '').trim()).join('; ');
    
    let summary = '';
    if (title) {
      summary += 'TITLE:' + title;
    }
    if (keyPoints) {
      if (summary) summary += ' | ';
      summary += 'POINTS:' + keyPoints;
    }
    
    return summary ? `${summary} | ${stars}` : `${stars}`;
  }

  /**
   * 压缩命令类型内容
   */
  private compressCommand(content: string, stars: string): string {
    // 提取命令和参数
    const cmdMatch = content.match(/(?:^\s*)(\$\s*\w+|\w+)(?:\s+(.+))?/m);
    const cmd = cmdMatch ? cmdMatch[1].trim() : '';
    const args = cmdMatch && cmdMatch[2] ? cmdMatch[2].trim().slice(0, 30) : '';
    
    // 提取输出
    const output = content.match(/(?:output|result)[:\s]*(.+)/i) || [];
    
    let summary = '';
    if (cmd) {
      summary += 'CMD:' + cmd;
    }
    if (args) {
      if (summary) summary += ' | ';
      summary += 'ARGS:' + args;
    }
    if (output.length > 0) {
      if (summary) summary += ' | ';
      summary += 'OUT:' + output[0]?.slice(0, 30) || "";
    }
    
    return summary ? `${summary} | ${stars}` : `${stars}`;
  }

  /**
   * 通用压缩
   */
  private compressGeneric(content: string, stars: string): string {
    // 取前 100 个字符作为摘要
    const truncated = content.slice(0, 100).replace(/\n/g, ' ').trim();
    return `CONTENT:${truncated}... | ${stars}`;
  }

  /**
   * 解析 AAAK 格式（反向操作）
   */
  parseAAAK(aaak: string): {
    entities: string[];
    decision?: string;
    cause?: string;
    importance: number;
  } {
    const entities: string[] = [];
    let decision: string | undefined;
    let cause: string | undefined;
    let importance = 3;

    // 提取星级
    const starMatch = aaak.match(/★+/);
    if (starMatch) {
      importance = starMatch[0].length;
    }

    // 提取实体
    const entityMatches = aaak.match(/(?:USERS|PROJ|TECH|FUNC|IMP)[:]([^|]+)/g) || [];
    for (const match of entityMatches) {
      const [, value] = match.split(':');
      if (value) entities.push(value.trim());
    }

    // 提取决策
    const decisionMatch = aaak.match(/DECISION[:]([^|]+)/);
    if (decisionMatch) {
      decision = decisionMatch[1].trim();
    }

    // 提取因果
    const causeMatch = aaak.match(/→(.+?)(?:$|\|)/);
    if (causeMatch) {
      cause = causeMatch[1].trim();
    }

    return { entities, decision, cause, importance };
  }
}

export const aaakGenerator = new AAAKGenerator();
/**
 * The first line that states a cause, or `undefined`.
 *
 * The guards match what `/(.+?)\s*(?:因为|due to|because|因此|therefore|导致|lead to)(.+)/i` accepted:
 * at least one character before the marker and at least one after it. The marker list is the one that
 * pattern carried.
 */
const CAUSE_MARKERS = /因为|due to|because|因此|therefore|导致|lead to/i;

function firstLineWithCause(content: string): string | undefined {
  for (const line of content.split('\n')) {
    const match = CAUSE_MARKERS.exec(line);
    if (!match || match.index === 0) continue;
    if (match.index + match[0].length >= line.length) continue;
    return line;
  }
  return undefined;
}
