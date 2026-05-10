#!/usr/bin/env node
'use strict';

// trash-all-dups.js
// For every dup group: keep the first file, move all others to trash.
// Applies the same filters as server.js:
//   - only files under new/photos/, new/videos/, new/other/
//   - skip hash_confirmed=no
//   - skip files already missing from disk
//
// Usage:
//   node trash-all-dups.js          # dry run — prints what would move
//   node trash-all-dups.js --execute  # actually moves files

const fs   = require('fs');
const path = require('path');

const CSV_PATH     = process.argv.includes('--csv')
  ? process.argv[process.argv.indexOf('--csv') + 1]
  : path.join(__dirname, '../dedup-images/dupes-report.csv');
const DRY_RUN      = !process.argv.includes('--execute');
const DELETION_LOG = path.join(__dirname, 'deletion-log.txt');

const ALLOWED_SUBDIRS = new Set(['photos', 'videos', 'other']);

function isDeletable(fullPath) {
  const m = fullPath.match(/\/new\/([^/]+)\//);
  return m ? ALLOWED_SUBDIRS.has(m[1]) : false;
}

// ── CSV parsing ────────────────────────────────────────────────────────────────

function parseRow(line) {
  const fields = [];
  let inQ = false, cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else cur += c;
    } else {
      if (c === '"') { inQ = true; }
      else if (c === ',') { fields.push(cur); cur = ''; }
      else cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

function parseCSV(text) {
  const lines = text.trimEnd().split('\n');
  const header = parseRow(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseRow(lines[i]);
    const row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = vals[j] ?? '';
    rows.push(row);
  }
  return rows;
}

// ── Load & group ───────────────────────────────────────────────────────────────

console.log(`Loading ${CSV_PATH}...`);
const rows = parseCSV(fs.readFileSync(CSV_PATH, 'utf8'));

const groupMap = new Map();
let driveRoot = null;

for (const row of rows) {
  if (!isDeletable(row.full_path)) continue;
  if (row.hash_confirmed === 'no') continue;
  if (!fs.existsSync(row.full_path)) continue;

  if (!groupMap.has(row.group_id)) groupMap.set(row.group_id, []);
  groupMap.get(row.group_id).push(row);

  if (!driveRoot && row.full_path) {
    const m = row.full_path.match(/^(.+?)\/(new|orig)\//);
    if (m) driveRoot = m[1];
  }
}

if (!driveRoot) {
  console.error('ERROR: Could not determine drive root from CSV paths.');
  process.exit(1);
}

const TRASH_DIR = path.join(driveRoot, '_review_trash');
const groups    = [...groupMap.values()].filter(g => g.length > 1);

console.log(`  ${groups.length} groups with duplicates to process`);
console.log(`  Trash: ${TRASH_DIR}`);
if (DRY_RUN) console.log('\n  DRY RUN — pass --execute to actually move files\n');
else         console.log('\n  EXECUTING — files will be moved\n');

// ── Move dups ──────────────────────────────────────────────────────────────────

let moved = 0, skipped = 0, errors = 0;

for (const files of groups) {
  const [keep, ...dups] = files;
  console.log(`Group ${keep.group_id}: keep ${keep.full_path}`);

  for (const dup of dups) {
    const rel       = path.relative(driveRoot, dup.full_path);
    const trashPath = path.join(TRASH_DIR, rel);
    console.log(`  -> trash: ${dup.full_path}`);

    if (DRY_RUN) { moved++; continue; }

    try {
      fs.mkdirSync(path.dirname(trashPath), { recursive: true });
      fs.renameSync(dup.full_path, trashPath);
      const logLine = `${new Date().toISOString()}\t${dup.dup_file_id}\t${dup.full_path}\t->\t${trashPath}\n`;
      fs.appendFileSync(DELETION_LOG, logLine);
      moved++;
    } catch (e) {
      console.error(`  ERROR: ${e.message}`);
      errors++;
    }
  }
}

console.log(`\n=== Done ===`);
console.log(`  Moved:   ${moved}`);
console.log(`  Skipped: ${skipped}`);
if (errors) console.log(`  Errors:  ${errors}`);
if (DRY_RUN) console.log('\n  Re-run with --execute to apply.');
