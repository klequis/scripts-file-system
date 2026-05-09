#!/usr/bin/env node

// Reads a CSV where some rows have update="derive date".
// For those rows, extracts a date from the filename using extended patterns
// and updates the date and date_source columns in place.
//
// Usage: node derive-dates.js [input.csv] [output.csv]

'use strict';

const fs   = require('fs');
const path = require('path');

const INPUT  = process.argv[2] || 'test-output.csv';
const OUTPUT = process.argv[3] || INPUT;

function pad(n) { return String(n).padStart(2, '0'); }

// Returns "YYYY-MM-DD" or null
function deriveDate(fileName) {
  const base = fileName;

  // 1. Compact datetime prefix: YYYYMMDDHHMMSS... (14+ digits, year 19xx/20xx)
  //    e.g. 20080907150248DSCN0479.AVI, 20080829163036__DSC4374.NEF
  let m = base.match(/^((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{6}/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // 2. MM-DD-YYYY at start (with space or separator after)
  //    e.g. 12-05-2009 02;34;07PM.jpg
  m = base.match(/^(0?[1-9]|1[0-2])[-](0?[1-9]|[12]\d|3[01])[-]((?:19|20)\d{2})\b/);
  if (m) return `${m[3]}-${pad(parseInt(m[1]))}-${pad(parseInt(m[2]))}`;

  // 3. YYYY-M-D-seq: year-month-day followed by a hyphen and sequence number
  //    e.g. 2006-12-3-9.JPG, 2006-8-4-5.JPG
  m = base.match(/^((?:19|20)\d{2})-(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])-\d/);
  if (m) return `${m[1]}-${pad(parseInt(m[2]))}-${pad(parseInt(m[3]))}`;

  return null;
}

function parseLine(line) {
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
      fields.push(line.slice(i, end)); i = end + 1;
    }
  }
  return fields;
}

const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;

const raw   = fs.readFileSync(INPUT, 'utf8');
const lines = raw.split('\n');
const outLines = [lines[0]]; // keep header unchanged

let updated = 0;
let failed  = 0;
const failures = [];

for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) { outLines.push(line); continue; }

  const fields = parseLine(line);
  // columns: folder_name(0) file_name(1) full_path(2) date(3) date_source(4) review(5) update(6)
  // "derive date" may appear in either the review or update column
  const reviewVal = (fields[5] || '').trim().toLowerCase();
  const updateVal = (fields[6] || '').trim().toLowerCase();
  const wantDerive = reviewVal === 'derive date' || updateVal === 'derive date';

  if (!wantDerive) {
    outLines.push(line);
    continue;
  }

  const fileName = fields[1];
  const derived  = deriveDate(fileName);

  if (derived) {
    fields[3] = derived;
    fields[4] = 'derived';
    updated++;
  } else {
    failed++;
    if (failures.length < 10) failures.push(fileName);
  }

  outLines.push(fields.map(esc).join(','));
}

fs.writeFileSync(OUTPUT, outLines.join('\n'));

console.log(`Dates derived:   ${updated}`);
console.log(`Could not parse: ${failed}`);
if (failures.length) {
  console.log('\nFailed filenames:');
  failures.forEach(f => console.log(' ', f));
}
console.log(`\nOutput written to: ${OUTPUT}`);
