# De-dup Plan for `new/`

## Goal

Produce a report of likely duplicate files in `new/`. No files are deleted or moved.
A false positive (marking a non-duplicate as a duplicate) is unacceptable.
Missing a duplicate is acceptable.

---

## Step 1 — Scan `new/` into a CSV

Write a lightweight scan script (`scan-new.js`) that walks all of `new/` with no exclusions and outputs a CSV.

**Output columns:**
- `file_name` — base filename (e.g. `DSC_1234.NEF`)
- `size_bytes` — from `fs.statSync().size` (exact, not derived from MB)
- `exif_date` — EXIF DateTimeOriginal date part (YYYY-MM-DD), or blank
- `exif_time` — EXIF DateTimeOriginal time part (HH:MM:SS), or blank
- `full_path` — absolute path

No exclusions. All ~41K files included.

---

## Step 2 — CSV-based duplicate analysis (no drive reads)

Write `find-dupes.js` that reads the scan CSV and groups files by the following signals. Each group gets a confidence level. No files are read from disk in this step.

### Signal tiers (highest to lowest confidence)

| Signal | Confidence |
|---|---|
| Same EXIF date+time + exact filename + same size_bytes | Very High |
| Same EXIF date+time + same size_bytes | High |
| Exact filename + same size_bytes, different folder | High |
| Collision-renamed pair: `DSC_1234.NEF` + `DSC_1234.2.NEF`, same size_bytes | High |
| Same size_bytes only (files >20 MB) | Medium — flagged for review only |

**Collision-rename detection:** a file whose name matches `/^(.+)\.\d+(\.[^.]+)$/` (e.g. `DSC_1234.2.NEF`) is a candidate pair with the file named `DSC_1234.NEF` in any folder.

---

## Step 3 — Hash confirmation (targeted drive reads)

For any candidate pairs from Step 2 where confirmation is wanted, hash only those specific files using SHA-256. Do not hash the full `new/` tree.

This keeps I/O minimal — reading a handful of files rather than all 41K.

Write results back into the report as `hash_confirmed: yes | no`.

---

## Step 4 — Report output

Output a CSV (`dupes-report.csv`) with one row per file in a duplicate group:

| Column | Description |
|---|---|
| `group_id` | Integer, same for all files in a group |
| `confidence` | very-high / high / medium |
| `signal` | Which rule matched |
| `file_name` | Base filename |
| `size_bytes` | File size |
| `exif_datetime` | Combined EXIF date+time or blank |
| `hash` | SHA-256 if computed, else blank |
| `hash_confirmed` | yes / no / pending |
| `full_path` | Path of this file |

Review the report manually before taking any action.

---

## Known duplicate sources

1. **Collision-rename logic** — `generate-manifest.js` appended `.2.` to filenames when two files resolved to the same destination path
2. **Manual copies** — files copied by hand before the pipeline ran
3. **Direct-copy dirs** — same image may appear in both a date-folder (from manifest) and a direct-copy dir (e.g. `Scanned Pictures/`, `dev-images/`)

---

## Scripts to write

| Script | Input | Output |
|---|---|---|
| `scan-new.js` | `new/` directory | `new-files.csv` |
| `find-dupes.js` | `new-files.csv` | `dupes-report.csv` |
| `hash-pairs.js` (optional) | `dupes-report.csv` + pairs to confirm | updated `dupes-report.csv` |

---

## Commands (in order)

```bash
# 1. Install dependencies (one time)
cd /home/carl/P/file-system-scripts/dedup-images
pnpm install

# 2. Scan new/ → new-files.csv  (reads EXIF from all ~41K files, takes ~10 min)
node scan-new.js new-files.csv

# 3. Find duplicates → dupes-report.csv  (CSV-only analysis, no drive reads, fast)
node find-dupes.js new-files.csv dupes-report.csv

# 4. Review dupes-report.csv before hashing

# 5. Hash flagged files to confirm duplicates (very-high + high confidence only)
node hash-pairs.js dupes-report.csv dupes-report.csv

# 5b. To also hash medium-confidence groups
node hash-pairs.js dupes-report.csv dupes-report.csv --all
```
