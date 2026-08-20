# template-sluz

Single-package ESM templating engine (Smarty-like syntax). Zero dependencies. Node >= 18.

## Commands

| Command | Action |
|---------|--------|
| `npm test` | Run all tests (vitest, no config — runs on defaults) |
| `npm run test:watch` | Watch mode |
| `npm run build` | Minify ESM + global via esbuild |
| `npm run build:esm` | Minify ESM only (`src/sluz.min.js`) |
| `npm run build:global` | Minify global only (`src/sluz.global.min.js`) |
| `npx vitest run -t "test name"` | Run a single test by its `sluzTest` name |
| `npm run version:sync` | Sync `package.json` version from `src/sluz.js` `VERSION` (`--check` = exit 1 on mismatch, for CI) |

No lint, typecheck, or formatter configured. No CI workflows. A `Makefile` mirrors these targets (`make`, `make test`, `make clean`).

## Performance regression checks

Run `node detail-benchmark.js` to benchmark template types (variables, modifiers, if/elseif, foreach, comments, literal, mixed) over 15 000 iterations and print Millis + Iter/s per template plus a TOTAL. To compare against your change, capture the baseline output before editing and re-run after:

- `node detail-benchmark.js > /tmp/bench-before.txt`
- `node detail-benchmark.js > /tmp/bench-after.txt`
- `diff` / review the Millis and Iter/s columns

Flags: `-n 100000` / `--iterations <n>` (or a bare number) sets the iteration count; `-f <regex>` / `--filter <regex>` limits runs to templates whose name/desc matches. Timing uses `Date.now()`, so run both sides with the same iteration count and expect some noise; prefer larger `-n` for stable comparisons.

## Structure

- **Entry:** `src/sluz.js` — exports `Sluz` (default) and `SluzError` (named). The whole engine lives in this one file
- **Global/browser build:** `src/sluz.global.js` is a 2-line wrapper (`window.Sluz = Sluz`) bundled into `sluz.global.min.js`. Do NOT add logic there — it only exists for the IIFE/global build target.
- **Tests:** `test/index.test.js` — Vitest, uses `sluzTest(input, expected, name)` helper. `expected` can be a string (`toBe`) or `/regex/` (`toMatch`)
- **Build artifacts:** `src/sluz.min.js` and `src/sluz.global.min.js` are gitignored; rebuild after changes with `npm run build`
- **`"files": ["src"]`** — only `src/` is published to npm

## Conventions

- Version source of truth is `export const VERSION` in `src/sluz.js`. The `prebuild`/`prepublishOnly` npm hooks run `scripts/sync-version.js` to write it into `package.json` automatically — bump the version in `src/sluz.js`, never directly in `package.json` (do not use `npm version`; it would drift out of sync)
- ESM only — all imports use `.js` extensions
- Template errors throw `SluzError` with numeric `code` property
- `registerModifier` refuses to override built-in `escape`/`noescape` (throws `SluzError` code 47204)
- `default:` is NOT a registered modifier — it's special-cased inside `_variableBlock()`, and checks `_isNothing()` (undefined/null/empty string, but not `0` or objects). Chained modifiers after it receive the default/resolved value, so `{$missing|default:'hi'|upper}` → `HI`
- `assign()` accepts key/value pairs or a single object batch-assign
- Auto-escape of all `{$var}` output is toggled via `setAutoEscape(bool)` (default off); `{$var|escape}`/`{$var|noescape}` opt out of / into double-escaping as expected
- Custom modifiers registered via `registerModifier(name, fn)` — first arg is the value, subsequent args from `:` params
- Alternate delimiters via `set_delimiters(left, right)` — both must be single, distinct chars; cache rebuilds automatically
- `$__FOREACH_FIRST`, `$__FOREACH_LAST`, `$__FOREACH_INDEX` are reserved loop variables

## Known pitfall

The `_ifRulesFromTokens` path (used when else/elseif is present) must `_ltrimOne(payload, '\n')` each payload to avoid an extra blank line before branch content. The simple-if path already does this. If `{if}`/`{else}` tags are on their own lines and output has a spurious blank line, this is the cause.
