# Org Picture Files by Date in Smaller Buckets

- Files are on `/dev/sda1`
- Mounted at `/run/media/carl`

Excluded Folders
- /run/media/carl/A1-2026-05/2022.sophie-slide-show
- /run/media/carl/A1-2026-05/daniel
- /run/media/carl/A1-2026-05/dev-images
- /run/media/carl/A1-2026-05/digikam-db
- /run/media/carl/A1-2026-05/Scanned Pictures


## Current Task

Write one script (`analyze-pictures.js`) that processes each file exactly once:

1. **Scan & date** — Walk `/run/media/carl/A1-2026-05` recursively (excluding the listed folders). For each eligible image file, attempt to read EXIF `DateTimeOriginal` immediately. If found, that is the date — done.
2. **Fallback chain** — If no EXIF (or not an image), determine the date by: filename → parent folder name → ancestor folder names (stopping at a bare 4-digit year or the root). If none found, date is `"unknown"`.
3. **Drive protection** — 5-minute work / rest-until-cool (≤42°C) cycle during the scan. Background temp monitor every 30s: warn at 45°C, abort and save checkpoint at 50°C. Resumable on restart.
4. **Write CSV** — Output columns: `folder_name`, `file_name`, `full_path`, `date`, `date_source` (one of: `exif`, `filename`, `folder`, `ancestor`, `unknown`)
5. **Print stats** — Total files, breakdown by `date_source`, EXIF by extension

Script accepts an optional `--limit N` parameter to process only the first N files (for test runs).

## Original Task

I have the same files that were 510 GB and are now down to 403 GB. That is still a lot of data.

I want to do analysis of how many files have dates.

- Many of the files have dates in their name. 
- Other files that don't have dates in their name are in folders that have dates.
- If a file does not have a date but the folder does the folder date is to be treated as the date the file was created (i.e., picture taken/created).
- If I file has a date in its name but the folder containing it has a different date the date in the filename takes precedence.

The output will be a .csv file with columns
- folder_name
- file_name
- full_path
- created_date (using the logic expressed above)

- created_date will use the logic expressed above
- if neither the filename nore the folder has a date then the create_date column will contain "unknown".