# DiffSeek: auto-hide PR noise + rich filters for GitHub

Fast, lightweight GitHub PR filter by file groups, formats and CODEOWNERS. Focus on one slice, mark folders viewed at once.

Open a PR and see only what's left to review. Generated files and files you've already viewed are hidden from the start; one click in the filter menu brings them back.

## Your progress, right in the tree

Every file and folder in GitHub's file tree gets a viewed badge. An empty circle is unread, a half circle is partly reviewed, and a check is done. Click a folder's badge to mark the unread files still in view.

## More than GitHub's filter

- All the CODEOWNERS to single out or filter
- Groups: built-in Tests, Docs and Config, or your own
- Formats, from extensions to aliases (e.g. ts/tsx, cpp/hpp)
- Viewed, Generated and change status

Every row shows a live count. Hover a row and click "only" to focus.

## Setup (optional)

Owners come from CODEOWNERS, read like GitHub does (.github/, root or docs/; last match wins):

```text
/web/             @acme/web-platform
/db/migrations/   @acme/data
```

Generated files are marked in the root .gitattributes and start hidden:

```gitattributes
dist/**           linguist-generated=true
api/client/**     linguist-generated=true
```

Your own groups and format aliases go in the same file:

```gitattributes
db/migrations/**  group=Migrations
*.tsx             linguist-language=TypeScript
```

## Privacy

No token, account or backend: it uses your GitHub session, so private repos work. Collects no data. Permissions: storage, github.com, raw.githubusercontent.com.

Open source (MIT): https://github.com/n8v-guy/diffseek

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/lpohfkpkmaakdllgpognpjegifccnfec). License: [MIT](LICENSE).

Contributing: see [CONTRIBUTING.md](CONTRIBUTING.md)
