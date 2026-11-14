/** The refusals the session-context face names, frozen by `docs/session-context.md`. */
export const SESSION_CONTEXT_ERROR_CODES = [
  'project_id_required',
  'agent_id_required',
  'session_id_required',
  'invalid_recall_mode',
  'recall_query_required',
  'invalid_limit',
  'invalid_cursor',
  'invalid_target_tokens',
  'invalid_tail_turns',
] as const;
export type SessionContextErrorCode = (typeof SESSION_CONTEXT_ERROR_CODES)[number];

export function sessionError(code: SessionContextErrorCode, detail?: string): Error {
  return new Error(detail ? `${code}: ${detail}` : code);
}

export function requireSessionText(value: string | undefined, code: SessionContextErrorCode): string {
  const normalized = (value ?? '').trim();
  if (!normalized) throw sessionError(code);
  return normalized;
}
