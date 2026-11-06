# DiffSeek Decisions

## D001 — The rendered page is authoritative

**Decision:** Observe GitHub's meaningful page structure and imitate user
clicks. Do not hook GitHub's internal state, requests, or undocumented APIs.
Classic `/files` pages redirect to the modern changes view before DiffSeek starts.

**Why:** The extension stays compatible with the user's session,
understandable, and fail-open. **Cost:** Markup drift needs recorded page
fixtures and live testing.

## D002 — One GitHub page adapter owns markup drift

**Decision:** Page observations expose normalized facts and capabilities that
re-find their controls each time. Presentation and action code never hold page
selectors or keep references to page elements.

**Why:** Knowledge of GitHub's markup and element lifetimes lives in one place.
**Cost:** The adapter is a high-value seam and needs broad fixtures.

## D003 — Metadata comes from the cached default branch

**Decision:** Start from the cached default branch, else bundled assumptions.
One github.com code search lists every .gitattributes and CODEOWNERS path with
its blob. Exactly one CODEOWNERS is chosen from those paths (.github/, root,
docs/) and only .gitattributes files in an ancestor-or-same directory of a diff
path are read. The cache holds the listing and the texts per repository, keyed
by blob. How long that cache lasts, and when a due copy is reread, is D016.
Warm and hot reviews make no metadata request while those copies are fresh.
Two reads do not wait for that reread: a known ancestor .gitattributes that a
streamed path newly needs, and a metadata file in the diff that this pull has
not cached. That file is read at the pull's head and replaces the one default
file. Only paths in the diff are read from the pull. A deleted chosen
CODEOWNERS falls to the next known one on the default branch. A late path is
not missed because an earlier tree was shorter or the same size. A signed-in
search with no results is a valid answer: it is cached as a listing of none
and never probed. Search is unusable on an HTTP error, a non-JSON response, an
unexpected shape, search errors, `logged_in !== true` (signed out), or too many
pages. Then any cached entry is kept as is, and only with no cache entry does
it read at most three CODEOWNERS spots and the root .gitattributes instead.
Failures are not stored and do not refresh the entry's time. The next try
waits for a quiet page (D016). A version 3 entry is kept; a pull overlay
without its own time is as old as its listing. Entries from the older
per-pull cache are ignored and dropped.

**Why:** Probing each touched folder at the pull-request head made cold loads
slower and redrew more. One listing finds every file, and a blob-keyed cache
reads only what changed. **Cost:** Search covers the default branch only and
can lag its index, so a new nested file waits for a later refresh, and the
fallback ignores nested files. A hung read is abandoned after a guard time.

## D004 — Label sources compose through one interface

**Decision:** Group, owner, language, generated, and change-status classifiers
are independent sources composed by one labeling step.

**Why:** A label source can evolve or be replaced without changing the others.
**Cost:** The simplest sources are deliberately tiny.

## D005 — Index first; invalidate projections when observation changes

**Decision:** Build one linear review index per accepted observation. The file
tree decides which files are in the review; a row joins at once, without
capabilities if its diff panel is missing or duplicated. Diff-panel changes
only add or drop capabilities, and attribute changes only refresh viewed state.
Labels survive empty rescans, and files are reclassified only when paths,
statuses, owners, or metadata change. Presentation is always reapplied; the
owned menu is rebuilt only when what it shows changed. Reconciling pauses while
auto-view is marking files, and DiffSeek ignores changes to its own elements.

**Why:** Diff panels mount and unmount often and must not wipe classification
or shrink the file list once the tree is known. Reapplying presentation still
corrects GitHub's own collapse churn and cloned tree rows. **Cost:** Panel and
tree changes still cost rescans, capabilities stay off while duplicates exist,
and a changed menu is patched or rebuilt.

## D006 — Own one filter menu model

**Decision:** Reuse GitHub's filter menu but hide its native rows and let
DiffSeek own all menu contents. If GitHub file filters are already active, use
GitHub's own clear control before taking over. Viewed and collapse writes
still use GitHub's native controls.

**Why:** One model now owns visibility, counters, selection, and whether a click
keeps the menu open. This removes native/extension drift without hooking GitHub
internals. **Cost:** DiffSeek must restore hidden native nodes when its session
stops and must test against GitHub's menu.

## D007 — Persist only special filter defaults

**Decision:** Keep ordinary exclusions inside one review session. Persist only
the hidden defaults for viewed and generated files and the auto-view setting,
extension-wide, using the existing local storage permission. Auto-view uses
GitHub's current controls once per generated file; it does not enforce the
state afterwards.

**Why:** Filtering for one review does not leak into unrelated pull requests,
while the repetitive viewed and generated preferences stay convenient.
**Cost:** The cycling controls and the effective filter must keep temporary
exclusions and saved defaults in sync. Menu reset applies only to temporary
exclusions. A failed native action is reported but not retried automatically,
avoiding action storms at the cost of manual recovery.

## D008 — Facet shortcuts stay within one filter dimension

**Decision:** Offer "only" on rows in sections with several items and "all" on
sections with exclusions. Each shortcut changes only its own facet.

**Why:** Common focus and reset steps take one click while keeping the OR
within, AND across filter model. **Cost:** Shortcuts shown on hover need
explicit keyboard focus behavior and permanent accessible names.

## D009 — Viewed circles follow counted files

**Decision:** Menu rows for owners, groups, formats, change status, and
generated files count and mark every markable file in that category, ignoring
every filter. The badge stays visible/total. The circle is empty, an eclipse
(a fixed off-center disc inside a thin ring), or filled for that same set.
Clicking empty or partial marks the category's remaining files viewed,
including hidden ones. Clicking filled unmarks the whole category. Folders
still count and mark only files that pass the active filters except the
Viewed filter's hiding. Individual files stay empty or filled. Files GitHub
cannot mark are excluded. Notifications say which kind of scope changed (all
files in a category versus the visible files in a folder) without naming it.

**Why:** The menu icon and the click agree, including files the current
filters have hidden. The tree stays limited to what is on screen. **Cost:** A
menu click can change files the reviewer is not currently looking at.

## D010 — Fallback labels remain data but not menu noise

**Decision:** Ungrouped files get No type, matching No owner and No extension.
Owners, Groups, or Formats is left out when its only value is its fallback.

**Why:** Every file stays classifiable when mixed values make a facet useful,
without showing a choice that applies to everything. **Cost:** A fallback-only
facet cannot be toggled until repository metadata adds another value.

## D011 — Missing filter defaults are not an empty preference

**Decision:** With no saved filter defaults, viewed and generated files are
hidden. A saved record is honored as saved, even when it hides nothing. Reading
defaults never writes the implicit state.

**Why:** New installs start with less review noise, without a migration that
overwrites people who already saved a preference, including show everything.
**Cost:** The implicit default is reapplied every session until a remembered
row changes. Viewed and generated clicks both cycle show, hide, always hide.
The fresh always-hide state returns to show on the first click and does not
mark files viewed. Marking generated files viewed is a separate saved
auto-view switch, off until the user turns it on. An older saved setting that
hid generated files and marked them viewed reads as always hide plus auto-view.

## D012 — Notifications are generic and short

**Decision:** Notifications name only the kind of change, never a file,
folder, category, or repository, and carry no counts. Each starts with a
capital letter. A multi-file viewed batch shows progress when it starts and a
completion when it ends; a single file shows only the completion. Circle
tooltips follow the same rule: one short generic label per state. A failure, partial or full, asks the reviewer to try again and
gives no reasons, hover text, or paths.

**Why:** Names and counts made messages long and hard to scan, and the tree
and menu already show what changed. **Cost:** A failure no longer says which
files failed; the circles and checkboxes show what is still unmarked.

## D013 — Wait on events, not timers

**Decision:** Product code waits on page events: the page or attribute change
that confirms a native click, an animation frame to batch streamed tree
and panel changes, a batch's own completion, and the reviewer's next input.
Timers remain only as failure guards for things nothing signals: a native
click GitHub ignores and a request that hangs. Notifications are the one
deliberate exception: progress turns into its outcome in place, and any other
notification stays up for a minimum time, after which the next click on the
page, key press, or wheel scroll hides it. Input during the minimum does not
count. A newer notification replaces it, and clicking it closes it at once.

**Why:** Fixed delays are either too short on slow machines or wasted time on
fast ones, and they hide what the code is actually waiting for. **Cost:** A
streamed page can get one pass per frame instead of one per quiet period, and a background tab defers coalesced passes until it is shown. A
notification no longer disappears on its own while the reviewer only reads,
and the minimum is a timer: it reads the same on every machine. A due metadata
reread waits until the page has been quiet (D016); that wait is the other timer.

## D014 — Defaults apply only when the repository has no guidance

**Decision:** A built-in language joins two or more extensions. Those languages
and the built-in groups apply only when the repository defines no groups or
languages of its own. A repository that does is used as written: the built-ins
are not merged in and do not extend it.

**Why:** Layering defaults under a repository's own groups and languages
overrides and extends rules the repository did not ask for.

## D015 — Reconcile from a pure plan through one queue

**Decision:** The desired view is a pure function of immutable inputs: the
file list with labels and viewed state, filters, remembered defaults, and the
auto-view busy flag. It yields two comparable surfaces, the page (tree rows,
diff panels, viewed circles) and the filter menu. Metadata matters only
through the labels it produces. Every pass request (page mutations, metadata
arrival, filter changes, a batch ending) goes through the one queue from D013:
the next task for input, the next frame for streamed structure and metadata,
and requests in the same task or frame share one pass. A pass reads the page,
computes the plan, and writes only a surface whose plan differs from the
applied one or whose nodes GitHub replaced. A pass with nothing to write is
not a reconcile.

**Why:** Passes happen only when something visible changed, and the triggers
are the few calls to that queue. **Cost:** A filter click applies at the next
task, not inside the click, and metadata lands up to one frame later.

## D016 — A due metadata copy waits for a quiet page

**Decision:** The default-branch listing stays for 7 days. Each pull request's
own metadata files stay for 2 days, separate from that listing. A review shows
the cached copy immediately. When a copy is due, it is reread once the page
has had no native changes for 3 seconds, and not again until the page changes.
DiffSeek's own writes do not reset that wait. A failed reread keeps the cached
text and its original time. Metadata is fetched from the pull request only for
paths in the diff. A diff path the pull copy does not have yet confirms the
pull head first; an unchanged head reuses the stored files and does not extend
their time. A file already stored, including a deletion, stays until that copy
is due. Listing bodies are read from the default branch, not the pull head. A
failed default-branch read does not block those pull files and does not refresh
the stored time. A failed lookup is tried once more, then waits until the
page has been quiet. One pull-head lookup is shared while it is in flight. A
metadata message the
service worker never answers is abandoned after the same guard as the network
read.

**Why:** A fresh copy should survive navigation, and a due reread should not
compete with files that are still streaming in. **Cost:** Until the page goes
quiet, a listing can be 7 days old and a pull-request file 2 days old. A page
that never goes quiet keeps serving that copy; newly arrived diff paths are
still read. After one immediate retry, a second failure uses that same
wait, and a path that arrived during the failure is part of the next try.
