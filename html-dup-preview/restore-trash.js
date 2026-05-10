#!/usr/bin/env node
// Reads deletion-log.txt and moves all files back to their original locations.
const fs   = require('fs');
const path = require('path');

const LOG = path.join(__dirname, 'deletion-log.txt');

const lines = fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean);

let ok = 0, fail = 0;

for (const line of lines) {
  // Format: <timestamp>\t<dupId>\t<src>\t->\t<dst>
  const parts = line.split('\t');
  if (parts.length < 5) { console.warn('Skipping unparseable line:', line); continue; }
  const original = parts[2].trim();
  const trashed  = parts[4].trim();

  if (!fs.existsSync(trashed)) {
    console.error(`MISSING in trash: ${trashed}`);
    fail++;
    continue;
  }

  const dir = path.dirname(original);
  fs.mkdirSync(dir, { recursive: true });
  fs.renameSync(trashed, original);
  console.log(`Restored: ${original}`);
  ok++;
}

console.log(`\nDone. Restored: ${ok}, Failed: ${fail}`);
