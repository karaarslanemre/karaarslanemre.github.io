// Reads the text out of a transcript PDF in the browser, with Mozilla's
// PDF.js. Nothing is uploaded: the file is read on the visitor's own device.
//
// Transcripts are mostly a sequence of speaker names and what they said, so
// this keeps the PDF's lines as lines (a speaker's name usually sits on its
// own line) and marks paragraph breaks with a blank line. Running headers,
// footers and page numbers are dropped.

export class PdfError extends Error {
  constructor(public code: 'no-text' | 'encrypted' | 'unreadable', message: string) {
    super(message);
  }
}

interface Line {
  text: string;
  x: number;
  y: number;
  size: number;
  page: number;
  top: number; // 0 = top of page, 1 = bottom
}

const median = (v: number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export async function pdfToText(file: File, onProgress?: (page: number, pages: number) => void): Promise<{ text: string; title: string }> {
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
    if (name === 'PasswordException') throw new PdfError('encrypted', `${file.name} is password-protected. Open it, copy the text, and paste it instead.`);
    throw new PdfError('unreadable', `${file.name} couldn’t be read as a PDF.`);
  }

  const lines: Line[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    onProgress?.(p, doc.numPages);
    const page = await doc.getPage(p);
    const view = page.view;
    const pageH = view[3] - view[1] || 792;
    const content = await page.getTextContent();
    let cur: (Line & { endX: number }) | null = null;
    const end = () => {
      if (cur && cur.text.trim()) lines.push({ ...cur, text: cur.text.replace(/\s+/g, ' ').trim() });
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

  if (lines.reduce((n, l) => n + l.text.length, 0) < 200) {
    throw new PdfError('no-text', `${file.name} has no selectable text. It may be a scan. Copy the transcript’s text from another source and paste it instead.`);
  }

  // Running headers and footers: lines near the top or bottom of the page
  // that repeat across pages (ignoring numbers), plus bare page numbers.
  const edge = (l: Line) => l.top < 0.09 || l.top > 0.91;
  const keyOf = (l: Line) => l.text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  const repeats = new Map<string, Set<number>>();
  for (const l of lines) if (edge(l)) repeats.set(keyOf(l), (repeats.get(keyOf(l)) ?? new Set()).add(l.page));
  const minRepeat = Math.max(2, Math.ceil(pages * 0.3));
  const body = lines.filter((l) => {
    if (/^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i.test(l.text) && (edge(l) || l.text.length <= 4)) return false;
    if (edge(l) && /^https?:\/\//i.test(l.text)) return false;
    return !(edge(l) && pages > 1 && (repeats.get(keyOf(l))?.size ?? 0) >= minRepeat);
  });

  // A blank line wherever the spacing opens up, so paragraphs stay apart.
  const spacings: number[] = [];
  for (let i = 1; i < body.length; i++) {
    const dy = body[i - 1].y - body[i].y;
    if (body[i - 1].page === body[i].page && dy > 0) spacings.push(dy);
  }
  const lineGap = median(spacings) || 14;
  const out: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const prev = body[i - 1];
    const line = body[i];
    if (prev && prev.page === line.page && prev.y - line.y > lineGap * 1.45) out.push('');
    const last = out[out.length - 1];
    // Re-join a word hyphenated across lines ("busi-" + "ness").
    if (last && /[a-z]-$/.test(last) && /^[a-z]/.test(line.text)) out[out.length - 1] = last.slice(0, -1) + line.text;
    else out.push(line.text);
  }

  const info = (meta?.info ?? {}) as { Title?: string };
  const title = (info.Title ?? '').trim();
  return { text: out.join('\n'), title: title.length < 160 ? title : '' };
}
