import type { LabelFacet } from '../classification/labels';
import type { FileRecord, FilterState } from '../model/file';

import { matchesFilters } from './filters';

export type ViewedMark = 'empty' | 'partial' | 'filled';

export type CountBucket = {
  counted: number;
  viewed: number;
  unreadPaths: string[];
  countedPaths: string[];
};

export function emptyCountBucket(): CountBucket {
  return { counted: 0, viewed: 0, unreadPaths: [], countedPaths: [] };
}

export function addCountedFile(bucket: CountBucket, file: FileRecord): void {
  bucket.counted += 1;
  bucket.countedPaths.push(file.path);
  if (file.viewed) bucket.viewed += 1;
  else bucket.unreadPaths.push(file.path);
}

export function viewedMark(viewed: number, counted: number): ViewedMark {
  if (counted <= 0 || viewed <= 0) return 'empty';
  if (viewed >= counted) return 'filled';
  return 'partial';
}

/** Paths the click will change. Filled clears every counted file; otherwise only unread ones. */
export function bucketActionPaths(bucket: CountBucket): string[] {
  return viewedMark(bucket.viewed, bucket.counted) === 'filled'
    ? bucket.countedPaths
    : bucket.unreadPaths;
}

/**
 * Files that pass every active filter except the Viewed filter's hiding.
 * A file GitHub cannot mark is omitted so the circle matches the click.
 */
/** Tree folders: markable files that pass every filter except Viewed's hiding. */
export function includeCountedFiles(
  filters: FilterState,
): (file: FileRecord) => boolean {
  const counted = filtersIgnoringHides(filters, ['viewed']);
  return (file) =>
    file.capabilities.viewed && matchesFilters(file, counted);
}

export function fileViewedLabel(viewed: boolean): string {
  return viewed ? 'Mark as not viewed' : 'Mark as viewed';
}

export function scopeViewedLabel(
  viewed: number,
  counted: number,
  name?: string,
): string {
  if (viewedMark(viewed, counted) === 'filled') return fileViewedLabel(true);
  const remaining = counted - viewed;
  const where = name ? ` in ${name}` : '';
  return `Mark ${remaining} remaining${where} as viewed (${viewed} of ${counted} viewed)`;
}

export function folderViewedNotice(
  name: string,
  markViewed: boolean,
  count: number,
): string {
  const files = count === 1 ? 'file' : 'files';
  return markViewed
    ? `Marked ${count} visible ${files} in ${name} viewed`
    : `Unmarked ${count} visible ${files} in ${name}`;
}

export function categoryViewedNotice(
  name: string,
  markViewed: boolean,
  count: number,
  hidden = 0,
): string {
  const noun = categoryNoun(name, count);
  const suffix = hidden > 0 ? ` (${hidden} hidden)` : '';
  return markViewed
    ? `Marked all ${count} ${noun} viewed${suffix}`
    : `Unmarked all ${count} ${noun}${suffix}`;
}

function categoryNoun(name: string, count: number): string {
  const base = name.endsWith(' files') ? name.slice(0, -' files'.length) : name;
  return `${base} ${count === 1 ? 'file' : 'files'}`;
}

export function scopeAriaPressed(
  viewed: number,
  counted: number,
): 'true' | 'false' | 'mixed' {
  const state = viewedMark(viewed, counted);
  if (state === 'filled') return 'true';
  if (state === 'partial') return 'mixed';
  return 'false';
}

function filtersIgnoringHides(
  filters: FilterState,
  facets: readonly LabelFacet[],
): FilterState {
  let next: FilterState | null = null;
  for (const facet of facets) {
    const values = (next ?? filters).get(facet);
    if (!values?.has('true')) continue;
    next ??= new Map(filters);
    const remaining = new Set(values);
    remaining.delete('true');
    next.set(facet, remaining);
  }
  return next ?? filters;
}
