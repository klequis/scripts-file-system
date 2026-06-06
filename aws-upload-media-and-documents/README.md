# AWS Upload of Media and Documents

*Issues are in GitHub*

## Commands

### Copy new and changed files to S3

```
rclone copy /run/media/carl/A1-2026-05/Media s3-klequis:media-klequis-us-east-1 \
  --s3-storage-class INTELLIGENT_TIERING \
  --bwlimit 50M \
  --transfers 4 \
  --progress
```

### Perform dry-run

Yes, add `--dry-run`:

```bash
rclone copy /run/media/carl/A1-2026-05/Media s3-klequis:media-klequis-us-east-1 \
  --s3-storage-class INTELLIGENT_TIERING \
  --bwlimit 50M \
  --transfers 4 \
  --progress \
  --dry-run
```

It will log to stdout what *would* be transferred without actually uploading anything.

## How the check is performed

`rclone` compares each local file against S3 (by size and modification time by default) to determine if it needs to be copied. With 38,000+ files it will take a while to walk through them all, but no data is transferred — it's just metadata checks.


## Notes


### `rclone` output "Listed"

One of the `rclone` output lines that constantly updates is (snapshotted)

```
Checks: 28032 / 38048, 74%, Listed 81039`
```

The meaning of "Listed" is (according to AI) the count of objects from both local and S3, including directory entries.