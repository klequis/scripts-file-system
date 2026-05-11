
## Decisions

### Service
- **AWS S3 Intelligent-Tiering**
- Automatically moves objects between tiers based on access patterns
- ~$0.023/GB/month + $0.0025/1,000 objects/month monitoring fee
- ~400 GB total → ~$9.20/month storage + ~$0.09/month monitoring fee

### Data classes
- **Media** (pictures & videos): ~380 GB (95%) — write-once, updates very rare
- **Documents** (financial + sensitive): ~20 GB (5%) — frequent updates to a small subset

### Bucket structure
- Two separate buckets:
  - `*-media` — pictures & videos
  - `*-documents` — financial + sensitive data

### Upload tool
- **rclone** — resumable, supports `--bwlimit`, handles Intelligent-Tiering storage class

### Upload schedule
- Window: 11pm–6am PDT (7 hours/night)
- Speed: 93 Mbps measured; `--bwlimit 50M` recommended
- Expected completion: ~3 nights
- Scheduling: cron or systemd timer to start/stop; rclone resumability handles pause cleanly

## To Implement

### Security (both buckets)
- [ ] Block all public access
- [ ] SSE-KMS encryption at rest
- [ ] Least-privilege IAM user for uploads only (`s3:PutObject`, `s3:GetObject`, `s3:ListBucket`)
- [ ] HTTPS-only bucket policy (deny `aws:SecureTransport: false`)
- [ ] Versioning enabled
- [ ] CloudTrail logging — S3 data events (GetObject/PutObject/DeleteObject)

## Concerns

### Temperature monitoring (for scripts that read from HDD)
- Check drive temp every 30 seconds in the background
- If temp reaches high threshold → pause immediately, wait until cool, resume automatically
- No scheduled work/rest cycle (differs from analyze-pictures.js which pauses every 5 min)
- Thresholds: warn at 45°C, pause at 50°C, resume at 42°C
- Reference implementation: `org-picture-files/analyze-pictures.js` (`getTemp`, `restUntilCool`)

## Challenges

### ISP throttling
- ISP claims unlimited data and no speed throttling — user is skeptical of speed claim
- Likely has a soft threshold after which speeds reduce during congestion
- Mitigation: `--bwlimit 50M` in rclone, overnight-only window

## Possible Services Considered

- https://www.idrive.com
- https://www.arcserve.com
- https://www.backblaze.com
- [pCloud](https://www.pcloud.com/cloud-storage-pricing-plans.html?period=lifetime)
  - SDKs are not maintained