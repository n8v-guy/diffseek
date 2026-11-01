# DiffSeek Plan

## Goal

Deliver a Chrome-first GitHub review extension that makes large diffs easier to
filter and batch-mark without introducing a new review workflow.

## Product constraints

- Integrate only into GitHub's existing file tree, filter menu, diffs, collapse
  controls, and viewed controls.
- Preserve file order.
- Hide non-matches in the tree; collapse and mute them in the diff.
- Avoid GitHub's internal state and undocumented APIs.
- Ask only for storage and access to GitHub and its raw file host.
- Keep other browsers and user-defined review ordering deferred.

## Architecture

- A content script on the review page holds the GitHub page adapter, the
  independent label classifiers, the takeover of GitHub's filter menu, the tree
  and diff presenter, and native viewed actions that run in order.
- A background worker reads repository files, accepting only a repository, ref,
  and path.
- Repository metadata comes from a recent pull-request cache or the cached
  default branch at once, then the uncached pull-request head replaces it for
  the current review. A default-branch refresh only prefills an empty cache.
- The root .gitattributes file supplies groups, language overrides, and
  generated status, each set or unset per path. The last matching value wins
  per attribute; missing files keep the previous fallback. A language override
  beats the extension, files without an extension use No extension, and a
  language spanning several extensions is offered both as a whole and per
  extension.

## Delivered

- Chrome Manifest V3 extension with narrow permissions.
- Mapping of GitHub's files and diffs, including nested trees.
- Independent viewed, group, owner, language, generated, and status labels;
  OR within a facet, AND across facets.
- Distinctly themed filters and viewed circles on every file and folder icon.
- Presentation and in-order actions that survive GitHub re-renders and
  navigation.
- Authenticated reads of private repository files.
- Cold, cached default-branch, and uncached pull-request-head metadata.
- Unit, DOM, browser, and authenticated private pull-request validation.

## Completed milestones

Each milestone below is done; its trade-off still holds.

**Hardening.** Make DiffSeek's controls describe and follow GitHub's live
review state without depending on GitHub internals. Facets start fully
included, with counts over the whole pull request. DiffSeek owns the filter
menu's contents, clearing and restoring GitHub's own rows, and lets the menu
size itself from its content. Every file and folder icon carries a viewed
circle with generic labels. Batch status moved to top-right notifications.
Automated tests interleave native and DiffSeek actions, and final acceptance
uses a live, signed-in pull request. *Trade-off:* reconciling against the page
can briefly lag a large GitHub re-render, but avoids duplicating GitHub's menu
and keeps coupling low.

**Menu interaction.** Sections are ordered Owners, Types, Languages, Change
status, sorted case-insensitively with fallback labels last. A row's counter
and its circle run the same batch over the same files, recomputed after every
filter change, native action, and re-render. Viewed and Generated cycle shown,
hidden, and always hidden, saved extension-wide and announced on change. A
reset control appears only while a temporary filter is active and leaves saved
defaults alone.

**Source layering.** Pure policy, page and storage integration, and per-review
orchestration live in separate layers with a one-way dependency direction
enforced by the type checker. *Trade-off:* a few extra project configuration
files, in return for dependency mistakes failing at type-check time instead of
in review.

**Menu defaults and shortcuts.** Saved defaults gained auto-view, a separate
Generated-row switch, off by default, that marks generated files viewed once
per file through GitHub's controls. Each cycle step and the switch are
announced. Rows offer "only" and section titles offer "all", each changing just
its own facet. *Trade-off:* a failed native action is reported but not retried,
keeping actions idempotent and avoiding action storms.

**Reset temporary filters only.** Reset appears only for exclusions not backed
by a saved default, and restores the default-backed ones without saving
anything or announcing settings. *Trade-off:* one effective filter map, with
temporary entries derived at reset time, instead of a second model to keep in
sync.

**Hidden-viewed escape.** When the Viewed filter alone hides a category's
viewed files, that category's actions offer to unmark exactly those files.
*Trade-off:* a reversible exception to "act on visible files" without adding a
control, at the cost of a scope that depends on context.

**No-type fallback.** Ungrouped files get No type, sorted last, and a section
whose only row is its fallback is hidden until another value exists.
*Trade-off:* every file is filterable by type, at the cost of the fallback
being unavailable while it is the only value.
