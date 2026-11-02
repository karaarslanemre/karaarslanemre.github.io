// Small line charts across quarters, drawn as SVG in the site's own style:
// hairline grid, 2px lines, round nodes with a ring in the page colour, the
// latest value labelled at the end of each line, and a crosshair with a
// tooltip that lists every series at the quarter under the pointer. Clicking
// (or Enter) picks that quarter for the detail section below.

const NS = 'http://www.w3.org/2000/svg';

export interface Series {
  name: string;
  color: string; // a CSS colour, usually var(--tn-…)
  values: Array<number | null>;
}

export interface ChartOptions {
  labels: string[];
  series: Series[];
  fmt: (v: number) => string;
  /** Keep 0 on the scale (for tone, which can go negative). */
  zero?: boolean;
  /** Smallest top of the scale, so a flat line doesn't fill the chart. */
  minTop?: number;
  selected: number;
  onSelect: (i: number) => void;
  label: string; // for screen readers
}

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number> = {}, parent?: Element) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.append(node);
  return node;
}

function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target);
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

function scale(values: number[], zero: boolean, minTop = 0) {
  let lo = Math.min(...values);
  let hi = Math.max(...values, minTop);
  if (zero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (lo === hi) {
    hi += 1;
    lo -= zero && lo >= 0 ? 0 : 1;
  }
  const step = niceStep(hi - lo, 3);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
  return { lo, hi, ticks };
}

/** "Q3 FY25" → ["Q3", "FY25"]; anything else stays whole. */
function splitLabel(label: string): [string, string] {
  const m = label.match(/^(Q[1-4])\s+(.+)$/);
  return m ? [m[1], m[2]] : [label, ''];
}

export function lineChart(host: HTMLElement, opts: ChartOptions): () => void {
  const tip = document.createElement('div');
  tip.className = 'tn-tip';
  tip.hidden = true;
  host.style.position = 'relative';

  const draw = () => {
    host.querySelector('svg')?.remove();
    const width = Math.max(240, host.clientWidth);
    const height = 176;
    const m = { top: 12, right: 52, bottom: 34, left: 40 };
    const w = width - m.left - m.right;
    const h = height - m.top - m.bottom;
    const n = opts.labels.length;
    const all = opts.series.flatMap((s) => s.values.filter((v): v is number => v != null && Number.isFinite(v)));
    const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': opts.label, tabindex: 0, class: 'tn-chart-svg' });
    host.prepend(svg);
    if (!all.length) {
      el('text', { x: m.left, y: m.top + h / 2, class: 'tn-axis' }, svg).textContent = 'Not enough words to score';
      return;
    }
    const { lo, hi, ticks } = scale(all, !!opts.zero, opts.minTop);
    const x = (i: number) => m.left + (n === 1 ? w / 2 : (i / (n - 1)) * w);
    const y = (v: number) => m.top + h - ((v - lo) / (hi - lo)) * h;

    // Grid and y ticks
    for (const t of ticks) {
      el('line', { x1: m.left, x2: m.left + w, y1: y(t), y2: y(t), class: t === 0 && lo < 0 ? 'tn-zero' : 'tn-grid' }, svg);
      const label = el('text', { x: m.left - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'tn-axis' }, svg);
      label.textContent = Math.abs(t) >= 1000 ? `${Math.round(t / 1000)}K` : String(Number(t.toFixed(1)));
    }

    // X labels: the quarter, and the year only where it changes
    const room = w / Math.max(1, n - 1);
    const every = room < 26 ? Math.ceil(26 / room) : 1;
    let lastYear = '';
    opts.labels.forEach((lab, i) => {
      const [top, year] = splitLabel(lab);
      const show = i % every === 0 || i === n - 1;
      if (show) {
        const t = el('text', { x: x(i), y: m.top + h + 15, 'text-anchor': 'middle', class: 'tn-axis' }, svg);
        t.textContent = year ? top : lab.length > 8 && room < 60 ? lab.slice(0, 3) : lab;
      }
      if (year && year !== lastYear) {
        const t = el('text', { x: x(i), y: m.top + h + 29, 'text-anchor': i === 0 ? 'start' : 'middle', class: 'tn-axis tn-axis--year' }, svg);
        t.textContent = year;
        lastYear = year;
      }
    });

    // Selected quarter
    if (opts.selected >= 0 && opts.selected < n) {
      el('line', { x1: x(opts.selected), x2: x(opts.selected), y1: m.top, y2: m.top + h, class: 'tn-selected' }, svg);
    }

    // Lines and nodes
    for (const s of opts.series) {
      let d = '';
      let pen = false;
      s.values.forEach((v, i) => {
        if (v == null || !Number.isFinite(v)) {
          pen = false;
          return;
        }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      });
      el('path', { d, class: 'tn-line', style: `stroke:${s.color}` }, svg);
      s.values.forEach((v, i) => {
        if (v == null || !Number.isFinite(v)) return;
        el('circle', { cx: x(i), cy: y(v), r: i === opts.selected ? 5 : 4, class: 'tn-dot', style: `fill:${s.color}` }, svg);
      });
    }

    // End labels, unless two would collide (then the legend and tooltip carry them)
    const ends = opts.series
      .map((s) => {
        let i = s.values.length - 1;
        while (i >= 0 && (s.values[i] == null || !Number.isFinite(s.values[i]!))) i--;
        return i >= 0 ? { i, v: s.values[i] as number } : null;
      })
      .filter((e): e is { i: number; v: number } => !!e);
    const ys = ends.map((e) => y(e.v)).sort((a, b) => a - b);
    const crowded = ys.some((v, k) => k > 0 && v - ys[k - 1] < 13);
    if (!crowded) {
      for (const e of ends) {
        const t = el('text', { x: x(e.i) + 9, y: y(e.v) + 4, class: 'tn-end' }, svg);
        t.textContent = opts.fmt(e.v);
      }
    }

    // Crosshair, tooltip and picking a quarter
    const cross = el('line', { y1: m.top, y2: m.top + h, class: 'tn-cross', visibility: 'hidden' }, svg);
    const hit = el('rect', { x: m.left - 12, y: 0, width: w + 24, height: m.top + h + 30, fill: 'transparent', class: 'tn-hit' }, svg);
    let at = -1;
    const show = (i: number) => {
      at = Math.max(0, Math.min(n - 1, i));
      cross.setAttribute('x1', String(x(at)));
      cross.setAttribute('x2', String(x(at)));
      cross.setAttribute('visibility', 'visible');
      tip.replaceChildren();
      const head = document.createElement('p');
      head.className = 'tn-tip-head';
      head.textContent = opts.labels[at];
      tip.append(head);
      for (const s of opts.series) {
        const row = document.createElement('p');
        row.className = 'tn-tip-row';
        const key = document.createElement('span');
        key.className = 'tn-key';
        key.style.background = s.color;
        const val = document.createElement('strong');
        const v = s.values[at];
        val.textContent = v == null || !Number.isFinite(v) ? '–' : opts.fmt(v);
        const name = document.createElement('span');
        name.textContent = s.name;
        row.append(key, val, name);
        tip.append(row);
      }
      tip.hidden = false;
      const left = x(at);
      tip.style.left = `${Math.min(Math.max(0, left - 70), width - 150)}px`;
      tip.style.top = `${height - 4}px`;
    };
    const hide = () => {
      cross.setAttribute('visibility', 'hidden');
      tip.hidden = true;
      at = -1;
    };
    const indexAt = (clientX: number) => {
      const r = svg.getBoundingClientRect();
      const px = ((clientX - r.left) / r.width) * width;
      return n === 1 ? 0 : Math.round(((px - m.left) / w) * (n - 1));
    };
    hit.addEventListener('pointermove', (e) => show(indexAt((e as PointerEvent).clientX)));
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('click', (e) => opts.onSelect(Math.max(0, Math.min(n - 1, indexAt((e as MouseEvent).clientX)))));
    svg.addEventListener('focus', () => show(opts.selected >= 0 ? opts.selected : n - 1));
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      if (k === 'ArrowRight' || k === 'ArrowLeft') {
        e.preventDefault();
        show((at < 0 ? opts.selected : at) + (k === 'ArrowRight' ? 1 : -1));
      } else if ((k === 'Enter' || k === ' ') && at >= 0) {
        e.preventDefault();
        opts.onSelect(at);
      }
    });
  };

  host.append(tip);
  draw();
  let last = host.clientWidth;
  const ro = new ResizeObserver(() => {
    if (Math.abs(host.clientWidth - last) < 4) return;
    last = host.clientWidth;
    draw();
  });
  ro.observe(host);
  return () => ro.disconnect();
}
