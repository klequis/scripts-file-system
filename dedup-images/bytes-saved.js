#!/usr/bin/env node
'use strict';

// bytes-saved.js — Sum bytes that would be saved by removing duplicates from dupes-report.csv
// Usage: node bytes-saved.js [dupes-report.csv]

const fs   = require('fs');
const path = require('path');

const INPUT = process.argv[2] || 'dupes-report.csv';

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

const lines  = fs.readFileSync(INPUT, 'utf8').trim().split('\n');
const header = parseRow(lines[0]);
const gi     = header.indexOf('group_id');
const si     = header.indexOf('size_bytes');
const ci     = header.indexOf('confidence');

if (gi < 0 || si < 0) {
  console.error('Could not find group_id or size_bytes columns in', INPUT);
  process.exit(1);
}

// For each group: keep one file, count the rest as savings
// Group rows by group_id, track first size seen per group
const groups = new Map(); // group_id → { size, count }
for (const line of lines.slice(1)) {
  if (!line.trim()) continue;
  const cols = parseRow(line);
  const gid  = cols[gi];
  const sz   = BigInt(parseInt(cols[si], 10) || 0);
  const conf = ci >= 0 ? cols[ci] : '';
  if (!groups.has(gid)) {
    groups.set(gid, { size: sz, count: 1, confidence: conf });
  } else {
    groups.get(gid).count++;
  }
}

// Tally savings by confidence tier
const tiers = ['very-high', 'high', 'medium'];
const tierSaved = {};
let totalSaved = BigInt(0);
for (const { size, count, confidence } of groups.values()) {
  const savings = size * BigInt(count - 1);
  totalSaved += savings;
  tierSaved[confidence] = (tierSaved[confidence] || BigInt(0)) + savings;
}

const toMB = (b) => (Number(b) / (1024 * 1024)).toFixed(0);
const toGB = (b) => (Number(b) / (1024 * 1024 * 1024)).toFixed(2);

console.log(`\n=== Bytes saved if duplicates removed ===`);
for (const tier of tiers) {
  if (!tierSaved[tier]) continue;
  console.log(`  ${tier.padEnd(12)}: ${toMB(tierSaved[tier])} MB`);
}
console.log(`  ${'total'.padEnd(12)}: ${totalSaved.toLocaleString()} bytes  (${toMB(totalSaved)} MB / ${toGB(totalSaved)} GB)`);
