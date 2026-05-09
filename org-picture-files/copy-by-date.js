#!/usr/bin/env node

// copy-by-date.js — Copy files from orig/ to new/ using copy-manifest.csv
//
// Usage:
//   node copy-by-date.js [manifest.csv]           — copy pending files
//   node copy-by-date.js [manifest.csv] --verify  — verify copied files

'use strict';

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ── Config ────────────────────────────────────────────────────────────────────

const DEVICE        = '/dev/sda';
const WORK_MS       = 5 * 60 * 1000;
const TEMP_CHECK_MS = 30 * 1000;
const WARN_TEMP     = 45;
const ABORT_TEMP    = 50;
const RESUME_TEMP   = 42;
const SAVE_EVERY    = 50;   // write manifest back every N processed files

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let MANIFEST = path.join(__dirname, 'copy-manifest.csv');
let VERIFY   = false;

for (const arg of args) {
  if (arg === '--verify') VERIFY = true;
  else if (!arg.startsWith('--')) MANIFEST = arg;
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
    const temp  = getTemp();
    const label = temp !== null ? `${temp}°C` : 'unknown (smartctl unavailable)';
    process.stdout.write(`\r  Drive temp: ${label}  `);
    if (temp === null || temp <= RESUME_TEMP) {
      console.log('\n[REST] Drive cool. Resuming.');
      break;
    }
  }
}

// ── CSV ───────────────────────────────────────────────────────────────────────

function splitCSVLine(line) {
  const fields = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let val = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { val += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else val += line[i++];
      }
      fields.push(val);
      if (line[i] === ',') i++;
    } else {
      const end = line.indexOf(',', i);
      if (end === -1) { fields.push(line.slice(i)); break; }
      fields.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return fields;
}

function parseCSV(text) {
  const lines  = text.split('\n');
  const header = lines[0].split(',');
  const rows   = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = splitCSVLine(line);
    const obj = {};
    for (let j = 0; j < header.length; j++) {
      obj[header[j]] = fields[j] !== undefined ? fields[j] : '';
    }
    rows.push(obj);
  }
  return { header, rows };
}

function serializeCSV(header, rows) {
  const esc          = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const numericFields = new Set(['file_id', 'size_bytes']);
  const lines        = [header.join(',')];
  for (const row of rows) {
    const fields = header.map(h => numericFields.has(h) ? row[h] : esc(row[h]));
    lines.push(fields.join(','));
  }
  return lines.join('\n') + '\n';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(MANIFEST)) {
    console.error(`Manifest not found: ${MANIFEST}`);
    process.exit(1);
  }

  const { header, rows } = parseCSV(fs.readFileSync(MANIFEST, 'utf8'));

  // ── Verify mode ─────────────────────────────────────────────────────────────

  if (VERIFY) {
    console.log('Verifying copied files...');
    let ok = 0, missing = 0, sizeMismatch = 0, notCopied = 0;

    for (const row of rows) {
      if (row.status !== 'copied') { notCopied++; continue; }
      let stat;
      try { stat = fs.statSync(row.new_path); } catch { stat = null; }

      if (!stat) {
        missing++;
        console.log(`MISSING:       ${row.new_path}`);
      } else {
        // Compare against actual source size — size_bytes in manifest is derived from
        // a rounded size_mb float and may differ by up to ~512 bytes
        let srcSize = null;
        try { srcSize = fs.statSync(row.orig_path).size; } catch { /* ignore */ }
        if (srcSize !== null && stat.size !== srcSize) {
          sizeMismatch++;
          console.log(`SIZE-MISMATCH: ${row.new_path}  (orig=${srcSize}, new=${stat.size})`);
        } else {
          ok++;
        }
      }
    }

    console.log('\nVerify complete:');
    console.log(`  OK:            ${ok}`);
    console.log(`  Missing:       ${missing}`);
    console.log(`  Size mismatch: ${sizeMismatch}`);
    console.log(`  Not yet copied (pending/failed): ${notCopied}`);
    return;
  }

  // ── Copy mode ────────────────────────────────────────────────────────────────

  const totalPending = rows.filter(r => r.status === 'pending').length;
  console.log(`${totalPending} files to copy.`);
  if (totalPending === 0) { console.log('Nothing to do.'); return; }

  let abortDueToTemp = false;
  let workStart      = Date.now();
  let saveCounter    = 0;
  let copied         = 0;
  let failed         = 0;

  function startTempMonitor() {
    return setInterval(() => {
      const temp = getTemp();
      if (temp === null) return;
      if (temp >= ABORT_TEMP) {
        process.stderr.write(`\n[ABORT] Drive temperature ${temp}°C ≥ abort threshold ${ABORT_TEMP}°C!\n`);
        abortDueToTemp = true;
      } else if (temp >= WARN_TEMP) {
        process.stdout.write(`\n[WARN] Drive temperature ${temp}°C\n`);
      }
    }, TEMP_CHECK_MS);
  }

  let tempInterval = startTempMonitor();

  try {
    for (const row of rows) {
      if (row.status !== 'pending') continue;

      // Temperature abort: save, rest, resume
      if (abortDueToTemp) {
        fs.writeFileSync(MANIFEST, serializeCSV(header, rows));
        clearInterval(tempInterval);
        await restUntilCool();
        abortDueToTemp = false;
        workStart      = Date.now();
        tempInterval   = startTempMonitor();
      }

      // Copy the file
      const destDir = path.dirname(row.new_path);
      try {
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(row.orig_path, row.new_path);
        row.status = 'copied';
        copied++;
      } catch (err) {
        row.status = 'failed';
        failed++;
        console.error(`\nFAILED: ${row.orig_path}\n  → ${err.message}`);
      }

      // Periodic manifest save + progress
      saveCounter++;
      if (saveCounter % SAVE_EVERY === 0) {
        fs.writeFileSync(MANIFEST, serializeCSV(header, rows));
        const done = copied + failed;
        process.stdout.write(`\r  ${done} / ${totalPending} files (${copied} copied, ${failed} failed)...`);
      }

      // Work/rest cycle
      if (!abortDueToTemp && Date.now() - workStart >= WORK_MS) {
        fs.writeFileSync(MANIFEST, serializeCSV(header, rows));
        process.stdout.write('\n');
        console.log(`[REST] 5-minute work period done (${copied + failed} files this session).`);
        clearInterval(tempInterval);
        await restUntilCool();
        abortDueToTemp = false;
        workStart      = Date.now();
        tempInterval   = startTempMonitor();
      }
    }
  } finally {
    clearInterval(tempInterval);
    fs.writeFileSync(MANIFEST, serializeCSV(header, rows));
  }

  process.stdout.write('\n');

  const stillPending = rows.filter(r => r.status === 'pending').length;
  console.log('\n=== Copy complete ===');
  console.log(`  Copied:        ${copied}`);
  console.log(`  Failed:        ${failed}`);
  console.log(`  Still pending: ${stillPending}`);

  if (failed > 0) {
    console.log('\nTo retry failed files: edit copy-manifest.csv and change status from "failed" back to "pending", then re-run.');
  }
  if (stillPending === 0 && failed === 0) {
    console.log('\nAll files copied. Run with --verify to verify.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
