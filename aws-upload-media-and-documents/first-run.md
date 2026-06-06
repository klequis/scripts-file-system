```
carl@fedora:~$ rclone copy /run/media/carl/A1-2026-05/Media s3-klequis:media-klequis-us-east-1 \
  --s3-storage-class INTELLIGENT_TIERING \
  --bwlimit 50M \
  --transfers 4 \
  --progress
Transferred:        3.415 GiB / 135.560 GiB, 3%, 11.167 MiB/s, ETA 3h21m57s
Checks:                 0 / 0, -, Listed 12156
Transferred:          136 / 10148, 1%
Elapsed time:      5m20.5s
Transferring:
 * Scanned Pictures/Calif…nia 79/scanned_111.tif: 71% / 144.161 MiB, 2.509 MiB/s, 16s
 * Scanned Pictures/Calif…nia 79/scanned_112.tif: 96% / 142.719 MiB, 3.053 MiB/s, 1s
 * Scanned Pictures/Calif…nia 79/scanned_113.tif: 62% / 143.597 MiB, 2.906 MiB/s, 18s
 * Scanned Pictures/Calif…nia 79/scanned_180.tif: 15% / 141.013 MiB, 2.901 MiB/s, 41s^Ccarl@fedora:~$ 
carl@fedora:~$ rclone copy /run/media/carl/A1-2026-05/Media s3-klequis:media-klequis-us-east-1   --s3-storage-class INTELLIGENT_TIERING   --bwlimit 50M   --transfers 4   --progress
Transferred:      364.899 GiB / 364.899 GiB, 100%, 10.843 MiB/s, ETA 0s
Checks:               136 / 136, 100%, Listed 41322
Transferred:        38649 / 38649, 100%
Elapsed time:   9h24m29.5s

```