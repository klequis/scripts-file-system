#!/usr/bin/env node

// check-integrity.js — Scan NEF/JPG/JPEG files for corruption using exiftool,
// with HDD temperature monitoring and rest periods.
//
// Requires: exiftool installed (sudo dnf install perl-Image-ExifTool)
// Usage: node check-integrity.js [--limit N]

'use strict';

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT    = '/run/media/carl/A1-2026-05-bk';
const DEVICE  = '/dev/sdb';
const OUTPUT  = path.join('/home/carl/P/data-recovery', 'integrity-errors.csv');
const FILELIST   = OUTPUT + '.filelist';
const CHECKPOINT = OUTPUT + '.checkpoint';

const SCAN_EXTENSIONS = new Set(['.nef', '.jpg', '.jpeg']);

const TEMP_CHECK_MS = 30 * 1000;
const WARN_TEMP     = 45;
const ABORT_TEMP    = 50;
const RESUME_TEMP   = 42;

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let LIMIT = Infinity;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) {
    LIMIT = parseInt(args[++i], 10);
  }
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
      console.log('\n[REST] Drive cool. Resuming.');
      break;
    }
  }
}

// ── File collection ───────────────────────────────────────────────────────────

function collectFiles(dir, results) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SCAN_EXTENSIONS.has(ext)) results.push(fullPath);
    }
  }
}

// ── exiftool check ────────────────────────────────────────────────────────────

// Returns array of { level: 'error'|'warning', message } or empty array if clean.
function checkFile(filePath) {
  const result = spawnSync('exiftool', ['-fast', '-q', '-q', filePath], {
    timeout: 15000,
    encoding: 'utf8',
  });
  const issues = [];
  const combined = ((result.stdout || '') + (result.stderr || '')).trim();
  if (!combined) return issues;
  for (const line of combined.split('\n')) {
    const l = line.trim().toLowerCase();
    if (!l) continue;
    if (l.includes('error')) issues.push({ level: 'error', message: line.trim() });
    else if (l.includes('warn')) issues.push({ level: 'warning', message: line.trim() });
  }
  return issues;
}

// ── CSV helpers ───────────────────────────────────────────────────────────────

const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
const CSV_HEADER = 'file_path,file_name,level,message\n';

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Phase 1: collect file list (reuse if resuming)
  let files;
  if (fs.existsSync(FILELIST)) {
    console.log(`Loading file list from ${FILELIST}...`);
    files = fs.readFileSync(FILELIST, 'utf8').split('\n').filter(Boolean);
    console.log(`${files.length} files to scan.`);
  } else {
    console.log(`Scanning ${ROOT} for NEF/JPG/JPEG files...`);
    files = [];
    collectFiles(ROOT, files);
    fs.writeFileSync(FILELIST, files.join('\n') + '\n');
    console.log(`Found ${files.length} files.`);
  }

  if (LIMIT < files.length) {
    console.log(`--limit ${LIMIT}: processing first ${LIMIT} of ${files.length} files.`);
    files = files.slice(0, LIMIT);
  }

  // Phase 2: determine start index from checkpoint
  let startIndex = 0;
  if (fs.existsSync(CHECKPOINT)) {
    startIndex = parseInt(fs.readFileSync(CHECKPOINT, 'utf8').trim(), 10) + 1;
    console.log(`Resuming from file ${startIndex + 1} of ${files.length}...`);
  } else {
    console.log(`Starting fresh scan of ${files.length} files.`);
  }

  // Open output CSV
  const outFd = startIndex === 0
    ? (() => { const fd = fs.openSync(OUTPUT, 'w'); fs.writeSync(fd, CSV_HEADER); return fd; })()
    : fs.openSync(OUTPUT, 'a');

  // Stats
  let clean = 0, errors = 0, warnings = 0;
  let abortDueToTemp = false;

  // Background temp monitor
  const tempInterval = setInterval(() => {
    const temp = getTemp();
    if (temp === null) return;
    if (temp >= ABORT_TEMP) {
      process.stderr.write(`\n[ABORT] Drive temp ${temp}°C reached abort threshold ${ABORT_TEMP}°C. Saving checkpoint.\n`);
      abortDueToTemp = true;
    } else if (temp >= WARN_TEMP) {
      process.stdout.write(`\n[WARN] Drive temp ${temp}°C\n`);
    }
  }, TEMP_CHECK_MS);

  try {
    for (let i = startIndex; i < files.length; i++) {
      if (abortDueToTemp) {
        fs.writeFileSync(CHECKPOINT, String(i - 1));
        console.log(`\nCheckpoint saved at file ${i}. Re-run to resume.`);
        break;
      }

      const filePath = files[i];
      const fileName = path.basename(filePath);

      // Progress
      if (i % 100 === 0 || i === startIndex) {
        const temp = getTemp();
        const tempStr = temp !== null ? ` | temp: ${temp}°C` : '';
        process.stdout.write(`\r[${i + 1}/${files.length}] errors: ${errors} warnings: ${warnings}${tempStr}  `);
      }

      const issues = checkFile(filePath);

      if (issues.length === 0) {
        clean++;
      } else {
        for (const issue of issues) {
          fs.writeSync(outFd, `${esc(filePath)},${esc(fileName)},${esc(issue.level)},${esc(issue.message)}\n`);
          if (issue.level === 'error') errors++;
          else warnings++;
        }
      }

      fs.writeFileSync(CHECKPOINT, String(i));
    }
  } finally {
    clearInterval(tempInterval);
    fs.closeSync(outFd);
  }

  if (!abortDueToTemp) {
    // Clean up checkpoint and filelist on successful completion
    if (fs.existsSync(CHECKPOINT)) fs.unlinkSync(CHECKPOINT);
    if (fs.existsSync(FILELIST)) fs.unlinkSync(FILELIST);
    console.log(`\n\nDone.`);
  }

  console.log(`\nResults:`);
  console.log(`  Total scanned : ${clean + errors + warnings}`);
  console.log(`  Clean         : ${clean}`);
  console.log(`  Errors        : ${errors}`);
  console.log(`  Warnings      : ${warnings}`);
  if (errors + warnings > 0) {
    console.log(`\nCorrupt/warned files written to: ${OUTPUT}`);
  } else {
    console.log(`\nNo issues found.`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
