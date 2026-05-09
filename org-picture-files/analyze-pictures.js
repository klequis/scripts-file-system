#!/usr/bin/env node

// analyze-pictures.js — Full pipeline: scan → EXIF → date fallback → CSV
// See analyze-pictures.md for full documentation.
//
// Requires: pnpm add exifr
// Usage: node analyze-pictures.js [output.csv] [--limit N]

'use strict';

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const exifr = require('exifr');

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT   = '/run/media/carl/A1-2026-05';
const DEVICE = '/dev/sda';

const EXCLUDED = new Set([
  path.join(ROOT, '2022.sophie-slide-show'),
  path.join(ROOT, 'daniel'),
  path.join(ROOT, 'dev-images'),
  path.join(ROOT, 'digikam-db'),
  path.join(ROOT, 'Scanned Pictures'),
]);

const EXIF_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.nef', '.cr2', '.cr3', '.arw', '.orf',
  '.dng', '.tiff', '.tif', '.heic', '.rw2', '.pef', '.srw',
]);

const SIDECAR_EXTENSIONS = new Set(['.xmp', '.nksc']);

const EXCLUDED_EXTENSIONS = new Set([
  '.tst', '.bridgesort', '.lnk', '.trashinfo', '.uuid',
]);

const EXPECTED_TOTAL = 41671;

const WORK_MS        = 5 * 60 * 1000;
const TEMP_CHECK_MS  = 30 * 1000;
const WARN_TEMP      = 45;
const ABORT_TEMP     = 50;
const RESUME_TEMP    = 42;

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let OUTPUT = 'picture-analysis.csv';
let LIMIT  = Infinity;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) {
    LIMIT = parseInt(args[++i], 10);
  } else if (!args[i].startsWith('--')) {
    OUTPUT = args[i];
  }
}

const FILELIST   = OUTPUT + '.filelist';
const CHECKPOINT = OUTPUT + '.checkpoint';

// ── Date/time helpers ─────────────────────────────────────────────────────────

const pad2 = (n) => String(parseInt(n, 10)).padStart(2, '0');

// Returns { date, time } or null. Tries patterns in priority order.
function extractDateAndTime(name) {
  let m;

  // 1. Compact datetime: YYYYMMDDHHMMSS (14+ digits)
  m = name.match(/(?<!\d)((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])([01]\d|2[0-3])([0-5]\d)([0-5]\d)(?=\D|$)/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}:${m[6]}` };

  // 2. Compact date: YYYYMMDD
  m = name.match(/(?<!\d)((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: '' };

  // 3. Separated date: YYYY-MM-DD / YYYY.MM.DD / YYYY_MM_DD
  m = name.match(/(?<!\d)((?:19|20)\d{2})[-._](0[1-9]|1[0-2])[-._](0[1-9]|[12]\d|3[01])(?!\d)/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: '' };

  // 4. MM-DD-YYYY with optional time HH;MM;SS AM/PM
  m = name.match(/^(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])-((?:19|20)\d{2})\b(?:.*?(\d{2});(\d{2});(\d{2})(AM|PM))?/i);
  if (m) {
    let time = '';
    if (m[4]) {
      let h = parseInt(m[4], 10);
      if (m[7] && m[7].toUpperCase() === 'PM' && h !== 12) h += 12;
      if (m[7] && m[7].toUpperCase() === 'AM' && h === 12) h = 0;
      time = `${pad2(h)}:${m[5]}:${m[6]}`;
    }
    return { date: `${m[3]}-${pad2(m[1])}-${pad2(m[2])}`, time };
  }

  // 5. YYYY-M-D-seq (last number is sequence, not part of date)
  m = name.match(/(?<!\d)((?:19|20)\d{2})-(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])-\d/);
  if (m) return { date: `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`, time: '' };

  return null;
}

// Extracts date only (for folder/ancestor names where time is irrelevant)
function extractDate(name) {
  const r = extractDateAndTime(name);
  return r ? r.date : null;
}

function isYearOnly(name) {
  return /^(19|20)\d{2}$/.test(name);
}

function formatDateFromExif(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return null;
  const y  = dt.getFullYear();
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const dy = String(dt.getDate()).padStart(2, '0');
  return `${y}-${mo}-${dy}`;
}

function formatTimeFromExif(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return '';
  return [dt.getHours(), dt.getMinutes(), dt.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':');
}

// Returns { date, time, source } using filename → folder → ancestor chain
function dateFromPath(filePath) {
  const fileName   = path.basename(filePath);
  const parentName = path.basename(path.dirname(filePath));

  let r = extractDateAndTime(fileName);
  if (r) return { date: r.date, time: r.time, source: 'filename' };

  r = extractDateAndTime(parentName);
  if (r) return { date: r.date, time: '', source: 'folder' };

  let current = path.dirname(path.dirname(filePath));
  while (current && current !== ROOT && current !== path.dirname(ROOT)) {
    const name = path.basename(current);
    if (isYearOnly(name)) break;
    const d = extractDate(name);
    if (d) return { date: d, time: '', source: 'ancestor' };
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return { date: 'unknown', time: '', source: 'unknown' };
}

// ── Temperature ───────────────────────────────────────────────────────────────

function getTemp() {
  try {
    const result = spawnSync('smartctl', ['-A', DEVICE], { timeout: 5000 });
    const output = result.stdout ? result.stdout.toString() : '';
    const m = output.match(
      /^\s*(?:194|190)\s+\S+\s+\S+\s+\d+\s+\d+\s+\d+\s+\S+\s+\S+\s+\S+\s+(\d+)/m
    );
    if (m) return parseInt(m[1], 10);
  } catch { /* smartctl unavailable */ }
  return null;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function restUntilCool() {
  console.log(`\n[REST] Waiting for drive to cool to ≤${RESUME_TEMP}°C...`);
  while (true) {
    await sleep(TEMP_CHECK_MS);
    const temp = getTemp();
    const label = temp !== null ? `${temp}°C` : 'unknown (smartctl error)';
    process.stdout.write(`\r  Drive temp: ${label}  `);
    if (temp === null || temp <= RESUME_TEMP) {
      console.log('\n[REST] Drive cool. Resuming work.');
      break;
    }
  }
}

// ── Scan ──────────────────────────────────────────────────────────────────────

function countFilesInDir(dir) {
  let count = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return 0; }
  for (const entry of entries) {
    if (entry.isDirectory()) count += countFilesInDir(path.join(dir, entry.name));
    else if (entry.isFile()) count++;
  }
  return count;
}

function collectFiles(dir, results, stats) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED.has(fullPath) || entry.name === '.dtrash' || entry.name === '.Trash-1000') {
        stats.excluded += countFilesInDir(fullPath);
      } else {
        collectFiles(fullPath, results, stats);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (EXCLUDED_EXTENSIONS.has(ext)) {
        stats.excluded++;
      } else {
        results.push(fullPath);
        stats.included++;
      }
    }
  }
}

// ── CSV ───────────────────────────────────────────────────────────────────────

const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
const CSV_HEADER = 'file_id,folder_name,file_name,full_path,date,date_source,time,sidecar_file,size_mb\n';

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  let scanStats = null;
  // Phase 1: collect file list (reuse if resuming)
  let files;
  if (fs.existsSync(FILELIST)) {
    console.log(`Loading file list from ${FILELIST}...`);
    files = fs.readFileSync(FILELIST, 'utf8').split('\n').filter(Boolean);
    console.log(`${files.length} files in list.`);
  } else {
    console.log(`Scanning ${ROOT}...`);
    files = [];
    scanStats = { included: 0, excluded: 0 };
    collectFiles(ROOT, files, scanStats);
    fs.writeFileSync(FILELIST, files.join('\n') + '\n');
    const scanTotal = scanStats.included + scanStats.excluded;
    console.log(`Found ${scanStats.included} included + ${scanStats.excluded} excluded = ${scanTotal} total files.`);
    if (scanTotal === EXPECTED_TOTAL) {
      console.log(`File count check passed (expected ${EXPECTED_TOTAL}). ✓`);
    } else {
      console.warn(`[WARN] File count mismatch: got ${scanTotal}, expected ${EXPECTED_TOTAL}. Something may have changed on the drive.`);
    }
  }

  if (LIMIT < files.length) {
    console.log(`--limit ${LIMIT}: processing first ${LIMIT} of ${files.length} files.`);
    files = files.slice(0, LIMIT);
  }

  // Build XMP lookup: for each file, record dir+basename(no ext) → file_id
  // file_id is the 1-based index in the files array
  // Map key: `${dir}::${baseNoExt}` → file_id
  const IMAGE_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.nef', '.cr2', '.cr3', '.arw', '.orf',
    '.dng', '.tiff', '.tif', '.heic', '.rw2', '.pef', '.srw',
    '.png', '.bmp', '.gif', '.avi', '.mov', '.mp4', '.mpg', '.mpeg',
  ]);
  // Map: dir::baseNoExt → file_id  (for non-sidecar files)
  const imageByBaseName = new Map();
  for (let i = 0; i < files.length; i++) {
    const fp  = files[i];
    const ext = path.extname(fp).toLowerCase();
    if (SIDECAR_EXTENSIONS.has(ext)) continue;
    const dir      = path.dirname(fp);
    const base     = path.basename(fp);
    const baseNoExt = base.slice(0, base.length - ext.length);
    const key = `${dir}::${baseNoExt.toLowerCase()}`;
    imageByBaseName.set(key, i + 1); // file_id is 1-based
  }

  // Phase 2: determine start index from checkpoint
  let startIndex = 0;
  if (fs.existsSync(CHECKPOINT)) {
    startIndex = parseInt(fs.readFileSync(CHECKPOINT, 'utf8').trim(), 10) + 1;
    console.log(`Resuming from file ${startIndex} of ${files.length}...`);
  }

  // Open output file
  const outFd = startIndex === 0
    ? (() => { const fd = fs.openSync(OUTPUT, 'w'); fs.writeSync(fd, CSV_HEADER); return fd; })()
    : fs.openSync(OUTPUT, 'a');

  // Stats
  const sourceCounts = {};
  const exifByExt = {};
  let abortDueToTemp = false;

  // Background temp monitor
  let tempInterval = startTempMonitor();

  function startTempMonitor() {
    return setInterval(() => {
      const temp = getTemp();
      if (temp === null) return;
      if (temp >= ABORT_TEMP) {
        process.stderr.write(`\n[ABORT] Drive temperature ${temp}°C reached abort threshold ${ABORT_TEMP}°C!\n`);
        abortDueToTemp = true;
      } else if (temp >= WARN_TEMP) {
        process.stdout.write(`\n[WARN] Drive temperature ${temp}°C\n`);
      }
    }, TEMP_CHECK_MS);
  }

  let workStart = Date.now();

  try {
    for (let i = startIndex; i < files.length; i++) {
      if (abortDueToTemp) {
        fs.writeFileSync(CHECKPOINT, String(i - 1));
        break;
      }

      const filePath   = files[i];
      const fileId     = i + 1;
      const fileName   = path.basename(filePath);
      const folderName = path.basename(path.dirname(filePath));
      const ext        = path.extname(filePath).toLowerCase();

      let date, source, time = '', sidecarFile = '', sizeMb = '';
      try { sizeMb = (fs.statSync(filePath).size / 1048576).toFixed(3); } catch { /* unreadable */ }

      // Resolve sidecar association (.xmp, .nksc)
      if (SIDECAR_EXTENSIONS.has(ext)) {
        const dir      = path.dirname(filePath);
        const base     = path.basename(filePath);
        const sidecarExt = ext; // e.g. '.xmp' or '.nksc'
        // Strip the sidecar extension to get the base: "DSC4374.NEF.xmp" → "DSC4374.NEF"
        const withoutSidecar    = base.slice(0, base.length - sidecarExt.length);
        const withoutSidecarExt = path.extname(withoutSidecar); // e.g. '.NEF'
        const baseNoExt         = withoutSidecar.slice(0, withoutSidecar.length - withoutSidecarExt.length);

        // Try exact match first (name.EXT.sidecar)
        let key = `${dir}::${withoutSidecar.toLowerCase()}`;
        if (imageByBaseName.has(key)) {
          sidecarFile = String(imageByBaseName.get(key));
        } else {
          // Try bare name (name.sidecar → name.*)
          key = `${dir}::${baseNoExt.toLowerCase()}`;
          if (imageByBaseName.has(key)) {
            sidecarFile = String(imageByBaseName.get(key));
          }
        }
      }

      // Try EXIF first (eligible image extensions only)
      if (EXIF_EXTENSIONS.has(ext)) {
        if (!exifByExt[ext]) exifByExt[ext] = { found: 0, notFound: 0 };
        try {
          const data = await exifr.parse(filePath, {
            pick: ['DateTimeOriginal'],
            firstChunkSize: 65536,
          });
          if (data && data.DateTimeOriginal) {
            const formattedDate = formatDateFromExif(data.DateTimeOriginal);
            if (formattedDate) {
              date   = formattedDate;
              time   = formatTimeFromExif(data.DateTimeOriginal);
              source = 'exif';
              exifByExt[ext].found++;
            }
          }
        } catch { /* unreadable or no EXIF */ }

        if (!date) exifByExt[ext].notFound++;
      }

      // Fallback to path-based date
      if (!date) {
        ({ date, time, source } = dateFromPath(filePath));
      }

      sourceCounts[source] = (sourceCounts[source] || 0) + 1;
      fs.writeSync(outFd,
        [fileId, esc(folderName), esc(fileName), esc(filePath), esc(date), esc(source), esc(time), esc(sidecarFile), sizeMb].join(',') + '\n'
      );
      fs.writeFileSync(CHECKPOINT, String(i));

      if ((i - startIndex + 1) % 200 === 0) {
        process.stdout.write(`\r  ${i - startIndex + 1} / ${files.length} files...`);
      }

      // Work/rest cycle
      if (Date.now() - workStart >= WORK_MS) {
        process.stdout.write('\n');
        console.log(`\n[REST] 5-minute work period done (${i - startIndex + 1} files this session).`);
        clearInterval(tempInterval);
        await restUntilCool();
        workStart = Date.now();
        tempInterval = startTempMonitor();
      }
    }
  } finally {
    clearInterval(tempInterval);
    fs.closeSync(outFd);
  }

  process.stdout.write('\n');

  if (abortDueToTemp) {
    console.log(`\nAborted due to temperature. Re-run to resume. Partial output: ${OUTPUT}`);
  } else {
    // Clean up temp files on success
    if (fs.existsSync(CHECKPOINT)) fs.unlinkSync(CHECKPOINT);
    if (fs.existsSync(FILELIST))   fs.unlinkSync(FILELIST);
    console.log(`\nDone. Output written to: ${OUTPUT}`);
  }

  // Stats
  const total = Object.values(sourceCounts).reduce((a, b) => a + b, 0);
  console.log('\n=== File counts ===');
  if (scanStats) {
    const scanTotal = scanStats.included + scanStats.excluded;
    console.log(`  Included:     ${String(scanStats.included).padStart(6)}`);
    console.log(`  Excluded:     ${String(scanStats.excluded).padStart(6)}`);
    console.log(`  Total:        ${String(scanTotal).padStart(6)}  (expected ${EXPECTED_TOTAL})`);
  } else {
    console.log(`  Included:     ${String(files.length).padStart(6)}  (resumed from checkpoint, excluded count unavailable)`);
  }
  console.log('\n=== Date source breakdown ===');
  console.log(`  Processed:    ${String(total).padStart(6)}`);
  for (const [src, count] of Object.entries(sourceCounts)) {
    const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
    console.log(`  ${src.padEnd(10)}  ${String(count).padStart(6)}  (${pct}%)`);
  }

  const exifEntries = Object.entries(exifByExt)
    .sort((a, b) => (b[1].found + b[1].notFound) - (a[1].found + a[1].notFound));

  if (exifEntries.length) {
    console.log('\n=== EXIF by extension ===');
    console.log('  ext          total    found  not-found');
    for (const [ext, { found, notFound }] of exifEntries) {
      const t = found + notFound;
      console.log(
        `  ${(ext || '(none)').padEnd(12)}  ${String(t).padStart(6)}  ${String(found).padStart(6)}  ${String(notFound).padStart(9)}`
      );
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
