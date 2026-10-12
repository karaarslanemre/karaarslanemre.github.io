import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

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

export const collections = { writing };
