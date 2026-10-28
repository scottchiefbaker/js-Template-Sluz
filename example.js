#!/usr/bin/env node

import Sluz from './src/sluz.js';

const sluz = new Sluz();

sluz.assign('name', 'Scott');
sluz.assign('user', { first: 'Jason', last: 'Doolis', role: 'admin' });

console.log(sluz.parse('Hello {$name}!'));
console.log(sluz.parse('User: {$user.first} {$user.last} you are role "{$user.role}"'));
