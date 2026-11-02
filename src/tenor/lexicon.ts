// The word lists Tenor counts with.
//
// Written for this tool, for the way executives and analysts talk on earnings
// calls. General-purpose sentiment lists misread business language: "liability",
// "tax" and "cost" aren't bad news, and "growth" is only good news until it
// slows. So these lists leave out words whose meaning flips with context and
// keep the ones that carry a clear signal on a call.
//
// An entry ending in * matches any word starting with it ("improv*" matches
// improve, improved, improvement). Entries with spaces are phrases.

export type Category = 'pos' | 'neg' | 'unc' | 'weak' | 'strong';

/** Good news, said plainly. */
const POSITIVE = `
  accelerat* accretive achiev* advantag* attractive beat beats best better boost* breakthrough*
  confident confidence delighted encourag* enthusias* exceed* excellen* exceptional excit* favorabl*
  gain gains gained great greater healthy highest impressive improv* innovat* leadership
  momentum optimis* outpac* outperform* outstanding pleased pleasing positive positively profitab*
  progress rebound* recover* resilien* robust solid stabiliz* stable strength strengthen* strong
  stronger strongest succeed* success* surpass* tailwind tailwinds thriv* upside upbeat win wins winning
  well-positioned record-breaking
  ~record_revenue ~record_quarter ~record_year ~record_results ~record_bookings ~record_sales ~record_earnings
  ~record_margin ~record_margins ~record_level ~record_levels ~record_high ~record_growth ~record_demand
  ~ahead_of_plan ~ahead_of_schedule ~ahead_of_expectations ~well_positioned
`;

/** Bad news, said plainly. */
const NEGATIVE = `
  adverse* challeng* concern concerns concerned declin* decreas* decelerat* deteriorat* difficult*
  disappoint* downturn* downgrad* drag drags dragged drop drops dropped dropping erod* erosion fell
  headwind headwinds hurt hurting impair* lag lagged lagging lose losing loss losses lost miss missed
  misses negative negatively obstacle* pressure pressures pressured problem problems recession*
  setback* shortfall* slow slowed slower slowing slowdown slowdowns soft softer softening softness
  struggl* tough tougher unfavorabl* unfortunate* underperform* unprofitab* weak weaker weakest
  weakness weakened weakening worse worsen* worst delay delays delayed disrupt* cancel* churn
  layoff* shortage* constrain* cut cuts
`;

/** Uncertainty and hedging: the speaker isn't committing. */
const UNCERTAIN = `
  uncertain* unclear unknown unknowns unpredictab* volatil* fluctuat* assume assumes assuming
  assumption* believe believes depend depends depending dependent possibl* probabl* doubt* unsure
  unsettled unforeseen risk risks risky tentativ* speculat* fluid conceivabl* somewhat roughly
  ~too_early ~remains_to_be_seen ~hard_to_say ~hard_to_predict ~difficult_to_predict ~time_will_tell
  ~we'll_see ~sort_of ~kind_of ~a_little_bit ~to_some_extent ~it_depends ~we_hope ~we're_hopeful
  ~cautiously_optimistic
`;

/** Weak modal words: "may", "could". */
const WEAK = `may might could maybe perhaps hopefully hope seem seems seemed appear appears`;

/** Strong modal words: "will", "must". */
const STRONG = `
  will must always definitely certainly clearly undoubtedly absolutely unquestionably committed
  ~no_doubt ~without_question ~fully_expect
`;

/** Words that turn the good-news word after them around ("not strong"). */
export const NEGATORS = new Set(
  `not no never neither nor none nothing without hardly barely isn't wasn't aren't weren't don't doesn't didn't
   won't wouldn't can't cannot couldn't shouldn't hasn't haven't hadn't lack lacked lacking`
    .split(/\s+/)
    .filter(Boolean),
);

interface Entry {
  cat: Category;
  words: string[]; // phrase tokens; the last may be a stem
  stem: boolean;
}

const exact = new Map<string, Category>();
const stems: Array<[string, Category]> = [];
const phrases = new Map<string, Entry[]>(); // first token → phrases starting with it

function add(list: string, cat: Category) {
  for (const raw of list.split(/\s+/)) {
    if (!raw) continue;
    if (raw.startsWith('~')) {
      const words = raw.slice(1).split('_');
      const last = words[words.length - 1];
      const stem = last.endsWith('*');
      if (stem) words[words.length - 1] = last.slice(0, -1);
      const list = phrases.get(words[0]) ?? [];
      list.push({ cat, words, stem });
      phrases.set(words[0], list);
    } else if (raw.endsWith('*')) stems.push([raw.slice(0, -1), cat]);
    else exact.set(raw, cat);
  }
}
add(POSITIVE, 'pos');
add(NEGATIVE, 'neg');
add(UNCERTAIN, 'unc');
add(WEAK, 'weak');
add(STRONG, 'strong');
// Longer stems first, so "unfavorabl*" wins over "favorabl*".
stems.sort((a, b) => b[0].length - a[0].length);
for (const list of phrases.values()) list.sort((a, b) => b.words.length - a.words.length);

/** Category of a single lowercase word, or null. */
export function wordCategory(word: string): Category | null {
  const hit = exact.get(word);
  if (hit) return hit;
  for (const [stem, cat] of stems) if (word.startsWith(stem)) return cat;
  return null;
}

/** A phrase starting at tokens[i], if any: its category and length in tokens. */
export function phraseAt(tokens: string[], i: number): { cat: Category; length: number } | null {
  const list = phrases.get(tokens[i]);
  if (!list) return null;
  for (const p of list) {
    if (i + p.words.length > tokens.length) continue;
    let ok = true;
    for (let k = 0; k < p.words.length; k++) {
      const t = tokens[i + k];
      const w = p.words[k];
      const last = k === p.words.length - 1;
      if (!(t === w || (last && p.stem && t.startsWith(w)))) {
        ok = false;
        break;
      }
    }
    if (ok) return { cat: p.cat, length: p.words.length };
  }
  return null;
}

/** Plain-language names for the categories, used in the page. */
export const CATEGORY_LABEL: Record<Category, string> = {
  pos: 'Good-news words',
  neg: 'Bad-news words',
  unc: 'Hedges',
  weak: 'Weak modals (may, could)',
  strong: 'Strong modals (will, must)',
};

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

export interface Topic {
  id: string;
  name: string;
  terms: string[]; // lowercase words, stems (*) or phrases (with spaces)
  custom?: boolean;
}

export const TOPICS: Topic[] = [
  { id: 'demand', name: 'Demand', terms: ['demand', 'orders', 'order intake', 'bookings', 'backlog', 'pipeline', 'sell-through', 'consumption', 'traffic', 'volumes', 'unit volume*'] },
  { id: 'pricing', name: 'Pricing', terms: ['pricing', 'price', 'prices', 'priced', 'discount*', 'promotion*', 'asp', 'asps', 'average selling price*', 'price increase*'] },
  { id: 'margins', name: 'Margins', terms: ['margin', 'margins', 'gross margin*', 'operating margin*', 'profitability', 'mix'] },
  { id: 'costs', name: 'Costs', terms: ['cost', 'costs', 'expense', 'expenses', 'opex', 'spending', 'headcount', 'efficienc*', 'savings', 'inflation'] },
  { id: 'outlook', name: 'Guidance', terms: ['guidance', 'guide', 'guiding', 'outlook', 'forecast*', 'full year', 'full-year', 'second half', 'next quarter', 'reaffirm*'] },
  { id: 'ai', name: 'AI', terms: ['ai', 'artificial intelligence', 'generative', 'genai', 'machine learning', 'llm', 'llms', 'inference', 'gpu', 'gpus', 'copilot*', 'agentic'] },
  { id: 'competition', name: 'Competition', terms: ['competition', 'competitive', 'competitor*', 'market share', 'share gain*', 'win rate*', 'rival*'] },
  { id: 'macro', name: 'Economy', terms: ['macro', 'macroeconomic', 'economy', 'economic', 'recession*', 'interest rate*', 'tariff*', 'currency', 'foreign exchange', 'fx', 'geopolitic*'] },
  { id: 'supply', name: 'Supply chain', terms: ['supply', 'supplier*', 'inventory', 'inventories', 'lead time*', 'capacity', 'shortage*', 'logistics', 'freight'] },
  { id: 'capital', name: 'Capital return', terms: ['buyback*', 'repurchas*', 'dividend*', 'capital return*', 'return capital'] },
];

/** Builds a matcher for a topic's terms over a sentence's lowercase tokens. */
export function topicMatcher(terms: string[]): (tokens: string[]) => number {
  const singles: string[] = [];
  const singleStems: string[] = [];
  const multi: Array<{ words: string[]; stem: boolean }> = [];
  for (const raw of terms) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    const words = t.split(/\s+/);
    const stem = words[words.length - 1].endsWith('*');
    if (stem) words[words.length - 1] = words[words.length - 1].slice(0, -1);
    if (words.length === 1) (stem ? singleStems : singles).push(words[0]);
    else multi.push({ words, stem });
  }
  const single = new Set(singles);
  return (tokens) => {
    let n = 0;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (single.has(tok) || singleStems.some((s) => tok.startsWith(s))) {
        n++;
        continue;
      }
      for (const m of multi) {
        if (i + m.words.length > tokens.length) continue;
        let ok = true;
        for (let k = 0; k < m.words.length; k++) {
          const last = k === m.words.length - 1;
          if (!(tokens[i + k] === m.words[k] || (last && m.stem && tokens[i + k].startsWith(m.words[k])))) {
            ok = false;
            break;
          }
        }
        if (ok) {
          n++;
          i += m.words.length - 1;
          break;
        }
      }
    }
    return n;
  };
}

// ---------------------------------------------------------------------------
// Answers that may not answer
// ---------------------------------------------------------------------------

/** Phrases executives use to decline, defer or change the subject. */
export const DEFLECTIONS: RegExp[] = [
  /\b(?:don'?t|do not) break (?:that|it|this|those) out\b/i,
  /\bnot going to (?:give|provide|comment|guide|get into|speculate|break|share|parse|quantify)\b/i,
  /\b(?:won'?t|will not|can'?t|cannot) (?:comment|speculate|provide|give|share|get into|quantify|disclose)\b/i,
  /\b(?:too early|premature) to (?:say|tell|comment|speculate|call|quantify|give)\b/i,
  /\bas (?:I|we) (?:mentioned|said|noted|discussed)(?: (?:earlier|before|in (?:my|our) (?:prepared )?remarks))?\b/i,
  /\b(?:we'?re|we are) not (?:providing|giving|going to provide|in a position to)\b/i,
  /\bnot in a position to\b/i,
  /\b(?:don'?t|do not) (?:want to )?(?:get ahead of (?:ourselves|myself)|speculate)\b/i,
  /\bnot (?:something|a number|a metric|a figure) (?:that )?we (?:disclose|share|provide|give|guide to)\b/i,
  /\bwe(?:'ll| will) (?:share|provide|have|give) more (?:on that |detail |details |color )?(?:at|in|later|when|next)\b/i,
  /\bstay tuned\b/i,
  /\b(?:we|I) (?:don'?t|do not) (?:comment|guide|disclose|give (?:intra-?quarter|quarterly))\b/i,
  /\b(?:I'?d|I would|let me) (?:rather not|not want to)\b/i,
  /\b(?:take|step) a step back\b/i,
  /\bthe (?:bigger|broader|more important) (?:picture|point|story|thing)\b/i,
  /\bfocus(?:ed|ing)? on what we can control\b/i,
  /\b(?:it'?s|it is) a combination of (?:factors|things)\b/i,
];

/** The question asks for a figure. */
export const ASKS_FOR_NUMBER =
  /\b(?:how much|how many|how big|what percent(?:age)?|what share|quantify|ballpark|magnitude|size (?:of|that|the|it)|basis points|bps|in dollars|give (?:us )?(?:a|the) (?:number|figure|range|split|sense of (?:the )?size)|split (?:between|across|that)|what (?:was|is|were|are) the (?:number|amount|level|rate|growth|margin|impact|split|run-?rate))\b/i;

/** Words too general to tell whether an answer addressed the question. */
export const QUESTION_FILLER = new Set(
  `about above after again also another answer anything around asked asking back because been before being could
   color comment comments congrats congratulations curious does doing done each else maybe might more most much
   other over question questions quick quickly really said same some something still such sure talk talked
   that than thank thanks that's their them then there these they thing things think this those through
   want wanted wanting were what when where whether which while will with would year years quarter quarters
   just give little help understand sense guys great good morning afternoon evening hello wondering follow
   follow-up followup kind sort able going lot first second last next also okay right well now today get
   your you're you've we're we've there's here's it's let's could you can you how why who`
    .split(/\s+/)
    .filter(Boolean),
);
