// Finds tables in a page's lines and rebuilds them as rows and columns.
//
// Written for financial statements (10-Ks, 10-Qs, annual reports) but not
// tied to any company: it works from where text sits on the page. A table is
// a run of lines whose pieces sit in columns, with numbers among them. The
// columns come from where the cells line up; the headers above are matched
// to the columns they sit over (a header centred over several columns, like
// "Three Months Ended", applies to all of them).

export interface Seg {
  text: string;
  x: number;
  endX: number;
  /** Where the figure itself ends, when a "%" set apart was joined to it. */
  numEnd?: number;
}

export interface Line {
  text: string;
  segs: Seg[];
  x: number;
  y: number;
  endX: number;
  size: number;
  page: number;
  top: number; // 0 = top of page, 1 = bottom
}

export interface TableData {
  corner: string; // the header over the label column, e.g. "(in millions)"
  columns: string[]; // one header per value column
  rows: Array<{ label: string; cells: string[] }>;
  page: number;
  lastPage: number;
  doubts: string[];
  /** Each header piece once, for the figure check (column headers repeat them). */
  headerTexts: string[];
  // Column positions, to join a table that continues on the next page.
  spans: Array<[number, number]>;
}

const NUM = /^[$€£¥]?\(?[$€£¥]?[-–−]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?\)?%?\)?[x×]?$/i;
const DASH = /^[$€£¥]?\(?[—–−-]{1,3}\)?%?$/;
const NA = /^(n\/?a|n\/?m|nm|\*{1,3})$/i;
const compact = (s: string) => s.replace(/\s+/g, '');
const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;

/** Splits a footnote mark off a figure: "1,234 (2)" → ["1,234", "(2)"]. */
const splitMark = (s: string): [string, string] => {
  const m = s.trim().match(/^(.*?[\d)%—–-])\s*(\([a-z0-9]{1,2}\)|\*{1,3}|[†‡])$/i);
  return m && m[1] && /\d|[—–]/.test(m[1]) ? [m[1], m[2]] : [s.trim(), ''];
};

/** A cell that holds a figure: 1,234 · $ (46) · 12.5 % · — · n/m · 1,234 (2) */
export const isNum = (s: string) => {
  const t = compact(s);
  if (NUM.test(t) || DASH.test(t) || NA.test(t)) return true;
  const [n, mark] = splitMark(s);
  return !!mark && (NUM.test(compact(n)) || DASH.test(compact(n)));
};

/** A figure with a unit: 7.8 years · 12 months · 25 bps · 3.2x */
export const isValue = (s: string) => isNum(s) || /^[$€£¥]?\(?\d[\d,]*(\.\d+)?\)?\s*(years?|months?|days?|weeks?|bps|basis points|x|times|MW|GW|kW)$/i.test(s.trim());

const MONTHS = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\b/i;
/** A cell that labels a column rather than giving a figure: 2025 · Q3 · December 31, 2025 */
const isHeaderCell = (s: string) => {
  const t = s.trim();
  return /^(fy|fiscal\s*)?(19|20)\d{2}$/i.test(t) || /^q[1-4]/i.test(t) || MONTHS.test(t) || (!isNum(t) && /[a-z]/i.test(t));
};

const FOOTNOTE = /^(\(?[0-9a-z]{1,2}\)|\*{1,3}|†|‡)$/i;

/** Tidies a figure: "$ 5,131" → "$5,131", "( 46 )" → "(46)", "231 %" → "231%". */
export function tidyCell(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (!isNum(t)) return t;
  const [n, mark] = splitMark(t);
  return compact(n) + (mark ? ` ${mark}` : '');
}

interface Row {
  line: Line;
  label: Seg | null;
  cells: Seg[];
}

function splitRow(line: Line): Row {
  const [first, ...rest] = line.segs;
  if (first && !isNum(first.text)) return { line, label: first, cells: rest };
  return { line, label: null, cells: line.segs };
}

/** A line that reads as a table row: a label (or none) and at least one figure set apart. */
function isDataLine(line: Line): boolean {
  if (line.segs.length < 2) return false;
  const r = splitRow(line);
  if (!r.cells.some((c) => isValue(c.text))) return false;
  // Prose with a number set apart by a wide gap is rare, but a long label
  // with a single figure is common; reject only lines that are mostly words.
  const words = r.cells.filter((c) => !isValue(c.text) && c.text.split(' ').length > 6);
  return words.length === 0;
}

/** A line that only names columns: 2025 2024 · December 31, 2025 */
const headerOnly = (line: Line) => {
  const r = splitRow(line);
  return isDataLine(line) && !r.label && r.cells.every((c) => isHeaderCell(c.text));
};

export interface Found {
  start: number;
  end: number; // inclusive, indices into the page's lines
  table: TableData;
}

/** Finds the tables among one page's lines (already in reading order). */
export function findTables(lines: Line[], body: number): Found[] {
  const found: Found[] = [];
  const rowGap = (() => {
    const gaps: number[] = [];
    for (let i = 1; i < lines.length; i++) {
      const dy = lines[i - 1].y - lines[i].y;
      if (dy > 0 && isDataLine(lines[i]) && isDataLine(lines[i - 1])) gaps.push(dy);
    }
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)] ?? body * 1.5;
  })();
  const near = (a: Line, b: Line, k = 2.6) => a.page === b.page && a.y - b.y > 0 && a.y - b.y <= Math.max(rowGap, body * 1.2) * k;

  let i = 0;
  while (i < lines.length) {
    if (!isDataLine(lines[i])) {
      i++;
      continue;
    }
    // Extend through data lines, and through short lines between them
    // (section labels, wrapped labels, footnote marks).
    let end = i;
    let j = i + 1;
    while (j < lines.length) {
      if (headerOnly(lines[j])) break;
      if (isDataLine(lines[j]) && near(lines[j - 1], lines[j])) {
        end = j;
        j++;
        continue;
      }
      // Short lines, then a data line: up to two section labels, or up to
      // eight lines of a label wrapped in a narrow column.
      let k = j;
      const tight = (a: Line, b: Line) => near(a, b, 1.25);
      while (
        k < lines.length &&
        !isDataLine(lines[k]) &&
        (lines[k].segs.length === 1 || (lines[k].segs.length <= 5 && k === j && lines[k].segs.every((c) => c.text.split(' ').length <= 8))) &&
        !(lines[k].text.length > 60 && /[.:]$/.test(lines[k].text) && lines[k].segs.length === 1) && // a sentence of prose
        near(lines[k - 1], lines[k]) &&
        ((k < j + 2 && lines[k].text.length <= 110) || (k < j + 8 && lines[k].text.length <= 60 && tight(lines[k - 1], lines[k])))
      )
        k++;
      if (k > j && k < lines.length && isDataLine(lines[k]) && !headerOnly(lines[k]) && near(lines[k - 1], lines[k])) {
        end = k;
        j = k + 1;
        continue;
      }
      break;
    }

    const dataCount = lines.slice(i, end + 1).filter(isDataLine).length;
    const figures = lines.slice(i, end + 1).reduce((n, l) => n + splitRow(l).cells.filter((c) => isNum(c.text)).length, 0);
    if (dataCount < 2 && figures < 3) {
      i = end + 1;
      continue;
    }

    const built = build(lines, i, end, body, near);
    if (built) found.push(built);
    i = (built?.end ?? end) + 1;
  }
  return found;
}

function build(lines: Line[], start: number, end: number, body: number, near: (a: Line, b: Line, k?: number) => boolean): Found | null {
  // A label wrapped over lines above the first row ("Cash dividend on
  // Series C / redeemable convertible / preferred stock  —  (59)").
  const firstLabel = splitRow(lines[start]).label;
  if (firstLabel && /^[a-z]/.test(firstLabel.text)) {
    while (start > 0 && start > end - 400 && lines[start - 1].segs.length === 1 && !isDataLine(lines[start - 1]) && lines[start - 1].text.length <= 60 && near(lines[start - 1], lines[start], 1.25) && lines[start - 1].x <= firstLabel.x + body) start--;
  }
  const rows = lines.slice(start, end + 1).map(splitRow);
  // A figure where the labels start is part of a label: the second line of
  // "… of $2, $(151), and / $174", or a year labelling a row ("2026  $6,708").
  const textLabels = rows.flatMap((r) => (r.label && isDataLine(r.line) ? [r.label.x] : []));
  if (textLabels.length >= 2) {
    const labelX = Math.max(...textLabels); // labels can be indented
    for (const r of rows) if (!r.label && !headerOnly(r.line) && r.cells.length >= 2 && r.cells[0].x <= labelX + body) r.label = r.cells.shift()!;
  }

  // Rows at the top that only name the columns (years, dates) are headers.
  const UNITS = /^\(?[^()]*\b(in (millions|thousands|billions)|except|unaudited|dollars|amounts)\b[^()]*\)?$/i;
  const preCorner: string[] = [];
  let firstData = 0;
  while (firstData < rows.length) {
    const r = rows[firstData];
    if (isDataLine(r.line) && r.cells.every((c) => isHeaderCell(c.text))) firstData++;
    else if (firstData > 0 && !isDataLine(r.line) && r.line.segs.length === 1 && UNITS.test(r.line.text) && r.line.text.length < 90) {
      preCorner.push(r.line.text);
      rows.splice(firstData, 1);
    } else break;
  }
  if (firstData >= rows.length) return null;

  // Columns. Figures are right-aligned, so a column is where figures end;
  // that keeps crowded columns apart, like "(4)" and "(4,258,397)" side by
  // side. A closing bracket or % hangs a little past the edge. Words in the
  // cells (a text column) are grouped by where they overlap.
  const cellSegs = rows.slice(firstData).flatMap((r) => r.cells);
  // Percentages are aligned either on their digits (beside dollar figures)
  // or on the % sign (a column of percentages, where "—%" has no digits),
  // so a percentage can match a column by either edge.
  const isPct = (s: Seg) => /%\)?$/.test(s.text);
  const parenAdj = (t: string) => (/\)$/.test(t) ? body * 0.3 : 0);
  const digitEdge = (s: Seg) => {
    if (s.numEnd != null) return s.numEnd - parenAdj(s.text.replace(/\s*%\)?$/, ''));
    if (isPct(s)) return s.endX - body * 0.8 - parenAdj(s.text.replace(/%\)?$/, ''));
    return s.endX - parenAdj(s.text);
  };
  const pctEdge = (s: Seg) => s.endX - (/%\)$/.test(s.text) ? body * 0.3 : 0);
  const edge = digitEdge;
  const tolEdge = Math.max(3, body * 0.6);
  const cluster = (segs: Seg[], at: (s: Seg) => number) => {
    const out: Seg[][] = [];
    for (const s of [...segs].sort((a, b) => at(a) - at(b))) {
      const g = out[out.length - 1];
      if (g && at(s) - at(g[g.length - 1]) <= tolEdge) g.push(s);
      else out.push([s]);
    }
    return out;
  };
  const figuresIn = cellSegs.filter((c) => isValue(c.text));
  const cols: Array<{ span: [number, number]; edge: number | null; members: Seg[] }> = cluster(
    figuresIn.filter((c) => !isPct(c)),
    digitEdge,
  ).map((g) => ({ span: [Math.min(...g.map((s) => s.x)), Math.max(...g.map((s) => s.endX))], edge: median(g.map(digitEdge)), members: g }));
  const loose: Seg[] = [];
  for (const s of figuresIn.filter(isPct)) {
    const hit =
      cols.find((c) => c.edge != null && Math.abs(digitEdge(s) - c.edge) <= tolEdge) ??
      cols.find((c) => c.edge != null && Math.abs(pctEdge(s) - c.edge) <= tolEdge);
    if (hit) {
      hit.members.push(s);
      hit.span = [Math.min(hit.span[0], s.x), Math.max(hit.span[1], s.endX)];
    } else loose.push(s);
  }
  for (const g of cluster(loose, pctEdge)) {
    cols.push({ span: [Math.min(...g.map((s) => s.x)), Math.max(...g.map((s) => s.endX))], edge: median(g.map(pctEdge)), members: g });
  }
  for (const s of cellSegs.filter((c) => !isValue(c.text)).sort((a, b) => a.x - b.x)) {
    if (cols.some((c) => Math.min(s.endX, c.span[1]) - Math.max(s.x, c.span[0]) > 0)) continue;
    const near = cols.find((c) => c.edge == null && Math.abs(c.span[0] - s.x) < body);
    if (near) near.span[1] = Math.max(near.span[1], s.endX);
    else cols.push({ span: [s.x, s.endX], edge: null, members: [s] });
  }
  cols.sort((a, b) => a.span[0] - b.span[0]);
  if (!cols.length) return null;
  const spans = cols.map((c) => c.span);
  const rightEdges = cols.map((c) => c.edge);
  const pitch = spans.length > 1 ? (spans[spans.length - 1][1] - spans[0][1]) / (spans.length - 1) : spans[0][1] - spans[0][0];
  const colLeft = spans[0][0];

  // Header lines above the table: everything over the columns, none of it in
  // the label column. Units like "(in millions)" can sit anywhere.
  let top = start;
  const headerLines: Line[] = [];
  const corner: string[] = [...preCorner];
  const sections: Line[] = [];
  // The label column: where the row labels start and (mostly) end.
  const labels = rows.slice(firstData).flatMap((r) => (r.label ? [r.label] : []));
  const labelLeft = labels.length ? Math.min(...labels.map((l) => l.x)) : colLeft;
  const labelEnd = labels.length ? [...labels.map((l) => l.endX)].sort((a, b) => a - b)[Math.floor(labels.length * 0.9)] : colLeft;
  const zone = (s: Seg) => s.endX < colLeft - body * 0.5 && s.x < labelLeft + body * 3;
  const headerish = (l: Line) => {
    const inZone = l.segs.filter(zone);
    const over = l.segs.filter((s) => !zone(s));
    if (!over.length || inZone.length > 1 || (inZone[0]?.text.length ?? 0) > 50) return false;
    const firstWidth = spans[0][1] - spans[0][0];
    // Centred over the first few columns ("Class A, Class B, Class C Stock"
    // over Shares and Amount), unlike a title centred on the page.
    const overLeading = (s: Seg) =>
      spans.some((c, b) => Math.abs((s.x + s.endX) / 2 - (colLeft + c[1]) / 2) <= Math.max(8, pitch * 0.2) && b >= 0);
    const fits = (s: Seg) =>
      s.x >= colLeft - body * 1.5 ||
      (s.x >= labelEnd + body * 0.5 && (s.endX <= colLeft + Math.max(firstWidth, body * 4) || overLeading(s)));
    if (!over.every(fits)) return false;
    return !over.every((s) => isNum(s.text) && !isHeaderCell(s.text)); // not a stray row of figures
  };
  const unitsLine = (l: Line) => l.segs.length === 1 && UNITS.test(l.text) && l.text.length < 90;
  // A statement title ("CONSOLIDATED STATEMENTS OF INCOME") ends the headers.
  const title = (l: Line) => {
    const letters = l.text.replace(/[^A-Za-z]/g, '');
    return l.segs.length === 1 && letters.length >= 12 && letters === letters.toUpperCase();
  };
  for (let h = start - 1, n = 0; h >= 0 && n < 8; h--, n++) {
    const l = lines[h];
    if (!near(l, lines[h + 1], 2.4) || title(l)) break;
    if (headerish(l) || unitsLine(l)) {
      top = h;
      headerLines.unshift(l);
      continue;
    }
    // A section label ("Adjusted Revenue") between the headers and the first row.
    const above = lines[h - 1];
    if (!headerLines.length && !sections.length && l.segs.length === 1 && zone(l.segs[0]) && l.text.length <= 60 && !/\.$/.test(l.text) && above && near(above, l, 2.4) && (headerish(above) || unitsLine(above))) {
      sections.unshift(l);
      top = h;
      continue;
    }
    break;
  }
  if (sections.length && !headerLines.length) {
    top = start; // no header above after all
    sections.length = 0;
  }
  for (const r of rows.slice(0, firstData)) headerLines.push(r.line);

  const headers = spans.map(() => [] as string[]);
  const doubts: string[] = [];
  const center = (s: Seg) => (s.x + s.endX) / 2;
  const overlap = (s: Seg, c: [number, number]) => Math.max(0, Math.min(s.endX, c[1]) - Math.max(s.x, c[0]));
  const nearestCol = (s: Seg) => {
    let best = 0;
    let bestScore = -Infinity;
    spans.forEach((c, k) => {
      const score = overlap(s, c) > 0 ? 1e6 + overlap(s, c) : -Math.abs(center(s) - (c[0] + c[1]) / 2);
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
    });
    return best;
  };
  const avgWidth = spans.reduce((n, c) => n + (c[1] - c[0]), 0) / spans.length;
  // A figure goes to the column whose right edge it ends on.
  const numberCol = (s: Seg) => {
    let best = -1;
    let dist = Infinity;
    rightEdges.forEach((e, k) => {
      if (e == null) return;
      const d = isPct(s) ? Math.min(Math.abs(digitEdge(s) - e), Math.abs(pctEdge(s) - e)) : Math.abs(digitEdge(s) - e);
      if (d < dist) {
        dist = d;
        best = k;
      }
    });
    return best >= 0 && dist <= tolEdge * 2 ? best : nearestCol(s);
  };

  // A header cell can wrap over several lines ("Redeemable / Convertible /
  // Preferred Stock"): stack pieces centred under one another. A short piece
  // under a long one only stacks if it's the only piece beneath it; otherwise
  // the long one is a heading over several columns ("Year Ended" over years).
  interface Stack { text: string[]; x: number; endX: number; top: number; bottom: number; lastY: number }
  const stacks: Stack[] = [];
  const mid = (a: { x: number; endX: number }) => (a.x + a.endX) / 2;
  headerLines.forEach((l, li) => {
    const segs = l.segs.filter((s) => {
      if (zone(s) || (UNITS.test(s.text) && l.segs.length === 1)) {
        corner.push(s.text);
        return false;
      }
      return true;
    });
    for (const s of segs) {
      const host = stacks.find((st) => {
        if (st.bottom >= li || st.lastY - l.y <= 0 || st.lastY - l.y > body * 1.6 || Math.abs(mid(st) - center(s)) > Math.max(4, body * 0.6)) return false;
        // Other headers beside it on the lower line mean the upper one spans them.
        const reach = (st.endX - st.x) / 2 + Math.max(avgWidth, pitch * 0.6);
        return segs.filter((o) => Math.abs(center(o) - mid(st)) <= reach).length === 1;
      });
      if (host) {
        host.text.push(s.text);
        host.x = Math.min(host.x, s.x);
        host.endX = Math.max(host.endX, s.endX);
        host.bottom = li;
        host.lastY = l.y;
      } else {
        stacks.push({ text: [s.text], x: s.x, endX: s.endX, top: li, bottom: li, lastY: l.y });
      }
    }
  });

  // Each stack goes over the column it sits on, or over a run of columns
  // centred beneath it when each of those has its own header further down.
  // A column already headed by another stack at the same level is off limits.
  const claimed = (st: Stack, k: number) =>
    stacks.some((o) => o !== st && o.top <= st.bottom && o.bottom >= st.top && (overlap({ text: '', x: o.x, endX: o.endX }, spans[k]) > 0 || nearestCol({ text: '', x: o.x, endX: o.endX }) === k));
  const below = (st: Stack, k: number) => stacks.some((o) => o !== st && o.top > st.bottom && nearestCol({ text: '', x: o.x, endX: o.endX }) === k);
  const tol = Math.max(8, avgWidth * 0.35, pitch * 0.3);
  for (const st of [...stacks].sort((a, b) => a.top - b.top || a.x - b.x)) {
    const seg = { text: '', x: st.x, endX: st.endX };
    const own = spans.map((c, k) => (overlap(seg, c) > 0 ? k : -1)).filter((k) => k >= 0);
    const a0 = own.length ? Math.min(...own) : nearestCol(seg);
    const a1 = own.length ? Math.max(...own) : a0;
    let pick: [number, number] = [a0, a1];
    let best = -1;
    for (let a = a0; a >= 0; a--) {
      for (let b = a1; b < spans.length; b++) {
        const set = Array.from({ length: b - a + 1 }, (_, n) => a + n);
        if (b > a && !set.every((k) => below(st, k) && (k >= a0 && k <= a1 ? true : !claimed(st, k)))) continue;
        const m = (spans[a][0] + spans[b][1]) / 2;
        if (Math.abs(m - center(seg)) <= tol && b - a > best) {
          best = b - a;
          pick = [a, b];
        }
      }
    }
    for (let c = pick[0]; c <= pick[1]; c++) headers[c].push(st.text.join(' '));
  }

  // Body rows. Short lines without figures are section labels, the first
  // half of a wrapped label, or footnote marks for the next row.
  const out: TableData['rows'] = [];
  rows.splice(firstData, 0, ...sections.map(splitRow));
  let carry = '';
  let carryX = 0;
  let carryLines = 0;
  // Does a label line run on into the next? It ends mid-phrase, or the next
  // starts in lower case, or it has already wrapped once.
  const runsOn = (head: string, next: string) =>
    !next || /^[a-z(]/.test(next) || /(,|-|\b(of|and|or|to|for|the|from|in|on|with|by|at|as|per|net|less|including|attributable))$/i.test(head);
  let marks = '';
  // A row whose text wraps: "OEM and Software … | March 2026 - July" over
  // "| 2030 | 10% | 4,165 | 1,177". Its cells wait for the line below.
  let held: string[] | null = null;
  const place = (r: Row) => {
    const cells = spans.map(() => [] as string[]);
    for (const c of r.cells) {
      const k = isValue(c.text) ? numberCol(c) : nearestCol(c);
      if (cells[k].length) doubts.push(`two values fell in one column on the row “${(r.label?.text ?? '').slice(0, 50)}”`);
      cells[k].push(c.text);
    }
    return cells;
  };
  for (const r of rows.slice(firstData)) {
    if (!isDataLine(r.line) && r.cells.length > 0 && r.label && !held) {
      if (carry) out.push({ label: carry, cells: spans.map(() => '') });
      carry = r.label.text;
      carryX = r.label.x;
      carryLines = 1;
      held = place(r).map((c) => c.join(' '));
      continue;
    }
    if (!isDataLine(r.line) && r.cells.length === 0 && r.label) {
      const t = r.label.text;
      if (FOOTNOTE.test(t)) {
        marks += ` ${t}`;
        continue;
      }
      // The next line of a wrapped label: lower case, or indented under it.
      if (carry && !/:$/.test(carry) && (/^[a-z(]/.test(t) || r.label.x > carryX + body * 0.5)) {
        carry = `${carry} ${t}`;
        carryLines++;
        continue;
      }
      if (carry) out.push({ label: carry, cells: spans.map(() => '') });
      carry = t;
      carryX = r.label.x;
      carryLines = 1;
      if (/:$/.test(t)) {
        out.push({ label: t, cells: spans.map(() => '') });
        carry = '';
      }
      continue;
    }
    const cells = place(r);
    if (held) {
      const before = held;
      held = null;
      if (!r.label || /^[a-z(]/.test(r.label.text)) {
        // The second line of the wrapped row: join each column's text.
        cells.forEach((c, k) => before[k] && c.unshift(before[k]));
      } else {
        out.push({ label: carry, cells: before });
        carry = '';
      }
    }
    let label = r.label?.text ?? '';
    let continued = !!label && /^[a-z]/.test(label);
    if (carry) {
      // "Weighted-average shares used in computing" + "net loss per share"
      const joins = runsOn(carry, label);
      if (joins) {
        // Mid-label: it starts in lower case or with a lone letter ("C redeemable …").
        continued = /^([a-z]|[A-Z]\s)/.test(carry);
        label = `${carry} ${label}`.trim();
      }
      else out.push({ label: carry, cells: spans.map(() => '') });
      carry = '';
    }
    if (marks) {
      label = `${label}${marks}`.trim();
      marks = '';
    }
    const row = { label, cells: cells.map((c) => c.map(tidyCell).join(' ')) };
    // A row whose values sit on two lines of its wrapped label: the second
    // half continues the label and fills exactly the columns left empty.
    const prev = out[out.length - 1];
    if (prev && continued && prev.cells.some(Boolean) && prev.cells.some((c) => !c) && row.cells.every((c, k) => !c || !prev.cells[k])) {
      prev.label = `${prev.label} ${row.label}`.trim();
      row.cells.forEach((c, k) => c && (prev.cells[k] = c));
      continued = false;
      continue;
    }
    continued = false;
    out.push(row);
  }
  if (carry) out.push({ label: carry, cells: held ?? spans.map(() => '') });

  // Drop columns that ended up empty (stray marks), keeping headers aligned.
  const keep = spans.map((_, k) => out.some((r) => r.cells[k]) || headers[k].length > 0);
  const columns = headers.map((h) => h.join(' ').replace(/\s+/g, ' ').trim());

  return {
    start: top,
    end,
    table: {
      corner: corner.join(' ').trim(),
      columns: columns.filter((_, k) => keep[k]),
      rows: out.map((r) => ({ label: r.label, cells: r.cells.filter((_, k) => keep[k]) })),
      page: lines[start].page,
      lastPage: lines[end].page,
      doubts: [...new Set(doubts)],
      headerTexts: [corner.join(' '), ...stacks.map((st) => st.text.join(' '))],
      spans: spans.filter((_, k) => keep[k]),
    },
  };
}

/** Joins a table that runs onto the next page, dropping a repeated header. */
export function canContinue(a: TableData, b: TableData): boolean {
  // The next page, or the one after a blank page; called only when nothing
  // else came between the two tables.
  if (b.page - a.lastPage < 1 || b.page - a.lastPage > 2 || a.spans.length !== b.spans.length) return false;
  const noHeader = b.columns.every((c) => !c) && !b.corner;
  const sameHeader = b.columns.join('|') === a.columns.join('|');
  if (!noHeader && !sameHeader) return false;
  // Columns end in the same places, give or take: a page can lay the table out a little differently.
  const pitch = a.spans.length > 1 ? Math.min(...a.spans.slice(1).map((s, k) => s[1] - a.spans[k][1])) : 100;
  const slack = noHeader ? Math.max(12, Math.min(25, pitch * 0.5)) : 12;
  return a.spans.every((s, k) => Math.abs(s[1] - b.spans[k][1]) <= slack);
}

const cellText = (s: string) => s.replace(/\|/g, '\\|');

export function tableToText(t: TableData, markdown: boolean): string {
  const width = t.columns.length + 1;
  const line = (cells: string[]) => (markdown ? `| ${cells.map(cellText).join(' | ')} |` : cells.join(' | ').replace(/(\s\|\s)+$/, ''));
  const out: string[] = [];
  const hasHeader = t.corner || t.columns.some(Boolean);
  if (markdown || hasHeader) out.push(line([t.corner, ...t.columns]));
  if (markdown) out.push(`|${' --- |'.repeat(1)}${' ---: |'.repeat(width - 1)}`);
  for (const r of t.rows) out.push(line([r.label, ...r.cells]));
  return out.join('\n');
}
