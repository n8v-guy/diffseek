# DiffSeek

DiffSeek is a subtle GitHub ergonomics facelift for pull-request reviews. It
extends the existing **Files changed** tree, filters, collapse controls, and
viewed controls without replacing GitHub's review model.

## Product policy

**Extend what GitHub users already understand; do not redefine it.**

- Keep GitHub's controls familiar while giving injected surfaces a recognizable
  DiffSeek palette.
- Reuse GitHub's filter-menu container, but let DiffSeek own its contents so one
  filter model controls visibility, counts, and menu lifetime.
- Clear pre-existing GitHub file filters through GitHub's rendered control
  before hiding native filter rows.
- Imitate normal user actions instead of depending on internal JavaScript state.
- Leave GitHub usable when a required semantic control is unavailable.
- Use only `storage`, `github.com`, and `raw.githubusercontent.com`; no token or
  separate sign-in.

## Behavior

Classic `/pull/:number/files` review URLs are replaced with GitHub's modern
`/changes?new_files_changed=true` experience before DiffSeek starts.

DiffSeek replaces the contents of GitHub's **Filter options** menu with viewed,
generated-file, owner, type, language, and change-status filters. It retains the
native menu container and interaction model. Viewed and generated filters cycle
through shown, hidden, and extension-wide default-hidden states; generated files
also support default-hidden-and-viewed. Multi-item sections expose row-hover
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
does not reload `CODEOWNERS` or `.gitattributes`.

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

## Develop

Requires Node.js 24, pnpm 10, and Chrome or Chromium.

```sh
corepack enable
pnpm install
pnpm check:ci
pnpm test:e2e
pnpm test:e2e:live
pnpm test:e2e:live:run
```

`test:e2e:live` is opt-in and builds first; `test:e2e:live:run` skips the build
for a faster research loop against an existing `.output/chrome-mv3`. Set
`DIFFSEEK_GITHUB_STORAGE_STATE` to either a Playwright storageState **file
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
optional `DIFFSEEK_LIVE_BUDGET_*` overrides. Results are
written to `.cache/live-perf-latest.json`, the job summary, and a `live-perf`
artifact.
Override the target with `DIFFSEEK_LIVE_PR_URL`. The Live E2E workflow is
manual (`workflow_dispatch`) and also runs on `main` after CI succeeds. It
requires repository secret `DIFFSEEK_GITHUB_STORAGE_STATE` and fails when that
secret is missing.

Prepare the Chrome Web Store upload archive with:

```sh
pnpm release:zip
```

WXT writes the versioned Chrome Manifest V3 ZIP to `.output/`.

**CI** runs on every push (pull requests get CI only). On each successful CI run
for `main`, the next stages run strictly in order for that commit:

1. **Live E2E**
2. **Release Chrome Extension** — `pnpm release:zip`, then create a versioned
   GitHub Release (`v<version>` with changelog); download the newest build from
   https://github.com/n8v-guy/diffseek/releases/latest

**Publish Chrome Web Store** is manual only (`workflow_dispatch` from branch
`main` — GitHub Mobile → Actions → Run workflow). It requires CI, Live E2E, and
Release green for that main tip and publishes the ZIP artifact from that
Release run (no rebuild). Required secrets: `CHROME_EXTENSION_ID`,
`CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`,
`CHROME_PUBLISHER_ID`. The store item must already exist; the first listing is
created in the developer dashboard.

Load `.output/chrome-mv3` through `chrome://extensions` with **Developer mode**
and **Load unpacked**. Open a pull request's **Files changed** page; the extension
uses the existing GitHub session.

`CONTEXT.md` defines the product language and invariants. `DECISIONS.md` records
the architecture calls that should not be re-litigated without new evidence.

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
Tests stay beside the code they protect.

## Runtime invariants

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
