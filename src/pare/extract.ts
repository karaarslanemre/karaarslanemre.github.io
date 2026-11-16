// Pare: reads a PDF in the browser with Mozilla's PDF.js and rebuilds its
// text as clean paragraphs, headings and lists. Nothing is uploaded.
//
// Along the way it keeps what an estimate needs: the raw text as a PDF
// reader would pull it out, each page's size, and which pages hold pictures
// (those would be lost in a text-only version).

export class PdfError extends Error {
  constructor(public code: 'no-text' | 'encrypted' | 'unreadable', message: string) {
    super(message);
  }
}

interface Line {
  text: string;
  x: number;
  y: number;
  endX: number;
  size: number;
  page: number;
  top: number; // 0 = top of page, 1 = bottom
}

export type Block =
  | { kind: 'heading'; level: number; text: string; page: number }
  | { kind: 'para'; text: string; page: number }
  | { kind: 'item'; text: string; marker: string; page: number };

export interface Extracted {
  name: string;
  pages: number;
  sizes: Array<{ w: number; h: number }>; // in PDF points
  rawText: string; // every line, headers and footers included
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
    let cur: Line | null = null;
    const end = () => {
      if (cur) {
        const text = tidy(cur.text);
        if (text) lines.push({ ...cur, text });
      }
      cur = null;
    };
    for (const item of content.items as Array<Record<string, any>>) {
      if (typeof item.str !== 'string') continue;
      const [a, b, c, d, x, y] = item.transform as number[];
      if (Math.abs(b) > Math.abs(a) * 0.5 && Math.abs(c) > Math.abs(d) * 0.5) continue; // rotated text
      const size = Math.hypot(c, d) || item.height || 10;
      const str = item.str as string;
      if (cur && (Math.abs(y - cur.y) > size * 0.6 || x < cur.x - size * 2)) end();
      if (!cur) {
        if (str.trim()) cur = { text: str, x, y, endX: x + (item.width ?? 0), size, page: p, top: 1 - (y - view[1]) / ph };
      } else if (str) {
        const gap = x - cur.endX;
        const needsSpace = gap > size * 0.15 && !/\s$/.test(cur.text) && !/^\s/.test(str);
        cur.text += (needsSpace ? ' ' : '') + str;
        cur.endX = Math.max(cur.endX, x + (item.width ?? 0));
        cur.size = Math.max(cur.size, size);
      }
      if (item.hasEOL) end();
    }
    end();
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
  return { name: file.name, pages, sizes, rawText, blocks: toBlocks(lines, pages), imagePages, title: title.length < 160 ? title : '' };
}

/** Turns positioned lines into headings, paragraphs and list items. */
function toBlocks(all: Line[], pages: number): Block[] {
  // Running headers and footers: lines near the top or bottom of the page
  // that repeat across pages (ignoring numbers), plus bare page numbers.
  const edge = (l: Line) => l.top < 0.08 || l.top > 0.92;
  const keyOf = (l: Line) => l.text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  const repeats = new Map<string, Set<number>>();
  for (const l of all) if (edge(l)) repeats.set(keyOf(l), (repeats.get(keyOf(l)) ?? new Set()).add(l.page));
  const minRepeat = Math.max(2, Math.ceil(pages * 0.3));
  const lines = all.filter((l) => {
    if (/^[-–—(\[]?\s*(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?\s*[-–—)\]]?$/i.test(l.text) && (edge(l) || l.text.length <= 4)) return false;
    if (edge(l) && /^https?:\/\/\S+$/i.test(l.text)) return false;
    return !(edge(l) && pages > 1 && (repeats.get(keyOf(l))?.size ?? 0) >= minRepeat);
  });
  if (!lines.length) return [];

  // The body size is the font size that carries the most characters.
  const weight = new Map<number, number>();
  for (const l of lines) {
    const s = Math.round(l.size * 2) / 2;
    weight.set(s, (weight.get(s) ?? 0) + l.text.length);
  }
  const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // Heading sizes, largest first, become #, ##, ###.
  const isHeadingLine = (l: Line) => l.size >= body * 1.15 && l.text.length <= 140 && /[A-Za-z]/.test(l.text);
  const headSizes = [...new Set(lines.filter(isHeadingLine).map((l) => Math.round(l.size * 2) / 2))].sort((a, b) => b - a);
  const levelOf = (size: number) => Math.min(3, headSizes.indexOf(Math.round(size * 2) / 2) + 1) || 3;

  // Typical spacing and line width, to tell where paragraphs end.
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const dy = lines[i - 1].y - lines[i].y;
    if (lines[i - 1].page === lines[i].page && dy > 0 && Math.abs(lines[i].size - body) < 1) gaps.push(dy);
  }
  const lineGap = median(gaps) || body * 1.2;
  const rightEdge = median(lines.filter((l) => Math.abs(l.size - body) < 1).map((l) => l.endX));

  const blocks: Block[] = [];
  let open: Block | null = null;
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

  for (const l of lines) {
    if (isHeadingLine(l)) {
      // A heading that wraps onto a second line stays one heading.
      if (open?.kind === 'heading' && prev && prev.page === l.page && Math.abs(prev.size - l.size) < 0.6 && prev.y - l.y < l.size * 1.8) {
        append(l.text);
      } else {
        close();
        open = { kind: 'heading', level: levelOf(l.size), text: l.text, page: l.page };
      }
      prev = l;
      continue;
    }

    const bullet = l.text.match(BULLET) ?? (l.size <= body * 1.05 ? l.text.match(NUMBERED) : null);
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
        const shortPrev = rightEdge > 0 && prev.endX < rightEdge - body * 6 && /[.!?:”"’)]$/.test(prev.text);
        const indented = open!.kind === 'para' && l.x > prev.x + body * 1.2 && /[.!?:”"’)]$/.test(prev.text);
        fresh = bigGap || shortPrev || indented;
        // A list item's wrapped lines are indented under its text.
        if (open!.kind === 'item' && !bigGap) fresh = false;
      } else {
        // A new page: carry on only if the sentence was cut mid-way.
        fresh = /[.!?:”"’)]$/.test(prev.text) || !/^[a-z(]/.test(l.text);
      }
    }
    if (fresh) {
      close();
      open = { kind: 'para', text: l.text, page: l.page };
    } else {
      append(l.text);
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
    } else {
      out.push(`${out.length ? '\n' : ''}${b.text}`);
    }
    lastKind = b.kind;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
