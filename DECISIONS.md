# DiffSeek Decisions

## D001 — Rendered DOM is authoritative

**Decision:** Observe semantic DOM and imitate user clicks. Do not hook GitHub
internal state, requests, or undocumented mutation APIs.

**Why:** The extension remains session-compatible, understandable, and
fail-open. **Cost:** markup drift requires contract fixtures and live testing.

## D002 — One semantic GitHub adapter owns DOM drift

**Decision:** Page observations expose normalized facts and re-resolving semantic
capabilities. Presenter and action modules do not own selectors or stored DOM
bindings.

**Why:** Selector and node-lifetime knowledge has one locality. **Cost:** the
adapter is a high-value integration seam and therefore needs broader fixtures.

## D003 — Metadata levels replace instead of merge

**Decision:** Use a known-PR LRU (last 10) for immediate review metadata, else
cached default-branch, else bundled assumptions. Uncached pull-head content
replaces the open review and is stored in that LRU. A default-branch `HEAD`
refresh is an isolated cache prefetch only when the repo has no default-branch
cache yet; it does not replace a settled pull-head result. If that pull-head
read fails, the open review adopts the settled default-branch result. A
transport failure is not stored. Each read is one attempt. A later success
replaces the open review. Until that success, the review keeps cached metadata
or bundled assumptions. A failed read is attempted again when the filter menu
opens or the file tree changes, and only one read runs at a time. A missing
file retains the preceding level.

**Why:** Warm revisits skip `CODEOWNERS` / `.gitattributes` reloads while unknown
PRs still start from HEAD. A cold review still picks up generated and owner
rules when a later menu open or file-list update succeeds. **Cost:** a PR-head
file at a GitHub-higher path than the last default-branch hit is not seen until
that cached path 404s or the PR head SHA changes. A hung raw fetch is abandoned
after 20s.

## D004 — Label sources compose through one interface

**Decision:** Group, owner, language, generated, and status classifiers are
independent adapters composed by the label module.

**Why:** A label source can evolve or be replaced without changing the other
classifiers. **Cost:** the simplest sources are intentionally small modules.

## D005 — Index first; invalidate projections when observation changes

**Decision:** Build one linear review index per accepted observation. Key the
file list on the **tree** structure key. Only a tree row's own `#diff-*` link
(not a descendant row's) counts for membership; with status it enters the
catalog immediately (capability-less stub when regions are missing or
duplicated). When the tree is unchanged: attribute churn refreshes
viewed/capabilities only; **region** structure changes rescan to enrich or stub
capabilities without dropping tree membership. The file catalog keeps prior
labels/generated/viewed across empty-label scans so region churn does not wipe
classification; full reclassify runs when the classify key (path/status/owners
+ metadata) changes. Always re-apply presentation plus tree viewed actions;
skip owned filter-menu remounts when the projection fingerprint is unchanged.
Defer mutation-driven reconcile while automatic generated mark-viewed is in
flight. Observe tree/diff/menu roots for attributes; use body only for
childList discovery. Ignore MutationRecords whose target is inside DiffSeek
chrome (including `.diffseek-viewed-icon-anchor`) so owned mounts do not
re-enter reconcile.

**Why:** Diff region mount churn is frequent and must not wipe classification
or shrink the file list once the tree is known; regions only enrich
viewed/collapse/owners. Presentation and tree actions still correct native
collapse/expand churn and cloned tree nodes.
**Cost:** region-key misses still rescan (without classify-key reset);
capabilities stay false while duplicates exist; tree-key misses still
full-scan and reclassify; fingerprint misses still attempt an in-place menu
patch and fall back to a full menu rebuild when row identity or section chrome
changes.

## D006 — Own one filter menu model

**Decision:** Reuse GitHub's filter-menu container but hide its native rows and
let DiffSeek own all menu contents. If GitHub file filters are already active,
invoke its rendered clear control before takeover. Viewed and collapse writes
still use GitHub's native controls.

**Why:** One model now owns visibility, counters, selection, and whether a click
keeps the menu open. This removes native/extension drift without hooking GitHub
internals. **Cost:** DiffSeek must restore hidden native nodes when its session
stops and must contract-test the host menu container.

## D007 — Persist only special filter defaults

**Decision:** Keep ordinary exclusions inside one review session. Persist only
hidden defaults for viewed and generated files plus the generated
hidden-and-viewed default, extension-wide, using the existing local-storage
permission. Applying hidden-and-viewed invokes GitHub's current rendered
controls once per generated file; it does not enforce the state afterward.

**Why:** Review-specific filtering does not leak into unrelated pull requests,
while repetitive viewed/generated preferences remain convenient. **Cost:** The
three/four-state controls and effective filter projection must keep transient
exclusions and persisted defaults synchronized. Menu reset applies only to
transient exclusions. A failed native action is reported but not retried
automatically, avoiding action storms at the cost of manual recovery.

## D008 — Facet shortcuts stay within one filter dimension

**Decision:** Offer `only` on rows in multi-item sections and `all` on sections
with exclusions. Each shortcut modifies only its own facet.

**Why:** Common focus/reset operations become one click while preserving the
existing OR-within, AND-across filter model. **Cost:** Hover-only presentation
needs explicit keyboard focus behavior and permanent accessible names.

## D009 — Viewed circles follow counted files

**Decision:** A menu row or folder counts files that pass every active filter
except the Viewed filter's hiding. Generated files count only when that filter
shows them. Files hidden by an owner, group, or format filter do not count.
The circle is empty when none of those files are viewed, an eclipse (a fixed
off-center disc inside a thin ring, not a pie) when some are, and filled when
all are. Nothing counted means no circle. Clicking empty or partial marks only
the visible unread files viewed. Clicking filled marks every counted file not
viewed. The Generated row counts generated files that pass every other filter
and ignores that row's own hide, so its circle and click still reach those
files while they are hidden. A folder sums the files under it. Individual
files stay empty or filled.

**Why:** The indicator matches the slice the reviewer can still finish, including
viewed files the Viewed filter is hiding, without painting a partial slice as
done. **Cost:** The old click that unmarked hidden viewed files on any category
row is gone. Only a filled circle clears viewed state, and it clears the whole
counted set.

## D010 — Fallback labels remain data but not menu noise

**Decision:** Ungrouped files receive `No type`, matching `No owner` and
`No extension`. Omit Owners, Groups, or Formats when its sole value is its
fallback.

**Why:** Every file remains classifiable when mixed values make a facet useful,
without presenting a universal non-choice. **Cost:** A fallback-only facet
cannot be toggled until repository metadata introduces another value.

## D011 — Missing filter defaults are not an empty preference

**Decision:** Absence of `diffseek:filter-defaults` hides viewed and generated
files. A present record is parsed as saved, even when both lists are empty.
Reading defaults does not write the implicit state.

**Why:** New installs reduce review noise without a migration that overwrites
people who already saved a preference, including show-all. **Cost:** The
implicit default is reapplied on every session until a remembered row changes.
Viewed and generated clicks both run show, hide, always hide. The fresh
always-hide state returns to show on the first click and does not mark files
viewed. Marking generated files viewed is a separate persisted "auto-view"
control, off until the user turns it on. A stored record that hid generated
files and marked them viewed is read as always hide plus auto-view.
