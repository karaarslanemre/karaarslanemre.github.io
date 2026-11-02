// Turns the text of an earnings call transcript into who said what, in which
// part of the call.
//
// Transcripts come from many places (company sites, Seeking Alpha, the Motley
// Fool, S&P Capital IQ, LSEG/Refinitiv, FactSet) and each lays them out a little
// differently, but they share a shape: a list of participants, the prepared
// remarks, then a question-and-answer session, with each speaker's name on
// its own line or at the start of a line. This finds those pieces without
// relying on any one layout, and says so when it can't.

export type Role = 'ceo' | 'cfo' | 'exec' | 'analyst' | 'operator' | 'other';
export type Section = 'prepared' | 'qa';

export interface Para {
  text: string;
  boiler: boolean; // safe-harbor and similar legal language, left out of the scores
}

export interface Turn {
  speaker: string;
  title: string;
  role: Role;
  section: Section;
  paras: Para[];
}

export interface Period {
  label: string;
  year?: number;
  q?: number;
  fiscal: boolean;
  sort: number;
}

export interface Call {
  id: string;
  source: string;
  company: string;
  ticker: string;
  period: Period;
  date: string;
  turns: Turn[];
  qaFound: boolean;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const PARTICLES = new Set(['de', 'da', 'del', 'della', 'der', 'di', 'du', 'la', 'le', 'van', 'von', 'bin', 'al', 'dos', 'das', 'st.', 'mc', 'y']);
const NOT_NAMES = new Set(
  `presentation questions question answers answer prepared remarks operator disclaimer copyright transcript earnings
   call conference participants participant corporate executives executive analysts analyst thank thanks good hello
   okay yes no sure great welcome session management discussion section company representatives other opening closing
   end duration more contents table forward-looking statements safe harbor important notice page all rights reserved
   moderator definitions overview financial results highlights agenda introduction q&a`
    .split(/\s+/)
    .filter(Boolean),
);

const TITLE_RE =
  /\b(chief|officer|ceo|cfo|coo|cto|cio|president|chair(?:man|woman|person)?|founder|director|vice[- ]president|vp|svp|evp|head|treasurer|controller|relations|ir|analyst|managing|partner|counsel|secretary|executive|manager|principal|strategist|economist|research|ir\s+officer)\b/i;
const FIRM_RE =
  /(?:&\s*co\b)|\b(securities|capital|partners|bank|banc|llc|inc\.?|corp\.?|corporation|co\.|group|markets|research|advisors|associates|asset|investments?|management|holdings|brothers|financial|equity|equities|global|international|ltd\.?|plc|ag|sa|lp|limited|company|bernstein|sachs|stanley|morgan|jpmorgan|citi|barclays|ubs|jefferies|evercore|cowen|wolfe|baird|piper|raymond|oppenheimer|needham|keybanc|mizuho|nomura|rbc|bmo|td|wells fargo|deutsche|hsbc|bofa|truist|stifel|loop|melius|redburn|exane|macquarie|daiwa)\b/i;

const PARTICIPANT_HEAD =
  /^(corporate participants|company participants|company representatives|executives|management|participants|conference call participants|call participants|analysts|presentation participants|other participants|company speakers|analyst speakers)\s*:?$/i;
const QA_HEAD =
  /^(questions?(\s*(and|&)\s*answers?)?(\s+session)?|question[- ]and[- ]answer(\s+session)?|q\s*&\s*a(\s+session)?)\s*:?$/i;
const PREPARED_HEAD = /^(presentation|prepared remarks|management discussion section|opening remarks|management remarks)\s*:?$/i;
const JUNK_LINE = /^(copyright|©|all rights reserved|this transcript|transcript (provided|produced)|source:|disclaimer|duration:|\[(music|technical difficulty|inaudible)\]$|[-=_*·.]{5,}$)/i;
// Lines that are a document's title, not a speaker ("Acme, Inc. (ACME) Q1 2025 Earnings Call")
const NOT_A_TITLE = /\b(earnings|transcript|conference call|results|Q[1-4]|20\d\d|fiscal)\b/i;
const BOILER =
  /forward[- ]looking (statements?|information)|safe harbou?r|non-gaap (financial )?measures?|actual results (may|could) differ|risk factors|reconciliation(s)? (of|to|between)/i;

function nameTokens(s: string): string[] | null {
  const clean = s.replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > 42 || /\d/.test(clean)) return null;
  const tokens = clean.split(' ');
  if (tokens.length < 2 || tokens.length > 5) return null;
  const last = tokens[tokens.length - 1];
  if (last.endsWith('.') && !/^(Jr|Sr|[A-Z])\.$/.test(last)) return null;
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (NOT_NAMES.has(lower.replace(/[^a-z&-]/g, ''))) return null;
    if (PARTICLES.has(lower)) continue;
    if (!/^[A-Z][A-Za-z'’.\-]*$/.test(t)) return null;
  }
  return tokens;
}

const isName = (s: string) => nameTokens(s) !== null;

function titleish(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 110 || NOT_A_TITLE.test(t)) return false;
  if (t.split(/\s+/).length > 14) return false;
  if (/[.!?]$/.test(t) && !/\b(inc|co|corp|ltd|llc|plc|jr|sr)\.$/i.test(t)) return false;
  return TITLE_RE.test(t) || FIRM_RE.test(t);
}

/** A loose key so "Timothy D. Cook", "Tim Cook" and "TIM COOK" can be matched. */
function nameKey(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/\s+/)
    .filter((t) => t && !PARTICLES.has(t) && !/^[a-z]\.?$/.test(t) && !/^(jr|sr|ii|iii|iv)\.?$/.test(t));
  if (!tokens.length) return name.toLowerCase();
  return `${tokens[0][0]}|${tokens[tokens.length - 1].replace(/[^a-z-]/g, '')}`;
}

const titleCase = (s: string) =>
  s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s\-'’])([a-z])/g, (_, a, b) => a + b.toUpperCase()) : s;

// ---------------------------------------------------------------------------
// Header: company, period, date
// ---------------------------------------------------------------------------

const QWORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4 };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const year4 = (y: string) => {
  const n = Number(y);
  return n < 100 ? 2000 + n : n;
};

export function makePeriod(q: number, year: number, fiscal: boolean): Period {
  return { q, year, fiscal, label: fiscal ? `Q${q} FY${String(year).slice(2)}` : `Q${q} ${year}`, sort: year * 10 + q };
}

export function findPeriod(text: string): Period | null {
  const t = text.replace(/[_]+/g, ' ');
  let m = t.match(/\bQ([1-4])\s*(?:of\s+)?(FY|F|fiscal(?:\s+year)?)?\s*['’]?(\d{4}|\d{2})\b/i);
  if (m) return makePeriod(Number(m[1]), year4(m[3]), !!m[2]);
  m = t.match(/\b(FY|fiscal(?:\s+year)?)\s*['’]?(\d{4}|\d{2})\s*[-,]?\s*Q([1-4])\b/i);
  if (m) return makePeriod(Number(m[3]), year4(m[2]), true);
  m = t.match(/\b(first|second|third|fourth|1st|2nd|3rd|4th)[- ]quarter(?:\s+(?:of\s+)?(?:(fiscal)(?:\s+year)?|(FY)))?\s*['’]?(\d{4})\b/i);
  if (m) return makePeriod(QWORD[m[1].toLowerCase()], year4(m[4]), !!(m[2] || m[3]));
  m = t.match(/\b(fiscal(?:\s+year)?|FY)\s*['’]?(\d{4}|\d{2})\s+(first|second|third|fourth|1st|2nd|3rd|4th)[- ]quarter\b/i);
  if (m) return makePeriod(QWORD[m[3].toLowerCase()], year4(m[2]), true);
  m = t.match(/\b(20\d{2})\s*[- ]?Q([1-4])\b/i);
  if (m) return makePeriod(Number(m[2]), Number(m[1]), false);
  return null;
}

export function findDate(text: string): string {
  const m = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.?\s+(\d{1,2}),?\s+(\d{4})\b/,
  );
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    return `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  return iso ? iso[0] : '';
}

function findCompany(headerLines: string[], source: string): { company: string; ticker: string } {
  const clean = (s: string) =>
    s
      .replace(/^(edited |event |corrected )?transcript( of)?[:\s-]*/i, '')
      .replace(/^thomson reuters streetevents\s*/i, '')
      .replace(/\s*(earnings )?(conference )?call( transcript)?$/i, '')
      .replace(/[\s,:;–—-]+$/, '')
      .trim();
  for (const line of headerLines) {
    const m = line.match(/^(.+?)\s*\((?:(?:NYSE|NASDAQ|Nasdaq|NYSE American|NYSEAMERICAN|TSX|LSE|OTC|AMEX)\s*:\s*)?([A-Z][A-Z.\-]{0,6})\)/);
    if (m && clean(m[1]).length > 1 && clean(m[1]).length < 60) return { company: clean(m[1]), ticker: m[2] };
  }
  for (const line of headerLines) {
    const m = line.match(/^(?:Q[1-4]|first|second|third|fourth)(?:\s+quarter)?\s+(?:FY\s*)?['’]?\d{2,4}\s+(.+?)\s+(?:earnings|results|conference call)\b/i);
    if (m && clean(m[1]).length > 1 && clean(m[1]).length < 60) return { company: clean(m[1]), ticker: '' };
  }
  for (const line of headerLines) {
    const m = line.match(/^(.+?)[\s,:–—-]+(?:Q[1-4]|first|second|third|fourth|1st|2nd|3rd|4th|FY|fiscal|full[- ]year|20\d{2})\b.*\b(earnings|results|conference call|call)\b/i);
    if (m && clean(m[1]).length > 1 && clean(m[1]).length < 60 && !/^(the|welcome|good|thank|edited|Q[1-4]\b|FY|\d)/i.test(m[1])) return { company: clean(m[1]), ticker: '' };
  }
  const fromFile = source
    .replace(/\.pdf$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\b(Q[1-4]|FY\s?\d{2,4}|20\d{2}|earnings|call|transcript|conference|results|quarter|first|second|third|fourth)\b/gi, ' ')
    .replace(/[\s-]+/g, ' ')
    .trim();
  return { company: fromFile && fromFile.length < 40 ? fromFile : '', ticker: '' };
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

function roleFromTitle(title: string): Role | null {
  if (!title) return null;
  if (/\b(chief executive|ceo)\b/i.test(title)) return 'ceo';
  if (/\b(chief financial|cfo)\b/i.test(title)) return 'cfo';
  if (/\banalyst\b/i.test(title)) return 'analyst';
  if (/\b(chief|officer|president|chair|founder|vice[- ]president|vp|svp|evp|treasurer|controller|investor relations|relations|counsel|secretary|executive|head of|director)\b/i.test(title))
    return 'exec';
  if (FIRM_RE.test(title)) return 'analyst';
  return null;
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

interface Person {
  name: string;
  title: string;
  role: Role | null;
}

export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function parseTranscript(raw: string, source = 'Pasted text'): Call {
  const lines = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[   ]/g, ' ')
    .replace(/’/g, '’')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim());
  const warnings: string[] = [];

  // --- Participant lists (they may be at the top or, in some layouts, the end)
  const people = new Map<string, Person>(); // nameKey → person
  const skip = new Set<number>();
  const addPerson = (name: string, title: string, role: Role | null) => {
    const display = titleCase(name.replace(/\s+/g, ' ').trim());
    const key = nameKey(display);
    const existing = people.get(key);
    const r = role === 'analyst' ? (/(chief|officer|president)/i.test(title) ? roleFromTitle(title) : 'analyst') : roleFromTitle(title) ?? role;
    if (!existing) people.set(key, { name: display, title: title.trim(), role: r });
    else {
      if (!existing.title && title) existing.title = title.trim();
      if (!existing.role) existing.role = r;
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(PARTICIPANT_HEAD);
    if (!head) continue;
    const h = head[1].toLowerCase();
    const headRole: Role | null = /analyst|conference call|other/.test(h) ? 'analyst' : /corporate|company|executives|management/.test(h) ? 'exec' : null;
    skip.add(i);
    let found = 0;
    let blanks = 0;
    for (let j = i + 1; j < lines.length && j < i + 80; j++) {
      const line = lines[j].replace(/^[*•·]\s*/, '').replace(/^[-–—]\s+/, '');
      if (!line) {
        if (++blanks >= 3 && found) break;
        skip.add(j);
        continue;
      }
      blanks = 0;
      if (PARTICIPANT_HEAD.test(line) || QA_HEAD.test(line) || PREPARED_HEAD.test(line) || /^operator\b/i.test(line)) break;
      const m = line.match(/^(.+?)\s*(?:--|—|–|\s-\s|;|,|:|\t)\s*(.+?)\s*(?:\[\d+\])?$/);
      const shortLabel = (t: string) => /^[A-Z&]/.test(t) && t.split(/\s+/).length <= 10 && !NOT_A_TITLE.test(t) && !/[!?]$/.test(t);
      if (m && isName(m[1]) && (titleish(m[2]) || shortLabel(m[2]))) {
        addPerson(m[1], m[2], headRole);
        skip.add(j);
        found++;
        continue;
      }
      if (isName(line.replace(/\s*\[\d+\]$/, ''))) {
        const next = lines[j + 1] ?? '';
        if (next && titleish(next.replace(/^[*•·]\s*/, '')) && !isName(next)) {
          addPerson(line.replace(/\s*\[\d+\]$/, ''), next.replace(/^[*•·]\s*/, ''), headRole);
          skip.add(j).add(j + 1);
          j++;
        } else {
          addPerson(line, '', headRole);
          skip.add(j);
        }
        found++;
        continue;
      }
      break;
    }
  }

  // --- How often each candidate speaker line appears, to tell names from text
  const standalone = new Map<string, number>();
  const inline = new Map<string, number>();
  for (const line of lines) {
    const bare = line.replace(/\s*\[\d+\]$/, '').replace(/:$/, '');
    if (isName(bare)) standalone.set(bare.toLowerCase(), (standalone.get(bare.toLowerCase()) ?? 0) + 1);
    const m = line.match(/^([A-Z][A-Za-z'’.\- ]{2,40}?):\s+\S/);
    if (m && isName(m[1])) inline.set(m[1].toLowerCase(), (inline.get(m[1].toLowerCase()) ?? 0) + 1);
  }

  // Names the operator or host hands over to ("our next question comes from
  // Jane Doe with Acme", "I'll turn the call over to John Roe"), and titles
  // mentioned in passing ("John Roe, our Chief Financial Officer").
  const NAME = "[A-Z][\\w'’.\\-]+(?:\\s+[A-Z][\\w'’.\\-]+){1,3}";
  const handedTo = new Map<string, Role>();
  for (const m of raw.matchAll(new RegExp(`\\b(?:comes|is|will come|coming) from(?: the line of)?\\s+(${NAME})`, 'g'))) handedTo.set(nameKey(m[1]), 'analyst');
  for (const m of raw.matchAll(new RegExp(`\\b(?:over to|turn it to|hand it to|pass it to)\\s+(?:our [\\w ,]+?,\\s+)?(${NAME})`, 'g'))) {
    if (!handedTo.has(nameKey(m[1]))) handedTo.set(nameKey(m[1]), 'exec');
  }
  const mentionedTitles = new Map<string, string>();
  for (const m of raw.matchAll(new RegExp(`(${NAME}),\\s+(?:our|the company's)\\s+(Chief [A-Z][a-z]+ Officer|CEO|CFO|President(?: and [A-Z][\\w ]+)?|Vice President[\\w ,]*?|Head of [A-Z][\\w ]+)(?=[,.;]| and )`, 'g'))) {
    mentionedTitles.set(nameKey(m[1]), m[2].trim());
  }
  const handed = (name: string) => handedTo.has(nameKey(name));

  const known = () => [...people.values()].map((p) => p.name).sort((a, b) => b.length - a.length);
  let knownNames = known();

  function speakerAt(i: number): { name: string; title: string; rest: string; eatNext: boolean } | null {
    const line = lines[i].replace(/\s*\[\d+\]\s*$/, '');
    const next = lines[i + 1] ?? '';
    let m = line.match(/^(operator|moderator|conference operator|coordinator)\s*(?:[:\-–—]+\s*(.*))?$/i);
    if (m) return { name: 'Operator', title: '', rest: m[2] ?? '', eatNext: false };
    if (/^(unidentified|unknown)\b[\w\s]{0,40}$/i.test(line.replace(/[:\-–—]+$/, ''))) {
      return { name: titleCase(line.replace(/[:\-–—\s]+$/, '')), title: '', rest: '', eatNext: false };
    }
    m = line.match(/^((?:unidentified|unknown)\b[\w\s]{0,40}?):\s+(.+)$/i);
    if (m) return { name: titleCase(m[1]), title: '', rest: m[2], eatNext: false };

    const lower = line.toLowerCase();
    for (const name of knownNames) {
      if (!lower.startsWith(name.toLowerCase())) continue;
      const rest = line.slice(name.length);
      if (/^\s*(\[\d+\])?\s*:?\s*$/.test(rest)) {
        const eat = !!next && titleish(next) && !isName(next) && next.length < 90;
        return { name, title: eat ? next : '', rest: '', eatNext: eat };
      }
      let r = rest.match(/^\s*(?:--|—|–|\s-\s|,)\s*(.{1,110}?)\s*(?:\[\d+\])?\s*$/);
      if (r && /^[A-Z&]/.test(r[1]) && (titleish(r[1]) || (r[1].split(/\s+/).length <= 8 && !/[.!?,]$/.test(r[1]))))
        return { name, title: r[1], rest: '', eatNext: false };
      r = rest.match(/^\s*(?:\[\d+\])?\s*:\s*(.+)$/);
      if (r) return { name, title: '', rest: r[1], eatNext: false };
    }

    // "Name -- Title" for someone not in a participant list
    m = line.match(/^(.+?)\s*(?:--|—|–|\s-\s|,)\s*(.+?)\s*(?:\[\d+\])?$/);
    if (m && line.length <= 150 && isName(m[1]) && /^[A-Z&]/.test(m[2]) && titleish(m[2])) return { name: m[1], title: m[2], rest: '', eatNext: false };

    // "Name: what they said", for names used that way more than once
    m = line.match(/^([A-Z][A-Za-z'’.\- ]{2,40}?):\s+(.+)$/);
    if (m && isName(m[1]) && ((inline.get(m[1].toLowerCase()) ?? 0) >= 2 || handed(m[1]))) return { name: m[1], title: '', rest: m[2], eatNext: false };

    // A name on its own line, used that way more than once
    const bare = line.replace(/\s*\[\d+\]$/, '').replace(/:$/, '');
    if (isName(bare) && ((standalone.get(bare.toLowerCase()) ?? 0) >= 2 || people.has(nameKey(bare)) || handed(bare))) {
      const eat = !!next && titleish(next) && !isName(next) && next.length < 90;
      return { name: bare, title: eat ? next : '', rest: '', eatNext: eat };
    }
    return null;
  }

  // --- Walk the lines into turns
  const turns: Array<Turn & { lines: string[][] }> = [];
  let section: Section = 'prepared';
  let qaFound = false;
  let cur: (Turn & { lines: string[][] }) | null = null;
  const header: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (skip.has(i)) {
      if (PARTICIPANT_HEAD.test(lines[i])) cur = null; // a list at the end ends the last turn
      continue;
    }
    const line = lines[i];
    if (!line) {
      if (cur && cur.lines[cur.lines.length - 1].length) cur.lines.push([]);
      continue;
    }
    if (QA_HEAD.test(line)) {
      section = 'qa';
      qaFound = true;
      cur = null;
      continue;
    }
    if (PREPARED_HEAD.test(line) || JUNK_LINE.test(line)) continue;
    const sp = speakerAt(i);
    if (sp) {
      const display = titleCase(sp.name);
      const key = nameKey(display);
      const person = people.get(key);
      if (!person && display !== 'Operator') {
        addPerson(display, sp.title, null);
        knownNames = known();
      } else if (person && !person.title && sp.title) {
        person.title = sp.title;
        person.role = person.role ?? roleFromTitle(sp.title);
      }
      const name = display === 'Operator' ? 'Operator' : people.get(key)?.name ?? display;
      cur = { speaker: name, title: '', role: 'other', section, paras: [], lines: [[]] };
      turns.push(cur);
      if (sp.rest) cur.lines[0].push(sp.rest);
      if (sp.eatNext) i++;
      continue;
    }
    if (cur) cur.lines[cur.lines.length - 1].push(line);
    else if (header.length < 60) header.push(line);
  }

  // Lines → paragraphs; mark legal boilerplate.
  for (const t of turns) {
    t.paras = t.lines
      .map((ls) => ls.join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .map((text) => ({ text, boiler: BOILER.test(text) }));
  }
  const spoken = turns.filter((t) => t.paras.length);

  // --- Q&A start, when no heading marked it
  if (!qaFound) {
    const firstOther = spoken.findIndex((t) => t.speaker !== 'Operator');
    let start = spoken.findIndex(
      (t, idx) => idx > firstOther && t.speaker === 'Operator' && /\b(question|q\s?&\s?a)/i.test(t.paras.map((p) => p.text).join(' ')),
    );
    if (start < 0) {
      start = spoken.findIndex((t) => {
        const p = people.get(nameKey(t.speaker));
        return p?.role === 'analyst';
      });
    }
    if (start >= 0) {
      qaFound = true;
      spoken.forEach((t, idx) => (t.section = idx >= start ? 'qa' : 'prepared'));
    }
  }

  // --- Roles
  for (const [key, title] of mentionedTitles) {
    const p = people.get(key);
    if (p && !p.title) {
      p.title = title;
      p.role = roleFromTitle(title) ?? p.role;
    }
  }
  const firstSection = new Map<string, Section>();
  spoken.forEach((t) => !firstSection.has(t.speaker) && firstSection.set(t.speaker, t.section));
  const roleOf = (t: Turn): Role => {
    if (t.speaker === 'Operator') return 'operator';
    if (/^unidentified analyst|analyst$/i.test(t.speaker)) return 'analyst';
    if (/^(unidentified|unknown) (company|executive|corporate)/i.test(t.speaker)) return 'exec';
    if (/^(unidentified|unknown)/i.test(t.speaker)) return 'other';
    const p = people.get(nameKey(t.speaker));
    if (p?.role) return p.role;
    const handedRole = handedTo.get(nameKey(t.speaker));
    if (handedRole) return handedRole;
    if (firstSection.get(t.speaker) === 'prepared') return 'exec';
    return 'exec';
  };
  for (const t of spoken) {
    t.role = roleOf(t);
    t.title = people.get(nameKey(t.speaker))?.title ?? '';
  }
  // In the Q&A, someone not listed who speaks right after the operator
  // announces a question is almost always the analyst asking it.
  for (let i = 1; i < spoken.length; i++) {
    const t = spoken[i];
    const prev = spoken[i - 1];
    if (t.section !== 'qa' || t.role !== 'exec' || people.get(nameKey(t.speaker))?.role) continue;
    if (prev.speaker === 'Operator' && /question|line/i.test(prev.paras.map((p) => p.text).join(' ')) && firstSection.get(t.speaker) === 'qa') {
      for (const u of spoken) if (u.speaker === t.speaker) u.role = 'analyst';
    }
  }

  // --- Header details
  const headText = [...header, ...lines.slice(0, 40)].join('\n');
  const period = findPeriod(headText) ?? findPeriod(source) ?? { label: source.replace(/\.pdf$/i, '').slice(0, 24) || 'Call', fiscal: false, sort: Number.POSITIVE_INFINITY };
  const date = findDate(headText);
  if (!Number.isFinite(period.sort) && date) {
    const [y, mo] = date.split('-').map(Number);
    period.sort = y * 10 + Math.ceil(mo / 3) - 0.5;
    period.label = new Date(Date.UTC(y, mo - 1, 15)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  const { company, ticker } = findCompany(header.length ? header : lines.slice(0, 20), source);

  const execTurns = spoken.filter((t) => ['ceo', 'cfo', 'exec'].includes(t.role));
  if (spoken.length < 3 || !execTurns.length) warnings.push('Couldn’t tell who was speaking, so the whole text was read as one speaker.');
  else if (!qaFound) warnings.push('Couldn’t find where the Q&A starts, so everything was read as prepared remarks.');
  if (!Number.isFinite(period.sort)) warnings.push('Couldn’t find which quarter this is. Edit the label to place it in order.');

  // Nothing recognizable: keep the text as one block so it can still be scored.
  let finalTurns: Turn[] = spoken.map(({ lines: _l, ...t }) => t);
  if (spoken.length < 3 || !execTurns.length) {
    const paras = raw
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .map((text) => ({ text, boiler: BOILER.test(text) }));
    finalTurns = [{ speaker: 'Management', title: '', role: 'exec', section: 'prepared', paras }];
  }

  return {
    id: hashText(raw),
    source,
    company,
    ticker,
    period,
    date,
    turns: finalTurns,
    qaFound: qaFound && finalTurns.some((t) => t.section === 'qa'),
    warnings,
  };
}
