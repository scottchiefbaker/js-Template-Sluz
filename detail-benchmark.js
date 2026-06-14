#!/usr/bin/env node

import Sluz from './src/sluz.js';

let ITERATIONS = 15000;
let filter = '';

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-f' || args[i] === '--filter') {
    filter = args[++i];
  } else if (args[i] === '-n' || args[i] === '--iterations') {
    ITERATIONS = parseInt(args[++i], 10);
  } else if (/^\d+$/.test(args[i])) {
    ITERATIONS = parseInt(args[i], 10);
  }
}

const sluz = new Sluz();
sluz.assign(getTplVars());
const templates = getTemplates();

const line = '-'.repeat(61);
console.log(padR('Benchmark', 30) + padL('Iters', 8) + padL('Millis', 10) + padL('Iter /s', 10));
console.log(line);

let totalTime = 0;

for (const [name, t] of Object.entries(templates)) {
  const tpl = t.tpl;
  const desc = t.desc;

  if (filter) {
    const re = new RegExp(filter, 'i');
    if (!re.test(name) && !re.test(desc)) continue;
  }

  for (let i = 0; i < 10; i++) {
    sluz.parse(tpl);
  }

  const start = Date.now();
  for (let i = 0; i < ITERATIONS; i++) {
    sluz.parse(tpl);
  }
  const elapsed = Date.now() - start;
  totalTime += elapsed;

  const perSec = elapsed > 0 ? (ITERATIONS * 1000) / elapsed : 0;

  console.log(
    padR(desc, 30) +
    padL(String(ITERATIONS), 8) +
    padL(String(elapsed), 10) +
    padL(perSec.toFixed(1), 10)
  );
}

console.log(line);
console.log(padR('TOTAL', 30) + padL('', 8) + padL(String(totalTime), 10));

function padR(s, len) {
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function padL(s, len) {
  s = String(s);
  return s.length >= len ? s : ' '.repeat(len - s.length) + s;
}

function getTplVars() {
  return {
    name: "Scott Baker",
    age: 42,
    email: 'scott@perturb.org',
    city: "Portland",
    state: "OR",
    active: 1,
    verified: 0,
    items: ['apple', 'banana', 'cherry', 'date', 'elderberry', 'fig', 'grape'],
    users: [
      { name: "Alice", age: 30, role: "admin" },
      { name: "Bob",   age: 25, role: "user" },
      { name: "Carol", age: 35, role: "mod" },
    ],
    config: {
      theme: "dark",
      lang: "en",
      per_page: 25,
    },
    empty_list: [],
    undef_var: null,
    big_list: Array.from({ length: 100 }, (_, i) => i + 1),
  };
}

function getTemplates() {
  return {
    variables_simple: {
      desc: "Simple variable output",
      tpl: 'Hello {$name}, you are {$age} years old.',
    },
    variables_dotted: {
      desc: "Dotted path variables",
      tpl: 'Theme: {$config.theme}, Lang: {$config.lang}, Per page: {$config.per_page}',
    },
    modifiers: {
      desc: "Variable modifiers",
      tpl: '{$name|upper} {$name|lower} {$name|ucfirst} {$name|substr:0,5}',
    },
    modifiers_chained: {
      desc: "Chained modifiers",
      tpl: '{$name|lower|ucfirst} {$name|upper|substr:0,5}',
    },
    modifiers_default: {
      desc: "Default modifier",
      tpl: '{$undef_var|default:"N/A"} {$name|default:"Unknown"}',
    },
    if_simple: {
      desc: "Simple if/else",
      tpl: '{if $active}ACTIVE{else}INACTIVE{/if}',
    },
    if_nested: {
      desc: "Nested if blocks",
      tpl: '{if $active}{if $verified}VERIFIED{else}UNVERIFIED{/if}{else}DISABLED{/if}',
    },
    if_elseif: {
      desc: "If/elseif/else chains",
      tpl: '{if $age > 50}SENIOR{elseif $age > 30}ADULT{elseif $age > 18}YOUNG{else}MINOR{/if}',
    },
    if_negated: {
      desc: "Negated conditions",
      tpl: '{if !$verified}NOT VERIFIED{/if}{if !$undef_var}IS UNDEF{/if}',
    },
    foreach_array: {
      desc: "Foreach over array",
      tpl: '{foreach $items as $item}[{$item}]{/foreach}',
    },
    foreach_array_with_index: {
      desc: "Foreach with index/first/last",
      tpl: '{foreach $items as $item}{$__FOREACH_INDEX}:{$item}{if $__FOREACH_LAST}!{/if} {/foreach}',
    },
    foreach_hash: {
      desc: "Foreach over hash",
      tpl: '{foreach $config as $k => $v}{$k}={$v} {/foreach}',
    },
    foreach_nested: {
      desc: "Nested foreach",
      tpl: '{foreach $users as $u}{foreach $items as $i}{if $i == "banana"}{$u.name}:{$i} {/if}{/foreach}{/foreach}',
    },
    foreach_empty: {
      desc: "Foreach over empty list",
      tpl: 'BEFORE{foreach $empty_list as $item}{$item}{/foreach}AFTER',
    },
    comments: {
      desc: "Comments (should be stripped)",
      tpl: '{* this is a comment *}Hello {$name}!',
    },
    literal: {
      desc: "Literal blocks",
      tpl: '{literal}function foo() { return {$x}; }{/literal}',
    },
    expression: {
      desc: "Expression/function blocks",
      tpl: 'Count: {$items|count} Joined: {$items|join:"-"}',
    },
    mixed: {
      desc: "Mixed template features",
      tpl: '<div class="user-list">\n'
        + '{* Display each user *}\n'
        + '{foreach $users as $u}\n'
        + '  <div class="user {if $u.role == "admin"}admin{else}regular{/if}">\n'
        + '    <span class="name">{$u.name|ucfirst}</span>\n'
        + '    <span class="age">({$u.age})</span>\n'
        + '    {if $u.age > 28}\n'
        + '      <span class="senior">Senior</span>\n'
        + '    {/if}\n'
        + '  </div>\n'
        + '{/foreach}\n'
        + '</div>',
    },
    foreach_large: {
      desc: "Large foreach (100 items)",
      tpl: '{foreach $big_list as $i}{$i} {/foreach}',
    },
  };
}