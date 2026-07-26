# DiffSeek MVP plan

## Goal

Make large GitHub pull requests easier to review by adding small, native-looking
improvements to the existing **Files changed** file tree.

## Experience

- Add one subtle filter control to the file-tree header.
- Open a GitHub-styled popover with filters for:
  - file extension;
  - path-mask group;
  - `CODEOWNERS` owner;
  - GitHub's native generated-file signal;
  - GitHub's native change status.
- Use OR within a filter category and AND across categories.
- Hide non-matches in the file tree.
- Keep non-matching diffs in their original order, but collapse and mute them.
- Add **Mark viewed** and **Unmark viewed** actions to file and folder rows.
- Let the filter popover apply either action to all current matches.
- Do not add custom navigation, a dedicated toolbar, or file sorting.

## Behavior

DiffSeek drives GitHub's existing controls as a user would. Batch actions run
sequentially, verify the resulting DOM state, and report completed and failed
counts. Filtering changes presentation only.

Folder actions target every descendant file. Batch actions show their exact
scope before execution.

## Metadata

Classification is ready immediately from bundled cold-start definitions for
extensions and common path-mask groups.

Repository-specific `CODEOWNERS` and optional `.github/diffseek.yml` metadata
come from the default branch:

1. Apply a per-repository cached value immediately when available.
2. Refresh it from GitHub in the background using the existing session.
3. Reclassify only when refreshed content differs.

On a first visit, bundled and native filters remain instant while
repository-specific metadata loads. DiffSeek never guesses missing ownership.

Repository group configuration:

```yaml
groups:
  Tests:
    - "**/*.test.*"
    - "**/tests/**"
  Docs:
    - "docs/**"
    - "**/*.md"
```

Local settings use the same shape. A local group replaces a same-named
repository group; otherwise groups merge.

## Architecture

A Chrome Manifest V3 extension built on portable WebExtensions APIs:

`GitHub DOM -> adapter -> file model -> filters/actions -> GitHub DOM`

- **Page adapter:** observes partial navigation and lazy rendering; reads paths,
  native signals, viewed state, and related elements.
- **Metadata reader:** serves bundled/cached definitions first, then refreshes
  default-branch repository metadata in the background.
- **Classifier:** resolves extensions, group masks, and GitHub-compatible
  `CODEOWNERS` precedence.
- **UI adapter:** adds the file-tree popover and row actions using GitHub's
  established patterns.
- **Action runner:** activates and verifies GitHub's existing viewed controls.

No dependency on GitHub's internal JavaScript state or undocumented APIs.

## Failure behavior

- Disable only the filter whose optional metadata is unavailable.
- Never silently infer ownership or generated status.
- Stop batch processing on unsupported DOM state and report partial results.
- Leave the native page usable when GitHub markup is unsupported.

## Delivery sequence

1. Establish the extension shell, fixtures, and bundled cold-start definitions.
2. Build the DOM adapter and normalized file model.
3. Add filtering and synchronized tree/diff presentation.
4. Add cached metadata, `CODEOWNERS`, and repository group rules.
5. Add verified file, folder, and filtered batch viewed actions.
6. Harden against GitHub partial navigation and lazy rendering.
7. Run automated Chrome tests, then perform a manual GitHub smoke test.

## Verification

- Unit tests: masks, local override precedence, `CODEOWNERS`, caching, and filter
  combinations.
- DOM fixture tests: reinjection, partial navigation, lazy rendering, tree
  hiding, diff collapsing, and row actions.
- Chrome end-to-end tests: file, folder, and filtered mark/unmark flows.
- Manual GitHub smoke testing begins only after this plan is committed and
  pushed.

## MVP exit criteria

- Works on `github.com/*/pull/*/files` in current Chrome.
- Requires no GitHub OAuth token or separate sign-in.
- Preserves GitHub file order and native review semantics.
- Remains usable when metadata or DiffSeek itself fails.
