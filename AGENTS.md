# template-sluz

Single-package ESM templating engine (Smarty-like syntax). Zero dependencies. Node >= 22.

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
- Source is ESM only — all imports use `.js` extensions. No CommonJS build exists; the global IIFE build is generated from the same source by esbuild
- Template errors throw `SluzError` with numeric `code` property
- `registerModifier` refuses to override built-in `escape`/`noescape` (throws `SluzError` code 47204)
- `default:` is NOT a registered modifier — it's special-cased while building the per-tag modifier plan (`_buildModPlan()`), and checks `_isNothing()` (undefined/null/empty string, but not `0` or objects). Chained modifiers after it receive the default/resolved value, so `{$missing|default:'hi'|upper}` → `HI`. The fallback must be a quoted string or numeric literal (error 31558 otherwise)
- `assign()` accepts key/value pairs or a single object batch-assign
- Auto-escape of all `{$var}` output is toggled via `setAutoEscape(bool)` (default off); `{$var|escape}`/`{$var|noescape}` opt out of / into double-escaping as expected
- Custom modifiers registered via `registerModifier(name, fn)` — first arg is the value, subsequent args from `:` params. Unquoted non-numeric params and bare JS globals (`undefined`, `Math`, `NaN`, …) throw 31558
- Alternate delimiters via `set_delimiters(left, right)` — both must be single, distinct chars; cache rebuilds automatically
- `$__FOREACH_FIRST`, `$__FOREACH_LAST`, `$__FOREACH_INDEX` are reserved loop variables

## Known pitfall

The `_ifRulesFromTokens` path (used when else/elseif is present) must `_ltrimOne(payload, '\n')` each payload to avoid an extra blank line before branch content. The simple-if path already does this. If `{if}`/`{else}` tags are on their own lines and output has a spurious blank line, this is the cause.

## Render caches

Rendering is cache-driven; every cache must be invalidated when the state it bakes in changes:

| Cache | Keyed by | Holds | Invalidated by |
|-------|----------|-------|----------------|
| `_blockCache` | template / payload text | raw `[text, pos]` blocks from `_getBlocks` | `set_delimiters()` |
| `_payloadCache` | full template text | closure over tagged blocks for `parse()` | `set_delimiters()`, `registerModifier()` |
| `_ifRuleCache` | `{if}...{/if}` block text | `[cond, taggedBlocks\|null, payload]` rules | `set_delimiters()`, `registerModifier()` |
| `_modPlanCache` | var inner (`name\|upper`) | parsed modifier chain + bound `fn` refs | `set_delimiters()`, `registerModifier()` |
| `_exprCache`/`_fnCache` | expression source / converted code | compiled `Function` plans | `registerModifier()` |
| `_pathCache` | dotted path | `split('.')` parts | never (path shape is static) |

Two invariants worth preserving when touching the render loop:

- **Errors stay lazy.** Tagged blocks only record a *kind*; modifier/expression plans are built on first *render*, so a malformed branch that is never taken still doesn't throw. `_parseIfRules()` therefore stores payload text and tags the winning branch lazily.
- **Malformed tags fall through.** `_kindOfBlock()` returns `0` for anything that doesn't end with the right delimiter or has whitespace next to it, so `_processBlockFull()` runs and raises the legacy codes (45821 / 50981).

