#!/usr/bin/env node
'use strict';

// find-dupes.js — Read new-files.csv and report likely duplicates
// Usage: node find-dupes.js [input.csv] [output.csv]
// No files are read from disk — all analysis is done from the CSV.

const fs   = require('fs');
const path = require('path');

const INPUT  = process.argv[2] || 'new-files.csv';
const OUTPUT = process.argv[3] || 'dupes-report.csv';

const SIZE_THRESHOLD_MEDIUM = 20 * 1024 * 1024; // 20 MB

// Collision-renamed: DSC_1234.2.NEF → groups with DSC_1234.NEF
const COLLISION_RE = /^(.+?)\.(\d+)(\.[^.]+)$/i;

// ── CSV parsing ────────────────────────────────────────────────────────────────

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

// ── Main ───────────────────────────────────────────────────────────────────────

function main() {
  const rows = parseCSV(fs.readFileSync(INPUT, 'utf8'));
  console.log(`Loaded ${rows.length} rows from ${INPUT}`);

  const groups = [];
  let groupId = 0;

  function addGroup(files, confidence, signal) {
    if (files.length < 2) return;
    groupId++;
    groups.push({ group_id: groupId, confidence, signal, files });
  }

  // ── 1. Very high: same exif date+time + exact filename + same size_bytes ────
  const vhMap = new Map();
  for (const row of rows) {
    if (!row.exif_date || !row.exif_time) continue;
    const key = `${row.exif_date}T${row.exif_time}::${row.file_name}::${row.size_bytes}`;
    if (!vhMap.has(key)) vhMap.set(key, []);
    vhMap.get(key).push(row);
  }
  const vhMatched = new Set();
  for (const [, files] of vhMap) {
    if (files.length >= 2) {
      addGroup(files, 'very-high', 'same exif date+time + filename + size');
      for (const f of files) vhMatched.add(f.full_path);
    }
  }

  // ── 2. High: same exif date+time + same size_bytes ──────────────────────────
  const exifSizeMap = new Map();
  for (const row of rows) {
    if (!row.exif_date || !row.exif_time) continue;
    const key = `${row.exif_date}T${row.exif_time}::${row.size_bytes}`;
    if (!exifSizeMap.has(key)) exifSizeMap.set(key, []);
    exifSizeMap.get(key).push(row);
  }
  const exifMatched = new Set(vhMatched);
  for (const [, files] of exifSizeMap) {
    if (files.length < 2) continue;
    const uncovered = files.filter(f => !vhMatched.has(f.full_path));
    if (uncovered.length >= 2) {
      addGroup(files, 'high', 'same exif date+time + size');
      for (const f of files) exifMatched.add(f.full_path);
    }
  }

  // ── 3. High: exact filename + same size_bytes, different folder ──────────────
  const nameMap = new Map();
  for (const row of rows) {
    const key = `${row.file_name}::${row.size_bytes}`;
    if (!nameMap.has(key)) nameMap.set(key, []);
    nameMap.get(key).push(row);
  }
  const nameMatched = new Set();
  for (const [, files] of nameMap) {
    if (files.length < 2) continue;
    const dirs = new Set(files.map(f => path.dirname(f.full_path)));
    if (dirs.size < 2) continue;
    const uncovered = files.filter(f => !exifMatched.has(f.full_path));
    if (uncovered.length >= 2) {
      addGroup(files, 'high', 'exact filename + size, different folder');
      for (const f of files) nameMatched.add(f.full_path);
    }
  }

  // ── 4. High: collision-renamed pairs (DSC_1234.NEF ↔ DSC_1234.2.NEF) ────────
  // Normalize each file_name to its base (strip .N. collision suffix) and group
  const collisionBaseMap = new Map();
  for (const row of rows) {
    const m = row.file_name.match(COLLISION_RE);
    const normalizedName = m ? `${m[1]}${m[3]}` : row.file_name;
    if (!collisionBaseMap.has(normalizedName)) collisionBaseMap.set(normalizedName, []);
    collisionBaseMap.get(normalizedName).push(row);
  }
  const collisionMatched = new Set();
  for (const [baseName, files] of collisionBaseMap) {
    if (files.length < 2) continue;
    const hasOrig      = files.some(f => f.file_name === baseName);
    const hasCollision = files.some(f => COLLISION_RE.test(f.file_name));
    if (!hasOrig || !hasCollision) continue;
    // Sub-group by size_bytes — only same-size pairs are candidates
    const sizeGroups = new Map();
    for (const f of files) {
      if (!sizeGroups.has(f.size_bytes)) sizeGroups.set(f.size_bytes, []);
      sizeGroups.get(f.size_bytes).push(f);
    }
    for (const [, sg] of sizeGroups) {
      if (sg.length < 2) continue;
      const uncovered = sg.filter(f => !collisionMatched.has(f.full_path));
      if (uncovered.length >= 2) {
        addGroup(sg, 'high', 'collision-renamed pair');
        for (const f of sg) collisionMatched.add(f.full_path);
      }
    }
  }

  // ── 5. Medium: same size_bytes only, large files (>20 MB) ───────────────────
  const allMatched = new Set([...vhMatched, ...exifMatched, ...nameMatched, ...collisionMatched]);
  const sizeMap = new Map();
  for (const row of rows) {
    if (parseInt(row.size_bytes, 10) <= SIZE_THRESHOLD_MEDIUM) continue;
    if (!sizeMap.has(row.size_bytes)) sizeMap.set(row.size_bytes, []);
    sizeMap.get(row.size_bytes).push(row);
  }
  for (const [, files] of sizeMap) {
    if (files.length < 2) continue;
    const uncovered = files.filter(f => !allMatched.has(f.full_path));
    if (uncovered.length >= 2) {
      addGroup(uncovered, 'medium', 'same size only (>20 MB)');
    }
  }

  // ── Write output CSV ──────────────────────────────────────────────────────────
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const header = 'dup_file_id,group_id,confidence,signal,file_name,size_bytes,exif_datetime,hash,hash_confirmed,full_path\n';
  const lines = [header];
  let fileSeq = 0;
  for (const g of groups) {
    for (const f of g.files) {
      fileSeq++;
      const dup_file_id = `dupId${String(fileSeq).padStart(4, '0')}`;
      const exif_dt = (f.exif_date && f.exif_time)
        ? `${f.exif_date} ${f.exif_time}`
        : (f.exif_date || '');
      lines.push([
        esc(dup_file_id),
        g.group_id,
        esc(g.confidence),
        esc(g.signal),
        esc(f.file_name),
        f.size_bytes,
        esc(exif_dt),
        esc(''),
        esc('pending'),
        esc(f.full_path),
      ].join(',') + '\n');
    }
  }
  fs.writeFileSync(OUTPUT, lines.join(''));

  // ── Summary ───────────────────────────────────────────────────────────────────
  const byCon = {};
  for (const g of groups) byCon[g.confidence] = (byCon[g.confidence] || 0) + 1;
  const totalFiles = groups.reduce((s, g) => s + g.files.length, 0);

  // Bytes saved = sum of (n-1) × size per group (keep one copy, remove the rest)
  let bytesSaved = BigInt(0);
  for (const g of groups) {
    const size = BigInt(parseInt(g.files[0].size_bytes, 10) || 0);
    bytesSaved += size * BigInt(g.files.length - 1);
  }
  const mbSaved = Number(bytesSaved) / (1024 * 1024);
  const gbSaved = mbSaved / 1024;

  console.log('\n=== Results ===');
  console.log(`  Total duplicate groups: ${groups.length}`);
  for (const [k, v] of Object.entries(byCon)) console.log(`  ${k}: ${v} groups`);
  console.log(`  Total files flagged:    ${totalFiles}`);
  console.log(`  Bytes saved if removed: ${bytesSaved.toLocaleString()} bytes (${mbSaved.toFixed(0)} MB / ${gbSaved.toFixed(2)} GB)`);
  console.log(`\nOutput written to: ${OUTPUT}`);
}

main();
