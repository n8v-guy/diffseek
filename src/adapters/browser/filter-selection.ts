import { isRecord } from './record';

const keyPrefix = 'diffseek:filters:';

/**
 * Fills `filters` with the selection this tab saved for the review, or else
 * hides the `hidden` default facets. Session storage is per tab, so a fresh
 * tab starts from the defaults.
 */
export function restoreFilterSelection<Facet extends string>(
  root: Document,
  review: string,
  filters: Map<Facet, Set<string>>,
  hidden: Iterable<Facet>,
): void {
  const saved = savedSelection(root, review);
  if (!saved) {
    for (const facet of hidden) filters.get(facet)?.add('true');
    return;
  }
  for (const [facet, values] of filters) {
    const stored = saved[facet];
    if (!Array.isArray(stored)) continue;
    for (const value of stored) if (typeof value === 'string') values.add(value);
  }
}

function savedSelection(root: Document, review: string): Record<string, unknown> | null {
  try {
    const saved: unknown = JSON.parse(
      root.defaultView?.sessionStorage.getItem(keyPrefix + review) ?? 'null',
    );
    return isRecord(saved) ? saved : null;
  } catch {
    return null;
  }
}

export function saveFilterSelection<Facet extends string>(
  root: Document,
  review: string,
  filters: Map<Facet, Set<string>>,
): void {
  const saved = JSON.stringify(
    Object.fromEntries([...filters].map(([facet, values]) => [facet, [...values]])),
  );
  try {
    const storage = root.defaultView?.sessionStorage;
    if (storage?.getItem(keyPrefix + review) !== saved) storage?.setItem(keyPrefix + review, saved);
  } catch {
    // Storage can be full or disabled; the selection then lasts one session.
  }
}
