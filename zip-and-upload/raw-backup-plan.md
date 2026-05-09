# Raw Backup Plan — Upload new/ as-is to S3 Glacier Deep Archive

## Storage cost at 401 GB

| Service | $/GB/month | Monthly | Annual |
|---|---|---|---|
| Backblaze B2 | $0.00695 | $2.79 | $33.44 |
| S3 Glacier Flexible | $0.0036 | $1.44 | $17 |
| **S3 Glacier Deep Archive** | **$0.00099** | **$0.40** | **$4.80** |

## One-time upload costs (S3 Deep Archive)

- PUT requests (~36K files): ~$1.85
- Upload (data transfer into S3): free
- **Total one-time: ~$2**

## If you ever need to restore

- Bulk retrieval (401 GB): ~$1.00 (takes up to 48 hours)
- Egress (download out of AWS): ~$36 at $0.09/GB
- Standard retrieval (3-5 hours): ~$12

## Upload approach

Use `rclone` with `--s3-storage-class DEEP_ARCHIVE`:

```bash
rclone copy /run/media/carl/A1-2026-05/new s3:your-bucket-name \
  --s3-storage-class DEEP_ARCHIVE \
  --transfers 4 \
  --progress \
  --log-file rclone.log
```

- Resumable — safe to stop and restart
- Run overnight; at 10 Mbps upload, 401 GB takes ~3-4 days
- `--transfers 4` keeps throughput up without hammering the drive

## Notes

- Verify pricing at https://aws.amazon.com/s3/pricing/ before committing
- Minimum storage duration: 180 days (pro-rated charge if deleted earlier)
- No free tier for Glacier Deep Archive
- Objects in Deep Archive cannot be directly overwritten — delete + re-upload to change
