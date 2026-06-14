# Release Notes & NPM Publishing Guide

## Publishing a New Version to NPM

### 1. Run tests

```bash
npm test
```

All tests must pass before publishing.

### 2. Bump the version

Edit `version` in `package.json` following [SemVer](https://semver.org/):

- **Patch** (`0.9.3` → `0.9.4`): bug fixes
- **Minor** (`0.9.3` → `0.10.0`): new features, backwards-compatible
- **Major** (`0.9.3` → `1.0.0`): breaking changes

Or use npm:

```bash
npm version patch   # 0.9.3 → 0.9.4
npm version minor   # 0.9.3 → 0.10.0
npm version major   # 0.9.3 → 1.0.0
```

`npm version` also creates a git tag automatically.

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
- [ ] `package.json` version is updated
- [ ] `README.md` is up to date with any API changes
- [ ] `npm pack --dry-run` shows only intended files (`src/`)
- [ ] git tag matches the new version

---

## Release History

| Version | Date        | Notes    |
|---------|-------------|----------|
| 0.9.3   | 2026-06-14  | Current  |
