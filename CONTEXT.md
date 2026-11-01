# DiffSeek Context

## Purpose

DiffSeek shortens navigation and repetitive viewed-state work inside GitHub pull
request reviews. GitHub remains the review system and visual authority.

## Domain language

- **Review session** — disposable state for one repository and pull request.
- **Page observation** — normalized file facts read from GitHub's rendered page.
- **Capability** — a native operation currently available for one observed file.
- **Label source** — one independently composable classifier for viewed state,
  group, owner, language, generated status, or change status.
- **Fallback label** — No owner, No type, or No extension, used when
  repository metadata supplies no meaningful value for that facet.
- **Menu takeover** — DiffSeek-owned filter rows inside GitHub's existing menu
  after any active native filters are cleared.
- **Filter selection** — review-scoped label values; OR within a facet and AND
  across facets.
- **Remembered filter default** — extension-wide hidden-by-default state for
  viewed or generated files, optionally marking generated files viewed.
- **Facet shortcut** — an "only" or "all" action that changes one filter facet
  without changing any other facet.
- **Review index** — immutable descendant and ancestor lookup built from one page
  observation.
- **Metadata level** — recent pull-request cache, cached default branch, bundled
  assumptions, or the uncached pull-request head. A default-branch refresh only
  prefills the cache, and only when that repository has none yet.
- **Native action** — a click on a current GitHub control followed by observable
  confirmation on the page.

## Invariants

- Unsupported files stay native, visible, and outside unavailable batch actions.
- Metadata levels replace one another; they never merge.
- Native actions run in invocation order and re-resolve their controls.
- Filtering never changes GitHub's file order.
- One filter model owns tree visibility and visible/total counts.
- A menu row derives its count, viewed targets, and viewed indicator from the
  same live projection.
- A facet containing only its fallback label is omitted from the menu.
- Category actions normally target visible files; when the viewed facet alone
  hides matching viewed files, they target those files as a reversible escape.
- Remembered viewed/generated defaults are extension-wide; other exclusions are
  review-scoped.
- With no saved filter defaults, viewed and generated files are hidden. A saved
  record wins, even an empty one, and is not rewritten until a remembered row
  changes.
- Menu reset appears only for review-scoped exclusions and never changes
  remembered defaults.
- Auto-view acts through GitHub's rendered controls once per file and lets
  normal page observation reconcile the result.
- Shared tool configuration lives in one place; tool files stay at the root only
  when the tool requires it.
- Unit and DOM tests live beside the module they protect. Browser end-to-end
  tests may orchestrate a flow without a matching product module.
