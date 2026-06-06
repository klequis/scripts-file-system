# File System Scripts

A hodpodge of scripts to work with the file system on a Linux computer

- Is a mix of Ubuntu/KDE & Fedora/KDE

## Index of Scripts

### Root

| Script | Description |
|---|---|
| [find-duplicate-files.sh](find-duplicate-files.sh) | Walk a directory and output a CSV of duplicate files grouped by content hash |
| [rsync-copy.sh](rsync-copy.sh) | Copy files from a source to a destination with rsync, logging to a timestamped log dir |
| [verify-copies.sh](verify-copies.sh) | SHA-256 verify that two directory trees are identical |

### compare-documents-with-meld/

| Script | Description |
|---|---|
| [compare.js](compare-documents-with-meld/compare.js) | Mount drive `A1-2026-05` if needed, then open `~/Documents` vs the drive's `Documents` in Meld |
| [compare-documents-with-meld.desktop](compare-documents-with-meld/compare-documents-with-meld.desktop) | KDE launcher for `compare.js` |

### dedup-images/

| Script | Description |
|---|---|
| [scan-new.js](dedup-images/scan-new.js) | Walk `new/` and output file name, size, EXIF date/time, and path to a CSV |
| [find-dupes.js](dedup-images/find-dupes.js) | Read `new-files.csv` and report likely duplicates (no disk I/O — CSV only) |
| [hash-pairs.js](dedup-images/hash-pairs.js) | Hash files in `dupes-report.csv` to confirm or deny duplicates |
| [add-dup-ids.js](dedup-images/add-dup-ids.js) | Add a `dup_file_id` column as the first column to `dupes-report.csv` |
| [bytes-saved.js](dedup-images/bytes-saved.js) | Sum bytes that would be saved by removing all duplicates in `dupes-report.csv` |

### html-dup-preview/

| Script | Description |
|---|---|
| [generate-review.js](html-dup-preview/generate-review.js) | Generate an HTML duplicate review page from `dupes-report.csv` |
| [server.js](html-dup-preview/server.js) | Serve the duplicate review UI at `http://localhost:3000` |
| [trash-all-dups.js](html-dup-preview/trash-all-dups.js) | Keep the first file in each dup group; move all others to trash |
| [restore-trash.js](html-dup-preview/restore-trash.js) | Read `deletion-log.txt` and restore all trashed files to their original locations |

### org-picture-files/

| Script | Description |
|---|---|
| [analyze-pictures.js](org-picture-files/analyze-pictures.js) | Full pipeline: scan files → read EXIF → apply date fallback → write CSV |
| [derive-dates.js](org-picture-files/derive-dates.js) | For rows marked `update=derive date`, extract a date from the filename and update the CSV |
| [add-review-column.js](org-picture-files/add-review-column.js) | Add a `review` column to the CSV, flagging `unknown`-date rows that may have a date in their path |
| [generate-manifest.js](org-picture-files/generate-manifest.js) | Read `test-output-6.csv` and write `copy-manifest.csv` with destination paths |
| [check-manifest.js](org-picture-files/check-manifest.js) | Sanity-check `copy-manifest.csv` before running the copy |
| [copy-by-date.js](org-picture-files/copy-by-date.js) | Copy files from `orig/` to `new/` using `copy-manifest.csv`; `--verify` mode checks copies |
| [compare-orig-new.js](org-picture-files/compare-orig-new.js) | Post-copy verification: confirm everything from `orig/` landed correctly in `new/` |