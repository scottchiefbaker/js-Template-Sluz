import { describe, test, expect } from 'vitest';
import Sluz from '../src/sluz.js';

// -------------------------------------------------------------------
// Setup
// -------------------------------------------------------------------
const sluz = new Sluz();
sluz.assign('x', 7);
sluz.assign('y', [2, 4, 6]);
sluz.assign('key', 'val');
sluz.assign('first', 'Scott');
sluz.assign('last', 'Baker');
sluz.assign('animal', 'Kitten');
sluz.assign('word', 'cRaZy');
sluz.assign('debug', 1);
sluz.assign('array', ['one', 'two', 'three']);
sluz.assign('cust', { first: 'Scott', last: 'Baker' });
sluz.assign('number', 15);
sluz.assign('zero', 0);
sluz.assign('members', [{ first: 'Scott', last: 'Baker' }, { first: 'Jason', last: 'Doolis' }]);
sluz.assign('subarr', { one: [2, 4, 6], two: [3, 6, 9] });
sluz.assign('arrayd', [[1, 2], [3, 4], [5, 6]]);
sluz.assign('empty', []);
sluz.assign('empty_string', '');
sluz.assign('null', null);
sluz.assign('true', 1);
sluz.assign('false', 0);
sluz.assign('conf', { main: 1, debug: 0 });
sluz.assign({ color: 'yellow', age: 43, book: 'Dark Tower' });

// Register test helper functions (matching Perl test's main:: injections)
sluz.registerModifier('truncate', (s, n) => String(s).slice(0, n));
sluz.registerModifier('join_comma', (arr, sep = ', ') => Array.prototype.join.call(arr, sep));
sluz.registerModifier('hello_world', () => 'Hello world');
sluz.registerModifier('return_false', () => 0);
sluz.registerModifier('return_null', () => undefined);

// -------------------------------------------------------------------
// Test helpers
// -------------------------------------------------------------------
function sluzTest(input, expected, name) {
  test(name, () => {
    const got = sluz.parse(input);
    if (expected.startsWith('/') && expected.endsWith('/')) {
      const pat = expected.slice(1, -1);
      expect(got).toMatch(new RegExp(pat));
    } else {
      expect(String(got)).toBe(expected);
    }
  });
}

// -------------------------------------------------------------------
// Basic tests
// -------------------------------------------------------------------
sluzTest('Hello there'       , 'Hello there', 'Basic #1 - Static string');
sluzTest('{$first}'          , 'Scott'      , 'Basic #2 - Basic variable');
sluzTest('{$bogus_var}'      , ''           , 'Basic #3 - Missing variable');
sluzTest('{$cust.first}'     , 'Scott'      , 'Basic #5 - Hash Lookup');
sluzTest('{$array.1}'        , 'two'        , 'Basic #6 - Array Lookup');
sluzTest('{$array|count}'    , '3'          , 'Basic #7 - PHP Modifier array');
sluzTest('{$number + 3}'     , '18'         , 'Basic #8 - Addition');
sluzTest('{$number * $debug}', '15'         , 'Basic #9 - Multiplication of two vars');
sluzTest('{3}'               , '3'          , 'Basic #10 - Number literal');
sluzTest('{"Scott"}'         , 'Scott'      , 'Basic #11 - String literal');
sluzTest('{$x}'              , '7'          , 'Basic #12 - Single Character variable');

//test.skip('Basic #13 - Array Lookup - PHP Syntax (PHP bracket syntax)', () => {});
//test.skip('Basic #14 - Hash Lookup - PHP Syntax (PHP bracket syntax)', () => {});

// Default values
sluzTest('{$last|default:\'123\'}'        , 'Baker', 'Basic #15 - Default - Not Used');
sluzTest('{$zero|default:\'123\'}'        , '0'    , 'Basic #16 - Default - Zero Not Used');
sluzTest('{$empty_string|default:\'123\'}', '123'  , 'Basic #17 - Default - Empty String');
sluzTest('{$null|default:\'123\'}'        , '123'  , 'Basic #18 - Default - Null');
sluzTest('{$bogus_var|default:"?*%.|"}'   , '?*%.|', 'Basic #19 - Default - non word char');

// Error tests
test('Basic #20 - Unclosed block', () => {
  expect(() => sluz.parse('{foo')).toThrow(/45821/);
});

test('Basic #21 - Unclosed block variable', () => {
  expect(() => sluz.parse('{$first')).toThrow(/45821/);
});

// Hash with default
sluzTest('{$cust.first|default:\'Jason\'}', 'Scott', 'Basic #22 - Hash with default value, not used');
sluzTest('{$cust.foo|default:\'Jason\'}', 'Jason', 'Basic #23 - Hash with default value, used');
sluzTest('{$array}', 'ARRAY', 'Basic #24 - Array used as a scalar');
sluzTest('{$first|substr:2}', 'ott', 'Basic #26 - PHP function with one param');
sluzTest('{$first|substr:2,2}', 'ot', 'Basic #27 - PHP function with two params');
sluzTest('{if !$cust.age}unknown{else}{$age}{/if}', 'unknown'    , 'Basic #28 - Negated hash lookup');

test('Basic #29 - Simple math that returns floating point', () => {
  const got = sluz.parse('{1.1234 + 2.3456}');
  expect(parseFloat(got)).toBeCloseTo(3.469, 3);
});

// -------------------------------------------------------------------
// Custom/User functions
// -------------------------------------------------------------------
sluzTest('{$word|truncate:3}', 'cRa', 'Custom function #1 - Modifier with param');
sluzTest('{$last|truncate:4|truncate:2}', 'Ba', 'Custom function #2 - Two modifiers with params');
sluzTest('{$y|join_comma}', '2, 4, 6', 'Custom function #3 - Function with default param');
sluzTest('{$y|join_comma:9}' , '29496', 'Custom function #4 - Function with integer param');
sluzTest('{$y|join_comma:"*"}', '2*4*6', 'Custom function #5 - Function with string param');
sluzTest('{$y|join_comma:"|"}', '2|4|6', 'Custom function #6 - Function with string param pipe');
sluzTest('{$y|join_comma:","}', '2,4,6', 'Custom function #7 - Function with string param pipe comma');
sluzTest('{$y|join_comma:"\'"}', "2'4'6", 'Custom function #8 - Function with string param pipe single quote');
sluzTest('{$y|join_comma:"; "}', "2; 4; 6", 'Custom function #9 - Function with string param and space');
sluzTest("{\$y|join_comma:\"\t\"}", "2\t4\t6", 'Custom function #10 - Function with string param and tab');

// -------------------------------------------------------------------
// Function blocks
// -------------------------------------------------------------------
sluzTest('{hello_world()}', 'Hello world', 'Function #1 - Hello world');

test('Function #2 - Return false', () => {
  expect(String(sluz.parse('{return_false()}'))).toBe('0');
});

test('Function #3 - Return null', () => {
  expect(() => sluz.parse('{return_null()}')).toThrow(/18933/);
});

// -------------------------------------------------------------------
// Error blocks
// -------------------------------------------------------------------
test('Error #1 - bare string', () => {
  expect(() => sluz.parse('{junk}')).toThrow(/73467/);
});

test('Error #2 - string with action char', () => {
  expect(() => sluz.parse('{junk(')).toThrow(/45821/);
});

test('Error #3 - syntax error', () => {
  expect(() => sluz.parse('{$number + array}')).toThrow(/18933/);
});

test('Error #4 - syntax error', () => {
  expect(() => sluz.parse('{if debug}')).toThrow(/73467/);
});

// -------------------------------------------------------------------
// If tests
// -------------------------------------------------------------------
sluzTest('{if $debug}DEBUG{/if}'                                , 'DEBUG'   , 'If #1 - Simple');
sluzTest('{if $bogus_var}DEBUG{/if}'                            , ''        , 'If #2 - Missing var');
sluzTest('{if $debug}{$first}{/if}'                             , 'Scott'   , 'If #3 - Variable as payload');
sluzTest('{if $debug}{if $debug}FOO{/if}{/if}'                  , 'FOO'     , 'If #4 - Nested');
sluzTest('{if $x}{if $null}yes{else}no{/if}{/if}'               , 'no'      , 'If #5 - Nested with else');
sluzTest('{if $one}{if $name}Yes{else}No{/if}{else}Unknown{/if}', 'Unknown' , 'If #6 - Nested with two elses');
sluzTest('{if $bogus_var}YES{else}NO{/if}'                      , 'NO'      , 'If #7 - Else');
sluzTest('{if $cust.first}{$cust.first}{/if}'                   , 'Scott'   , 'If #8 - Hash lookup');
sluzTest('{if $number > 10}GREATER{/if}'                        , 'GREATER' , 'If #9 - Comparison');
sluzTest('{if $bogus_var || $key}KEY{/if}'                      , 'KEY'     , 'If #10 - ||');
sluzTest('{if $number == 15 && $debug}YES{/if}'                 , 'YES'     , 'If #11 - Two comparisons');
sluzTest('{if !$verbose}QUIET{/if}'                             , 'QUIET'   , 'If #12 - Negated comparison');
sluzTest('{if ($zero || $number > 10)}YES{/if}'                 , 'YES'     , 'If #13 - Parens');
sluzTest('{if count($array) > 2}YES{/if}'                       , 'YES'     , 'If #14 - PHP function conditional');
sluzTest('{if $debug}{$key}{$last}{/if}'                        , 'valBaker', 'If #15 - Two block payload');
sluzTest('{if $debug}ONE{else}TWO{/if}'                         , 'ONE'     , 'If #16 - Else not needed');
sluzTest('{if $zero}1{elseif $debug}2{else}3{/if}'              , '2'       , 'If #17 - Elseif');
sluzTest('{if $key}{if $one}one{elseif $x}X{else}ELSE{/if}{/if}', 'X'       , 'If #18 - Nested if with elseif');
sluzTest('{if $number}1{if $key}2{/if}3{/if}'                   , '123'     , 'If #19 - Nested if leading/trailing chars');
sluzTest('{if $true}123{else}456{/if}'                          , '123'     , 'If #20 - Boolean');
sluzTest('{if !$true}123{else}456{/if}'                         , '456'     , 'If #21 - Boolean inverted');
sluzTest('{if $conf.main}123{else}456{/if}'                     , '123'     , 'If #22 - Hash boolean');
sluzTest('{if !$conf.main}123{else}456{/if}'                    , '456'     , 'If #23 - Hash boolean inverted');
sluzTest('{if $x}{if $y}yes{/if}{else}no{/if}'                  , 'yes'     , 'If #24 - Nested if with an else');
sluzTest('{if true}a{else}b{if true}c{/if}{/if}'                , 'a'       , 'If #25 - Nested with true');
sluzTest('{if false}a{else}b{if true}c{/if}{/if}'               , 'bc'      , 'If #26 - Nested with false');
sluzTest('{if true}{/if}'                                       , ''        , 'If #27 - If with "" for payload');

// -------------------------------------------------------------------
// Foreach tests
// -------------------------------------------------------------------
sluzTest('{foreach $array as $num}{$num}{/foreach}'                         , 'onetwothree'      , 'Foreach #1 - Simple');
sluzTest("{foreach \$array as \$num}\n{\$num}\n{/foreach}"                  , "one\ntwo\nthree\n", 'Foreach #2 - Simple with whitespace');
sluzTest('{foreach $members as $x}{$x.first}{/foreach}'                     , 'ScottJason'       , 'Foreach #3 - Hash');
sluzTest('{foreach $arrayd as $x}{$x.1}{/foreach}'                          , '246'              , 'Foreach #4 - Array');
sluzTest('{foreach $arrayd as $key => $val}{$key}:{$val.0}{/foreach}'       , '0:11:32:5'        , 'Foreach #6 - Key/val array');
sluzTest('{foreach $members as $id => $x}{$id}{$x.first}{/foreach}'         , '0Scott1Jason'     , 'Foreach #7 - Key/val hash');
sluzTest('{foreach $subarr.one as $id}{$id}{/foreach}'                      , '246'              , 'Foreach #8 - Hash key');
sluzTest('{foreach $bogus_var as $x}one{/foreach}'                          , ''                 , 'Foreach #9 - Missing var');
sluzTest('{foreach $empty as $x}one{/foreach}'                              , ''                 , 'Foreach #10 - Empty array');
sluzTest('{foreach $array as $i => $x}{$i}{$x}{/foreach}'                   , '0one1two2three'   , 'Foreach #11 - One char variables');
sluzTest('{foreach $array as $i => $x}{if $x}{$x}{/if}{/foreach}'           , 'onetwothree'      , 'Foreach #12 - Foreach with nested if');
sluzTest('{foreach $arrayd as $i => $x}{if $x.1}{$x.1}{/if}{/foreach}'      , '246'              , 'Foreach #13 - Foreach with nested if (array)');
sluzTest('{foreach $null as $x}one{/foreach}'                               , ''                 , 'Foreach #14 - Null');
sluzTest('{foreach $first as $x}{$first}{/foreach}'                         , 'Scott'            , 'Foreach #15 - Scalar');
sluzTest('{foreach $array as $i}{foreach $array as $i}x{/foreach}{/foreach}', 'xxxxxxxxx'        , 'Foreach #16 - Nested');

// Foreach variable persistence tests
sluzTest('{$x}', '7', 'Foreach #17 - NOT overwrite variable - previously set');
sluzTest('{$i}', '' , 'Foreach #18 - NOT overwrite variable - no initial value');

sluzTest('{foreach $y as $z}{$z}{/foreach}'                                   , '246'             , 'Foreach #19 - Foreach one char key');
sluzTest('{foreach $array as $x}{if $__FOREACH_FIRST}FIRST{/if}{$x}{/foreach}', 'FIRSTonetwothree', 'Foreach #20 - Foreach FIRST item');
sluzTest('{foreach $array as $x}{$x}{if $__FOREACH_LAST}LAST{/if}{/foreach}'  , 'onetwothreeLAST' , 'Foreach #21 - Foreach LAST item');
sluzTest('{foreach $array as $x}{$x}{$__FOREACH_INDEX}{/foreach}'             , 'one0two1three2'  , 'Foreach #22 - Foreach index');

// -------------------------------------------------------------------
// Plain text tests
// -------------------------------------------------------------------
sluzTest('Scott'                      , 'Scott'                      , 'Plain text #1 - Static text');
sluzTest('<div>Scott</div>'           , '<div>Scott</div>'           , 'Plain text #2 - HTML');
sluzTest('function foo() { return 3 }', 'function foo() { return 3 }', 'Plain text #3 - Function definition');

// -------------------------------------------------------------------
// Bad block tests
// -------------------------------------------------------------------
sluzTest(' {$first} ', ' Scott ', 'Bad block #1 - Padding with whitespace');

test('Bad block #2 - {word}', () => {
  expect(() => sluz.parse('{first}')).toThrow(/73467/);
});

// -------------------------------------------------------------------
// Literal tests
// -------------------------------------------------------------------
sluzTest('{literal}{{/literal}'                  , '{'                  , 'Literal #1 - {');
sluzTest('{literal}}{/literal}'                  , '}'                  , 'Literal #2 - }');
sluzTest('{literal}{}{/literal}'                 , '{}'                 , 'Literal #3 - Literal + {}');
sluzTest('{literal}{foreach}{/literal}'          , '{foreach}'          , 'Literal #4 - {literal}');
sluzTest('{literal}{literal}{/literal}{/literal}', '{literal}{/literal}', 'Literal #5 - Meta literal');
sluzTest(' { '                                   , ' { '                , 'Literal #6 - { with whitespace');
sluzTest('{}'                                    , '{}'                 , 'Literal #7 - Raw {}');

// -------------------------------------------------------------------
// Whitespace-padded brackets tests
// -------------------------------------------------------------------
sluzTest('{ foo }'        , '{ foo }'        , 'Whitespace-padded #1 - Simple text');
sluzTest('{  bar  }'      , '{  bar  }'      , 'Whitespace-padded #2 - Multiple spaces');
sluzTest('{ hello world }', '{ hello world }', 'Whitespace-padded #3 - Multiple words');
sluzTest('{ (1+2) }'      , '3'              , 'Whitespace-padded #4 - Expression with parens');
sluzTest('{ 1 + 2 }'      , '3'              , 'Whitespace-padded #5 - Expression with number');
sluzTest('{ $x }'         , '7'              , 'Whitespace-padded #6 - Variable');
sluzTest('{ "hello" }'    , 'hello'          , 'Whitespace-padded #7 - String literal');
sluzTest('{ $x + 1 }'     , '8'              , 'Whitespace-padded #8 - Expression with variable');

// -------------------------------------------------------------------
// Whitespace input/output
// -------------------------------------------------------------------
sluzTest("{$x}{$x}"                                     , '77'                 , 'Whitespace input/output #1');
sluzTest("{$x} {$x}"                                    , '7 7'                , 'Whitespace input/output #2');
sluzTest("{$x}\n{$x}"                                   , "7\n7"               , 'Whitespace input/output #3');
sluzTest("{foreach \$y as \$x}{\$x}{/foreach}"          , '246'                , 'Whitespace input/output #4');
sluzTest("{foreach \$y as \$x}\n{\$x}\n{/foreach}"      , "2\n4\n6\n"          , 'Whitespace input/output #5');
sluzTest("{if \$x}{\$x}{/if}"                           , '7'                  , 'Whitespace input/output #6');
sluzTest("{if \$x}\n{\$x}\n{/if}"                       , "7\n"                , 'Whitespace input/output #7');
sluzTest("{foreach \$y as \$x}\n{\$x}\n{/foreach}\nlast", "2\n4\n6\nlast"      , 'Whitespace input/output #8');
sluzTest("{foreach \$array as \$x}{\$x} {/foreach}\nEND", "one two three \nEND", 'Whitespace input/output #9');

// -------------------------------------------------------------------
// Comment tests
// -------------------------------------------------------------------
sluzTest('{* Comment *}'           , '', 'Comment #1 - With text');
sluzTest('{* ********* *}'         , '', 'Comment #2 - ******');
sluzTest('{**}'                    , '', 'Comment #3 - No whitespace');
sluzTest('{*{$array|count}*}'      , '', 'Comment #4 - Variable inside');
sluzTest('{* {* nested *} *}'      , '', 'Comment #5 - Nested');
sluzTest('{* {* {* nested *} *} *}', '', 'Comment #6 - Triple Nested');

// -------------------------------------------------------------------
// Built-in modifier tests
// -------------------------------------------------------------------
sluzTest('{$word|upper}'                   , 'CRAZY', 'Built-in modifier #1 - upper');
sluzTest('{$word|lower}'                   , 'crazy', 'Built-in modifier #2 - lower');
sluzTest('{$word|ucfirst}'                 , 'CRaZy', 'Built-in modifier #3 - ucfirst');
sluzTest('{$first|trim}'                   , 'Scott', 'Built-in modifier #4 - trim');
sluzTest('{$first|replace:"Scott","Jason"}', 'Jason', 'Built-in modifier #5 - replace');
sluzTest('{$first|length}'                 , '5'    , 'Built-in modifier #6 - length');
sluzTest('{$y|join:"-"}'                   , '2-4-6', 'Built-in modifier #7 - join');
sluzTest('{$array|first}'                  , 'one'  , 'Built-in modifier #8 - first (array)');
sluzTest('{$array|last}'                   , 'three', 'Built-in modifier #9 - last (array)');
sluzTest('{$first|first}'                  , 'S'    , 'Built-in modifier #10 - first (string)');
sluzTest('{$first|last}'                   , 't'    , 'Built-in modifier #11 - last (string)');

// -------------------------------------------------------------------
// Error code tests
// -------------------------------------------------------------------
test('Error code #1 - 48724 unclosed comment', () => {
  expect(() => sluz.parse('{* unclosed')).toThrow(/48724/);
});

test('Error code #2 - 47204 unknown modifier', () => {
  expect(() => sluz.parse('{$word|uppr}')).toThrow(/47204/);
});

// -------------------------------------------------------------------
// Foreach over plain objects
// -------------------------------------------------------------------
sluz.assign('obj', { a: 1, b: 2, c: 3 });

sluzTest('{foreach $obj as $k => $v}{$k}:{$v} {/foreach}'                                                       , 'a:1 b:2 c:3 ' , 'Foreach object #1 - Key/value iteration');
sluzTest('{foreach $obj as $v}{$v} {/foreach}'                                                                  , '1 2 3 '       , 'Foreach object #2 - Value only');
sluzTest('{foreach $obj as $k => $v}{if $__FOREACH_FIRST}first{/if}{$k}{if $__FOREACH_LAST} last{/if}{/foreach}', 'firstabc last', 'Foreach object #3 - Magic variables');

// -------------------------------------------------------------------
// Deep variable access
// -------------------------------------------------------------------
sluzTest('{$members.0.first}'      , 'Scott' , 'Deep access #1 - Array index then hash key');
sluzTest('{$members.1.last}'       , 'Doolis', 'Deep access #2 - Array index then hash key (second element)');
sluzTest('{$cust.nonexistent.deep}', ''      , 'Deep access #3 - Missing intermediate key');
sluzTest('{$array.99}'             , ''      , 'Deep access #4 - Array index out of bounds');
sluzTest('{$first.nonexistent}'    , ''      , 'Deep access #5 - Property on scalar');

// -------------------------------------------------------------------
// Modifier edge cases
// -------------------------------------------------------------------
sluz.assign('offset', 2);

sluzTest('{$first|substr:$offset}' , 'ott', 'Modifier edge #1 - Variable as argument');
sluzTest('{$word|upper|truncate:3}', 'CRA', 'Modifier edge #2 - Chained built-in + custom');
sluzTest('{$null|default:"hi"}'    , 'hi' , 'Modifier edge #3 - Default with null');
sluzTest('{$cust|count}'           , '2'  , 'Modifier edge #4 - Count on object');
sluzTest('{$first|count}'          , '1'  , 'Modifier edge #5 - Count on scalar');
sluzTest('{$null|count}'           , '1'  , 'Modifier edge #6 - Count on null (converted to empty string)');
sluzTest('{$empty|count}'          , '0'  , 'Modifier edge #7 - Count on empty array');

// -------------------------------------------------------------------
// Comparison operators
// -------------------------------------------------------------------
sluzTest('{$x < 10}', 'true' , 'Comparison #1 - Less than');
sluzTest('{$x <= 7}', 'true' , 'Comparison #2 - Less than or equal');
sluzTest('{$x >= 7}', 'true' , 'Comparison #3 - Greater than or equal');
sluzTest('{$x != 5}', 'true' , 'Comparison #4 - Not equal');
sluzTest('{$x > 10}', 'false', 'Comparison #5 - Greater than (false)');

// -------------------------------------------------------------------
// 3-level mixed block nesting
// -------------------------------------------------------------------
sluzTest('{if $debug}{foreach $array as $x}{if $x}{$x}{/if}{/foreach}{/if}', 'onetwothree', 'Mixed nesting #1 - if > foreach > if');
sluzTest('{foreach $array as $x}{if $x}{if $__FOREACH_FIRST}[{$x}]{else}{$x}{/if}{/if}{/foreach}', '[one]twothree', 'Mixed nesting #2 - foreach > if > if');

// -------------------------------------------------------------------
// === softened to ==
// -------------------------------------------------------------------
sluzTest('{1 === 1}', 'true', 'Strict equality #1 - === softened to ==');
sluzTest('{1 == 1}', 'true', 'Strict equality #2 - == works normally');

// -------------------------------------------------------------------
// _isNothing edge cases
// -------------------------------------------------------------------
sluzTest('{if $empty}yes{else}no{/if}', 'yes', 'isNothing #1 - Empty array is truthy in if');
sluzTest('{if $false}yes{else}no{/if}', 'no' , 'isNothing #2 - Zero is not nothing');
sluzTest('{$empty|count}'             , '0'  , 'isNothing #3 - Empty array count');

// -------------------------------------------------------------------
// registerModifier overriding built-ins
// -------------------------------------------------------------------
test('Override built-in #1 - Custom upper replaces built-in', () => {
  sluz.registerModifier('upper', s => `CUSTOM:${s}`);
  expect(sluz.parse('{$first|upper}')).toBe('CUSTOM:Scott');
  sluz.registerModifier('upper', s => String(s).toUpperCase());
});

// -------------------------------------------------------------------
// assign() edge cases
// -------------------------------------------------------------------
sluz.assign('overwrite_test', 'original');
sluz.assign('overwrite_test', 'replaced');
sluzTest('{$overwrite_test}', 'replaced', 'Assign overwrite #1 - Reassign same key');

sluz.assign({ batch_a: 'A', batch_b: 'B' });
sluzTest('{$batch_a}-{$batch_b}', 'A-B', 'Assign batch #1 - Batch assign multiple keys');

// -------------------------------------------------------------------
// Expression edge cases
// -------------------------------------------------------------------
sluzTest('{-5 + 10}', '5'       , 'Expression #1 - Negative number');
sluzTest('{10 / 3}' , '/3\\.33/', 'Expression #2 - Division');
sluzTest('{10 % 3}' , '1'       , 'Expression #3 - Modulo');

