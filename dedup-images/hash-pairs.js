#!/usr/bin/env node
'use strict';

// hash-pairs.js — Hash files in dupes-report.csv to confirm or deny duplicates
// Usage: node hash-pairs.js [dupes-report.csv] [output.csv] [--all]
//
// By default only hashes very-high and high confidence groups.
// Pass --all to also hash medium confidence groups.
// Output file defaults to overwriting the input file.

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const INPUT      = process.argv[2] || 'dupes-report.csv';
const OUTPUT     = process.argv[3] || INPUT;
const HASH_ALL   = process.argv.includes('--all');

const DEVICE        = '/dev/sda';
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
  return { header, rows };
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

// ── Hashing ────────────────────────────────────────────────────────────────────

function hashFile(fp) {
  try {
    const data = fs.readFileSync(fp);
    return crypto.createHash('sha256').update(data).digest('hex');
  } catch (e) {
    return `error:${e.code}`;
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const { header, rows } = parseCSV(fs.readFileSync(INPUT, 'utf8'));
  console.log(`Loaded ${rows.length} rows from ${INPUT}`);

  // Collect unique paths to hash (skip already-confirmed rows)
  const toHash = new Set();
  for (const row of rows) {
    if (!HASH_ALL && row.confidence === 'medium') continue;
    if (row.hash_confirmed === 'yes' || row.hash_confirmed === 'no') continue;
    toHash.add(row.full_path);
  }

  if (toHash.size === 0) {
    console.log('Nothing to hash — all rows already confirmed or skipped.');
    return;
  }
  console.log(`Files to hash: ${toHash.size}`);

  const hashCache = new Map();
  let done = 0;
  let workStart     = Date.now();
  let lastTempCheck = Date.now();
  for (const fp of toHash) {
    done++;
    if (done % 10 === 0 || done === toHash.size) {
      process.stdout.write(`\r  ${done} / ${toHash.size}  `);
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

    hashCache.set(fp, hashFile(fp));
  }
  console.log('\nHashing complete.');

  // Write hashes back to rows
  for (const row of rows) {
    if (hashCache.has(row.full_path)) {
      row.hash = hashCache.get(row.full_path);
    }
  }

  // Per group: compare hashes and set hash_confirmed
  const byGroup = new Map();
  for (const row of rows) {
    if (!byGroup.has(row.group_id)) byGroup.set(row.group_id, []);
    byGroup.get(row.group_id).push(row);
  }
  for (const [, grpRows] of byGroup) {
    const hashes = grpRows.map(r => r.hash).filter(h => h && !h.startsWith('error:'));
    if (hashes.length < 2) continue;
    const allSame = hashes.every(h => h === hashes[0]);
    for (const row of grpRows) {
      if (row.hash && !row.hash.startsWith('error:')) {
        row.hash_confirmed = allSame ? 'yes' : 'no';
      }
    }
  }

  // ── Write output CSV ──────────────────────────────────────────────────────────
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const NUMERIC_COLS = new Set(['group_id', 'size_bytes']);
  const csvHeader = header.join(',') + '\n';
  const lines = [csvHeader];
  for (const row of rows) {
    lines.push(
      header.map(h => NUMERIC_COLS.has(h) ? (row[h] ?? '') : esc(row[h] ?? '')).join(',') + '\n'
    );
  }
  fs.writeFileSync(OUTPUT, lines.join(''));
  console.log(`Updated report written to: ${OUTPUT}`);

  // ── Summary ───────────────────────────────────────────────────────────────────
  // Count distinct groups by hash_confirmed status
  const confirmedGroups = new Set();
  const deniedGroups    = new Set();
  for (const row of rows) {
    if (row.hash_confirmed === 'yes') confirmedGroups.add(row.group_id);
    if (row.hash_confirmed === 'no')  deniedGroups.add(row.group_id);
  }
  console.log('\n=== Hash results ===');
  console.log(`  Confirmed duplicate groups (hash match):   ${confirmedGroups.size}`);
  console.log(`  Not-duplicate groups (hash mismatch):      ${deniedGroups.size}`);
}

main().catch(err => { console.error(err); process.exit(1); });
