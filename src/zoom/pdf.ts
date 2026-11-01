// Reads the text out of a PDF in the browser, with Mozilla's PDF.js, and
// rebuilds its paragraphs and headings from the position and size of each
// line. Nothing is uploaded: the file is read on the visitor's own device.

import { joinLines, type Block } from './segment';

interface Line {
  text: string;
  x: number;
  y: number;
  endX: number;
  size: number;
  page: number;
  top: number; // 0 = top of page, 1 = bottom
}

const TERMINAL = /[.!?…:;"”’)\]]$/;

const median = (v: number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export class PdfError extends Error {
  constructor(public code: 'no-text' | 'encrypted' | 'unreadable', message: string) {
    super(message);
  }
}

export async function pdfToBlocks(
  file: File,
  onProgress?: (page: number, pages: number) => void,
): Promise<{ blocks: Block[]; title?: string }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
  const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, disableFontFace: true, enableXfa: false });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    const name = (err as { name?: string })?.name ?? '';
    if (name === 'PasswordException') throw new PdfError('encrypted', 'This PDF is password-protected. Open it, copy the text, and paste it instead.');
    throw new PdfError('unreadable', 'This file couldn’t be read as a PDF.');
  }

  const lines: Line[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    onProgress?.(p, doc.numPages);
    const page = await doc.getPage(p);
    const view = page.view; // [x0, y0, x1, y1]
    const pageH = view[3] - view[1] || 792;
    const content = await page.getTextContent();
    let cur: Line | null = null;
    const end = () => {
      if (cur && cur.text.trim()) {
        cur.text = cur.text.replace(/\s+/g, ' ').trim();
        lines.push(cur);
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
        if (str.trim()) cur = { text: str, x, y, endX: x + (item.width ?? 0), size, page: p, top: 1 - (y - view[1]) / pageH };
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
    page.cleanup();
  }

  const meta = await doc.getMetadata().catch(() => null);
  const pages = doc.numPages;
  await task.destroy();

  if (lines.reduce((n, l) => n + l.text.length, 0) < 40) {
    throw new PdfError('no-text', 'This PDF has no selectable text. It may be a scan or a set of images. Copy the text from another source and paste it instead.');
  }

  // Running headers and footers: short lines near the top or bottom of the
  // page that repeat across pages, plus bare page numbers.
  const edge = (l: Line) => l.top < 0.09 || l.top > 0.91;
  const keyOf = (l: Line) => l.text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  const repeats = new Map<string, Set<number>>();
  for (const l of lines) if (edge(l)) repeats.set(keyOf(l), (repeats.get(keyOf(l)) ?? new Set()).add(l.page));
  const minRepeat = Math.max(2, Math.ceil(pages * 0.3));
  const body = lines.filter((l) => {
    if (/^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i.test(l.text) && (edge(l) || l.text.length <= 4)) return false;
    return !(edge(l) && pages > 1 && (repeats.get(keyOf(l))?.size ?? 0) >= minRepeat);
  });

  // The usual body-text size and line spacing.
  const bodySize = median(body.flatMap((l) => Array(Math.min(20, Math.ceil(l.text.length / 20))).fill(Math.round(l.size * 10) / 10)));
  const spacings: number[] = [];
  for (let i = 1; i < body.length; i++) {
    const a = body[i - 1], b = body[i];
    const dy = a.y - b.y;
    if (a.page === b.page && dy > 0 && Math.abs(a.size - bodySize) < 0.5 && Math.abs(b.size - bodySize) < 0.5) spacings.push(dy);
  }
  const lineGap = median(spacings) || bodySize * 1.25;
  const fullWidth = median(body.filter((l) => Math.abs(l.size - bodySize) < 0.5).map((l) => l.endX - l.x));

  // Lines to paragraphs.
  type Para = { lines: Line[]; size: number };
  const paras: Para[] = [];
  let para: Para | null = null;
  for (const line of body) {
    const prev = para?.lines[para.lines.length - 1];
    let start = !prev;
    if (prev) {
      const dy = prev.y - line.y;
      const samePage = prev.page === line.page;
      const sizeJump = Math.abs(line.size - prev.size) > bodySize * 0.12;
      const bigGap = samePage && (dy > lineGap * 1.45 || dy < -lineGap * 2);
      const prevEndsShort = prev.endX - prev.x < fullWidth * 0.8;
      const indented = line.x > para!.lines[0].x + bodySize * 1.2 && TERMINAL.test(prev.text);
      const prevHeading = prev.size > bodySize * 1.15;
      start = sizeJump || bigGap || prevHeading || (TERMINAL.test(prev.text) && prevEndsShort) || indented;
      // Across a page break, keep going if the sentence clearly continues.
      if (!samePage && !sizeJump && !TERMINAL.test(prev.text) && /^[a-z(,]/.test(line.text)) start = false;
    }
    if (start) {
      para = { lines: [], size: line.size };
      paras.push(para);
    }
    para!.lines.push(line);
    para!.size = Math.max(para!.size, line.size);
  }

  const blocks: Block[] = [];
  for (const p of paras) {
    const text = joinLines(p.lines.map((l) => l.text));
    if (!text) continue;
    const n = text.split(/\s+/).length;
    const larger = p.size > bodySize * 1.15;
    const standalone = p.lines.length <= 2 && n <= 12 && !/[.,;]$/.test(text);
    const allCaps = text.replace(/[^a-z]/gi, '').length >= 3 && text === text.toUpperCase();
    const numbered = /^((\d{1,2}(\.\d{1,2}){0,3}\.?)|([IVX]{1,5}\.))\s+[A-Z]/.test(text);
    const heading = (larger && n <= 18) || (standalone && (allCaps || numbered) && n <= 10);
    const last = blocks[blocks.length - 1];
    // A paragraph that continues after a page break and was split anyway.
    if (!heading && last?.kind === 'para' && !TERMINAL.test(last.text) && /^[a-z]/.test(text)) {
      last.text = joinLines([last.text, text]);
      continue;
    }
    blocks.push({ kind: heading ? 'heading' : 'para', text });
  }

  // Title: the document's own metadata, or the largest text on page one.
  const info = (meta?.info ?? {}) as { Title?: string };
  let title = (info.Title ?? '').replace(/^microsoft (word|powerpoint) - /i, '').replace(/\.(docx?|pdf|pptx?)$/i, '').trim();
  if (!title || /^untitled|^document\d*$/i.test(title) || title.length > 160) {
    const firstPage = paras.filter((p) => p.lines[0].page === 1);
    const biggest = firstPage.sort((a, b) => b.size - a.size)[0];
    const text = biggest ? joinLines(biggest.lines.map((l) => l.text)) : '';
    title = biggest && biggest.size > bodySize * 1.2 && text.split(/\s+/).length <= 20 ? text : '';
  }
  if (!title) title = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
  if (blocks[0] && blocks[0].text.toLowerCase() === title.toLowerCase()) blocks[0].kind = 'heading';

  return { blocks, title };
}
