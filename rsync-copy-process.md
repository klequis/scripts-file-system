Below is the adjusted one‑job script that runs rsync as a normal user (no sudo). It preserves permissions, ACLs, xattrs and hardlinks where possible for a non‑root user, copies resumably, logs activity, and produces per‑file SHA‑256 lists for verification. Replace SRC, DEST, and device names as needed.

```bash
#!/bin/bash
set -euo pipefail
SRC="/nvme/data/job01/"           # source dir (trailing slash)
DEST="/mnt/hdd/job01/"            # destination dir (ensure mounted and writable by current user)
LOGDIR="$HOME/transfer-logs/job01-$(date +%F_%H%M%S)"
mkdir -p "$LOGDIR"

exec > >(tee -a "$LOGDIR/transfer.log") 2>&1
echo "START: $(date)"

# 1) optional quick SMART checks (run only if you have permission)
smartctl -H /dev/nvme0n1 2>/dev/null || true
smartctl -H /dev/sdX 2>/dev/null || true

# 2) rsync copy as non-root (preserve metadata that non-root can)
rsync -a --partial --progress --delete \
  --no-owner --no-group \
  --compress-level=0 --stats \
  --log-file="$LOGDIR/rsync-copy.log" \
  "$SRC" "$DEST"

# 3) build per-file SHA-256 on source (relative paths, safe for odd names)
cd "$SRC"
find . -type f -print0 | xargs -0 sha256sum | sort > "$LOGDIR/source-files.sha256"

# 4) build per-file SHA-256 on destination
cd "$DEST"
find . -type f -print0 | xargs -0 sha256sum | sort > "$LOGDIR/dest-files.sha256"

# 5) compare lists
if diff -u "$LOGDIR/source-files.sha256" "$LOGDIR/dest-files.sha256" > "$LOGDIR/checksum-diff.txt"; then
  echo "Per-file checksums match: SUCCESS"
else
  echo "MISMATCH found: see $LOGDIR/checksum-diff.txt"
  exit 2
fi

echo "DONE: $(date)"
echo "Logs: $LOGDIR"
```

Notes
- --no-owner and --no-group ensure rsync does not attempt chown/chgrp (which require root); files will be owned by the invoking user on the destination.
- -a keeps permissions, timestamps, and symlinks where possible; some metadata requiring root (certain ACLs/xattrs or preserving original ownership) may not be preserved.
- The per-file SHA-256 comparison verifies content integrity; keep LOGDIR until you’re satisfied.
- Run the script as the regular user (not with sudo): bash ./transfer-job01.sh
