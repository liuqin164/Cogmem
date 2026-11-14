/**
 * Life-information sensitivity marks (#164, F10).
 *
 * The keychain line keeps credentials out of recall; this is the separate line for what a companion
 * hears about a life: health, money, identity papers and family privacy. It follows the same shape
 * as the secret mark: the pattern table is the one detector, the write path stores a mark on the
 * ledger row, recall withholds marked turns from the default lanes, and the forensic intent still
 * reaches them. A mark is never inferred again at read time, so an owner's correction is the last
 * word rather than a hint a later text scan can overrule.
 *
 * Patterns are deliberately contextual. A bare `医院` or `收入` appears in ordinary conversation and
 * public news; only a personal frame (`我的工资`, `my salary`) or a concrete identifier is a finding.
 */
export const LIFE_SENSITIVITY_CATEGORIES = ['health', 'finance', 'id', 'family'] as const;
export type LifeSensitivityCategory = (typeof LIFE_SENSITIVITY_CATEGORIES)[number];

export const LIFE_SENSITIVITY_TIERS = ['private', 'high'] as const;
export type LifeSensitivityTier = 'daily' | (typeof LIFE_SENSITIVITY_TIERS)[number];

export interface LifeSensitivityPattern {
  category: LifeSensitivityCategory;
  kind: string;
  tier: Exclude<LifeSensitivityTier, 'daily'>;
  pattern: RegExp;
}

/**
 * The one life-sensitivity pattern table. Frozen by `docs/life-sensitivity.md`; the contract test
 * reads `kind`, `category` and `tier` back from the document.
 */
export const LIFE_SENSITIVITY_PATTERNS: LifeSensitivityPattern[] = [
  {
    category: 'health',
    kind: 'health_condition',
    tier: 'high',
    pattern: /病历|诊断|处方|手术|住院|疾病|癌症|肿瘤|高血压|糖尿病|心脏病|哮喘|抑郁症?|焦虑症|精神科|心理治疗|自杀|自残|艾滋病|医疗记录|medical records?|diagnos(?:is|ed|es)|prescriptions?|surgery|hospitali[sz]ed|cancer|tumou?rs?|hypertension|diabetes|heart disease|asthma|depression|anxiety disorder|psychiatric|psychotherapy|suicid(?:e|al)|self[- ]harm|\bhiv\b|\baids\b/gi,
  },
  {
    category: 'health',
    kind: 'health_visit',
    tier: 'private',
    pattern: /复查|体检|过敏|怀孕|体重|checkup|allergy|allergic|pregnant|my weight/gi,
  },
  {
    category: 'finance',
    kind: 'finance_account',
    tier: 'high',
    pattern: /银行卡号|信用卡号|银行账号|银行流水|信用卡账单|bank card number|credit card number|bank account number|\biban\b|\bswift\b/gi,
  },
  {
    category: 'finance',
    kind: 'finance_personal',
    tier: 'private',
    pattern: /(?:我的|我家的|我们家的|本人的)(?:工资|薪资|收入|存款|储蓄|债务|贷款|房贷|房租|信用卡|银行卡)|工资条|银行流水|\bmy (?:salary|income|savings?|debt|loan|mortgage|rent|credit card|bank (?:account|balance))\b/gi,
  },
  {
    category: 'id',
    kind: 'government_id',
    tier: 'high',
    pattern: /身份证号(?:码)?|护照号(?:码)?|驾照号|驾驶证号|社保号|social security number|\b\d{3}-\d{2}-\d{4}\b|\b\d{17}[\dXx]\b/gi,
  },
  {
    category: 'id',
    kind: 'government_id_personal',
    tier: 'private',
    pattern: /(?:我的|本人的)(?:身份证|护照|驾照|驾驶证|社保卡)/g,
  },
  {
    category: 'family',
    kind: 'family_abuse',
    tier: 'high',
    pattern: /家暴|家庭暴力|虐待|性侵|猥亵|domestic violence|sexual assault|child abuse|molest/gi,
  },
  {
    category: 'family',
    kind: 'family_conflict',
    tier: 'private',
    pattern: /(?:我们|我和|我爸妈|父母|家里|婆媳|夫妻)[^。！？\n]{0,10}(?:离婚|吵架|争吵|冷战|矛盾)|家庭矛盾|\bmy (?:wife|husband|partner|parents|family)[^.\n]{0,40}(?:argument|fight|conflict|divorce)\b|\b(?:my|our) (?:divorce|marriage|family)[^.\n]{0,30}(?:argument|fight|conflict|divorce)\b|\b(?:getting|filed for) (?:a )?divorce\b/gi,
  },
];

/**
 * F6's own life markers. The classifier skips these when a `life-info` tag speaks for the candidate,
 * so the two tables cannot disagree about a turn the write path already judged.
 */
export const LIFE_TEXT_MARKERS: ReadonlySet<string> = new Set([
  '病历', '诊断', '处方', '手术', '住院', '疾病', '癌症', '肿瘤', '高血压', '糖尿病', '心脏病',
  '哮喘', '抑郁', '焦虑症', '精神科', '心理治疗', '自杀', '自残', '家暴', '性侵', '艾滋病',
  '身份证号', '银行卡号', '信用卡号', '医疗记录', 'medical record', 'diagnosis', 'prescription',
  'surgery', 'hospitalized', 'cancer', 'depression', 'therapy', 'suicide', 'self-harm',
  'domestic violence', 'sexual assault', 'social security', 'bank card', 'credit card', 'hiv', 'aids',
  '工资', '薪资', '收入', '存款', '债务', '贷款', '房贷', '房租', '离婚', '吵架', '家庭矛盾',
  '体重', '过敏', '怀孕', '医院', '体检', '复查', 'salary', 'income', 'debt', 'mortgage',
  'divorce', 'argument', 'weight', 'allergy', 'pregnant',
]);

export interface LifeSensitivityFindings {
  total: number;
  byCategory: Partial<Record<LifeSensitivityCategory, number>>;
  byTier: Partial<Record<Exclude<LifeSensitivityTier, 'daily'>, number>>;
  byKind: Record<string, number>;
}

export interface LifeSensitivityCorrection {
  tier: LifeSensitivityTier;
  correctedAt: number;
}

function emptyFindings(): LifeSensitivityFindings {
  return { total: 0, byCategory: {}, byTier: {}, byKind: {} };
}

/** How many life-sensitivity findings this text holds, by category, tier and kind. Detection only. */
export function countLifeSensitivityFindings(text: string): LifeSensitivityFindings {
  const findings = emptyFindings();
  if (!text) return findings;
  for (const { category, kind, tier, pattern } of LIFE_SENSITIVITY_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (!matches?.length) continue;
    findings.total += matches.length;
    findings.byCategory[category] = (findings.byCategory[category] ?? 0) + matches.length;
    findings.byTier[tier] = (findings.byTier[tier] ?? 0) + matches.length;
    findings.byKind[kind] = (findings.byKind[kind] ?? 0) + matches.length;
  }
  return findings;
}

/** The write-path mark, shaped like the secret mark: no findings add no field at all. */
export function lifeSensitivityMetadata(text: string): Record<string, unknown> {
  const findings = countLifeSensitivityFindings(String(text ?? ''));
  return findings.total > 0 ? { lifeSensitivityFindings: findings } : {};
}

/** Whether a text carries any life-adjacent or life-sensitive marker, including F6's own table. */
export function containsLifeTextMarker(text: string): boolean {
  if (!text) return false;
  for (const marker of LIFE_TEXT_MARKERS) {
    if (text.includes(marker)) return true;
  }
  for (const { pattern } of LIFE_SENSITIVITY_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }
  return false;
}

interface LifeMarkedEvent {
  payload?: unknown;
}

function metadataOf(event: LifeMarkedEvent): Record<string, unknown> {
  const payload = event.payload as { metadata?: unknown } | undefined;
  return payload && typeof payload.metadata === 'object' && payload.metadata !== null
    ? payload.metadata as Record<string, unknown>
    : {};
}

export function eventLifeSensitivityFindings(event: LifeMarkedEvent): LifeSensitivityFindings | undefined {
  const findings = metadataOf(event).lifeSensitivityFindings as LifeSensitivityFindings | undefined;
  return findings && Number(findings.total ?? 0) > 0 ? findings : undefined;
}

export function eventLifeSensitivityCorrection(event: LifeMarkedEvent): LifeSensitivityCorrection | undefined {
  const correction = metadataOf(event).lifeSensitivityCorrection as LifeSensitivityCorrection | undefined;
  return correction && (correction.tier === 'daily' || correction.tier === 'private' || correction.tier === 'high')
    ? correction
    : undefined;
}

/**
 * The tier the ledger row currently asserts. A correction wins over the write-time findings, which is
 * what makes `daily` an immediate release rather than another hint.
 */
export function eventLifeSensitivityTier(event: LifeMarkedEvent): LifeSensitivityTier | undefined {
  const correction = eventLifeSensitivityCorrection(event);
  if (correction) return correction.tier;
  const findings = eventLifeSensitivityFindings(event);
  if (!findings) return undefined;
  return Number(findings.byTier.high ?? 0) > 0 ? 'high' : 'private';
}

/** Whether an event carries a life mark at all. */
export function eventHoldsLifeSensitivityMark(event: LifeMarkedEvent): boolean {
  const tier = eventLifeSensitivityTier(event);
  return tier === 'private' || tier === 'high';
}
