# analyze-pictures.js

Scans `/run/media/carl/A1-2026-05` and produces a CSV with one row per file.

## Usage

```bash
node analyze-pictures.js [output.csv] [--limit N]
```

`--limit N` processes only the first N files (for test runs).

## Output columns

| Column | Description |
|---|---|
| `file_id` | Sequential unique integer for every file |
| `folder_name` | Name of the immediate parent folder |
| `file_name` | File name |
| `full_path` | Absolute path |
| `date` | Best available date (`YYYY-MM-DD`) or `unknown` |
| `date_source` | How the date was found (see below) |
| `time` | Time of capture (`HH:MM:SS`, 24-hr) if available, else empty |
| `sidecar_file` | For sidecar files (`.xmp`, `.nksc`): `file_id` of the associated image. Empty for all other files. |

## Date / time resolution (in priority order)

1. **EXIF** — reads `DateTimeOriginal` from the file header (first 64 KB). Covers `.jpg`, `.jpeg`, `.nef`, `.cr2`, `.cr3`, `.arw`, `.orf`, `.dng`, `.tiff`, `.tif`, `.heic`, `.rw2`, `.pef`, `.srw`. Both date and time come from EXIF.
2. **Filename — compact datetime** — `20080829163036_DSC4374.NEF` → date `2008-08-29`, time `16:30:36`
3. **Filename — compact date** — `20140214_DSC7142.nef` → date `2014-02-14`
4. **Filename — separated date** — `2014-02-14_foo.jpg`, `2014.02.14`, `2014_02_14`
5. **Filename — MM-DD-YYYY** — `12-08-2009 09;39;54PM.jpg` → date `2009-12-08`, time `21:39:54`
6. **Filename — YYYY-M-D-seq** — `2006-12-3-9.JPG` (last number is sequence, not day) → date `2006-12-03`
7. **Filename — date in middle** — `DSC_2005-01-08_0021.jpg` → date `2005-01-08`
8. **Parent folder name** — applies any of the above patterns to the immediate parent folder
9. **Ancestor folder names** — walks up the tree; stops at a bare 4-digit year folder (e.g. `2001`) or the root

`date_source` values: `exif`, `filename`, `folder`, `ancestor`, `unknown`

## XMP / NKSC sidecar matching

After the file list is built, each `.xmp` or `.nksc` file is matched to its image by looking up the base name in the same directory:
- `DSC4374.NEF.xmp` → matches `DSC4374.NEF`
- `DSC4374.xmp` → matches `DSC4374.NEF`, `DSC4374.CR2`, etc. (any image extension)

The sidecar row's `sidecar_file` column contains the `file_id` of the matched image. If no match is found, `sidecar_file` is empty.

## Drive protection

- **Work/rest cycle**: 5 minutes of active EXIF reads, then rest until drive cools to ≤42°C
- **Background monitor**: checks drive temp (`/dev/sda` via `smartctl`) every 30 seconds
  - ≥45°C: warning printed
  - ≥50°C: saves checkpoint and exits with error
- **Resumable**: on abort, re-run the same command to continue from the checkpoint

## Excluded folders

- `2022.sophie-slide-show`
- `daniel`
- `dev-images`
- `digikam-db`
- `Scanned Pictures`
- `.dtrash` (any depth in the tree)

## Excluded file extensions

`.tst`, `.BridgeSort`, `.lnk`, `.trashinfo`, `.uuid`
