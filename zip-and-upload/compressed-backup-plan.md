# Compressed Backup Plan — Convert NEF to JPEG before upload

## The "flat NEF" problem

NEF files are raw sensor data with no in-camera processing applied. When decoded
naively they look flat, desaturated, and low-contrast. This is because:

- No tone curve applied (linear light looks flat)
- No Nikon "Picture Control" color profile (Standard, Vivid, etc.)
- White balance may not be set
- No sharpening or noise reduction

To look good, each NEF must go through a processing pipeline that applies at minimum:
a tone curve, white balance, and a color profile. Nikon's in-camera JPEG is the
reference — the goal is to reproduce that look automatically across 27,144 files.

---

## File size estimates

Nikon NEFs average ~12 MB each. 27,144 files ≈ ~325 GB of NEFs.
(Remaining ~76 GB is JPEGs, TIFs, videos, and other files.)

| Format | Quality | Avg size | Est. total (NEFs only) | Reduction |
|---|---|---|---|---|
| NEF (original) | lossless | ~12 MB | ~325 GB | — |
| JPEG | 95 (high) | ~5–8 MB | ~135–220 GB | 30–60% |
| JPEG | 85 (medium) | ~3–5 MB | ~80–135 GB | 55–75% |
| JPEG | 75 (standard) | ~2–3 MB | ~55–80 GB | 75–85% |
| WebP | 85 | ~3–5 MB | ~80–135 GB | 55–75% |

WebP is slightly better compression than JPEG at the same visual quality, but
viewer/software support is less universal than JPEG for older photos.

---

## Tool options

### 1. darktable (recommended)

- **Best output quality** — applies Nikon camera color profiles, tone mapping,
  white balance, noise reduction
- Has `darktable-cli` for batch/scriptable processing
- Can apply a "style" (preset) to all files for consistent look
- Produces output closest to Nikon's in-camera JPEG
- Fedora: `sudo dnf install darktable`

```bash
# Export a single NEF with a style applied
darktable-cli input.nef output.jpg --style "your-style-name"

# Batch export a folder
darktable-cli /path/to/nefs/ /path/to/output/ \
  --style "your-style-name" \
  --export-format jpeg \
  --export-quality 85
```

**Getting a good look:**
- Import a few NEFs into the darktable GUI
- Apply the "sigmoid" or "filmic rgb" tone mapper (modern, handles highlights well)
- Adjust white balance, exposure
- Export as a named style → use that style for batch CLI export

### 2. RawTherapee

- Similar quality to darktable, also has CLI (`rawtherapee-cli`)
- Uses `.pp3` processing profiles instead of styles
- Slightly easier to dial in a "neutral but not flat" look via the base curve
- Fedora: `sudo dnf install rawtherapee`

```bash
rawtherapee-cli -o /output/ -p myprofile.pp3 -j85 -c input.nef
```

### 3. dcraw (low-level, minimal processing)

- Decodes raw files; very limited automatic processing
- Output will still look flat unless you pipe through ImageMagick for curves
- Not recommended for 27K files — darktable/RawTherapee produce far better results

### 4. LibRaw / exiv2

- Libraries, not end-user tools; used internally by darktable/RawTherapee

---

## Recommended approach

1. **Open 10–20 representative NEFs in darktable GUI** — pick samples from
   different years/lighting conditions (indoor, outdoor, bright, dark)
2. **Build a base style** — enable sigmoid tone mapper, set white balance to
   "camera", bump exposure slightly (+0.3–0.5 EV is typical for Nikon D-series),
   enable lens correction if available
3. **Export test batch** — run `darktable-cli` on 50–100 files with the style;
   review output
4. **Tune and finalize style**
5. **Full batch export** — run on all 27,144 NEFs; expect 4–8 hours depending on CPU
6. **Keep originals** — do not delete NEFs; upload compressed JPEGs to cloud,
   keep NEFs on the HDD as the master archive

---

## Cost comparison — annual storage cost

NEFs converted to JPEG 85: ~110 GB (down from 325 GB). Other files unchanged (~76 GB).
Total upload sizes: **401 GB raw** vs **~186 GB compressed**.

| | S3 Glacier Deep Archive | Backblaze B2 |
|---|---|---|
| **Raw (401 GB)** | $4.76 / yr | $33.44 / yr |
| **Compressed (~186 GB)** | $2.21 / yr | $15.52 / yr |
| **Saving** | $2.55 / yr | $17.92 / yr |

Since the NEF originals are kept on the local HDD, converting to JPEG for the
cloud upload is not a permanent loss — you can always re-convert from the masters.
The question is whether the saving justifies the conversion effort (~4–8 hours CPU).

---

## Recommendation

On S3 Deep Archive the saving is only ~$2.55/year — probably not worth the
conversion effort. On Backblaze B2 the saving is ~$15/year, which may be more
compelling over a 10-year horizon ($179 saved).

Either way, since the NEF originals stay on the local HDD, converting to JPEG
for the cloud upload carries no permanent risk. If you ever want the full raw
files back, they are on the drive.
