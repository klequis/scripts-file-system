#!/usr/bin/env node
'use strict';

// add-dup-ids.js — Add dup_file_id as the first column to an existing dupes-report.csv
// Usage: node add-dup-ids.js [dupes-report.csv]

const fs = require('fs');

const INPUT  = process.argv[2] || 'dupes-report.csv';
const lines  = fs.readFileSync(INPUT, 'utf8').trimEnd().split('\n');

const newLines = ['dup_file_id,' + lines[0]];
for (let i = 1; i < lines.length; i++) {
  if (!lines[i].trim()) continue;
  const id = `dupId${String(i).padStart(4, '0')}`;
  newLines.push(`"${id}",` + lines[i]);
}

fs.writeFileSync(INPUT, newLines.join('\n') + '\n');
console.log(`Added dup_file_id to ${INPUT} (${newLines.length - 1} data rows)`);
