# ⚡ Sluz templating system

A minimalistic JavaScript templating engine with Smarty-like syntax. Zero dependencies, ESM-only.

## 📦 Installation

```bash
npm install template-sluz
```

## 🚀 Quick Start

```js
import Sluz from 'template-sluz';

const sluz = new Sluz();
sluz.assign('name', 'Scott');
sluz.assign('user', { first: 'Jason', last: 'Doolis', age: 43 });

console.log(sluz.parse('Hello {$name}')); // Hello Scott
console.log(sluz.parse('{$user.first} {$user.last}')); // Jason Doolis
```

---

## 🌐 Browser Usage

Load Sluz in the browser with `<script type="module">`.

```html
<script type="module">
    import Sluz from './path/to/sluz.js';
</script>
```

---

## 📝 Variables

Variables are inserted with `{$varname}`. Dotted paths resolve nested objects and arrays.

```js
sluz.assign('person', { name: { first: 'Jane' }, colors: ['red', 'green'] });

sluz.parse('{$person.name.first}');           // Jane
sluz.parse('{$person.colors.0}');             // red
sluz.parse('{$missing}');                     // '' (empty string)
```

### assign()

Accepts key/value pairs or a single object:

```js
sluz.assign('color', 'blue');
sluz.assign('size', ['small', 'medium', 'large']);
sluz.assign('info', { color: 'yellow', age: 43 });
```

---

## 📖 API Reference

### `new Sluz()`

Creates a new template engine instance.

### `assign(key, value)` / `assign(object)`

Sets template variables. Accepts:
- Key/value pairs: `sluz.assign('name', 'Scott')`
- A single object: `sluz.assign('info', { name: 'Scott', age: 43 })`

### `registerModifier(name, fn)`

Registers a custom modifier function. The function receives the variable value as the first argument, followed by any user-supplied arguments from the template.

```js
sluz.registerModifier('truncate', (s, n) => String(s).slice(0, n));
// Template: {$name|truncate:3}
```

### `parse(string)`

Parses a template string with the current variables and returns the rendered output.

---

## 🔧 Modifiers

Modifiers transform variable output using pipe (`|`) syntax. Static arguments follow a colon (`:`), multiple arguments are comma-separated.

### Built-in modifiers

| Modifier    | Description                              | Example                                      |
|------------|------------------------------------------|----------------------------------------------|
| `upper`    | Uppercase string                         | `{$name\|upper}`                             |
| `lower`    | Lowercase string                         | `{$name\|lower}`                             |
| `ucfirst`  | Capitalize first character               | `{$name\|ucfirst}`                           |
| `trim`     | Trim whitespace                          | `{$name\|trim}`                              |
| `length`   | String length                            | `{$name\|length}`                            |
| `substr`   | Substring `(start[, length])`            | `{$name\|substr:0,3}`                        |
| `replace`  | Replace all occurrences                  | `{$name\|replace:"old","new"}`               |
| `join`     | Join array with separator                | `{$items\|join:", "}`                        |
| `count`    | Count array keys / object keys / truthy  | `{$items\|count}`                            |
| `first`    | First element of array / first character | `{$items\|first}`                            |
| `last`     | Last element of array / last character   | `{$items\|last}`                             |

### Default values

The `default:` modifier returns a fallback when the variable is empty (undefined, null, or empty string):

```js
sluz.parse('{$name|default:"N/A"}');       // Scott (unchanged)
sluz.parse('{$zero|default:"123"}');       // 0 (zero is not empty)
sluz.parse('{$missing|default:"N/A"}');    // N/A
```

### Chained modifiers

```js
sluz.parse('{$name|upper|substr:0,2}');    // SC
```

### Custom modifiers

```js
sluz.registerModifier('greet', name => `Howdy, ${name}!`);
sluz.parse('{$name|greet}');               // Howdy, Scott!
```

---

## 🔢 Expressions & Math

Wrap any JavaScript expression in braces for evaluation:

```js
sluz.parse('{$count + 10}');               // 17
sluz.parse('{($count * 3) - 5}');          // 16
sluz.parse('{$count > 5}');                // true
```

---

## 🔀 Conditionals: `{if}` / `{elseif}` / `{else}` / `{/if}`

```js
sluz.parse('{if $admin}Welcome admin{/if}');
sluz.parse('{if $count > 5}Big{else}Small{/if}');
sluz.parse('{if $age < 21}Minor{elseif $age < 65}Adult{else}Senior{/if}');
```

Supports `&&`, `||`, `!`, parentheses, and comparison operators (`==`, `!=`, `<`, `>`, `<=`, `>=`).

---

## 🔄 Loops: `{foreach}` / `{/foreach}`

```js
// Simple iteration
{foreach $items as $x}{$x} {/foreach}

// Key/value iteration (index => value for arrays, key => value for objects)
{foreach $items as $idx => $x}[{$idx}]: {$x} {/foreach}

// Works with objects
{foreach $user as $key => $val}{$key}: {$val} {/foreach}
```

### Foreach magic variables

Available inside loops:

| Variable              | Description          |
|----------------------|----------------------|
| `$__FOREACH_FIRST`   | 1 on first iteration |
| `$__FOREACH_LAST`    | 1 on last iteration  |
| `$__FOREACH_INDEX`   | 0-based index        |

```js
{foreach $items as $x}
    {if $__FOREACH_FIRST}>>> {/if}
    {$x}
    {if $__FOREACH_LAST} <<<{/if}
{/foreach}
```

---

## 📄 Literal Blocks

`{literal}...{/literal}` bypasses template parsing, outputting content verbatim:

```js
sluz.parse('{literal}{$this} is {not} parsed{/literal}');
// {$this} is {not} parsed
```

---

## 💬 Comments

`{* ... *}` comments are stripped from output. Supports nesting:

```js
sluz.parse('before{* this is hidden *}after');   // beforeafter
{* {* nested *} *}                                 // (stripped)
```

---

## ⚠️ Error Handling

Syntax errors throw `SluzError` with a descriptive message and error code:

```js
import Sluz, { SluzError } from 'template-sluz';

try {
    sluz.parse('{foo');
} catch (e) {
    console.log(e.code);     // 45821
    console.log(e.message);  // Template::Sluz error #45821: Unclosed tag ...
}
```

| Error Code | Description                    |
|-----------|--------------------------------|
| `45821`   | Unclosed tag                   |
| `48724`   | Missing comment close `*}`     |
| `73467`   | Unknown block type             |
| `18933`   | Unknown tag / invalid eval     |
| `47204`   | Unknown modifier function      |
| `95320`   | If/else parsing error          |
