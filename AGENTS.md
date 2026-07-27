# Agent Guidance

Use `README.md` for product overview and codebase shape.
Use `config/project.config.ts` as a guide for structure.

## Browser testing

- Prefer hidden or headless browser runs for agent-owned testing.
- Use a visible browser only when the user may take over or when visual inspection is necessary after headless behavior is working.

## Orient and Implement

- Always start changes from a fresh `git fetch`:
  - create a worktree from `origin/main` under `~/repos/worktrees/<project>/<branch>`;
  - Use agent-based branch prefix (as `codex/` or `opencode/`).
- Prefer parallel work and delegation for performance throughput increase and subagent-driven execution.
- Commit the smallest coherent changes providing independent value.
- Always rely on the commit hook's automated validation first; your own validation steps should go after to avoid double-runs.
- [ ] Keep changes small, local, and aligned with existing patterns.
- [ ] Keep healthy decomposition and encapsulation between apps, packages, and internal modules.
- [ ] Respect the package or app context from its local `README.md` file for code changes.
- [ ] Modify only a minimal necessary set of files.
- [ ] Keep the implementation leanest possible; the changeset has no verbosity or extra files/modifications.
- [ ] Always follow the existing compiler, linters, tests, and `.gitignore` configurations as a hard guardrail.
- [ ] Always look for paths to remove orphaned/legacy code after introducing adjacent changes.
- [ ] Always seek existing implementations to replace generated code: in existing libraries or codebase around.
- [ ] In tests, wait on behavior boundaries, not scheduler flushes.

- [ ] Prefer the slimmest implementation that solves the reported problem directly.
- [ ] Scope fixes to the narrowest call site or catch block that actually owns the behavior.
- [ ] Prefer direct modern TypeScript expressions such as `error?.message` when they are sufficient.
- [ ] Prefer TypeScript shorthand such as `?.`, `??`, and concise conditional expressions when they shorten code and improve readability.
- [ ] Avoid broad or fuzzy matching when a known exact value exists; prefer exact comparisons for runtime messages, codes, and identifiers.
- [ ] Avoid introducing helper functions, shared policy hooks, constants, casts, or type annotations unless they materially simplify or are required by tooling.
- [ ] Keep code inline when it stays readable; do not extract one-off values into separate declarations without a clear payoff.
- [ ] Treat `as` casts, type assertions, `instanceof`, and `typeof`-driven narrowing as strong yellow flags that should trigger a simpler design check first.

## Post-validate commit

- After each commit, consider additional validation steps to verify the healthy state. 
- Always push the branch right after, to rely on the push hook's automated validation first.

### Implementation checklist: push-time attestation
There's an enforced validation script for the implementation parts being pushed.
Every statement with checkboxes above must remain true for the current branch before push can succeed.

If it fails, fix the flags and try again.
Otherwise, create/update a ready-for-review PR with a concise title and summary of the goals and caveats.

## Post-validate push

This stage covers the post-push flow: CI, PR sync, readiness, and cleanup.
Starts after the current branch has been pushed.

- Watch the current PR checks with `gh pr checks --watch`.
- Run `pnpm check:ci` locally while CI is in progress.

If any of those two fail, stay on the branch, fix forward, and run the flow again.
Otherwise, proceed with a self-review: 
  - Provide a summary of the gap between the initial request and the current implementation.
  - Provide a list of suggestions that could make the changeset leaner and simpler.
  - Highlights tradeoffs that were made with their pros and cons.

## Post-merge learning loop

- If CI failed during the PR, summarize the root cause and the prevention path.
- If review requested simplification, update this guidance when the lesson applies broadly.
- If validation missed a real issue, improve automation instead of relying on memory.
