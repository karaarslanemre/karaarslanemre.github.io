// Tenor: the page's behavior.
//
// Visitors add transcripts (PDFs or pasted text). Each is parsed into who said
// what (parse.ts) and scored (analyze.ts) right here in the browser, then the
// page shows the trend across calls, the topics, and any one call in detail.
// In the copy hosted on claude.ai, Claude can also judge each answer and write
// a short read of the trend (claude.ts).

import { analyze, findings, scan, signed, type Analysis, type Exchange, type Scores } from './analyze';
import { lineChart, type Series } from './charts';
import { claude, ClaudeError, judgeAnswers, readTrend, type Judgment } from './claude';
import { EXAMPLE } from './example';
import { TOPICS, type Topic } from './lexicon';
import { findPeriod, parseTranscript, type Call, type Turn } from './parse';

interface Item {
  name: string;
  text: string;
  label?: string;
  call: Call;
  analysis: Analysis;
  order: number;
}

const SAVE_KEY = 'tenor:last';
const root = document.getElementById('tn')!;
const onClaude = root.dataset.target === 'claude';
const claudeUrl = root.dataset.claude ?? '';
const $ = <T extends HTMLElement = HTMLElement>(sel: string, el: ParentNode = root) => el.querySelector<T>(sel)!;
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const state = {
  items: [] as Item[],
  selected: -1,
  custom: [] as Topic[],
  allAnswers: false,
  example: false,
  judgments: new Map<string, Judgment[]>(),
  judgeErrors: new Map<string, string>(),
  judging: new Set<string>(),
  claudeOff: '',
  read: { text: '', status: 'idle' as 'idle' | 'working' | 'done' | 'error', error: '', controller: null as AbortController | null },
  order: 0,
  charts: [] as Array<() => void>,
  transcriptFor: '',
};

const topics = () => [...TOPICS, ...state.custom];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const one = (v: number) => v.toFixed(1);
const pct = (v: number) => `${Math.round(v)}%`;
const words = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'word' : 'words'}`;
const roleName: Record<string, string> = { ceo: 'CEO', cfo: 'CFO', exec: 'Executive', analyst: 'Analyst', operator: 'Operator', other: '' };

function niceDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function say(message: string, kind: 'info' | 'error' = 'info') {
  const el = $('#tn-status');
  el.textContent = message;
  el.dataset.kind = kind;
  el.hidden = !message;
}

// ---------------------------------------------------------------------------
// Adding and ordering calls
// ---------------------------------------------------------------------------

function applyLabel(call: Call, label: string) {
  const clean = label.trim().slice(0, 40);
  if (!clean) return;
  const p = findPeriod(clean);
  call.period = p ? { ...p, label: clean } : { label: clean, fiscal: false, sort: Number.POSITIVE_INFINITY };
  call.warnings = call.warnings.filter((w) => !/which quarter/.test(w));
}

function addText(text: string, name: string, label?: string): 'added' | 'duplicate' | 'short' {
  if (text.trim().split(/\s+/).length < 150) return 'short';
  const call = parseTranscript(text, name);
  if (state.items.some((i) => i.call.id === call.id)) return 'duplicate';
  if (label) applyLabel(call, label);
  state.items.push({ name, text, label, call, analysis: analyze(call, topics()), order: state.order++ });
  return 'added';
}

function sortItems() {
  const key = (i: Item) => i.call.period.sort;
  state.items.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka !== kb) return !Number.isFinite(ka) ? 1 : !Number.isFinite(kb) ? -1 : ka - kb;
    return (a.call.date || '').localeCompare(b.call.date || '') || a.order - b.order;
  });
}

function clearAll() {
  state.items = [];
  state.selected = -1;
  state.example = false;
  state.judgments.clear();
  state.judgeErrors.clear();
  state.read = { text: '', status: 'idle', error: '', controller: null };
  state.transcriptFor = '';
}

function afterAdding(scroll: boolean, pick?: (items: Item[]) => number) {
  sortItems();
  state.selected = pick ? pick(state.items) : state.items.length - 1;
  state.read = { text: '', status: 'idle', error: '', controller: null };
  render();
  save();
  if (scroll && state.items.length) $('#tn-results').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}

const isPdf = (f: File) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';

async function loadFiles(files: File[]) {
  if (!files.length) return;
  const pdfs = files.filter(isPdf);
  const notes: string[] = [];
  if (pdfs.length < files.length) notes.push(`${files.length - pdfs.length} file${files.length - pdfs.length === 1 ? ' isn’t a PDF' : 's aren’t PDFs'}, so ${files.length - pdfs.length === 1 ? 'it was' : 'they were'} skipped.`);
  if (state.example) clearAll();
  let added = 0;
  const { pdfToText } = await import('./pdf');
  for (let k = 0; k < pdfs.length; k++) {
    const f = pdfs[k];
    const prefix = pdfs.length > 1 ? `Reading ${k + 1} of ${pdfs.length}: ${f.name}` : `Reading ${f.name}`;
    say(`${prefix}…`);
    if (f.size > 60 * 1024 * 1024) {
      notes.push(`${f.name} is over 60 MB, so it was skipped.`);
      continue;
    }
    try {
      const { text, title } = await pdfToText(f, (p, n) => say(`${prefix}, page ${p} of ${n}…`));
      const full = title && /earnings|results|call|Q[1-4]/i.test(title) && !text.slice(0, 600).includes(title) ? `${title}\n${text}` : text;
      const r = addText(full, f.name);
      if (r === 'duplicate') notes.push(`${f.name} is already in the list.`);
      else if (r === 'short') notes.push(`${f.name} is too short to be a call transcript.`);
      else added++;
    } catch (err) {
      notes.push((err as Error).message || `${f.name} couldn’t be read.`);
    }
  }
  say(notes.length ? `${added ? `Added ${added} call${added === 1 ? '' : 's'}. ` : ''}${notes.join(' ')}` : '', notes.length && !added ? 'error' : 'info');
  if (added) afterAdding(true);
}

function loadExample() {
  clearAll();
  for (const e of EXAMPLE) addText(e.text, e.name);
  state.example = true;
  say('');
  // Open on the call with the most answers to check, where the story is.
  afterAdding(true, (items) => items.reduce((best, i, k) => (i.analysis.exchanges.filter((e) => e.flagged).length > items[best].analysis.exchanges.filter((e) => e.flagged).length ? k : best), 0));
}

// ---------------------------------------------------------------------------
// The list of calls (in the input band)
// ---------------------------------------------------------------------------

function renderCallList() {
  const box = $('#tn-calls');
  box.hidden = !state.items.length;
  const list = $('[data-call-list]');
  list.replaceChildren();
  const labels = new Map<string, number>();
  state.items.forEach((i) => labels.set(i.call.period.label, (labels.get(i.call.period.label) ?? 0) + 1));
  $('[data-calls-title]').textContent = `${state.items.length} ${state.items.length === 1 ? 'call' : 'calls'}${state.example ? ' (example)' : ''}`;
  for (const item of state.items) {
    const c = item.call;
    const li = document.createElement('li');
    li.className = 'tn-call-row';
    const input = document.createElement('input');
    input.className = 'tn-q';
    input.value = c.period.label;
    input.setAttribute('aria-label', `Quarter for ${item.name}`);
    input.dataset.id = c.id;
    input.spellcheck = false;
    const info = document.createElement('span');
    info.className = 'tn-call-info';
    const strong = document.createElement('strong');
    strong.textContent = c.company || 'Company not found';
    const bits = [niceDate(c.date), words(item.analysis.mgmt.words + item.analysis.analysts.words), c.qaFound ? `${item.analysis.exchanges.length} questions` : 'no Q&A found'].filter(Boolean);
    info.append(strong, document.createTextNode(` · ${bits.join(' · ')}`));
    const src = document.createElement('span');
    src.className = 'tn-call-source';
    src.textContent = item.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'tn-x';
    remove.dataset.remove = c.id;
    remove.setAttribute('aria-label', `Remove ${item.name}`);
    remove.textContent = '×';
    li.append(input, info, src, remove);
    const warns = [...c.warnings];
    if ((labels.get(c.period.label) ?? 0) > 1) warns.push(`Two calls are labelled ${c.period.label}.`);
    for (const w of warns) {
      const p = document.createElement('span');
      p.className = 'tn-warn';
      p.textContent = w;
      li.append(p);
    }
    list.append(li);
  }
}

// ---------------------------------------------------------------------------
// The trend
// ---------------------------------------------------------------------------

function companyName(): { name: string; mixed: string[] } {
  const counts = new Map<string, number>();
  for (const i of state.items) if (i.call.company) counts.set(i.call.company, (counts.get(i.call.company) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const name = sorted[0]?.[0] ?? 'Company';
  const ticker = state.items.find((i) => i.call.company === name && i.call.ticker)?.call.ticker;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '').replace(/(inc|corp|corporation|co|ltd|plc|holdings|group)$/, '');
  const mixed = sorted.map(([n]) => n).filter((n, i, all) => all.findIndex((m) => norm(m) === norm(n)) === i);
  return { name: ticker ? `${name} (${ticker})` : name, mixed: mixed.length > 1 ? mixed : [] };
}

function select(i: number, scroll = false) {
  tip.hidden = true;
  state.selected = Math.max(0, Math.min(state.items.length - 1, i));
  renderTrend();
  renderTopics();
  renderCall();
  if (scroll) $('#tn-call').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}

function renderFindings() {
  const list = $('[data-findings]');
  list.replaceChildren();
  const analyses = state.items.map((i) => i.analysis);
  const { mixed } = companyName();
  const out = findings(analyses, topics(), state.selected);
  if (mixed.length) out.unshift({ text: `These calls seem to come from more than one company (${mixed.slice(0, 3).join(', ')}). Scores compare best within one company.`, weight: 9, quarter: '' });
  for (const f of out) {
    const li = document.createElement('li');
    li.append(document.createTextNode(`${f.text} `));
    const idx = state.items.findIndex((i) => i.call.period.label === f.quarter);
    if (idx >= 0 && idx !== state.selected) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tn-link';
      b.dataset.go = String(idx);
      b.textContent = `Read ${f.quarter} →`;
      li.append(b);
    }
    list.append(li);
  }
  if (!out.length) {
    const li = document.createElement('li');
    li.textContent = 'Nothing stands out yet. Add more quarters to see how the tone moves.';
    list.append(li);
  }
}

function avgAnswer(a: Analysis): number | null {
  if (!a.exchanges.length) return null;
  return a.exchanges.reduce((s, e) => s + e.answerWords, 0) / a.exchanges.length;
}

function claudeShare(a: Analysis): number | null {
  const j = state.judgments.get(a.call.id);
  if (!j || !j.length) return null;
  return (j.filter((x) => x.verdict !== 'answered').length / j.length) * 100;
}

interface ChartDef {
  title: string;
  unit: string;
  series: Series[];
  fmt: (v: number) => string;
  zero?: boolean;
  minTop?: number;
  legend?: boolean;
}

function chartDefs(): ChartDef[] {
  const A = state.items.map((i) => i.analysis);
  const pair = (get: (s: Scores) => number | null): Series[] => [
    { name: 'Prepared remarks', color: 'var(--tn-prep)', values: A.map((a) => get(a.prepared)) },
    { name: 'Answers in the Q&A', color: 'var(--tn-qa)', values: A.map((a) => get(a.qa)) },
  ];
  const nonAnswers: Series[] = [{ name: 'Word rules', color: 'var(--tn-qa)', values: A.map((a) => a.nonAnswerShare) }];
  const judged = A.map(claudeShare);
  if (judged.some((v) => v != null)) nonAnswers.push({ name: 'Claude: partial or sidestepped', color: 'var(--ink)', values: judged });
  return [
    { title: 'Tone', unit: 'Good-news minus bad-news words, per 1,000', series: pair((s) => s.tone), fmt: (v) => signed(v), zero: true },
    { title: 'Hedging', unit: 'Hedges and weak modals, per 1,000 words', series: pair((s) => s.hedging), fmt: one, zero: true },
    { title: 'Figures', unit: 'Numbers given, per 1,000 words', series: pair((s) => s.specificity), fmt: one, zero: true },
    {
      title: 'Analysts’ tone',
      unit: 'In their questions, per 1,000 words',
      series: [{ name: 'Analysts', color: 'var(--tn-an)', values: A.map((a) => a.analysts.tone) }],
      fmt: (v) => signed(v),
      zero: true,
    },
    { title: 'Possible non-answers', unit: 'Share of answers in the Q&A', series: nonAnswers, fmt: pct, zero: true, minTop: 50, legend: nonAnswers.length > 1 },
    {
      title: 'Answer length',
      unit: 'Average words per answer',
      series: [{ name: 'Answers in the Q&A', color: 'var(--tn-qa)', values: A.map(avgAnswer) }],
      fmt: (v) => String(Math.round(v)),
      zero: true,
    },
  ];
}

function renderTrend() {
  const { name } = companyName();
  $('[data-company]').textContent = name;
  const first = state.items[0]?.call.period.label;
  const last = state.items[state.items.length - 1]?.call.period.label;
  $('[data-range]').textContent = state.items.length > 1 ? `${state.items.length} calls, ${first} to ${last}` : '1 call';
  $('[data-example-flag]').hidden = !state.example;
  renderFindings();

  state.charts.forEach((d) => d());
  state.charts = [];
  const host = $('[data-charts]');
  host.replaceChildren();
  const labels = state.items.map((i) => i.call.period.label);
  for (const def of chartDefs()) {
    const fig = document.createElement('figure');
    fig.className = 'tn-chart';
    const cap = document.createElement('figcaption');
    const title = document.createElement('span');
    title.className = 'tn-chart-title';
    title.textContent = def.title;
    const unit = document.createElement('span');
    unit.className = 'tn-chart-unit';
    unit.textContent = def.unit;
    cap.append(title, unit);
    let legend: HTMLElement | null = null;
    if (def.legend) {
      const ul = document.createElement('ul');
      ul.className = 'tn-series-legend tn-series-legend--small';
      for (const s of def.series) {
        const li = document.createElement('li');
        const key = document.createElement('span');
        key.className = 'tn-key';
        key.style.background = s.color;
        li.append(key, document.createTextNode(s.name));
        ul.append(li);
      }
      legend = ul;
    }
    const plot = document.createElement('div');
    plot.className = 'tn-plot';
    fig.append(cap, plot);
    if (legend) fig.append(legend);
    host.append(fig);
    state.charts.push(
      lineChart(plot, {
        labels,
        series: def.series,
        fmt: def.fmt,
        zero: def.zero,
        minTop: def.minTop,
        selected: state.selected,
        onSelect: (i) => select(i, true),
        label: `${def.title}, ${def.unit}, by quarter`,
      }),
    );
  }
  if (!$('[data-table]').hidden) renderTable();
}

function renderTable() {
  const defs = chartDefs();
  const labels = state.items.map((i) => i.call.period.label);
  let html = `<table class="tn-table"><thead><tr><th scope="col">Measure</th>${labels.map((l) => `<th scope="col">${esc(l)}</th>`).join('')}</tr></thead><tbody>`;
  for (const d of defs) {
    for (const s of d.series) {
      const name = d.series.length > 1 ? `${d.title}: ${s.name}` : d.title;
      html += `<tr><th scope="row">${esc(name)}</th>${s.values.map((v) => `<td>${v == null || !Number.isFinite(v) ? '–' : esc(d.fmt(v))}</td>`).join('')}</tr>`;
    }
  }
  $('[data-table]').innerHTML = `${html}</tbody></table>`;
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

const tip = document.createElement('div');
tip.className = 'tn-tip tn-tip--float';
tip.hidden = true;
document.body.append(tip);

function showTip(target: HTMLElement, head: string, rows: string[]) {
  tip.replaceChildren();
  const h = document.createElement('p');
  h.className = 'tn-tip-head';
  h.textContent = head;
  tip.append(h);
  for (const r of rows) {
    const p = document.createElement('p');
    p.className = 'tn-tip-row';
    p.textContent = r;
    tip.append(p);
  }
  tip.hidden = false;
  const r = target.getBoundingClientRect();
  const w = tip.offsetWidth;
  tip.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2)) + window.scrollX}px`;
  tip.style.top = `${r.bottom + 8 + window.scrollY}px`;
}

function toneColor(tone: number | null): string {
  if (tone == null) return '';
  const k = Math.min(1, Math.abs(tone) / 40);
  if (Math.abs(tone) < 3) return 'var(--tn-mid)';
  const pole = tone > 0 ? 'var(--tn-pos)' : 'var(--tn-neg)';
  return `color-mix(in oklab, ${pole} ${Math.round(25 + k * 75)}%, var(--tn-mid))`;
}

function renderTopics() {
  const list = topics();
  const items = state.items;
  const totals = list.map((t) => items.reduce((s, i) => s + (i.analysis.topics[t.id]?.mentions ?? 0), 0));
  const shown = list.map((t, k) => ({ t, total: totals[k] })).filter((x) => x.total > 0 || x.t.custom).sort((a, b) => b.total - a.total);
  const quiet = list.filter((_, k) => totals[k] === 0 && !list[k].custom).map((t) => t.name);
  const max = Math.max(1, ...items.flatMap((i) => shown.map(({ t }) => i.analysis.topics[t.id]?.per1k ?? 0)));

  const table = document.createElement('table');
  table.className = 'tn-grid';
  const head = document.createElement('tr');
  const corner = document.createElement('th');
  corner.scope = 'col';
  corner.innerHTML = '<span class="visually-hidden">Topic</span>';
  head.append(corner);
  items.forEach((i, idx) => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = i.call.period.label;
    if (idx === state.selected) th.className = 'is-selected';
    head.append(th);
  });
  const thead = document.createElement('thead');
  thead.append(head);
  const tbody = document.createElement('tbody');
  for (const { t } of shown) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = t.name;
    if (t.custom) {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'tn-x tn-x--small';
      x.dataset.removeTopic = t.id;
      x.setAttribute('aria-label', `Stop tracking ${t.name}`);
      x.textContent = '×';
      th.append(' ', x);
    }
    tr.append(th);
    items.forEach((i, idx) => {
      const s = i.analysis.topics[t.id];
      const td = document.createElement('td');
      if (idx === state.selected) td.className = 'is-selected';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tn-cell';
      b.dataset.go = String(idx);
      const size = s && s.mentions ? Math.round(8 + 22 * Math.sqrt(s.per1k / max)) : 0;
      const dot = document.createElement('span');
      dot.className = 'tn-dot-mark';
      if (!size) dot.classList.add('is-none');
      else {
        dot.style.width = dot.style.height = `${size}px`;
        const c = toneColor(s.tone);
        if (c) dot.style.background = c;
        else dot.classList.add('is-hollow');
      }
      b.append(dot);
      const toneText = !s?.mentions ? '' : s.tone == null ? 'Too few words to tell the tone' : `Management’s tone around it: ${signed(s.tone)}`;
      const rows = [s?.mentions ? `${s.mentions} mention${s.mentions === 1 ? '' : 's'}, ${one(s.per1k)} per 1,000 words` : 'Not mentioned', toneText].filter(Boolean);
      b.setAttribute('aria-label', `${t.name}, ${i.call.period.label}: ${rows.join('. ')}`);
      b.addEventListener('pointerenter', () => showTip(b, `${t.name} · ${i.call.period.label}`, rows));
      b.addEventListener('focus', () => showTip(b, `${t.name} · ${i.call.period.label}`, rows));
      b.addEventListener('pointerleave', () => (tip.hidden = true));
      b.addEventListener('blur', () => (tip.hidden = true));
      td.append(b);
      tr.append(td);
    });
    tbody.append(tr);
  }
  table.append(thead, tbody);
  const wrap = $('[data-topics]');
  wrap.replaceChildren(table);
  const q = $('[data-quiet-topics]');
  q.hidden = !quiet.length;
  q.textContent = quiet.length ? `Not mentioned in any call: ${quiet.join(', ')}.` : '';
}

function reanalyze() {
  for (const i of state.items) i.analysis = analyze(i.call, topics());
}

// ---------------------------------------------------------------------------
// One call
// ---------------------------------------------------------------------------

function scoresRow(name: string, s: Scores | undefined): string {
  if (!s || !s.words) return '';
  const cell = (v: number | null, f: (v: number) => string) => `<td>${v == null ? '–' : esc(f(v))}</td>`;
  return `<tr><th scope="row">${esc(name)}</th><td>${s.words.toLocaleString()}</td>${cell(s.tone, (v) => signed(v))}${cell(s.hedging, one)}${cell(s.confidence, (v) => `${Math.round(v)}%`)}${cell(s.specificity, one)}</tr>`;
}

function renderPicker() {
  const ol = $('[data-picker]');
  ol.replaceChildren();
  state.items.forEach((i, idx) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tn-pick';
    b.dataset.go = String(idx);
    b.setAttribute('aria-pressed', String(idx === state.selected));
    b.textContent = i.call.period.label;
    li.append(b);
    ol.append(li);
  });
}

function verdictChip(j: Judgment): string {
  const text = j.verdict === 'answered' ? 'Answered' : j.verdict === 'partial' ? 'Partly answered' : 'Sidestepped';
  return `<span class="tn-verdict tn-verdict--${j.verdict}">Claude: ${text}</span>`;
}

function excerpt(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, '')}…` : t;
}

function answerHtml(e: Exchange, j?: Judgment): string {
  const flagged = e.flagged || (j && j.verdict !== 'answered');
  const firm = e.firm.replace(/\s*(--|—|–|-)\s*analyst\s*$/i, '');
  const answers = e.answers
    .map((a) => `<p class="tn-a-who">${esc(a.speaker)}${roleName[a.role] ? `, ${roleName[a.role]}` : ''}</p><p class="tn-a-text">${esc(excerpt(a.text, 520))}</p>`)
    .join('');
  const full = e.answers.map((a) => `<p class="tn-a-who">${esc(a.speaker)}</p><p class="tn-a-text">${esc(a.text)}</p>`).join('');
  const long = e.question.length > 420 || e.answers.some((a) => a.text.length > 520);
  return `<li class="tn-answer${flagged ? ' is-flagged' : ''}">
    <div class="tn-answer-top"><span class="tn-answer-n">${e.n}</span><span><strong>${esc(e.analyst)}</strong>${firm ? ` <span class="muted">${esc(firm)}</span>` : ''}</span>${j ? verdictChip(j) : ''}</div>
    <p class="tn-q-text">${esc(excerpt(e.question, 420))}</p>
    ${answers}
    ${long ? `<details class="tn-more"><summary>Read the whole exchange</summary><p class="tn-q-text">${esc(e.question)}</p>${full}</details>` : ''}
    ${j?.reason ? `<p class="tn-reason">${esc(j.reason)}</p>` : ''}
    ${e.flags.length ? `<ul class="tn-flags">${e.flags.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul>` : ''}
  </li>`;
}

function renderAnswers() {
  const item = state.items[state.selected];
  const ol = $('[data-answers]');
  if (!item) return;
  const a = item.analysis;
  const j = state.judgments.get(item.call.id);
  if (!item.call.qaFound || !a.exchanges.length) {
    ol.innerHTML = `<li class="tn-empty">${item.call.qaFound ? 'No questions and answers were found in this call.' : 'No Q&amp;A section was found in this transcript.'}</li>`;
    return;
  }
  const list = a.exchanges.filter((e, k) => state.allAnswers || e.flagged || (j && j[k]?.verdict !== 'answered'));
  const err = state.judgeErrors.get(item.call.id);
  ol.innerHTML =
    (err ? `<li class="tn-empty tn-error">${esc(err)}</li>` : '') +
    (list.length
      ? list.map((e) => answerHtml(e, j?.[e.n - 1])).join('')
      : `<li class="tn-empty">None of the ${a.exchanges.length} answers in this call was flagged. Tick “Show every answer” to read them all.</li>`);
}

function renderJudgeControls() {
  if (!onClaude) return;
  const box = root.querySelector<HTMLElement>('[data-judge]');
  if (!box) return;
  const item = state.items[state.selected];
  const oneBtn = $<HTMLButtonElement>('[data-judge-one]', box);
  const all = $<HTMLButtonElement>('[data-judge-all]', box);
  const status = $('[data-judge-status]', box);
  box.hidden = !!state.claudeOff || !item?.analysis.exchanges.length;
  const busy = state.judging.size > 0;
  const done = item ? state.judgments.has(item.call.id) : false;
  oneBtn.disabled = busy || done;
  oneBtn.textContent = done ? 'Claude has judged these answers' : 'Have Claude judge these answers';
  const remaining = state.items.filter((i) => !state.judgments.has(i.call.id) && i.analysis.exchanges.length).length;
  all.hidden = remaining === 0 || state.items.length < 2;
  all.disabled = busy;
  all.textContent = `Judge every call (${remaining} left)`;
  const working = [...state.judging].map((id) => state.items.find((i) => i.call.id === id)?.call.period.label).filter(Boolean);
  status.textContent = working.length ? `Claude is reading the Q&A of ${working.join(' and ')}…` : '';
}

function markText(text: string): string {
  const { hits } = scan(text);
  let out = '';
  let at = 0;
  for (const h of hits) {
    if (h.start < at) continue;
    const cls = h.cat === 'pos' ? 'pos' : h.cat === 'neg' ? 'neg' : h.cat === 'strong' ? 'strong' : 'hedge';
    const title = h.flipped ? 'Bad news: a good-news word after “not” or “no”' : h.cat === 'pos' ? 'Good news' : h.cat === 'neg' ? 'Bad news' : h.cat === 'strong' ? 'Strong modal' : h.cat === 'weak' ? 'Weak modal' : 'Hedge';
    out += esc(text.slice(at, h.start)) + `<span class="tn-m tn-m-${cls}" title="${title}">${esc(text.slice(h.start, h.end))}</span>`;
    at = h.end;
  }
  return out + esc(text.slice(at));
}

function renderTranscript() {
  const item = state.items[state.selected];
  const details = $<HTMLDetailsElement>('[data-transcript]');
  if (!item || !details.open || state.transcriptFor === item.call.id) return;
  state.transcriptFor = item.call.id;
  let html = '';
  let section = '';
  for (const t of item.call.turns as Turn[]) {
    if (t.section !== section) {
      html += `<p class="tn-section">${t.section === 'qa' ? 'Questions and answers' : 'Prepared remarks'}</p>`;
      section = t.section;
    }
    const quiet = t.role === 'operator' || t.role === 'other';
    const paras = t.paras
      .map((p) =>
        p.boiler ? `<p class="tn-boiler"><span class="tn-boiler-tag">Left out of the scores</span> ${esc(p.text)}</p>` : `<p>${quiet ? esc(p.text) : markText(p.text)}</p>`,
      )
      .join('');
    const title = t.title || roleName[t.role] || '';
    html += `<div class="tn-turn tn-role-${t.role}"><p class="tn-turn-who"><strong>${esc(t.speaker)}</strong>${title ? ` <span>${esc(title)}</span>` : ''}</p><div class="tn-turn-text">${paras}</div></div>`;
  }
  $('[data-turns]').innerHTML = html;
}

function renderCall() {
  const item = state.items[state.selected];
  if (!item) return;
  const c = item.call;
  const a = item.analysis;
  renderPicker();
  $('[data-call-title]').textContent = `${c.period.label}, line by line.`;
  $('[data-call-meta]').textContent = [c.company, niceDate(c.date), item.name].filter(Boolean).join(' · ');
  const warns = $('[data-call-warnings]');
  warns.replaceChildren();
  const all = [...c.warnings];
  if (a.boilerWords) all.push(`${words(a.boilerWords)} of safe-harbor and similar legal language were left out of the scores.`);
  for (const w of all) {
    const li = document.createElement('li');
    li.textContent = w;
    warns.append(li);
  }
  $('[data-scores]').innerHTML = `<table class="tn-table"><thead><tr><th scope="col">Who</th><th scope="col">Words</th><th scope="col">Tone</th><th scope="col">Hedging</th><th scope="col">Confidence</th><th scope="col">Figures</th></tr></thead><tbody>${[
    scoresRow('Prepared remarks', a.prepared),
    scoresRow('Answers in the Q&A', a.qa),
    scoresRow(`CEO${a.speakers.find((s) => s.role === 'ceo') ? `: ${a.speakers.find((s) => s.role === 'ceo')!.name}` : ''}`, a.byRole.ceo),
    scoresRow(`CFO${a.speakers.find((s) => s.role === 'cfo') ? `: ${a.speakers.find((s) => s.role === 'cfo')!.name}` : ''}`, a.byRole.cfo),
    scoresRow('Other executives', a.byRole.exec),
    scoresRow('Analysts', a.analysts),
  ].join('')}</tbody></table><p class="tn-small muted tn-table-note">Tone, hedging and figures are per 1,000 words. Confidence is the share of “will” and “must” among all modal words.</p>`;
  renderAnswers();
  renderJudgeControls();
  state.transcriptFor = '';
  renderTranscript();
}

// ---------------------------------------------------------------------------
// Claude (claude.ai copy only)
// ---------------------------------------------------------------------------

function claudeFailed(err: unknown, id?: string) {
  const e = err instanceof ClaudeError ? err : new ClaudeError('error', 'Claude had a problem with this. Try again.');
  if (e.code === 'cancelled') return;
  if (e.final) {
    state.claudeOff = e.message;
    const off = root.querySelector<HTMLElement>('[data-claude-off]');
    if (off) {
      off.textContent = e.message;
      off.hidden = false;
    }
  }
  if (id) state.judgeErrors.set(id, e.message);
}

async function judge(ids: string[]) {
  const queue = [...new Set(ids)].filter((id) => !state.judgments.has(id) && !state.judging.has(id));
  const worker = async () => {
    for (;;) {
      const id = queue.shift();
      if (!id || state.claudeOff) return;
      if (state.judgments.has(id) || state.judging.has(id)) continue;
      const item = state.items.find((i) => i.call.id === id);
      if (!item) continue;
      state.judging.add(id);
      state.judgeErrors.delete(id);
      renderJudgeControls();
      try {
        state.judgments.set(id, await judgeAnswers(item.analysis));
        save();
      } catch (err) {
        claudeFailed(err, id);
      } finally {
        state.judging.delete(id);
      }
      if (state.items[state.selected]?.call.id === id) renderAnswers();
      renderJudgeControls();
      renderTrend();
    }
  };
  await Promise.all([worker(), worker()]);
}

function renderRead() {
  const out = root.querySelector<HTMLElement>('[data-read-out]');
  if (!out) return;
  const r = state.read;
  out.hidden = r.status === 'idle';
  const lines = r.text.split('\n').map((l) => l.trim()).filter(Boolean);
  let html = '';
  let inList = false;
  for (const l of lines) {
    const bullet = /^[-•*]\s+/.test(l);
    if (bullet && !inList) html += '<ul>';
    if (!bullet && inList) html += '</ul>';
    inList = bullet;
    html += bullet ? `<li>${esc(l.replace(/^[-•*]\s+/, ''))}</li>` : `<p>${esc(l.replace(/^#+\s*/, '').replace(/\*\*/g, ''))}</p>`;
  }
  if (inList) html += '</ul>';
  if (r.status === 'working' && !r.text) html = '<p class="tn-wait">Claude is reading the calls…</p>';
  if (r.status === 'error') html += `<p class="tn-error">${esc(r.error)}</p>`;
  out.innerHTML = html + (r.status === 'done' ? '<p class="tn-small muted">Written by Claude from the scores above. Check it against the calls themselves.</p>' : '');
  const start = $<HTMLButtonElement>('[data-read-start]');
  start.disabled = r.status === 'working';
  start.textContent = r.status === 'done' ? 'Ask Claude again' : 'Ask Claude to read the trend';
  $('[data-read-stop]').hidden = r.status !== 'working';
  root.querySelector<HTMLElement>('[data-read]')!.hidden = !!state.claudeOff;
}

async function startRead() {
  state.read.controller?.abort();
  const controller = new AbortController();
  state.read = { text: '', status: 'working', error: '', controller };
  renderRead();
  try {
    await readTrend(
      state.items.map((i) => i.analysis),
      topics(),
      state.judgments,
      (text) => {
        if (state.read.controller !== controller) return;
        state.read.text = text;
        renderRead();
      },
      controller.signal,
    );
    if (state.read.controller === controller) state.read.status = 'done';
  } catch (err) {
    if (state.read.controller !== controller) return;
    const e = err instanceof ClaudeError ? err : new ClaudeError('error', 'Claude had a problem with this. Try again.');
    if (e.code === 'cancelled') state.read.status = state.read.text ? 'done' : 'idle';
    else {
      claudeFailed(e);
      state.read.status = 'error';
      state.read.error = e.message;
    }
  }
  renderRead();
}

// ---------------------------------------------------------------------------
// Rendering, saving, wiring
// ---------------------------------------------------------------------------

function render() {
  renderCallList();
  const has = state.items.length > 0;
  $('#tn-results').hidden = !has;
  if (!has) {
    state.charts.forEach((d) => d());
    state.charts = [];
    return;
  }
  if (state.selected < 0 || state.selected >= state.items.length) state.selected = state.items.length - 1;
  renderTrend();
  renderTopics();
  renderCall();
  renderRead();
}

function save() {
  try {
    if (!state.items.length) return sessionStorage.removeItem(SAVE_KEY);
    sessionStorage.setItem(
      SAVE_KEY,
      JSON.stringify({
        example: state.example,
        items: state.example ? [] : state.items.map((i) => ({ name: i.name, text: i.text, label: i.label })),
        custom: state.custom,
        judgments: [...state.judgments.entries()],
      }),
    );
  } catch {
    /* too large or storage blocked: fine */
  }
}

function readSaved(): { example: boolean; items: Array<{ name: string; text: string; label?: string }>; custom: Topic[]; judgments: [string, Judgment[]][] } | null {
  try {
    const raw = sessionStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function showContinue() {
  const saved = readSaved();
  const wrap = $('[data-continue-wrap]');
  wrap.hidden = !saved || (!saved.example && !saved.items.length) || state.items.length > 0;
  if (!wrap.hidden && saved) $('[data-continue-title]').textContent = saved.example ? 'the Corvane Systems example' : `${saved.items.length} ${saved.items.length === 1 ? 'call' : 'calls'}`;
}

function continueLast() {
  const saved = readSaved();
  if (!saved) return;
  clearAll();
  state.custom = saved.custom ?? [];
  if (saved.example) {
    for (const e of EXAMPLE) addText(e.text, e.name);
    state.example = true;
  } else for (const i of saved.items) addText(i.text, i.name, i.label);
  for (const [id, j] of saved.judgments ?? []) state.judgments.set(id, j);
  $('[data-continue-wrap]').hidden = true;
  afterAdding(true);
}

// Input
const fileInput = $<HTMLInputElement>('#tn-file');
const drop = $('#tn-drop');
fileInput.addEventListener('change', () => {
  const files = [...(fileInput.files ?? [])];
  fileInput.value = '';
  loadFiles(files);
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
  loadFiles([...((e as DragEvent).dataTransfer?.files ?? [])]);
});

const pasteForm = $<HTMLFormElement>('#tn-paste');
const pasteBox = $<HTMLTextAreaElement>('#tn-text');
pasteForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = pasteBox.value;
  if (!text.trim()) return say('Paste a transcript first.', 'error');
  if (state.example) clearAll();
  const n = state.items.filter((i) => i.name.startsWith('Pasted')).length + 1;
  const r = addText(text, `Pasted call ${n}`);
  if (r === 'short') return say('That’s too short to be a call transcript. Paste the whole call.', 'error');
  if (r === 'duplicate') return say('That call is already in the list.', 'error');
  pasteBox.value = '';
  $('[data-count]', pasteForm).textContent = '';
  say('');
  afterAdding(true);
});
pasteBox.addEventListener('input', () => {
  const n = pasteBox.value.trim() ? pasteBox.value.trim().split(/\s+/).length : 0;
  $('[data-count]', pasteForm).textContent = n ? words(n) : '';
});

// Editing a quarter's label
$('[data-call-list]').addEventListener('change', (e) => {
  const input = (e.target as HTMLElement).closest<HTMLInputElement>('input.tn-q');
  if (!input) return;
  const item = state.items.find((i) => i.call.id === input.dataset.id);
  if (!item) return;
  const id = state.items[state.selected]?.call.id;
  item.label = input.value;
  applyLabel(item.call, input.value);
  sortItems();
  state.selected = Math.max(0, state.items.findIndex((i) => i.call.id === id));
  render();
  save();
});

// Clicks anywhere in the tool
root.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const go = t.closest<HTMLElement>('[data-go]');
  if (go) return select(Number(go.dataset.go), go.classList.contains('tn-link'));
  if (t.closest('[data-example]')) return loadExample();
  if (t.closest('[data-continue]')) return continueLast();
  const rm = t.closest<HTMLElement>('[data-remove]');
  if (rm) {
    const id = state.items[state.selected]?.call.id;
    state.items = state.items.filter((i) => i.call.id !== rm.dataset.remove);
    state.judgments.delete(rm.dataset.remove!);
    if (!state.items.length) state.example = false;
    state.selected = Math.max(0, state.items.findIndex((i) => i.call.id === id));
    render();
    save();
    return;
  }
  if (t.closest('[data-clear]')) {
    clearAll();
    say('');
    render();
    save();
    return;
  }
  const rt = t.closest<HTMLElement>('[data-remove-topic]');
  if (rt) {
    state.custom = state.custom.filter((x) => x.id !== rt.dataset.removeTopic);
    tip.hidden = true;
    reanalyze();
    render();
    save();
    return;
  }
  const toggle = t.closest<HTMLElement>('[data-table-toggle]');
  if (toggle) {
    const table = $('[data-table]');
    table.hidden = !table.hidden;
    toggle.setAttribute('aria-expanded', String(!table.hidden));
    toggle.textContent = table.hidden ? 'Show the numbers' : 'Hide the numbers';
    if (!table.hidden) renderTable();
    return;
  }
  if (t.closest('[data-judge-one]')) {
    const id = state.items[state.selected]?.call.id;
    if (id) judge([id]);
    return;
  }
  if (t.closest('[data-judge-all]')) {
    const sel = state.items[state.selected]?.call.id;
    judge([sel, ...state.items.map((i) => i.call.id)].filter((x): x is string => !!x));
    return;
  }
  if (t.closest('[data-read-start]')) return void startRead();
  if (t.closest('[data-read-stop]')) state.read.controller?.abort();
});

$<HTMLInputElement>('#tn-all-answers').addEventListener('change', (e) => {
  state.allAnswers = (e.target as HTMLInputElement).checked;
  renderAnswers();
});

$('[data-transcript]').addEventListener('toggle', renderTranscript);
root.querySelectorAll<HTMLInputElement>('[data-mark]').forEach((box) =>
  box.addEventListener('change', () => $('[data-turns]').classList.toggle(`hide-${box.dataset.mark}`, !box.checked)),
);
$('[data-turns]').classList.add('hide-strong');

// Custom topics
$<HTMLFormElement>('#tn-add-topic').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $<HTMLInputElement>('#tn-topic-name').value.trim().slice(0, 40);
  const terms = $<HTMLInputElement>('#tn-topic-terms')
    .value.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 30);
  if (!name || !terms.length) return;
  state.custom.push({ id: `custom-${Date.now().toString(36)}`, name, terms, custom: true });
  $<HTMLInputElement>('#tn-topic-name').value = '';
  $<HTMLInputElement>('#tn-topic-terms').value = '';
  reanalyze();
  render();
  save();
});

window.addEventListener('scroll', () => (tip.hidden = true), { passive: true });

// Start
showContinue();
render();
if (onClaude) {
  claude().then((sample) => {
    const off = root.querySelector<HTMLElement>('[data-claude-off]');
    if (!sample) {
      state.claudeOff = 'unavailable';
      if (off) off.hidden = false;
      renderJudgeControls();
      if (state.items.length) renderRead();
    }
  });
}
