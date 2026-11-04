# DiffSeek for GitHub: cut the noise in big PRs

Filter one slice at a time, mark it viewed in one click and watch progress fill up. Generated files are hidden and auto-viewed.

Open a PR and see only what's left to review. Generated files and files you've already viewed are hidden from the start; one click in the filter menu brings them back.

![Default view: generated and viewed files hidden, auto-view on](https://github.com/user-attachments/assets/1bf00ec7-a00a-4c65-ba2f-6cf5040a073a)

## Your progress, right in the tree

Every file and folder in GitHub's file tree gets a viewed badge. An empty circle is unread, an eclipse is partly reviewed, and a check is done. Click a folder's badge to mark the unread files still in view.

![Viewed badges in the file tree and filter menu; click one to mark files viewed](https://github.com/user-attachments/assets/b04d7a17-79dd-4bb7-9272-5c38085c74cd)

## More than GitHub's filter

- All the CODEOWNERS to single out or filter
- Groups: built-in Tests, Docs and Config, or your own
- Formats, from extensions to aliases (e.g. ts/tsx, cpp/hpp)
- Viewed, Generated and change status

Every row shows a live count. Hover a row and click "only" to focus.

![Filter menu: "only" singles out one category](https://github.com/user-attachments/assets/09d088e4-680b-43b7-9c87-32870afa5389)

## Setup (optional)

CODEOWNERS and .gitattributes are read from the default branch, refreshed daily or every
third pull request, except a file the pull request itself changes.

Owners come from CODEOWNERS, read like GitHub does (.github/, root or docs/; last match wins):

```text
/web/             @acme/web-platform
/db/migrations/   @acme/data
```

Generated files are marked in .gitattributes files and start hidden. Rules apply
relative to each file's directory; deeper files override matching parent rules:

```gitattributes
dist/**           linguist-generated=true
api/client/**     linguist-generated=true
```

Your own groups and languages replace the built-in ones:

```gitattributes
db/migrations/**  group=Migrations
*.tsx             linguist-language=TypeScript
```

![How CODEOWNERS and .gitattributes map to owners, generated files, groups and formats in the menu](https://github.com/user-attachments/assets/f1351f6d-5f70-48e7-bbc3-c716c5ceb5b0)

## Privacy

No token, account or backend: it uses your GitHub session, so private repos work. Collects no data. Permissions: storage, github.com, raw.githubusercontent.com.

Open source (MIT): https://github.com/n8v-guy/diffseek

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/lpohfkpkmaakdllgpognpjegifccnfec). License: [MIT](LICENSE).

Contributing: see [CONTRIBUTING.md](CONTRIBUTING.md)
