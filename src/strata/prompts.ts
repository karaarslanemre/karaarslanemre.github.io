// The instructions that turn one piece of a document into another zoom level.
//
// This file is shared: the Cloudflare Worker (worker/src/index.ts) uses it for
// the free allowance, and the browser uses it when a visitor brings their own
// API key. Keeping the prompts here means both routes write the same way, and
// the Worker only ever runs these fixed tasks, never arbitrary prompts.

export type Task = 'gist' | 'summary' | 'short' | 'explain' | 'basics';

export interface TaskInput {
  task: Task;
  /** The text to rewrite: a passage, a section, or (for the gist) the document or its section summaries. */
  text: string;
  /** Document title, for context. */
  title?: string;
  /** Section heading, for context. */
  heading?: string;
  /** The passage just before this one, for context only. */
  before?: string;
  /** For the gist of a long document: the text is a list of section summaries. */
  fromSummaries?: boolean;
}

export interface Prompt {
  system: string;
  user: string;
  maxTokens: number;
}

export const LIMITS = {
  passageChars: 4_000,
  summaryChars: 16_000,
  gistChars: 60_000,
  contextChars: 800,
  titleChars: 200,
};

const TASKS: Task[] = ['gist', 'summary', 'short', 'explain', 'basics'];

const SYSTEM = `You are the writing engine of Strata, a tool that lets people read a document at different levels of detail. You rewrite one piece of a document at a time.

Rules:
- Output only the requested text. No preface such as "Here is", no closing remarks, no headings, no questions to the reader.
- Stay faithful to the document. Keep its claims, numbers and names exactly. Don't add opinions, praise or criticism, and don't invent facts about the specific people, companies or events it mentions. General background knowledge is welcome only where the task asks you to explain.
- Write in the same language as the document.
- Write plain paragraphs. Use a bulleted list only if the original passage is itself a list.`;

const words = (s: string) => (s.trim().match(/\S+/g) ?? []).length;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const fence = (s: string) => `"""\n${s.trim()}\n"""`;

function context(input: TaskInput): string {
  const lines: string[] = [];
  if (input.title) lines.push(`Document title: ${input.title}`);
  if (input.heading) lines.push(`Section: ${input.heading}`);
  return lines.length ? lines.join('\n') + '\n\n' : '';
}

export function buildPrompt(input: TaskInput): Prompt {
  const n = words(input.text);
  const ctx = context(input);
  const before = input.before?.trim()
    ? `The passage just before this one, for context only (don't rewrite it):\n${fence(input.before)}\n\n`
    : '';

  switch (input.task) {
    case 'gist':
      return {
        system: SYSTEM,
        user: `${ctx}In 2 or 3 sentences (at most 70 words), say what this document is about and its main point or conclusion, in plain language. State the content directly rather than describing the document.\n\n${
          input.fromSummaries ? 'Summaries of its sections, in order:' : 'Document:'
        }\n${fence(input.text)}`,
        maxTokens: 220,
      };

    case 'summary':
      return {
        system: SYSTEM,
        user: `${ctx}Summarize this part of the document.\nFirst line: a title of at most 6 words, with no quotation marks and no full stop.\nThen a blank line, then 2 to 4 sentences (at most 90 words) that capture its main points in plain language. State the content directly ("Drone motors are…"), not "This section discusses…".\n\nText:\n${fence(input.text)}`,
        maxTokens: 260,
      };

    case 'short':
      return {
        system: SYSTEM,
        user: `${ctx}${before}Say what this passage says in one plain sentence of at most 30 words. State the point directly.\n\nPassage:\n${fence(input.text)}`,
        maxTokens: 90,
      };

    case 'explain': {
      const target = clamp(Math.round(n * 1.7), 60, 450);
      return {
        system: SYSTEM,
        user: `${ctx}${before}Rewrite this passage so that a smart reader with no background in the subject can follow it.
- Keep every idea, in the original order. Leave nothing out.
- The first time a technical term, acronym or name appears, explain it in a few plain words.
- Break long, dense sentences into shorter ones and spell out steps the original skips.
- Add a short concrete example only where an idea is abstract.
- Keep the original's voice: if it says "I" or "we", you may too.
- Aim for about ${target} words.

Passage:
${fence(input.text)}`,
        maxTokens: Math.min(1_200, Math.ceil(target * 1.6) + 150),
      };
    }

    case 'basics': {
      const target = clamp(Math.round(n * 3), 150, 700);
      return {
        system: SYSTEM,
        user: `${ctx}${before}Explain this passage from first principles, for a curious reader who is starting from zero.
- Go through the passage's ideas in order and cover all of them.
- Before each idea, build up the background it rests on, starting from everyday experience: what the basic things are, how they work, and why they matter here.
- Where it helps an idea click, use one simple analogy or a worked example with small round numbers.
- Define every term you use. Prefer short sentences and short paragraphs.
- Refer to the writer as "the author".${before ? "\n- Don't re-explain basics the previous passage already needed; build on them." : ''}
- Aim for about ${target} words.

Passage:
${fence(input.text)}`,
        maxTokens: Math.min(1_600, Math.ceil(target * 1.6) + 200),
      };
    }
  }
}

/** Checks a request body (from the browser) and returns a clean TaskInput or an error message. */
export function parseTaskInput(raw: unknown): TaskInput | string {
  if (!raw || typeof raw !== 'object') return 'Expected a JSON object.';
  const r = raw as Record<string, unknown>;
  const task = r.task as Task;
  if (!TASKS.includes(task)) return 'Unknown task.';
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  const text = typeof r.text === 'string' ? r.text.trim() : '';
  if (!text) return 'Missing text.';
  const max = task === 'gist' ? LIMITS.gistChars : task === 'summary' ? LIMITS.summaryChars : LIMITS.passageChars;
  if (text.length > max) return `Text is too long for this task (max ${max} characters).`;
  return {
    task,
    text,
    title: str(r.title, LIMITS.titleChars)?.trim() || undefined,
    heading: str(r.heading, LIMITS.titleChars)?.trim() || undefined,
    before: task === 'short' || task === 'explain' || task === 'basics' ? str(r.before, LIMITS.contextChars)?.trim() || undefined : undefined,
    fromSummaries: task === 'gist' ? r.fromSummaries === true : undefined,
  };
}

/** Tidies model output: drops hidden reasoning, prefaces and stray headings. */
export function cleanOutput(text: string): string {
  let t = text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');
  t = t.replace(/^\s*(sure|certainly|of course)[^\n]*\n+/i, '');
  t = t.replace(/^\s*here(?:'s| is| are)\b[^\n]*:\s*\n+/i, '');
  t = t.replace(/^\s*"""\s*\n?|\n?\s*"""\s*$/g, '');
  return t.trim();
}

/** Splits a section summary into its title line and body. */
export function parseSummary(text: string): { title: string; body: string } {
  const t = cleanOutput(text);
  const lines = t.split('\n');
  const first = (lines[0] ?? '')
    .replace(/^#+\s*/, '')
    .replace(/^\*\*|\*\*$/g, '')
    .replace(/^title\s*:\s*/i, '')
    .replace(/^["“]|["”]$/g, '')
    .trim();
  const rest = lines.slice(1).join('\n').trim();
  if (rest && first && words(first) <= 10 && !/[.!?]$/.test(first)) {
    return { title: first.replace(/[.:]$/, ''), body: rest };
  }
  return { title: '', body: t };
}
