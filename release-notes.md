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

Then rebuild:

```bash
npm run build
```

The build runs `scripts/sync-version.js` (via the `prebuild` hook), which
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

### 5. Push git tags

```bash
git push && git push --tags
```

---

## Checklist Before Publishing

- [ ] All tests pass (`npm test`)
- [ ] `VERSION` bumped in `src/sluz.js` (`package.json` follows via `npm run build`)
- [ ] `README.md` is up to date with any API changes
- [ ] `npm pack --dry-run` shows only intended files (`src/`)
- [ ] git tag matches the new version
