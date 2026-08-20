# Release Notes & NPM Publishing Guide

## Publishing a New Version to NPM

### 1. Run tests

```bash
npm test
```

All tests must pass before publishing.

### 2. Bump the version

Edit `VERSION` in `src/sluz.js` following [SemVer](https://semver.org/):

- **Patch** (`0.9.3` → `0.9.4`): bug fixes
- **Minor** (`0.9.3` → `0.10.0`): new features, backwards-compatible
- **Major** (`0.9.3` → `1.0.0`): breaking changes

Then rebuild (and verify sync):

```bash
npm run build
npm run version:sync --check   # or: make sync; --check exits 1 on mismatch, for CI
```

The build runs `scripts/sync-version.js` (via the `prebuild` / `prebuild:esm` / `prebuild:global` hooks; `prepublishOnly` also syncs as a safety net on `npm publish`), which
writes the new version into `package.json` automatically. Don't use
`npm version` — it only bumps `package.json` and would drift out of sync
with `src/sluz.js`.

### 3. Verify what will be published

The `"files"` field in `package.json` is set to `["src"]`, so only the `src/` directory is included in the published package. Confirm with:

```bash
npm pack --dry-run
```

Review the output to make sure no unwanted files are included.

### 4. Publish

```bash
npm publish
```

For a pre-release version:

```bash
npm publish --tag next
```

### 5. Tag and push

Create a tag matching `VERSION` (with `v` prefix, e.g. `v0.9.7`) — this is no longer done automatically since `npm version` must not be used (see step 2):

```bash
git tag v0.9.7
git push && git push --tags
```

Or dynamically:

```bash
V=$(node -p "JSON.parse(require('fs').readFileSync('./package.json','utf8')).version")
git tag v$V && git push && git push --tags
```

---

## Checklist Before Publishing

- [ ] All tests pass (`npm test`)
- [ ] `VERSION` bumped in `src/sluz.js` (`package.json` follows via `npm run build`; verified with `npm run version:sync --check`)
- [ ] `README.md` is up to date with any API changes
- [ ] `npm pack --dry-run` shows only intended files (`src/`)
- [ ] git tag `vX.Y.Z` created and matches the new version (`git tag v$V && git push --tags`)
