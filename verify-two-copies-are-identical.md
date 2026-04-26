## Verify two copies (NVMe vs HDD) — script

Save as verify_copies.sh, make executable (chmod +x verify_copies.sh), then run: ./verify_copies.sh /path/to/nvme-copy /path/to/hdd-copy

```
#!/bin/bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 /path/to/nvme-copy /path/to/hdd-copy"
  exit 2
fi

SRC="$1"   # NVMe copy root (existing copy)
DST="$2"   # HDD copy root (existing copy)
TIMESTAMP=$(date +%F_%H%M%S)
LOGDIR="$HOME/verify-logs/$TIMESTAMP"
mkdir -p "$LOGDIR"

echo "VERIFY START: $(date)" | tee "$LOGDIR/run.log"
echo "SRC: $SRC" | tee -a "$LOGDIR/run.log"
echo "DST: $DST" | tee -a "$LOGDIR/run.log"

# 1) Source file hashes (relative paths), handle weird names safely
echo "Computing SHA-256 on source..." | tee -a "$LOGDIR/run.log"
( cd "$SRC" && find . -type f -print0 | xargs -0 sha256sum ) | sort > "$LOGDIR/src-files.sha256

"

# 2) Destination file hashes
echo "Computing SHA-256 on destination..." | tee -a "$LOGDIR/run.log"
( cd "$DST" && find . -type f -print0 | xargs -0 sha256sum ) | sort > "$LOGDIR/dst-files.sha256

"

# 3) Compare
echo "Comparing lists..." | tee -a "$LOGDIR/run.log"
diff -u "$LOGDIR/src-files.sha256" "$LOGDIR/dst-files.sha256" > "$LOGDIR/checksum-diff.txt" || true

# 4) Summarize results
if [ ! -s "$LOGDIR/checksum-diff.txt" ]; then
  echo "RESULT: All files match (no differences)." | tee -a "$LOGDIR/run.log"
else
  echo "RESULT: Differences found. See $LOGDIR/checksum-diff.txt" | tee -a "$LOGDIR/run.log"
  # Brief counts
  SRC_ONLY=$(grep '^<' -c "$LOGDIR/checksum-diff.txt" || true)
  DST_ONLY=$(grep '^>' -c "$LOGDIR/checksum-diff.txt" || true)
  HASH_DIFF=$(grep -E '^[+-]' -c "$LOGDIR/checksum-diff.txt" || true)
  echo "diff summary (lines): src-only: $SRC_ONLY, dst-only: $DST_ONLY, other: $HASH_DIFF" | tee -a "$LOGDIR/run.log"
fi

echo "Logs saved in: $LOGDIR" | tee -a "$LOGDIR/run.log"
echo "VERIFY END: $(date)" | tee -a "$LOGDIR/run.log"
```

Notes
- The script produces sorted per-file SHA-256 lists with relative paths and a unified diff at LOGDIR/checksum-diff.txt.
- If filenames contain newlines or unusual chars the find -print0 | xargs -0 approach is safe.
- If trees are large and hashing is slow, consider installing GNU parallel and replacing the hashing pipeline with a parallelized variant.
- Keep LOGDIR until you are satisfied; empty checksum-diff.txt means all file contents and relative paths match.
