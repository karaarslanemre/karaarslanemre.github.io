import { getCollection, type CollectionEntry } from 'astro:content';

export type ProjectEntry = CollectionEntry<'projects'>;

/** All projects that aren't drafts, newest first. */
export async function getProjects(): Promise<ProjectEntry[]> {
  const entries = await getCollection('projects', ({ data }) => !data.draft);
  return entries.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

/** Accepts a path on this site ("/projects/strata/") or a full web address. */
export function projectHref(entry: ProjectEntry): string {
  const link = (entry.data.link ?? '').trim();
  if (!link) return '/projects/';
  if (/^https?:\/\//i.test(link) || link.startsWith('/')) return link;
  if (/^[\w-]+(\.[\w-]+)+/.test(link)) return `https://${link}`;
  return `/${link.replace(/^\/+/, '')}`;
}

export const isExternalProject = (entry: ProjectEntry) => /^https?:\/\//i.test(projectHref(entry));
