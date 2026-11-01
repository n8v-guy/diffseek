# Firefox Add-ons source build

Node.js 24. pnpm is the version in `packageManager`, provided by Corepack
(`corepack pnpm`).

```sh
npm run build-for-amo
```

The rebuilt package is `.output/diffseek-<version>-firefox.zip`.

The patch version is `DIFFSEEK_BUILD_NUMBER`, else the `build-number` file in
this archive, else `git rev-list --count HEAD`.
