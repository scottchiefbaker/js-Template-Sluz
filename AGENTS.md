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

No lint, typecheck, or formatter configured. No CI workflows. A `Makefile` mirrors these targets (`make`, `make test`, `make clean`).

## Structure

- **Entry:** `src/sluz.js` — exports `Sluz` (default) and `SluzError` (named). Engine is entirely in this one file (896 lines)
- **Global/browser build:** `src/sluz.global.js` is a 2-line wrapper (`window.Sluz = Sluz`) bundled into `sluz.global.min.js`. Do NOT add logic there — it only exists for the IIFE/global build target.
- **Tests:** `test/index.test.js` — Vitest, uses `sluzTest(input, expected, name)` helper. `expected` can be a string (`toBe`) or `/regex/` (`toMatch`)
- **Build artifacts:** `src/sluz.min.js` and `src/sluz.global.min.js` are gitignored; rebuild after changes with `npm run build`
- **`"files": ["src"]`** — only `src/` is published to npm

## Conventions

- ESM only — all imports use `.js` extensions
- `test.skip()` commented out (no JS equivalent for PHP-syntax tests)
- Template errors throw `SluzError` with numeric `code` property
- `assign()` accepts key/value pairs or a single object batch-assign
- Custom modifiers registered via `registerModifier(name, fn)` — first arg is the value, subsequent args from `:` params
- Alternate delimiters via `set_delimiters(left, right)` — both must be single, distinct chars; cache rebuilds automatically
- `$__FOREACH_FIRST`, `$__FOREACH_LAST`, `$__FOREACH_INDEX` are reserved loop variables
- `default:` modifier checks `_isNothing()` (undefined/null/empty string, but not `0` or objects)

## Known pitfall

The `_ifRulesFromTokens` path (used when else/elseif is present) must `_ltrimOne(payload, '\n')` each payload to avoid an extra blank line before branch content. The simple-if path already does this. If `{if}`/`{else}` tags are on their own lines and output has a spurious blank line, this is the cause.
