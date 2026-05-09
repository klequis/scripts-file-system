'use strict';

// generate-manifest.js
// Reads test-output-5.csv, writes copy-manifest.csv.
// No file I/O on the HDD — safe to run without the drive mounted.
//
// Destination structure:
//   new/YYYY/YYYY-MM-DD/new_filename          (single bucket for that date)
//   new/YYYY/YYYY-MM-DD/HH:MM:SS/new_filename (date has >500 MB, time buckets)
//   new/unknown/new_filename                  (no resolvable date)
//
// Filename convention:
//   stem_HH-MM-SS.ext         (has time)
//   stem_HH-MM-SS-1.ext       (collision after time insert)
//   stem.ext                  (no time)
//   stem-1.ext                (collision, no time)

const fs   = require('fs');
const path = require('path');

const INPUT_CSV  = path.join(__dirname, 'test-output-5.csv');
const OUTPUT_CSV = path.join(__dirname, 'copy-manifest.csv');

const SOURCE_ROOT = '/run/media/carl/A1-2026-05/orig';
const DEST_ROOT   = '/run/media/carl/A1-2026-05/new';
const BUCKET_MB   = 500;

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function parseRow(line) {
  const fields = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) { fields.push(''); break; }
    if (line[i] === '"') {
      let j = i + 1, val = '';
      while (j < line.length) {
        if (line[j] === '"' && line[j + 1] === '"') { val += '"'; j += 2; }
        else if (line[j] === '"') { j++; break; }
        else { val += line[j++]; }
      }
      fields.push(val);
      i = j + 1;
    } else {
      const j = line.indexOf(',', i);
      if (j === -1) { fields.push(line.slice(i)); break; }
      fields.push(line.slice(i, j));
      i = j + 1;
    }
  }
  return fields;
}

function csvCell(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvRow(cells) {
  return cells.map(csvCell).join(',');
}

// ---------------------------------------------------------------------------
// Load input CSV
// ---------------------------------------------------------------------------

const lines = fs.readFileSync(INPUT_CSV, 'utf8').split('\n');
const header = parseRow(lines[0]);

// Column indices (0-based)
// file_id, folder_name, file_name, full_path, date, date_source, time, sidecar_file, size_mb
const COL = {};
header.forEach((h, i) => { COL[h.trim()] = i; });

const rows = [];
for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const f = parseRow(line);
  rows.push({
    file_id:      f[COL.file_id],
    folder_name:  f[COL.folder_name],
    file_name:    f[COL.file_name],
    full_path:    f[COL.full_path],
    date:         f[COL.date],
    date_source:  f[COL.date_source],
    time:         f[COL.time] || '',
    sidecar_file: f[COL.sidecar_file] || '',
    size_mb:      f[COL.size_mb] || '0',
  });
}

console.log(`Loaded ${rows.length} rows from ${INPUT_CSV}`);

// ---------------------------------------------------------------------------
// Build file_id -> row index map
// ---------------------------------------------------------------------------

const idToIdx = new Map();
rows.forEach((r, i) => idToIdx.set(r.file_id, i));

// ---------------------------------------------------------------------------
// Compute dest folder for each non-sidecar file
// Bucket logic: same as group-by-date.js — sort by time, greedy 500 MB buckets
// ---------------------------------------------------------------------------

// Group rows by date (skip sidecars for now — they follow their image)
const byDate = new Map(); // date -> [{idx, size_mb, time}]
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  if (r.sidecar_file) continue;            // handled after image placement
  const date = r.date || 'unknown';
  if (!byDate.has(date)) byDate.set(date, []);
  byDate.get(date).push({ idx: i, size_mb: parseFloat(r.size_mb) || 0, time: r.time });
}

// For each date, assign a dest folder path (string, no trailing slash)
// Returns: Map<idx, destFolder>
const idxToFolder = new Map();

for (const [date, entries] of byDate) {
  if (date === 'unknown') {
    for (const e of entries) idxToFolder.set(e.idx, path.join(DEST_ROOT, 'unknown'));
    continue;
  }

  const year = date.slice(0, 4);
  const datePath = path.join(DEST_ROOT, year, date);
  const totalMb = entries.reduce((s, e) => s + e.size_mb, 0);

  if (totalMb <= BUCKET_MB) {
    for (const e of entries) idxToFolder.set(e.idx, datePath);
  } else {
    // Sort by time, then greedy bucket split
    const sorted = [...entries].sort((a, b) => a.time.localeCompare(b.time));
    let bucketStart = 0;
    let bucketMb = 0;
    let buckets = []; // [{startTime, entries:[]}]
    let cur = { startTime: sorted[0].time || '00:00:00', entries: [] };
    for (const e of sorted) {
      cur.entries.push(e);
      bucketMb += e.size_mb;
      if (bucketMb >= BUCKET_MB) {
        buckets.push(cur);
        cur = { startTime: null, entries: [] };
        bucketMb = 0;
      }
    }
    if (cur.entries.length) buckets.push(cur);

    // Assign startTime for any bucket that didn't get one yet
    for (let b = 0; b < buckets.length; b++) {
      if (!buckets[b].startTime) {
        buckets[b].startTime = buckets[b].entries[0].time || '00:00:00';
      }
    }

    for (const bucket of buckets) {
      const folderName = path.join(datePath, bucket.startTime);
      for (const e of bucket.entries) idxToFolder.set(e.idx, folderName);
    }
  }
}

// ---------------------------------------------------------------------------
// Assign dest folder for sidecars (same folder as their image)
// ---------------------------------------------------------------------------

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  if (!r.sidecar_file) continue;
  const imageIdx = idToIdx.get(r.sidecar_file);
  if (imageIdx !== undefined && idxToFolder.has(imageIdx)) {
    idxToFolder.set(i, idxToFolder.get(imageIdx));
  } else {
    idxToFolder.set(i, path.join(DEST_ROOT, 'unknown'));
  }
}

// ---------------------------------------------------------------------------
// Compute new_filename with time insertion + collision suffix
// ---------------------------------------------------------------------------

// Collision tracking: destFolder::new_filename_lower -> count
const collision = new Map();
let collisionCount = 0;

function makeNewFilename(origName, time, folder) {
  const ext  = path.extname(origName);          // includes dot
  const stem = origName.slice(0, origName.length - ext.length);
  const timeSuffix = time ? '_' + time.replace(/:/g, '-') : '';
  const base = stem + timeSuffix + ext;

  const key0 = folder + '::' + base.toLowerCase();
  const count = collision.get(key0) || 0;
  collision.set(key0, count + 1);

  if (count === 0) return base;

  // collision: insert -N before extension
  collisionCount++;
  const stemT = stem + timeSuffix;
  const candidate = stemT + '-' + count + ext;
  const keyN = folder + '::' + candidate.toLowerCase();
  collision.set(keyN, (collision.get(keyN) || 0) + 1);
  return candidate;
}

// ---------------------------------------------------------------------------
// Build manifest rows
// ---------------------------------------------------------------------------

// We need to process sidecars AFTER their image so their folder is resolved.
// Process non-sidecars first, then sidecars.
const order = [
  ...rows.map((r, i) => i).filter(i => !rows[i].sidecar_file),
  ...rows.map((r, i) => i).filter(i =>  rows[i].sidecar_file),
];

const manifest = new Array(rows.length);

for (const i of order) {
  const r = rows[i];
  const folder = idxToFolder.get(i) || path.join(DEST_ROOT, 'unknown');
  const newFilename = makeNewFilename(r.file_name, r.time, folder);

  // Derive orig_path: replace drive root prefix with SOURCE_ROOT
  // full_path in CSV is absolute path at scan time; source files are now under orig/
  // The CSV full_path looks like /run/media/carl/A1-2026-05/...
  // Under orig/ the same relative path is preserved.
  const driveRoot = '/run/media/carl/A1-2026-05';
  const relPath = r.full_path.startsWith(driveRoot)
    ? r.full_path.slice(driveRoot.length)   // e.g. /Photos/2007/...
    : '/' + r.full_path;
  const origPath = path.join(SOURCE_ROOT, relPath);
  const newPath  = path.join(folder, newFilename);

  const sizeBytes = Math.round(parseFloat(r.size_mb) * 1048576);

  manifest[i] = {
    file_id:       r.file_id,
    orig_filename: r.file_name,
    new_filename:  newFilename,
    orig_path:     origPath,
    new_path:      newPath,
    size_bytes:    sizeBytes,
    status:        'pending',
  };
}

// ---------------------------------------------------------------------------
// Write copy-manifest.csv
// ---------------------------------------------------------------------------

const outHeader = ['file_id', 'orig_filename', 'new_filename', 'orig_path', 'new_path', 'size_bytes', 'status'];
const outLines  = [outHeader.join(',')];
for (const m of manifest) {
  outLines.push(csvRow([m.file_id, m.orig_filename, m.new_filename, m.orig_path, m.new_path, m.size_bytes, m.status]));
}
fs.writeFileSync(OUTPUT_CSV, outLines.join('\n') + '\n');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

let renamed = 0, unknownDest = 0;
for (const m of manifest) {
  if (m.new_filename !== m.orig_filename) renamed++;
  if (m.new_path.includes('/unknown/')) unknownDest++;
}

console.log(`\nManifest written: ${OUTPUT_CSV}`);
console.log(`  Total rows:      ${manifest.length}`);
console.log(`  Renamed (time):  ${renamed}`);
console.log(`  Collisions:      ${collisionCount}`);
console.log(`  → unknown/:      ${unknownDest}`);
console.log('\nReview copy-manifest.csv before running copy-by-date.js');
