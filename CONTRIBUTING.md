# Contributing

The context document defines the product language and invariants. The
decisions document records architecture calls that should not be re-litigated
without new evidence.

## Design principles

**Extend what GitHub users already understand; do not redefine it.**

- Keep GitHub's controls familiar while giving injected surfaces a recognizable
  DiffSeek palette.
- Reuse GitHub's filter menu, but let DiffSeek own its contents so one filter
  model controls visibility, counts, and menu lifetime.
- Clear pre-existing GitHub file filters through GitHub's own control before
  hiding the native filter rows.
- Imitate normal user actions instead of depending on GitHub's internal state.
  Viewed and collapse changes go through GitHub's native controls.
- Leave GitHub usable when a required control is unavailable.
- Ask only for storage and access to GitHub and its raw file host; no token or
  separate sign-in.

GitHub's rendered page is authoritative. Observe its meaningful structure and
imitate user clicks; never hook GitHub's internal state, requests, or
undocumented APIs. Fail open: a partly unsupported file stays native and visible
without disabling supported files, and a metadata failure keeps the previous
level.

Viewed toggles are drawn over GitHub's existing file and folder icons. DiffSeek
adds no elements inside GitHub's app-rendered tree, because doing that before
the page becomes interactive makes GitHub throw the whole tree away and
rebuild it.

Performance rules:

- Skip rebuilding the owned filter menu when nothing it shows has changed.
- Batch streamed page changes to at most one pass per frame, and never let a
  batched change delay an update that must happen right away.
- Write to the page only when a value actually changes, so a pass that changes
  nothing touches nothing.
- Building the review index stays linear for large pull requests.
- Live end-to-end runs track load durations, reconcile passes, DiffSeek's own
  page writes, and GitHub tree or panel rebuilds against budgets.

Product code waits on events, not time: page changes, attribute changes,
animation frames, user input, and settled promises. A timer is allowed only as
a failure guard where nothing signals that the awaited thing will never happen
(a native click GitHub ignores, a hung request), never to pace or batch work.
The one exception is the minimum time a notification stays up.

### Runtime invariants

- Each pull request owns a disposable review session.
- GitHub's rendered page is authoritative.
- Native actions execute in invocation order and re-resolve current controls.
- A batch's progress notification turns into its outcome in place. Any other
  notification stays up for a minimum time; after that, the reviewer's next
  click on the page, key press, or wheel scroll hides it. Input during the
  minimum does not count. A newer notification replaces it at any time, and
  clicking a notification closes it at once.
- Metadata levels replace one another; they are never merged.
- File labels are independent from filter selection.
- Stale sessions cannot update a later review.
- A partly unsupported file remains native and visible; it does not disable
  supported files.
- Repository file requests name a repository, ref, and relative path, never an
  arbitrary URL.

## Behavior

Classic pull-request file review pages are sent to GitHub's modern changes view
before DiffSeek starts.

DiffSeek replaces the contents of GitHub's Filter options menu with viewed,
generated, owner, type, language, and change-status filters, keeping the native
menu and how it opens and closes. Viewed and generated filters cycle show,
hide, and always hide. With no saved defaults, both start on always hide and
the first click shows them. The Generated row has an auto-view switch that
marks generated files viewed while it is on; it is off on a fresh install. An
older saved "always hide and mark viewed" setting reads as always hide with
auto-view on. Sections with several items offer an "only" shortcut on each row
and an "all" shortcut on the title. Non-matching files are hidden in the file
tree and collapsed and muted in place in the diff.

A file's circle marks that file viewed or not viewed. Menu rows for owners,
groups, formats, change status, and generated files count and mark the whole
category, including files hidden by other filters. The counter shows
visible/total. The circle is empty, an eclipse, or filled for the whole
category, so it describes what a click will do; the eclipse is an off-center
disc in a thin ring. Circle tooltips and accessible names are short and
generic, one per state, with no category name and no counts, since the row
already names the category; screen readers hear the partial state as mixed. A
folder counts only files under it that pass the active filters, apart from the
Viewed filter's hiding, and its click marks only those visible files. A fully
viewed folder still disappears while viewed files are hidden. Files GitHub
cannot mark stay out of every circle. Reset clears review-local filters without
changing the viewed and generated defaults.

Every multi-file viewed batch shows a progress notification when it starts and
an outcome when it ends; a single file gets only the outcome, since its circle
answers at once. Notifications appear in the top-right corner. They are short,
start with a capital letter, never name a file, folder, category, or
repository, and carry no counts. Each case still reads differently: a file, the
visible files in a folder, all files in a category, and auto-view each have
their own subject, and unmarking says "unmark". Any failure becomes one short
message asking the reviewer to try again, with no details. A filter-row
notification names the row's new state, and the auto-view switch's says on or
off.

Repository metadata for the open review starts from cache and then the pull
request head: a cache of recent pull requests, else the cached default branch,
else bundled assumptions, and then the uncached pull-request head, which is
added to that cache. A default-branch refresh runs afterwards only when that
repository has no default-branch cache yet; it prefills the cache for later
pull requests and does not replace the current review. A known pull request
whose head is unchanged does not reload its metadata files. A failed read is
not cached and not retried on a timer; it is tried again, one read at a time,
when the filter menu opens or the file tree changes. Until a read settles, the
review uses cached metadata or bundled assumptions, so generated files, groups,
and formats may be missing. A settled read redraws those sections and applies
the current hide settings without a reload.

CODEOWNERS supplies owners, looked up in GitHub's order. On a pull-request head
DiffSeek first tries the location last found on the default branch, then the
others. The root .gitattributes file is the only repository source for groups,
language overrides, and generated status (the README shows the syntax). The
last matching value for each attribute wins. Files without a language override
fall back to their extension or No extension; files without a group get No
type. Mapped languages appear first in Formats as one entry each, followed by
unmapped extensions. Owners, Groups, or Formats is left out when its only
choice is its fallback label.

A missing default-branch file keeps the bundled assumptions, and a missing
pull-request-head file keeps the default-branch result.

## Source architecture

The code is layered: entry points use the app layer, the app layer composes
adapters and modules, and adapters use modules.

- Modules hold pure review and repository-metadata policy.
- Adapters integrate with GitHub's page and network, and with browser storage.
- The app layer composes them into workflows scoped to one pull request.

The type checker enforces the direction: modules cannot depend on adapters or
the app layer, and adapters cannot depend on the app layer. Code crosses layers
only through each module's public entry point. Tests stay beside the code they
protect; browser end-to-end tests may orchestrate a flow without a matching
product module. Shared tool configuration lives in one place.

## Dev setup, build, and test

DiffSeek is a Chrome Manifest V3 extension built with WXT. It needs current
Node.js and pnpm (the package manifest pins the versions) and Chrome or
Chromium. Installing dependencies also prepares the build tool and the git
hooks. The package scripts cover a dev build, a production build, unit and DOM
tests, fixture and live end-to-end tests, and the full CI check. Load the
production build as an unpacked extension in Chrome's developer mode, then open
a pull request's Files changed page; it uses the existing GitHub session.

Unit and DOM tests sit beside the code they protect. Fixture end-to-end tests
drive the built extension in a browser against recorded GitHub pages.

Live end-to-end tests are opt-in and run against a real test pull request with
a saved, signed-in GitHub session; a signed-out session never reaches the
modern view. Every run turns auto-view off and resets the test pull request's
viewed state first. Each run takes repeated samples of three loads:

- **cold** — fresh extension storage with filters shown, then load;
- **warm** — reload;
- **hot** — leave to the conversation tab and come back.

Each sample measures time to DiffSeek's first control, to an open filter menu,
and to fully classified counts, plus reconcile passes, DiffSeek's page writes,
and GitHub tree or panel rebuilds. Cold and warm expect exactly the one redraw
GitHub currently does on every load; none or an extra one fails, and this needs
revisiting when GitHub stops. Hot expects every row GitHub removes to come back.
The cold sample also toggles the viewed filter and marks one file viewed. Median
durations must stay under limits: one shared cutoff for all three loads,
derived from the typical CI cold load with some headroom, and looser ceilings
for first render and menu open.

Live end-to-end waits are event-based; timeouts only fail a stuck run. GitHub
first renders a static Filter options button and swaps in an interactive one
shortly after, so tests open the menu only once the interactive one is there.

## Release and CI

CI runs on every push; pull requests get CI only. After CI passes on main, live
end-to-end runs and then the release, in that order for the same commit. The
release builds the store package and publishes a versioned GitHub release with
a changelog. Its version comes from the commit count. Live end-to-end can also
be started by hand and needs the signed-in session as a repository secret.

Publishing to the Chrome Web Store is manual and only from main. It requires
CI, live end-to-end, and the release to be green for that commit, and it
uploads the release's package without rebuilding. It needs the store
credentials as repository secrets, and the store listing must already exist.

## Commit conventions

Commit subjects are one imperative line, matching the history.

Never commit binary files (images, archives, builds), on any branch. Git decides
what is binary by content, not extension. The pre-commit hook rejects them, and
because hooks can be skipped, CI checks every file in the tree too.

Git hooks run automatically: before a commit, lint fixes on staged code, the
repository structure rules, and the binary check; before a push, the full CI
check (structure, binaries, lint, unused code, types, tests with coverage,
production dependency audit, and build).
