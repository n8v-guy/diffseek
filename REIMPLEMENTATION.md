# Reimplementing DiffSeek from first principles

This guide describes the behavior and architecture needed to build DiffSeek
from first principles. It derives the design from the review problem and gives
an implementation and verification order.

## 1. The problem and the boundary

A large GitHub pull request creates two costs: finding the files relevant to a
reviewer, and repeatedly marking known categories of files viewed. DiffSeek
reduces those costs inside GitHub's **Files changed** experience. GitHub remains
the source of truth for membership, order, diff content, viewed state, and the
actual viewed action. The extension owns labels, filter selection, visibility,
aggregate progress, and its own controls. It has no review backend and uses the
user's GitHub session.

That boundary dictates the primary loop:

```text
GitHub route and rendered DOM
  -> normalized observation (file tree, diff regions, native capabilities)
  -> retained review catalog + repository metadata
  -> file labels + one filter predicate
  -> pure desired view (tree, diffs, menu, viewed scopes)
  -> minimal DOM writes and queued native clicks
  -> observe GitHub's response, then reconcile
```

The implementation layers follow that loop: pure review and metadata policy;
page, network, and storage adapters; session orchestration; and thin browser
extension entry points. Keep observation, policy, and effects separate so
GitHub markup changes cannot alter filtering rules.

## 2. Start with a disposable review session

Identify a review by repository and pull number, derived from the URL. A classic
`/files` URL redirects to the modern changes view before starting, except for
signed-out pages. On navigation, stop the old session, cancel its observers and
actions, and guard pending metadata results with a generation. A late result
must never update the next review.

The first session can paint from cached or bundled metadata immediately. Later
reads refine classification. Review state is disposable; only the special
defaults and the tab's saved selection survive as described below. This makes
navigation and GitHub's page replacement ordinary lifecycle events.

## 3. Observe facts; do not treat DOM nodes as durable objects

The file tree establishes review membership and order. Each file row supplies
its path, status, and `#diff-…` anchor; the matching diff region supplies
viewed and collapse capabilities, GitHub's owner tooltip, and any generated
notice. Join a row to a region only when that anchor identifies exactly one
region. A missing or duplicated panel leaves a file in the catalog without
native capabilities. A malformed or incomplete row is unavailable and stays
visible and native. Renames bind through the tree's anchor, not a guessed diff
header path.

Return normalized file records and functions that **re-find** the current tree
row, region, and viewed button. GitHub mounts and replaces nodes while streaming
the diff; retaining a button reference across an action is incorrect. The page
adapter is the only place that should understand GitHub selectors. Record page
fixtures and test this boundary against missing, duplicate, renamed, streamed,
and replaced regions; future GitHub markup still needs live verification.

Keep a path-keyed catalog across short-lived missing panels or empty rescans.
Preserve labels, known owners, and the fact that GitHub displayed its generated
notice; refresh viewed state and capabilities from live controls when present.
Changing panels alone must not erase classification. Recompute classification
when paths, statuses, owners, generated notice, or metadata change.

## 4. Build labels from independent sources

Each observed file gets labels for owner, group, format, generated, and change
status; a viewed file also gets `viewed=true`. Owner comes from the selected
CODEOWNERS rule, or GitHub's owner tooltip when no rule matches. Group and
language may come from `.gitattributes`. If any repository attribute rule sets
`group` or `linguist-language`, that repository guidance replaces **all**
built-in group and format rules. Without such guidance, built-in rules apply;
an unmatched group uses `No groups` and an unmatched format uses the extension.
Generated is true if attributes or a built-in rule say so, **or** GitHub shows
its precise “not rendered by default” placeholder. Status comes from the file
tree. Compose these sources in one labeling step.

Preserve fallback labels (`No owner`, `No groups`, `No extension`) in data, so
mixed categories stay filterable. Omit a facet from the menu when its sole
value is its fallback.
Multiple owners are multiple values of the same facet, not separate files.

For repository rules, use one CODEOWNERS location in GitHub's precedence order:
`.github/CODEOWNERS`, root `CODEOWNERS`, then `docs/CODEOWNERS`. Within that file,
the last matching rule wins, including a rule with no owners. Apply nested
`.gitattributes` from ancestor directories in order; later matching assignments
override earlier ones. Only `group`, `linguist-language`, and
`linguist-generated` are interpreted. Patterns support `*` and `?` within a
path segment, `**` across segments, and `**/` for optional ancestor
directories. A CODEOWNERS pattern without a slash matches a name at any depth;
a leading slash anchors it to the root, and a trailing slash includes
descendants. Ignore unsupported CODEOWNERS negation and character classes.
Attribute patterns without a slash match file names in their directory tree;
those with a slash match relative to their attributes file. Assignments can
set, unset, or reset an attribute, with later matches winning. This is a
deliberate subset of Git and GitHub pattern syntax.

## 5. Make metadata useful without blocking the review

The metadata model has two levels: a cached branch listing and file texts, then
an overlay for metadata files actually changed by this pull. A changed file
replaces its entire branch counterpart; a deletion removes it. Unchanged
metadata never merges line by line. Classify with the cached copy first, then
update when reads finish.

For the default branch, one authenticated GitHub code search lists all
`.gitattributes` and CODEOWNERS paths with blob IDs. Read only the chosen
CODEOWNERS and attribute files ancestral to observed diff paths. Cache texts by
path and blob; a new streamed path may require another known ancestor file even
when the listing is fresh. A signed-in empty search is a valid cached empty
listing. Treat sign-out, HTTP errors, malformed JSON, search errors, and excess
pages as failure. On failure retain an existing listing. With no cache, probe
the root attributes and all three CODEOWNERS locations together. For a
non-default base, probe those same four locations at that base branch; GitHub
derives ownership from the base. This fallback deliberately cannot discover
nested attribute files.

Read a pull's changed metadata files at its resolved head, with deletion as a
real overlay value. Reuse a stored head and files while fresh; a newly arrived
metadata diff path requires a head check. Cache the branch listing for seven
days and the pull overlay for two days. Serve a due copy immediately and reread
after three seconds with no native page change. Failure keeps the old text and
old timestamp; retry once for a failed lookup, then wait for another quiet
opportunity. Commit cache results only while the session generation still owns
them.

Raw-file requests accept a repository, ref, and path rather than an arbitrary
URL. Metadata search accepts a repository, and pull-head lookup accepts a
repository and pull number. The extension requires `storage` and hosts on
GitHub and its raw file domain. The content script asks the service worker to
perform these reads. Validate the repository, ref, and path at that boundary.

## 6. Use one filter predicate and one projection

Represent selection as excluded values per facet. A file is hidden when, for
**any** facet, it has at least one label in that facet and **all** its values
there are excluded. Thus multiple values within one facet are OR, while facets
combine with AND. This matters for a file owned by two teams: excluding one
team must not hide it while the other remains selected. Keep the original file
order.

Project every menu row from the full file set: `total`, `visible`, markable
`counted`, viewed count, and action paths. A category's circle and viewed click
use every markable file in that category, even if the current filter hides it;
its badge is still `visible/total`. A folder's circle and click use markable
descendants passing the active filters **except** the Viewed hiding rule.
Individual file circles apply to that file. Empty, partial, and filled states
must derive from the same action scope that a click will use.

Only one model may own menu counts and actual visibility. DiffSeek therefore
clears active native filters before taking over GitHub's menu and restores its
hidden native items on teardown. Its “only” and “all” shortcuts change just one
facet. A filter click never scrolls, navigates, changes the URL hash, or
reorders files.

## 7. Apply the projection without taking over GitHub's review state

Hide a nonmatching file's tree row and diff region with the same
`data-diffseek-filtered-out` attribute and CSS `display: none !important`.
Mark empty folders the same way; preserve unavailable rows and their ancestors.
Never click GitHub's collapse control to filter: a reviewer collapse must
survive a filter change. Remove the attribute from marked nodes, including
detached nodes, on teardown.

Draw viewed circles over GitHub's existing icon wrappers with CSS, with a
small delegated click target. Inserting controls into the React-owned file
tree caused GitHub to rebuild it. The empty/partial/filled visual must also
have an accessible name and pressed state.

Viewed actions are commands against GitHub's current buttons. Queue commands
in invocation order; before each file, re-resolve its control and skip if its
desired state already holds. Click and wait for GitHub's observed aria state
change (or a failure guard if GitHub ignores the click). A user click on a
native control invalidates a queued command for that file. Cancel the queue on
session stop. A failed action is reported, not retried in an action storm.
Auto-view uses the same path once per generated file after metadata settles;
it does not continually enforce viewed state.

## 8. Reconcile on meaningful changes, with minimal writes

GitHub streams and redraws the tree, panels, and menu. Classify mutations into
immediate changes (viewed/collapse aria, menu, tree replacement) and coalesced
structural changes; ignore diff-body noise and the extension's own writes.
Prefer page events and animation frames to delays. Keep a tree structure key,
region structure key, and classification key, so panel remounts can refresh
capabilities without reparsing metadata. A pure view plan describes the desired
page and menu. Compare it with the last applied plan and write only changed
surfaces, or a surface whose DOM GitHub replaced. Do not rebuild an owned menu
when its visible model is unchanged.

During an auto-view batch, defer mutation reconciliation until the batch ends.
Counts show `…` until the first metadata read settles. The closed filter
button's reset icon appears only for review-scoped exclusions; it is one
persistent sibling whose CSS controls visibility, and the menu reset keeps its
place without entering keyboard order when inactive.

## 9. Keep preference lifetimes distinct

With no saved defaults, hide viewed and generated files and auto-view generated
files. A **present** saved record, even an empty one, overrides that implicit
initial state; reading it does not write it back. The viewed and generated rows
cycle `Show now` → `Hide now` → `Always hide` → `Show now`.
“Always hide” is an extension-wide default in local storage. Auto-view is a
separate saved switch. Other exclusions are review-scoped and saved in that
tab's session storage, keyed by review, so reload and return restore them while
a fresh tab starts from defaults. Reset clears only those review-scoped
exclusions.

## 10. A safe construction and verification order

1. Model a page observation and session lifecycle; test missing, duplicate,
   renamed, streamed, and replaced diff regions with the recorded fixtures.
2. Implement metadata parsing, branch listing, pull overlay, cache freshness,
   and stale-session protection as pure or injected operations.
3. Build labels, the exclusion predicate, ancestor index, and row projections.
   Test multi-owner OR behavior and category versus folder viewed scopes.
4. Render tree and diff visibility and the menu from one projection. Verify
   native filters are cleared, unsupported files stay visible, and teardown
   restores GitHub's nodes and styles.
5. Add queued native viewed actions and auto-view. Verify confirmation,
   replacement of controls, cancellation, and ignored clicks.
6. Add mutation classification and plan-based throttling. Run fixture browser
   flows and live review performance checks; the latter detect GitHub markup
   changes and unwanted React redraws that fixtures cannot predict.

The critical acceptance conditions are behavioral: GitHub remains authoritative;
the tree and diff always agree; badges and clicks use the same set; changed
metadata can alter labels without a page reload; and a stale session cannot
write into a new one. The remaining implementation choices are replaceable.
