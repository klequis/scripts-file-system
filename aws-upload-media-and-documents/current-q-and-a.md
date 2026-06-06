# Current Q & A (to review)


I ran the command as you suggested

carl@fedora:~$ rclone copy /run/media/carl/A1-2026-05/Media s3-klequis:media-klequis-us-east-1 \
  --s3-storage-class INTELLIGENT_TIERING \
  --bwlimit 50M \
  --transfers 4 \
  --progress \
  --dry-run
Transferred:              0 B / 0 B, -, 0 B/s, ETA -
Checks:             38785 / 38785, 100%, Listed 82317
Elapsed time:     15m34.6s
2026/06/05 12:06:07 NOTICE: 
Transferred:              0 B / 0 B, -, 0 B/s, ETA -
Checks:             38785 / 38785, 100%, Listed 82317
Elapsed time:     15m34.6s


But it doesn't tell me which files need to get uploaded. I want to see a list of new and changed files.

also, what happens to changed files on the S3 side. Do they get overwritten?

Is S3 keeping versions?


**Three separate answers:**

**1. Seeing which files would be uploaded**

Add `-v` (verbose):
```bash
rclone copy /run/media/carl/A1-2026-05/Media s3-klequis:media-klequis-us-east-1 \
  --s3-storage-class INTELLIGENT_TIERING \
  --bwlimit 50M \
  --transfers 4 \
  --dry-run \
  -v
```
That said — your dry run showed **0 bytes transferred and 38,785/38,785 checks**. There are currently no new or changed files. Everything is already in S3.

**2. What happens to changed files**

Yes, `rclone copy` overwrites the S3 object if the local file differs (by size or mtime). The old version is gone unless versioning is enabled.

**3. Is S3 versioning enabled?**

I don't know — it was in the "To Implement" checklist in your planning doc as an unchecked item (`[ ] Versioning enabled`). You can verify with:
```bash
aws s3api get-bucket-versioning --bucket media-klequis-us-east-1
```
If the response is empty or `{}`, versioning is **not** enabled. If enabled, it returns `"Status": "Enabled"`.