import { filterMenus } from '@diffseek/github';

/**
 * Menu counts read "…" until a review's first metadata read finishes.
 * `settled` lists reviews whose counts settled on this page, so returning to
 * one in the same tab shows its counts at once.
 */
export function countsSettling(settled: ReadonlySet<string>, key: string): boolean {
  return !settled.has(key);
}

export function settleCounts(
  settled: Set<string>,
  key: string,
  root: Document,
  schedule: () => void,
): void {
  if (settled.has(key)) return;
  settled.add(key);
  if (filterMenus(root).length > 0) schedule();
}
