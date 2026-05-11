
## Decision

**Service**: AWS S3 Intelligent-Tiering
**Storage class**: `INTELLIGENT_TIERING`
**Rationale**: Automatically moves objects between tiers based on access patterns. Good fit when retrieval frequency is uncertain.
**Estimated cost**: ~$0.023/GB/month + $0.0025/1,000 objects/month monitoring fee (~$9.20/month for 400 GB)

## Possible Services Considered

- https://www.idrive.com
- https://www.arcserve.com
- https://www.backblaze.com
- [pCloud](https://www.pcloud.com/cloud-storage-pricing-plans.html?period=lifetime)
  - SDKs are not maintained