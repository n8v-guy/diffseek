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

Shipped behavior and the trade-offs that still hold are recorded in
[DECISIONS.md](DECISIONS.md).
