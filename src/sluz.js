// Template engine error with a numeric error code
class SluzError extends Error {
  constructor(msg, code) {
    super(`Template::Sluz error #${code}: ${msg}`);
    this.code = code;
  }
}

const ESCAPE_RE = {
  '\\': '\\\\', '.': '\\.', '*': '\\*', '+': '\\+', '?': '\\?',
  '(': '\\(', ')': '\\)', '[': '\\[', ']': '\\]', '{': '\\{', '}': '\\}',
  '|': '\\|', '^': '\\^', '$': '\\$',
};

const CACHE_LIMIT = 512;
const BLOCK_CACHE_MAX_CHARS = 1024 * 1024;
const BLOCK_CACHE_MAX_ENTRY = 64 * 1024;

// PHP is_numeric()-style numeric literal (used for default: validation)
const NUMERIC_LITERAL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

// Escape regex-special characters so the string can be used as a literal pattern
function escapeRegex(s) {
  return s.replace(/[\\.*+?()\[\]{}|^$]/g, ch => ESCAPE_RE[ch]);
}

////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

// HTML-encode the five characters that have special meaning in HTML: & < > " '
function _escapeHtml(v) {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return 'ARRAY';
  if (v && typeof v === 'object') return 'HASH';
  const s = String(v);
  // Single-regex fast path: only scan when a special char is present.
  // Benchmark vars are plain text, so this avoids 5 replace passes.
  if (!/[&<>"']/.test(s)) return s;
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Fast char-class helpers (charCodeAt path avoids RegExp on hot paths)
function isWsChar(c) {
  const code = c.charCodeAt(0);
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || code === 11;
}

function isWordChar(code) {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) || code === 95;
}

function isDigitChar(code) {
  return code >= 48 && code <= 57;
}

// True when `inner` (content between delimiters) is a simple $var with
// optional |modifiers, i.e. matches ^\$\w[\w.]*(\|.*)?$ without RegExp.
function isSimpleVarInner(inner) {
  if (inner.charCodeAt(0) !== 36) return false; // '$'
  const n = inner.length;
  if (n < 2) return false;
  if (!isWordChar(inner.charCodeAt(1))) return false;
  let i = 2;
  while (i < n) {
    const code = inner.charCodeAt(i);
    if (isWordChar(code) || code === 46) { // word char or '.'
      i++;
      continue;
    }
    return code === 124; // '|' -> modifier chain, matches pipe variant
  }
  return true;
}

// Manual equivalents of the hot-path RegExps (avoid RegExp engine overhead).
function isNumericLiteralMicro(s) {
  // ^-?\d+(?:\.\d+)?$
  let i = 0;
  const n = s.length;
  if (n === 0) return false;
  if (s.charCodeAt(0) === 45) { // '-'
    i = 1;
    if (i >= n) return false;
  }
  let intDigits = 0;
  while (i < n && isDigitChar(s.charCodeAt(i))) { i++; intDigits++; }
  if (intDigits === 0) return false;
  if (i === n) return true;
  if (s.charCodeAt(i) !== 46) return false; // '.'
  i++;
  let fracDigits = 0;
  while (i < n && isDigitChar(s.charCodeAt(i))) { i++; fracDigits++; }
  return fracDigits > 0 && i === n;
}

function isWordRune(s) {
  if (!s.length) return false;
  for (let i = 0; i < s.length; i++) {
    if (!isWordChar(s.charCodeAt(i))) return false;
  }
  return true;
}

// ^[A-Za-z_][A-Za-z0-9_]*$ (bare-identifier param check)
function isBareIdentifier(s) {
  const n = s.length;
  if (n === 0) return false;
  const c0 = s.charCodeAt(0);
  const okFirst = (c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95;
  if (!okFirst) return false;
  for (let i = 1; i < n; i++) {
    if (!isWordChar(s.charCodeAt(i))) return false;
  }
  return true;
}

// True when s is all ASCII digits (non-empty): ^\d+$
function isAllDigits(s) {
  if (!s.length) return false;
  for (let i = 0; i < s.length; i++) {
    if (!isDigitChar(s.charCodeAt(i))) return false;
  }
  return true;
}

// Run-time version — the single source of truth. package.json "version" is
// synced from this export by scripts/sync-version.js on build/publish.
export const VERSION = '0.9.9';

export default class Sluz {
  static version = VERSION;

  // Instance-level mirror of the static version, so `new Sluz().version` works.
  // A prototype getter keeps it out of each instance's own (enumerable) state
  // and makes it read-only.
  get version() { return VERSION; }

  // Create a new Sluz template engine instance
  constructor() {
    this.tplVars = {};
    this.varPrefix = 'sluz_pfx';
    this.modifiers = new Map();
    this.charPos = -1;
    this._sourceStr = '';
    this.auto_escape = false;
    this.left_delim = '{';
    this.right_delim = '}';

    this._registerBuiltins();
    // Persistent eval scope (__S_<var>) and compiled-expression cache. These
    // avoid rebuilding a scope object and recompiling Function() on every
    // _peval() call — a huge win for {if}/{foreach} which fire per iteration.
    // __S is kept in sync incrementally by assign() and _foreachBlock so the
    // per-iteration cost is just the loop-local variable writes.
    this.__S = {};
    this._fnCache = new Map();
    this._fnCacheOld = new Map();
    this._exprCache = new Map();
    this._exprCacheOld = new Map();
    this._pathCache = new Map();
    this._blockCache = new Map();
    this._payloadCache = new Map();
    this._ifRuleCache = new Map();
    this._modPlanCache = new Map();
    this._blockCacheChars = 0;
    this._fnNames = [...this.modifiers.keys()];
    this._fnRefs = this._fnNames.map(n => this.modifiers.get(n));
    this._buildCache();
  }

  // Register built-in modifier functions (count, ucfirst, upper, lower, etc.)
  _registerBuiltins() {
    this.modifiers.set('count', v => {
      if (Array.isArray(v)) return v.length;
      if (v && typeof v === 'object') return Object.keys(v).length;
      return v != null ? 1 : 0;
    });
    this.modifiers.set('ucfirst', s => {
      s = String(s);
      return s.charAt(0).toUpperCase() + s.slice(1);
    });
    this.modifiers.set('upper', s => String(s).toUpperCase());
    this.modifiers.set('lower', s => String(s).toLowerCase());
    this.modifiers.set('substr', (s, start, len) => {
      s = String(s);
      start = Number(start);
      return len !== undefined ? s.slice(start, start + Number(len)) : s.slice(start);
    });
    this.modifiers.set('trim', s => String(s).trim());
    this.modifiers.set('replace', (s, search, replacement) => String(s).replaceAll(search, replacement));
    this.modifiers.set('length', s => String(s).length);
    this.modifiers.set('join', (arr, sep = ',') => Array.prototype.join.call(arr, sep));
    this.modifiers.set('first', arr => Array.isArray(arr) ? arr[0] : String(arr)[0]);
    this.modifiers.set('last', arr => Array.isArray(arr) ? arr[arr.length - 1] : String(arr).slice(-1));
    this.modifiers.set('escape', _escapeHtml);
    this.modifiers.set('noescape', v => v);
  }

  // Build cached tag strings and regex patterns from current delimiter state
  _buildCache() {
    const L = this.left_delim;
    const R = this.right_delim;
    const eL = escapeRegex(L);
    const eR = escapeRegex(R);
    this._blockCache.clear();
    this._payloadCache.clear();
    this._ifRuleCache.clear();
    this._modPlanCache.clear();
    this._blockCacheChars = 0;

    this._close_if = L + '/if' + R;
    this._close_foreach = L + '/foreach' + R;
    this._else_tag = L + 'else' + R;
    this._elseif_tag = L + 'elseif ';
    this._comment_open = L + '*';
    this._comment_close = '*' + R;
    // Tag-open prefixes for the per-tag dispatch fast path
    this._varOpen = L + '$';
    this._ifOpen = L + 'if ';
    this._foreachOpen = L + 'foreach ';
    this._elseOpen = L + 'else';
    this._literalOpen = L + 'literal';

    // Variable pattern mirrors the PHP engine: \$\w[\w.]* with an optional
    // |anything for modifiers. Anything else (math, quotes, spaces) falls
    // through to the expression handler, e.g. {$x - 3} or {$first . " "}.
    this._varReWithPipe = new RegExp(`^${eL}\\$(\\w[\\w.]*\\|.*)${eR}$`);
    this._varReSimple = new RegExp(`^${eL}\\$(\\w[\\w.]*)${eR}$`);
    this._foreachRe = new RegExp(`^${eL}foreach (\\$\\w[\\w.]*) as \\$(\\w+)(?: => \\$(\\w+))?${eR}([\\s\\S]*)${eL}\\/foreach${eR}$`);
    this._literalRe = new RegExp(`^${eL}literal${eR}([\\s\\S]*)${eL}\\/literal${eR}$`);
    this._catchAllRe = new RegExp(`^${eL}(.+)${eR}$`, 's');
    this._tokenSplitRe = new RegExp(`(${eL}[^${eR}]+${eR})`);
    this._openTagRe = new RegExp(`^${eL}(if|foreach|literal)\\b`);
    this._closeTagRe = new RegExp(`${eL}\\/(\\w+)${eR}`);
    this._ifStartRe = new RegExp(`^${eL}if\\b`);
    this._forStartRe = new RegExp(`^${eL}for`);
    this._whitespaceRe = new RegExp(`^\\s[${eL}${eR}]\\s$`);
    this._subTagRe = new RegExp(`${eL}(\\/|\\$|if|foreach|else|literal)`);
    this._catchAllRe2 = new RegExp(`^${eL}(.+)${eR}$`, 's');
    this._tokenIfRe = new RegExp(`^${eL}(?:if|elseif)\\s+(.+?)${eR}$`);
    this._ifSimpleRe = new RegExp(`${eL}if (.+?)${eR}([\\s\\S]*)${eL}\\/if${eR}`, 's');
    this._ifStartReGlobal = new RegExp(`^${eL}if\\b`);
    // A control block whose closing tag sits on its own line ends with a
    // newline followed by the close tag — that newline is structural, so the
    // newline after the block is swallowed to keep input -> output parity.
    this._newlineEndRe = new RegExp(`\\n${eL}\\/\\w+${eR}$`);
    // An {if} with no payload at all, e.g. {if $x}{/if} or {if $x}{else}{/if}.
    // The tags are adjacent so there is no payload, but the closing tag still
    // sits on a line of its own, so the newline after it is swallowed too.
    this._emptyIfRe = new RegExp(`^${eL}if [^${eR}]*${eR}(?:${eL}else${eR}|${eL}elseif [^${eR}]*${eR})*${eL}\\/if${eR}$`);
  }

  // Assign one or more template variables — key/value pair, multiple pairs, or batch object
  assign(first, second) {
    const pfx = this.varPrefix + '_';
    // Batch-assign: pass a single object to assign all its keys at once
    if (arguments.length === 1 && typeof first === 'object' && !Array.isArray(first) && first !== null) {
      for (const [k, v] of Object.entries(first)) {
        this.tplVars[k] = v;
        this.__S[pfx + k] = v;
      }
    // Key-value pair: assign('name', 'value')
    } else if (arguments.length % 2 === 0) {
      for (let i = 0; i < arguments.length; i += 2) {
        const k = arguments[i];
        this.tplVars[k] = arguments[i + 1];
        this.__S[pfx + k] = arguments[i + 1];
      }
    }
  }

  // Register a custom modifier function for use with the | pipe syntax
  registerModifier(name, fn) {
    if (name === 'escape' || name === 'noescape') {
      const [line, col] = this._getCharLocation(this.charPos);
      throw new SluzError(`Cannot override built-in modifier <code>${name}</code> on line #${line}`, 47204);
    }
    this.modifiers.set(name, fn);
    // Invalidate compiled-expression cache and refresh the modifier name/ref
    // arrays so _peval() passes the new (or reordered) function correctly.
    this._fnCache.clear();
    this._fnCacheOld.clear();
    this._exprCache.clear();
    this._exprCacheOld.clear();
    // Cached tagged blocks embed modifier function references, so they must be
    // rebuilt when a modifier is (re)registered.
    this._modPlanCache.clear();
    this._payloadCache.clear();
    this._ifRuleCache.clear();
    this._fnNames = [...this.modifiers.keys()];
    this._fnRefs = this._fnNames.map(n => this.modifiers.get(n));
  }

  // Set alternate tag delimiters. Both must be single, distinct characters.
  set_delimiters(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string') {
      throw new SluzError('Delimiters must be strings', 51234);
    }
    if (left.length !== 1 || right.length !== 1) {
      throw new SluzError('Delimiters must be single characters', 51235);
    }
    if (left === right) {
      throw new SluzError('Left and right delimiters must be different', 51236);
    }
    this.left_delim = left;
    this.right_delim = right;
    this._buildCache();
  }

  // Enable or disable automatic HTML escaping of all {$var} output
  setAutoEscape(flag) {
    this.auto_escape = !!flag;
  }

  // Internal escape gate: delegates to _escapeHtml when auto_escape is on
  _esc(v) {
    if (!this.auto_escape) return v;
    return _escapeHtml(v);
  }

  // Parse a template string — tokenize into blocks then process each in sequence.
  // Cache: the compiled closure for a template string is memoized so parse()
  // on a hot template is a Map lookup + call, with no re-tokenization or
  // re-validation. _blockCache is kept as the raw blocks store (used by
  // _getBlocks for payload sub-parsing); compiled entries live alongside.
  parse(str) {
    this._sourceStr = str;
    if (str.length <= BLOCK_CACHE_MAX_ENTRY) {
      const entry = this._payloadCache.get(str);
      if (entry !== undefined) return entry.fn(this);
    }
    const blocks = this._getBlocks(str);
    const tagged = this._makeTagged(blocks);
    // Cache miss: build a closure and store it (if size allows).
    if (str.length <= BLOCK_CACHE_MAX_ENTRY) {
      if (this._payloadCache.size >= CACHE_LIMIT) this._payloadCache.clear();
      this._payloadCache.set(str, { fn: (inst) => inst._processBlocksTagged(tagged) });
    }
    return this._processBlocksTagged(tagged);
  }

  // Attach kind (and, for variables, the inner text) to each tag block.
  // Done once per template via the parse/if/foreach caches, so the render loop
  // never slices a tag. The modifier plan itself is built lazily on first
  // render of that block, preserving laziness of unselected branches.
  _makeTagged(blocks) {
    const tagged = new Array(blocks.length);
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const str = b[0];
      if (str && str[0] === this.left_delim) {
        const kind = this._kindOfBlock(str);
        if (kind === 1) {
          tagged[i] = [str, b[1], 1,
            str.slice(this.left_delim.length, str.length - this.right_delim.length)];
        } else {
          tagged[i] = [str, b[1], kind];
        }
      } else {
        tagged[i] = b;
      }
    }
    return tagged;
  }

  // -------------------------------------------------------------------
  // Tokenizer
  // -------------------------------------------------------------------

  // Split a template string into [text, endIndex] blocks, handling nested if/foreach/literal
  _getBlocks(str) {
    const cached = this._blockCache.get(str);
    if (cached !== undefined) return cached;

    const L = this.left_delim;
    const R = this.right_delim;
    const slen = str.length;
    let start = 0;
    let i;
    const blocks = [];

    // Fast-forward to the first left delimiter so we don't scan plain text char-by-char
    let z = str.indexOf(L);
    if (z < 0) z = slen;

    let prevWasComment = false;

    for (i = z; i < slen; i++) {
      const char = str[i];
      let isOpen = char === L;
      const isClosed = char === R;

      // Skip plain-text runs in one jump instead of character-by-character
      if (!isOpen && !isClosed) {
        const nextOpen = str.indexOf(L, i);
        const nextClose = str.indexOf(R, i);
        const nOpen = nextOpen < 0 ? slen : nextOpen;
        const nClose = nextClose < 0 ? slen : nextClose;
        i = (nOpen < nClose ? nOpen : nClose) - 1;
        continue;
      }

      const hasLen = start !== i;
      let isComment = false;

      // Disambiguate left delimiter used in template tags from literal delimiter surrounded by whitespace
      if (isOpen) {
        const prevC = i > 0 ? str[i - 1] : ' ';
        const nextC = i + 1 < slen ? str[i + 1] : ' ';
        const chk = prevC + char + nextC;
        if (this._whitespaceRe.test(chk)) isOpen = false;
        if (nextC === '*') isComment = true;
      }

      // Push the text before this opening tag as a literal block
      if (isOpen && hasLen) {
        let text = str.slice(start, i);
        if (prevWasComment) {
          text = this._ltrimOne(text, '\n');
          prevWasComment = false;
        }
        blocks.push([text, i]);
        start = i;
      } else if (isClosed) {
        prevWasComment = false;
        // Find the full tag (or block) from start to the matching right delimiter
        const len = i - start + 1;
        let block = str.slice(start, start + len);
        const openTagMatch = block.match(this._openTagRe);
        // For block tags (if/foreach/literal), scan for the matching close tag
        let scanned = block.length;
        let foundClose = false;
        if (openTagMatch) {
          const ot = openTagMatch[1];
          const openTag = L + ot;
          const closeTag = L + '/' + ot + R;
          let end = this._findBlockEnd(str, start, openTag, closeTag);
          // A literal payload may itself contain {literal} without a matching
          // nested close. Fall back to the first {/literal} as the outer close
          // (mirrors sluz.class.php first_literal_close handling).
          if (end < 0 && ot === 'literal') {
            const firstClose = str.indexOf(closeTag, start + openTag.length);
            if (firstClose >= 0) end = firstClose + closeTag.length - 1;
          }
          if (end >= 0) {
            block = str.slice(start, end + 1);
            scanned = block.length;
            foundClose = true;
          }
          // Mismatched/unclosed block tag: throw 45821 only when the open tag
          // is otherwise well-formed (a valid condition/literal). Malformed
          // opens like `{if debug}` fall through and are rejected later (73467).
          const wellFormed = ot === 'literal' || /["\d\$\(]/.test(block);
          if (!foundClose && wellFormed) {
            const [line, col] = this._getCharLocation(start);
            throw new SluzError(`Unclosed tag <code>${block}</code> on line #${line}`, 45821);
          }

          // When {literal}/{/literal} each sit alone on their own line, strip
          // the single \n that belongs to those tag lines from the content,
          // mirroring the comment-line handling. (Inline tags keep their \n.)
          if (ot === 'literal') {
            const ltag = L + 'literal' + R;
            const rtag = L + '/literal' + R;
            const beginsLine = start === 0 || str[start - 1] === '\n';
            const afterPos = start + scanned;
            const endsLine = afterPos >= slen || str[afterPos] === '\n';
            // Peek at the boundary chars first; only slice/rebuild when a trim
            // will actually happen, so the common case stays allocation-free.
            const trimFirst = beginsLine && block[ltag.length] === '\n';
            const trimLast = endsLine && block[block.length - rtag.length - 1] === '\n';
            if (trimFirst || trimLast) {
              let inner = block.slice(ltag.length, block.length - rtag.length);
              if (trimFirst) inner = inner.slice(1);
              if (trimLast) inner = inner.slice(0, -1);
              block = ltag + inner + rtag;
            }
          }
        }

        if (block.length) blocks.push([block, i]);
        start += scanned;
        i = start - 1;
      }

      // Handle {* comment *} — swallow everything up to the closing *}
      if (isComment) {
        const end = this._findEndingTag(str.slice(start), this._comment_open, this._comment_close);
        if (end < 0) {
          const [line, col] = this._getCharLocation(i);
          throw new SluzError(`Missing closing <code>${escapeRegex(this._comment_close)}</code> for comment on line #${line}`, 48724);
        }
        start += end + this._comment_close.length;
        i = start - 1;
        prevWasComment = true;
      }
    }

    // Push any remaining text after the last tag as a literal block
    if (start < slen) {
      let text = str.slice(start);
      if (prevWasComment) {
        text = this._ltrimOne(text, '\n');
      }
      blocks.push([text, i]);
    }

    // If the *previous* block was an {if} or {foreach} we remove one leading
    // \n from the current block to maintain parity between input and output
    // whitespace. A control block only counts when its closing tag sits on
    // its own line (so the block already ends with a newline of its own) or
    // when it has no payload at all. Inline blocks keep the newline that
    // follows them because it is content, not formatting.
    let prevIsIf = false;
    for (let bi = 0; bi < blocks.length; bi++) {
      const bstr = blocks[bi][0];
      let curIsIf = this._ifStartRe.test(bstr) || this._forStartRe.test(bstr);
      if (curIsIf && (bstr.includes(this._close_if) || bstr.includes(this._close_foreach))) {
        curIsIf = this._newlineEndRe.test(bstr);
        if (!curIsIf && this._ifStartRe.test(bstr)) {
          curIsIf = this._emptyIfRe.test(bstr);
        }
      }
      if (prevIsIf) {
        blocks[bi][0] = this._ltrimOne(bstr, '\n');
      }
      prevIsIf = curIsIf;
    }

    if (str.length <= BLOCK_CACHE_MAX_ENTRY) {
      if (this._blockCache.size >= CACHE_LIMIT || this._blockCacheChars + str.length > BLOCK_CACHE_MAX_CHARS) {
        this._blockCache.clear();
        this._blockCacheChars = 0;
      }
      this._blockCache.set(str, blocks);
      this._blockCacheChars += str.length;
    }
    return blocks;
  }

  _findBlockEnd(str, start, openTag, closeTag) {
    let depth = 1;
    let from = start + openTag.length;

    while (from <= str.length) {
      const closePos = str.indexOf(closeTag, from);
      if (closePos < 0) return -1;

      let openPos = str.indexOf(openTag, from);
      while (openPos >= 0 && openPos < closePos) {
        const next = str[openPos + openTag.length];
        if (next === undefined || !/[A-Za-z0-9_]/.test(next)) break;
        openPos = str.indexOf(openTag, openPos + 1);
      }

      if (openPos >= 0 && openPos < closePos) {
        depth++;
        from = openPos + openTag.length;
        continue;
      }

      depth--;
      if (depth === 0) return closePos + closeTag.length - 1;
      from = closePos + closeTag.length;
    }

    return -1;
  }

  // Classify a tag block for the render loop:
  // 1 = variable, 2 = if, 3 = foreach, 4 = literal, 5 = comment, 0 = other.
  // Anything with an unexpected shape returns 0 so the full validator path
  // runs and produces the original error codes (45821 / 50981 / 73467).
  _kindOfBlock(str) {
    const L = this.left_delim;
    const R = this.right_delim;
    if (str[0] !== L) return 0;
    // Unterminated tag or whitespace adjacent to the closing delimiter must
    // take the full path so the legacy error codes (45821 / 50981) fire.
    if (!str.endsWith(R)) return 0;
    const first = str[L.length];
    if (first === '$') {
      const inner = str.slice(L.length, str.length - R.length);
      if (isWsChar(inner[inner.length - 1])) return 0;
      return isSimpleVarInner(inner) ? 1 : 0;
    }
    if (first === '/') return 0;
    if (first === '*') return 5; // {* comment *}
    if (str.startsWith(this._ifOpen) && str.endsWith(this._close_if)) return 2;
    if (str.startsWith(this._foreachOpen)) return 3;
    if (str.startsWith(this._literalOpen)) return 4;
    return 0;
  }

  _processBlocksTagged(blocks) {
    const autoEscape = this.auto_escape;
    let html = '';
    for (const x of blocks) {
      const block = x[0];
      if (!block.length) continue;
      const kind = x[2];
      if (kind === 1) {
        this.charPos = x[1];
        let plan = x[4];
        if (plan === undefined) plan = x[4] = this._getModPlan(x[3]);
        html += this._renderPlan(plan, autoEscape);
      } else if (kind === 2) {
        this.charPos = x[1];
        html += this._ifBlock(block);
      } else if (kind === 3) {
        this.charPos = x[1];
        const m = block.match(this._foreachRe);
        if (m) html += this._foreachBlock(m[1], m[2], m[3], m[4]);
        else html += this._processBlockFull(block);
      } else if (kind === 4) {
        this.charPos = x[1];
        const m = block.match(this._literalRe);
        if (m) html += m[1];
        else html += this._processBlockFull(block);
      } else if (kind === 5) {
        // {* comment *} — dropped by _getBlocks on full templates, but payload
        // sub-strings re-tokenized per render can still contain them.
        this.charPos = x[1];
        html += '';
      } else if (kind === 0 && block[0] === this.left_delim) {
        this.charPos = x[1];
        html += this._processBlockFull(block);
      } else if (kind === undefined && block[0] === this.left_delim) {
        // Untagged payload block (from _getBlocks on if/foreach payload).
        this.charPos = x[1];
        html += this._processBlockFull(block);
      } else {
        html += block;
      }
    }
    return html;
  }

  // Full _processBlock logic (renamed — old name kept via wrapper for compat).
  // Used for untagged blocks (expressions, close tags, literal text, etc.).
  _processBlockFull(str) {
    const L = this.left_delim;
    const R = this.right_delim;

    // {* comment *} — nothing to render
    if (str.startsWith(this._comment_open)) { return ''; }

    const first = str[L.length];
    const isGenTag = first === '$'
      || first === '/'
      || str.startsWith(this._ifOpen)
      || str.startsWith(this._foreachOpen)
      || str.startsWith(this._elseOpen)
      || str.startsWith(this._literalOpen);

    if (isGenTag) {
      const last = str[str.length - R.length - 1];
      if (isWsChar(first) || isWsChar(last)) {
        const [line, col] = this._getCharLocation(this.charPos);
        throw new SluzError(`Whitespace next to delimiter in tag <code>${str}</code> on line #${line}`, 50981);
      }
    } else {
      const inner = str.slice(L.length, str.length - R.length);
      if (/[{};]/.test(inner)) {
        const innerStripped = inner.replace(/'[^']*'|"[^"]*"/g, '');
        if (/[{};]/.test(innerStripped) && !this._subTagRe.test(innerStripped)) { return str; }
      }
      if (/^\s/.test(inner) || /\s$/.test(inner)) {
        const [line, col] = this._getCharLocation(this.charPos);
        throw new SluzError(`Whitespace next to delimiter in tag <code>${str}</code> on line #${line}`, 50981);
      }
    }

    if (str.startsWith(this._varOpen)) {
      const varMatch = str.includes('|')
        ? str.match(this._varReWithPipe)
        : str.match(this._varReSimple);
      if (varMatch) { return this._renderVarInner(varMatch[1], this.auto_escape); }
    }

    if (str.startsWith(this._ifOpen) && str.endsWith(this._close_if)) {
      return this._ifBlock(str);
    }

    if (str.startsWith(this._foreachOpen)) {
      const foreachMatch = str.match(this._foreachRe);
      if (foreachMatch) {
        return this._foreachBlock(foreachMatch[1], foreachMatch[2], foreachMatch[3], foreachMatch[4]);
      }
    }

    if (str.startsWith(this._literalOpen)) {
      const m = str.match(this._literalRe);
      if (m) return m[1];
    }

    const exprMatch = str.match(this._catchAllRe2);
    if (exprMatch) {
      return this._expressionBlock(str, exprMatch[1]);
    }

    if (!str.endsWith(R)) {
      const [line, col] = this._getCharLocation(this.charPos);
      throw new SluzError(`Unclosed tag <code>${str}</code> on line #${line}`, 45821);
    }

    return str;
  }

  // Back-compat: old _processBlock(str, charPos) signature.
  _processBlock(str, charPos) {
    this.charPos = charPos;
    return this._processBlockFull(str);
  }

  // -------------------------------------------------------------------
  // Block handlers
  // -------------------------------------------------------------------

  // Look up (or build and cache) the modifier plan for a var inner.
  _getModPlan(inner) {
    let plan = this._modPlanCache.get(inner);
    if (plan === undefined) {
      plan = this._buildModPlan(inner);
      if (this._modPlanCache.size >= CACHE_LIMIT) this._modPlanCache.clear();
      this._modPlanCache.set(inner, plan);
    }
    return plan;
  }

  // Render a var inner (`$name`, `$a.b`, `$name|upper`, `$x|default:"hi"`).
  // The modifier chain is parsed once per unique inner and cached, so a repeat
  // render only resolves the variable and applies the already-bound modifiers.
  _renderVarInner(inner, autoEscape) {
    return this._renderPlan(this._getModPlan(inner), autoEscape);
  }

  // Apply a pre-parsed modifier plan to the current variable scope.
  _renderPlan(plan, autoEscape) {
    // `{$x|}` — nothing after the pipe. The legacy code dove the whole inner
    // (which includes `$` and `|`) and produced ''. Preserve that.
    if (plan.emptyPipe) return '';

    let pre = this._divePath(plan.key);

    if (plan.hasDefault) {
      if (this._isNothing(pre)) {
        pre = plan.dval;
      } else {
        pre = pre ?? '';
      }
    } else if (plan.segs.length === 0) {
      return this._renderScalar(pre, autoEscape);
    } else if (pre == null) {
      pre = '';
    }

    let seenEscape = false;
    let seenNoescape = false;
    for (let s = 0; s < plan.segs.length; s++) {
      const seg = plan.segs[s];
      if (seg.isEscape) seenEscape = true;
      if (seg.isNoescape) seenNoescape = true;

      const ps = seg.params;
      let ret;
      if (ps.length === 0) {
        try { ret = seg.fn(pre); } catch (e) {
          if (e instanceof SluzError) throw e;
          const [line] = this._getCharLocation(this.charPos);
          throw new SluzError(`Exception in modifier <code>${seg.name}</code> on line #${line}`, 79134);
        }
      } else {
        const args = new Array(ps.length + 1);
        args[0] = pre;
        for (let k = 0; k < ps.length; k++) {
          const p = ps[k];
          if (p.const) {
            args[k + 1] = p.value;
          } else {
            const [v, err] = this._pevalSafe(p.src);
            if (err !== 0) {
              const [line] = this._getCharLocation(this.charPos);
              throw new SluzError(`Unquoted function parameter <code>${p.src}</code> on line #${line}`, 31558);
            }
            args[k + 1] = v;
          }
        }
        try { ret = seg.fn.apply(null, args); } catch (e) {
          if (e instanceof SluzError) throw e;
          const [line] = this._getCharLocation(this.charPos);
          throw new SluzError(`Exception in modifier <code>${seg.name}</code> on line #${line}`, 79134);
        }
      }
      pre = ret;
    }

    if (pre == null) return '';
    if (autoEscape && !seenNoescape && !seenEscape) pre = _escapeHtml(pre);
    return pre;
  }

  // Parse a var inner into a reusable plan: key, default fallback, and
  // modifier segments with their parameters pre-resolved where constant.
  // All static validation (31558 / 47204) happens here, i.e. on first render.
  _buildModPlan(inner) {
    let pipeIdx = -1;
    for (let i = 0; i < inner.length; i++) {
      if (inner.charCodeAt(i) === 124) { pipeIdx = i; break; } // '|'
    }
    if (pipeIdx === -1) {
      return { key: inner.slice(1), segs: [], hasDefault: false, emptyPipe: false };
    }

    const key = inner.slice(1, pipeIdx);
    let modStr = inner.slice(pipeIdx + 1);
    // Original semantics: an empty remainder after the pipe renders ''.
    if (modStr.length === 0) {
      return { key, segs: [], hasDefault: false, emptyPipe: true };
    }

    const plan = { key, segs: [], hasDefault: false, emptyPipe: false, dval: undefined };

    if (modStr.indexOf('default:') !== -1) {
      plan.hasDefault = true;
      // Everything before `default:` is discarded (legacy behaviour).
      const afterDefault = modStr.replace(/^.*?default:/, '');
      const dParts = this._splitRespectingQuotes(afterDefault, '|');
      const rawDefault = (dParts[0] ?? '').trim();
      const q = rawDefault[0];
      const isQuotedStr = rawDefault.length >= 2 && (q === '"' || q === "'")
        && rawDefault[rawDefault.length - 1] === q;
      const isNumeric = !isQuotedStr && NUMERIC_LITERAL_RE.test(rawDefault);
      if (!isQuotedStr && !isNumeric) {
        const [line] = this._getCharLocation(this.charPos);
        throw new SluzError(`Unquoted default value <code>${rawDefault}</code> on line #${line}`, 31558);
      }
      if (isNumeric) {
        plan.dval = Number(rawDefault);
      } else {
        const [dval, err] = this._pevalSafe(rawDefault);
        if (err !== 0) {
          const [line] = this._getCharLocation(this.charPos);
          throw new SluzError(`Invalid default value <code>${rawDefault}</code> on line #${line}`, 31558);
        }
        plan.dval = dval;
      }
      modStr = dParts.slice(1).join('|');
    }

    if (!modStr) return plan;

    for (const p of this._splitRespectingQuotes(modStr, '|')) {
      if (!p) continue;
      const colonIdx = this._findFirstColonOutsideQuotes(p);
      const name = colonIdx >= 0 ? p.slice(0, colonIdx) : p;
      const paramStr = colonIdx >= 0 ? p.slice(colonIdx + 1) : '';
      const fn = this.modifiers.get(name);
      if (!fn) {
        const [line] = this._getCharLocation(this.charPos);
        throw new SluzError(`Unknown function call <code>${name}</code> on line #${line}`, 47204);
      }
      const params = [];
      if (paramStr.length) {
        for (const limb of this._splitRespectingQuotes(paramStr, ',')) {
          const bare = limb.trim();
          if (isBareIdentifier(bare) && bare !== 'true' && bare !== 'false' && bare !== 'null') {
            const [line] = this._getCharLocation(this.charPos);
            throw new SluzError(`Unquoted function parameter <code>${limb}</code> on line #${line}`, 31558);
          }
          // Params referencing variables must be re-evaluated per render.
          if (limb.includes('$')) {
            params.push({ const: false, src: limb });
          } else {
            const [v, err] = this._pevalSafe(limb);
            if (err !== 0) {
              const [line] = this._getCharLocation(this.charPos);
              throw new SluzError(`Unquoted function parameter <code>${limb}</code> on line #${line}`, 31558);
            }
            params.push({ const: true, value: v });
          }
        }
      }
      plan.segs.push({
        name,
        fn,
        params,
        isEscape: name === 'escape',
        isNoescape: name === 'noescape',
      });
    }
    return plan;
  }

  // _peval that never throws (new Function can throw SyntaxError for params
  // like ";"), so callers can map failures to template error codes.
  _pevalSafe(str) {
    try {
      return this._peval(str);
    } catch {
      return [undefined, -1];
    }
  }

  _renderScalar(v, autoEscape) {
    if (Array.isArray(v)) return 'ARRAY';
    if (v && typeof v === 'object') return 'HASH';
    if (v != null) return autoEscape ? _escapeHtml(v) : v;
    return '';
  }

  // Dotted-path lookup without RegExp, optimal for the common 1-3 part paths.
  // Direct-key precedence (assign('a.b','direct')) is preserved.
  _divePath(path) {
    const tv = this.tplVars;
    if (Object.prototype.hasOwnProperty.call(tv, path)) return tv[path];
    let dot = -1;
    for (let i = 0; i < path.length; i++) {
      if (path.charCodeAt(i) === 46) { dot = i; break; } // '.'
    }
    if (dot === -1) return undefined;
    let parts = this._pathCache.get(path);
    if (!parts) {
      parts = path.split('.');
      if (this._pathCache.size >= CACHE_LIMIT) this._pathCache.clear();
      this._pathCache.set(path, parts);
    }
    let cur = tv[parts[0]];
    if (cur === undefined && !Object.prototype.hasOwnProperty.call(tv, parts[0])) {
      return undefined;
    }
    for (let i = 1; i < parts.length; i++) {
      if (cur == null) return undefined;
      if (Array.isArray(cur)) {
        const elem = parts[i];
        if (!isAllDigits(elem)) return undefined;
        const idx = Number(elem);
        if (idx >= cur.length) return undefined;
        cur = cur[idx];
      } else if (typeof cur === 'object') {
        if (!Object.prototype.hasOwnProperty.call(cur, parts[i])) return undefined;
        cur = cur[parts[i]];
      } else {
        return undefined;
      }
    }
    return cur;
  }

  // Evaluate {if}/{elseif}/{else} — fast regex for simple blocks, tokenized for complex.
  // Parsed rules (condition + payload) are cached per block, and the selected
  // branch's blocks are tagged lazily on first use, so an unselected malformed
  // branch stays unparsed (matching the original lazy behaviour).
  _ifBlock(str) {
    let rules = this._ifRuleCache.get(str);
    if (rules === undefined) {
      rules = this._parseIfRules(str);
      if (this._ifRuleCache.size >= CACHE_LIMIT) this._ifRuleCache.clear();
      this._ifRuleCache.set(str, rules);
    }

    let ret = '';
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      const [res] = this._peval(rule[0]);
      if (res) {
        let tagged = rule[1];
        if (tagged === null) {
          tagged = rule[1] = this._makeTagged(this._getBlocks(rule[2]));
        }
        ret += this._processBlocksTagged(tagged);
        break;
      }
    }
    return ret;
  }

  // Split an if-block into [condition, taggedBlocks|null, payload] rules.
  _parseIfRules(str) {
    // True when the block has no else or elseif, so we can use a simple regex.
    // elseifs must route through the tokenizer too, or an {elseif} without a
    // matching {else} would be mistaken for literal payload text.
    const isSimple = !str.includes(this._else_tag, this.left_delim.length)
      && !str.includes(this._elseif_tag, this.left_delim.length);
    let rules = [];

    if (isSimple) {
      const m = str.match(this._ifSimpleRe);
      if (m) {
        rules = [[m[1], this._ltrimOne(m[2], '\n')]];
      }
    } else {
      const toks = this._getTokens(str);
      rules = this._ifRulesFromTokens(toks);
    }

    const out = new Array(rules.length);
    for (let i = 0; i < rules.length; i++) {
      out[i] = [rules[i][0], null, rules[i][1]];
    }
    return out;
  }

  // Process {foreach $arr as $k => $v}...{/foreach} with __FOREACH_FIRST/LAST/INDEX
  _foreachBlock(srcExpr, keyVar, valVar, payload) {
    payload = this._ltrimOne(payload, '\n');
    // Tag the payload once, before the loop — not per iteration.
    const blocks = this._makeTagged(this._getBlocks(payload));

    const [src] = this._peval(srcExpr);

    let iterable;
    if (src == null) {
      iterable = [];
    } else if (Array.isArray(src) || (typeof src === 'object' && src !== null)) {
      iterable = src;
    } else {
      iterable = [src];
    }

    // Only maintain __FOREACH_* when the payload actually references them;
    // otherwise skip 6 writes per iteration (the common case).
    const usesFirst = payload.includes('__FOREACH_FIRST');
    const usesLast = payload.includes('__FOREACH_LAST');
    const usesIndex = payload.includes('__FOREACH_INDEX');

    // Save only the loop-local keys we're about to overwrite instead of
    // shallow-cloning the entire tplVars scope on every foreach call. We
    // keep the eval scope (__S) in lock-step with tplVars here so _peval
    // never has to rebuild it — the per-iteration cost is only the loop-
    // local variable writes (keyVar/valVar/__FOREACH_*).
    const pfx = this.varPrefix + '_';
    const sFirst = pfx + '__FOREACH_FIRST';
    const sLast = pfx + '__FOREACH_LAST';
    const sIndex = pfx + '__FOREACH_INDEX';
    const sKey = pfx + keyVar;
    const sVal = valVar !== undefined ? pfx + valVar : null;

    const savedFirst = this.tplVars.__FOREACH_FIRST;
    const savedLast = this.tplVars.__FOREACH_LAST;
    const savedIndex = this.tplVars.__FOREACH_INDEX;
    const savedKey = this.tplVars[keyVar];
    const savedValVar = sVal !== null ? this.tplVars[valVar] : undefined;
    const savedSFirst = this.__S[sFirst];
    const savedSLast = this.__S[sLast];
    const savedSIndex = this.__S[sIndex];
    const savedSKey = this.__S[sKey];
    const savedSVal = sVal !== null ? this.__S[sVal] : undefined;

    const tv = this.tplVars;
    const S = this.__S;
    const hasVal = sVal !== null;
    let ret = '';
    let idx = 0;

    if (Array.isArray(iterable)) {
      const last = iterable.length - 1;
      for (let i = 0; i <= last; i++) {
        const val = iterable[i];
        if (usesFirst) { const f = idx === 0 ? 1 : 0; tv.__FOREACH_FIRST = f; S[sFirst] = f; }
        if (usesLast) { const l = idx === last ? 1 : 0; tv.__FOREACH_LAST = l; S[sLast] = l; }
        if (usesIndex) { tv.__FOREACH_INDEX = idx; S[sIndex] = idx; }
        if (hasVal) {
          tv[keyVar] = i;
          tv[valVar] = val;
          S[sKey] = i;
          S[sVal] = val;
        } else {
          tv[keyVar] = val;
          S[sKey] = val;
        }
        ret += this._processBlocksTagged(blocks);
        idx++;
      }
    } else if (typeof iterable === 'object' && iterable !== null) {
      const keys = Object.keys(iterable);
      const last = keys.length - 1;
      for (let i = 0; i <= last; i++) {
        const k = keys[i];
        const val = iterable[k];
        if (usesFirst) { const f = idx === 0 ? 1 : 0; tv.__FOREACH_FIRST = f; S[sFirst] = f; }
        if (usesLast) { const l = idx === last ? 1 : 0; tv.__FOREACH_LAST = l; S[sLast] = l; }
        if (usesIndex) { tv.__FOREACH_INDEX = idx; S[sIndex] = idx; }
        if (hasVal) {
          tv[keyVar] = k;
          tv[valVar] = val;
          S[sKey] = k;
          S[sVal] = val;
        } else {
          tv[keyVar] = val;
          S[sKey] = val;
        }
        ret += this._processBlocksTagged(blocks);
        idx++;
      }
    }

    this.tplVars.__FOREACH_FIRST = savedFirst;
    this.tplVars.__FOREACH_LAST = savedLast;
    this.tplVars.__FOREACH_INDEX = savedIndex;
    this.tplVars[keyVar] = savedKey;
    this.__S[sFirst] = savedSFirst;
    this.__S[sLast] = savedSLast;
    this.__S[sIndex] = savedSIndex;
    this.__S[sKey] = savedSKey;
    if (sVal !== null) {
      this.tplVars[valVar] = savedValVar;
      this.__S[sVal] = savedSVal;
    }
    return ret;
  }

  // Handle arbitrary {expression} by converting variables and evaluating
  _expressionBlock(str, inner) {
    if (!/["\d\$\(]/.test(str)) {
      const [line, col] = this._getCharLocation(this.charPos);
      throw new SluzError(`Unknown block type <code>${str}</code> on line #${line}`, 73467);
    }

    const [ret, err] = this._peval(inner);

    const valid = ret !== undefined && ret !== null && typeof ret !== 'object';

    if (err || !valid) {
      const [line, col] = this._getCharLocation(this.charPos);
      throw new SluzError(`Unknown tag <code>${str}</code> on line #${line}`, 18933);
    }

    return ret;
  }

  // -------------------------------------------------------------------
  // Variable / eval engine
  // -------------------------------------------------------------------

  // Convert $templateVar references to internal __S.prefix_var lookups for safe eval
  _convertVars(str) {
    str = String(str);
    if (!str.includes('$') && !str.includes('.')) return str;

    // Common case: $vars but no dots — a plain prefix swap is enough and
    // avoids the char-by-char loop below (dotted paths, decimal literals,
    // and the PHP . concat operator all need the loop).
    if (!str.includes('.')) {
      return str.replace(/\$\w+/g, m => `__S.sluz_pfx_${m.slice(1)}`);
    }

    let out = '';
    let i = 0;
    const n = str.length;
    while (i < n) {
      const ch = str[i];
      const next = i + 1 < n ? str[i + 1] : '';

      // Copy quoted strings verbatim so dots/pipes inside args are untouched
      if (ch === "'" || ch === '"') {
        const end = this._findQuoteEnd(str, i);
        out += str.slice(i, end + 1);
        i = end + 1;
        continue;
      }

      // $var or $var.path -> __S.scope lookup (dots inside are property access)
      if (ch === '$' && next && isWordChar(next.charCodeAt(0))) {
        let j = i + 1;
        while (j < n && isWordChar(str.charCodeAt(j))) j++;
        while (j < n && str.charCodeAt(j) === 46) { // '.'
          let k = j + 1;
          while (k < n && isWordChar(str.charCodeAt(k))) k++;
          if (k === j + 1) break; // trailing dot — stop path here
          j = k;
        }
        const tok = str.slice(i, j);
        const parts = tok.slice(1).split('.');
        const first = parts.shift();
        let res = `__S.sluz_pfx_${first}`;
        for (const p of parts) {
          res += isAllDigits(p) ? `[${p}]` : `.${p}`;
        }
        out += res;
        i = j;
        continue;
      }

      // PHP string-concat operator (.) -> JS +, unless the dot is part of a
      // property access (foo.bar, arr[0].bar) or a decimal literal (1.5)
      if (ch === '.') {
        const prev = i > 0 ? str[i - 1] : ' ';
        const nextIsWord = next && isWordChar(next.charCodeAt(0));
        const prevIsWord = prev && prev !== undefined && isWordChar(prev.charCodeAt(0));
        const isProperty = nextIsWord && (prevIsWord || prev === ']' || prev === ')');
        if (!isProperty) {
          out += '+';
          i++;
          continue;
        }
      }

      out += ch;
      i++;
    }
    return out;
  }

  // Return the index of the matching quote (no escape handling), or end of string
  _findQuoteEnd(str, start) {
    const quote = str[start];
    for (let i = start + 1; i < str.length; i++) {
      if (str[i] === quote) return i;
    }
    return str.length - 1;
  }

  // Fast-path resolution for literals, quoted strings, and simple var refs (avoids Function)
  _microOptimize(str) {
    if (isNumericLiteralMicro(str)) return str;
    if (!str.length) return undefined;

    const first = str[0];
    const last = str[str.length - 1];

    // $name or $a.b — direct scope lookup, no Function() and no arg spread.
    // This is the dominant shape for {if $flag} and foreach bodies.
    if (first === '$') {
      if (isSimpleVarInner(str)) return this._divePath(str.slice(1));
      return undefined;
    }

    // !$name / !$a.b
    if (first === '!') {
      const inner = str.slice(1);
      if (isSimpleVarInner(inner)) return !this._divePath(inner.slice(1));
      return undefined;
    }

    if (first === "'" && last === "'") {
      const tmp = str.slice(1, -1);
      if (!tmp.includes("'")) return tmp;
    }

    if (first === '"' && last === '"') {
      const tmp = str.slice(1, -1);
      if (!tmp.includes('$') && !tmp.includes('"')) return tmp;
    }

    if (isWordRune(str) && Object.prototype.hasOwnProperty.call(this.tplVars, str)) {
      return this.tplVars[str];
    }

    return undefined;
  }

  // Safely evaluate a template expression at runtime — returns [value, 0] or [undefined, -1]
  _peval(str) {
    // Smarty uses === for equality but JS triple-equals would reject
    // different types, so soften it to == for template compatibility
    if (str.includes('===')) str = str.replace(/===/g, '==');
    // Quick path: if the expression is a plain literal or simple reference,
    // resolve it without invoking the Function constructor
    const opt = this._microOptimize(str);
    if (opt !== undefined) return [opt, 0];

    let plan = this._exprCache.get(str);
    if (!plan) {
      plan = this._exprCacheOld.get(str);
      if (plan) {
        if (this._exprCache.size >= CACHE_LIMIT) {
          this._exprCacheOld = this._exprCache;
          this._exprCache = new Map();
        }
        this._exprCache.set(str, plan);
      }
    }
    if (!plan) {
      // Convert template variable references ($foo) to __S_prefix_fo lookups
      const code = this._convertVars(str);
      // Compile (and cache) a Function bound to the scope object and modifier
      // functions. Identical conditions inside loops reuse the cached fn so we
      // only pay the Function() cost once per unique expression string.
      let fn = this._fnCache.get(code);
      if (!fn) {
        fn = this._fnCacheOld.get(code);
        if (fn) {
          if (this._fnCache.size >= CACHE_LIMIT) {
            this._fnCacheOld = this._fnCache;
            this._fnCache = new Map();
          }
          this._fnCache.set(code, fn);
        }
      }
      if (!fn) {
        fn = new Function('__S', ...this._fnNames, `"use strict"; return (${code})`);
        if (this._fnCache.size >= CACHE_LIMIT) {
          this._fnCacheOld = this._fnCache;
          this._fnCache = new Map();
        }
        this._fnCache.set(code, fn);
      }
      plan = { fn };
      if (this._exprCache.size >= CACHE_LIMIT) {
        this._exprCacheOld = this._exprCache;
        this._exprCache = new Map();
      }
      this._exprCache.set(str, plan);
    }

    // The eval scope (this.__S) is kept in sync incrementally by assign()
    // and _foreachBlock, so there's nothing to rebuild here.
    try {
      return [plan.fn(this.__S, ...this._fnRefs), 0];
    } catch {
      return [undefined, -1];
    }
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  // Strip a single leading character if it matches the given character
  _ltrimOne(str, char) {
    if (str && str[0] === char) return str.slice(1);
    return str;
  }

  // Find the position of a matching close tag, accounting for nested open tags
  _findEndingTag(haystack, openTag, closeTag) {
    let pos = haystack.indexOf(closeTag);
    if (pos < 0) return -1;

    let substr = haystack.slice(0, pos);
    const openRe = new RegExp(escapeRegex(openTag), 'g');
    let openCount = (substr.match(openRe) || []).length;
    if (openCount === 1) return pos;

    const closeLen = closeTag.length;
    let offset = pos + closeLen;

    for (let n = 0; n < 5; n++) {
      pos = haystack.indexOf(closeTag, offset);
      if (pos < 0) return -1;
      substr = haystack.slice(0, pos + 2);
      openCount = (substr.match(openRe) || []).length;
      const closeCount = (substr.match(new RegExp(escapeRegex(closeTag), 'g')) || []).length;
      if (openCount === closeCount) return pos;
      offset = pos + closeLen;
    }

    return -1;
  }

  // Split a string on tag boundaries into an array of tokens
  _getTokens(str) {
    return str.split(this._tokenSplitRe).filter(t => t.length);
  }

  // Check if a token is an if/elseif/else/close tag — returns condition, '1', or ''
  _isIfToken(str) {
    if (str === this._else_tag) return '1';
    if (str === this._close_if) return '1';
    const m = str.match(this._tokenIfRe);
    if (m) return m[1];
    return '';
  }

  // Extract [condition, payload] pairs from if-tokens, handling nested if-blocks
  _ifRulesFromTokens(toks) {
    const num = toks.length;
    let nested = 0;
    const tmp = new Array(num);
    const closeIf = this._close_if;
    const ifStartRe = this._ifStartReGlobal;

    for (let i = 0; i < num; i++) {
      const item = toks[i];
      if (ifStartRe.test(item)) nested++;
      if (item === closeIf) nested--;

      let yes = 0;
      if (nested === 1) {
        yes = this._isIfToken(item) || 0;
        if (item === closeIf) yes = 0;
      }
      tmp[i] = yes;
    }

    tmp[num - 1] = 1;

    const conds = [];
    for (let i = 0; i < num; i++) {
      if (tmp[i]) {
        const test = this._isIfToken(toks[i]);
        if (i !== num - 1) conds.push(test);
      }
    }

    let str = '';
    const payloads = [];
    let first = true;
    for (let i = 0; i < num; i++) {
      if (tmp[i]) {
        if (!first) payloads.push(str);
        first = false;
        str = '';
      } else {
        str += toks[i];
      }
    }

    if (conds.length !== payloads.length) {
      throw new SluzError(`Error parsing {if} conditions`, 95320);
    }

    const ret = [];
    for (let i = 0; i < conds.length; i++) {
      ret.push([conds[i], this._ltrimOne(payloads[i], '\n')]);
    }
    return ret;
  }

  // -------------------------------------------------------------------
  // Quote-aware splitting
  // -------------------------------------------------------------------

  // Split by delimiter, respecting single/double-quoted substrings.
  // Fast path: when the string has no quotes at all, plain split wins
  // (the overwhelmingly common case for modifier chains and param lists).
  _splitRespectingQuotes(str, delimiter) {
    if (!str.includes("'") && !str.includes('"')) {
      return str.split(delimiter);
    }
    const parts = [];
    let current = '';
    let inQuote = null;

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];

      if (inQuote) {
        current += ch;
        if (ch === inQuote) inQuote = null;
      } else if (ch === "'" || ch === '"') {
        current += ch;
        inQuote = ch;
      } else if (ch === delimiter) {
        parts.push(current);
        current = '';
      } else {
        current += ch;
      }
    }

    if (current.length) parts.push(current);
    return parts;
  }

  // Find first colon outside quotes — used to split modifier name from params
  _findFirstColonOutsideQuotes(str) {
    let inQuote = null;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if ((ch === "'" || ch === '"') && inQuote === null) {
        inQuote = ch;
      } else if (ch === inQuote) {
        inQuote = null;
      } else if (ch === ':' && inQuote === null) {
        return i;
      }
    }
    return -1;
  }

  // Check if value is "nothing" (undefined, null, empty string — but not "0" or objects)
  _isNothing(v) {
    if (v === undefined || v === null) return true;
    if (typeof v === 'object') return false;
    if (typeof v === 'string') return v.length === 0;
    return String(v).length === 0 && v !== '0';
  }

  // -------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------

  // Convert a character index to [line, column] for error messages
  _getCharLocation(pos) {
    const str = this._sourceStr;
    if (pos < 0 || !str) return [-1, -1];

    let line = 1;
    let col = 0;
    for (let i = 0; i < str.length; i++) {
      col++;
      if (str[i] === '\n') {
        line++;
        col = 0;
      }
      if (pos === i) return [line, col];
    }

    if (pos === str.length) return [line, col];
    return [-1, -1];
  }
}

export { SluzError };
