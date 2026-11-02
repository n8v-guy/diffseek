import type { LabelFacet } from '../classification/labels';
import type { FileRecord, FilterState } from '../model/file';

import { matchesFacets } from './facets';

export interface CountBucket {
  counted: number;
  countedPaths: string[];
  unreadPaths: string[];
  viewed: number;
}

export type ViewedMark = 'empty' | 'filled' | 'partial';

export function addCountedFile(bucket: CountBucket, file: FileRecord): void {
  bucket.counted += 1;
  bucket.countedPaths.push(file.path);
  if (file.viewed) bucket.viewed += 1;
  else bucket.unreadPaths.push(file.path);
}

/** Paths the click will change. Filled clears every counted file; otherwise only unread ones. */
export function bucketActionPaths(bucket: CountBucket): string[] {
  return viewedMark(bucket.viewed, bucket.counted) === 'filled'
    ? bucket.countedPaths
    : bucket.unreadPaths;
}

export function emptyCountBucket(): CountBucket {
  return { counted: 0, countedPaths: [], unreadPaths: [], viewed: 0 };
}

export function fileViewedLabel(viewed: boolean): string {
  return viewed ? 'Unmark' : 'Mark viewed';
}

/** Tree folders: markable files that pass every filter except Viewed's hiding. */
export function includeCountedFiles(
  filters: FilterState,
): (file: FileRecord) => boolean {
  const counted = filtersIgnoringHides(filters, ['viewed']);
  return (file) =>
    file.capabilities.viewed && matchesFacets(file.labels, counted);
}

export function viewedMark(viewed: number, counted: number): ViewedMark {
  if (counted <= 0 || viewed <= 0) return 'empty';
  if (viewed >= counted) return 'filled';
  return 'partial';
}

const scopeViewedLabels: Record<ViewedMark, string> = {
  empty: 'Mark all viewed',
  filled: 'Unmark all',
  partial: 'Mark the rest viewed',
};

export function scopeAriaPressed(
  viewed: number,
  counted: number,
): 'false' | 'mixed' | 'true' {
  const state = viewedMark(viewed, counted);
  if (state === 'filled') return 'true';
  if (state === 'partial') return 'mixed';
  return 'false';
}

export function scopeViewedLabel(viewed: number, counted: number): string {
  return scopeViewedLabels[viewedMark(viewed, counted)];
}

function filtersIgnoringHides(
  filters: FilterState,
  facets: readonly LabelFacet[],
): FilterState {
  let next: FilterState | null = null;
  for (const facet of facets) {
    const values = (next ?? filters).get(facet);
    if (values?.has('true') !== true) continue;
    next ??= new Map(filters);
    const remaining = new Set(values);
    remaining.delete('true');
    next.set(facet, remaining);
  }
  return next ?? filters;
}
