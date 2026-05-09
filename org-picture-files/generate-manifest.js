'use strict';

// generate-manifest.js
// Reads test-output-6.csv, writes copy-manifest.csv.
// No file I/O on the HDD — safe to run without the drive mounted.
//
// Destination structure:
//   new/photos/YYYY/YYYY-MM-DD/new_filename
//   new/photos/YYYY/YYYY-MM-DD/HH:MM:SS/new_filename  (date >500 MB)
//   new/photos/unknown/new_filename
//   new/videos/YYYY/YYYY-MM-DD/...
//   new/other/new_filename   (flat — docs, zips, etc.)
//
// Filename convention:
//   stem_HH-MM-SS.ext         (has time)
//   stem_HH-MM-SS-1.ext       (collision after time insert)
//   stem.ext                  (no time)
//   stem-1.ext                (collision, no time)

const fs   = require('fs');
const path = require('path');

const INPUT_CSV  = path.join(__dirname, 'test-output-6.csv');
const OUTPUT_CSV = path.join(__dirname, 'copy-manifest.csv');

const DEST_ROOT   = '/run/media/carl/A1-2026-05/new';
const BUCKET_MB   = 500;

const PHOTO_EXTENSIONS = new Set([
  '.nef', '.jpg', '.jpeg', '.jpe', '.tif', '.tiff', '.dng',
  '.bmp', '.png', '.gif', '.psd', '.psp', '.webp', '.heic',
  '.rw2', '.cr2', '.cr3', '.arw', '.orf', '.pef', '.srw',
]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.3g2', '.nar',
]);

function categoryRoot(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (PHOTO_EXTENSIONS.has(ext)) return path.join(DEST_ROOT, 'photos');
  if (VIDEO_EXTENSIONS.has(ext)) return path.join(DEST_ROOT, 'videos');
  return path.join(DEST_ROOT, 'other');
}

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
// file_id, folder_name, file_name, full_path, date, date_source, time, sidecar_file, wav_file, size_mb
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
    wav_file:     f[COL.wav_file] || '',
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

// Group non-sidecar rows by (categoryRoot, date) for bucket calculation.
// 'other' files are assigned flat immediately.
const idxToFolder = new Map();
const byCatDate = new Map(); // catRoot -> Map(date -> [{idx, size_mb, time}])

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  if (r.sidecar_file || r.wav_file) continue;  // handled after image placement

  const catRoot = categoryRoot(r.file_name);

  // 'other' files go flat — no date sub-folders
  if (catRoot === path.join(DEST_ROOT, 'other')) {
    idxToFolder.set(i, catRoot);
    continue;
  }

  const date = r.date || 'unknown';
  if (!byCatDate.has(catRoot)) byCatDate.set(catRoot, new Map());
  const dateMap = byCatDate.get(catRoot);
  if (!dateMap.has(date)) dateMap.set(date, []);
  dateMap.get(date).push({ idx: i, size_mb: parseFloat(r.size_mb) || 0, time: r.time });
}

// Assign dest folders for photos and videos using date + 500 MB bucket logic
for (const [catRoot, dateMap] of byCatDate) {
  for (const [date, entries] of dateMap) {
    if (date === 'unknown') {
      for (const e of entries) idxToFolder.set(e.idx, path.join(catRoot, 'unknown'));
      continue;
    }

    const year = date.slice(0, 4);
    const datePath = path.join(catRoot, year, date);
    const totalMb = entries.reduce((s, e) => s + e.size_mb, 0);

    if (totalMb <= BUCKET_MB) {
      for (const e of entries) idxToFolder.set(e.idx, datePath);
    } else {
      // Sort by time, then greedy bucket split
      const sorted = [...entries].sort((a, b) => a.time.localeCompare(b.time));
      let bucketMb = 0;
      let cur = { startTime: sorted[0].time || '00:00:00', entries: [] };
      const buckets = [];
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

      for (const bucket of buckets) {
        if (!bucket.startTime) bucket.startTime = bucket.entries[0].time || '00:00:00';
        const folderName = path.join(datePath, bucket.startTime);
        for (const e of bucket.entries) idxToFolder.set(e.idx, folderName);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Assign dest folder for sidecars and wav audio notes (same folder as their image)
// ---------------------------------------------------------------------------

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const parentId = r.sidecar_file || r.wav_file;
  if (!parentId) continue;
  const imageIdx = idToIdx.get(parentId);
  if (imageIdx !== undefined && idxToFolder.has(imageIdx)) {
    idxToFolder.set(i, idxToFolder.get(imageIdx));
  } else {
    idxToFolder.set(i, path.join(DEST_ROOT, 'photos', 'unknown'));
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

  // full_path from analyze-pictures.js is already the correct absolute source path
  const origPath = r.full_path;
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

let renamed = 0;
const catCounts = { photos: 0, videos: 0, other: 0, unknown: 0 };
for (const m of manifest) {
  if (m.new_filename !== m.orig_filename) renamed++;
  if (m.new_path.includes('/photos/'))       catCounts.photos++;
  else if (m.new_path.includes('/videos/'))  catCounts.videos++;
  else if (m.new_path.includes('/other/'))   catCounts.other++;
  if (m.new_path.includes('/unknown/'))      catCounts.unknown++;
}

console.log(`\nManifest written: ${OUTPUT_CSV}`);
console.log(`  Total rows:      ${manifest.length}`);
console.log(`  → photos/:       ${catCounts.photos}`);
console.log(`  → videos/:       ${catCounts.videos}`);
console.log(`  → other/:        ${catCounts.other}`);
console.log(`  → */unknown/:    ${catCounts.unknown}`);
console.log(`  Renamed (time):  ${renamed}`);
console.log(`  Collisions:      ${collisionCount}`);
console.log('\nReview copy-manifest.csv before running copy-by-date.js');
