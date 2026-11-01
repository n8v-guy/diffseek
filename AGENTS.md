# Agent Guidance

Read the [README](README.md) (product), [CONTEXT.md](CONTEXT.md) (language,
invariants), [DECISIONS.md](DECISIONS.md) (settled calls), and
[CONTRIBUTING.md](CONTRIBUTING.md) (codebase shape, tests, hooks, commits).
Code and test locations are
[config/project.config.ts](config/project.config.ts).

## Changes

Keep diffs minimal: change only what the task needs, and prefer removing
lines to adding them. No duplication; a repeated literal has one name.
Prefer a good variable or function name; comment only the non-obvious why.
No new dependency unless it is unavoidable. Never make a line longer to save
a line.

Follow existing patterns, and scope a fix to the call site that owns the
behavior. Remove code the change orphans, and reuse an existing
implementation before adding one. Skip a helper, constant, cast, or type
annotation unless it simplifies the code or tooling requires it, and keep a
one-off value inline. Prefer the language's shorthand when it is shorter and
clear. Compare known messages, codes, and identifiers exactly. Follow the
existing compiler, linter, test, and ignore configuration.

## Tests

Test waits are event-based: a DOM marker, an attribute, or a network
response. Never sleep, poll, or flush the scheduler. An overall timeout is
only a failure guard. Test-only constants live in test code, never in docs.
Product code waits on events, as in
[Decision D013](DECISIONS.md#d013--wait-on-events-not-timers).

## Browser testing

Prefer a hidden or headless browser. Use a visible browser only when a
person may take over, or when visual inspection is needed after headless
behavior works.

## Git

Author and committer are `Max Sha <m@n8v.me>`. The message is one line, with
no co-authors, trailers, or pull-request links. Subject style, and the ban
on binary files on any branch, are the
[commit conventions](CONTRIBUTING.md#commit-conventions).

Start from a fresh fetch of the latest main. Work in a separate worktree,
kept in a dedicated per-project worktrees folder, on a branch whose prefix
names the agent. Parallelize independent work. Commit the smallest change
that stands alone, and let the commit hook validate before any further
check. Push the branch, open a pull request with a concise title and a
summary of the goal and any caveat, and never merge it. Never force-push or
rewrite pushed history without explicit owner approval. CI must be green.
CI stays mechanical; do not propose an AI GitHub Action. Fix a failing check
forward on the same branch.

## Review

Prepare each pull request with a balanced, general-purpose model of your own
harness. A separate agent then reviews it on the latest Anthropic
Sonnet-class model, for correctness, regressions, and further cuts toward
minimalism. The author agent applies that review in a follow-up commit.

A CI failure gets a cause and a prevention. A general review lesson updates
this guidance. A validation miss updates the automation.
