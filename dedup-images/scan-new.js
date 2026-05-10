#!/usr/bin/env node
'use strict';

// scan-new.js — Walk new/ and output file_name, size_bytes, exif_date, exif_time, full_path
// Usage: node scan-new.js [output.csv]
// Requires: pnpm install (exifr)

const fs    = require('fs');
const path  = require('path');
const { spawnSync } = require('child_process');
const exifr = require('exifr');

// ── Config ─────────────────────────────────────────────────────────────────────

const ROOT   = '/run/media/carl/A1-2026-05/new';
const DEVICE = '/dev/sda';
const OUTPUT = process.argv[2] || 'new-files.csv';

const EXIF_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.nef', '.cr2', '.cr3', '.arw', '.orf',
  '.dng', '.tiff', '.tif', '.heic', '.rw2', '.pef', '.srw',
]);

const WORK_MS       = 5 * 60 * 1000;
const TEMP_CHECK_MS = 30 * 1000;
const WARN_TEMP     = 45;
const RESUME_TEMP   = 42;

// ── Temperature ────────────────────────────────────────────────────────────────

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
    const label = temp !== null ? `${temp}°C` : 'unknown';
    process.stdout.write(`\r  Drive temp: ${label}  `);
    if (temp === null || temp <= RESUME_TEMP) {
      console.log('\n[REST] Drive cool. Resuming.');
      break;
    }
  }
}

// ── File collection ────────────────────────────────────────────────────────────

function collectFiles(dir, results) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, results);
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
}

// ── EXIF helpers ───────────────────────────────────────────────────────────────

function formatDateFromExif(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return '';
  return [
    dt.getFullYear(),
    String(dt.getMonth() + 1).padStart(2, '0'),
    String(dt.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatTimeFromExif(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return '';
  return [dt.getHours(), dt.getMinutes(), dt.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':');
}

// ── CSV ────────────────────────────────────────────────────────────────────────

const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
const CSV_HEADER = 'file_name,size_bytes,exif_date,exif_time,full_path\n';

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Scanning ${ROOT}...`);
  const files = [];
  collectFiles(ROOT, files);
  console.log(`Found ${files.length} files.`);

  const out = fs.createWriteStream(OUTPUT, { encoding: 'utf8' });
  out.write(CSV_HEADER);

  let workStart     = Date.now();
  let lastTempCheck = Date.now();

  for (let i = 0; i < files.length; i++) {
    if ((i + 1) % 500 === 0) {
      process.stdout.write(`\r  ${i + 1} / ${files.length} files...`);
    }

    // Check temp every 30 sec — rest immediately if too hot
    if (Date.now() - lastTempCheck >= TEMP_CHECK_MS) {
      lastTempCheck = Date.now();
      const temp = getTemp();
      if (temp !== null && temp >= WARN_TEMP) {
        console.log(`\n[TEMP] ${temp}°C — resting...`);
        await restUntilCool();
        workStart = Date.now();
      }
    }

    // Mandatory cool-down break every 5 minutes regardless of temp
    if (Date.now() - workStart >= WORK_MS) {
      console.log(`\n[BREAK] 5 min work cycle done — cooling down...`);
      await restUntilCool();
      workStart = Date.now();
    }

    const fp  = files[i];
    const ext = path.extname(fp).toLowerCase();
    const stat = fs.statSync(fp);

    let exif_date = '';
    let exif_time = '';

    if (EXIF_EXTENSIONS.has(ext)) {
      try {
        const exif = await exifr.parse(fp, { pick: ['DateTimeOriginal'] });
        if (exif && exif.DateTimeOriginal) {
          exif_date = formatDateFromExif(exif.DateTimeOriginal);
          exif_time = formatTimeFromExif(exif.DateTimeOriginal);
        }
      } catch { /* no EXIF or unreadable */ }
    }

    out.write([
      esc(path.basename(fp)),
      stat.size,
      esc(exif_date),
      esc(exif_time),
      esc(fp),
    ].join(',') + '\n');
  }

  out.end();
  console.log(`\nDone. Written to: ${OUTPUT}`);
  console.log(`Total files: ${files.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
