# template-sluz

Single-package ESM templating engine (Smarty-like syntax). Zero dependencies. Node >= 18.

## Commands

| Command | Action |
|---------|--------|
| `npm test` | Run all tests (vitest) |
| `npm run test:watch` | Watch mode |

No lint, typecheck, or formatter configured.

## Structure

- **Entry:** `src/sluz.js` — exports `Sluz` (default) and `SluzError` (named)
- **Tests:** `test/index.test.js` — Vitest, uses a `sluzTest(input, expected, name)` helper that also accepts `/regex/` strings for fuzzy matching
- **Single source file** — engine is entirely in `src/sluz.js` (~666 lines)
- **`"files": ["src"]`** — `test/` and `example.js` are excluded from npm publish

## Conventions

- ESM only — all imports use `.js` extensions (e.g. `import Sluz from '../src/sluz.js'`)
- `test.skip()` used for PHP-syntax tests that have no JS equivalent
- Template errors throw `SluzError` with numeric `code` property (e.g. `45821` for unclosed tags)
- `assign()` accepts key/value pairs or a single object batch-assign
- Custom modifiers registered via `registerModifier(name, fn)` — first arg is the value, subsequent args come from template `:` params
- Alternate delimiters via `set_delimiters(left, right)` — both must be single, distinct chars; cache rebuilds automatically
- `$__FOREACH_FIRST`, `$__FOREACH_LAST`, `$__FOREACH_INDEX` are reserved loop variables
- `default:` modifier checks `_isNothing()` (undefined/null/empty string, but not `0` or objects)
