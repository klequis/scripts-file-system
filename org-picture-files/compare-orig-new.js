#!/usr/bin/env node
// compare-orig-new.js — post-copy verification report
// Checks that everything from orig/ landed correctly in new/
'use strict';

const fs   = require('fs');
const path = require('path');

const MANIFEST    = path.join(__dirname, 'copy-manifest.csv');
const ORIG_ROOT   = '/run/media/carl/A1-2026-05/orig';
const NEW_ROOT    = '/run/media/carl/A1-2026-05/new';

// Directories copied directly (orig/<dir> → new/<dir>), not via manifest
const DIRECT_COPY_DIRS = [
  'Scanned Pictures',
  'dev-images',
  'daniel',
  '2022.sophie-slide-show',
  'of-daniel.tmp',
];

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.split('\n');
  const headers = lines[0].split(',');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
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

// ── Walk a directory tree, return all file paths ──────────────────────────────
function walkDir(dir) {
  const results = [];
  function walk(current) {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) results.push(full);
    }
  }
  walk(dir);
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log('=== compare-orig-new.js ===\n');

// ── 1. Manifest check ─────────────────────────────────────────────────────────
console.log('=== 1. Manifest file check ===');
const rows = parseCSV(fs.readFileSync(MANIFEST, 'utf8'));
console.log(`  Manifest rows: ${rows.length}`);

let manifestOk = 0, manifestMissing = 0, manifestSizeMismatch = 0, manifestPending = 0;
const missingRows = [], sizeMismatchRows = [];

for (const r of rows) {
  if (r.status === 'pending') { manifestPending++; continue; }
  if (r.status !== 'copied')  continue;

  try {
    const newStat  = fs.statSync(r.new_path);
    // size_bytes in manifest is derived from a rounded size_mb float (up to ~512 bytes error).
    // Compare against the actual source file size instead.
    let origSize = null;
    try { origSize = fs.statSync(r.orig_path).size; } catch { /* source unreadable */ }
    if (origSize !== null && newStat.size !== origSize) {
      manifestSizeMismatch++;
      sizeMismatchRows.push({ orig: r.orig_path, new: r.new_path, expected: origSize, actual: newStat.size });
    } else {
      manifestOk++;
    }
  } catch {
    manifestMissing++;
    missingRows.push(r.new_path);
  }
}

console.log(`  Copied + OK:         ${manifestOk}`);
console.log(`  Missing in new/:     ${manifestMissing}`);
console.log(`  Size mismatch:       ${manifestSizeMismatch}`);
console.log(`  Still pending:       ${manifestPending}`);

if (missingRows.length) {
  console.log('\n  MISSING files (first 20):');
  missingRows.slice(0, 20).forEach(p => console.log(`    ${p}`));
}
if (sizeMismatchRows.length) {
  console.log('\n  SIZE MISMATCH files (first 20):');
  sizeMismatchRows.slice(0, 20).forEach(r =>
    console.log(`    expected=${r.expected} actual=${r.actual}  ${r.new}`));
}
console.log();

// ── 2. Direct-copy dir check ──────────────────────────────────────────────────
console.log('=== 2. Direct-copy directory check ===');
for (const dir of DIRECT_COPY_DIRS) {
  const srcDir = path.join(ORIG_ROOT, dir);
  const dstDir = path.join(NEW_ROOT,  dir);

  const srcExists = fs.existsSync(srcDir);
  const dstExists = fs.existsSync(dstDir);

  if (!srcExists) { console.log(`  [SKIP]    ${dir}  (not found in orig/)`); continue; }
  if (!dstExists) { console.log(`  [MISSING] ${dir}  → not found in new/`); continue; }

  const srcFiles = walkDir(srcDir);
  const dstFiles = walkDir(dstDir);

  // Check every src file has a matching dst file (same relative path, same size)
  let ok = 0, missing = 0, sizeMismatch = 0;
  for (const srcPath of srcFiles) {
    const rel     = srcPath.slice(srcDir.length);
    const dstPath = dstDir + rel;
    try {
      const srcStat = fs.statSync(srcPath);
      const dstStat = fs.statSync(dstPath);
      if (srcStat.size !== dstStat.size) sizeMismatch++;
      else ok++;
    } catch {
      missing++;
    }
  }

  const extraInDst = dstFiles.length - srcFiles.length;
  const status = (missing === 0 && sizeMismatch === 0) ? '✓' : '✗';
  console.log(`  [${status}] ${dir}`);
  console.log(`       src files: ${srcFiles.length}   dst files: ${dstFiles.length}`);
  if (missing)      console.log(`       MISSING in dst:      ${missing}`);
  if (sizeMismatch) console.log(`       SIZE MISMATCH:       ${sizeMismatch}`);
  if (extraInDst > 0) console.log(`       extra in dst:        ${extraInDst}`);
}
console.log();

// ── 3. Total file count in new/ ───────────────────────────────────────────────
console.log('=== 3. Total files in new/ ===');
const allNewFiles = walkDir(NEW_ROOT);
console.log(`  Files in new/:  ${allNewFiles.length}`);

// Expected = manifest copied rows + all files in direct-copy dirs that exist
const copiedCount = rows.filter(r => r.status === 'copied').length;
let directCount = 0;
for (const dir of DIRECT_COPY_DIRS) {
  const dstDir = path.join(NEW_ROOT, dir);
  if (fs.existsSync(dstDir)) directCount += walkDir(dstDir).length;
}
console.log(`  Expected (copied + direct): ${copiedCount} + ${directCount} = ${copiedCount + directCount}`);
console.log();

// ── 4. Orphan check — files in new/ not accounted for ────────────────────────
console.log('=== 4. Orphan check (files in new/ not in manifest or direct-copy dirs) ===');
const manifestNewPaths = new Set(rows.filter(r => r.status === 'copied').map(r => r.new_path));
const directDstDirs    = DIRECT_COPY_DIRS.map(d => path.join(NEW_ROOT, d));

const orphans = allNewFiles.filter(f => {
  if (manifestNewPaths.has(f)) return false;
  if (directDstDirs.some(d => f.startsWith(d + path.sep) || f.startsWith(d + '/'))) return false;
  return true;
});

if (orphans.length === 0) {
  console.log('  None ✓');
} else {
  console.log(`  Orphan files: ${orphans.length} (first 20):`);
  orphans.slice(0, 20).forEach(f => console.log(`    ${f}`));
}
console.log();

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('=== Summary ===');
const totalIssues = manifestMissing + manifestSizeMismatch + orphans.length;
console.log(`  Manifest:    ${manifestOk} OK, ${manifestMissing} missing, ${manifestSizeMismatch} size mismatch, ${manifestPending} pending`);
console.log(`  Orphans:     ${orphans.length}`);
console.log(`  Total issues: ${totalIssues}`);
if (totalIssues === 0 && manifestPending === 0) console.log('  All good ✓');
