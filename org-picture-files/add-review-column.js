#!/usr/bin/env node

// Reads a picture analysis CSV and adds a "review" column.
// Only processes rows where date = "unknown".
// Marks "yes" if any path component contains a pattern that looks like a date
// but wasn't caught by the main extraction logic.
//
// Usage: node add-review-column.js [input.csv] [output.csv]

'use strict';

const fs   = require('fs');
const path = require('path');

const INPUT  = process.argv[2] || 'test-output-2.csv';
const OUTPUT = process.argv[3] || INPUT;

const MONTH_ABBR = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i;

// Compact date immediately followed by more digits (e.g. 20080829163036)
const COMPACT_DATETIME = /(?<!\d)((?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01]))\d+/i;

// Year at end: DD-MM-YYYY or MM-DD-YYYY (separators - . _ or space)
const YEAR_AT_END = /(?<!\d)\d{1,2}[-._/]\d{1,2}[-._/](?:19|20)\d{2}(?!\d)/;

// Single-digit day: 2006-12-3 (year-month-day where day is one digit)
const SINGLE_DIGIT_DAY = /(?<!\d)((?:19|20)\d{2})[-._](0?[1-9]|1[0-2])[-._]([1-9])(?!\d)/;

const ROOT = '/run/media/carl/A1-2026-05';

function hasPossibleDate(fullPath) {
  // Check every path component between ROOT and the filename
  const relative = fullPath.startsWith(ROOT) ? fullPath.slice(ROOT.length) : fullPath;
  const parts = relative.split('/').filter(Boolean);

  for (const part of parts) {
    if (
      MONTH_ABBR.test(part) ||
      COMPACT_DATETIME.test(part) ||
      YEAR_AT_END.test(part) ||
      SINGLE_DIGIT_DAY.test(part)
    ) {
      return true;
    }
  }
  return false;
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

const outLines = [lines[0] + ',review'];

let reviewCount = 0;
let unknownCount = 0;

for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) { outLines.push(line); continue; }

  const fields = parseLine(line);
  // columns depend on which CSV — find 'date' by checking date_source col
  // For analyze-pictures.js output: folder_name(0) file_name(1) full_path(2) date(3) date_source(4)
  const date      = fields[3];
  const fullPath  = fields[2];

  if (date !== 'unknown') {
    outLines.push(line + ',' + esc(''));
    continue;
  }

  unknownCount++;
  const review = hasPossibleDate(fullPath) ? 'yes' : '';
  if (review) reviewCount++;
  outLines.push(line + ',' + esc(review));
}

fs.writeFileSync(OUTPUT, outLines.join('\n'));

console.log(`Unknown date rows:      ${unknownCount}`);
console.log(`Flagged for review:     ${reviewCount}`);
console.log(`Output written to:      ${OUTPUT}`);
