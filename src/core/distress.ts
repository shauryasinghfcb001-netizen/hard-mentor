// Distress override. Keyword/regex rules always win over any classifier
// (blueprint section 5, step 2). Tuned for recall: a false positive costs a
// gentler reply; a miss could cost much more.
//
// Rules are grouped into wording FAMILIES (what a student might say about
// ending their life, being gone, hurting themselves, being a burden, having no
// way out, in English, romanised Hinglish and Devanagari), not single
// sentences. This is a keyword screen. It is NOT a clinical tool: it misses
// indirect, coded, misspelt or non-listed phrasing, and it flags some
// non-crisis messages. It only decides to send the supportive reply and skip
// study pressure; it does not assess risk.

export const TELE_MANAS = "14416";

// Shared fragments. `S` keeps a match inside one sentence.
const S = "[^.!?\\n]";
const MYSELF = "my\\s?self";
const LIVE_END = "(living|live|life|alive|being\\s+alive|existing|exist|go(ing)?\\s+on\\s+(living|like\\s+this|any\\s?more|with\\s+(life|living))|keep(ing)?\\s+(on\\s+)?(living|going)|stay(ing)?\\s+alive)";

const RULES: { id: string; re: RegExp }[] = [
  // --- direct statements about suicide / killing oneself ---
  { id: "suicide", re: /\bsuicid/i },
  { id: "kill-self", re: new RegExp(`\\b(kill(ing|ed)?|hang(ing)?|drown(ing)?|shoot(ing)?|stab(bing)?)\\s+${MYSELF}\\b`, "i") },
  { id: "end-my-life", re: /\b(end(ing|ed)?|tak(e|ing)|took)\s+(of\s+)?my\s+(own\s+)?(life|lives)\b/i },
  { id: "end-it", re: /\bend\s+(it\s+all|everything\s+for\s+good)\b/i },
  {
    id: "end-it-intent",
    re: /\b(feel(ing)?\s+like|want(ed)?\s+to|wanna|going\s+to|gonna|plan(ning)?\s+to|thinking\s+(of|about)|ready\s+to|about\s+to|will|should|might|could)\s+end(ing)?\s+(it|things|everything|all)\b(?!\s+(here|there|with|by|on|at|for\s+(today|now|the\s+day)|session))/i,
  },
  { id: "thoughts-of-dying", re: /\b(think(ing)?|thought|thoughts)\s+(of|about)\s+(dying|death|suicide|ending\s+(it|things|my\s+life))\b/i },

  // --- wanting to be dead, gone, or never to have been born ---
  { id: "want-to-die", re: /\b(want|wanna|wish|going|gonna|hope|ready|rather|feel\s+like|feeling\s+like)\s+(to\s+|i\s+(was|were)\s+)?(just\s+)?(die|dying|be\s+dead|being\s+dead)\b(?!\s+(to|for)\b)/i },
  { id: "wish-dead", re: /\bwish\s+(that\s+)?i\s+(was|were|am|could\s+be|would\s+be)\s+(just\s+)?dead\b/i },
  { id: "better-if-dead", re: new RegExp(`\\b(better|best)\\s+(off\\s+)?(if|when|that)\\s+i\\s+(was|were|am)?\\s*(dead|gone|not\\s+(alive|here|around))\\b`, "i") },
  { id: "world-better-without-me", re: new RegExp(`\\b(world|life)\\s+(would|will)\\s+be\\s+(better|easier|happier)\\b${S}{0,20}\\b(without|if)\\s+(i|me)\\b`, "i") },
  { id: "never-born", re: /\bnever\s+(been\s+|was\s+|were\s+)?born\b/i },
  {
    id: "disappear",
    re: /\b(wish|want|wanna|hope)\s+(to\s+|i\s+(could|would|can|will|was|were)\s+|that\s+i\s+(could|would)\s+)(just\s+)?(disappear|vanish|fade\s+away|go\s+away\s+forever|not\s+exist|cease\s+to\s+exist|sleep\s+forever|never\s+wake\s+up|not\s+wake\s+up)\b/i,
  },

  // --- not wanting to live / no reason to live ---
  {
    id: "dont-want-to-live",
    re: /\b(don'?t|do\s+not|no\s+longer|never)\s+(really\s+)?(want|wanna)\s+to\s+(live(?!\s+(in|at|with|near|like)\b)|be\s+alive|exist|wake\s+up|be\s+here|go\s+on|keep\s+going)/i,
  },
  { id: "should-not-live", re: /\b(shouldn'?t|should\s+not|ought\s+not\s+to|don'?t\s+deserve\s+to)\s+(be\s+alive|live|exist|be\s+here|be\s+around)\b/i },
  { id: "no-point-living", re: new RegExp(`\\b(no|any|without|lost\\s+(my|the))\\s+(point|reason|purpose|meaning|will)\\s+(left\\s+)?(in\\s+|to\\s+|of\\s+|for\\s+)?${LIVE_END}`, "i") },
  { id: "dont-see-reason", re: new RegExp(`\\b(don'?t|do\\s+not|can'?t|cannot)\\s+(see|find|have)\\s+(any|a|the)\\s+(point|reason|purpose|meaning)\\s+(in\\s+|to\\s+|of\\s+|for\\s+)?${LIVE_END}`, "i") },
  { id: "not-worth-living", re: /\b(not|n'?t)\s+worth\s+(living|it\s+to\s+live)\b|\blife\s+(has|had)\s+no\s+(meaning|point|purpose)\b|\bwhat'?s\s+the\s+point\s+(of|in)\s+(living|life|being\s+alive)\b/i },
  { id: "done-with-life", re: /\b(done|finished|tired|sick|fed\s+up)\s+(with|of)\s+(life|living|this\s+life|this\s+world)\b/i },

  // --- hurting oneself ---
  { id: "self-harm", re: /\b(self[-\s]?harm\w*|self[-\s]?injur\w*)\b/i },
  { id: "hurt-myself", re: new RegExp(`\\b(hurt(ing)?|harm(ing)?|cut(ting)?|burn(ing|ed|s)?|injur(e|ing)|punish(ing)?|hit(ting)?|beat(ing)?|slash(ing)?|bit(e|ing)|starv(e|ing)|poison(ing)?)\\s+${MYSELF}\\b`, "i") },
  {
    id: "method-or-means",
    re: /\b(overdos\w*|(take|took|taking|swallow(ed|ing)?)\s+all\s+(of\s+)?(my|the)\s+(pills|tablets|medicine|medication)|slit\s+my\s+(wrists?|throat)|jump(ing|ed)?\s+(off|from)\s+(the\s+|a\s+)?(terrace|roof|building|balcony|bridge|window|cliff)|jump(ing)?\s+in\s+front\s+of\s+(a\s+)?(train|bus|car))\b/i,
  },

  // --- hopelessness, being trapped, being a burden ---
  { id: "cant-go-on", re: /\bcan'?t\s+(go\s+on|take\s+(it|this)\s+any\s?more|cope|live\s+like\s+this|stay\s+alive|survive\s+this)\b/i },
  { id: "no-way-out", re: /\b(can'?t|cannot|couldn'?t)\s+(see|find)\s+(a\s+|any\s+)?(way|path|exit)\s+out\b|\bno\s+(way|exit)\s+out\b|\bgive\s+up\s+on\s+(life|living)\b/i },
  { id: "worthless", re: /\b(i'?m|i\s+am|feel|feeling)\s+(so\s+|such\s+)?(a\s+)?(worthless|hopeless|burden)\b/i },
  { id: "better-off-without", re: /\bbetter\s+off\s+without\s+me\b/i },
  {
    id: "others-fine-without-me",
    re: new RegExp(`\\b(everyone|everybody|they|family|parents|mom|dad|mother|father|friends|world|people|all|nobody|no\\s*one)\\b${S}{0,40}\\b(better|happier|fine|safer|relieved|free|easier|okay|glad)\\b${S}{0,25}\\b(without|if)\\s+(i|me)\\b`, "i"),
  },
  {
    id: "nobody-would-notice",
    re: new RegExp(`\\b(nobody|no\\s*one|none)\\b${S}{0,25}\\b(notice|care|miss)\\w*\\b${S}{0,30}\\b(if|when)\\s+(i|me)\\b${S}{0,15}\\b(vanish\\w*|disappear\\w*|gone|died|dead|die|left|leave)\\b`, "i"),
  },
  { id: "panic", re: /\b(panic\s+attack|can'?t\s+breathe)\b/i },

  // --- romanised Hinglish ---
  { id: "hi-marna", re: /\b(mar\s+jaa?(na|un|unga|ungi|oon)|mar\s+hi\s+jaa?(un|oon)|marna\s+(chah\w*|hai)|mar\s+jaana)\b/i },
  { id: "hi-jaan", re: /\b(apni\s+)?jaan\s+(de\s+(du|dun|dunga|dungi|dena|doon)|dena|le\s+(lu|lun|lunga|lungi))\b/i },
  { id: "hi-jeena", re: new RegExp(`\\bj(ee?|i)(na|ne)\\b${S}{0,25}\\b(nahi|nhi|nahin|nai)\\b`, "i") },
  { id: "hi-zindagi", re: new RegExp(`\\bzindagi\\b${S}{0,20}\\b(khatam|khtm|thak\\w*|tang|bojh)\\b`, "i") },
  { id: "hi-khatam-kar", re: /\b(sab|sabkuch|sab\s+kuch|ye\s+sab)\s+khatam\s+kar\s+(dena|dene|dun|du|doon)\s+(chah\w*|ka\s+(mann|man|dil)|ki\s+ichh?a)|\bkhud\s+ko\s+(khatam|maar|nuksan|chot)\b/i },
  { id: "hi-without-me", re: new RegExp(`\\bmere\\s+bina\\b${S}{0,20}\\b(khush|achha|accha|theek|behtar|sukhi|aaram)\\b|\\b(main|mai|mein)\\s+(nahi|nhi)\\s+rah(unga|ungi|oonga|oongi)\\b`, "i") },

  // --- Devanagari (no \b: it does not work on these characters) ---
  { id: "hi-devanagari", re: /आत्महत्या|मर\s+जा(ना|ऊं|ऊँ|ऊंगा|ऊँगा|ऊंगी|ऊँगी)|मरना\s+चाह|जीना\s+नहीं|जीने\s+(का|की)\s+\S{0,10}\s*नहीं|(ज़िंदगी|जिंदगी|जीवन)\s+खत्म/ },
];

export interface DistressResult {
  distress: boolean;
  /** rule ids only. The matched wording is never returned. */
  matched: string[];
}

/** Lowercase, straighten apostrophes, drop zero-width characters, collapse spaces. */
export function normalizeForRules(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectDistress(text: string): DistressResult {
  const t = normalizeForRules(text);
  const matched = RULES.filter((r) => r.re.test(t)).map((r) => r.id);
  return { distress: matched.length > 0, matched };
}

/** All rule ids, for coverage tests. */
export const DISTRESS_RULE_IDS: readonly string[] = RULES.map((r) => r.id);

/**
 * Routing evidence that holds no message text: whether the override fired,
 * which rule ids matched, and the message length in characters.
 */
export function distressRoutingEvidence(text: string): { route: "distress_override" | "not_distress"; ruleIds: string[]; chars: number } {
  const d = detectDistress(text);
  return { route: d.distress ? "distress_override" : "not_distress", ruleIds: d.matched, chars: text.length };
}

export function distressReply(name: string): string {
  return (
    `${name}, I'm really glad you told me. Studies can wait, you matter more. ` +
    `Please talk to someone right now: Tele-MANAS is free and open 24x7 at ${TELE_MANAS} ` +
    `(or 1-800-891-4416). If you are in immediate danger, call 112. ` +
    `I can also help you tell a parent or someone you trust. I'm here.`
  );
}
