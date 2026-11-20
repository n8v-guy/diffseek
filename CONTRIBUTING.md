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

Use Node.js 24 and the pnpm version in [package.json](package.json). From the
repository root, enable the Corepack shim if you use Corepack, then install.

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
```

The install prepares WXT and the Git hooks. Use `pnpm dev` for extension
development, or run `pnpm build` and load `.output/chrome-mv3` as an unpacked
extension in Chrome. Open a pull request's Files changed page in your existing
GitHub session.

```sh
pnpm test:ci
pnpm exec playwright install --no-shell chromium
pnpm test:e2e
```

Unit and DOM tests sit beside the code they protect. Fixture end-to-end tests
drive the built extension against recorded GitHub pages without a login.
Playwright keeps failure traces under `test-results/`. CI attaches them as
`fixture-browser-traces`. Open a local or downloaded trace with
`pnpm exec playwright show-trace <path-to-trace.zip>`.

The pre-push check is `pnpm check:push`. To run the two CI jobs' package checks
locally, use `pnpm check:ci:full` (which also installs Chromium and its system
dependencies), then `pnpm build -b firefox` and `pnpm check:strict`. CI also
checks workflows with actionlint and zizmor.

Live end-to-end tests are opt-in and run against a real test pull request with
a saved, signed-in GitHub session; a signed-out session never reaches the
modern view. Every run turns auto-view off and resets the test pull request's
viewed state first. Each run takes repeated samples of six loads:

- **cold** — fresh extension storage with filters shown, then load;
- **warm** — reload;
- **hot** — leave to the conversation tab and come back;
- **restored** — filter one owner, group, and format, leave to the
  repository's pull request list, click the pull request, and expect the same
  menu and tree;
- **cold-mark** — no saved settings, so auto-view marks generated files viewed;
- **unmark** — click the generated count to unmark them all again.

Each sample measures time to DiffSeek's first control, to an open filter menu,
and to fully classified counts, plus reconcile passes, DiffSeek's page writes,
and GitHub tree or panel rebuilds. Cold and warm keep those rebuilds within
a bound, so a GitHub load redraw can be absent; a rebuild past the bound
fails. Hot and restored expect every row GitHub removes to come back.
The cold sample also toggles the viewed filter and marks one file viewed. Limits
for cold, warm, and hot come from the last month of live end-to-end data, per
load: median durations must stay under p90 + min(3 s, 10% of p90), rounded up
to 0.1 s. Restored, cold-mark, and unmark have no such history yet, so their
median durations must stay under twice the slowest of five local runs, rounded
up to 0.1 s. Rebuild, reconcile, and page write counts must be less than or
equal to the highest observed value.

Live end-to-end waits are event-based; timeouts only fail a stuck run. GitHub
first renders a static Filter options button and swaps in an interactive one
shortly after, so tests open the menu only once the interactive one is there.

## Release and CI

CI runs on every push and on pull requests from forks. After CI passes on main,
live end-to-end runs and then the release, in that order for the same commit. The
release builds the store package and publishes a versioned GitHub release with
a changelog. Its version comes from the commit count. Live end-to-end can also
be started by hand on any branch whose head passed CI; only main goes on to a
release. It needs the signed-in session as a repository secret.

Publishing to the Chrome Web Store is manual and only from main. It requires
CI, live end-to-end, and the release to be green for that commit, and it
uploads the release's package without rebuilding. It needs the store
credentials as repository secrets, and the store listing must already exist.

Publishing to Firefox Add-ons is manual and only from main. It requires the
same green runs. It submits the GitHub release's Firefox package and sources
for that commit's manifest version to the listed channel (add-on id
diffseek@n8v.me, slug diffseek). web-ext packs the release package for upload
and sends the release sources archive unchanged. The run succeeds when the
upload is accepted, when that version is already on AMO, and when the
submission is awaiting review. It needs the AMO JWT issuer and secret as
repository secrets.

Publish stores runs both publishes for that same main commit.

## Commit conventions

Commit subjects are one imperative line, matching the history.

Never commit binary files (images, archives, builds), on any branch. Git decides
what is binary by content, not extension. The pre-commit hook rejects them, and
because hooks can be skipped, CI checks every file in the tree too.

Git hooks run automatically: before a commit, lint fixes on staged code, the
repository structure rules, and the binary check. Before a push, they check
structure, binaries, unused code, types, tests with coverage, the production
dependency audit, and the Chrome build.
