import { describe, expect, it } from 'vitest';

import { reviewFromPath } from '../routing/page-route';

import { nonDefaultBase } from './base-branch';

const review = reviewFromPath('/Acme/Shop/pull/2/changes');
const link = (branch: string) =>
  `<a class="prc-BranchName-BranchName-x" href="/acme/shop/tree/${branch}">${branch}</a>`;
const data = (repository: Record<string, unknown>) =>
  `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
    payload: { route: { repository } },
  })}</script>`;
const page = (html: string) => {
  document.body.innerHTML = html;
  if (!review) throw new Error('No review');
  return nonDefaultBase(document, review);
};
const shop = { ownerLogin: 'acme', name: 'shop', defaultBranch: 'main' };

describe('nonDefaultBase', () => {
  it('returns the base from the pull header when it is not the default branch', () => {
    expect(page(link('release/v2') + link('feature') + data(shop))).toBe('release/v2');
  });

  it('reads a base that is the default branch as default', () => {
    expect(page(link('main') + link('feature') + data(shop))).toBeUndefined();
  });

  it('reads missing, foreign, or broken page data as default', () => {
    expect(page(link('release/v2'))).toBeUndefined();
    expect(page(link('release/v2') + data({ ...shop, name: 'other' }))).toBeUndefined();
    expect(
      page(`${link('release/v2')}<script type="application/json" data-target="react-app.embeddedData">{</script>`),
    ).toBeUndefined();
  });
});
