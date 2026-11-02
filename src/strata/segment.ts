// Turns pasted text, or blocks read out of a PDF, into the shape the reader
// zooms over: a document made of sections, each made of passages.
//
//   Level −2  Gist            one short paragraph for the whole document
//   Level −1  Summary         one paragraph per section
//   Level  0  Original        the passages as written
//   Level +1  Explained       each passage in plain language
//   Level +2  First principles each passage built up from the basics

export interface Block {
  kind: 'heading' | 'para';
  text: string;
}

export interface Passage {
  idx: number; // position in the whole document
  text: string; // may hold several paragraphs, separated by blank lines
  words: number;
}

export interface Section {
  idx: number;
  heading?: string;
  passages: Passage[];
  words: number;
}

export interface Doc {
  title: string;
  source: 'paste' | 'pdf' | 'example';
  sections: Section[];
  passages: Passage[];
  words: number;
  /** Set when a trailing references list was left out. */
  droppedReferences?: boolean;
}

export const MAX_WORDS = 40_000;

export const countWords = (s: string) => (s.trim().match(/\S+/g) ?? []).length;

const TERMINAL = /[.!?…:;"”’)\]]$/;
const BULLET = /^\s*([-*•●▪◦–]|\d{1,3}[.)]|[a-z][.)]|\([a-z0-9]{1,3}\))\s+/i;
const NUMBERED_HEADING = /^((\d{1,2}(\.\d{1,2}){0,3}\.?)|([IVXLC]{1,6}\.)|(chapter|section|part|appendix)\s+[\w.]+)\s+\S/i;

function isTitleCase(line: string): boolean {
  const w = line.split(/\s+/).filter((x) => /[a-z]/i.test(x));
  if (!w.length) return false;
  const small = /^(a|an|the|and|or|of|in|on|to|for|with|at|by|vs\.?|from|as|via|is|its|&)$/i;
  const caps = w.filter((x) => small.test(x) || /^[^a-z]*[A-Z0-9]/.test(x)).length;
  return caps / w.length >= 0.75;
}

/** A line that reads like a heading: short, no closing punctuation, and styled like one. */
export function isHeadingLike(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  if (/^#{1,6}\s+\S/.test(t)) return true;
  const n = countWords(t);
  if (n > 12 || /[.,;!?"”]$/.test(t)) return false;
  if (BULLET.test(t) && !NUMBERED_HEADING.test(t)) return false;
  const letters = t.replace(/[^a-z]/gi, '');
  if (letters.length < 2) return false;
  if (NUMBERED_HEADING.test(t)) return true;
  if (letters.length >= 3 && letters === letters.toUpperCase()) return true;
  return n <= 9 && isTitleCase(t);
}

const stripHashes = (s: string) => s.replace(/^#{1,6}\s+/, '').replace(/\s+#+\s*$/, '').trim();

/** Joins lines of one paragraph, undoing hyphenation at line breaks. */
export function joinLines(lines: string[]): string {
  let out = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!out) out = line;
    else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(line)) out = out.slice(0, -1) + line;
    else out += ' ' + line;
  }
  return out;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

/** Splits pasted text into headings and paragraphs. */
export function blocksFromText(raw: string): Block[] {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[\t ]/g, ' ')
    .replace(/[ ]+$/gm, '');
  const lines = text.split('\n');
  const nonEmpty = lines.filter((l) => l.trim());
  const blankRuns = text.split(/\n\s*\n/).length - 1;

  // Text copied out of a PDF often has a line break at the end of every line
  // and no blank lines between paragraphs. Rebuild the paragraphs from the
  // shape of the lines in that case.
  const hardWrapped = nonEmpty.length > 12 && blankRuns < nonEmpty.length / 12;
  const chunks: string[][] = [];
  if (hardWrapped) {
    const width = percentile(nonEmpty.map((l) => l.trim().length), 0.75);
    let cur: string[] = [];
    const flush = () => cur.length && (chunks.push(cur), (cur = []));
    nonEmpty.forEach((l, i) => {
      const line = l.trim();
      const prev = cur[cur.length - 1];
      if (prev !== undefined) {
        const prevShort = prev.length < width * 0.8;
        const breakHere =
          (TERMINAL.test(prev) && prevShort) ||
          BULLET.test(line) ||
          (isHeadingLike(line) && (prevShort || TERMINAL.test(prev))) ||
          isHeadingLike(prev);
        if (breakHere) flush();
      }
      cur.push(line);
      if (i === nonEmpty.length - 1) flush();
    });
    flush();
  } else {
    let cur: string[] = [];
    for (const l of lines) {
      if (l.trim()) cur.push(l);
      else if (cur.length) (chunks.push(cur), (cur = []));
    }
    if (cur.length) chunks.push(cur);
  }

  const blocks: Block[] = [];
  for (const chunk of chunks) {
    const ls = chunk.map((l) => l.trim()).filter(Boolean);
    if (!ls.length) continue;
    // A heading line at the top of a chunk ("## Results" then text).
    if (ls.length > 1 && (/^#{1,6}\s+\S/.test(ls[0]) || (isHeadingLike(ls[0]) && !BULLET.test(ls[1]) && countWords(ls[1]) > 12))) {
      blocks.push({ kind: 'heading', text: stripHashes(ls.shift()!) });
    }
    if (ls.length === 1 && isHeadingLike(ls[0])) {
      blocks.push({ kind: 'heading', text: stripHashes(ls[0]) });
      continue;
    }
    // Keep lists one item per line; join everything else into prose.
    const listy = ls.filter((l) => BULLET.test(l)).length >= Math.max(2, ls.length * 0.5);
    blocks.push({ kind: 'para', text: listy ? ls.join('\n') : joinLines(ls) });
  }
  return blocks;
}

/** Breaks a long paragraph into roughly even groups of whole sentences. */
function splitLong(text: string, max = 230, target = 160): string[] {
  if (countWords(text) <= max || text.includes('\n')) return [text];
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+["”’)\]]*|$)\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && countWords(cur) + countWords(s) > target * 1.25 && countWords(cur) >= target * 0.6) {
      out.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) {
    if (out.length && countWords(cur) < target * 0.35) out[out.length - 1] += ' ' + cur;
    else out.push(cur);
  }
  return out;
}

const REFERENCES = /^(references|bibliography|works cited|literature cited|sources|notes and references)$/i;

export function buildDoc(blocks: Block[], opts: { title?: string; source: Doc['source'] }): Doc {
  let list = blocks.map((b) => ({ ...b, text: b.text.trim() })).filter((b) => b.text);

  // Title: given (PDF metadata, file name) or the first heading / short first line.
  let title = (opts.title ?? '').trim();
  const first = list[0];
  if (first && (first.kind === 'heading' || (countWords(first.text) <= 14 && !/[.!?,;:]$/.test(first.text) && list.length > 1))) {
    if (!title || title.toLowerCase() === first.text.toLowerCase()) title = first.text;
    if (title.toLowerCase() === first.text.toLowerCase()) list = list.slice(1);
  }

  // Leave out a references list at the end of the document.
  let droppedReferences = false;
  const refAt = list.findIndex((b, i) => b.kind === 'heading' && REFERENCES.test(b.text.replace(/[:.]$/, '')) && i > list.length * 0.5);
  if (refAt > 0) {
    list = list.slice(0, refAt);
    droppedReferences = true;
  }

  // Group blocks into raw sections at headings.
  type Raw = { heading?: string; paras: string[] };
  const raw: Raw[] = [];
  let cur: Raw = { paras: [] };
  for (const b of list) {
    if (b.kind === 'heading') {
      if (cur.paras.length || cur.heading) {
        if (!cur.paras.length && cur.heading) {
          // Two headings in a row ("Chapter 2" then "The Pin Factory").
          cur.heading = `${cur.heading}: ${b.text}`;
          continue;
        }
        raw.push(cur);
      }
      cur = { heading: b.text, paras: [] };
    } else cur.paras.push(b.text);
  }
  if (cur.paras.length) raw.push(cur);
  const withText = raw.filter((r) => r.paras.length);

  // Paragraphs to passages: split long ones, fold very short ones into a neighbor.
  const toPassages = (paras: string[]): string[] => {
    const pieces = paras.flatMap((p) => splitLong(p));
    const out: string[] = [];
    let carry = '';
    for (const p of pieces) {
      const merged = carry ? `${carry}\n\n${p}` : p;
      if (countWords(merged) < 30) carry = merged;
      else {
        out.push(merged);
        carry = '';
      }
    }
    if (carry) {
      if (out.length) out[out.length - 1] += `\n\n${carry}`;
      else out.push(carry);
    }
    return out;
  };

  const totalWords = withText.reduce((n, r) => n + r.paras.reduce((m, p) => m + countWords(p), 0), 0);
  const target = Math.max(220, Math.min(800, Math.round(totalWords / 4)));
  const headed = withText.some((r) => r.heading);

  // Sections: one per heading, with long ones (or a document without
  // headings) cut into pieces of about `target` words at passage boundaries.
  const sectionTexts: { heading?: string; texts: string[] }[] = [];
  for (const r of withText) {
    const ps = toPassages(r.paras);
    const limit = headed ? Math.max(target * 1.6, 1_200) : target;
    let group: string[] = [];
    let n = 0;
    let firstOfHeading = true;
    const push = () => {
      if (!group.length) return;
      sectionTexts.push({ heading: firstOfHeading ? r.heading : undefined, texts: group });
      firstOfHeading = false;
      group = [];
      n = 0;
    };
    ps.forEach((p, i) => {
      group.push(p);
      n += countWords(p);
      const rest = ps.slice(i + 1).reduce((m, q) => m + countWords(q), 0);
      if (n >= limit && rest >= limit * 0.4) push();
    });
    push();
  }

  let idx = 0;
  const sections: Section[] = sectionTexts.map((s, si) => {
    const passages = s.texts.map((text) => ({ idx: idx++, text, words: countWords(text) }));
    return { idx: si, heading: s.heading, passages, words: passages.reduce((m, p) => m + p.words, 0) };
  });
  const passages = sections.flatMap((s) => s.passages);

  return {
    title: title || 'Untitled document',
    source: opts.source,
    sections,
    passages,
    words: passages.reduce((m, p) => m + p.words, 0),
    droppedReferences,
  };
}
