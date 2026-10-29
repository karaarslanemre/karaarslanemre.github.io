// Draws and animates the thin line drawings ("figures").
//
// Each <div data-fig="..."> gets an SVG sized in real pixels, so the round
// nodes stay round. Headline figures measure the headline first and route
// their lines above, beside and below it, never through the text. Lines
// draw themselves in when they first come into view, then sway slowly while
// a small dot travels along them. Visitors who ask their system for reduced
// motion get the drawings without any movement.

type Pt = [number, number];
type Seg = { c1: Pt; c2: Pt; p: Pt } | { p: Pt };
type Shape = {
  start: Pt;
  segs: Seg[];
  big: number; // index of the segment end that carries the big node (-1 = start)
  small: number;
  sway: number; // how far control points drift, in px
  r: [number, number]; // big and small node radius
};

const NS = 'http://www.w3.org/2000/svg';
const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function el<K extends keyof SVGElementTagNameMap>(name: K, cls?: string) {
  const node = document.createElementNS(NS, name);
  if (cls) node.setAttribute('class', cls);
  return node;
}

function headlineBox(fig: HTMLElement, rect: DOMRect) {
  const h = fig.parentElement?.querySelector<HTMLElement>('.hero');
  if (!h) return null;
  const range = document.createRange();
  range.selectNodeContents(h);
  const b = range.getBoundingClientRect();
  return { x0: b.left - rect.left, y0: b.top - rect.top, x1: b.right - rect.left, y1: b.bottom - rect.top };
}

function shapeFor(kind: string, W: number, H: number, B: ReturnType<typeof headlineBox>): Shape | null {
  if (kind.startsWith('margin')) {
    const a = kind === 'margin-a';
    return a
      ? {
          start: [W, 0.18 * H],
          segs: [
            { c1: [0.5 * W, 0.18 * H], c2: [0.14 * W, 0.28 * H], p: [0.3 * W, 0.46 * H] },
            { c1: [0.46 * W, 0.64 * H], c2: [0.8 * W, 0.58 * H], p: [0.6 * W, 0.8 * H] },
          ],
          big: 1, small: 0, sway: 9, r: [16, 10],
        }
      : {
          start: [W, 0.72 * H],
          segs: [
            { c1: [0.45 * W, 0.74 * H], c2: [0.16 * W, 0.6 * H], p: [0.34 * W, 0.42 * H] },
            { c1: [0.52 * W, 0.24 * H], c2: [0.8 * W, 0.34 * H], p: [0.58 * W, 0.16 * H] },
          ],
          big: 1, small: 0, sway: 9, r: [16, 10],
        };
  }
  if (!B) return null;

  const yT = Math.max(16, B.y0 * 0.5); // the strip above the headline
  const gap = Math.max(20, H - B.y1 - 6); // the strip below it
  const mid = (B.y0 + B.y1) / 2;
  const rx0 = B.x1 + 48; // where the open space right of the headline starts
  const w = W - 50 - rx0;
  const over = B.x0 + (B.x1 - B.x0) * 0.5;

  if (w < 120) {
    // Narrow window: a single line above the headline, ending in a node.
    return { start: [0, yT], segs: [{ p: [W - 40, yT] }], big: 0, small: -1, sway: 0, r: [22, 12] };
  }

  if (kind === 'orbit') {
    return {
      start: [0, yT],
      segs: [
        { p: [over, yT] },
        { c1: [rx0 + 0.3 * w, yT - 6], c2: [W - 50, yT + 2], p: [W - 46, mid] },
        { c1: [W - 42, B.y1 + gap * 0.8], c2: [rx0 + 0.55 * w, B.y1 + gap * 0.9], p: [rx0 + 0.3 * w, B.y1 + gap * 0.5] },
        { c1: [rx0 + 0.05 * w, B.y1 + gap * 0.2], c2: [rx0 - 10, mid], p: [rx0 + 0.12 * w, B.y0 + 6] },
      ],
      big: 3, small: 1, sway: 12, r: [26, 14],
    };
  }

  if (kind === 'chart') {
    // A price-chart line: flat under the headline, then rising to the right.
    const yB = Math.min(H - 14, B.y1 + gap * 0.55);
    const segs: Seg[] = [{ p: [B.x0 * 0.8, yB] }];
    const under = 4;
    for (let i = 0; i < under; i++) {
      const x = B.x0 + ((B.x1 + 30 - B.x0) * (i + 1)) / under;
      segs.push({ p: [x, Math.max(B.y1 + 14, yB + (i % 2 ? -8 : 7))] });
    }
    const rise = 7;
    for (let i = 0; i <= rise; i++) {
      const k = i / rise;
      const x = rx0 + (W - 70 - rx0) * k;
      const y = yB + (yT + 10 - yB) * k + (i % 2 ? 14 : -4) * (i === rise ? 0 : 1);
      segs.push({ p: [x, y] });
    }
    return { start: [0, yB], segs, big: segs.length - 1, small: under + 3, sway: 6, r: [26, 14] };
  }

  // ribbon
  const yLow = B.y1 + gap * 0.55;
  return {
    start: [0, yT],
    segs: [
      { p: [B.x1 * 0.55, yT] },
      { c1: [rx0 + 0.15 * w, yT], c2: [rx0 - 10, yLow], p: [rx0 + 0.35 * w, yLow] },
      { c1: [rx0 + 0.7 * w, yLow], c2: [rx0 + 0.82 * w, yT + 30], p: [W - 60, yT + 6] },
    ],
    big: 2, small: 1, sway: 14, r: [26, 14],
  };
}

type Item = {
  fig: HTMLElement;
  svg: SVGSVGElement;
  path: SVGPathElement;
  signal: SVGCircleElement;
  big: SVGGElement;
  small: SVGGElement;
  shape: Shape | null;
  seed: number;
  shownAt: number | null;
  visible: boolean;
};

function node(r: number, cls: string) {
  const g = el('g', cls);
  const ring = el('circle', 'ring');
  ring.setAttribute('r', String(r));
  const core = el('circle', 'core');
  core.setAttribute('r', String(Math.max(3, r * 0.23)));
  g.append(ring, core);
  return g;
}

function build(item: Item, t: number) {
  const s = item.shape;
  if (!s) return;
  const amp = reduce ? 0 : s.sway;
  const off = (i: number, axis: number) => amp * Math.sin(t / 1000 * (0.55 + 0.07 * ((i + item.seed) % 5)) + i * 1.7 + axis * 2.1 + item.seed);
  let d = `M${s.start[0].toFixed(1)} ${s.start[1].toFixed(1)}`;
  const ends: Pt[] = [];
  s.segs.forEach((seg, i) => {
    if ('c1' in seg) {
      const c1: Pt = [seg.c1[0] + off(i * 2, 0), seg.c1[1] + off(i * 2, 1)];
      const c2: Pt = [seg.c2[0] + off(i * 2 + 1, 0), seg.c2[1] + off(i * 2 + 1, 1)];
      d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${seg.p[0].toFixed(1)} ${seg.p[1].toFixed(1)}`;
      ends.push(seg.p);
    } else {
      // Straight segments (the chart) drift up and down instead.
      const last = i === s.segs.length - 1 || i === 0;
      const y = seg.p[1] + (last ? 0 : off(i, 1) * 0.8);
      d += `L${seg.p[0].toFixed(1)} ${y.toFixed(1)}`;
      ends.push([seg.p[0], y]);
    }
  });
  item.path.setAttribute('d', d);
  const place = (g: SVGGElement, idx: number) => {
    const p = idx < 0 ? null : ends[idx];
    g.style.display = p ? '' : 'none';
    if (p) g.setAttribute('transform', `translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})`);
  };
  place(item.big, s.big);
  place(item.small, s.small);

  // Draw-in, then a dot that travels along the line.
  const len = item.path.getTotalLength();
  const since = item.shownAt == null ? 0 : t - item.shownAt;
  const drawn = reduce ? 1 : Math.min(1, since / 1600);
  const eased = 1 - Math.pow(1 - drawn, 3);
  if (drawn < 1) item.path.setAttribute('stroke-dasharray', `${(len * eased).toFixed(1)} ${len.toFixed(1)}`);
  else item.path.removeAttribute('stroke-dasharray');
  item.big.style.opacity = item.small.style.opacity = String(Math.max(0, Math.min(1, (eased - 0.6) / 0.4)));
  if (reduce || drawn < 1) {
    item.signal.style.display = 'none';
  } else {
    const period = 9000 + item.seed * 700;
    const k = ((since - 1600) % period) / period;
    const p = item.path.getPointAtLength(k * len);
    item.signal.style.display = '';
    item.signal.setAttribute('cx', p.x.toFixed(1));
    item.signal.setAttribute('cy', p.y.toFixed(1));
    item.signal.style.opacity = String(Math.min(1, k * 8, (1 - k) * 8));
  }
}

function layout(item: Item) {
  const rect = item.fig.getBoundingClientRect();
  const W = rect.width, H = rect.height;
  if (W < 10 || H < 10) { item.shape = null; return; }
  item.svg.setAttribute('viewBox', `0 0 ${W.toFixed(1)} ${H.toFixed(1)}`);
  const kind = item.fig.dataset.fig ?? '';
  item.shape = shapeFor(kind, W, H, kind.startsWith('margin') ? null : headlineBox(item.fig, rect));
  if (item.shape) {
    const [rb, rs] = item.shape.r;
    item.big.replaceWith((item.big = node(rb, 'n-big')));
    item.small.replaceWith((item.small = node(rs, 'n-small')));
  }
  build(item, performance.now());
}

const items: Item[] = [];
document.querySelectorAll<HTMLElement>('[data-fig]').forEach((fig, i) => {
  const svg = el('svg');
  const path = el('path', 'line');
  const signal = el('circle', 'signal');
  signal.setAttribute('r', '2.6');
  const big = el('g');
  const small = el('g');
  svg.append(path, signal, small, big);
  fig.append(svg);
  items.push({ fig, svg, path, signal, big, small, shape: null, seed: i % 7, shownAt: null, visible: false });
});

const resize = new ResizeObserver((entries) => {
  entries.forEach((e) => {
    const item = items.find((it) => it.fig === e.target);
    if (item) layout(item);
  });
});
const seen = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    const item = items.find((it) => it.fig === e.target);
    if (!item) return;
    item.visible = e.isIntersecting;
    if (e.isIntersecting && item.shownAt == null) item.shownAt = performance.now();
  });
});
items.forEach((item) => {
  resize.observe(item.fig);
  seen.observe(item.fig);
});

function frame(t: number) {
  if (!document.hidden) items.forEach((item) => item.visible && build(item, t));
  if (!reduce) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
