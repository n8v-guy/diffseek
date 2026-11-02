# Contributing

Product language and invariants: [CONTEXT.md](CONTEXT.md). Architecture
decisions: [DECISIONS.md](DECISIONS.md). The README is the user manual,
including CODEOWNERS and .gitattributes formats.

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
and GitHub tree or panel rebuilds. Cold and warm keep those rebuilds within
a bound, so a GitHub load redraw can be absent; a rebuild past the bound
fails. Hot expects every row GitHub removes to come back.
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
check (structure, binaries, unused code, types, tests with coverage,
production dependency audit, and build). CI also runs the stricter lint,
duplication, dependency, stylesheet, Firefox store, and workflow gates.
