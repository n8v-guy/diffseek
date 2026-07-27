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

Repository metadata replaces its fallback in three stages:

```text
bundled assumptions
  -> cached default branch
  -> uncached PR head
```

`CODEOWNERS` supplies owners. Root `.gitattributes` is the only repository
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
attribute wins. Paths without `linguist-language` fall back to their lowercase
extension or `No extension`; paths without `group` use `No type`. If one
explicit language spans multiple extensions in a PR, DiffSeek exposes aggregate
and specific choices such as `TypeScript`, `TypeScript (ts)`, and
`TypeScript (tsx)`. Owners, Types, or Languages is omitted when its only choice
is respectively `No owner`, `No type`, or `No extension`.

Missing default-branch files retain bundled assumptions. Missing PR-head files
retain the corresponding default-branch fallback. PR-head metadata is never
cached.

## Develop

Requires Node.js 24, pnpm 10, and Chrome or Chromium.

```sh
corepack enable
pnpm install
pnpm check:ci
pnpm test:e2e
```

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
