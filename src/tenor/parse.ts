// Turns the text of an earnings call transcript into who said what, in which
// part of the call.
//
// Transcripts come from many places (company sites, Seeking Alpha, the Motley
// Fool, S&P Capital IQ, LSEG/Refinitiv, FactSet, Bloomberg) and each lays them
// out a little differently, but they share a shape: the prepared remarks, then
// a question-and-answer session, with each speaker's name on its own line or
// at the start of a line, and often a list of participants. This finds those
// pieces from several independent clues, so no single layout is assumed:
//
//   who is speaking   participant lists; "Name -- Title" lines; "NAME:" labels,
//                     including ones wrapped over two lines; names the host
//                     hands over to ("over to Jane Doe", "comes from John Roe")
//   who is who        titles in lists and in passing ("Jane Doe, our CFO");
//                     the operator by what they say ("press star one"), even
//                     when transcribed under a first name
//   where Q&A starts  a heading; else the operator opening the queue; else the
//                     host asking for questions; else the first analyst
//   which call        the title, the operator's welcome, then the file name

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
  /** Set when Claude has read the call and corrected what the rules found. */
  checked?: 'claude';
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const PARTICLES = new Set(['de', 'da', 'del', 'della', 'der', 'di', 'du', 'la', 'le', 'van', 'von', 'bin', 'al', 'dos', 'das', 'st.', 'mc', 'y']);
const HONORIFIC = /^(dr|mr|mrs|ms|prof|sir)\.?$/i;
const NOT_NAMES = new Set(
  `presentation questions question answers answer prepared remarks operator disclaimer copyright transcript earnings
   call conference participants participant corporate executives executive analysts analyst thank thanks good hello
   okay yes no sure great welcome session management discussion section company representatives other opening closing
   end duration more contents table forward-looking statements safe harbor important notice page all rights reserved
   moderator definitions overview financial results highlights agenda introduction q&a note source editor`
    .split(/\s+/)
    .filter(Boolean),
);
// All-caps words that end in a colon at the start of a line but aren't speakers.
const NOT_LABELS = new Set(['HTTP', 'HTTPS', 'WWW', 'Q', 'A', 'NOTE', 'SOURCE', 'EDITOR', "EDITOR'S NOTE", 'DISCLAIMER', 'COPYRIGHT', 'TRANSCRIPT', 'PRESENTATION', 'QUESTION', 'ANSWER', 'DATE', 'TIME', 'EVENT', 'TOTAL', 'URL', 'PAGE']);

const TITLE_RE =
  /\b(chief|officer|ceo|cfo|coo|cto|cio|president|chair(?:man|woman|person)?|founder|director|vice[- ]president|vp|svp|evp|head|treasurer|controller|relations|ir|analyst|managing|partner|counsel|secretary|executive|manager|principal|strategist|economist|research|ir\s+officer)\b/i;
const FIRM_RE =
  /(?:&\s*co\b)|\b(securities|capital|partners|bank|banc|llc|inc\.?|corp\.?|corporation|co\.|group|markets|research|advisors|associates|asset|investments?|management|holdings|brothers|financial|equity|equities|global|international|ltd\.?|plc|ag|sa|lp|limited|company|bernstein|sachs|stanley|morgan|jpmorgan|citi|barclays|ubs|jefferies|evercore|cowen|wolfe|baird|piper|raymond|oppenheimer|needham|keybanc|mizuho|nomura|rbc|bmo|td|wells fargo|deutsche|hsbc|bofa|truist|stifel|loop|melius|redburn|exane|macquarie|daiwa)\b/i;

const PARTICIPANT_HEAD =
  /^(corporate participants|company participants|company representatives|executives|management|participants|conference call participants|call participants|analysts|presentation participants|other participants|company speakers|analyst speakers)\s*:?$/i;
const QA_HEAD =
  /^(questions?(\s*(and|&)\s*answers?)?(\s+session)?|question[- ]and[- ]answer(\s+session)?|q\s*&\s*a(\s+session)?)\s*:?$/i;
const PREPARED_HEAD = /^(presentation|prepared remarks|management discussion section|opening remarks|management remarks)\s*:?$/i;
const JUNK_LINE =
  /^(copyright|©|all rights reserved|this transcript|transcript (provided|produced)|source:|disclaimer|duration:|\[(music|technical difficulty|inaudible)\]$|[-=_*·.]{5,}$)/i;
// Lines that are a document's title, not a speaker ("Acme, Inc. (ACME) Q1 2025 Earnings Call")
const NOT_A_TITLE = /\b(earnings|transcript|conference call|results|Q[1-4]|[1-4]Q|20\d\d|fiscal)\b/i;
const BOILER =
  /forward[- ]looking (statements?|information)|safe harbou?r|non-gaap (financial )?measures?|actual results (may|could) differ|risk factors|reconciliation(s)? (of|to|between)|cautionary statement/i;

// What an operator says, whatever name the transcript files them under.
const OPERATOR_TEXT =
  /\b(press(?:ing)? (?:star|\*)|star (?:one|1|zero|0)\b|listen[- ]only|(?:first|next|last|following|final) question (?:comes|is coming|will come|is) from|please proceed with your question|your line is (?:now )?(?:open|live)|(?:conference|call) is being recorded|(?:this|that) (?:does )?concludes? (?:today's|the|our)|(?:turn|hand) (?:the )?(?:call|conference|floor) (?:back )?over to|you may (?:now )?begin|(?:open|poll|queue) for questions|disconnect your lines)/i;
const HANDOFF_END = /(you may (?:now )?begin|please (?:go ahead|proceed)(?: with your question)?|your line is (?:now )?(?:open|live)|(?:the )?floor is yours)[.!]?\s*$/i;
const QA_OPEN =
  /\b(?:(?:begin|start|conduct(?:ing)?|open(?:ing)?|now (?:take|open)|move to|turn to) (?:the |our )?(?:question[- ]and[- ]answer|q\s?&\s?a|questions?)|(?:first|initial) question (?:comes|is|will come) from|queue for questions|poll(?:ing)? for questions|open (?:up )?the (?:line|lines|call|floor) (?:for|to) questions)/i;
const HOST_ASKS_FOR_QA = /\b(?:open|start|begin|ready (?:for|to start)|take|move (?:on )?to|go ahead and open|poll for)\b[^.]{0,40}\b(?:q\s?&\s?a|questions?)\b/i;

const NAME_TOKEN = "[A-Z][\\w'’.\\-]+";
const NAME = `${NAME_TOKEN}(?:\\s+${NAME_TOKEN}){1,3}`;
const HON = '(?:(?:Dr|Mr|Mrs|Ms|Prof)\\.?\\s+)?';

function nameTokens(s: string): string[] | null {
  const clean = s.replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > 42 || /\d/.test(clean)) return null;
  const tokens = clean.split(' ').filter((t) => !HONORIFIC.test(t));
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

/** A loose key so "Dr. Timothy D. Cook", "Tim Cook" and "TIM COOK" can be matched. */
export function nameKey(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/\s+/)
    .filter((t) => t && !PARTICLES.has(t) && !HONORIFIC.test(t) && !/^[a-z]\.?$/.test(t) && !/^(jr|sr|ii|iii|iv)\.?$/.test(t));
  if (!tokens.length) return name.toLowerCase();
  return `${tokens[0][0]}|${tokens[tokens.length - 1].replace(/[^a-z-]/g, '')}`;
}

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** The same person under a slightly different spelling ("Scneider" for "Schneider"). */
function closeKey<T>(map: Map<string, T>, key: string): T | undefined {
  if (map.has(key)) return map.get(key);
  const [initial, last] = key.split('|');
  if (!last || last.length < 5) return undefined;
  for (const [k, v] of map) {
    const [i2, l2] = k.split('|');
    if (i2 === initial && l2 && Math.abs(l2.length - last.length) <= 2 && editDistance(l2, last) <= 2) return v;
  }
  return undefined;
}

const titleCase = (s: string) =>
  s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s\-'’.])([a-z])/g, (_, a, b) => a + b.toUpperCase()) : s;

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

const QW = '(first|second|third|fourth|1st|2nd|3rd|4th)';
const PERIOD_PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => Period]> = [
  // Q3 2025, Q3 FY25, Q3'25
  [/\bQ([1-4])\s*(?:of\s+)?(FY|F|fiscal(?:\s+year)?)?\s*['’]?(\d{4}|\d{2})\b/i, (m) => makePeriod(Number(m[1]), year4(m[3]), !!m[2])],
  // 3Q 2025, 3Q25, 3QFY25
  [/\b([1-4])Q\s*(FY|F)?\s*['’]?(\d{4}|\d{2})\b/i, (m) => makePeriod(Number(m[1]), year4(m[3]), !!m[2])],
  // FY2025 Q3
  [/\b(FY|fiscal(?:\s+year)?)\s*['’]?(\d{4}|\d{2})\s*[-,]?\s*Q([1-4])\b/i, (m) => makePeriod(Number(m[3]), year4(m[2]), true)],
  // (fiscal) third quarter (and full year) (of fiscal) 2025
  [
    new RegExp(`\\b(fiscal\\s+)?${QW}[- ]quarter(?:\\s+(?:and|&)\\s+(?:the\\s+)?(?:full|fiscal)[- ]year)?(?:\\s+(?:of\\s+)?(?:(fiscal)(?:\\s+year)?|(FY)))?\\s*['’]?(\\d{4})\\b`, 'i'),
    (m) => makePeriod(QWORD[m[2].toLowerCase()], year4(m[5]), !!(m[1] || m[3] || m[4])),
  ],
  // fiscal 2025 third quarter
  [new RegExp(`\\b(fiscal(?:\\s+year)?|FY)\\s*['’]?(\\d{4}|\\d{2})\\s+${QW}[- ]quarter\\b`, 'i'), (m) => makePeriod(QWORD[m[3].toLowerCase()], year4(m[2]), true)],
  // 2025 Q3
  [/\b(20\d{2})\s*[- ]?Q([1-4])\b/i, (m) => makePeriod(Number(m[2]), Number(m[1]), false)],
];

/** The earliest quarter mentioned in the text, in any of the usual forms. */
export function findPeriod(text: string): Period | null {
  const t = text.replace(/[_]+/g, ' ');
  let best: { at: number; p: Period } | null = null;
  for (const [re, make] of PERIOD_PATTERNS) {
    const m = t.match(re);
    if (m && m.index != null && (!best || m.index < best.at)) best = { at: m.index, p: make(m) };
  }
  return best?.p ?? null;
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

const PERIOD_WORD = String.raw`(?:Q[1-4]|[1-4]Q\d{0,4}|first|second|third|fourth|1st|2nd|3rd|4th|FY\s?'?\d{0,4}|fiscal|full[- ]year|20\d{2})`;

function cleanCompany(s: string): string {
  const t = s
    .replace(/^(edited |event |corrected |final )?transcript( of)?[:\s-]*/i, '')
    .replace(/^thomson reuters streetevents\s*/i, '')
    .replace(/\s*(earnings )?(conference )?call( transcript)?$/i, '')
    .replace(/[\s,:;–—-]+$/, '')
    .replace(/^the\s+/i, '')
    .trim();
  // A company name, not a sentence or a label.
  if (!t || t.length > 60 || /[:!?]/.test(t) || t.split(/\s+/).length > 7) return '';
  if (/^(welcome|good|thank|greetings|hello|ladies|edited|Q[1-4]\b|[1-4]Q|FY|\d)/i.test(t)) return '';
  if (new RegExp(`\\b${PERIOD_WORD}$`, 'i').test(t)) return '';
  return t;
}

function findCompany(headerLines: string[], opening: string, source: string): { company: string; ticker: string } {
  for (const line of headerLines) {
    const m = line.match(/^(.+?)\s*\((?:(?:NYSE|NASDAQ|Nasdaq|NYSE American|NYSEAMERICAN|TSX|LSE|OTC|AMEX)\s*:\s*)?([A-Z][A-Z.\-]{0,6})\)/);
    if (m && cleanCompany(m[1])) return { company: cleanCompany(m[1]), ticker: m[2] };
  }
  for (const line of headerLines) {
    const m = line.match(new RegExp(`^(?:${PERIOD_WORD})(?:\\s+quarter)?(?:\\s+(?:FY\\s*)?['’]?\\d{2,4})?\\s+(.+?)\\s+(?:earnings|results|conference call)\\b`, 'i'));
    if (m && cleanCompany(m[1])) return { company: cleanCompany(m[1]), ticker: '' };
  }
  for (const line of headerLines) {
    const m = line.match(new RegExp(`^(.+?)[\\s,:–—-]+${PERIOD_WORD}\\b.*\\b(earnings|results|conference call|call)\\b`, 'i'));
    if (m && cleanCompany(m[1])) return { company: cleanCompany(m[1]), ticker: '' };
  }
  // The operator's welcome: "welcome to the Acme Corp first quarter 2025 call"
  const w = opening.match(new RegExp(`\\bwelcome (?:everyone |everybody )?to (?:the |today's )?(.{2,60}?)(?:['’]s)?\\s+${PERIOD_WORD}`, 'i'));
  if (w && cleanCompany(w[1])) return { company: cleanCompany(w[1]), ticker: '' };
  const fromFile = source
    .replace(/\.pdf$/i, '')
    .replace(/^[0-9a-f]{6,}-/i, '') // an upload prefix
    .replace(/[_]+/g, ' ')
    .replace(/\b(Q[1-4]|[1-4]Q\d{0,4}|FY\s?\d{2,4}|20\d{2}|earnings|call|transcript|conference|results|financial|fiscal|full|year|quarter|first|second|third|fourth|and)\b/gi, ' ')
    .replace(/[\s-]+/g, ' ')
    .trim();
  return { company: cleanCompany(fromFile), ticker: '' };
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

function roleFromTitle(title: string): Role | null {
  if (!title) return null;
  if (/^operator$/i.test(title.trim())) return 'operator';
  if (/\b(chief executive|ceo)\b/i.test(title)) return 'ceo';
  if (/\b(chief financial|cfo)\b/i.test(title)) return 'cfo';
  if (/\banalyst\b/i.test(title)) return 'analyst';
  if (/\b(chief|officer|president|chair|founder|vice[- ]president|vp|svp|evp|treasurer|controller|investor relations|relations|ir|counsel|secretary|executive|head of|director)\b/i.test(title))
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

const CAPS_LABEL = /^([A-Z][A-Z'’.\-]*(?:\s+[A-Z][A-Z'’.\-]*){0,4})\s*:(?!\/)(?:\s*(\S.*))?$/;

export function parseTranscript(raw: string, source = 'Pasted text'): Call {
  let lines = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[   ]/g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim());
  const warnings: string[] = [];

  // A speaker label wrapped over two lines, on its own ("JOSHUA" then
  // "BUCHALTER: Thanks…") or in a narrow left column beside the speech
  // ("JOSHUA Thanks for…" then "BUCHALTER: taking my question…").
  const merged: string[] = [];
  const LAST_LABEL = /^([A-Z][A-Z'’.\-]{1,25}(?:\s+[A-Z][A-Z'’.\-]*){0,2})\s*:\s*(.*)$/;
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i];
    const b = lines[i + 1] ?? '';
    const last = b.match(LAST_LABEL);
    if (last && !NOT_LABELS.has(last[1])) {
      if (/^[A-Z][A-Z'’.\-]{1,20}$/.test(a)) {
        merged.push(`${a} ${b}`);
        i++;
        continue;
      }
      const first = a.match(/^([A-Z][A-Z'’.\-]{1,20})\s+(\S.*)$/);
      if (first && /[a-z]/.test(first[2].split(' ')[0]) && isName(titleCase(`${first[1]} ${last[1]}`))) {
        merged.push(`${first[1]} ${last[1]}: ${first[2]} ${last[2]}`.trim());
        i++;
        continue;
      }
    }
    merged.push(a);
  }
  lines = merged;

  // --- People: participant lists (top or end), titles in passing, hand-offs
  const people = new Map<string, Person>(); // nameKey → person
  const skip = new Set<number>();
  const findPerson = (name: string) => closeKey(people, nameKey(name));
  const addPerson = (name: string, title: string, role: Role | null) => {
    const display = titleCase(name.replace(/\s+/g, ' ').trim()).replace(/^(?:Dr|Mr|Mrs|Ms|Prof)\.?\s+/i, '');
    const existing = findPerson(display);
    const r = role === 'analyst' ? (/(chief|officer|president)/i.test(title) ? roleFromTitle(title) : 'analyst') : roleFromTitle(title) ?? role;
    if (!existing) people.set(nameKey(display), { name: display, title: title.trim(), role: r });
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

  // Names the operator or host hands over to, with the analyst's firm when
  // given ("the next question comes from the line of Jane Doe with Acme").
  const flat = lines.join(' ');
  const handedTo = new Map<string, { role: Role; name: string; title: string }>();
  for (const m of flat.matchAll(new RegExp(`\\b(?:comes|is coming|is|will come|coming) from(?: the line of)?\\s+${HON}(${NAME})(?:\\s+(?:with|from|of|at)\\s+([A-Z][^.;,]{1,50}?))?(?=[.;,]|\\s+(?:please|your line|go ahead)|$)`, 'g'))) {
    handedTo.set(nameKey(m[1]), { role: 'analyst', name: m[1], title: (m[2] ?? '').trim() });
  }
  for (const m of flat.matchAll(new RegExp(`\\b(?:over to|turn it to|hand it to|pass it to|introduce(?: to you)?|welcome)\\s+(?:our [\\w ,]+?,\\s+)?${HON}(${NAME})`, 'g'))) {
    if (!handedTo.has(nameKey(m[1])) && isName(m[1])) handedTo.set(nameKey(m[1]), { role: 'exec', name: m[1], title: '' });
  }
  // Titles in passing: "Dr. Jane Doe, our Chair and CEO, and John Roe, Executive Vice President, CFO and Treasurer."
  const mentioned = new Map<string, string>();
  for (const m of flat.matchAll(
    new RegExp(`${HON}(${NAME}),\\s+(?:(?:our|the|its|their)\\s+)?([^.;]{2,90}?)(?=\\.(?:\\s|$)|;|,?\\s+and\\s+${HON}${NAME_TOKEN}\\s+${NAME_TOKEN}|,\\s+(?:will|who|is|are|has|joining|together)\\b|\\s+(?:will|who|is|are|has)\\b)`, 'g'),
  )) {
    const title = m[2].replace(/[,\s]+$/, '').trim();
    if (!isName(m[1]) || title.length > 80 || !TITLE_RE.test(title.slice(0, 60)) || /\b(question|line|thank)/i.test(title)) continue;
    if (!mentioned.has(nameKey(m[1]))) mentioned.set(nameKey(m[1]), title);
  }
  const handed = (name: string) => !!closeKey(handedTo, nameKey(name)) || !!closeKey(mentioned, nameKey(name));

  // --- How often each candidate speaker label appears, to tell names from text
  const standalone = new Map<string, number>();
  const inline = new Map<string, number>();
  const caps = new Map<string, number>();
  for (const line of lines) {
    const bare = line.replace(/\s*\[\d+\]$/, '').replace(/:$/, '');
    if (isName(bare)) standalone.set(bare.toLowerCase(), (standalone.get(bare.toLowerCase()) ?? 0) + 1);
    const m = line.match(/^([A-Z][A-Za-z'’.\- ]{2,40}?):\s+\S/);
    if (m && isName(m[1])) inline.set(m[1].toLowerCase(), (inline.get(m[1].toLowerCase()) ?? 0) + 1);
    const c = line.match(CAPS_LABEL);
    if (c && c[1].replace(/[^A-Z]/g, '').length >= 2 && !NOT_LABELS.has(c[1])) caps.set(c[1], (caps.get(c[1]) ?? 0) + 1);
  }
  // An all-caps label is a speaker if it recurs, or looks like a full name.
  const capsSpeaker = (label: string) => {
    const n = caps.get(label) ?? 0;
    return n >= 2 || (n >= 1 && (isName(label) || handed(label) || /^(OPERATOR|MODERATOR)$/.test(label)));
  };

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

    // "LISA SU: Thank you…", "JOHN: Greetings…"
    const c = line.match(CAPS_LABEL);
    if (c && c[1].replace(/[^A-Z]/g, '').length >= 2 && !NOT_LABELS.has(c[1]) && capsSpeaker(c[1])) {
      return { name: c[1], title: '', rest: c[2] ?? '', eatNext: false };
    }

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
    if (isName(bare) && ((standalone.get(bare.toLowerCase()) ?? 0) >= 2 || !!findPerson(bare) || handed(bare))) {
      const eat = !!next && titleish(next) && !isName(next) && next.length < 90;
      return { name: bare, title: eat ? next : '', rest: '', eatNext: eat };
    }
    return null;
  }

  // --- Walk the lines into turns
  type Draft = Turn & { lines: string[][] };
  const turns: Draft[] = [];
  let section: Section = 'prepared';
  let qaFound = false;
  let cur: Draft | null = null;
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
      const display = sp.name === 'Operator' ? 'Operator' : titleCase(sp.name).replace(/^(?:Dr|Mr|Mrs|Ms|Prof)\.?\s+/i, '');
      let person = display === 'Operator' ? undefined : findPerson(display);
      if (!person && display !== 'Operator' && display.split(' ').length > 1) {
        addPerson(display, sp.title, null);
        knownNames = known();
        person = findPerson(display);
      } else if (person && !person.title && sp.title) {
        person.title = sp.title;
        person.role = person.role ?? roleFromTitle(sp.title);
      }
      cur = { speaker: person?.name ?? display, title: sp.title, role: 'other', section, paras: [], lines: [[]] };
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
  let spoken = turns.filter((t) => t.paras.length);
  const textOf = (t: Turn) => t.paras.map((p) => p.text).join(' ');

  // --- Who is the operator: by name, or by what they say
  const bySpeaker = new Map<string, Draft[]>();
  for (const t of spoken) bySpeaker.set(t.speaker, [...(bySpeaker.get(t.speaker) ?? []), t]);
  const operators = new Set<string>(['Operator']);
  for (const [name, list] of bySpeaker) {
    if (findPerson(name)?.role && findPerson(name)!.role !== 'operator') continue;
    const hits = list.filter((t) => OPERATOR_TEXT.test(textOf(t))).length;
    if ((hits >= 2 && hits / list.length >= 0.5) || (hits >= 1 && list[0] === spoken[0] && list.length <= 2)) operators.add(name);
  }

  // A transcript that skips a speaker label after the operator hands over
  // ("…over to Jane Doe. You may begin." followed by Jane's remarks): split it.
  const split: Draft[] = [];
  for (const t of spoken) {
    split.push(t);
    if (!operators.has(t.speaker) || t.paras.length < 2) continue;
    const k = t.paras.findIndex((p, idx) => idx < t.paras.length - 1 && HANDOFF_END.test(p.text));
    if (k < 0) continue;
    const named = [...t.paras[k].text.matchAll(new RegExp(`\\b(?:over to|introduce(?: to you)?|from(?: the line of)?|welcome)\\s+${HON}(${NAME})`, 'g'))].pop();
    if (!named) continue;
    const who = findPerson(named[1])?.name ?? titleCase(named[1]);
    split.push({ ...t, speaker: who, title: '', paras: t.paras.slice(k + 1), lines: [] });
    t.paras = t.paras.slice(0, k + 1);
  }
  spoken = split;

  // --- Q&A start, when no heading marked it
  if (!qaFound) {
    const firstOther = spoken.findIndex((t) => !operators.has(t.speaker));
    let start = spoken.findIndex((t, idx) => idx > firstOther && operators.has(t.speaker) && QA_OPEN.test(textOf(t)));
    const host = spoken.findIndex((t, idx) => idx > firstOther && !operators.has(t.speaker) && HOST_ASKS_FOR_QA.test(t.paras[t.paras.length - 1]?.text ?? ''));
    if (host >= 0 && (start < 0 || host + 1 < start)) start = host + 1;
    if (start < 0) {
      start = spoken.findIndex((t) => (findPerson(t.speaker)?.role ?? closeKey(handedTo, nameKey(t.speaker))?.role) === 'analyst');
    }
    if (start > 0 && start < spoken.length) {
      qaFound = true;
      spoken.forEach((t, idx) => (t.section = idx >= start ? 'qa' : 'prepared'));
    }
  }

  // --- Roles
  for (const [key, title] of mentioned) {
    const p = closeKey(people, key);
    if (p && !p.title) {
      p.title = title;
      p.role = roleFromTitle(title) ?? p.role;
    }
  }
  for (const [key, h] of handedTo) {
    const p = closeKey(people, key);
    if (p && !p.title && h.title) p.title = h.title;
    if (p && !p.role) p.role = h.role;
  }
  const firstSection = new Map<string, Section>();
  spoken.forEach((t) => !firstSection.has(t.speaker) && firstSection.set(t.speaker, t.section));
  const roleOf = (t: Turn): Role => {
    if (operators.has(t.speaker)) return 'operator';
    if (/^unidentified analyst|analyst$/i.test(t.speaker)) return 'analyst';
    if (/^(unidentified|unknown) (company|executive|corporate)/i.test(t.speaker)) return 'exec';
    if (/^(unidentified|unknown)/i.test(t.speaker)) return 'other';
    const p = findPerson(t.speaker);
    if (p?.role) return p.role;
    const fromTitle = roleFromTitle(t.title);
    if (fromTitle) return fromTitle;
    const h = closeKey(handedTo, nameKey(t.speaker));
    if (h) return h.role;
    return 'exec';
  };
  for (const t of spoken) {
    t.role = roleOf(t);
    const p = findPerson(t.speaker);
    t.title = t.role === 'operator' ? 'Operator' : p?.title || t.title || closeKey(handedTo, nameKey(t.speaker))?.title || '';
  }
  // In the Q&A, someone not listed who speaks right after the operator
  // announces a question is almost always the analyst asking it.
  for (let i = 1; i < spoken.length; i++) {
    const t = spoken[i];
    const prev = spoken[i - 1];
    if (t.section !== 'qa' || t.role !== 'exec' || findPerson(t.speaker)?.role) continue;
    if (prev.role === 'operator' && /question|line/i.test(textOf(prev)) && firstSection.get(t.speaker) === 'qa') {
      for (const u of spoken) if (u.speaker === t.speaker) u.role = 'analyst';
    }
  }

  // --- Header details
  const headText = [...header, ...lines.slice(0, 40)].join('\n');
  const opening = spoken.slice(0, 3).map(textOf).join(' ').slice(0, 3000);
  const period =
    findPeriod(header.join('\n')) ??
    findPeriod(opening) ??
    findPeriod(headText) ??
    findPeriod(source) ?? { label: source.replace(/\.pdf$/i, '').replace(/^[0-9a-f]{6,}-/i, '').slice(0, 24) || 'Call', fiscal: false, sort: Number.POSITIVE_INFINITY };
  const date = findDate(headText);
  if (!Number.isFinite(period.sort) && date) {
    const [y, mo] = date.split('-').map(Number);
    period.sort = y * 10 + Math.ceil(mo / 3) - 0.5;
    period.label = new Date(Date.UTC(y, mo - 1, 15)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  const { company, ticker } = findCompany(header.length ? header.slice(0, 12) : lines.slice(0, 5), opening, source);

  const execTurns = spoken.filter((t) => ['ceo', 'cfo', 'exec'].includes(t.role));
  if (spoken.length < 3 || !execTurns.length) warnings.push('Couldn’t tell who was speaking, so the whole text was read as one speaker.');
  else if (!qaFound) warnings.push('Couldn’t find where the Q&A starts, so everything was read as prepared remarks.');
  if (!Number.isFinite(period.sort)) warnings.push('Couldn’t find which quarter this is. Edit the label to place it in order.');
  if (!company) warnings.push('Couldn’t find the company’s name.');

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

// ---------------------------------------------------------------------------
// Corrections from a reader (Claude, in the claude.ai copy)
// ---------------------------------------------------------------------------

export interface Reading {
  company?: string;
  ticker?: string;
  quarter?: number;
  year?: number;
  fiscal?: boolean;
  speakers?: Array<{ name?: string; role?: string; title?: string }>;
  qaStartsAtTurn?: number | null;
  note?: string;
}

const ROLES: Role[] = ['ceo', 'cfo', 'exec', 'analyst', 'operator', 'other'];

/**
 * Applies what a reader worked out about the call: who's who, where the Q&A
 * starts, the company and the quarter. Returns plain notes on what changed.
 */
export function applyReading(call: Call, r: Reading, keepLabel: boolean): string[] {
  const notes: string[] = [];
  const roles = new Map<string, { role: Role; title: string }>();
  for (const s of r.speakers ?? []) {
    const role = String(s.role ?? '').toLowerCase() as Role;
    if (!s.name || !ROLES.includes(role)) continue;
    roles.set(nameKey(String(s.name)), { role, title: String(s.title ?? '').slice(0, 80) });
    roles.set(`label:${String(s.name).toLowerCase()}`, { role, title: String(s.title ?? '').slice(0, 80) });
  }
  let changedRoles = 0;
  for (const t of call.turns) {
    const hit = roles.get(`label:${t.speaker.toLowerCase()}`) ?? closeKey(roles, nameKey(t.speaker));
    if (!hit) continue;
    if (hit.role !== t.role) changedRoles++;
    t.role = hit.role;
    if (hit.title) t.title = hit.role === 'operator' ? 'Operator' : hit.title;
  }
  if (changedRoles) notes.push(`corrected ${changedRoles === 1 ? 'one speaker’s role' : `${changedRoles} speakers’ roles`}`);

  const start = r.qaStartsAtTurn;
  if (typeof start === 'number' && Number.isInteger(start) && start > 0 && start < call.turns.length) {
    const before = call.turns.findIndex((t) => t.section === 'qa');
    call.turns.forEach((t, i) => (t.section = i >= start ? 'qa' : 'prepared'));
    call.qaFound = true;
    if (before !== start) notes.push(before < 0 ? 'found where the Q&A starts' : 'moved the start of the Q&A');
  }

  const company = String(r.company ?? '').trim();
  if (company && company.length <= 60 && company !== call.company) {
    call.company = company;
    notes.push(`named the company ${company}`);
  }
  const ticker = String(r.ticker ?? '').trim().toUpperCase();
  if (/^[A-Z][A-Z.\-]{0,6}$/.test(ticker)) call.ticker = ticker;

  const q = Number(r.quarter);
  const y = Number(r.year);
  if (!keepLabel && q >= 1 && q <= 4 && y >= 1990 && y <= 2100) {
    const p = makePeriod(q, y, !!r.fiscal);
    if (p.label !== call.period.label) notes.push(`set the quarter to ${p.label}`);
    call.period = p;
  }

  call.warnings = call.warnings.filter(
    (w) => !(call.qaFound && /Q&A starts/.test(w)) && !(call.company && /company’s name/.test(w)) && !(Number.isFinite(call.period.sort) && /which quarter/.test(w)),
  );
  call.checked = 'claude';
  return notes;
}
