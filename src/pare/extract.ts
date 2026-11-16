// Pare: reads a PDF in the browser with Mozilla's PDF.js and rebuilds its
// text as clean paragraphs, headings, lists and tables. Nothing is uploaded.
//
// Along the way it keeps what an estimate needs: the raw text as a PDF
// reader would pull it out, each page's size, and which pages hold pictures
// (those would be lost in a text-only version).

import { canContinue, findTables, isNum, tableToText, type Line, type Seg, type TableData } from './table';

export class PdfError extends Error {
  constructor(public code: 'no-text' | 'encrypted' | 'unreadable', message: string) {
    super(message);
  }
}

export type Block =
  | { kind: 'heading'; level: number; text: string; page: number }
  | { kind: 'para'; text: string; page: number }
  | { kind: 'item'; text: string; marker: string; page: number }
  | { kind: 'table'; table: TableData; page: number };

export interface Extracted {
  name: string;
  pages: number;
  sizes: Array<{ w: number; h: number }>; // in PDF points
  rawText: string; // every line, headers and footers included
  bodyPages?: number[];
  bodyText: string; // the lines kept, before rebuilding: what the check compares against
  blocks: Block[];
  imagePages: number[]; // 1-based pages that draw a picture
  title: string;
}

export interface OutputOptions {
  format: 'markdown' | 'plain';
  pageMarkers: boolean;
}

const median = (v: number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// Ligatures and odd spaces that PDFs often carry.
const FIXES: Array<[RegExp, string]> = [
  [/ﬀ/g, 'ff'], [/ﬁ/g, 'fi'], [/ﬂ/g, 'fl'], [/ﬃ/g, 'ffi'], [/ﬄ/g, 'ffl'], [/ﬅ|ﬆ/g, 'st'],
  [/[  -   　]/g, ' '],
  [/[​-‍﻿­]/g, ''],
];
const tidy = (s: string) => FIXES.reduce((t, [re, to]) => t.replace(re, to), s).replace(/\s+/g, ' ').trim();

const BULLET = /^([•◦▪▫●○■□‣⁃∙·\-–—*])\s+(.*)$/;
const NUMBERED = /^(\(?\d{1,3}[.)]|\(?[a-z][.)]|\(?[ivx]{1,4}[.)])\s+(.*)$/i;
const SENTENCE_END = /[.!?:;”"’)]$/;

/** Splits a line's pieces into cells wherever a wide gap opens up. */
function toSegs(items: Array<{ str: string; x: number; endX: number }>, size: number): Seg[] {
  const segs: Seg[] = [];
  let space = false;
  for (const it of items) {
    if (!it.str.trim()) {
      space = true;
      continue;
    }
    const last = segs[segs.length - 1];
    const gap = last ? it.x - last.endX : Infinity;
    // A "$" right after a figure starts the next column's cell.
    const newCell = !last || gap > size * 0.9 || (/^\s*[$€£¥]/.test(it.str) && /[\d)%—–]$/.test(last.text) && gap > size * 0.3);
    if (newCell) segs.push({ text: it.str, x: it.x, endX: it.endX });
    else {
      // A "%" after a figure: remember where the figure ends, for alignment.
      if (/^\s*%\)?\s*$/.test(it.str) && /\d\)?$/.test(last.text)) last.numEnd ??= last.endX;
      const needsSpace = (space || gap > size * 0.15) && !/\s$/.test(last.text) && !/^\s/.test(it.str);
      last.text += (needsSpace ? ' ' : '') + it.str;
      last.endX = Math.max(last.endX, it.endX);
    }
    space = false;
  }
  for (const s of segs) s.text = tidy(s.text);
  // "$" on its own belongs to the figure after it; "%" to the one before.
  const out: Seg[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const next = segs[i + 1];
    if (/^[$€£¥]\(?$/.test(s.text) && next && isNum(s.text + next.text)) {
      out.push({ text: `${s.text}${next.text}`, x: s.x, endX: next.endX });
      i++;
    } else if (/^\)?%\)?$/.test(s.text) && out.length && isNum(out[out.length - 1].text)) {
      const prev = out[out.length - 1];
      prev.numEnd ??= prev.endX;
      prev.text += s.text;
      prev.endX = s.endX;
    } else if (s.text) out.push(s);
  }
  return out;
}

export async function readPdf(file: File, onProgress?: (page: number, pages: number) => void): Promise<Extracted> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
  const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const OPS = pdfjs.OPS as Record<string, number>;
  const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat].filter((n) => n != null));

  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, disableFontFace: true, enableXfa: false });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    const name = (err as { name?: string })?.name ?? '';
    if (name === 'PasswordException') throw new PdfError('encrypted', `${file.name} is password-protected, so it can’t be read here.`);
    throw new PdfError('unreadable', `${file.name} couldn’t be read as a PDF.`);
  }

  const lines: Line[] = [];
  const sizes: Array<{ w: number; h: number }> = [];
  const imagePages: number[] = [];
  const rawPages: string[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    onProgress?.(p, doc.numPages);
    const page = await doc.getPage(p);
    const view = page.view;
    const rot = ((page.rotate ?? 0) % 180 + 180) % 180;
    const pw = view[2] - view[0] || 612;
    const ph = view[3] - view[1] || 792;
    sizes.push(rot === 90 ? { w: ph, h: pw } : { w: pw, h: ph });

    const content = await page.getTextContent();
    const start = lines.length;
    let cur: { items: Array<{ str: string; x: number; endX: number }>; x: number; y: number; size: number } | null = null;
    const end = () => {
      if (cur) {
        const segs = toSegs(cur.items, cur.size);
        const text = tidy(segs.map((s) => s.text).join(' '));
        if (text && segs.length) {
          lines.push({ text, segs, x: segs[0].x, y: cur.y, endX: segs[segs.length - 1].endX, size: cur.size, page: p, top: 1 - (cur.y - view[1]) / ph });
        }
      }
      cur = null;
    };
    for (const item of content.items as Array<Record<string, any>>) {
      if (typeof item.str !== 'string') continue;
      const [a, b, c, d, x, y] = item.transform as number[];
      if (Math.abs(b) > Math.abs(a) * 0.5 && Math.abs(c) > Math.abs(d) * 0.5) continue; // rotated text
      const size = Math.hypot(c, d) || item.height || 10;
      const str = item.str as string;
      if (cur && (Math.abs(y - cur.y) > Math.max(size, cur.size) * 0.6 || x < cur.x - size * 2)) end();
      if (!cur) {
        if (str.trim()) cur = { items: [], x, y, size };
        else continue;
      }
      cur.items.push({ str, x, endX: x + (str.trim() ? item.width ?? 0 : 0) });
      if (str.trim()) cur.size = Math.max(cur.size, size);
      if (item.hasEOL) end();
    }
    end();
    regroup(lines, start, sizes[p - 1].w);
    rawPages.push(lines.slice(start).map((l) => l.text).join('\n'));

    try {
      const ops = await page.getOperatorList();
      if (ops.fnArray.some((fn: number) => imageOps.has(fn))) imagePages.push(p);
    } catch {
      /* not worth failing over */
    }
    page.cleanup();
  }

  const meta = await doc.getMetadata().catch(() => null);
  const pages = doc.numPages;
  await task.destroy();

  const rawText = rawPages.join('\n\n');
  if (rawText.replace(/\s/g, '').length < 40 * Math.min(pages, 3)) {
    throw new PdfError('no-text', `${file.name} has little or no selectable text. It’s probably a scan, so a text version would lose almost everything.`);
  }

  const info = (meta?.info ?? {}) as { Title?: string };
  const title = tidy(info.Title ?? '');
  const kept = dropRunning(lines, pages);
  return {
    name: file.name,
    pages,
    sizes,
    rawText,
    bodyText: kept.map((l) => l.text).join("\n"),
    bodyPages: kept.map((l) => l.page),
    blocks: toBlocks(kept),
    imagePages,
    title: title.length < 160 ? title : '',
  };
}

/**
 * Puts back together rows that a PDF wrote out of order. Pages printed from
 * a browser write a table cell by cell, so a header stacked over three lines
 * ("Redeemable / Convertible / Preferred Stock") comes out before the next
 * column's header. Short pieces that share a baseline are joined into one
 * line, left to right. Long lines are left alone, so two-column prose stays
 * as it was.
 */
function regroup(lines: Line[], start: number, pageW: number) {
  const short = (l: Line) => l.endX - l.x < pageW * 0.3;
  // A footnote mark set small and raised ("expenses⁽¹⁾") belongs to the word
  // or figure just before it, on the line below it. It can come before or
  // after that line in the file.
  const page = lines.slice(start);
  const marks = new Set<Line>();
  for (const l of page) {
    if (l.segs.length !== 1 || !/^(\(?[0-9a-z]{1,2}\)|\*{1,3}|†|‡|[0-9]{1,2})$/i.test(l.text)) continue;
    const host = page.find((m) => m !== l && !marks.has(m) && m.size >= l.size * 1.25 && l.y - m.y > 0 && l.y - m.y <= m.size * 0.6 && m.segs.some((s) => l.x - s.endX >= -1 && l.x - s.endX <= m.size * 0.6));
    if (!host) continue;
    const seg = host.segs.find((s) => l.x - s.endX >= -1 && l.x - s.endX <= host.size * 0.6)!;
    if (isNum(seg.text)) seg.numEnd ??= seg.endX;
    seg.text += ` ${l.text}`;
    seg.endX = Math.max(seg.endX, l.endX);
    host.text = host.segs.map((s) => s.text).join(' ');
    marks.add(l);
  }
  const out: Line[] = [];
  for (const l of page.filter((x) => !marks.has(x))) {
    let host: Line | undefined;
    if (short(l) || l.segs.length > 1) {
      for (let k = out.length - 1, n = 0; k >= 0 && n < 60; k--, n++) {
        const m = out[k];
        const sameRow = Math.abs(m.y - l.y) < Math.min(m.size, l.size) * 0.4;
        const apart = l.x >= m.endX + 2 || l.endX <= m.x - 2;
        if (sameRow && apart && (short(m) || m.segs.length > 1)) {
          host = m;
          break;
        }
      }
    }
    if (!host) {
      out.push(l);
      continue;
    }
    host.segs = [...host.segs, ...l.segs].sort((a, b) => a.x - b.x);
    host.text = host.segs.map((s) => s.text).join(' ');
    host.x = host.segs[0].x;
    host.endX = Math.max(...host.segs.map((s) => s.endX));
    host.size = Math.max(host.size, l.size);
  }
  // Within runs of short or multi-cell lines (tables), restore top-to-bottom order.
  const tableish = (l: Line) => short(l) || l.segs.length > 1;
  for (let i = 0; i < out.length; ) {
    let j = i;
    while (j < out.length && tableish(out[j])) j++;
    if (j - i > 1) {
      const run = out.slice(i, j).sort((a, b) => b.y - a.y || a.x - b.x);
      out.splice(i, j - i, ...run);
    }
    i = Math.max(j, i + 1);
  }
  lines.splice(start, lines.length - start, ...out);
}

/** Drops running headers and footers, page numbers and margin links. */
function dropRunning(all: Line[], pages: number): Line[] {
  const edge = (l: Line) => l.top < 0.08 || l.top > 0.92;
  const keyOf = (l: Line) => l.text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  const repeats = new Map<string, Set<number>>();
  for (const l of all) if (edge(l)) repeats.set(keyOf(l), (repeats.get(keyOf(l)) ?? new Set()).add(l.page));
  const minRepeat = Math.max(2, Math.ceil(pages * 0.3));
  return all.filter((l) => {
    if (/^[-–—(\[]?\s*(page\s*)?(\d{1,4}|[ivxlc]{1,6})\.?(\s*(of|\/)\s*\d{1,4})?\s*[-–—)\]]?$/i.test(l.text) && edge(l)) return false;
    if (/^[A-Z]?-?\d{1,3}$/.test(l.text) && edge(l)) return false; // "F-12"
    if (edge(l) && /^https?:\/\/\S+$/i.test(l.text)) return false;
    if (l.segs.length === 1 && /^(_{3,}|={3,})$/.test(l.text)) return false; // a rule drawn with characters
    return !(edge(l) && pages > 1 && (repeats.get(keyOf(l))?.size ?? 0) >= minRepeat);
  });
}

/** Turns positioned lines into headings, paragraphs, list items and tables. */
function toBlocks(lines: Line[]): Block[] {
  if (!lines.length) return [];

  // The body size is the font size that carries the most characters.
  const weight = new Map<number, number>();
  for (const l of lines) {
    const s = Math.round(l.size * 2) / 2;
    weight.set(s, (weight.get(s) ?? 0) + l.text.length);
  }
  const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // Tables, page by page.
  const tableAt = new Map<number, { end: number; table: TableData }>();
  for (let i = 0; i < lines.length; ) {
    let j = i;
    while (j < lines.length && lines[j].page === lines[i].page) j++;
    const page = lines.slice(i, j);
    for (const f of findTables(page, body)) tableAt.set(i + f.start, { end: i + f.end, table: f.table });
    i = j;
  }

  // Headings: larger type, or the way filings mark their parts ("PART II",
  // "Item 7.") and statement titles in capitals.
  const isSizeHeading = (l: Line) => l.size >= body * 1.15 && l.text.length <= 140 && /[A-Za-z]/.test(l.text);
  const headSizes = [...new Set(lines.filter(isSizeHeading).map((l) => Math.round(l.size * 2) / 2))].sort((a, b) => b - a);
  const levelOf = (size: number) => Math.min(3, headSizes.indexOf(Math.round(size * 2) / 2) + 1) || 3;
  const filingHeading = (l: Line): number => {
    if (l.segs.length > 2 || l.text.length > 120) return 0;
    if (/^part\s+[ivx]+\b\.?/i.test(l.text) && !SENTENCE_END.test(l.text.replace(/\.$/, ''))) return 1;
    if (/^item\s+\d{1,2}[a-c]?\.?\s/i.test(l.text) && !/\.$/.test(l.text) && !/\d$/.test(l.text)) return 2;
    const letters = l.text.replace(/[^A-Za-z]/g, '');
    if (letters.length >= 8 && letters === letters.toUpperCase() && !/[.]$/.test(l.text) && l.text.split(' ').length >= 2) return 3;
    return 0;
  };

  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const dy = lines[i - 1].y - lines[i].y;
    if (lines[i - 1].page === lines[i].page && dy > 0 && Math.abs(lines[i].size - body) < 1) gaps.push(dy);
  }
  const lineGap = median(gaps) || body * 1.2;
  const rightEdge = median(lines.filter((l) => Math.abs(l.size - body) < 1).map((l) => l.endX));

  const blocks: Block[] = [];
  let open: Exclude<Block, { kind: 'table' }> | null = null;
  let prev: Line | null = null;
  const close = () => {
    if (open && open.text.trim()) blocks.push(open);
    open = null;
  };
  const append = (text: string) => {
    if (!open) return;
    // Re-join a word hyphenated across lines ("busi-" + "ness").
    if (/[a-z]-$/.test(open.text) && /^[a-z]/.test(text)) open.text = open.text.slice(0, -1) + text;
    else open.text += ' ' + text;
  };

  for (let i = 0; i < lines.length; i++) {
    const t = tableAt.get(i);
    if (t) {
      close();
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'table' && canContinue(last.table, t.table)) {
        // The same table, carried over from the previous page.
        last.table.rows.push(...t.table.rows);
        last.table.lastPage = t.table.lastPage;
        last.table.doubts.push(...t.table.doubts);
      } else {
        blocks.push({ kind: 'table', table: t.table, page: t.table.page });
      }
      i = t.end;
      prev = null;
      continue;
    }
    const l = lines[i];
    const text = l.text;

    const fh = isSizeHeading(l) ? levelOf(l.size) : filingHeading(l);
    if (fh) {
      // A heading that wraps onto a second line stays one heading.
      if (open?.kind === 'heading' && prev && prev.page === l.page && Math.abs(prev.size - l.size) < 0.6 && prev.y - l.y < l.size * 1.8) {
        append(text);
      } else {
        close();
        open = { kind: 'heading', level: fh, text, page: l.page };
      }
      prev = l;
      continue;
    }

    const bullet = text.match(BULLET) ?? (l.size <= body * 1.05 ? text.match(NUMBERED) : null);
    if (bullet) {
      close();
      const marker = /^[•◦▪▫●○■□‣⁃∙·\-–—*]$/.test(bullet[1]) ? '-' : bullet[1];
      open = { kind: 'item', text: bullet[2], marker, page: l.page };
      prev = l;
      continue;
    }

    let fresh = !open || open.kind === 'heading';
    if (!fresh && prev) {
      if (prev.page === l.page) {
        const dy = prev.y - l.y;
        const bigGap = dy > lineGap * 1.45 || dy < 0;
        const shortPrev = rightEdge > 0 && prev.endX < rightEdge - body * 6 && SENTENCE_END.test(prev.text);
        const indented = open!.kind === 'para' && l.x > prev.x + body * 1.2 && SENTENCE_END.test(prev.text);
        fresh = bigGap || shortPrev || indented;
        // A list item's wrapped lines are indented under its text.
        if (open!.kind === 'item' && !bigGap && l.x > prev.x - body) fresh = false;
      } else {
        // A new page: carry on only if the sentence was cut mid-way.
        fresh = SENTENCE_END.test(prev.text) || !/^[a-z(]/.test(text);
      }
    }
    if (!prev && open?.kind === 'para') fresh = true; // right after a table
    if (fresh) {
      close();
      open = { kind: 'para', text, page: l.page };
    } else {
      append(text);
    }
    prev = l;
  }
  close();
  return blocks;
}

/** Writes the blocks out as Markdown or plain text. */
export function render(ex: Extracted, opts: OutputOptions): string {
  const md = opts.format === 'markdown';
  const out: string[] = [];
  let page = 0;
  let lastKind = '';
  for (const b of ex.blocks) {
    if (opts.pageMarkers && b.page !== page) {
      page = b.page;
      out.push(`${out.length ? '\n' : ''}[page ${page}]`);
      lastKind = 'marker';
    }
    if (b.kind === 'heading') {
      out.push(`${out.length ? '\n' : ''}${md ? '#'.repeat(b.level) + ' ' : ''}${b.text}`);
    } else if (b.kind === 'item') {
      const marker = b.marker === '-' ? (md ? '-' : '•') : b.marker;
      // Items in a row stay together; a list starts after a blank line.
      out.push(`${lastKind === 'item' || !out.length ? '' : '\n'}${marker} ${b.text}`);
    } else if (b.kind === 'table') {
      const span = b.table.lastPage > b.table.page && opts.pageMarkers ? `[table continues to page ${b.table.lastPage}]\n` : '';
      out.push(`${out.length ? '\n' : ''}${span}${tableToText(b.table, md)}`);
    } else {
      out.push(`${out.length ? '\n' : ''}${b.text}`);
    }
    lastKind = b.kind;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---------------------------------------------------------------------------
// The check: is every figure in the PDF in the text?
// ---------------------------------------------------------------------------

const figures = (s: string) => (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, '')).filter((n) => n.length > 0);

export interface Check {
  total: number; // figures in the PDF's text
  missing: number; // of those, how many aren't in the output
  examples: string[];
  doubtful: Array<{ page: number; why: string }>;
  tables: number;
}

export function check(ex: Extracted, output: string): Check {
  const want = new Map<string, number>();
  for (const n of figures(ex.bodyText)) want.set(n, (want.get(n) ?? 0) + 1);
  // Count what was written, with each table header once: column headers
  // repeat them ("Year Ended December 31, 2025", "… 2024"), which would
  // otherwise hide a figure that went missing.
  void output;
  const written = ex.blocks
    .map((b) => (b.kind === 'table' ? [...b.table.headerTexts, ...b.table.rows.flatMap((r) => [r.label, ...r.cells])].join('\n') : b.kind === 'item' ? `${b.marker} ${b.text}` : b.text))
    .join('\n');
  const have = new Map<string, number>();
  for (const n of figures(written)) have.set(n, (have.get(n) ?? 0) + 1);
  let total = 0;
  let missing = 0;
  const examples: string[] = [];
  for (const [n, c] of want) {
    total += c;
    const gap = c - (have.get(n) ?? 0);
    if (gap > 0) {
      missing += gap;
      if (examples.length < 5) examples.push(n);
    }
  }
  const tables = ex.blocks.filter((b) => b.kind === 'table') as Array<Extract<Block, { kind: 'table' }>>;
  const doubtful = tables.flatMap((b) => (b.table.doubts.length ? [{ page: b.table.page, why: b.table.doubts[0] }] : []));
  return { total, missing, examples, doubtful, tables: tables.length };
}
