#!/usr/bin/env node
'use strict';

// generate-review.js — Generate an HTML duplicate review page from dupes-report.csv
// Usage: node generate-review.js [input.csv] [output.html] [--limit=N]
// Defaults: reads ../dedup-images/dupes-report.csv, writes review.html, limit 10

const fs    = require('fs');
const path  = require('path');
const exifr = require('exifr');

const posArgs = process.argv.slice(2).filter(a => !a.startsWith('--'));
const INPUT   = posArgs[0] || path.join(__dirname, '../dedup-images/dupes-report.csv');
const OUTPUT  = posArgs[1] || path.join(__dirname, 'review.html');

const limitArg = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : 10;

const DISPLAYABLE     = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
const RAW_EXT         = new Set(['.nef', '.cr2', '.cr3', '.arw', '.orf', '.dng', '.tif', '.tiff', '.rw2', '.pef', '.srw', '.heic']);
const MAX_DIRECT_BYTES = 2 * 1024 * 1024; // embed JPEGs directly only if < 2 MB

// ── CSV ────────────────────────────────────────────────────────────────────────

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
  return rows;
}

// ── Image preview ──────────────────────────────────────────────────────────────

async function getPreview(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  // Raw formats: extract embedded JPEG thumbnail via EXIF
  if (RAW_EXT.has(ext)) {
    try {
      const thumb = await exifr.thumbnail(filePath);
      if (thumb && thumb.length > 0)
        return 'data:image/jpeg;base64,' + Buffer.from(thumb).toString('base64');
    } catch { }
    return null;
  }

  // Displayable formats: embed directly if small, else try EXIF thumbnail
  if (DISPLAYABLE.has(ext)) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size <= MAX_DIRECT_BYTES) {
        const mime = (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : `image/${ext.slice(1)}`;
        return `data:${mime};base64,` + fs.readFileSync(filePath).toString('base64');
      }
      const thumb = await exifr.thumbnail(filePath);
      if (thumb && thumb.length > 0)
        return 'data:image/jpeg;base64,' + Buffer.from(thumb).toString('base64');
    } catch { }
  }

  return null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtSize(bytes) {
  const n = parseInt(bytes, 10);
  if (isNaN(n)) return bytes;
  const mb = n / (1024 * 1024);
  return mb >= 1000 ? (mb / 1024).toFixed(2) + ' GB' : mb.toFixed(1) + ' MB';
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── HTML generation ────────────────────────────────────────────────────────────

function generateHTML(groups) {
  const groupsHTML = groups.map(files => {
    const g = files[0];
    const filesHTML = files.map(f => {
      const imgTag = f._preview
        ? `<img src="${f._preview}" alt="${esc(f.file_name)}" />`
        : `<div class="no-preview">No preview available</div>`;

      const hashLine    = f.hash            ? `<div class="fhash">SHA-256: ${esc(f.hash.slice(0, 16))}…</div>` : '';
      const confirmedLine = f.hash_confirmed === 'yes' ? `<div class="confirmed">✓ Hash confirmed duplicate</div>`
                          : f.hash_confirmed === 'no'  ? `<div class="denied">✗ Hash mismatch — not a duplicate</div>`
                          : '';

      return `
        <div class="file-card">
          <div class="img-wrap">${imgTag}</div>
          <div class="meta">
            <div class="fname" title="${esc(f.full_path)}">${esc(f.file_name)}</div>
            <div class="fpath">${esc(f.full_path)}</div>
            <div class="fsize">${fmtSize(f.size_bytes)}</div>
            ${f.exif_datetime ? `<div class="fexif">${esc(f.exif_datetime)}</div>` : ''}
            ${hashLine}${confirmedLine}
          </div>
          <label class="del-label">
            <input type="checkbox" class="del-cb"
              data-path="${esc(f.full_path)}"
              data-id="${esc(f.dup_file_id)}" />
            Mark for deletion
          </label>
        </div>`;
    }).join('');

    return `
      <div class="group" id="group-${esc(g.group_id)}">
        <div class="group-hdr">
          <span class="gid">Group ${esc(g.group_id)}</span>
          <span class="badge badge-${esc(g.confidence)}">${esc(g.confidence)}</span>
          <span class="signal">${esc(g.signal)}</span>
          <span class="gcount">${files.length} files · ${fmtSize(files[0].size_bytes)} each</span>
        </div>
        <div class="files">${filesHTML}</div>
      </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Duplicate Review</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #111; color: #eee; padding: 1.5rem; }
  h1 { margin-bottom: .5rem; font-size: 1.4rem; }
  .subtitle { color: #6b7280; font-size: .85rem; margin-bottom: 1.25rem; }

  .toolbar { display: flex; gap: .75rem; align-items: center; margin-bottom: 1.75rem; flex-wrap: wrap; }
  button { padding: .45rem .9rem; border: none; border-radius: 6px; cursor: pointer; font-size: .9rem; font-weight: 500; }
  #export-btn { background: #2563eb; color: #fff; }
  #export-btn:hover { background: #1d4ed8; }
  #clear-btn  { background: #374151; color: #eee; }
  #clear-btn:hover { background: #4b5563; }
  .count { font-size: .85rem; color: #9ca3af; margin-left: auto; }

  .group { background: #1f2937; border-radius: 10px; margin-bottom: 1.5rem; overflow: hidden; }
  .group-hdr { display: flex; align-items: center; gap: .75rem; padding: .7rem 1rem; background: #111827; flex-wrap: wrap; }
  .gid { font-weight: 600; font-size: .9rem; color: #e5e7eb; }
  .badge { font-size: .72rem; padding: .2rem .5rem; border-radius: 999px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; }
  .badge-very-high { background: #7f1d1d; color: #fca5a5; }
  .badge-high      { background: #78350f; color: #fcd34d; }
  .badge-medium    { background: #1e3a5f; color: #93c5fd; }
  .signal { font-size: .8rem; color: #9ca3af; }
  .gcount { margin-left: auto; font-size: .78rem; color: #6b7280; white-space: nowrap; }

  .files { display: flex; flex-wrap: wrap; gap: 1rem; padding: 1rem; }
  .file-card { background: #0d1117; border-radius: 8px; padding: .75rem; width: 280px; display: flex; flex-direction: column; gap: .5rem; border: 1px solid #1f2937; }
  .img-wrap { width: 100%; height: 200px; display: flex; align-items: center; justify-content: center; background: #111827; border-radius: 6px; overflow: hidden; }
  .img-wrap img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .no-preview { color: #4b5563; font-size: .78rem; text-align: center; }
  .meta { display: flex; flex-direction: column; gap: .25rem; font-size: .78rem; }
  .fname { font-weight: 600; font-size: .85rem; word-break: break-all; color: #f3f4f6; }
  .fpath { color: #4b5563; word-break: break-all; font-size: .7rem; line-height: 1.4; }
  .fsize { color: #a3e635; font-weight: 500; }
  .fexif { color: #94a3b8; }
  .fhash { color: #374151; font-size: .68rem; font-family: monospace; }
  .confirmed { color: #4ade80; font-size: .75rem; }
  .denied    { color: #f87171; font-size: .75rem; }

  .del-label { display: flex; align-items: center; gap: .4rem; font-size: .82rem; cursor: pointer; padding: .35rem .5rem; border-radius: 6px; transition: background .15s; margin-top: auto; }
  .del-label:hover { background: #1f2937; }
  .del-label:has(input:checked) { background: #450a0a; color: #fca5a5; }
  .del-label input { width: 1rem; height: 1rem; cursor: pointer; accent-color: #ef4444; flex-shrink: 0; }
</style>
</head>
<body>
<h1>Duplicate Review</h1>
<p class="subtitle">Showing ${groups.length} groups · Check files to mark for deletion · Export generates a text file of paths</p>
<div class="toolbar">
  <button id="export-btn" onclick="exportList()">Export delete list</button>
  <button id="clear-btn"  onclick="clearAll()">Clear all</button>
  <span class="count" id="sel-count">0 files selected</span>
</div>
<div id="groups">
${groupsHTML}
</div>
<script>
  document.addEventListener('change', updateCount);
  function updateCount() {
    const n = document.querySelectorAll('.del-cb:checked').length;
    document.getElementById('sel-count').textContent = n + ' file' + (n !== 1 ? 's' : '') + ' selected';
  }
  function exportList() {
    const cbs = document.querySelectorAll('.del-cb:checked');
    if (!cbs.length) { alert('No files selected.'); return; }
    const lines = Array.from(cbs).map(cb => cb.dataset.id + '\\t' + cb.dataset.path);
    const blob = new Blob([lines.join('\\n') + '\\n'], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'delete-list.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  function clearAll() {
    document.querySelectorAll('.del-cb').forEach(cb => cb.checked = false);
    updateCount();
  }
</script>
</body>
</html>`;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Reading ${INPUT}...`);
  const rows = parseCSV(fs.readFileSync(INPUT, 'utf8'));
  console.log(`${rows.length} rows loaded.`);

  // Group by group_id, preserve CSV order
  const groupMap = new Map();
  for (const row of rows) {
    if (!groupMap.has(row.group_id)) groupMap.set(row.group_id, []);
    groupMap.get(row.group_id).push(row);
  }

  const groups = [...groupMap.values()].slice(0, LIMIT);
  const totalFiles = groups.reduce((s, g) => s + g.length, 0);
  console.log(`Generating previews for ${groups.length} groups (${totalFiles} files)...`);

  for (let gi = 0; gi < groups.length; gi++) {
    for (const f of groups[gi]) {
      process.stdout.write(`  [group ${gi + 1}/${groups.length}] ${path.basename(f.full_path)}...`);
      try {
        f._preview = await getPreview(f.full_path);
        console.log(f._preview ? ' ok' : ' no preview');
      } catch (e) {
        f._preview = null;
        console.log(` error: ${e.message}`);
      }
    }
  }

  const html = generateHTML(groups);
  fs.writeFileSync(OUTPUT, html);
  console.log(`\nWritten: ${OUTPUT}`);
  console.log(`Open:    file://${path.resolve(OUTPUT)}`);
}

main().catch(err => { console.error(err); process.exit(1); });
