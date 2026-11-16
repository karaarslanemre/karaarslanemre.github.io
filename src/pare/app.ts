// Pare: the page's behavior.
//
// Visitors add PDFs. Each is read in the browser (extract.ts), written out as
// Markdown or plain text, and compared with what the PDF would cost Claude to
// read (tokens.ts). Converted files can be copied or downloaded.

import { PdfError, readPdf, render, type Extracted, type OutputOptions } from './extract';
import { estimate, type Estimate, type Tier } from './tokens';
import { zip } from './zip';

interface Item {
  id: string;
  ex: Extracted;
  output: string;
  est: Estimate;
}

const root = document.getElementById('pr')!;
const $ = <T extends HTMLElement = HTMLElement>(sel: string, el: ParentNode = root) => el.querySelector<T>(sel)!;
const form = $<HTMLFormElement>('#pr-options');

const state = {
  items: [] as Item[],
  selected: '',
  busy: false,
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n: number) => n.toLocaleString('en-US');
const pct = (v: number) => `${Math.round(v * 100)}%`;

function options(): OutputOptions & { tier: Tier } {
  const data = new FormData(form);
  return {
    format: data.get('format') === 'plain' ? 'plain' : 'markdown',
    pageMarkers: data.get('markers') === 'on',
    tier: data.get('tier') === 'standard' ? 'standard' : 'high',
  };
}

const extension = () => (options().format === 'markdown' ? '.md' : '.txt');
const outName = (item: Item) => item.ex.name.replace(/\.pdf$/i, '') + extension();

function say(message: string, kind: 'info' | 'error' = 'info') {
  const el = $('#pr-status');
  el.textContent = message;
  el.dataset.kind = kind;
  el.hidden = !message;
}

function build(ex: Extracted, id = crypto.randomUUID()): Item {
  const o = options();
  const output = render(ex, o);
  return { id, ex, output, est: estimate(ex.rawText, ex.sizes, output, o.tier) };
}

function rebuildAll() {
  state.items = state.items.map((i) => build(i.ex, i.id));
  draw();
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function draw() {
  const results = $('#pr-results');
  results.hidden = state.items.length === 0;
  if (!state.items.length) return;
  if (!state.items.some((i) => i.id === state.selected)) state.selected = state.items[0].id;

  const pdf = state.items.reduce((n, i) => n + i.est.pdf, 0);
  const text = state.items.reduce((n, i) => n + i.est.text, 0);
  $('[data-total-saved]').textContent = `${pct(pdf ? 1 - text / pdf : 0)} fewer`;
  $('[data-total-line]').textContent = `About ${num(text)} tokens as text instead of ${num(pdf)} as ${state.items.length === 1 ? 'a PDF' : 'PDFs'}.`;
  $('[data-zip]').textContent = state.items.length === 1 ? `Download ${extension()}` : `Download all (.zip)`;

  $('[data-rows]').innerHTML = state.items
    .map((i) => {
      const current = i.id === state.selected;
      return `<tr${current ? ' class="is-current"' : ''}>
        <th scope="row"><button type="button" class="pr-link pr-name" data-select="${i.id}"${current ? ' aria-current="true"' : ''}>${esc(i.ex.name)}</button></th>
        <td class="num">${num(i.ex.pages)}</td>
        <td class="num">${num(i.est.pdf)}</td>
        <td class="num">${num(i.est.text)}</td>
        <td class="num"><strong>${pct(i.est.saved)}</strong></td>
        <td class="pr-row-actions"><button type="button" class="pr-x" data-remove="${i.id}" aria-label="Remove ${esc(i.ex.name)}">×</button></td>
      </tr>`;
    })
    .join('');

  drawPreview();
}

function pageList(pages: number[]): string {
  if (pages.length <= 8) return pages.join(', ');
  return `${pages.slice(0, 8).join(', ')} and ${pages.length - 8} more`;
}

function drawPreview() {
  const item = state.items.find((i) => i.id === state.selected);
  if (!item) return;
  const { ex, est } = item;
  $('[data-preview-title]').textContent = outName(item);
  $<HTMLTextAreaElement>('[data-preview]').value = item.output;

  $('[data-breakdown]').innerHTML = `
    <dt>As a PDF</dt><dd>${num(est.pdf)} tokens<br /><span class="muted">${num(est.pdfText)} text + ${num(est.pdfImages)} page images</span></dd>
    <dt>As text</dt><dd>${num(est.text)} tokens<br /><span class="muted">${num(item.output.length)} characters</span></dd>
    <dt>Saved</dt><dd>${pct(est.saved)}</dd>`;

  const warnings: string[] = [];
  if (ex.imagePages.length) {
    const one = ex.imagePages.length === 1;
    warnings.push(`${one ? 'Page' : 'Pages'} ${pageList(ex.imagePages)} ${one ? 'has' : 'have'} pictures, which the text leaves out. If they carry meaning (a chart, a diagram), send the PDF instead, or just those pages.`);
  }
  const chars = ex.rawText.replace(/\s/g, '').length;
  if (chars / ex.pages < 300) warnings.push('Some pages have very little text. If this is partly scanned, those pages will be missing.');
  $('[data-warnings]').innerHTML = warnings.map((w) => `<li>${esc(w)}</li>`).join('');
}

// ---------------------------------------------------------------------------
// Adding files
// ---------------------------------------------------------------------------

async function addFiles(files: File[]) {
  const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!pdfs.length) return say('Those aren’t PDFs. Pare reads PDF files only.', 'error');
  if (state.busy) return;
  state.busy = true;
  const problems: string[] = [];
  let added = '';
  try {
    for (const [n, file] of pdfs.entries()) {
      const prefix = pdfs.length > 1 ? `File ${n + 1} of ${pdfs.length}: ` : '';
      say(`${prefix}reading ${file.name}…`);
      try {
        const ex = await readPdf(file, (p, total) => {
          if (total > 3) say(`${prefix}reading ${file.name}, page ${p} of ${total}…`);
        });
        const item = build(ex);
        state.items = [...state.items.filter((i) => i.ex.name !== ex.name), item];
        added = item.id;
      } catch (err) {
        problems.push(err instanceof PdfError ? err.message : `${file.name} couldn’t be read.`);
        console.error(err);
      }
    }
  } finally {
    state.busy = false;
  }
  if (added) state.selected = added;
  say(problems.join(' '), problems.length ? 'error' : 'info');
  draw();
  if (added) document.getElementById('pr-results')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const textBlob = (text: string) => new Blob([text], { type: options().format === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' });

function downloadAll() {
  if (state.items.length === 1) return download(textBlob(state.items[0].output), outName(state.items[0]));
  const used = new Set<string>();
  const files = state.items.map((i) => {
    let name = outName(i);
    for (let n = 2; used.has(name); n++) name = outName(i).replace(/(\.\w+)$/, ` (${n})$1`);
    used.add(name);
    return { name, text: i.output };
  });
  download(zip(files), 'pare.zip');
}

async function copyText(button: HTMLElement) {
  const item = state.items.find((i) => i.id === state.selected);
  if (!item) return;
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(item.output);
    button.textContent = 'Copied';
  } catch {
    const box = $<HTMLTextAreaElement>('[data-preview]');
    box.focus();
    box.select();
    button.textContent = 'Press Ctrl+C';
  }
  setTimeout(() => (button.textContent = label), 1600);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

const fileInput = $<HTMLInputElement>('#pr-file');
const drop = $('#pr-drop');
fileInput.addEventListener('change', () => {
  const files = [...(fileInput.files ?? [])];
  fileInput.value = '';
  addFiles(files);
});
['dragenter', 'dragover'].forEach((t) =>
  drop.addEventListener(t, (e) => {
    e.preventDefault();
    drop.classList.add('is-over');
  }),
);
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('is-over')));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  addFiles([...((e as DragEvent).dataTransfer?.files ?? [])]);
});

form.addEventListener('change', rebuildAll);
form.addEventListener('submit', (e) => e.preventDefault());

root.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const sel = t.closest<HTMLElement>('[data-select]');
  if (sel) {
    state.selected = sel.dataset.select!;
    draw();
    document.getElementById('pr-preview')?.scrollIntoView({ block: 'start' });
    return;
  }
  const rm = t.closest<HTMLElement>('[data-remove]');
  if (rm) {
    state.items = state.items.filter((i) => i.id !== rm.dataset.remove);
    return draw();
  }
  if (t.closest('[data-clear]')) {
    state.items = [];
    say('');
    return draw();
  }
  if (t.closest('[data-zip]')) return downloadAll();
  const copy = t.closest<HTMLElement>('[data-copy]');
  if (copy) return void copyText(copy);
  if (t.closest('[data-download]')) {
    const item = state.items.find((i) => i.id === state.selected);
    if (item) download(textBlob(item.output), outName(item));
  }
});
