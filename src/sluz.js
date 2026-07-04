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
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export default class Sluz {
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

    this._close_if = L + '/if' + R;
    this._close_foreach = L + '/foreach' + R;
    this._else_tag = L + 'else' + R;
    this._elseif_tag = L + 'elseif ';
    this._comment_open = L + '*';
    this._comment_close = '*' + R;

    this._varReWithPipe = new RegExp(`^${eL}\\$([\\w|.'";\\t :,!@#%^&*?_\\-/$]+)${eR}$`);
    this._varReSimple = new RegExp(`^${eL}\\$([\\w|.'";\\t :,!@#%^&*?_\\-/]+)${eR}$`);
    this._foreachRe = new RegExp(`^${eL}foreach (\\$\\w[\\w.]*) as \\$(\\w+)(?: => \\$(\\w+))?${eR}([\\s\\S]*)${eL}\\/foreach${eR}$`);
    this._literalRe = new RegExp(`^${eL}literal${eR}([\\s\\S]*)${eL}\\/literal${eR}$`);
    this._catchAllRe = new RegExp(`^${eL}(.+)${eR}$`, 's');
    this._tokenSplitRe = new RegExp(`(${eL}[^${eR}]+${eR})`);
    this._openTagRe = new RegExp(`^${eL}(if|foreach|literal)\\b`);
    this._closeTagRe = new RegExp(`${eL}\\/(\\w+)${eR}`);
    this._ifStartRe = new RegExp(`^${eL}if\\b`);
    this._forStartRe = new RegExp(`^${eL}for`);
    this._whitespaceRe = new RegExp(`^\\s[${eL}${eR}]\\s$`);
    this._wsPaddedRe = new RegExp(`^${eL}\\s+.*\\s+${eR}$`);
    this._catchAllRe2 = new RegExp(`^${eL}(.+)${eR}$`, 's');
    this._tokenIfRe = new RegExp(`^${eL}(?:if|elseif)\\s+(.+?)${eR}$`);
    this._ifSimpleRe = new RegExp(`${eL}if (.+?)${eR}([\\s\\S]*)${eL}\\/if${eR}`, 's');
    this._ifStartReGlobal = new RegExp(`^${eL}if\\b`);
    this._foreachStripRe = new RegExp(`^${escapeRegex(L)}foreach .+?${escapeRegex(R)}([\\s\\S]*)${escapeRegex(L)}\\/foreach${escapeRegex(R)}$`);
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
    this._fnNames = [...this.modifiers.keys()];
    this._fnRefs = this._fnNames.map(n => this.modifiers.get(n));
  }

  // Set alternate tag delimiters. Both must be single, distinct characters.
  set_delimiters(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string') {
      throw new SluzError('Delimiters must be strings', 1);
    }
    if (left.length !== 1 || right.length !== 1) {
      throw new SluzError('Delimiters must be single characters', 2);
    }
    if (left === right) {
      throw new SluzError('Left and right delimiters must be different', 3);
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

  // Parse a template string — tokenize into blocks then process each in sequence
  parse(str) {
    this._sourceStr = str;
    const blocks = this._getBlocks(str);
    return this._processBlocks(blocks);
  }

  // -------------------------------------------------------------------
  // Tokenizer
  // -------------------------------------------------------------------

  // Split a template string into [text, endIndex] blocks, handling nested if/foreach/literal
  _getBlocks(str) {
    const L = this.left_delim;
    const R = this.right_delim;
    const slen = str.length;
    let start = 0;
    let i;
    const blocks = [];

    // Fast-forward to the first left delimiter so we don't scan plain text char-by-char
    let z = str.indexOf(L);
    if (z < 0) z = slen;

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
        blocks.push([str.slice(start, i), i]);
        start = i;
      } else if (isClosed) {
        // Find the full tag (or block) from start to the matching right delimiter
        const len = i - start + 1;
        let block = str.slice(start, start + len);
        const openTagMatch = block.match(this._openTagRe);
        // For block tags (if/foreach/literal), scan for the matching close tag
        if (openTagMatch) {
          const ot = openTagMatch[1];
          const closeTag = L + '/' + ot + R;
          const openRe = new RegExp(`${escapeRegex(L)}${escapeRegex(ot)}\\b`, 'g');
          const closeRe = new RegExp(`${escapeRegex(closeTag)}`, 'g');
          for (let j = i + 1; j < slen; j++) {
            if (str[j] === R) {
              const tmp = str.slice(start, j + 1);
              const oc = (tmp.match(openRe) || []).length;
              const cc = (tmp.match(closeRe) || []).length;
              if (oc === cc) {
                block = tmp;
                break;
              }
            }
          }
        }

        if (block.length) blocks.push([block, i]);
        start += block.length;
        i = start;
      }

      // Handle {* comment *} — swallow everything up to the closing *}
      if (isComment) {
        const end = this._findEndingTag(str.slice(start), this._comment_open, this._comment_close);
        if (end < 0) {
          const [line, col] = this._getCharLocation(i);
          throw new SluzError(`Missing closing <code>${escapeRegex(this._comment_close)}</code> for comment on line #${line}`, 48724);
        }
        start += end + this._comment_close.length;
        i = start;
      }
    }

    // Push any remaining text after the last tag as a literal block
    if (start < slen) {
      blocks.push([str.slice(start), i]);
    }

    // Strip the leading newline from blocks that follow {if}/{for} so the
    // rendered HTML doesn't have an extra blank line after control tags
    let prevIsIf = false;
    for (let bi = 0; bi < blocks.length; bi++) {
      const bstr = blocks[bi][0];
      const curIsIf = this._ifStartRe.test(bstr) || this._forStartRe.test(bstr);
      if (prevIsIf) {
        let shouldStrip = 1;
        const foreachMatch = blocks[bi - 1][0].match(this._foreachStripRe);
        if (foreachMatch) {
          shouldStrip = foreachMatch[1].endsWith('\n') ? 1 : 0;
        }
        if (shouldStrip) {
          blocks[bi][0] = this._ltrimOne(bstr, '\n');
        }
      }
      prevIsIf = curIsIf;
    }

    return blocks;
  }

  // Walk parsed blocks: dispatch {tags} to _processBlock, append literal text
  _processBlocks(blocks) {
    let html = '';
    for (const x of blocks) {
      const block = x[0];
      if (!block.length) continue;
      if (block[0] === this.left_delim) {
        html += this._processBlock(block, x[1]);
      } else {
        html += block;
      }
    }
    return html;
  }

  // Dispatch a {tag} to the right handler: variable, if, foreach, literal, expression
  _processBlock(str, charPos) {
    this.charPos = charPos;
    const L = this.left_delim;
    const R = this.right_delim;

    // {$var} or {$var|modifier:param} or {$var|modifier:$param}
    if (str.startsWith(L + '$')) {
      const varMatch = str.includes('|')
        ? str.match(this._varReWithPipe)
        : str.match(this._varReSimple);
      if (varMatch) return this._variableBlock(varMatch[1]);
    }

    // {if condition}...{/if}
    if (str.startsWith(L + 'if ') && str.endsWith(this._close_if)) {
      return this._ifBlock(str);
    }

    // {foreach $array as $key => $value}...{/foreach}
    const foreachMatch = str.match(this._foreachRe);
    if (str.startsWith(L + 'foreach ') && foreachMatch) {
      return this._foreachBlock(foreachMatch[1], foreachMatch[2], foreachMatch[3], foreachMatch[4]);
    }

    // {literal}raw content{/literal} — returned verbatim
    if (str.startsWith(L + 'literal')) {
      const m = str.match(this._literalRe);
      if (m) return m[1];
    }

    // { foo } — whitespace-padded content without expression markers, return verbatim
    if (this._wsPaddedRe.test(str) && !/["\d\$\(]/.test(str)) {
      return str;
    }

    // Fallback: treat anything inside delimiters as an expression
    const exprMatch = str.match(this._catchAllRe2);
    if (exprMatch) {
      return this._expressionBlock(str, exprMatch[1]);
    }

    // No closing delimiter — this is a parse error
    if (!str.endsWith(R)) {
      const [line, col] = this._getCharLocation(this.charPos);
      throw new SluzError(`Unclosed tag <code>${str}</code> on line #${line}`, 45821);
    }

    return str;
  }

  // -------------------------------------------------------------------
  // Block handlers
  // -------------------------------------------------------------------

  // Resolve {$var} with optional pipe modifiers, dotted paths, and "default:" fallback
  _variableBlock(str) {
    const pipeParts = this._splitRespectingQuotes(str, '|');
    const key = pipeParts[0];
    const modStr = pipeParts.slice(1).join('|');

    if (modStr) {
      const tmp = this._arrayDive(key, this.tplVars);
      const isDefault = modStr.includes('default:');
      const isNothing = this._isNothing(tmp);

      if (isNothing && isDefault) {
        const dval = modStr.replace(/^.*?default:/, '');
        const [ret] = this._peval(dval);
        if (ret !== undefined) return ret;
        return '';
      } else if (!isNothing && isDefault) {
        return String(tmp ?? '');
      } else {
        let pre = tmp ?? '';
        const parts = this._splitRespectingQuotes(modStr, '|');
        let seenEscape = false;
        let seenNoescape = false;
        for (const p of parts) {
          const colonIdx = this._findFirstColonOutsideQuotes(p);
          const func = colonIdx >= 0 ? p.slice(0, colonIdx) : p;
          const paramStr = colonIdx >= 0 ? p.slice(colonIdx + 1) : '';

          if (func === 'escape') seenEscape = true;
          if (func === 'noescape') seenNoescape = true;

          const params = [pre];

          if (paramStr.length) {
            const commaLimbs = this._splitRespectingQuotes(paramStr, ',');
            for (const limb of commaLimbs) {
              const [v] = this._peval(limb);
              params.push(v);
            }
          }

          const fn = this.modifiers.get(func);
          if (!fn) {
            const [line, col] = this._getCharLocation(this.charPos);
            throw new SluzError(`Unknown function call <code>${func}</code> on line #${line}`, 47204);
          }
          pre = fn(...params);
        }
        if (this.auto_escape && !seenNoescape && !seenEscape) {
          pre = this._esc(pre);
        }
        return pre;
      }
    }

    const ret = this._arrayDive(str, this.tplVars);
    if (Array.isArray(ret)) return 'ARRAY';
    if (ret && typeof ret === 'object') return 'HASH';
    if (ret != null) return this._esc(ret);
    return '';
  }

  // Evaluate {if}/{elseif}/{else} — fast regex for simple blocks, tokenized for complex
  _ifBlock(str) {
    // True when the block has no else or elseif, so we can use a simple regex
    const isSimple = !str.includes(this._else_tag, this.left_delim.length);
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

    let ret = '';
    for (const [cond, payload] of rules) {
      const test = this._convertVars(cond);
      const [res] = this._peval(test);
      if (res) {
        const inBlocks = this._getBlocks(payload);
        ret += this._processBlocks(inBlocks);
        break;
      }
    }
    return ret;
  }

  // Process {foreach $arr as $k => $v}...{/foreach} with __FOREACH_FIRST/LAST/INDEX
  _foreachBlock(srcExpr, keyVar, valVar, payload) {
    const convSrc = this._convertVars(srcExpr);
    payload = this._ltrimOne(payload, '\n');
    const blocks = this._getBlocks(payload);

    const [src] = this._peval(convSrc);

    let iterable;
    if (src == null) {
      iterable = [];
    } else if (Array.isArray(src) || (typeof src === 'object' && src !== null)) {
      iterable = src;
    } else {
      iterable = [src];
    }

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

    let ret = '';
    let idx = 0;

    if (Array.isArray(iterable)) {
      const last = iterable.length - 1;
      for (let i = 0; i <= last; i++) {
        const first = idx === 0 ? 1 : 0;
        const isLast = idx === last ? 1 : 0;
        this.tplVars.__FOREACH_FIRST = first;
        this.tplVars.__FOREACH_LAST = isLast;
        this.tplVars.__FOREACH_INDEX = idx;
        this.__S[sFirst] = first;
        this.__S[sLast] = isLast;
        this.__S[sIndex] = idx;
        if (sVal !== null) {
          this.tplVars[keyVar] = i;
          this.tplVars[valVar] = iterable[i];
          this.__S[sKey] = i;
          this.__S[sVal] = iterable[i];
        } else {
          this.tplVars[keyVar] = iterable[i];
          this.__S[sKey] = iterable[i];
        }
        ret += this._processBlocks(blocks);
        idx++;
      }
    } else if (typeof iterable === 'object' && iterable !== null) {
      const keys = Object.keys(iterable);
      const last = keys.length - 1;
      for (let i = 0; i <= last; i++) {
        const k = keys[i];
        const first = idx === 0 ? 1 : 0;
        const isLast = idx === last ? 1 : 0;
        this.tplVars.__FOREACH_FIRST = first;
        this.tplVars.__FOREACH_LAST = isLast;
        this.tplVars.__FOREACH_INDEX = idx;
        this.__S[sFirst] = first;
        this.__S[sLast] = isLast;
        this.__S[sIndex] = idx;
        if (sVal !== null) {
          this.tplVars[keyVar] = k;
          this.tplVars[valVar] = iterable[k];
          this.__S[sKey] = k;
          this.__S[sVal] = iterable[k];
        } else {
          this.tplVars[keyVar] = iterable[k];
          this.__S[sKey] = iterable[k];
        }
        ret += this._processBlocks(blocks);
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

    const after = this._convertVars(inner);
    const [ret, err] = this._peval(after);

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
    if (!str.includes('$')) return str;
    return str.replace(/\$\w[\w.]*/g, match => {
      const parts = match.slice(1).split('.');
      const first = parts.shift();
      let res = `__S.sluz_pfx_${first}`;
      for (const p of parts) {
        res += /^\d+$/.test(p) ? `[${p}]` : `.${p}`;
      }
      return res;
    });
  }

  // Fast-path resolution for literals, quoted strings, and simple var refs (avoids Function)
  _microOptimize(str) {
    if (/^-?\d+(?:\.\d+)?$/.test(str)) return str;
    if (!str.length) return undefined;

    const first = str[0];
    const last = str[str.length - 1];

    if (first === "'" && last === "'") {
      const tmp = str.slice(1, -1);
      if (!tmp.includes("'")) return tmp;
    }

    if (first === '"' && last === '"') {
      const tmp = str.slice(1, -1);
      if (!tmp.includes('$') && !tmp.includes('"')) return tmp;
    }

    if (/^\w+$/.test(str) && Object.prototype.hasOwnProperty.call(this.tplVars, str)) {
      return this.tplVars[str];
    }

    const bareNot = str.match(/^!(\w+)$/);
    if (bareNot && Object.prototype.hasOwnProperty.call(this.tplVars, bareNot[1])) {
      return !this.tplVars[bareNot[1]];
    }

    return undefined;
  }

  // Safely evaluate a template expression at runtime — returns [value, 0] or [undefined, -1]
  _peval(str) {
    // Smarty uses === for equality but JS triple-equals would reject
    // different types, so soften it to == for template compatibility
    str = str.replace(/===/g, '==');
	// Quick path: if the expression is a plain literal or simple reference,
    // resolve it without invoking the Function constructor
    const opt = this._microOptimize(str);
    if (opt !== undefined) return [opt, 0];

    // Convert template variable references ($foo) to __S_prefix_foo lookups
    const code = this._convertVars(str);
    // Compile (and cache) a Function bound to the scope object and modifier
    // functions. Identical conditions inside loops reuse the cached fn so we
    // only pay the Function() cost once per unique expression string.
    let fn = this._fnCache.get(code);
    if (!fn) {
      fn = new Function('__S', ...this._fnNames, `"use strict"; return (${code})`);
      this._fnCache.set(code, fn);
    }

    // The eval scope (this.__S) is kept in sync incrementally by assign()
    // and _foreachBlock, so there's nothing to rebuild here.
    try {
      return [fn(this.__S, ...this._fnRefs), 0];
    } catch {
      return [undefined, -1];
    }
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  // Walk a dotted path into nested objects/arrays (e.g. "user.profile.name")
  _arrayDive(needle, haystack) {
    if (needle == null || haystack == null) return undefined;

    if (Object.prototype.hasOwnProperty.call(haystack, needle)) {
      return haystack[needle];
    }

    const parts = needle.split('.');
    let arr = haystack;

    for (const elem of parts) {
      if (arr == null) return undefined;
      if (Array.isArray(arr)) {
        if (!/^\d+$/.test(elem) || elem >= arr.length) return undefined;
        arr = arr[elem];
      } else if (typeof arr === 'object') {
        if (!Object.prototype.hasOwnProperty.call(arr, elem)) return undefined;
        arr = arr[elem];
      } else {
        return undefined;
      }
    }
    return arr;
  }

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

  // Check if a token is an if/elseif/else/close tag — returns condition, 1, or ''
  _isIfToken(str) {
    if (str === this._else_tag) return 1;
    if (str === this._close_if) return 1;
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
      ret.push([conds[i], payloads[i]]);
    }
    return ret;
  }

  // -------------------------------------------------------------------
  // Quote-aware splitting
  // -------------------------------------------------------------------

  // Split by delimiter, respecting single/double-quoted substrings
  _splitRespectingQuotes(str, delimiter) {
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
