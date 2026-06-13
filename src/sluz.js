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

function escapeRegex(s) {
  return s.replace(/[\\.*+?()\[\]{}|^$]/g, ch => ESCAPE_RE[ch]);
}

export default class Sluz {
  constructor() {
    this.tplVars = {};
    this.varPrefix = 'sluz_pfx';
    this.modifiers = new Map();
    this.charPos = -1;
    this._sourceStr = '';

    this._registerBuiltins();
  }

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
  }

  /**
   * @param {string|Object} first
   * @param {*} [second]
   */
  assign(first, second) {
    // Batch-assign: pass a single object to assign all its keys at once
    if (arguments.length === 1 && typeof first === 'object' && !Array.isArray(first) && first !== null) {
      for (const [k, v] of Object.entries(first)) {
        this.tplVars[k] = v;
      }
    // Key-value pair: assign('name', 'value')
    } else if (arguments.length % 2 === 0) {
      for (let i = 0; i < arguments.length; i += 2) {
        this.tplVars[arguments[i]] = arguments[i + 1];
      }
    }
  }

  registerModifier(name, fn) {
    this.modifiers.set(name, fn);
  }

  // This is where all the real work is done.
  // We break the input string into blocks based on { }
  // Then we loop through those blocks doing variable replacement as needed
  parse(str) {
    this._sourceStr = str;
    const blocks = this._getBlocks(str);
    return this._processBlocks(blocks);
  }

  // -------------------------------------------------------------------
  // Tokenizer
  // -------------------------------------------------------------------

  /**
   * @param {string} str
   * @returns {Array<[string, number]>}
   */
  // Split a template string into an array of [text, endIndex] blocks,
  // separating literal HTML from {tags} and handling nested if/foreach/literal.
  _getBlocks(str) {
    const slen = str.length;
    let start = 0;
    let i;
    const blocks = [];

    // Fast-forward to the first '{' so we don't scan plain text char-by-char
    let z = str.indexOf('{');
    if (z < 0) z = slen;

    for (i = z; i < slen; i++) {
      const char = str[i];
      let isOpen = char === '{';
      const isClosed = char === '}';

      // Skip plain-text runs in one jump instead of character-by-character
      if (!isOpen && !isClosed) {
        const nextOpen = str.indexOf('{', i);
        const nextClose = str.indexOf('}', i);
        const nOpen = nextOpen < 0 ? slen : nextOpen;
        const nClose = nextClose < 0 ? slen : nextClose;
        i = (nOpen < nClose ? nOpen : nClose) - 1;
        continue;
      }

      const hasLen = start !== i;
      let isComment = false;

      // Disambiguate '{' used in template tags from literal '{' surrounded by whitespace
      if (isOpen) {
        const prevC = i > 0 ? str[i - 1] : ' ';
        const nextC = i + 1 < slen ? str[i + 1] : ' ';
        const chk = prevC + char + nextC;
        if (/^\s[\{\}]\s$/.test(chk)) isOpen = false;
        if (nextC === '*') isComment = true;
      }

      // Push the text before this opening tag as a literal block
      if (isOpen && hasLen) {
        blocks.push([str.slice(start, i), i]);
        start = i;
      } else if (isClosed) {
        // Find the full tag (or block) from start to the matching '}'
        const len = i - start + 1;
        let block = str.slice(start, start + len);
        const openTagMatch = block.match(/^\{(if|foreach|literal)\b/);
        // For block tags (if/foreach/literal), scan for the matching close tag
        if (openTagMatch) {
          const ot = openTagMatch[1];
          const closeTag = `{/${ot}}`;
          for (let j = i + 1; j < slen; j++) {
            if (str[j] === '}') {
              const tmp = str.slice(start, j + 1);
              const oc = (tmp.match(new RegExp(`\\{${escapeRegex(ot)}\\b`, 'g')) || []).length;
              const cc = (tmp.match(new RegExp(`\\{\\/${escapeRegex(ot)}\\}`, 'g')) || []).length;
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
        const end = this._findEndingTag(str.slice(start), '{*', '*}');
        if (end < 0) {
          const [line, col] = this._getCharLocation(i);
          throw new SluzError(`Missing closing <code>*}</code> for comment on line #${line}`, 48724);
        }
        start += end + 2;
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
      const curIsIf = /^\{if\b/.test(bstr) || /^\{for/.test(bstr);
      if (prevIsIf) {
        let shouldStrip = 1;
        const foreachMatch = blocks[bi - 1][0].match(/^\{foreach .+?\}([\s\S]*)\{\/foreach\}$/);
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

  // Walk the parsed blocks and reassemble the final HTML.
  // Blocks starting with '{' are template tags processed by _processBlock;
  // everything else is literal text appended as-is.
  _processBlocks(blocks) {
    let html = '';
    for (const x of blocks) {
      const block = x[0];
      if (!block.length) continue;
      if (block[0] === '{') {
        html += this._processBlock(block, x[1]);
      } else {
        html += block;
      }
    }
    return html;
  }

  // Dispatch a single {tag} string to the appropriate handler.
  // Tries each known tag type in order: variable, if, foreach, literal,
  // expression, then falls back to an error for unclosed tags.
  _processBlock(str, charPos) {
    this.charPos = charPos;

    // {$var} or {$var|modifier:param}
    const varMatch = str.match(/^\{\$([\w|.'";\t :,!@#%^&*?_\-/]+)\}$/);
    if (str.startsWith('{$') && varMatch) {
      return this._variableBlock(varMatch[1]);
    }

    // {if condition}...{/if}
    if (str.startsWith('{if ') && str.endsWith('{/if}')) {
      return this._ifBlock(str);
    }

    // {foreach $array as $key => $value}...{/foreach}
    const foreachMatch = str.match(/^\{foreach (\$\w[\w.]*) as \$(\w+)(?: => \$(\w+))?\}([\s\S]*)\{\/foreach\}$/);
    if (str.startsWith('{foreach ') && foreachMatch) {
      return this._foreachBlock(foreachMatch[1], foreachMatch[2], foreachMatch[3], foreachMatch[4]);
    }

    // {literal}raw content{/literal} — returned verbatim
    if (str.startsWith('{literal}')) {
      const m = str.match(/^\{literal\}([\s\S]*)\{\/literal\}$/);
      if (m) return m[1];
    }

    // { foo } — whitespace-padded content without expression markers, return verbatim
    if (/^\{\s+.*\s+\}$/.test(str) && !/["\d\$\(]/.test(str)) {
      return str;
    }

    // Fallback: treat anything inside { } as an expression
    const exprMatch = str.match(/^\{(.+)}$/s);
    if (exprMatch) {
      return this._expressionBlock(str, exprMatch[1]);
    }

    // No closing brace — this is a parse error
    if (!str.endsWith('}')) {
      const [line, col] = this._getCharLocation(this.charPos);
      throw new SluzError(`Unclosed tag <code>${str}</code> on line #${line}`, 45821);
    }

    return str;
  }

  // -------------------------------------------------------------------
  // Block handlers
  // -------------------------------------------------------------------

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
        return String(this._arrayDive(key, this.tplVars) ?? '');
      } else {
        let pre = this._arrayDive(key, this.tplVars) ?? '';
        const parts = this._splitRespectingQuotes(modStr, '|');
        for (const p of parts) {
          const colonIdx = this._findFirstColonOutsideQuotes(p);
          const func = colonIdx >= 0 ? p.slice(0, colonIdx) : p;
          const paramStr = colonIdx >= 0 ? p.slice(colonIdx + 1) : '';
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
        return pre;
      }
    }

    const ret = this._arrayDive(str, this.tplVars);
    if (Array.isArray(ret)) return 'ARRAY';
    if (ret && typeof ret === 'object') return 'HASH';
    if (ret != null) return ret;
    return '';
  }

  // Evaluate an {if}/{elseif}/{else} chain.
  // Simple blocks (no {else}) use a fast regex path; complex ones go through
  // tokenization. The first matching condition renders its payload.
  _ifBlock(str) {
    // True when the block has no {else} or {elseif}, so we can use a simple regex
    const isSimple = !str.includes('{else', 7);
    let rules = [];

    if (isSimple) {
      const m = str.match(/\{if (.+?)\}([\s\S]*)\{\/if\}/s);
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

    const save = { ...this.tplVars };
    let ret = '';
    let idx = 0;

    if (Array.isArray(iterable)) {
      const last = iterable.length - 1;
      for (let i = 0; i <= last; i++) {
        this.tplVars.__FOREACH_FIRST = idx === 0 ? 1 : 0;
        this.tplVars.__FOREACH_LAST = idx === last ? 1 : 0;
        this.tplVars.__FOREACH_INDEX = idx;
        if (valVar !== undefined) {
          this.tplVars[keyVar] = i;
          this.tplVars[valVar] = iterable[i];
        } else {
          this.tplVars[keyVar] = iterable[i];
        }
        ret += this._processBlocks(blocks);
        idx++;
      }
    } else if (typeof iterable === 'object' && iterable !== null) {
      const keys = Object.keys(iterable);
      const last = keys.length - 1;
      for (let i = 0; i <= last; i++) {
        const k = keys[i];
        this.tplVars.__FOREACH_FIRST = idx === 0 ? 1 : 0;
        this.tplVars.__FOREACH_LAST = idx === last ? 1 : 0;
        this.tplVars.__FOREACH_INDEX = idx;
        if (valVar !== undefined) {
          this.tplVars[keyVar] = k;
          this.tplVars[valVar] = iterable[k];
        } else {
          this.tplVars[keyVar] = iterable[k];
        }
        ret += this._processBlocks(blocks);
        idx++;
      }
    }

    this.tplVars = save;
    return ret;
  }

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

  // Safely evaluate a template expression string at runtime.
  // Returns [value, 0] on success or [undefined, -1] on error.
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
    // Build a Function that receives the variable scope object and any
    // registered custom modifier functions as parameters
    const fnNames = [...this.modifiers.keys()];
    const fn = new Function('__S', ...fnNames, `"use strict"; return (${code})`);

    // Build the scope object with prefixed keys so $foo maps to __S_foo
    const __S = {};
    for (const [k, v] of Object.entries(this.tplVars)) {
      __S[`${this.varPrefix}_${k}`] = v;
    }

    const fns = fnNames.map(n => this.modifiers.get(n));
    try {
      return [fn(__S, ...fns), 0];
    } catch {
      return [undefined, -1];
    }
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

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

  _ltrimOne(str, char) {
    if (str && str[0] === char) return str.slice(1);
    return str;
  }

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

  _getTokens(str) {
    return str.split(/({[^}]+})/).filter(t => t.length);
  }

  _isIfToken(str) {
    if (str === '{else}') return 1;
    if (str === '{/if}') return 1;
    const m = str.match(/^\{(?:if|elseif)\s+(.+?)\}$/);
    if (m) return m[1];
    return '';
  }

  _ifRulesFromTokens(toks) {
    const num = toks.length;
    let nested = 0;
    const tmp = new Array(num);

    for (let i = 0; i < num; i++) {
      const item = toks[i];
      if (/^\{if\b/.test(item)) nested++;
      if (item === '{/if}') nested--;

      let yes = 0;
      if (nested === 1) {
        yes = this._isIfToken(item) || 0;
        if (item === '{/if}') yes = 0;
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

  _isNothing(v) {
    if (v === undefined || v === null) return true;
    if (typeof v === 'object') return false;
    return String(v).length === 0 && v !== '0';
  }

  // -------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------

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
