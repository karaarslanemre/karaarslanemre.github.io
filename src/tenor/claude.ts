// What Claude adds in the copy of Tenor hosted on claude.ai: a verdict on
// each answer in the Q&A, and a short read of the trend across calls. Both
// run on the visitor's own Claude plan, through the page's "sample"
// capability, and only when the visitor asks.

import { signed, type Analysis } from './analyze';
import type { Topic } from './lexicon';
import type { Call, Reading } from './parse';

export type Verdict = 'answered' | 'partial' | 'sidestepped';
export interface Judgment {
  verdict: Verdict;
  reason: string;
}

interface SampleOptions {
  modelTier?: 'quick' | 'default' | 'complex';
  signal?: AbortSignal;
  onText?: (u: { text: string }) => void;
}
type Sample = ((input: string, options?: SampleOptions) => Promise<{ text: string; truncated: boolean }>) & {
  json: <T>(input: string, options?: SampleOptions) => Promise<T>;
};

export class ClaudeError extends Error {
  constructor(public code: string, message: string, public final = false) {
    super(message);
  }
}

let ready: Promise<Sample | null> | null = null;

/** Claude's "sample" capability, or null outside Claude (or signed out). */
export function claude(): Promise<Sample | null> {
  if (!ready) {
    const c = (window as unknown as { claude?: { use?: (name: string) => Promise<unknown> } }).claude;
    ready = c?.use ? c.use('sample').then((s) => (typeof s === 'function' ? (s as Sample) : null)).catch(() => null) : Promise.resolve(null);
  }
  return ready;
}

function explain(e: unknown): ClaudeError {
  const code = (e as { code?: string })?.code ?? '';
  switch (code) {
    case 'cancelled':
      return new ClaudeError('cancelled', 'Stopped.');
    case 'not_granted':
      return new ClaudeError(code, 'Claude wasn’t allowed to work on this page. Reload the page to be asked again.', true);
    case 'session_expired':
      return new ClaudeError(code, 'Your Claude session has ended. Sign in again, then reload this page.', true);
    case 'sampling_disabled':
    case 'not_declared':
    case 'capability_disabled':
    case 'capability_removed':
      return new ClaudeError(code, 'Claude can’t be used from this page for this account.', true);
    case 'rate_limited':
      return new ClaudeError(code, 'You’ve hit a Claude usage limit, or too much was asked at once. Wait a little, then try again.');
    case 'prompt_too_large':
      return new ClaudeError(code, 'This call’s Q&A is too long to send in one go.');
    case 'invalid_json':
      return new ClaudeError(code, 'Claude’s answer came back in an unexpected shape. Try again.');
    case 'refused':
      return new ClaudeError(code, 'Claude declined this request.');
    default:
      return new ClaudeError(code || 'error', 'Claude had a problem with this. Try again.');
  }
}

const clip = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const head = Math.floor(max * 0.75);
  return `${t.slice(0, head)} […] ${t.slice(t.length - (max - head - 7))}`;
};

const nameOf = (role: string) => (role === 'ceo' ? 'CEO' : role === 'cfo' ? 'CFO' : 'executive');

/** Claude's verdict on every answer in one call's Q&A, in order. */
export async function judgeAnswers(a: Analysis, signal?: AbortSignal): Promise<Judgment[]> {
  const sample = await claude();
  if (!sample) throw new ClaudeError('unavailable', 'Open this page in Claude, signed in, to use Claude here.', true);
  if (!a.exchanges.length) return [];
  const company = a.call.company || 'the company';
  const exchanges = a.exchanges
    .map((e) => {
      const answers = e.answers.map((x) => `Answer (${x.speaker}, ${nameOf(x.role)}): ${clip(x.text, 2400 / e.answers.length)}`).join('\n');
      return `Exchange ${e.n}\nQuestion (${e.analyst}${e.firm ? `, ${e.firm.replace(/\s*--\s*analyst$/i, '')}` : ''}): ${clip(e.question, 1200)}\n${answers}`;
    })
    .join('\n\n');
  const prompt = `You are reviewing the question-and-answer part of ${company}'s ${a.call.period.label} earnings call. For each exchange below, judge whether management's answer actually answered the analyst's question.

Verdicts:
- "answered": addresses the question directly, with the specifics asked for where they could reasonably be given.
- "partial": addresses part of the question, or a narrower or easier version of it.
- "sidestepped": declines, deflects, falls back on talking points, or answers a different question.

Declining to give a figure the company never discloses is still "partial" or "sidestepped"; say so plainly in the reason. Judge only what was said. Don't guess at motives.

Reply with only a JSON array with one object per exchange, in order, like:
[{"n": 1, "verdict": "answered", "reason": "Gave the backlog figure and the timing asked for."}]
Each reason is one plain sentence of at most 25 words about what the answer did or didn't address.

${exchanges}`;
  try {
    const out = await sample.json<Array<{ n?: number; verdict?: string; reason?: string }>>(prompt, { modelTier: 'default', signal });
    if (!Array.isArray(out)) throw { code: 'invalid_json' };
    return a.exchanges.map((e, i) => {
      const hit = out.find((o) => Number(o?.n) === e.n) ?? out[i];
      const v = String(hit?.verdict ?? '').toLowerCase();
      const verdict: Verdict = v.startsWith('side') ? 'sidestepped' : v.startsWith('part') ? 'partial' : 'answered';
      return { verdict, reason: String(hit?.reason ?? '').slice(0, 240) };
    });
  } catch (e) {
    throw e instanceof ClaudeError ? e : explain(e);
  }
}

const num = (v: number | null, d = 1) => (v == null ? 'n/a' : v.toFixed(d));

/** A short written read of the trend, streamed as it's written. */
export async function readTrend(
  list: Analysis[],
  topics: Topic[],
  judgments: Map<string, Judgment[]>,
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const sample = await claude();
  if (!sample) throw new ClaudeError('unavailable', 'Open this page in Claude, signed in, to use Claude here.', true);
  const company = list.find((a) => a.call.company)?.call.company || 'The company';
  const rows = list
    .map((a) => {
      const j = judgments.get(a.call.id);
      const verdicts = j ? `; Claude's verdicts: ${j.filter((x) => x.verdict === 'answered').length} answered, ${j.filter((x) => x.verdict === 'partial').length} partial, ${j.filter((x) => x.verdict === 'sidestepped').length} sidestepped` : '';
      return `${a.call.period.label}${a.call.date ? ` (${a.call.date})` : ''}: tone in prepared remarks ${a.prepared.tone == null ? 'n/a' : signed(a.prepared.tone)}, tone in Q&A answers ${a.qa.tone == null ? 'n/a' : signed(a.qa.tone)}, analysts' tone ${a.analysts.tone == null ? 'n/a' : signed(a.analysts.tone)}, hedging in answers ${num(a.qa.hedging)}, figures in answers ${num(a.qa.specificity)}, possible non-answers by word rules ${a.exchanges.filter((e) => e.flagged).length} of ${a.exchanges.length}${verdicts}`;
    })
    .join('\n');
  const topicRows = topics
    .map((t) => `${t.name}: ${list.map((a) => `${a.call.period.label} ${num(a.topics[t.id]?.per1k ?? 0)}${a.topics[t.id]?.tone != null ? ` (tone ${signed(a.topics[t.id].tone!)})` : ''}`).join(', ')}`)
    .join('\n');
  const flagged = list
    .flatMap((a) =>
      a.exchanges
        .filter((e) => e.flagged || judgments.get(a.call.id)?.[e.n - 1]?.verdict === 'sidestepped')
        .map((e) => `${a.call.period.label}, ${e.analyst}: "${clip(e.question, 220)}" Signals: ${e.flags.map((f) => f.text).join('; ') || 'none'}${judgments.get(a.call.id)?.[e.n - 1] ? `; Claude: ${judgments.get(a.call.id)![e.n - 1].verdict}, ${judgments.get(a.call.id)![e.n - 1].reason}` : ''}`),
    )
    .slice(0, 24)
    .join('\n');

  const prompt = `Below are measurements of the language in ${company}'s earnings calls, oldest first. They come from counting words against fixed lists, so they are rough. Tone is good-news minus bad-news words per 1,000 words; hedging is hedging words and weak modals (may, could) per 1,000 words; figures is numbers given per 1,000 words.

Write a short read of what changed across these calls, for an investor deciding what to read closely. Describe what the measurements and the flagged answers show and how they line up; name quarters by their labels. Don't predict results or the share price, and don't give investment advice. Write plainly, without headings: one paragraph of 3 or 4 sentences, then a list of 2 or 3 things to read closely, each line starting with "- " and naming the quarter.

Calls:
${rows}

How often each topic came up (mentions per 1,000 words) and management's tone around it:
${topicRows}

Answers flagged as possible non-answers:
${flagged || 'None.'}`;
  try {
    const { text } = await sample(prompt, { modelTier: 'default', signal, onText: ({ text }) => onText(text) });
    return text;
  } catch (e) {
    throw e instanceof ClaudeError ? e : explain(e);
  }
}

/**
 * Claude reads the start of a transcript and an outline of its turns, and
 * says who is who, where the Q&A starts, and which company and quarter it is.
 * The word rules make a first pass; this catches what they got wrong.
 */
export async function checkReading(call: Call, raw: string, signal?: AbortSignal): Promise<Reading> {
  const sample = await claude();
  if (!sample) throw new ClaudeError('unavailable', 'Open this page in Claude, signed in, to use Claude here.', true);
  const roleName: Record<string, string> = { ceo: 'CEO', cfo: 'CFO', exec: 'executive', analyst: 'analyst', operator: 'operator', other: 'unknown' };
  const outline = call.turns
    .slice(0, 140)
    .map((t, i) => `#${i} ${t.speaker} (guess: ${roleName[t.role]}${t.section === 'qa' ? ', Q&A' : ''}): "${clip(t.paras.map((p) => p.text).join(' '), 150)}"`)
    .join('\n');
  const prompt = `Below is the start of an earnings call transcript, then an outline of every turn as a program split it: turn number, speaker label, the program's guess, and the first words. The guesses come from simple rules and may be wrong, because transcripts are laid out in many different ways.

Work out:
- the company's name as it is usually written, and its stock ticker if the transcript states it;
- which quarter and year the call reports on, and whether the transcript calls it a fiscal year;
- each speaker's role: "operator" (whoever moderates the call, even if listed under a first name), "ceo", "cfo", "exec" (any other company person, including investor relations), "analyst" (people asking questions) or "other";
- the number of the turn where the question-and-answer session begins (usually the operator opening the queue), or null if there is none.

Reply with only JSON in this shape:
{"company": "Acme Corp", "ticker": "ACME", "quarter": 3, "year": 2025, "fiscal": false, "speakers": [{"name": "Jane Doe", "role": "ceo", "title": "Chief Executive Officer"}], "qaStartsAtTurn": 7}
Use each speaker label exactly as it appears in the outline. Include a title only if the transcript states it.

Start of the transcript:
"""
${raw.slice(0, 3000)}
"""

Outline:
${outline}`;
  try {
    const out = await sample.json<Reading>(prompt, { modelTier: 'quick', signal });
    if (!out || typeof out !== 'object') throw { code: 'invalid_json' };
    return out;
  } catch (e) {
    throw e instanceof ClaudeError ? e : explain(e);
  }
}
