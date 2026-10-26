# DiffSeek Plan

## Goal

Deliver a Chrome-first GitHub review extension that makes large diffs easier to
filter and batch-mark without introducing a new review workflow.

## Product constraints

- Integrate only into GitHub's existing file tree, filter menu, diffs, collapse
  controls, and viewed controls.
- Preserve file order.
- Hide non-matches in the tree; collapse and mute them in the diff.
- Avoid GitHub internal JavaScript state and undocumented mutation APIs.
- Request only `storage`, `https://github.com/*`, and
  `https://raw.githubusercontent.com/*`.
- Keep Firefox and user-defined review ordering deferred.

## Current architecture

```text
content script
  semantic page adapter
  independent label classifier
  filter-menu takeover in GitHub's container
  tree/diff presenter
  FIFO native viewed actions

background worker
  validated repository/ref/path text fetch

metadata
  known-PR LRU (last 10) or cached default-branch (immediate)
  uncached PR-head replacement (current review; stored in LRU)
  isolated default-branch HEAD prefetch when the repo cache is empty
```

Root `.gitattributes` supplies:

- `group=<name>`;
- `linguist-language=<name>`;
- `linguist-generated`, `linguist-generated=true`;
- `-linguist-generated`, `linguist-generated=false`.

The last matching assignment wins independently per attribute. Missing files
retain the previous fallback; resolved pairs apply atomically. PR-head content
is not cached.

Explicit language attributes override lowercase extension fallback. Files
without an extension use `No extension`. Languages that span multiple
extensions expose aggregate and extension-specific choices.

## File map

```text
entrypoints/background.ts
entrypoints/github.content/
config/*.config.ts                 shared tool configuration
config/tsconfig*.json              referenced dependency boundaries
src/modules/review/                pure review model and projections
src/modules/repository-metadata/   pure metadata parsing and policy
src/adapters/github/review-page/   semantic GitHub DOM mapping/actions
src/adapters/github/review-view/   menu, presentation, notifications
src/adapters/github/repository-content/
                                    background repository-file transport
src/adapters/browser/              browser storage
src/app/review/                    PR lifecycle and ordered actions
src/app/metadata/                  fallback replacement chain
src/**/*.unit.ts                   pure module tests
src/**/*.spec.ts                   DOM and lifecycle tests
```

## Delivered

- Chrome Manifest V3 shell and narrow host permissions.
- Semantic GitHub file/diff mapping, including nested trees.
- Independent viewed, group, owner, language, generated, and status labels.
- OR within one facet; AND across facets.
- Distinctly themed filters and corner-overlaid file/folder viewed actions.
- Idempotent presentation and FIFO actions across rerenders and navigation.
- Authenticated background reads for private repository files.
- Cold, cached default-branch, and uncached PR-head metadata replacement.
- Unit, DOM, Playwright, and authenticated private-PR validation.

## Active hardening plan

**Goal:** Make DiffSeek controls describe and follow GitHub's live review state
without depending on GitHub's internal JavaScript.

**Architecture:** GitHub's semantic DOM remains authoritative. DiffSeek owns the
contents of GitHub's filter-menu container, an inclusion set, icon overlays, and
a top-level snackbar stack. A coalesced observer reconciles these projections
after native or extension actions.

- [x] Replace opt-in facets with checked-by-default inclusion facets.
  - Stable counters use full-PR totals.
  - OR applies within a facet; AND applies across facets.
  - Explicit `linguist-language` overrides extension and `No extension`
    fallback labels.
- [x] Own all contents inside GitHub's filter-menu container.
  - Clear active native filters through GitHub's rendered control.
  - Hide and restore native menu rows without removing them.
  - Add viewed/generated top-level filters and conditional `Clear filters`.
- [x] Let the owned menu determine the popup width through CSS layout.
  - Use content-driven width with a viewport cap.
  - Keep one equal minimal inset outside the colored block.
  - Avoid JavaScript measurement and GitHub popup internals.
- [x] Overlay every file/folder icon with an always-visible viewed action.
  - Partial folders offer `Mark as viewed`.
  - Fully viewed scopes offer `Mark as not viewed`.
  - GitHub diff controls remain the source of truth.
- [x] Replace inline batch status with a fixed top-right snackbar stack.
  - Emit starting and completion/failure notifications.
  - Oldest stays on top; newest appears below; each expires independently after seven seconds.
- [x] Extend unit, DOM, and Playwright coverage.
  - Interleave native GitHub and DiffSeek actions in the automated E2E suite.
  - Chaos-test the built extension on authenticated PR `#185108`.
  - Use the live page, without request interception, for final acceptance.

**Tradeoff:** Semantic DOM reconciliation can briefly lag a large GitHub
rerender, but avoids duplicating the native menu and minimizes coupling to
GitHub implementation details.

## Menu interaction refinement

**Goal:** Make menu ordering and batch-viewed controls predictable while adding
extension-wide defaults for viewed and generated files.

**Architecture:** Keep transient exclusions in each review session. Store only
the remembered hidden defaults for `viewed` and `generated` in extension-local
storage. Every menu render derives counters, target paths, and viewed state from
one live facet projection.

- [x] Order sections as Owners, Types, Languages, Change status.
  - Sort ordinary values case-insensitively.
  - Display `Unmapped` as `No owner` and place it last.
  - Place `No extension` last.
- [x] Make both the `X/Y` pill and its viewed overlay run the same batch action.
  - Act only on the visible `X` paths represented by the row.
  - Offer mark-not-viewed only when every visible path is viewed.
  - Recompute both targets after filters, native actions, and rerenders.
- [x] Cycle Viewed files and Generated files through shown, hidden, and
  remembered-hidden.
  - Render remembered-hidden as a dash.
  - Persist remembered defaults extension-wide.
  - Show a snackbar when entering or leaving remembered-hidden.
- [x] Replace the Clear filters row with an edge-overlaid counterclockwise reset
  icon.
  - Preserve the four-pixel outer inset.
  - Keep the complete icon inside the host popup.
  - Show the reset only while a transient filter is active.
  - Reset transient filters without changing remembered defaults.
- [x] Cover sorting, tri-state persistence, reset, counter actions, and live
  projection recalculation with unit, DOM, Playwright, and authenticated tests.

## Source architecture refactor

**Goal:** Make every key flow follow one obvious dependency direction without
turning the extension into a framework.

```text
entrypoints -> app -> adapters -> modules
                    \----------> modules
```

- [x] Move pure review and repository-metadata logic into `src/modules/`.
- [x] Move GitHub DOM/network and browser-storage code into `src/adapters/`.
- [x] Keep lifecycle and cross-boundary orchestration in `src/app/`.
- [x] Expose module APIs through explicit entry points.
- [x] Add referenced TypeScript projects so modules cannot import adapters/app,
  and adapters cannot import app.
- [x] Reject legacy source roots and let project roots reject cross-layer
  relative imports.
- [x] Update the project map, then run unit, DOM, build, and Playwright checks.

**Tradeoff:** Project references add a few small tsconfig files and declaration
artifacts under ignored `.cache/`; in return, dependency violations fail during
normal typechecking instead of relying on review discipline.

## Menu defaults and section shortcuts

**Goal:** Make generated-file defaults actionable and reduce multi-click facet
filtering without adding another filter model.

- [x] Replace the remembered-hidden set with persisted filter defaults:
  `{ hidden, viewed }`, while reading the existing `{ hidden }` shape.
- [x] Cycle Generated files through shown, hidden, default hidden (`−`), and
  default hidden-and-viewed (`×`); keep Viewed files three-state.
- [x] On `×`, hide generated files immediately and enqueue their native viewed
  actions once per file. Let normal reconciliation update menu/tree badges.
- [x] Use the exact setting snackbars: `Show … by default`,
  `Hide … by default`, and `Hide and mark viewed generated files by default`.
- [x] Add a row-hover `only` pill to each item in multi-item sections; it
  excludes every sibling value without changing other facets.
- [x] Add a title-row-hover `all` pill when a section has exclusions; it clears
  that section only.
- [x] Align `only` in one compact column after labels and `all` with the X/Y
  counter column.
- [x] Cover persistence, cycling, automatic viewed actions, shortcuts, CSS
  states, reset behavior, and keyboard behavior in adjacent tests and
  Playwright.

**Files:** `src/adapters/browser/filter-defaults*`,
`src/adapters/github/review-view/filter-menu*`, `review-ui*`,
`src/app/review/review-{app,session}*`,
`src/app/review/review-app.e2e.playwright.ts`, and
`entrypoints/github.content/style.css`.

**Tradeoff:** `×` uses rendered GitHub viewed controls and a per-session
attempt set. A failed native action is reported but not retried automatically,
which preserves idempotence and avoids action storms.

## Reset transient filters only

**Goal:** Keep the menu-level reset scoped to review-local filtering while
leaving extension-wide viewed/generated defaults untouched.

- [x] Add menu tests proving default-only exclusions do not expose reset.
- [x] Add menu tests proving reset clears transient exclusions, preserves
  persisted defaults, and reapplies their effective exclusions.
- [x] Derive reset visibility from exclusions not backed by a default.
- [x] On reset, clear all exclusions and restore default-backed exclusions
  without writing storage or showing setting snackbars.
- [x] Update Playwright coverage and concise product documentation.
- [x] Verify with CI-equivalent and browser gates.

**Files:** `src/adapters/github/review-view/filter-menu*`,
`src/app/review/review-app.e2e.playwright.ts`, `README.md`, `CONTEXT.md`,
`DECISIONS.md`, and `PLAN.md`.

**Tradeoff:** This keeps one effective filter map and derives which entries are
transient at the reset boundary. A fully separate transient/effective model
would be purer but adds state synchronization throughout the review flow for no
additional user behavior.

## Hidden-viewed category escape

**Goal:** Let category actions restore viewed files even while the Viewed files
filter hides them.

- [x] Extend facet projection with viewed files hidden only by the viewed facet,
  while still respecting every other active facet.
- [x] When such files exist for a non-viewed row, make both category actions
  offer `Mark as not viewed` and target only those hidden viewed paths.
- [x] Preserve the existing visible-`X` action for every other state.
- [x] Cover projection, menu actions, and the live interleaved browser flow.
- [x] Verify with CI-equivalent and browser gates.

**Tradeoff:** Category actions reach beyond visible `X` only for this reversible
escape path. This avoids total-`Y` side effects and adds no second control, but
the exceptional scope is contextual rather than globally uniform.

## No-type fallback

**Goal:** Make ungrouped files filterable without showing sections that contain
no meaningful choice.

- [x] Label files without `.gitattributes group=…` as `No type`.
- [x] Sort `No type` last alongside the existing owner/language fallbacks.
- [x] Hide Owners, Types, or Languages when its only row is respectively
  `No owner`, `No type`, or `No extension`.
- [x] Keep fallback sections visible when any ordinary or retained excluded
  value also exists.
- [x] Cover classification, ordering, menu suppression, and browser behavior.
- [x] Verify with CI-equivalent and browser gates.

**Tradeoff:** Every file now has a Type label, simplifying filtering. Suppressing
fallback-only sections removes non-actionable UI, but their universal label is
intentionally unavailable until another value makes that facet informative.
