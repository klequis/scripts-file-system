#!/bin/bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 /path/to/nvme-copy /path/to/hdd-copy"
  exit 2
fi

SRC="$1"   # NVMe copy root (existing copy)
DST="$2"   # HDD copy root (existing copy)
TIMESTAMP=$(date +%F_%H%M%S)
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LOGDIR="$SCRIPT_DIR/verify-logs/$TIMESTAMP"
mkdir -p "$LOGDIR"

echo "VERIFY START: $(date)" | tee "$LOGDIR/run.log"
echo "SRC: $SRC" | tee -a "$LOGDIR/run.log"
echo "DST: $DST" | tee -a "$LOGDIR/run.log"

# 1) Source file hashes (relative paths), handle weird names safely
echo "Computing SHA-256 on source..." | tee -a "$LOGDIR/run.log"
( cd "$SRC" && find . -type f -print0 | xargs -0 sha256sum ) | sort > "$LOGDIR/src-files.sha256"

# 2) Destination file hashes
echo "Computing SHA-256 on destination..." | tee -a "$LOGDIR/run.log"
( cd "$DST" && find . -type f -print0 | xargs -0 sha256sum ) | sort > "$LOGDIR/dst-files.sha256"

# 3) Compare
echo "Comparing lists..." | tee -a "$LOGDIR/run.log"
diff -u "$LOGDIR/src-files.sha256" "$LOGDIR/dst-files.sha256" > "$LOGDIR/checksum-diff.txt" || true

# 4) Summarize results
if [ ! -s "$LOGDIR/checksum-diff.txt" ]; then
  echo "RESULT: All files match (no differences)." | tee -a "$LOGDIR/run.log"
else
  echo "RESULT: Differences found. See $LOGDIR/checksum-diff.txt" | tee -a "$LOGDIR/run.log"

  # Build a CSV report with one row per difference:
  # 1) same relative path but different hash -> sourceFile=path, distFile=path, match=false
  # 2) path only in source                 -> sourceFile=path, distFile="",   match=false
  # 3) path only in destination            -> sourceFile="",   distFile=path, match=false
  CSV_REPORT="$LOGDIR/differences.csv"
  {
    echo 'sourceFile,distFile,match'
    awk '
      function esc(s) {
        gsub(/"/, "\"\"", s)
        return "\"" s "\""
      }
      NR == FNR {
        src_hash = substr($0, 1, 64)
        src_path = substr($0, 67)
        src[src_path] = src_hash
        next
      }
      {
        dst_hash = substr($0, 1, 64)
        dst_path = substr($0, 67)
        dst[dst_path] = dst_hash
      }
      END {
        for (p in src) {
          if (p in dst) {
            if (src[p] != dst[p]) {
              print esc(p) "," esc(p) ",false"
            }
          } else {
            print esc(p) ",\"\",false"
          }
        }
        for (p in dst) {
          if (!(p in src)) {
            print "\"\"," esc(p) ",false"
          }
        }
      }
    ' "$LOGDIR/src-files.sha256" "$LOGDIR/dst-files.sha256" | sort
  } > "$CSV_REPORT"

  echo "CSV report: $CSV_REPORT" | tee -a "$LOGDIR/run.log"

  # Brief counts
  SRC_ONLY=$(grep '^<' -c "$LOGDIR/checksum-diff.txt" || true)
  DST_ONLY=$(grep '^>' -c "$LOGDIR/checksum-diff.txt" || true)
  HASH_DIFF=$(grep -E '^[+-]' -c "$LOGDIR/checksum-diff.txt" || true)
  echo "diff summary (lines): src-only: $SRC_ONLY, dst-only: $DST_ONLY, other: $HASH_DIFF" | tee -a "$LOGDIR/run.log"
fi

echo "Logs saved in: $LOGDIR" | tee -a "$LOGDIR/run.log"
echo "VERIFY END: $(date)" | tee -a "$LOGDIR/run.log"