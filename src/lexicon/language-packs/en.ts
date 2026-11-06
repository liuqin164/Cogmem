export const EN_ENTITY_TYPE_TERMS = {
  device: ['keyboard', 'mouse', 'monitor', 'device', 'earbuds', 'bluetooth earbuds', 'headset', 'earphone', 'earphones'],
  project: ['project', 'repo', 'repository', 'sdk', 'library', 'platform', 'api'],
  person: ['they', 'user'],
  brand: ['apple', 'sony', 'logitech', 'razer', 'dell', 'brand', 'framework', 'library'],
  issue: ['issue', 'bug']
} as const;

export const EN_RELATION_PHRASES = {
  owns: ['i own', 'i have', 'i got', 'my'],
  purchased: ['i bought', 'i bought another', 'i bought a new', 'i got a new'],
  has_issue: ['issue', 'disconnect', 'noise', 'lag', 'slow', 'connection lost', 'flicker'],
  worked_on: ['worked on', 'working on', 'building', 'we are building', "we're building", 'developing', 'maintaining', 'shipping'],
  likes: ['i like'],
  dislikes: ['i dislike']
} as const;

export const EN_REFERENCE_SIGNALS = {
  newInstance: ['i bought another', 'i got a new'],
  updateInstance: ['that one', 'the old one', 'the new one', 'the previous one', 'previous one', 'new one', 'this project', 'the new project', 'the previous project'],
  ambiguous: ['it', 'this one', 'that thing', 'this project', 'that project'],
  latest: ['the new one', 'new one', 'this one', 'the current one', 'this project', 'the new project', 'new project', 'that project'],
  previous: ['the previous one', 'previous one', 'the old one', 'old one', 'the previous project', 'previous project', 'old project']
} as const;

export const EN_SHORT_REPLY_BINDING = {
  approved: ['yes', 'ok', 'okay', 'sounds good', 'continue', 'go on'],
  rejected: ['no', "don't", "don't do that", 'never mind', 'forget it'],
  entitySelection: ['that one', 'this one', 'the new one', 'new one', 'the previous one', 'previous one', 'the old one', 'old one']
} as const;

export const EN_PENDING_PATTERNS = {
  action: [/\bshould\b/i, /\bdo you want\b/i, /\bwant me to\b/i],
  entity: [/\bwhich\b/i, /\bor\b/i]
} as const;

export const EN_LONG_TERM_SIGNAL_TERMS = ['workflow', 'api', 'database', 'project', 'issue', 'prefer', 'like', 'dislike', 'decide', 'using', 'fixed', 'gave away'] as const;

export const EN_ISSUE_KEYWORDS = {
  connectivity: ['disconnect', 'connection lost'],
  sound: ['noise'],
  performance: ['lag', 'slow', 'flicker']
} as const;

export const EN_ISSUE_QUALIFIERS = {
  left: ['left ear'],
  right: ['right ear']
} as const;

/**
 * The English social-turn vocabulary (#135).
 *
 * Built the way the Chinese pack is built — every group, not just the `thanks` family that used to be sprinkled
 * into the Chinese list. Tokens are matched longest-first and the residue is what is left, so a token that
 * overlaps a content word costs a missed suppression rather than a false one.
 */
export const EN_SOCIAL_FILLER_TOKENS: readonly string[] = [
  // thanks
  'thank you so much', 'thanks a lot', 'thank you very much', 'many thanks', 'thanks so much', 'thank you',
  'thanks', 'thx', 'ty', 'cheers', 'much appreciated', 'appreciate it', 'appreciate that', 'grateful',
  // agreement and interjections (#145): thanks plus a reaction word is still small talk
  'great', 'cool', 'awesome', 'perfect', 'nice', 'ok', 'okay', 'got it', 'sounds good', 'no worries', 'sure', 'alright', 'lovely',
  // greetings
  'good morning', 'good afternoon', 'good evening', 'good night', 'morning', 'evening', 'how are you doing',
  'how are you', 'how is it going', "how's it going", 'hi there', 'hey there', 'hello there', 'hi', 'hello',
  'hey', 'yo', 'greetings', 'long time no see',
  // acknowledgements and confirmations
  'ok', 'okay', 'k', 'got it', 'gotcha', 'understood', 'sounds good', 'sounds great', 'sure', 'sure thing',
  'no problem', 'no worries', 'np', 'yep', 'yeah', 'yup', 'yes', 'nope', 'nah', 'alright', 'all right',
  'right', 'cool', 'nice', 'great', 'perfect', 'awesome', 'sweet', 'sweet heart', 'noted', 'roger',
  // closings and politeness
  'goodbye', 'bye', 'see you', 'see ya', 'talk later', 'talk to you later', 'take care', 'have a good one',
  'have a nice day', 'please', 'welcome', 'you are welcome', "you're welcome", 'sorry', 'my bad', 'excuse me',
  'pardon', 'well done', 'good job', 'nice work', 'keep it up', 'no rush', 'anytime', 'likewise', 'same to you',
  'good luck', 'congrats', 'congratulations',
];

export const EN_SOCIAL_CONTENT_CUE_PATTERNS: readonly RegExp[] = [
  /\d/,                                                                        // numbers, versions, dates
  /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/,                                           // explicit dates
  /\b(today|tomorrow|yesterday|tonight|this (morning|afternoon|evening|week|month|year)|last (night|week|month|year)|next (week|month|year)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  // The residue has its spaces stripped by the filler segmentation, so the joined forms are matched too:
  // `last time` arrives as `lasttime`. Without them the English back-reference never fires.
  /\b(earlier|before|last time|previously|back then|at the time|remember|do you remember|recall|mentioned|said before|told (me|you)|used to|the old|the original)\b|(earlier|before|lasttime|previously|backthen|atthetime|remember|doyouremember|recall|mentioned|saidbefore|toldme|toldyou|usedto|theold|theoriginal)/i,
  /\b(what|which|where|who|whom|whose|when|why|how|how many|how much|how long|is|are|was|were|did|does|do|can|could|should|would|will)\b[^?]*\?/i,                    // content questions
  /\b(what|which|where|who|when|why|how)\b/i,
];

// The residue has its spaces stripped by the filler segmentation, so the multi-word forms have to be matched
// without them: `that one` arrives as `thatone`. Both spellings are kept because the acknowledgement lead is
// tested against the raw text.
export const EN_SOCIAL_BACK_REFERENCE = /\b(last time|earlier|just now|above|that one|this one|the one|previously|the original|the old one|as i said|as you said|just said|just mentioned)\b|(lasttime|earlier|justnow|thattime|thatone|thisone|theone|previously|theoriginal|theoldone|asisaid|asyousaid|justsaid|justmentioned)/i;
export const EN_SOCIAL_NEW_CONTENT = /\b(deploy|deployment|release|rollback|roll back|fix|fixed|change|changed|update|updated|upgrade|migrate|migration|config|configure|schedule|decide|decision|handle|check|investigate|debug|review|retro|write|implement|support|research|time|date|window|threshold|retention|archive|cleanup|permission|cost|budget|capacity|alert|drill|oncall|contract|interface|version|dependency|why|how|many|when|which|whether)\b/i;
export const EN_SOCIAL_ACK_LEAD = /^[\s\p{P}\p{S}]*(ok|okay|sure|got it|yep|yeah|yes|alright|all right|fine|good|great|nice|cool|noted|understood|no problem)/iu;
