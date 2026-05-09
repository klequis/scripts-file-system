# TODO — Next Session

## Rules

- NO FILES WILL BE DELETED


## Where We Left Off

- `analyze-pictures.js` — scans drive, outputs CSV
- `generate-manifest.js` — reads CSV, produces `copy-manifest.csv` with all dest paths
- `copy-by-date.js` — not written yet; reads manifest, performs the copy
- Last good scan: `test-output-5.csv` (user-modified), 36,187 files — **stale, needs rescan**
- Last manifest: `copy-manifest.csv` — **stale**, needs to be regenerated after all changes below
- **ROOT path**: `/run/media/carl/A1-2026-05/orig/` (all files are here now)
- **Dest root**: `/run/media/carl/A1-2026-05/new/`
- **Current file count on drive**: 41,570 (confirmed by `find -type f` and Dolphin)
- **`EXPECTED_TOTAL` in script**: 41,570 ✓

---

## Tasks

### 1. Exclude `.Trash-1000` from scan (**DONE**)
- **Status**: Done in `analyze-pictures.js` — `.Trash-1000` added alongside `.dtrash` exclusion
- This removes: 33 × `.pdf (1)`, 3 × `.mhtml (1)`, 1 × `.gz`, 1 × `.md (1)`, 2 × `.txt (1)`, 1 × `directorysizes` (no ext)

### 2. Investigate `.tmp` files — YOU decide what to do with them (**DONE**)
```
/run/media/carl/A1-2026-05/2007/20070507_07May02.Grand Canyon/Nkf6F8D.tmp
/run/media/carl/A1-2026-05/2007/20080228_1744/Nkf20FD.tmp
/run/media/carl/A1-2026-05/2007/wall picture/Nkf6E78.tmp
```
Check: file size, whether a matching NEF exists in the same folder, whether they open as anything useful.
After you decide: either add `.tmp` to `EXCLUDED_EXTENSIONS` (skip in scan) or leave them to copy into `other/`.

### 3. Exclude `.db` files (**DONE**)

All .db files have been deleted

### 4. Exclude `.BridgeSort` dotfiles (no extension — 5 files)  (**DONE**)

All .BridgeSort files have been deleted

### 5. Add `.lst` to excluded extensions  (**DONE**)

All deleted

### 6. Separate destination folders: photos / videos / other
Change the output structure from one tree to three:
```
new/
  photos/
    YYYY/YYYY-MM-DD/[HH:MM:SS/]
    unknown/
  videos/
    YYYY/YYYY-MM-DD/[HH:MM:SS/]
    unknown/
  other/
    (flat or by original folder — TBD)
```

**Photo extensions** (keep in `photos/`):
`.nef`, `.jpg`, `.jpeg`, `.jpe`, `.tif`, `.tiff`, `.dng`, `.bmp`, `.png`, `.gif`, `.psd`, `.psp`, `.webp`, `.heic`, `.rw2`, `.cr2`, `.cr3`, `.arw`, `.orf`, `.pef`, `.srw`

**Video extensions** (keep in `videos/`):
`.mp4`, `.mov`, `.avi`, `.3g2`, `.nar`

**Sidecar extensions** (move with their paired image into the same destination folder):
`.xmp`, `.nksc`, `.wav` (Nikon audio notes — paired by matching `DSC####` stem in filename)

> **`analyze-pictures.js` changes needed for `.wav`:**
> Currently sidecar detection only handles `.xmp` and `.nksc` (matched by exact stem to a same-folder image).
> `.wav` pairing is different — the stem is embedded mid-filename: `20080704105826_DSC3264.WAV` pairs with `DSC3264.NEF`.
> Need to add a `.wav` pairing pass that extracts the `DSC####` token from the wav filename and looks for a matching NEF in the same folder.
>
> **New CSV column `wav_file`** (inserted after `sidecar_file`):
> - A `.wav` row fills `wav_file` with the matched NEF's `file_id`, leaves `sidecar_file` empty
> - An `.xmp`/`.nksc` row fills `sidecar_file`, leaves `wav_file` empty
> - A NEF can have both an `.xmp` sidecar AND a `.wav` audio note — no column conflict
>
> Updated column order: `file_id, folder_name, file_name, full_path, date, date_source, time, sidecar_file, wav_file, size_mb`

**Other** (copy to `other/`, keep for later review):
`.pdf`, `.zip`, `.txt`, `.doc`, `.pps`, `.apk`, `.psp` (if not treated as photo)

### 7. Direct-copy directories (handled separately, at the end)

These directories are excluded from the CSV scan and will be copied as-is to `new/` at the very end:

| Source | Destination |
|--------|-------------|
| `orig/Scanned Pictures/` | `new/Scanned Pictures/` |
| `orig/dev-images/` | `new/dev-images/` |
| `orig/daniel/` | `new/daniel/` |
| `orig/2022.sophie-slide-show/` | `new/2022.sophie-slide-show/` |
| `orig/of-daniel.tmp/` | `new/of-daniel.tmp/` |

`digikam-db/` has been deleted — no longer on the drive.

These are already excluded in `analyze-pictures.js` via the `EXCLUDED` set (except `of-daniel.tmp` — needs to be added).

### 8. After YOU make any filesystem changes → rescan
`test-output-5.csv` becomes stale the moment any file on the drive is added, moved, or removed.
Run a fresh scan: `node analyze-pictures.js test-output-6.csv` (increment the number to keep the old one).
Do this after all the decisions above are settled.

### 9. Regenerate `copy-manifest.csv`
Run `generate-manifest.js` after the new scan. Update it to handle the photos/videos/other split.

### 10. Write `copy-by-date.js`
See `org-by-date.md` for full plan. Reads `copy-manifest.csv`, copies files, updates `status`, temp protection, resumable.

---

## File Extension Reference (**UPDATED**)

Full list from `test-output-5.csv` (36,187 files, pre-cleanup):




**All deletions are done. DO NOT delete any more files.**


| Count | Extension | Type | Action |
|------:|-----------|------|--------|
| 27144 | `.nef` | RAW photo | photos/ |
|  7992 | `.jpg` | photo | photos/ |
|   147 | `.tif` | photo | photos/ |
|    42 | `.psd` | Photoshop | photos/ |
|    18 | `.bmp` | photo | photos/ |
|    16 | `.png` | photo | photos/ |
|    14 | `.gif` | photo | photos/ |
|     7 | `.jpe` | photo | photos/ |
|     4 | `.psp` | Paint Shop Pro | photos/ |
|     3 | `.dng` | RAW photo | photos/ |
|     3 | `.jpeg` | photo | photos/ |
|     1 | `.webp` | photo | photos/ |
|   233 | `.mp4` | video | videos/ |
|   173 | `.mov` | video | videos/ |
|    14 | `.nar` | Windows Phone Smart Camera video | videos/ |
|    12 | `.avi` | video | videos/ |
|     1 | `.3g2` | video | videos/ |
|   225 | `.xmp` | sidecar | with image |
|    45 | `.nksc` | sidecar (Nikon) | with image |
|    12 | `.wav` | Nikon audio note (paired with NEF) | with image (sidecar) |
|    13 | `.pdf` | document | other/ |
|     7 | `.zip` | archive | other/ |
|     4 | `.txt` | text | other/ |
|     2 | `.apk` | Android app | other/ |
|     1 | `.doc` | Word doc | other/ |
|     1 | `.pps` | PowerPoint | other/ |
|     0 deleted 6 | (no ext) | `.BridgeSort` dotfiles + 1 Trash file | exclude |
|     6 deleted 1 | `.db`  | Thumbs.db / DigiKam db | exclude from scan |
|     0 dleted 1 | `.lst` | Adobe font cache | exclude |
|    0 deleted 33 | `.pdf (1)` | trash copy artifact | excluded (.Trash-1000) |
|     3 | `.mhtml (1)` | trash web archive | excluded (.Trash-1000) |
|     2 | `.txt (1)` | trash copy artifact | excluded (.Trash-1000) |
|     1 | `.gz` | archive (in Trash) | excluded (.Trash-1000) |
|     1 | `.md (1)` | trash copy artifact | excluded (.Trash-1000) |
|     0 deleted 3 | `Nkf*.tmp` | Nikon transfer temp files | deleted |
|     2 | `.tmp` (dirs) | `Protect.tmp/`, `of-daniel.tmp/` — contain real files | scan contents normally / direct-copy |


**Already excluded by `analyze-pictures.js`:**
`.bridgesort`, `.tst`, `.lnk`, `.trashinfo`, `.uuid`

---

## Notes on `.nar` files
14 files, all named `WP_YYYYMMDD_HH_MM_SS_Smart.nar` — Windows Phone Smart Camera format.
These are motion photo / video clips from a Nokia/Windows Phone. All from:
`/run/media/carl/A1-2026-05/2016/20160421.phone.download.all/misc/`
Treat as video.

## Notes on `.wav` files
12 files — Nikon "audio annotation" feature (DSC*.WAV paired with NEF files).
Named like `20080704105826_DSC3264.WAV`. Treat as sidecars — go into the same destination folder as their paired NEF.
Pairing logic: match on the `DSC####` stem embedded in the filename.
