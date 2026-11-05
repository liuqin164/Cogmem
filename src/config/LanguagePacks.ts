/**
 * Which language resources a project reads (#135).
 *
 * The rule the ticket sets: detection logic is language-independent, resources are grouped by language. Adding a
 * language is adding a resource group, never a branch inside the logic — so the packs are looked up in a table
 * and the callers ask for a language, not for a special case.
 *
 * The default is Chinese because that is what the shipped behaviour was, and because the failure that matters
 * here is false suppression: an unknown language falls back to the vocabulary whose behaviour is already proven
 * rather than to an empty one, which would silently stop the social gate from gating anything.
 */
import { ZH_SOCIAL_ACK_LEAD, ZH_SOCIAL_BACK_REFERENCE, ZH_SOCIAL_CONTENT_CUE_PATTERNS, ZH_SOCIAL_FILLER_TOKENS, ZH_SOCIAL_NEW_CONTENT } from '../lexicon/language-packs/zh.js';

export interface SocialTurnResources {
  fillerTokens: readonly string[];
  contentCuePatterns: readonly RegExp[];
  backReference: RegExp;
  newContent: RegExp;
  ackLead: RegExp;
}

const ZH: SocialTurnResources = {
  fillerTokens: ZH_SOCIAL_FILLER_TOKENS,
  contentCuePatterns: ZH_SOCIAL_CONTENT_CUE_PATTERNS,
  backReference: ZH_SOCIAL_BACK_REFERENCE,
  newContent: ZH_SOCIAL_NEW_CONTENT,
  ackLead: ZH_SOCIAL_ACK_LEAD,
};

export const SOCIAL_TURN_PACKS: Readonly<Record<string, SocialTurnResources>> = { zh: ZH };

export const DEFAULT_LANGUAGE = 'zh';

/** The pack for a language tag; anything unknown or absent reads the default. */
export function socialTurnResources(language?: string | null): SocialTurnResources {
  const key = typeof language === 'string' ? language.trim().toLowerCase().split(/[-_]/)[0]! : '';
  return SOCIAL_TURN_PACKS[key] ?? SOCIAL_TURN_PACKS[DEFAULT_LANGUAGE]!;
}
