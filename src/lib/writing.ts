import { getCollection, type CollectionEntry } from 'astro:content';

export type WritingEntry = CollectionEntry<'writing'>;

/** All entries that aren't drafts, newest first. */
export async function getPublishedWriting(): Promise<WritingEntry[]> {
  const entries = await getCollection('writing', ({ data }) => !data.draft);
  return entries.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

/** True when the entry points to a piece published somewhere else. */
export function isExternal(entry: WritingEntry): boolean {
  return Boolean(entry.data.link && entry.data.link.trim());
}

export function entryHref(entry: WritingEntry): string {
  return isExternal(entry) ? entry.data.link!.trim() : `/writing/${entry.id}/`;
}

export function formatMonth(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function formatFullDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function readingMinutes(body?: string): number {
  const words = (body ?? '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}
