# DiffSeek Context

## Purpose

DiffSeek shortens navigation and repetitive viewed-state work inside GitHub pull
request reviews. GitHub remains the review system and visual authority.

## Domain language

- **Review session** — disposable state for one repository and pull request.
- **Page observation** — normalized file facts read from GitHub's rendered DOM.
- **Capability** — a native operation currently available for one observed file.
- **Label source** — one independently composable classifier for viewed state,
  group, owner, language, generated status, or change status.
- **Fallback label** — `No owner`, `No type`, or `No extension`, used when
  repository metadata supplies no meaningful value for that facet.
- **Menu takeover** — DiffSeek-owned filter rows inside GitHub's existing menu
  container after semantic native-filter normalization.
- **Filter selection** — review-scoped label values; OR within a facet and AND
  across facets.
- **Remembered filter default** — extension-wide hidden-by-default state for
  viewed or generated files, optionally marking generated files viewed.
- **Facet shortcut** — an `only` or `all` action that changes one filter facet
  without changing any other facet.
- **Review index** — immutable descendant and ancestor lookup built from one page
  observation.
- **Metadata level** — known pull-request LRU, cached default branch, bundled
  assumptions, or uncached pull-request head. Default-branch refresh is cache
  prefetch only when that repo cache is empty.
- **Native action** — a click on a current GitHub control followed by observable
  DOM confirmation.

## Invariants

- Unsupported files stay native, visible, and outside unavailable batch actions.
- Metadata levels replace one another; they never merge.
- Native actions run in invocation order and re-resolve their controls.
- Filtering never changes GitHub's file order.
- One filter model owns tree visibility and visible/total counts.
- A menu row derives its count, viewed target paths, and viewed indicator from
  the same live facet projection.
- A facet containing only its fallback label is omitted from the menu.
- Category actions normally target visible files; when the viewed facet alone
  hides matching viewed files, they target those files as a reversible escape.
- Remembered viewed/generated defaults are extension-wide; other exclusions are
  review-scoped.
- Menu reset is visible only for review-scoped exclusions and never changes
  remembered defaults.
- A generated default-viewed action follows GitHub's rendered controls once per
  file and lets normal page observation reconcile the resulting state.
- Shared tool configuration lives under `config/`; root files remain only when
  discovery requires them.
- Unit/spec tests live beside their namesake modules. Playwright e2e may be
  orchestration-only without a product namesake.
