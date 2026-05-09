#!/usr/bin/env node
// check-manifest.js — sanity-check copy-manifest.csv before running the copy
'use strict';

const fs   = require('fs');
const path = require('path');

const MANIFEST = path.join(__dirname, 'copy-manifest.csv');
const DEST_ROOT = '/run/media/carl/A1-2026-05/new';
const UNKNOWN_SAMPLE = 10;  // how many unknown/ rows to show
const COLLISION_SAMPLE = 20; // how many collision groups to show

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.split('\n');
  const headers = lines[0].split(',');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Handle quoted fields
    const fields = [];
    let cur = '', inQ = false;
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '"' && !inQ) { inQ = true; continue; }
      if (ch === '"' &&  inQ) { inQ = false; continue; }
      if (ch === ',' && !inQ) { fields.push(cur); cur = ''; continue; }
      cur += ch;
    }
    fields.push(cur);
    const row = {};
    headers.forEach((h, i) => row[h] = fields[i] ?? '');
    rows.push(row);
  }
  return rows;
}

// ── Load ──────────────────────────────────────────────────────────────────────
const rows = parseCSV(fs.readFileSync(MANIFEST, 'utf8'));
console.log(`Loaded ${rows.length} rows from ${MANIFEST}\n`);

let issues = 0;

// ── 1. Blank orig_path / new_path ─────────────────────────────────────────────
const blankOrig = rows.filter(r => !r.orig_path);
const blankNew  = rows.filter(r => !r.new_path);
console.log('=== Blank paths ===');
if (blankOrig.length === 0 && blankNew.length === 0) {
  console.log('  None ✓');
} else {
  if (blankOrig.length) { console.log(`  BLANK orig_path: ${blankOrig.length} rows`); issues += blankOrig.length; }
  if (blankNew.length)  { console.log(`  BLANK new_path:  ${blankNew.length} rows`);  issues += blankNew.length; }
}
console.log();

// ── 2. new_path prefix check ─────────────────────────────────────────────────
console.log('=== new_path prefix ===');
const badPrefix = rows.filter(r => r.new_path && !r.new_path.startsWith(DEST_ROOT));
if (badPrefix.length === 0) {
  console.log(`  All new_paths start with ${DEST_ROOT} ✓`);
} else {
  console.log(`  BAD PREFIX: ${badPrefix.length} rows`);
  badPrefix.slice(0, 5).forEach(r => console.log(`    ${r.new_path}`));
  issues += badPrefix.length;
}
console.log();

// ── 3. Category breakdown ─────────────────────────────────────────────────────
console.log('=== Category breakdown ===');
const cats = {};
for (const r of rows) {
  if (!r.new_path) continue;
  const rel = r.new_path.slice(DEST_ROOT.length + 1); // strip "new/"
  const cat = rel.split('/')[0];
  cats[cat] = (cats[cat] || 0) + 1;
}
for (const [cat, count] of Object.entries(cats).sort()) {
  console.log(`  ${cat.padEnd(10)} ${count}`);
}
console.log();

// ── 4. Collision groups ───────────────────────────────────────────────────────
console.log('=== Collision groups (files that got -1, -2, etc.) ===');
const collisions = rows.filter(r => /-\d+\.[^.]+$/.test(r.new_filename));
console.log(`  Total collision rows: ${collisions.length}`);

// Group by dest folder + base stem (strip trailing -N suffix)
const groups = new Map();
for (const r of collisions) {
  const dir = path.dirname(r.new_path);
  const stem = r.new_filename.replace(/-\d+(\.[^.]+)$/, '$1'); // strip -N suffix
  const key = dir + '/' + stem;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

let shown = 0;
for (const [key, members] of groups) {
  if (shown >= COLLISION_SAMPLE) break;
  console.log(`\n  dest: ${path.dirname(key)}`);
  // Also find the non-collided sibling (same new_filename without -N)
  const baseName = path.basename(key);
  const original = rows.find(r => r.new_filename === baseName && path.dirname(r.new_path) === path.dirname(key));
  if (original) console.log(`    [base]  orig=${original.orig_filename}  new=${original.new_filename}`);
  for (const m of members) {
    console.log(`    [coll]  orig=${m.orig_filename}  new=${m.new_filename}`);
  }
  shown++;
}
if (groups.size > COLLISION_SAMPLE) {
  console.log(`\n  ... and ${groups.size - COLLISION_SAMPLE} more groups (showing first ${COLLISION_SAMPLE})`);
}
console.log();

// ── 5. unknown/ sample ───────────────────────────────────────────────────────
console.log('=== unknown/ destination sample ===');
const unknowns = rows.filter(r => r.new_path && r.new_path.includes('/unknown/'));
console.log(`  Total: ${unknowns.length}`);
console.log(`  Sample (first ${Math.min(UNKNOWN_SAMPLE, unknowns.length)}):`);
unknowns.slice(0, UNKNOWN_SAMPLE).forEach(r => {
  console.log(`    orig=${r.orig_path}`);
  console.log(`     new=${r.new_path}`);
});
console.log();

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('=== Summary ===');
console.log(`  Total rows:  ${rows.length}`);
console.log(`  Issues found: ${issues}`);
if (issues === 0) console.log('  Manifest looks clean ✓');
