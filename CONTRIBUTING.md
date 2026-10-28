# Contributing

`CONTEXT.md` defines the product language and invariants. `DECISIONS.md`
records the architecture calls that should not be re-litigated without new
evidence.

## Design principles

**Extend what GitHub users already understand; do not redefine it.**

- Keep GitHub's controls familiar while giving injected surfaces a recognizable
  DiffSeek palette.
- Reuse GitHub's filter-menu container, but let DiffSeek own its contents so one
  filter model controls visibility, counts, and menu lifetime.
- Clear pre-existing GitHub file filters through GitHub's rendered control
  before hiding native filter rows.
- Imitate normal user actions instead of depending on internal JavaScript state.
  Viewed and collapse writes use GitHub's native controls.
- Leave GitHub usable when a required semantic control is unavailable.
- Use only `storage`, `github.com`, and `raw.githubusercontent.com`; no token or
  separate sign-in.

GitHub's rendered DOM is authoritative. Observe semantic DOM and imitate user
clicks. Do not hook GitHub internal state, requests, or undocumented mutation
APIs. That stays fail-open: a partially unsupported file remains native and
visible and does not disable supported files, and a metadata failure retains
the preceding level.

Viewed toggles are drawn with CSS on GitHub's existing file/folder icon
wrapper. No nodes are inserted into the React-owned tree. Inserting nodes
before hydration finishes makes React discard and remount the whole tree.

Performance guards already in the review session:

- Skip owned filter-menu remounts when the projection fingerprint is unchanged.
- Coalesce diff-panel reconciles, and do not let a coalesced tick postpone an
  already-queued immediate flush.
- `ReviewIndex` construction is covered for large file lists without quadratic
  growth.
- Live e2e checks cold, warm, and hot durations, reconcile passes, DOM
  mutations, and file-tree or diff-panel rebuilds against optional
  `DIFFSEEK_LIVE_BUDGET_*` budgets.

### Runtime invariants

- Each pull request owns a disposable review session.
- GitHub's rendered DOM is authoritative.
- Native actions execute in invocation order and re-resolve current controls.
- Viewed-action notifications are newest-first and expire independently.
- Metadata levels replace one another; they are never merged.
- File labels are independent from filter selection.
- Stale generations cannot update a later review.
- A partially unsupported file remains native and visible; it does not disable
  supported files.
- Repository-file messages accept repository, ref, and relative path, never an
  arbitrary URL.

## Behavior

Classic `/pull/:number/files` review URLs are replaced with GitHub's modern
`/changes?new_files_changed=true` experience before DiffSeek starts.

DiffSeek replaces the contents of GitHub's **Filter options** menu with viewed,
generated-file, owner, type, language, and change-status filters. It retains the
native menu container and interaction model. Viewed and generated filters cycle
show, hide, and always hide. With no saved filter defaults, both start on
always hide and the first click shows them. The Generated row has an
"auto-view" pill that marks generated files viewed while it is on, and is off
for a fresh install. A saved always-hide-and-mark-read record is read as always
hide with auto-view on. Multi-item sections expose row-hover
`only` and title-hover `all` shortcuts. Non-matches are hidden in the file tree
and collapsed/muted in place in the diff. File, folder, counter-pill, and
counter-overlay actions mark their current visible scope viewed through
GitHub's native controls. Reset clears review-local filters without changing
viewed/generated defaults. When viewed files are hidden, a category containing
matching hidden viewed files instead offers to mark only those files not
viewed, making them visible again. Started and completed actions appear in a
short-lived top-right notification stack.

Repository metadata for the open review starts from cache, then PR head:

```text
known PR cache (last 10 pull requests)
  -> cached default branch (unknown PRs)
  -> bundled assumptions
  -> uncached PR head, stored in the PR LRU
```

A default-branch `HEAD` refresh runs afterward only when that repo has no
default-branch cache yet; it is an isolated prefetch for later unknown PRs
and does not replace the current review. A known PR with the same head SHA
does not reload `CODEOWNERS` or `.gitattributes`. A failed read is not cached
and is not retried on a timer. It is attempted again, one request at a time,
when the filter menu opens or the file tree is updated. Until a read settles,
the review uses cached metadata or bundled assumptions, so generated files,
groups, and formats may be absent. A settled read redraws those sections and
applies the current hide settings without a reload.

`CODEOWNERS` supplies owners. DiffSeek follows GitHub's order
(`.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS`). On a pull-request
head it first tries the path last seen on that repo's default branch, then
the remaining GitHub locations. Root `.gitattributes` is the only repository
source for groups, explicit language overrides, and generated status:

```gitattributes
docs/** group=docs
**/*.md group=docs
*.ts linguist-language=TypeScript
*.tsx linguist-language=TypeScript
dist/** linguist-generated
dist/source/** -linguist-generated
```

Rules follow ordered Git-attribute assignment: the last matching value for each
attribute wins. Paths without `linguist-language` fall back to their file
extension or `No extension`; paths without `group` use `No type`. Mapped
languages appear first in Formats as one entry each (for example `TypeScript`
for both `.ts` and `.tsx`); unmapped extensions follow. Owners, Groups, or
Formats is omitted when its only choice is respectively `No owner`, `No type`,
or `No extension`.

Missing default-branch files retain bundled assumptions. Missing PR-head files
retain the corresponding default-branch fallback. Default-branch metadata is
cached per repository. PR-head metadata is cached in an LRU of the last 10
pull requests and reused when the head SHA is unchanged.

## Source architecture

```text
entrypoints -> app -> adapters -> modules
                    \----------> modules
```

- `src/modules/` contains pure review and repository-metadata policy.
- `src/adapters/` contains GitHub DOM/network and browser-storage integration.
- `src/app/` composes adapters and modules into PR-scoped workflows.

Referenced TypeScript projects enforce the direction: modules cannot import
adapters or app, and adapters cannot import app. Cross-layer imports use named
aliases and module entry points; relative imports remain local to one layer.
Tests stay beside the code they protect. Playwright e2e may be
orchestration-only without a product namesake. Shared tool configuration lives
under `config/`.

## Dev setup

Requires Node.js 24, pnpm 10, and Chrome or Chromium (`package.json` engines:
Node `>=24`, pnpm `>=10 <11`).

```sh
corepack enable
pnpm install
```

`pnpm install` runs `wxt prepare` and installs the Husky hooks.

## Build

```sh
pnpm dev
pnpm build
```

`pnpm dev` is `wxt --config config/wxt.config.ts`. `pnpm build` writes the
unpacked Manifest V3 extension to `.output/chrome-mv3`.

Load `.output/chrome-mv3` through `chrome://extensions` with **Developer mode**
and **Load unpacked**. Open a pull request's **Files changed** page; the
extension uses the existing GitHub session.

## Test

Unit and DOM tests are Vitest files beside the code they protect (`*.unit.ts`,
`*.spec.ts`):

```sh
pnpm test
pnpm test:ci
```

`pnpm coverage:ci` is the coverage run used by `pnpm check:ci:quality`.

Fixture e2e is Playwright against the built extension and the HTML fixtures
under `src/adapters/github/review-page/fixtures/`
(`src/app/review/review-app.e2e.playwright.ts`):

```sh
pnpm test:e2e
pnpm test:e2e:run
```

`test:e2e` builds first. `test:e2e:run` skips the build and uses the existing
`.output/chrome-mv3`. Playwright matches `**/*.e2e.playwright.ts` with one
worker (`config/playwright.config.ts`).

Live e2e is opt-in. `test:e2e:live` builds first; `test:e2e:live:run` skips the
build. Both set `DIFFSEEK_LIVE_E2E=1`, which is what includes
`src/app/review/live-perf.e2e.playwright.ts`. Without that variable the live
suite is skipped.

Set `DIFFSEEK_GITHUB_STORAGE_STATE` to either a Playwright storageState **file
path** or the **inline JSON** (Cursor / GitHub Actions secrets inject the JSON
string). Logged-out GitHub stays on classic `/files` and loops with DiffSeek's
`/changes` redirect:

```sh
pnpm exec playwright open https://github.com/login --save-storage=.cache/github-storage.json
DIFFSEEK_GITHUB_STORAGE_STATE=.cache/github-storage.json pnpm test:e2e:live
```

It runs repeated cold, warm, and hot samples against `sha-tm/diffseek-test-data#1`
by default (`DIFFSEEK_LIVE_SAMPLES`, default 3). Cold clears extension storage,
then writes an explicit shown filter preference so a fresh-install hide default
does not collapse the file list, and loads the PR. Warm is a reload. Hot clicks
Conversation, then Files changed. Each sample records time to the first
DiffSeek control, time from the Filter click until the DiffSeek menu is
visible, and time until the generated-facet denominator shows the full
classified total. It also records reconcile passes, DiffSeek DOM mutations, and
GitHub file-tree or diff-panel rebuilds (removed rows that come back). Cold
and warm must stay at 0. Hot ignores that mass-removal rule and fails only when
a tree row or diff panel removed after the first DiffSeek control is still
gone 500 ms later. The job summary includes raw removed and re-added counts.
The cold sample also toggles the viewed filter and marks one file row viewed.
An empty sample set fails. Duration ceilings are about three times a measured
local median (first render 12s/10s/8s, menu 6s, panels 27s/24s/22s) with
optional `DIFFSEEK_LIVE_BUDGET_*` overrides. Results are written to
`.cache/live-perf-latest.json`, the job summary, and a `live-perf` artifact.
Override the target with `DIFFSEEK_LIVE_PR_URL`.

`pnpm check:ci` runs the quality checks and the production build together.

## Release and CI

Prepare the Chrome Web Store upload archive with:

```sh
pnpm release:zip
```

WXT writes the versioned Chrome Manifest V3 ZIP to `.output/`. The manifest
patch version is the `git rev-list --count HEAD` count
(`config/manifest-version.ts`).

**CI** (`.github/workflows/ci.yaml`) runs on every push. Pull requests get CI
only. On each successful CI run for `main`, the next stages run strictly in
order for that commit:

1. **Live E2E** (`.github/workflows/live-e2e.yaml`) — also manual
   (`workflow_dispatch`). It requires repository secret
   `DIFFSEEK_GITHUB_STORAGE_STATE` and fails when that secret is missing.
2. **Release Chrome Extension** (`.github/workflows/release.yaml`) —
   `pnpm release:zip`, then create a versioned GitHub Release (`v<version>`
   with changelog). Download the newest build from
   https://github.com/n8v-guy/diffseek/releases/latest

**Publish Chrome Web Store** (`.github/workflows/publish-chrome-web-store.yaml`)
is manual only (`workflow_dispatch` from branch `main`). It requires CI, Live
E2E, and Release green for that main tip and publishes the ZIP artifact from
that Release run (no rebuild). Required secrets: `CHROME_EXTENSION_ID`,
`CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`,
`CHROME_PUBLISHER_ID`. The store item must already exist; the first listing is
created in the developer dashboard.

## Commit conventions

Subjects are a single imperative line, matching the existing history. No
commit-message linter is configured.

`pnpm install` installs Husky:

- `pre-commit` runs `pnpm check:commit`: lint-staged (`eslint --fix` on
  `*.{ts,tsx}` via `config/lint-staged.config.ts`) and `pnpm lint:rules`
  (`scripts/check-structure.ts`).
- `pre-push` runs `pnpm check:push`, which is `pnpm check:ci` (structure,
  eslint, knip, typecheck, coverage, production-dependency audit, and build).
