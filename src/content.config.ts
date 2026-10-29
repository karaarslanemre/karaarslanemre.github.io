import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Treat empty values from the editor ("" or null) as "not set".
const blank = (v: unknown) => (v === '' || v === null ? undefined : v);

// Every Markdown file in src/content/writing is one entry in the Writing log.
// The editor (Pages CMS) writes these files for you; the fields below match
// the form in .pages.yml.
const writing = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/writing' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string().nullish(),
    link: z.string().nullish(),
    publication: z.string().nullish(),
    draft: z.boolean().nullish(),
  }),
});

// Every Markdown file in src/content/books is one book on the Books page.
const books = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/books' }),
  schema: z.object({
    title: z.string(),
    author: z.string().nullish(),
    status: z.string().nullish(),
    quote: z.string().nullish(),
    date: z.preprocess(blank, z.coerce.date().optional()),
    isbn: z.preprocess(blank, z.union([z.string(), z.number()]).optional()),
    cover: z.string().nullish(),
  }),
});

export const collections = { writing, books };
