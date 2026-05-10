#!/usr/bin/env node
'use strict';

// server.js — Duplicate review server
// Usage: node server.js [dupes-report.csv]
// Opens: http://localhost:3000

const express      = require('express');
const fs           = require('fs');
const path         = require('path');
const exifr        = require('exifr');
const { execFile } = require('child_process');

const NEF_THUMB_BIN = path.join(__dirname, 'nef-thumb');
const NEF_THUMB_MAX = '1200';   // max dimension passed to the binary

// ── Config ─────────────────────────────────────────────────────────────────────

const PORT            = 3000;
const CSV_PATH        = process.argv[2] || path.join(__dirname, '../dedup-images/dupes-report.csv');
const GROUPS_PER_PAGE = 1;
const DELETION_LOG    = path.join(__dirname, 'deletion-log.txt');

const DISPLAYABLE = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
const RAW_EXT     = new Set(['.nef', '.cr2', '.cr3', '.arw', '.orf', '.dng', '.tif', '.tiff', '.rw2', '.pef', '.srw', '.heic']);

// Only files under these top-level subdirs (inside new/) may be deleted.
// Albums are expected to contain duplicates and are protected.
const ALLOWED_SUBDIRS = new Set(['photos', 'videos', 'other']);

function isDeletable(fullPath) {
  // Path structure: <driveRoot>/new/<subdir>/...
  // Match the segment immediately after /new/
  const m = fullPath.match(/\/new\/([^/]+)\//); 
  return m ? ALLOWED_SUBDIRS.has(m[1]) : false;
}

// ── CSV parsing ────────────────────────────────────────────────────────────────

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

// ── Load data ──────────────────────────────────────────────────────────────────

console.log(`Loading ${CSV_PATH}...`);
const rows    = parseCSV(fs.readFileSync(CSV_PATH, 'utf8'));
const byId    = new Map();   // dup_file_id → row
const groupMap = new Map();  // group_id    → row[]
const deleted  = new Set();  // dup_file_ids moved to trash this session

let driveRoot = null;

let autoIdSeq = 0;
for (const row of rows) {
  // Skip files outside allowed subdirs — they are album dirs expected to have duplicates
  if (!isDeletable(row.full_path)) continue;
  // Skip hash mismatches — content differs, so they are not duplicates
  if (row.hash_confirmed === 'no') continue;
  // Skip files that no longer exist on disk (already moved to trash)
  if (!fs.existsSync(row.full_path)) continue;

  // Generate id if column is missing
  if (!row.dup_file_id) row.dup_file_id = `autoId${String(++autoIdSeq).padStart(4, '0')}`;
  byId.set(row.dup_file_id, row);

  if (!groupMap.has(row.group_id)) groupMap.set(row.group_id, []);
  groupMap.get(row.group_id).push(row);

  // Derive drive root from first recognisable path
  if (!driveRoot && row.full_path) {
    const m = row.full_path.match(/^(.+?)\/(new|orig)\//);
    if (m) driveRoot = m[1];
  }
}

// Drop groups that have only one file after filtering (nothing to compare)
const groupList  = [...groupMap.values()].filter(g => g.length > 1);
const totalGroups = groupList.length;
const totalPages  = Math.ceil(totalGroups / GROUPS_PER_PAGE);
const TRASH_DIR   = driveRoot ? path.join(driveRoot, '_review_trash') : null;

console.log(`  ${rows.length} rows · ${totalGroups} groups · ${totalPages} pages`);
if (TRASH_DIR) console.log(`  Trash:  ${TRASH_DIR}`);
else console.warn('  [WARN] Could not determine trash directory from CSV paths');

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtSize(bytes) {
  const n = parseInt(bytes, 10);
  if (isNaN(n)) return '';
  const mb = n / (1024 * 1024);
  return mb >= 1000 ? (mb / 1024).toFixed(2) + ' GB' : mb.toFixed(1) + ' MB';
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── HTML ───────────────────────────────────────────────────────────────────────

const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #111; color: #eee; padding: 1.5rem; }
.navbar { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; padding: .6rem .8rem; background: #1f2937; border-radius: 8px; }
.nav-btn { padding: .4rem .85rem; background: #374151; color: #e5e7eb; border-radius: 6px; text-decoration: none; font-size: .88rem; white-space: nowrap; }
.nav-btn:hover { background: #4b5563; }
.nav-btn.disabled { opacity: .3; pointer-events: none; }
.pageinfo { color: #9ca3af; font-size: .82rem; margin: 0 auto; text-align: center; }
.group { background: #1f2937; border-radius: 10px; margin-bottom: 1.5rem; overflow: hidden; }
.group-hdr { display: flex; align-items: center; gap: .75rem; padding: .65rem 1rem; background: #111827; flex-wrap: wrap; }
.gid { font-weight: 700; font-size: .88rem; color: #e5e7eb; }
.badge { font-size: .7rem; padding: .2rem .5rem; border-radius: 999px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; }
.badge-very-high { background: #7f1d1d; color: #fca5a5; }
.badge-high      { background: #78350f; color: #fcd34d; }
.badge-medium    { background: #1e3a5f; color: #93c5fd; }
.signal { font-size: .78rem; color: #9ca3af; }
.gcount { margin-left: auto; font-size: .75rem; color: #6b7280; white-space: nowrap; }
.files { display: flex; flex-wrap: wrap; gap: 1rem; padding: 1rem; align-items: stretch; }
.file-card { background: #0d1117; border-radius: 8px; padding: .75rem; width: 500px; max-width: 100%; display: flex; flex-direction: column; gap: .5rem; border: 1px solid #1f2937; transition: opacity .2s; }
.file-card.gone { display: none; }
.img-wrap { width: 100%; height: 360px; display: flex; align-items: center; justify-content: center; background: #111827; border-radius: 6px; overflow: hidden; position: relative; }
.img-wrap img { max-width: 100%; max-height: 100%; object-fit: contain; }
.no-preview { display: none; flex-direction: column; align-items: center; justify-content: center; gap: .4rem; color: #4b5563; font-size: .8rem; text-align: center; height: 100%; width: 100%; padding: 1rem; }
.no-preview .np-icon { font-size: 2rem; opacity: .4; }
.meta { display: flex; flex-direction: column; gap: .28rem; font-size: .76rem; flex: 1; }
.fname { font-weight: 600; font-size: .88rem; word-break: break-all; color: #f3f4f6; }
.fpath { color: #e5e7eb; word-break: break-all; font-size: .78rem; line-height: 1.4; }
.fsize { color: #a3e635; font-weight: 600; }
.fexif { color: #94a3b8; }
.hash-yes { color: #4ade80; font-size: .74rem; }
.hash-no  { color: #f87171; font-size: .74rem; }
.del-btn { padding: .5rem 0; background: #7f1d1d; color: #fca5a5; border: none; border-radius: 6px; cursor: pointer; font-size: .88rem; font-weight: 700; width: 100%; margin-top: auto; letter-spacing: .02em; transition: background .15s; }
.del-btn:hover:not(:disabled) { background: #991b1b; }
.del-btn:disabled { opacity: .35; cursor: not-allowed; }
`;

function renderCard(f) {
  const hashBadge = f.hash_confirmed === 'yes' ? '<div class="hash-yes">✓ Hash confirmed duplicate</div>'
                  : f.hash_confirmed === 'no'  ? '<div class="hash-no">✗ Hash mismatch — review carefully</div>'
                  : '';
  return `
    <div class="file-card" id="card-${esc(f.dup_file_id)}">
      <div class="img-wrap">
        <img
          src="/thumb/${esc(f.dup_file_id)}"
          loading="lazy"
          alt="${esc(f.file_name)}"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
        />
        <div class="no-preview"><span class="np-icon">🖼</span>No embedded preview</div>
      </div>
      <div class="meta">
        <div class="fname" title="${esc(f.full_path)}">${esc(f.file_name)}</div>
        <div class="fpath">${esc(f.full_path)}</div>
        <div class="fsize">${fmtSize(f.size_bytes)}</div>
        ${f.exif_datetime ? `<div class="fexif">${esc(f.exif_datetime)}</div>` : ''}
        ${hashBadge}
      </div>
      <button class="del-btn" onclick="delFile('${esc(f.dup_file_id)}','${esc(f.file_name).replace(/'/g, "\\'")}')">Move to Trash</button>
    </div>`;
}

function renderGroup(files) {
  const live = files.filter(f => !deleted.has(f.dup_file_id));
  if (live.length === 0) return '';
  const g = files[0];
  return `
  <div class="group" id="group-${esc(g.group_id)}">
    <div class="group-hdr">
      <span class="gid">Group ${esc(g.group_id)}</span>
      <span class="badge badge-${esc(g.confidence)}">${esc(g.confidence)}</span>
      <span class="signal">${esc(g.signal)}</span>
      <span class="gcount">${live.length} file${live.length !== 1 ? 's' : ''} · ${fmtSize(g.size_bytes)} each</span>
    </div>
    <div class="files">${live.map(renderCard).join('')}</div>
  </div>`;
}

function renderPage(pageNum, pageGroups) {
  const prev = pageNum > 1         ? `<a href="/page/${pageNum - 1}" class="nav-btn">← Prev</a>` : '<span class="nav-btn disabled">← Prev</span>';
  const next = pageNum < totalPages ? `<a href="/page/${pageNum + 1}" class="nav-btn">Next →</a>` : '<span class="nav-btn disabled">Next →</span>';
  const info = `<span class="pageinfo">Page ${pageNum} of ${totalPages} &nbsp;·&nbsp; ${totalGroups} groups</span>`;
  const nav  = `<div class="navbar">${prev}${info}${next}</div>`;
  const body = pageGroups.map(renderGroup).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Dup Review — ${pageNum} / ${totalPages}</title>
<style>${CSS}</style>
</head>
<body>
${nav}
<div id="groups">${body}</div>
${nav}
<script>
const PAGE = ${pageNum};
const TOTAL_PAGES = ${totalPages};

document.addEventListener('keydown', e => {
  if (e.key === 'PageDown' && PAGE < TOTAL_PAGES) { e.preventDefault(); location.href = '/page/' + (PAGE + 1); }
  if (e.key === 'PageUp'   && PAGE > 1)            { e.preventDefault(); location.href = '/page/' + (PAGE - 1); }
});

async function delFile(id, name) {
  const card = document.getElementById('card-' + id);
  const btn  = card.querySelector('.del-btn');
  btn.disabled = true;
  btn.textContent = 'Moving…';
  try {
    const r = await fetch('/file/' + encodeURIComponent(id), { method: 'DELETE' });
    const j = await r.json();
    if (j.ok) {
      card.classList.add('gone');
      const grp = card.closest('.group');
      if (grp && !grp.querySelector('.file-card:not(.gone)')) grp.style.display = 'none';
    } else {
      alert('Error: ' + (j.error || 'unknown'));
      btn.disabled = false;
      btn.textContent = 'Move to Trash';
    }
  } catch(e) {
    alert('Network error: ' + e.message);
    btn.disabled = false;
    btn.textContent = 'Move to Trash';
  }
}
</script>
</body>
</html>`;
}

// ── Routes ─────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.get('/', (_, res) => res.redirect('/page/1'));

app.get('/page/:n', (req, res) => {
  const page = parseInt(req.params.n, 10);
  if (isNaN(page) || page < 1 || page > totalPages)
    return res.status(404).send('Page not found');
  const start      = (page - 1) * GROUPS_PER_PAGE;
  const pageGroups = groupList.slice(start, start + GROUPS_PER_PAGE);
  res.send(renderPage(page, pageGroups));
});

app.get('/thumb/:id', (req, res) => {
  const row = byId.get(req.params.id);
  if (!row) return res.status(404).end();
  const fp  = row.full_path;
  const ext = path.extname(fp).toLowerCase();

  if (DISPLAYABLE.has(ext)) {
    res.set('Cache-Control', 'public, max-age=3600');
    return res.sendFile(fp);
  }

  if (RAW_EXT.has(ext)) {
    // Check binary exists
    if (!fs.existsSync(NEF_THUMB_BIN)) {
      console.error('nef-thumb binary not found — run: make (in html-dup-preview/)');
      return res.status(503).end();
    }
    execFile(NEF_THUMB_BIN, [fp, NEF_THUMB_MAX], { encoding: 'buffer', timeout: 15000 },
      (err, stdout, stderr) => {
        if (err) {
          console.error('nef-thumb failed:', stderr.toString().trim(), fp);
          return res.status(404).end();
        }
        res.set('Content-Type', 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=3600');
        res.send(stdout);
      }
    );
    return;
  }

  res.status(404).end();
});

app.delete('/file/:id', (req, res) => {
  const row = byId.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'ID not found' });
  if (deleted.has(row.dup_file_id)) return res.json({ ok: true, already: true });

  const fp = row.full_path;
  if (!isDeletable(fp))
    return res.status(403).json({ error: 'File is in a protected album folder — deletion blocked' });
  if (!fs.existsSync(fp)) {
    deleted.add(row.dup_file_id);
    return res.json({ ok: true, note: 'File already gone from disk' });
  }
  if (!TRASH_DIR)
    return res.status(500).json({ error: 'Could not determine trash directory' });

  try {
    const rel       = path.relative(driveRoot, fp);
    const trashPath = path.join(TRASH_DIR, rel);
    fs.mkdirSync(path.dirname(trashPath), { recursive: true });
    fs.renameSync(fp, trashPath);
    deleted.add(row.dup_file_id);
    const logLine = `${new Date().toISOString()}\t${row.dup_file_id}\t${fp}\t->\t${trashPath}\n`;
    fs.appendFileSync(DELETION_LOG, logLine);
    res.json({ ok: true, trashPath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  http://localhost:${PORT}\n`);
  console.log(`  Deletions are moved to: ${TRASH_DIR || '(unknown)'}`);
  console.log(`  Deletion log:           ${DELETION_LOG}`);
  console.log(`\n  Ctrl+C to stop.\n`);
});
