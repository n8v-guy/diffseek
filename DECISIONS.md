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

**Decision:** Use bundled, cached default, refreshed default, then pull-head
content as whole-source replacements. Failures retain the preceding level.

**Why:** Results are predictable and immediately available. **Cost:** stale
fallback content can remain active without visible provenance.

## D004 — Label sources compose through one interface

**Decision:** Group, owner, language, generated, and status classifiers are
independent adapters composed by the label module.

**Why:** A label source can evolve or be replaced without changing the other
classifiers. **Cost:** the simplest sources are intentionally small modules.

## D005 — Index first; invalidate projections when observation changes

**Decision:** Build one linear review index per accepted observation. Reuse the
previous file list when the page structure key is unchanged (refreshing viewed /
capability facts only); otherwise full-scan. Skip attribute classification when
path/owner/metadata identity is unchanged (sync viewed labels only). Always
re-apply presentation plus tree viewed actions; skip owned filter-menu remounts
when the projection fingerprint is unchanged. Defer mutation-driven reconcile
while automatic generated mark-viewed is in flight. Observe tree/diff/menu roots
for attributes; use body only for childList discovery. Ignore MutationRecords
whose target is inside DiffSeek chrome (including `.diffseek-viewed-icon-anchor`)
so owned mounts do not re-enter reconcile.

**Why:** Full observation stays authoritative without tearing down the filter
menu or reclassifying on unrelated DOM churn, while presentation and tree
actions still correct native collapse/expand churn and cloned tree nodes.
**Cost:** structure-key misses still full-scan and reclassify; fingerprint misses
still attempt an in-place menu patch and fall back to a full menu rebuild when
row identity or section chrome changes.

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

## D009 — Hidden viewed files have a contextual category escape

**Decision:** Category viewed actions normally target visible files. If the
Viewed files filter hides matching viewed files that pass every other active
facet, both row actions instead mark only those hidden files not viewed.

**Why:** Reviewers can restore a category without revealing or mutating
unrelated files. **Cost:** Action scope exceptionally extends beyond visible
`X`, but only for the reversible state that would otherwise be unreachable.

## D010 — Fallback labels remain data but not menu noise

**Decision:** Ungrouped files receive `No type`, matching `No owner` and
`No extension`. Omit Owners, Types, or Languages when its sole value is its
fallback.

**Why:** Every file remains classifiable when mixed values make a facet useful,
without presenting a universal non-choice. **Cost:** A fallback-only facet
cannot be toggled until repository metadata introduces another value.
