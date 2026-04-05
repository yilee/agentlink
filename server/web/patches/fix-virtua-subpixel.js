#!/usr/bin/env node
/**
 * Patch virtua to round item position offsets to integers.
 *
 * virtua uses `position: absolute; top: <offset>px` for each virtual-list item.
 * The offset is a cumulative sum of ResizeObserver-measured heights — often a
 * float like 347.5px. Sub-pixel top values cause inconsistent font rasterization
 * on iOS Safari (some items look bolder/rougher than others).
 *
 * This patch rounds the offset to the nearest integer pixel.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'node_modules', 'virtua', 'lib', 'vue', 'index.js');

if (!fs.existsSync(file)) {
  console.log('[patch] virtua vue/index.js not found, skipping');
  process.exit(0);
}

let src = fs.readFileSync(file, 'utf8');

const before = '[r ? "left" : "top"]: c.value + "px"';
const after  = '[r ? "left" : "top"]: Math.round(c.value) + "px"';

if (src.includes(after)) {
  console.log('[patch] virtua already patched');
  process.exit(0);
}

if (!src.includes(before)) {
  console.warn('[patch] virtua source pattern not found — version may have changed');
  process.exit(0);
}

src = src.replace(before, after);
fs.writeFileSync(file, src, 'utf8');
console.log('[patch] virtua sub-pixel offset fix applied');
