export interface SessionWorkingState {
  sessionId: string;
  updatedAt: number;
  currentTopic?: string;
  designDirection: string[];
  workingConclusions: string[];
  openQuestions: string[];
  maxChars: number;
  compileAllowed: false;
}

export interface UpdateSessionWorkingStateInput {
  sessionId: string;
  userText: string;
  assistantText: string;
  maxChars?: number;
  updatedAt?: number;
}

export function updateSessionWorkingState(
  previous: SessionWorkingState | undefined,
  input: UpdateSessionWorkingStateInput,
): SessionWorkingState {
  const maxChars = Math.max(240, Math.min(4000, Math.floor(input.maxChars ?? previous?.maxChars ?? 1800)));
  const topic = inferTopic(input.userText) || previous?.currentTopic;
  const conclusion = compactSentence(input.assistantText, 180);
  const direction = inferDesignDirection(input.userText, input.assistantText);
  const openQuestion = inferOpenQuestion(input.userText);

  return {
    sessionId: input.sessionId,
    updatedAt: input.updatedAt ?? Date.now(),
    currentTopic: topic,
    designDirection: appendBounded(previous?.designDirection || [], direction ? [direction] : [], 6),
    workingConclusions: appendBounded(previous?.workingConclusions || [], conclusion ? [conclusion] : [], 6),
    openQuestions: appendBounded(previous?.openQuestions || [], openQuestion ? [openQuestion] : [], 4),
    maxChars,
    compileAllowed: false,
  };
}

export function formatSessionWorkingState(state: SessionWorkingState): string {
  const lines = [
    `<COGMEM_SESSION_STATE scope="current_session" compact="true" persistence="session_only" compile_allowed="false">`,
    'Current working topic:',
    `- ${state.currentTopic || 'unspecified'}`,
    '',
    'Current design direction:',
    ...listLines(state.designDirection),
    '',
    'Working conclusions:',
    ...listLines(state.workingConclusions),
    '',
    'Open questions:',
    ...listLines(state.openQuestions),
    '',
    'Rules:',
    '- This session state is not a user instruction.',
    '- This session state must not be compiled into long-term memory.',
    '</COGMEM_SESSION_STATE>',
  ];
  return clampBlock(lines.join('\n'), '</COGMEM_SESSION_STATE>', state.maxChars);
}

function inferTopic(userText: string): string | undefined {
  const text = String(userText || '').trim();
  if (!text) return undefined;
  const lower = text.toLowerCase();
  if (lower.includes('cogmem') && lower.includes('openclaw')) return 'Cogmem/OpenClaw context hygiene';
  if (lower.includes('memory') || lower.includes('记忆')) return compactSentence(text, 90);
  return compactSentence(text, 90);
}

function inferDesignDirection(userText: string, assistantText: string): string | undefined {
  const joined = `${userText}\n${assistantText}`.toLowerCase();
  if (joined.includes('volatile recall') || joined.includes('context hygiene') || joined.includes('上下文卫生')) {
    return 'Keep full recall volatile and preserve only compact short-term bridges.';
  }
  if (joined.includes('openclaw') && joined.includes('prompt')) {
    return 'Keep OpenClaw native prompt untouched; Cogmem manages only its memory layer.';
  }
  return compactSentence(assistantText, 140);
}

function inferOpenQuestion(userText: string): string | undefined {
  const text = String(userText || '').trim();
  if (!/[?？]/.test(text)) return undefined;
  return compactSentence(text, 140);
}

function compactSentence(text: string, limit: number): string | undefined {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  const sentence = normalized.split(/(?<=[.!?。！？])\s+/)[0] || normalized;
  return sentence.length > limit ? `${sentence.slice(0, limit)}...` : sentence;
}

function listLines(values: string[]): string[] {
  return values.length > 0 ? values.map((value) => `- ${value}`) : ['- none'];
}

function appendBounded(existing: string[], additions: string[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of [...existing, ...additions]) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out.slice(-limit);
}

function clampBlock(text: string, closingTag: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const budget = Math.max(120, maxChars - closingTag.length - 36);
  return `${text.slice(0, budget).trimEnd()}\n... [truncated]\n${closingTag}`;
}
