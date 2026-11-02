// Strata: the page's behavior.
//
// The reader shows a document at one of five levels (see segment.ts). The
// whole document moves between levels with the zoom control, a pinch, Ctrl +
// scroll, or the + and − keys. Each passage can also be zoomed on its own by
// clicking it (Shift-click to zoom out) or with the + and − beside it.
//
// AI-written levels are only requested for what is on screen, a moment after
// zooming stops, and each answer is kept so zooming back costs nothing.

import { AiError, claudeSample, PROVIDERS, runTask, type Route } from './ai';
import { mdToHtml, plainToHtml } from './markdown';
import { parseSummary, type Task, type TaskInput } from './prompts';
import { blocksFromText, buildDoc, countWords, MAX_WORDS, type Doc, type Section } from './segment';
import { loadKey, openKeyDialog } from './settings';
import { EXAMPLE } from './example';

type Level = -2 | -1 | 0 | 1 | 2;
type PassageLevel = -1 | 0 | 1 | 2;
type Status = 'working' | 'done' | 'error';

interface Entry {
  status: Status;
  text: string;
  error?: AiError;
  progress?: string;
}

interface RowSpec {
  id: string; // stable per unit, e.g. "p:4"
  kind: 'gist' | 'summary' | 'heading' | 'passage';
  level: number;
  entry?: string; // cache key of the AI text this row shows
  section?: Section;
  passage?: number;
  from: number;
  to: number;
}

const LABEL: Record<string, string> = { '-2': 'Gist', '-1': 'Summary', '0': 'Original', '1': 'Explained', '2': 'First principles' };
const PASSAGE_LABEL: Record<string, string> = { '-1': 'In short', '0': 'Original', '1': 'Explained', '2': 'First principles' };
const TASK_FOR: Record<string, Task> = { '-1': 'short', '1': 'explain', '2': 'basics' };
const GIST_FROM_SUMMARIES_ABOVE = 6_000; // words
const SAVE_KEY = 'strata:last';

const root = document.getElementById('zr')!;
const config = {
  server: root.dataset.server ?? '',
  model: root.dataset.model ?? 'an open AI model',
  // True in the copy of Strata hosted on claude.ai (see scripts/build-claude-copy.mjs).
  onClaude: root.dataset.target === 'claude',
  // On the site: the address of that copy, offered as "Open in Claude".
  claudeUrl: root.dataset.claude ?? '',
};
const $ = <T extends HTMLElement = HTMLElement>(sel: string, el: ParentNode = root) => el.querySelector<T>(sel)!;

const view = {
  input: $('#zr-input'),
  reader: $('#zr-reader'),
  rows: $('#zr-rows'),
  toolbar: $('.zr-toolbar'),
  title: $('[data-doc-title]'),
  mode: $('[data-mode]'),
  status: $('#zr-status'),
  notice: $('#zr-notice'),
  dialog: document.getElementById('zr-key-dialog') as HTMLDialogElement | null, // not on claude.ai
  scale: $('.zr-scale'),
};

const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;

const state = {
  doc: null as Doc | null,
  global: 0 as Level,
  sectionOpen: new Map<number, boolean>(),
  passageLevel: new Map<number, PassageLevel>(),
  cache: new Map<string, Entry>(),
  promises: new Map<string, Promise<void>>(),
  useKey: false,
  blocked: null as null | 'allowance' | 'visitor-limit',
  controller: new AbortController(),
  settled: true,
  rendered: new Map<string, string>(), // row id → level shown, to animate only what changed
};

// ---------------------------------------------------------------------------
// Routes: the free Worker or the visitor's own key
// ---------------------------------------------------------------------------

function route(): Route {
  if (config.onClaude) return { mode: 'claude' };
  const key = loadKey();
  if (key && (state.useKey || !config.server || state.blocked)) {
    return { mode: 'key', provider: key.provider, key: key.key, model: key.model };
  }
  return { mode: 'free', server: config.server };
}

function updateModeLabel() {
  if (!state.doc) return;
  if (state.doc.source === 'example') {
    view.mode.textContent = 'Example: every level written in advance';
    return;
  }
  const r = route();
  if (r.mode === 'claude') {
    view.mode.textContent = 'Claude · on your own Claude plan';
  } else if (r.mode === 'key') {
    view.mode.textContent = `Using your ${PROVIDERS[r.provider!].name.replace(/ \(.*\)/, '')} key`;
  } else if (!config.server) {
    view.mode.textContent = 'Free explanations aren’t switched on yet';
  } else {
    view.mode.textContent = `Free · ${config.model} on Cloudflare`;
  }
}

// ---------------------------------------------------------------------------
// Turning cache keys into AI tasks
// ---------------------------------------------------------------------------

const passageKey = (idx: number, level: number) => `p:${idx}:${level}`;
const summaryKey = (s: number) => `sum:${s}`;

function sectionOf(idx: number): Section {
  return state.doc!.sections.find((s) => s.passages.some((p) => p.idx === idx))!;
}

function inputFor(key: string): TaskInput {
  const doc = state.doc!;
  const title = doc.title === 'Untitled document' ? undefined : doc.title;
  if (key === 'gist') {
    if (doc.words > GIST_FROM_SUMMARIES_ABOVE) {
      const text = doc.sections
        .map((s, i) => {
          const { title: t, body } = parseSummary(state.cache.get(summaryKey(i))?.text ?? '');
          return `${i + 1}. ${s.heading ?? t}: ${body}`;
        })
        .join('\n');
      return { task: 'gist', text, title, fromSummaries: true };
    }
    return { task: 'gist', text: doc.passages.map((p) => p.text).join('\n\n'), title };
  }
  if (key.startsWith('sum:')) {
    const s = doc.sections[Number(key.slice(4))];
    return { task: 'summary', text: s.passages.map((p) => p.text).join('\n\n').slice(0, 16_000), title, heading: s.heading };
  }
  const [, idxStr, levelStr] = key.split(':');
  const idx = Number(idxStr);
  const passage = doc.passages[idx];
  const prev = doc.passages[idx - 1];
  return {
    task: TASK_FOR[levelStr],
    text: passage.text,
    title,
    heading: sectionOf(idx).heading,
    before: prev ? prev.text.slice(-600) : undefined,
  };
}

// A small queue so only a few requests run at once.
let running = 0;
const waiting: Array<() => void> = [];
const slot = () =>
  new Promise<void>((resolve) => {
    const limit = route().mode === 'key' ? 3 : 2;
    if (running < limit) {
      running++;
      resolve();
    } else waiting.push(() => (running++, resolve()));
  });
const release = () => {
  running = Math.max(0, running - 1);
  waiting.shift()?.();
};

function setEntry(key: string, entry: Entry) {
  state.cache.set(key, entry);
  patchRows(key);
}

function ensure(key: string): Promise<void> {
  const have = state.cache.get(key);
  if (have?.status === 'done') return Promise.resolve();
  const pending = state.promises.get(key);
  if (pending) return pending;

  const doc = state.doc;
  const signal = state.controller.signal;
  const current = () => state.doc === doc && !signal.aborted;
  const set = (entry: Entry) => current() && setEntry(key, entry);

  // eslint-disable-next-line prefer-const
  let p!: Promise<void>;
  p = (async () => {
    await Promise.resolve(); // let `p` be stored before anything below runs
    set({ status: 'working', text: '' });
    try {
      if (state.blocked && route().mode === 'free') throw new AiError(state.blocked, '');
      if (key === 'gist' && doc!.words > GIST_FROM_SUMMARIES_ABOVE) {
        const n = doc!.sections.length;
        let done = 0;
        const progress = () => set({ status: 'working', text: '', progress: `Reading the document: ${done} of ${n} parts…` });
        progress();
        await Promise.all(
          doc!.sections.map((_, i) =>
            ensure(summaryKey(i)).then(() => {
              const e = state.cache.get(summaryKey(i));
              if (e?.status === 'error') throw e.error;
              done++;
              progress();
            }),
          ),
        );
      }
      await slot();
      try {
        if (!current()) throw new AiError('aborted', 'Stopped.');
        let last = 0;
        const text = await runTask(
          route(),
          inputFor(key),
          (sofar) => {
            const now = performance.now();
            if (now - last < 60) return;
            last = now;
            set({ status: 'working', text: sofar });
          },
          signal,
        );
        set({ status: 'done', text });
        scheduleSave();
      } finally {
        release();
      }
    } catch (err) {
      if (!current()) return;
      const error = err instanceof AiError ? err : new AiError('busy', 'Something went wrong.');
      if (error.code === 'aborted') {
        state.cache.delete(key);
        return;
      }
      if ((error.code === 'allowance' || error.code === 'visitor-limit') && route().mode === 'free') {
        state.blocked = error.code;
        if (loadKey()) {
          // A key is already saved: switch to it and carry on.
          if (state.promises.get(key) === p) state.promises.delete(key);
          state.cache.delete(key);
          updateModeLabel();
          return ensure(key);
        }
        block(error.code);
      }
      set({ status: 'error', text: '', error });
    } finally {
      if (state.promises.get(key) === p) state.promises.delete(key);
    }
  })();
  state.promises.set(key, p);
  return p;
}

function retryFailed(codes?: string[]) {
  for (const [key, entry] of state.cache) {
    if (entry.status === 'error' && (!codes || codes.includes(entry.error!.code))) state.cache.delete(key);
  }
  render();
}

// ---------------------------------------------------------------------------
// The allowance notice
// ---------------------------------------------------------------------------

function resetTime(): string {
  const next = new Date();
  next.setUTCHours(24, 0, 0, 0);
  return next.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function block(code: 'allowance' | 'visitor-limit') {
  state.blocked = code;
  const text =
    code === 'allowance'
      ? `Today’s free allowance is used up. It resets at ${resetTime()} your time.`
      : `You’ve used your share of today’s free allowance, so other visitors get a turn. It resets at ${resetTime()} your time.`;
  $('[data-notice-text]', view.notice).textContent = config.claudeUrl
    ? `${text} To keep going now, open Strata in Claude, which runs on your own Claude plan, or use your own API key.`
    : `${text} To keep going now, use your own API key.`;
  view.notice.hidden = false;
}

async function askForKey(reason?: string) {
  if (!view.dialog) return;
  const saved = await openKeyDialog(view.dialog, reason);
  if (!saved) return;
  state.useKey = true;
  view.notice.hidden = true;
  updateModeLabel();
  retryFailed(['allowance', 'visitor-limit', 'no-route', 'auth', 'quota', 'busy', 'bad-request']);
}

// ---------------------------------------------------------------------------
// Which rows to show
// ---------------------------------------------------------------------------

function isOpen(s: number): boolean {
  return state.sectionOpen.get(s) ?? state.global >= 0;
}

function passageLevel(idx: number): PassageLevel {
  return state.passageLevel.get(idx) ?? (Math.max(0, state.global) as PassageLevel);
}

function rowSpecs(): RowSpec[] {
  const doc = state.doc!;
  const last = doc.passages.length - 1;
  if (state.global === -2) return [{ id: 'gist', kind: 'gist', level: -2, entry: 'gist', from: 0, to: last }];
  const out: RowSpec[] = [];
  for (const s of doc.sections) {
    const from = s.passages[0].idx;
    const to = s.passages[s.passages.length - 1].idx;
    if (!isOpen(s.idx)) {
      out.push({ id: `s:${s.idx}`, kind: 'summary', level: -1, entry: summaryKey(s.idx), section: s, from, to });
      continue;
    }
    // A heading row: the document's own heading, or (when one part is opened
    // from the summary view) the part's summary title, so it can be folded back.
    if (s.heading || state.global < 0) out.push({ id: `h:${s.idx}`, kind: 'heading', level: 0, section: s, from, to: from });
    for (const p of s.passages) {
      const level = passageLevel(p.idx);
      out.push({
        id: `p:${p.idx}`,
        kind: 'passage',
        level,
        entry: level === 0 ? undefined : passageKey(p.idx, level),
        section: s,
        passage: p.idx,
        from: p.idx,
        to: p.idx,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drawing rows
// ---------------------------------------------------------------------------

const specs = new Map<HTMLElement, RowSpec>();

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function where(spec: RowSpec): string {
  const n = state.doc!.passages.length;
  const sections = state.doc!.sections.length;
  if (spec.kind === 'gist') return `Whole document · ${n} ${n === 1 ? 'passage' : 'passages'}`;
  if (spec.kind === 'summary' || spec.kind === 'heading') {
    const ps = spec.section!.passages;
    const a = ps[0].idx + 1;
    const b = ps[ps.length - 1].idx + 1;
    const range = a === b ? `¶ ${a}` : `¶ ${a}–${b}`;
    return spec.kind === 'heading' ? '' : `Part ${spec.section!.idx + 1} of ${sections} · ${range}`;
  }
  return `¶ ${spec.from + 1} of ${n}`;
}

function canStep(spec: RowSpec, dir: 1 | -1): boolean {
  if (spec.kind === 'gist') return dir > 0;
  if (spec.kind === 'summary') return dir > 0;
  if (spec.kind === 'heading') return dir < 0 || spec.section!.passages.some((p) => passageLevel(p.idx) < 2);
  return dir > 0 ? spec.level < 2 : true;
}

function stepLabel(spec: RowSpec, dir: 1 | -1): string {
  const what =
    spec.kind === 'gist' ? 'the gist' : spec.kind === 'passage' ? `paragraph ${spec.from + 1}` : `part ${spec.section!.idx + 1}`;
  return `${dir > 0 ? 'Zoom in on' : 'Zoom out of'} ${what}`;
}

function marginHtml(spec: RowSpec): string {
  const tag =
    spec.kind === 'heading'
      ? `Part ${spec.section!.idx + 1} of ${state.doc!.sections.length}`
      : spec.kind === 'passage'
        ? PASSAGE_LABEL[String(spec.level)]
        : LABEL[String(spec.level)];
  const btn = (dir: 1 | -1) =>
    `<button type="button" class="zr-step" data-step="${dir}" aria-label="${stepLabel(spec, dir)}"${
      canStep(spec, dir) ? '' : ' disabled'
    }>${dir > 0 ? '+' : '−'}</button>`;
  return `<div class="zr-margin">
    <div class="zr-where">${tag ? `<span class="zr-tag">${tag}</span>` : ''}${where(spec) ? `<span class="zr-loc">${where(spec)}</span>` : ''}</div>
    <div class="zr-steps">${btn(-1)}${btn(1)}</div>
  </div>`;
}

function sourceText(spec: RowSpec): string {
  const doc = state.doc!;
  if (spec.kind === 'gist') return doc.passages.slice(0, 2).map((p) => p.text).join('\n\n');
  if (spec.kind === 'summary') return spec.section!.passages[0].text;
  return doc.passages[spec.passage!].text;
}

function waitingHtml(spec: RowSpec, entry?: Entry): string {
  const label =
    entry?.progress ??
    (spec.kind === 'gist'
      ? 'Writing the gist…'
      : spec.kind === 'summary'
        ? 'Summarizing this part…'
        : spec.level === -1
          ? 'Shortening…'
          : 'Writing the explanation…');
  const ghost = sourceText(spec);
  return `<p class="zr-wait"><span class="zr-pulse" aria-hidden="true"></span>${esc(label)}</p>
    <div class="zr-ghost" aria-hidden="true">${plainToHtml(ghost.length > 700 ? ghost.slice(0, 700) + '…' : ghost)}</div>`;
}

const openInClaude = () =>
  config.claudeUrl ? ` <a class="zr-link" href="${esc(config.claudeUrl)}" target="_blank" rel="noopener">Open in Claude ↗</a>` : '';

function errorHtml(entry: Entry): string {
  const e = entry.error!;
  let msg = e.message || 'Something went wrong.';
  let action = `<button type="button" class="zr-link" data-retry>Try again</button>`;
  if (route().mode === 'claude') {
    // Signing in again or allowing the page both need a reload, so a retry
    // button would only fail again.
    if (['not-allowed', 'no-route', 'auth'].includes(e.code)) action = '';
    return `<p class="zr-error">${esc(msg)}</p>${action ? `<p class="zr-actions">${action}</p>` : ''}`;
  }
  if (e.code === 'allowance' || e.code === 'visitor-limit') {
    msg = e.code === 'allowance' ? 'Paused: today’s free allowance is used up.' : 'Paused: you’ve used your share of today’s free allowance.';
    action = `<button type="button" class="zr-link" data-key>Use my own API key</button>${openInClaude()}`;
  } else if (e.code === 'no-route') {
    msg = config.server
      ? 'Add your API key to write this level.'
      : 'Free explanations aren’t switched on yet. You can use your own API key, or try the example.';
    action = `<button type="button" class="zr-link" data-key>Use my own API key</button>`;
  } else if (e.code === 'auth' || e.code === 'quota' || e.code === 'bad-request') {
    action = `<button type="button" class="zr-link" data-key>Check your key</button> <button type="button" class="zr-link" data-retry>Try again</button>`;
  } else if (e.code === 'slow-down') {
    msg = 'Lots of requests at once. Give it a few seconds.';
  }
  return `<p class="zr-error">${esc(msg)}</p><p class="zr-actions">${action}</p>`;
}

function bodyHtml(spec: RowSpec): string {
  const doc = state.doc!;
  if (spec.kind === 'heading') {
    const s = spec.section!;
    if (s.heading) return `<h2 class="zr-h">${esc(s.heading)}</h2>`;
    const title = parseSummary(state.cache.get(summaryKey(s.idx))?.text ?? '').title || `Part ${s.idx + 1}`;
    return `<h2 class="zr-h zr-h--part">${esc(title)}</h2>`;
  }
  if (spec.kind === 'passage' && spec.level === 0) return `<div class="zr-prose">${plainToHtml(doc.passages[spec.passage!].text)}</div>`;

  const entry = state.cache.get(spec.entry!);
  if (!entry || (entry.status === 'working' && !entry.text)) return waitingHtml(spec, entry);
  if (entry.status === 'error') return errorHtml(entry);
  const writing = entry.status === 'working' ? ' zr-writing' : '';

  if (spec.kind === 'summary') {
    const { title, body } = parseSummary(entry.text);
    const heading = spec.section!.heading || title;
    return `${heading ? `<h3 class="zr-sum-title">${esc(heading)}</h3>` : ''}<div class="zr-prose${writing}">${mdToHtml(body)}</div>`;
  }
  if (spec.kind === 'gist') return `<div class="zr-prose zr-gist${writing}">${mdToHtml(entry.text)}</div>`;
  return `<div class="zr-prose${writing}">${mdToHtml(entry.text)}</div>`;
}

function rowElement(spec: RowSpec): HTMLElement {
  const el = document.createElement('div');
  el.className = `zr-row zr-row--${spec.kind} zr-level-${spec.level < 0 ? 'm' : ''}${Math.abs(spec.level)}`;
  el.dataset.id = spec.id;
  el.dataset.from = String(spec.from);
  el.dataset.to = String(spec.to);
  if (spec.entry) el.dataset.entry = spec.entry;
  el.innerHTML = `${marginHtml(spec)}<div class="zr-body" data-body>${bodyHtml(spec)}</div>`;
  specs.set(el, spec);
  const zoomable = spec.kind !== 'heading' && canStep(spec, 1);
  el.classList.toggle('zr-zoomable', zoomable);
  return el;
}

function patchRows(key: string) {
  view.rows.querySelectorAll<HTMLElement>(`[data-entry="${key}"]`).forEach((el) => {
    const spec = specs.get(el);
    if (spec) $('[data-body]', el).innerHTML = bodyHtml(spec);
  });
  updateBusy();
}

function updateBusy() {
  const busy = [...state.cache.values()].some((e) => e.status === 'working');
  view.rows.setAttribute('aria-busy', String(busy));
}

// Only ask for AI text once a row is near the screen and zooming has paused.
const observer = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting || !state.settled) continue;
      const key = (e.target as HTMLElement).dataset.entry;
      if (key && state.cache.get(key)?.status !== 'error') ensure(key);
    }
  },
  { rootMargin: '600px 0px' },
);

let settleTimer = 0;
function settleSoon() {
  state.settled = false;
  clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => {
    state.settled = true;
    observer.disconnect();
    view.rows.querySelectorAll<HTMLElement>('[data-entry]').forEach((el) => observer.observe(el));
  }, 350);
}

type Anchor = { from: number; top: number };

function anchorAt(y: number): Anchor | null {
  const rows = [...view.rows.querySelectorAll<HTMLElement>('.zr-row')];
  for (const el of rows) {
    const r = el.getBoundingClientRect();
    if (r.bottom >= y) {
      const from = Number(el.dataset.from);
      const to = Number(el.dataset.to);
      const k = r.height > 0 ? Math.max(0, Math.min(1, (y - r.top) / r.height)) : 0;
      return { from: Math.round(from + (to - from) * k), top: Math.max(r.top, toolbarBottom() + 8) };
    }
  }
  return null;
}

function toolbarBottom(): number {
  return Math.max(0, view.toolbar.getBoundingClientRect().bottom);
}

function restore(anchor: Anchor | null) {
  if (!anchor) return;
  const rows = [...view.rows.querySelectorAll<HTMLElement>('.zr-row')];
  const el = rows.find((r) => Number(r.dataset.from) <= anchor.from && anchor.from <= Number(r.dataset.to)) ?? rows[0];
  if (!el) return;
  const dy = el.getBoundingClientRect().top - anchor.top;
  if (Math.abs(dy) > 1) window.scrollBy({ top: dy, behavior: 'instant' as ScrollBehavior });
}

function render(opts: { anchor?: Anchor | null; direction?: 1 | -1 } = {}) {
  if (!state.doc) return;
  const anchor = opts.anchor === undefined ? anchorAt(toolbarBottom() + 40) : opts.anchor;
  const list = rowSpecs();
  const frag = document.createDocumentFragment();
  const before = state.rendered;
  state.rendered = new Map();
  specs.clear();
  for (const spec of list) {
    const el = rowElement(spec);
    const sig = `${spec.kind}:${spec.level}`;
    if (opts.direction && !reduceMotion && before.get(spec.id) !== sig) {
      el.classList.add(opts.direction > 0 ? 'zr-enter-in' : 'zr-enter-out');
    }
    state.rendered.set(spec.id, sig);
    frag.append(el);
  }
  view.rows.replaceChildren(frag);
  restore(anchor);
  updateScale();
  updateBusy();
  settleSoon();
}

function updateScale() {
  view.scale.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((b) => {
    const on = Number(b.dataset.level) === state.global;
    b.setAttribute('aria-pressed', String(on));
  });
  $('[data-zoom="out"]', view.toolbar).toggleAttribute('disabled', state.global <= -2);
  $('[data-zoom="in"]', view.toolbar).toggleAttribute('disabled', state.global >= 2);
  $('[data-level-now]', view.toolbar).textContent = LABEL[String(state.global)];
}

// ---------------------------------------------------------------------------
// Zooming
// ---------------------------------------------------------------------------

function setGlobal(level: number, focalY?: number) {
  const next = Math.max(-2, Math.min(2, level)) as Level;
  const hadOverrides = state.sectionOpen.size > 0 || state.passageLevel.size > 0;
  if (next === state.global && !hadOverrides) return;
  const anchor = anchorAt(focalY ?? toolbarBottom() + 24);
  const direction = next >= state.global ? 1 : -1;
  state.global = next;
  state.sectionOpen.clear();
  state.passageLevel.clear();
  render({ anchor, direction });
  scheduleSave();
}

function localStep(el: HTMLElement, dir: 1 | -1) {
  const spec = specs.get(el);
  if (!spec || !canStep(spec, dir)) return;
  const anchor = { from: spec.from, top: Math.max(el.getBoundingClientRect().top, toolbarBottom() + 8) };
  if (spec.kind === 'gist') return setGlobal(-1, el.getBoundingClientRect().top + 10);
  const s = spec.section!;
  if (spec.kind === 'summary') {
    state.sectionOpen.set(s.idx, true);
    s.passages.forEach((p) => state.passageLevel.delete(p.idx));
  } else if (spec.kind === 'heading') {
    if (dir < 0) state.sectionOpen.set(s.idx, false);
    else s.passages.forEach((p) => state.passageLevel.set(p.idx, Math.min(2, passageLevel(p.idx) + 1) as PassageLevel));
  } else {
    const next = spec.level + dir;
    if (next < -1) {
      state.sectionOpen.set(s.idx, false);
      anchor.from = s.passages[0].idx;
    } else state.passageLevel.set(spec.passage!, next as PassageLevel);
  }
  render({ anchor, direction: dir });
}

// Toolbar
view.toolbar.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!t) return;
  if (t.dataset.zoom) setGlobal(state.global + (t.dataset.zoom === 'in' ? 1 : -1));
  else if (t.dataset.level) setGlobal(Number(t.dataset.level));
  else if (t.hasAttribute('data-new')) showInput();
  else if (t.hasAttribute('data-settings')) askForKey();
});

// Rows: + and − in the margin, click to zoom in, Shift- or Alt-click to zoom out
view.rows.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const row = target.closest<HTMLElement>('.zr-row');
  if (!row) return;
  const step = target.closest<HTMLElement>('[data-step]');
  if (step) return localStep(row, Number(step.dataset.step) as 1 | -1);
  if (target.closest('[data-retry]')) {
    const key = row.dataset.entry!;
    state.cache.delete(key);
    return void ensure(key);
  }
  if (target.closest('[data-key]')) return void askForKey();
  if (target.closest('a, button')) return;
  if (window.getSelection()?.toString().trim()) return; // selecting text, not zooming
  if (!target.closest('[data-body]')) return;
  localStep(row, e.shiftKey || e.altKey ? -1 : 1);
});

// Keyboard: + / − anywhere on the page (not while typing)
document.addEventListener('keydown', (e) => {
  if (view.reader.hidden || e.ctrlKey || e.metaKey || view.dialog?.open) return;
  const t = e.target as HTMLElement;
  if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (e.key === '+' || e.key === '=') {
    e.preventDefault();
    setGlobal(state.global + 1);
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault();
    setGlobal(state.global - 1);
  }
});

// Trackpad pinch (arrives as Ctrl + wheel) and Ctrl + mouse wheel
let wheelAcc = 0;
let wheelLock = 0;
let wheelIdle = 0;
window.addEventListener(
  'wheel',
  (e) => {
    if (view.reader.hidden || !e.ctrlKey) return;
    e.preventDefault();
    const now = performance.now();
    clearTimeout(wheelIdle);
    wheelIdle = window.setTimeout(() => (wheelAcc = 0), 220);
    if (now < wheelLock) return;
    wheelAcc += -e.deltaY * (e.deltaMode === 1 ? 16 : 1);
    if (Math.abs(wheelAcc) >= 45) {
      setGlobal(state.global + (wheelAcc > 0 ? 1 : -1), e.clientY);
      wheelAcc = 0;
      wheelLock = now + 450;
    }
  },
  { passive: false },
);

// Safari's own pinch events (desktop and iPhone)
let gestureBase = 1;
const onGesture = (e: Event & { scale?: number; clientY?: number }) => {
  if (view.reader.hidden) return;
  e.preventDefault();
  if (e.type === 'gesturestart') gestureBase = 1;
  if (e.type !== 'gesturechange' || !e.scale) return;
  const ratio = e.scale / gestureBase;
  if (ratio > 1.3 || ratio < 0.77) {
    setGlobal(state.global + (ratio > 1 ? 1 : -1), e.clientY);
    gestureBase = e.scale;
  }
};
['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, onGesture as EventListener, { passive: false }));

// Two-finger pinch on touch screens
let pinchStart = 0;
let pinchY = 0;
const touchDistance = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
view.reader.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length === 2) {
      pinchStart = touchDistance(e.touches);
      pinchY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    }
  },
  { passive: true },
);
view.reader.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length !== 2 || !pinchStart) return;
    e.preventDefault();
    const ratio = touchDistance(e.touches) / pinchStart;
    if (ratio > 1.35 || ratio < 0.74) {
      setGlobal(state.global + (ratio > 1 ? 1 : -1), pinchY);
      pinchStart = touchDistance(e.touches);
    }
  },
  { passive: false },
);
view.reader.addEventListener('touchend', (e) => e.touches.length < 2 && (pinchStart = 0), { passive: true });

// ---------------------------------------------------------------------------
// Loading documents
// ---------------------------------------------------------------------------

function say(message: string, kind: 'info' | 'error' = 'info') {
  view.status.textContent = message;
  view.status.dataset.kind = kind;
  view.status.hidden = !message;
}

function openDoc(doc: Doc, restoreState?: { global: Level; cache: [string, Entry][] }) {
  state.controller.abort();
  state.controller = new AbortController();
  state.promises.clear();
  waiting.length = 0;
  running = 0;
  state.doc = doc;
  state.cache = new Map(restoreState?.cache ?? []);
  state.global = restoreState?.global ?? 0;
  state.sectionOpen.clear();
  state.passageLevel.clear();
  state.rendered = new Map();
  view.title.textContent = doc.title;
  view.notice.hidden = !state.blocked || doc.source === 'example' || !!loadKey();
  updateModeLabel();
  view.input.hidden = true;
  view.reader.hidden = false;
  say('');
  render({ anchor: null });
  view.reader.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  scheduleSave();
}

function showInput() {
  view.reader.hidden = true;
  view.input.hidden = false;
  view.notice.hidden = true;
  showContinue();
  view.input.scrollIntoView({ block: 'start' });
}

function checkSize(doc: Doc): string | null {
  if (doc.words < 20) return 'That’s too short to zoom. Paste at least a paragraph.';
  if (doc.words > MAX_WORDS) return `That’s about ${doc.words.toLocaleString()} words. Strata handles up to ${MAX_WORDS.toLocaleString()} words (roughly 80 pages), so try a part of it.`;
  return null;
}

function loadText(text: string) {
  const doc = buildDoc(blocksFromText(text), { source: 'paste' });
  const problem = checkSize(doc);
  if (problem) return say(problem, 'error');
  openDoc(doc);
}

async function loadPdf(file: File) {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return say('That isn’t a PDF. Choose a .pdf file, or paste the text instead.', 'error');
  if (file.size > 50 * 1024 * 1024) return say('That PDF is over 50 MB. Try a smaller file, or paste the part you want.', 'error');
  say(`Opening ${file.name}…`);
  try {
    const { pdfToBlocks } = await import('./pdf');
    const { blocks, title } = await pdfToBlocks(file, (p, n) => say(`Reading page ${p} of ${n}…`));
    const doc = buildDoc(blocks, { title, source: 'pdf' });
    const problem = checkSize(doc);
    if (problem) return say(problem, 'error');
    openDoc(doc);
  } catch (err) {
    say((err as Error).message || 'This PDF couldn’t be read. Try pasting the text instead.', 'error');
  }
}

function loadExample() {
  const sections: Section[] = [];
  let idx = 0;
  EXAMPLE.sections.forEach((s, si) => {
    const passages = s.passages.map((p) => ({ idx: idx++, text: p.original, words: countWords(p.original) }));
    sections.push({ idx: si, passages, words: passages.reduce((m, p) => m + p.words, 0) });
  });
  const passages = sections.flatMap((s) => s.passages);
  const doc: Doc = { title: EXAMPLE.title, source: 'example', sections, passages, words: passages.reduce((m, p) => m + p.words, 0) };
  const cache: [string, Entry][] = [['gist', { status: 'done', text: EXAMPLE.gist }]];
  let i = 0;
  EXAMPLE.sections.forEach((s, si) => {
    cache.push([summaryKey(si), { status: 'done', text: `${s.title}\n\n${s.summary}` }]);
    s.passages.forEach((p) => {
      cache.push([passageKey(i, -1), { status: 'done', text: p.short }]);
      cache.push([passageKey(i, 1), { status: 'done', text: p.explained }]);
      cache.push([passageKey(i, 2), { status: 'done', text: p.basics }]);
      i++;
    });
  });
  openDoc(doc, { global: 0, cache });
}

// Input view wiring
const fileInput = $<HTMLInputElement>('#zr-file');
const drop = $('#zr-drop');
const pasteForm = $<HTMLFormElement>('#zr-paste');
const pasteBox = $<HTMLTextAreaElement>('#zr-text');

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) loadPdf(f);
  fileInput.value = '';
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
  const f = (e as DragEvent).dataTransfer?.files?.[0];
  if (f) loadPdf(f);
});
pasteForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = pasteBox.value;
  if (!text.trim()) return say('Paste some text first.', 'error');
  loadText(text);
});
pasteBox.addEventListener('input', () => {
  const n = countWords(pasteBox.value);
  $('[data-count]', pasteForm).textContent = n ? `${n.toLocaleString()} ${n === 1 ? 'word' : 'words'}` : '';
});
root.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('[data-example]')) loadExample();
  else if (t.closest('[data-continue]')) continueLast();
  else if (t.closest('[data-notice-key]')) askForKey();
  else if (t.closest('[data-notice-close]')) view.notice.hidden = true;
  else if (t.closest('[data-input-settings]')) askForKey();
  else if (t.closest('[data-zoom-top]')) view.reader.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
});

// Keep the sticky margin labels just below the toolbar, whatever its height.
new ResizeObserver(() => root.style.setProperty('--zr-tb-h', `${view.toolbar.offsetHeight}px`)).observe(view.toolbar);

// ---------------------------------------------------------------------------
// Picking up where the visitor left off (this tab only)
// ---------------------------------------------------------------------------

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    if (!state.doc) return;
    try {
      const cache = [...state.cache].filter(([, e]) => e.status === 'done');
      sessionStorage.setItem(SAVE_KEY, JSON.stringify({ doc: state.doc, global: state.global, cache }));
    } catch {
      /* too large or storage blocked: fine */
    }
  }, 800);
}

function readSaved(): { doc: Doc; global: Level; cache: [string, Entry][] } | null {
  try {
    const raw = sessionStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function showContinue() {
  const saved = readSaved();
  const el = $('[data-continue-wrap]');
  el.hidden = !saved;
  if (saved) $('[data-continue-title]').textContent = saved.doc.title;
}

function continueLast() {
  const saved = readSaved();
  if (saved) openDoc(saved.doc, { global: saved.global, cache: saved.cache });
}

// Start
$('[data-hint]').textContent = coarse
  ? 'Pinch to zoom everything. Tap a passage to zoom into it.'
  : 'Pinch, Ctrl + scroll or press + and − to zoom the whole document. Click a passage to zoom into just that part, Shift-click to zoom out.';
showContinue();

// On claude.ai, say plainly when Claude can't write here (signed out, or the
// page was opened outside Claude). The example still works.
if (config.onClaude) {
  claudeSample().then((sample) => {
    const off = root.querySelector<HTMLElement>('[data-claude-off]');
    if (off) off.hidden = !!sample;
  });
}
