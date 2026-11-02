// A deliberately tiny Markdown renderer for AI-written text. Everything is
// escaped first, so nothing in a document or a model's reply can become
// live HTML on the page. Supports paragraphs, bullet and numbered lists,
// **bold**, *italic* and `code`. Links and images are shown as plain text.

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function inline(s: string): string {
  return escape(s)
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
}

const BULLET = /^\s*[-*•]\s+/;
const NUMBER = /^\s*\d{1,3}[.)]\s+/;

export function mdToHtml(src: string): string {
  const blocks = src.replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/);
  const out: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.every((l) => BULLET.test(l))) {
      out.push(`<ul>${lines.map((l) => `<li>${inline(l.replace(BULLET, ''))}</li>`).join('')}</ul>`);
    } else if (lines.every((l) => NUMBER.test(l))) {
      out.push(`<ol>${lines.map((l) => `<li>${inline(l.replace(NUMBER, ''))}</li>`).join('')}</ol>`);
    } else if (lines.length > 1 && lines.filter((l) => BULLET.test(l) || NUMBER.test(l)).length >= lines.length - 1) {
      // A lead-in line followed by a list.
      const [head, ...rest] = lines;
      const ordered = rest.every((l) => NUMBER.test(l));
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<p>${inline(head)}</p><${tag}>${rest.map((l) => `<li>${inline(l.replace(ordered ? NUMBER : BULLET, ''))}</li>`).join('')}</${tag}>`);
    } else {
      const text = lines.map((l) => l.replace(/^#{1,6}\s+/, '').trim()).join(' ');
      out.push(`<p>${inline(text)}</p>`);
    }
  }
  return out.join('');
}

/** Original document text: paragraphs and line-by-line lists, no formatting. */
export function plainToHtml(src: string): string {
  return src
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.split('\n').map(escape).join('<br>')}</p>`)
    .join('');
}
