// Builds the copy of Strata that runs on claude.ai (the "Open in Claude" link).
//
// It builds the site with STRATA_TARGET=claude, takes the Strata page, and
// turns it into one self-contained file: the styles inlined, the page's
// scripts (PDF reader included) bundled into one, and links pointed back at
// the website. That file is published as a Claude Artifact with the "sample"
// capability, so Claude writes the zoom levels on each visitor's own Claude
// plan. Nothing here changes the website itself.
//
//   npm run build:claude   →   .strata-claude/strata.html
//
// Then ask Claude to republish it to the artifact linked in
// src/data/strata.json.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(ROOT, '.strata-claude');
const SITE_DIR = path.join(OUT, 'site');
const SITE = 'https://emrekaraarslan.com';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 1. Build the site with the claude.ai version of the Strata page.
execFileSync('npx', ['astro', 'build', '--outDir', SITE_DIR], {
  cwd: ROOT,
  stdio: ['ignore', 'ignore', 'inherit'],
  env: { ...process.env, STRATA_TARGET: 'claude' },
});
const page = readFileSync(path.join(SITE_DIR, 'projects/strata/index.html'), 'utf8');
const head = page.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
let body = page.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? '';

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(2).find((v) => v != null) ?? '';
const local = (url) => url.startsWith('/') && !url.startsWith('//');
const TYPES = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const dataUri = (url) => {
  const file = path.join(SITE_DIR, decodeURI(url.split(/[?#]/)[0]));
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) throw new Error(`Don't know how to embed ${url}`);
  return `data:${type};base64,${readFileSync(file).toString('base64')}`;
};
// Artifacts can't load files from elsewhere, so anything the CSS points at is embedded.
const inlineCss = (css) => css.replace(/url\(\s*(['"]?)(\/[^'")]+)\1\s*\)/g, (_, q, url) => (local(url) ? `url("${dataUri(url)}")` : _));

// 2. Keep the page's fonts and styles; drop what only makes sense on the website.
const keep = [];
for (const [tag] of head.matchAll(/<link\b[^>]*>|<style\b[^>]*>[\s\S]*?<\/style>/gi)) {
  if (/^<style/i.test(tag)) {
    keep.push(tag.replace(/(<style\b[^>]*>)([\s\S]*)(<\/style>)/i, (_, a, css, b) => a + inlineCss(css) + b));
    continue;
  }
  const rel = attr(tag, 'rel').toLowerCase();
  const href = attr(tag, 'href');
  if (rel === 'stylesheet' && local(href)) keep.push(`<style>${inlineCss(readFileSync(path.join(SITE_DIR, href), 'utf8'))}</style>`);
  else if (rel === 'stylesheet' || rel === 'preconnect') keep.push(tag);
}

// 3. The page's own scripts are replaced by one bundle below. Links go back to
// the website (artifacts open them in a new tab) and images are embedded.
body = body
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/\shref="(\/[^"]*)"/g, (m, url) => (local(url) ? ` href="${SITE}${url}"` : m))
  .replace(/\ssrc="(\/[^"]*)"/g, (m, url) => (local(url) ? ` src="${dataUri(url)}"` : m));

// 4. Bundle the scripts the page uses into one, PDF reader included. PDF.js
// normally reads PDFs in a separate worker file; here its worker code is
// bundled too and runs on the page itself (PDF.js's "fake worker"), since an
// artifact can't fetch a file.
const entry = path.join(OUT, 'entry.ts');
writeFileSync(entry, ['src/scripts/figures.ts', 'src/strata/app.ts'].map((f) => `import ${JSON.stringify(path.join(ROOT, f))};`).join('\n'));
const bundle = await rolldown({
  input: entry,
  cwd: ROOT,
  platform: 'browser',
  logLevel: 'warn',
  // PDF.js only uses import.meta to find its worker and extra files, which
  // this build doesn't load separately.
  transform: { define: { 'import.meta': '{}' } },
  plugins: [
    {
      name: 'pdf-worker-on-page',
      resolveId: (id) => (id.endsWith('pdf.worker.min.mjs?url') ? '\0pdf-worker' : null),
      load: (id) =>
        id === '\0pdf-worker'
          ? `import * as worker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs';\nglobalThis.pdfjsWorker = worker;\nexport default '';`
          : null,
    },
  ],
});
const { output } = await bundle.generate({ format: 'iife', codeSplitting: false, minify: true });
await bundle.close();
const js = output[0].code.replace(/<\/script/gi, '<\\/script');

// 5. One file. The artifact host adds <html>, <head> and <body> around it.
// In Claude's phone app the page runs under the status bar: keep the sticky
// zoom bar below it, and paint that strip in the page's background.
const PHONE = `<style>.zr-toolbar{top:env(safe-area-inset-top,0px)}body::before{content:"";position:fixed;inset:0 0 auto;height:env(safe-area-inset-top,0px);z-index:10;background:var(--bg)}</style>`;
const html = [
  '<title>Strata</title>',
  ...keep,
  PHONE,
  body.trim(),
  `<script>${js}</script>`,
  '',
].join('\n');
const file = path.join(OUT, 'strata.html');
writeFileSync(file, html);
rmSync(SITE_DIR, { recursive: true, force: true });
rmSync(entry, { force: true });
console.log(`Wrote ${path.relative(ROOT, file)} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`);
