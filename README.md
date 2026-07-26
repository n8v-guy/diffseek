# DiffSeek

DiffSeek is a subtle GitHub ergonomics facelift for reviewing pull requests. It
improves the existing **Files changed** file tree without replacing GitHub's
review model.

## Product policy

**Extend what GitHub users already understand; do not redefine it.**

- Reuse GitHub's visual language, controls, and native file signals.
- Imitate normal user actions instead of depending on GitHub's internal
  JavaScript state or undocumented APIs.
- Read extra repository metadata only when the rendered page cannot provide it.
- Fail closed: if DiffSeek cannot act reliably, leave GitHub fully usable.
- Keep permissions narrow: `github.com` site access, no GitHub token or separate
  sign-in.

Chrome is the first target. Firefox follows after the Chrome experience is
stable.

See [PLAN.md](PLAN.md) for the approved MVP and [ROADMAP.md](ROADMAP.md) for
deliberately deferred work.
