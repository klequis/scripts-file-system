# org-by-date — Plan

## Goal

Copy all 36,187 included files from `orig/` into `new/` organized by date and
time bucket, preserving every file and enabling cross-verification.

---

## Source / Destination

| | Path |
|---|---|
| Source | `/run/media/carl/A1-2026-05/orig/` |
| Destination | `/run/media/carl/A1-2026-05/new/` |
| CSV manifest | `test-output-5.csv` (36,187 rows, includes `size_mb`) |
| Tree plan | `grouped-by-date-time.md` |

Both are on the same HDD (`/dev/sda`), so this is a same-drive copy.

---

## Destination Folder Structure

```
new/
  YYYY/
    YYYY-MM-DD/               ← dates with ≤500 MB total
    YYYY-MM-DD/
      HH:MM:SS/               ← dates with >500 MB, split into time buckets
      HH:MM:SS/
  unknown/                    ← 677 files with no resolvable date
```

- Bucket size: 500 MB (same logic as grouped-by-date-time.md)
- Sidecar files (.xmp, .nksc) go into the **same folder as their image**
- If a sidecar has no matched image, it goes to `unknown/`

---

## File Count Summary

| Category | Count |
|---|---|
| Total included files | 36,187 |
| Sidecars following their image | 225 |
| Files with unknown date | 677 |
| Files with known date | 35,510 |

---

## Filename Convention

Every file with a time gets the time inserted into its filename:
- `DSC_0042.NEF` → `DSC_0042_14-32-07.NEF`
- `IMG_2301.jpg` → `IMG_2301_09-15-44.jpg`

If two files still collide after time insertion (burst at same second), append `-1`, `-2`:
- `DSC_0042_14-32-07.NEF`, `DSC_0042_14-32-07-1.NEF`, `DSC_0042_14-32-07-2.NEF`

Files with no time keep their original name; collisions among those also get `-1`, `-2`.

---

## Workflow

```
Step 1: generate-manifest.js
  reads test-output-5.csv
  computes all dest paths + new filenames
  writes copy-manifest.csv

Step 2: HUMAN REVIEW copy-manifest.csv

Step 3: copy-by-date.js
  reads copy-manifest.csv
  copies files, updates status column in-place
  temperature protection + resumability

Step 4: copy-by-date.js --verify
  re-reads copy-manifest.csv
  checks each new_path exists with matching size_bytes
  prints exception report (rows where status != copied)
```

---

## copy-manifest.csv Columns

| Column | Description |
|---|---|
| `file_id` | From test-output-5.csv |
| `orig_filename` | Original filename |
| `new_filename` | Renamed filename (`stem_HH-MM-SS.ext`, or `stem_HH-MM-SS-N.ext` if collision) |
| `orig_path` | Absolute source path (under `orig/`) |
| `new_path` | Absolute destination path (under `new/`) |
| `size_bytes` | File size — used for verification |
| `status` | `pending` → `copied` / `failed` / `skipped` |

Exception report = filter `status != copied` after the copy run.

---

## Drive Protection (copy-by-date.js)

Same pattern as `analyze-pictures.js`:

- **Background temp monitor**: every 30 seconds via `smartctl`
- **Work/rest cycle**: pause after every 5 minutes of active copying
- **Warn threshold**: 45°C
- **Abort/pause threshold**: 50°C — stop copying, wait until ≤42°C, resume
- **Resume**: re-read `copy-manifest.csv`, skip rows where `status = copied`

---

## Scripts

### `generate-manifest.js`

Reads `test-output-5.csv`, writes `copy-manifest.csv`. No file I/O on the HDD.

```bash
node generate-manifest.js
```

### `copy-by-date.js`

Reads `copy-manifest.csv`, performs the copy, updates `status`.

```bash
node copy-by-date.js            # full run (skips already-copied rows)
node copy-by-date.js --verify   # verification pass only, prints exceptions
```
