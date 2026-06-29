#!/usr/bin/env node

import Sluz from './src/sluz.js';

const sluz = new Sluz();

sluz.assign('name', 'Scott');
sluz.assign('items', ['apple', 'banana', 'cherry']);
sluz.assign('user', { first: 'Scott', last: 'Baker', age: 43 });
sluz.assign('count', 7);
sluz.assign('admin', true);

console.log('=== Variables & dotted access ===');
console.log(sluz.parse('Hello {$name}'));
console.log(sluz.parse('{$user.first} {$user.last}, age {$user.age}'));

console.log('\n=== Modifiers ===');
console.log(sluz.parse('{$name|upper}'));
console.log(sluz.parse('{$name|ucfirst}'));
console.log(sluz.parse('{$name|substr:0,3}'));
console.log(sluz.parse('{$items|join:", "}'));
console.log(sluz.parse('{$items|count} items'));

console.log('\n=== Chained modifiers ===');
console.log(sluz.parse('{$name|upper|substr:0,2}'));

console.log('\n=== Default values ===');
console.log(sluz.parse('{$missing|default:"N/A"}'));
console.log(sluz.parse('{$name|default:"N/A"}'));

console.log('\n=== Conditionals ===');
console.log(sluz.parse('{if $admin}Welcome admin{/if}'));
console.log(sluz.parse('{if $count > 5}Big number{else}Small number{/if}'));
console.log(sluz.parse('{if $user.age < 21}Minor{elseif $user.age < 65}Adult{else}Senior{/if}'));

console.log('\n=== Loops ===');
console.log(sluz.parse('{foreach $items as $x}{$x} {/foreach}'));
console.log(sluz.parse('{foreach $items as $i => $x}[{$i}]: {$x}\n{/foreach}'));

console.log('\n=== Magic foreach vars ===');
console.log(sluz.parse('{foreach $items as $x}{if $__FOREACH_FIRST}>>> {/if}{$x}{if $__FOREACH_LAST} <<<{/if} {/foreach}'));

console.log('\n=== Expressions & math ===');
console.log(sluz.parse('{$count + 10}'));
console.log(sluz.parse('{($count * 3) - 5}'));

console.log('\n=== Function calls ===');
sluz.registerModifier('greet', name => `Howdy, ${name}!`);
console.log(sluz.parse('{greet($name)}'));
console.log(sluz.parse('{$name|greet}'));

console.log('\n=== Literal blocks ===');
console.log(sluz.parse('{literal}{$this} is {not} parsed{/literal}'));

console.log('\n=== Comments ===');
console.log(sluz.parse('before{* this is hidden *}after'));
