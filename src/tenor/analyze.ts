// Scores a parsed call: tone, hedging, confidence and specificity, for the
// prepared remarks and the Q&A separately, by speaker, and topic by topic;
// plus the Q&A exchanges whose answers may not answer the question.
//
// Everything here is word counting against the lists in lexicon.ts. That
// makes every number explainable: the page can highlight each word behind it.

import { ASKS_FOR_NUMBER, DEFLECTIONS, NEGATORS, QUESTION_FILLER, phraseAt, topicMatcher, wordCategory, type Category, type Topic } from './lexicon';
import type { Call, Role, Turn } from './parse';

export interface Hit {
  start: number;
  end: number;
  cat: Category;
  flipped?: boolean; // a good-news word turned around by "not", "no"…
}

interface Sentence {
  tokens: string[];
  pos: number;
  neg: number;
}

interface Scan {
  hits: Hit[];
  words: number;
  nums: number;
  counts: Record<Category, number>;
  sentences: Sentence[];
}

const WORD = /[A-Za-z][A-Za-z'’\-]*|\$?\d[\d,]*(?:\.\d+)?%?/g;
const YEAR = /^(19|20)\d{2}$/;

/** Finds every counted word in a piece of text. */
export function scan(text: string): Scan {
  const hits: Hit[] = [];
  const counts: Record<Category, number> = { pos: 0, neg: 0, unc: 0, weak: 0, strong: 0 };
  const sentences: Sentence[] = [];
  let words = 0;
  let nums = 0;
  // Sentences, so negation and topics don't reach across a full stop.
  const bounds = [...text.matchAll(/[^.!?]+(?:[.!?]+["”’)]*|$)/g)];
  for (const b of bounds) {
    const base = b.index ?? 0;
    const raw = [...b[0].matchAll(WORD)];
    const tokens = raw.map((m) => m[0].toLowerCase().replace(/’/g, "'"));
    const sentence: Sentence = { tokens, pos: 0, neg: 0 };
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      words++;
      if (/\d/.test(tok)) {
        if (!YEAR.test(tok)) nums++;
        continue;
      }
      const start = base + (raw[i].index ?? 0);
      const phrase = phraseAt(tokens, i);
      let cat: Category | null = null;
      let length = 1;
      if (phrase) {
        cat = phrase.cat;
        length = phrase.length;
      } else {
        cat = wordCategory(tok);
        // "May" mid-sentence is the month.
        if (cat === 'weak' && tok === 'may' && raw[i][0] === 'May' && i > 0) cat = null;
      }
      if (!cat) continue;
      const lastTok = raw[i + length - 1];
      const end = base + (lastTok.index ?? 0) + lastTok[0].length;
      let flipped = false;
      if (cat === 'pos' || cat === 'neg') {
        for (let k = Math.max(0, i - 3); k < i; k++) {
          if (NEGATORS.has(tokens[k]) && !(tokens[k] === 'not' && tokens[k + 1] === 'only')) flipped = true;
        }
      }
      if (flipped && cat === 'neg') {
        // "not weak" isn't good news either: leave it out.
        i += length - 1;
        continue;
      }
      const counted: Category = flipped ? 'neg' : cat;
      counts[counted]++;
      if (counted === 'pos') sentence.pos++;
      if (counted === 'neg') sentence.neg++;
      hits.push({ start, end, cat: counted, flipped: flipped || undefined });
      i += length - 1;
    }
    sentences.push(sentence);
  }
  return { hits, words, nums, counts, sentences };
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

export interface Tally {
  words: number;
  nums: number;
  pos: number;
  neg: number;
  unc: number;
  weak: number;
  strong: number;
}

export interface Scores extends Tally {
  tone: number | null; // (good-news − bad-news words) per 1,000 words
  hedging: number | null; // hedges + weak modals per 1,000 words
  confidence: number | null; // strong ÷ (strong + weak) modals, %
  specificity: number | null; // figures per 1,000 words
}

const empty = (): Tally => ({ words: 0, nums: 0, pos: 0, neg: 0, unc: 0, weak: 0, strong: 0 });

function addScan(t: Tally, s: Scan) {
  t.words += s.words;
  t.nums += s.nums;
  t.pos += s.counts.pos;
  t.neg += s.counts.neg;
  t.unc += s.counts.unc;
  t.weak += s.counts.weak;
  t.strong += s.counts.strong;
}

// Below this many words a score says more about chance than about the call.
const MIN_WORDS = 80;

export function scores(t: Tally): Scores {
  const modal = t.strong + t.weak;
  return {
    ...t,
    tone: t.words >= MIN_WORDS ? ((t.pos - t.neg) / t.words) * 1000 : null,
    hedging: t.words >= MIN_WORDS ? ((t.unc + t.weak) / t.words) * 1000 : null,
    confidence: modal >= 4 ? (t.strong / modal) * 100 : null,
    specificity: t.words >= MIN_WORDS ? (t.nums / t.words) * 1000 : null,
  };
}

// ---------------------------------------------------------------------------
// Q&A exchanges
// ---------------------------------------------------------------------------

export interface Flag {
  kind: 'deflect' | 'no-number' | 'off-topic' | 'short';
  text: string;
}

export interface Exchange {
  n: number;
  analyst: string;
  firm: string;
  question: string;
  answers: Array<{ speaker: string; role: Role; text: string }>;
  questionWords: number;
  answerWords: number;
  flags: Flag[];
  score: number;
  flagged: boolean;
}

const stemOf = (w: string) => w.slice(0, 6);

function contentTerms(text: string): string[] {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/[A-Za-z][A-Za-z'’\-]{3,}/g)) {
    const w = m[0].toLowerCase().replace(/’/g, "'");
    if (QUESTION_FILLER.has(w) || w.endsWith("'s") && QUESTION_FILLER.has(w.slice(0, -2))) continue;
    if (!out.has(stemOf(w))) out.set(stemOf(w), w);
  }
  return [...out.values()];
}

function judge(question: string, answer: string): { flags: Flag[]; score: number } {
  const flags: Flag[] = [];
  let score = 0;
  for (const re of DEFLECTIONS) {
    const m = answer.match(re);
    if (m) {
      flags.push({ kind: 'deflect', text: `Deflection: “${m[0]}”` });
      score += 2;
      break;
    }
  }
  const answerScan = scan(answer);
  if (ASKS_FOR_NUMBER.test(question) && answerScan.nums === 0) {
    flags.push({ kind: 'no-number', text: 'Asked for a figure; none given' });
    score += 1;
  }
  const terms = contentTerms(question);
  if (terms.length >= 3) {
    const said = new Set(contentTerms(answer).map(stemOf));
    const missing = terms.filter((t) => !said.has(stemOf(t)));
    if ((terms.length - missing.length) / terms.length < 0.25) {
      flags.push({ kind: 'off-topic', text: `Few of the question’s terms come up (${missing.slice(0, 3).join(', ')})` });
      score += 1;
    }
  }
  const qWords = question.split(/\s+/).length;
  const aWords = answer.split(/\s+/).length;
  if (aWords < 50 && qWords > 40) {
    flags.push({ kind: 'short', text: 'Short answer to a long question' });
    score += 1;
  }
  return { flags, score };
}

function exchangesOf(turns: Turn[]): Exchange[] {
  const out: Exchange[] = [];
  let cur: Omit<Exchange, 'n' | 'flags' | 'score' | 'flagged' | 'questionWords' | 'answerWords'> | null = null;
  const close = () => {
    if (cur && cur.answers.length && cur.question.split(/\s+/).length >= 5) {
      const answer = cur.answers.map((a) => a.text).join(' ');
      const { flags, score } = judge(cur.question, answer);
      out.push({
        ...cur,
        n: out.length + 1,
        questionWords: cur.question.split(/\s+/).length,
        answerWords: answer.split(/\s+/).length,
        flags,
        score,
        flagged: score >= 2,
      });
    }
    cur = null;
  };
  for (const t of turns) {
    if (t.section !== 'qa') continue;
    const text = t.paras.map((p) => p.text).join(' ');
    if (t.role === 'operator') {
      if (cur?.answers.length) close();
      continue;
    }
    if (t.role === 'analyst') {
      if (cur && cur.analyst === t.speaker) cur.question += `\n\n${text}`; // a follow-up
      else {
        close();
        cur = { analyst: t.speaker, firm: t.title, question: text, answers: [] };
      }
      continue;
    }
    if (cur && (t.role === 'ceo' || t.role === 'cfo' || t.role === 'exec')) cur.answers.push({ speaker: t.speaker, role: t.role, text });
  }
  close();
  return out;
}

// ---------------------------------------------------------------------------
// One call
// ---------------------------------------------------------------------------

export interface TopicScore {
  mentions: number;
  per1k: number; // mentions per 1,000 words of the call
  tone: number | null; // management's tone in sentences that mention it, per 1,000 words
}

export interface Analysis {
  call: Call;
  prepared: Scores; // management's prepared remarks
  qa: Scores; // management's answers
  mgmt: Scores;
  analysts: Scores;
  byRole: Partial<Record<'ceo' | 'cfo' | 'exec', Scores>>;
  speakers: Array<{ name: string; title: string; role: Role; scores: Scores }>;
  topics: Record<string, TopicScore>;
  exchanges: Exchange[];
  nonAnswerShare: number | null;
  boilerWords: number;
}

const isMgmt = (r: Role) => r === 'ceo' || r === 'cfo' || r === 'exec';

export function analyze(call: Call, topics: Topic[]): Analysis {
  const prepared = empty();
  const qa = empty();
  const analysts = empty();
  const role: Record<'ceo' | 'cfo' | 'exec', Tally> = { ceo: empty(), cfo: empty(), exec: empty() };
  const speakers = new Map<string, { name: string; title: string; role: Role; tally: Tally }>();
  const matchers = topics.map((t) => ({ id: t.id, match: topicMatcher(t.terms) }));
  const topicTally = new Map<string, { mentions: number; pos: number; neg: number; words: number }>(
    topics.map((t) => [t.id, { mentions: 0, pos: 0, neg: 0, words: 0 }]),
  );
  let callWords = 0;
  let boilerWords = 0;

  for (const t of call.turns) {
    if (t.role === 'operator' || t.role === 'other') continue;
    for (const p of t.paras) {
      if (p.boiler) {
        boilerWords += p.text.split(/\s+/).length;
        continue;
      }
      const s = scan(p.text);
      callWords += s.words;
      if (isMgmt(t.role)) {
        addScan(t.section === 'qa' ? qa : prepared, s);
        addScan(role[t.role as 'ceo' | 'cfo' | 'exec'], s);
      } else if (t.role === 'analyst') addScan(analysts, s);
      const sp = speakers.get(t.speaker) ?? { name: t.speaker, title: t.title, role: t.role, tally: empty() };
      addScan(sp.tally, s);
      speakers.set(t.speaker, sp);
      for (const sentence of s.sentences) {
        for (const m of matchers) {
          const n = m.match(sentence.tokens);
          if (!n) continue;
          const tt = topicTally.get(m.id)!;
          tt.mentions += n;
          if (isMgmt(t.role)) {
            tt.pos += sentence.pos;
            tt.neg += sentence.neg;
            tt.words += sentence.tokens.length;
          }
        }
      }
    }
  }

  const mgmt = empty();
  for (const k of Object.keys(mgmt) as Array<keyof Tally>) mgmt[k] = prepared[k] + qa[k];
  const topicScores: Record<string, TopicScore> = {};
  for (const [id, t] of topicTally) {
    topicScores[id] = {
      mentions: t.mentions,
      per1k: callWords ? (t.mentions / callWords) * 1000 : 0,
      tone: t.words >= 20 ? ((t.pos - t.neg) / t.words) * 1000 : null,
    };
  }
  const exchanges = exchangesOf(call.turns);
  const byRole: Analysis['byRole'] = {};
  for (const k of ['ceo', 'cfo', 'exec'] as const) if (role[k].words) byRole[k] = scores(role[k]);

  return {
    call,
    prepared: scores(prepared),
    qa: scores(qa),
    mgmt: scores(mgmt),
    analysts: scores(analysts),
    byRole,
    speakers: [...speakers.values()].map((s) => ({ name: s.name, title: s.title, role: s.role, scores: scores(s.tally) })),
    topics: topicScores,
    exchanges,
    nonAnswerShare: exchanges.length ? (exchanges.filter((e) => e.flagged).length / exchanges.length) * 100 : null,
    boilerWords,
  };
}

// ---------------------------------------------------------------------------
// Findings across calls
// ---------------------------------------------------------------------------

export interface Metric {
  id: string;
  label: string;
  get: (a: Analysis) => number | null;
  fmt: (v: number) => string;
  up: 'good' | 'bad' | 'neutral';
}

export const signed = (v: number, digits = 1) => {
  const r = Number(v.toFixed(digits));
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(digits)}`;
};
const one = (v: number) => v.toFixed(1);
const pct = (v: number) => `${Math.round(v)}%`;

export const METRICS: Record<string, Metric> = {
  qaTone: { id: 'qaTone', label: 'Management’s tone in the Q&A', get: (a) => a.qa.tone, fmt: (v) => signed(v), up: 'good' },
  prepTone: { id: 'prepTone', label: 'Tone in the prepared remarks', get: (a) => a.prepared.tone, fmt: (v) => signed(v), up: 'good' },
  qaHedging: { id: 'qaHedging', label: 'Hedging in the Q&A', get: (a) => a.qa.hedging, fmt: (v) => `${one(v)} per 1,000 words`, up: 'bad' },
  qaSpecificity: { id: 'qaSpecificity', label: 'The rate of figures in the answers', get: (a) => a.qa.specificity, fmt: (v) => `${one(v)} per 1,000 words`, up: 'good' },
  analystTone: { id: 'analystTone', label: 'Analysts’ tone', get: (a) => a.analysts.tone, fmt: (v) => signed(v), up: 'good' },
  nonAnswers: { id: 'nonAnswers', label: 'The share of possible non-answers', get: (a) => a.nonAnswerShare, fmt: pct, up: 'bad' },
};

export interface Finding {
  text: string;
  weight: number;
  quarter: string; // which call it points at
}

/** Plain statements about what stands out in the latest call (or `focus`). */
export function findings(list: Analysis[], topics: Topic[], focusIdx = list.length - 1): Finding[] {
  const out: Finding[] = [];
  const focus = list[focusIdx];
  if (!focus) return out;
  const label = focus.call.period.label;
  const n = list.length;

  if (n >= 3) {
    for (const m of Object.values(METRICS)) {
      const vals = list.map(m.get);
      const v = vals[focusIdx];
      if (v == null) continue;
      const others = vals.filter((x, i) => x != null && i !== focusIdx) as number[];
      if (others.length < 2) continue;
      const lowest = others.every((x) => v < x);
      const highest = others.every((x) => v > x);
      if (!lowest && !highest) continue;
      const word = lowest ? 'lowest' : 'highest';
      const bad = (lowest && m.up === 'good') || (highest && m.up === 'bad');
      out.push({ text: `${m.label} was the ${word} of the ${others.length + 1} calls in ${label} (${m.fmt(v)}).`, weight: bad ? 3 : 2, quarter: label });
    }
  }

  // The script against the answers.
  const gaps = list.map((a) => (a.prepared.tone != null && a.qa.tone != null ? a.prepared.tone - a.qa.tone : null));
  const gap = gaps[focusIdx];
  if (gap != null && gap > 8) {
    const widest = n >= 3 && gaps.every((g, i) => i === focusIdx || g == null || g < gap);
    out.push({
      text: `The prepared remarks scored ${gap.toFixed(1)} points more upbeat than management’s answers in the Q&A${widest ? `, the widest gap of the ${n} calls` : ''}.`,
      weight: widest ? 3 : 1.5,
      quarter: label,
    });
  }

  // The biggest move in Q&A tone from one call to the next.
  if (n >= 3) {
    let best = { d: 0, i: -1 };
    for (let i = 1; i < n; i++) {
      const a = list[i - 1].qa.tone;
      const b = list[i].qa.tone;
      if (a != null && b != null && Math.abs(b - a) > Math.abs(best.d)) best = { d: b - a, i };
    }
    if (best.i > 0 && Math.abs(best.d) >= 8) {
      out.push({
        text: `The biggest ${best.d < 0 ? 'drop' : 'rise'} in Q&A tone came in ${list[best.i].call.period.label}: ${signed(best.d)} from ${list[best.i - 1].call.period.label}.`,
        weight: 2,
        quarter: list[best.i].call.period.label,
      });
    }
  }

  // A topic suddenly getting more airtime.
  const prior = list.filter((_, i) => i !== focusIdx);
  if (prior.length) {
    let best: { name: string; ratio: number; v: number; tone: number | null } | null = null;
    for (const t of topics) {
      const v = focus.topics[t.id]?.per1k ?? 0;
      const avg = prior.reduce((s, a) => s + (a.topics[t.id]?.per1k ?? 0), 0) / prior.length;
      if (v < 1 || focus.topics[t.id].mentions < 4) continue;
      const ratio = avg > 0 ? v / avg : Infinity;
      if (ratio >= 1.8 && (!best || ratio > best.ratio)) best = { name: t.name, ratio, v, tone: focus.topics[t.id].tone };
    }
    if (best) {
      const times = Number.isFinite(best.ratio) ? `${best.ratio.toFixed(1)} times as often as in the other calls` : 'for the first time';
      const tone = best.tone == null ? '' : best.tone < -5 ? `, and management’s tone around it was negative (${signed(best.tone)})` : best.tone > 5 ? `, and management’s tone around it was positive (${signed(best.tone)})` : '';
      out.push({ text: `${best.name} came up ${times} in ${label}${tone}.`, weight: 2.5, quarter: label });
    }
  }

  // Answers that may not answer.
  const flagged = focus.exchanges.filter((e) => e.flagged).length;
  if (focus.exchanges.length && flagged) {
    const prev = list[focusIdx - 1];
    const before = prev ? prev.exchanges.filter((e) => e.flagged).length : null;
    const trend = prev && before != null ? (flagged > before ? `, up from ${before} of ${prev.exchanges.length} in ${prev.call.period.label}` : flagged < before ? `, down from ${before} of ${prev.exchanges.length} in ${prev.call.period.label}` : '') : '';
    out.push({
      text: `${flagged} of ${focus.exchanges.length} answers in ${label} look like possible non-answers${trend}.`,
      weight: flagged / focus.exchanges.length >= 0.3 ? 2.5 : 1,
      quarter: label,
    });
  }

  if (n === 1 && focus.prepared.tone != null && focus.qa.tone != null) {
    out.push({ text: `Tone was ${signed(focus.prepared.tone)} in the prepared remarks and ${signed(focus.qa.tone)} in the Q&A. Add more quarters to see how it moves.`, weight: 1, quarter: label });
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, 4);
}

