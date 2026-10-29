import { getCollection, type CollectionEntry } from 'astro:content';

export type Book = CollectionEntry<'books'>;
export type BookWithCover = Book & { coverUrl: string | null };

/** "Reading" books first, then everything else, newest first within each. */
export async function getBooks(): Promise<BookWithCover[]> {
  const books = await getCollection('books');
  books.sort((a, b) => (b.data.date?.valueOf() ?? 0) - (a.data.date?.valueOf() ?? 0));
  return Promise.all(books.map(async (book) => ({ ...book, coverUrl: await findCover(book) })));
}

export const isReading = (book: Book) => (book.data.status ?? '').trim().toLowerCase() === 'reading';

/** Removes quote marks the writer may have typed, so the page can add its own. */
export function cleanQuote(quote?: string | null): string {
  return (quote ?? '').trim().replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim();
}

// ---------------------------------------------------------------------------
// Covers are looked up automatically when the site is built (on GitHub), so
// adding a book only needs a title and author. Order of preference:
//   1. a cover uploaded in the editor
//   2. Open Library, by ISBN if one was given, otherwise by title + author
//   3. Google Books, the same way
// If nothing is found the page draws a plain typographic cover instead.
// ---------------------------------------------------------------------------

const cache = new Map<string, Promise<string | null>>();

export function findCover(book: Book): Promise<string | null> {
  const uploaded = book.data.cover?.trim();
  if (uploaded) return Promise.resolve(uploaded);

  const isbn = String(book.data.isbn ?? '').replace(/[^0-9Xx]/g, '');
  const key = isbn || `${book.data.title}|${book.data.author ?? ''}`.toLowerCase();
  if (!cache.has(key)) {
    cache.set(
      key,
      (async () =>
        (await fromOpenLibrary(book.data.title, book.data.author, isbn)) ??
        (await fromGoogleBooks(book.data.title, book.data.author, isbn)))(),
    );
  }
  return cache.get(key)!;
}

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'emrekaraarslan.com site build (me@emrekaraarslan.com)' },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function fromOpenLibrary(title: string, author?: string | null, isbn?: string) {
  const params = new URLSearchParams({ fields: 'cover_i', limit: '5' });
  if (isbn) params.set('isbn', isbn);
  else {
    params.set('title', title);
    if (author) params.set('author', author);
  }
  const data = await getJson(`https://openlibrary.org/search.json?${params}`);
  const id = data?.docs?.find((d: any) => d.cover_i)?.cover_i;
  return id ? `https://covers.openlibrary.org/b/id/${id}-L.jpg` : null;
}

async function fromGoogleBooks(title: string, author?: string | null, isbn?: string) {
  const q = isbn ? `isbn:${isbn}` : `intitle:${title}${author ? ` inauthor:${author}` : ''}`;
  const data = await getJson(
    `https://www.googleapis.com/books/v1/volumes?${new URLSearchParams({ q, maxResults: '5', printType: 'books' })}`,
  );
  const links = data?.items?.find((i: any) => i.volumeInfo?.imageLinks)?.volumeInfo?.imageLinks;
  const url: string | undefined = links?.thumbnail ?? links?.smallThumbnail;
  return url ? url.replace(/^http:/, 'https:').replace('&edge=curl', '') : null;
}
