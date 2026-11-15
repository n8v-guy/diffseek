import { isRecord } from '@diffseek/browser';

import type { ReviewRef } from '../routing/page-route';

/**
 * The pull's base branch when it is not the default branch. The base is the
 * first branch link in the pull header ("into base from head"); the default
 * comes from GitHub's embedded page data. Either one missing reads as default.
 */
export function nonDefaultBase(root: Document, review: ReviewRef): string | undefined {
  const prefix = `/${review.owner}/${review.repo}/tree/`;
  const href = [...root.querySelectorAll('a[class*="BranchName"]')]
    .map((link) => link.getAttribute('href') ?? '')
    .find((value) => value.toLowerCase().startsWith(prefix.toLowerCase()));
  if (href === undefined) return undefined;
  const base = decodeURIComponent(href.slice(prefix.length));
  const fallback = defaultBranch(root, review);
  return fallback === undefined || fallback === base ? undefined : base;
}

function defaultBranch(root: Document, review: ReviewRef): string | undefined {
  const same = (left: unknown, right: string) =>
    typeof left === 'string' && left.toLowerCase() === right.toLowerCase();
  let found: string | undefined;
  for (const script of root.querySelectorAll('script[data-target="react-app.embeddedData"]')) {
    try {
      JSON.parse(script.textContent, (_key, value: unknown) => {
        if (
          found === undefined &&
          isRecord(value) &&
          typeof value.defaultBranch === 'string' &&
          same(value.ownerLogin, review.owner) &&
          same(value.name, review.repo)
        ) {
          found = value.defaultBranch;
        }
        return value;
      });
    } catch {
      // Unreadable page data reads as default.
    }
    if (found !== undefined) return found;
  }
  return undefined;
}
