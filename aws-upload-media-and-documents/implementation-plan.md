# S3 Upload — Implementation Plan

## Overview
- **Media bucket**: `media-klequis-us-east-1` ← `/run/media/carl/A1-2026-05/Media`
- **Documents bucket**: `documents-klequis-us-east-1` ← `/run/media/carl/A1-2026-05/Documents`
- **Region**: `us-east-1`
- **Storage class**: Intelligent-Tiering
- **Upload window**: 11pm–6am PDT, `--bwlimit 50M`, ~3 nights for media

---



## Phase 3 — Create KMS encryption keys

One key per bucket (allows independent key rotation/revocation).

```bash
# Create key for media bucket
aws kms create-key \
  --description "S3 media-klequis-us-east-1 encryption key" \
  --region us-east-1

# Note the "KeyId" (a UUID) from the output — needed in Phase 4

# Create key for documents bucket
aws kms create-key \
  --description "S3 documents-klequis-us-east-1 encryption key" \
  --region us-east-1

# Note the "KeyId" from this output too

# Add aliases so keys are easy to identify
aws kms create-alias \
  --alias-name alias/media-klequis \
  --target-key-id <media-key-id> \
  --region us-east-1

aws kms create-alias \
  --alias-name alias/documents-klequis \
  --target-key-id <documents-key-id> \
  --region us-east-1
```

---

## Phase 4 — Create S3 buckets

```bash
# Create buckets
aws s3api create-bucket \
  --bucket media-klequis-us-east-1 \
  --region us-east-1

aws s3api create-bucket \
  --bucket documents-klequis-us-east-1 \
  --region us-east-1

# Block all public access on both buckets
for BUCKET in media-klequis-us-east-1 documents-klequis-us-east-1; do
  aws s3api put-public-access-block \
    --bucket $BUCKET \
    --public-access-block-configuration \
      "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
done

# Enable versioning on both buckets
for BUCKET in media-klequis-us-east-1 documents-klequis-us-east-1; do
  aws s3api put-bucket-versioning \
    --bucket $BUCKET \
    --versioning-configuration Status=Enabled
done

# Enable SSE-KMS encryption — media bucket
aws s3api put-bucket-encryption \
  --bucket media-klequis-us-east-1 \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "aws:kms",
        "KMSMasterKeyID": "alias/media-klequis"
      },
      "BucketKeyEnabled": true
    }]
  }'

# Enable SSE-KMS encryption — documents bucket
aws s3api put-bucket-encryption \
  --bucket documents-klequis-us-east-1 \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "aws:kms",
        "KMSMasterKeyID": "alias/documents-klequis"
      },
      "BucketKeyEnabled": true
    }]
  }'
```

---

## Phase 5 — Apply bucket policies

> Policy files are created in `~/aws-setup/` — outside this workspace, not pushed to GitHub.
> Once applied, AWS stores the policy internally; the local files are kept only for your own reference.

### HTTPS-only policy (apply to both buckets)

Save as `~/aws-setup/https-only-policy.json`, replace `BUCKET_NAME` each time:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DenyNonHTTPS",
    "Effect": "Deny",
    "Principal": "*",
    "Action": "s3:*",
    "Resource": [
      "arn:aws:s3:::BUCKET_NAME",
      "arn:aws:s3:::BUCKET_NAME/*"
    ],
    "Condition": {
      "Bool": { "aws:SecureTransport": "false" }
    }
  }]
}
```

```bash
mkdir -p ~/aws-setup

# Apply to media bucket
sed 's/BUCKET_NAME/media-klequis-us-east-1/g' ~/aws-setup/https-only-policy.json > /tmp/policy-media.json
aws s3api put-bucket-policy \
  --bucket media-klequis-us-east-1 \
  --policy file:///tmp/policy-media.json

# Apply to documents bucket
sed 's/BUCKET_NAME/documents-klequis-us-east-1/g' ~/aws-setup/https-only-policy.json > /tmp/policy-docs.json
aws s3api put-bucket-policy \
  --bucket documents-klequis-us-east-1 \
  --policy file:///tmp/policy-docs.json
```

---

## Phase 6 — Attach IAM policy to upload user

Save as `~/aws-setup/upload-policy.json` (replace `<account-id>` with your 12-digit AWS account ID):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::media-klequis-us-east-1",
        "arn:aws:s3:::media-klequis-us-east-1/*",
        "arn:aws:s3:::documents-klequis-us-east-1",
        "arn:aws:s3:::documents-klequis-us-east-1/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["kms:GenerateDataKey", "kms:Decrypt"],
      "Resource": [
        "arn:aws:kms:us-east-1:<account-id>:alias/media-klequis",
        "arn:aws:kms:us-east-1:<account-id>:alias/documents-klequis"
      ]
    }
  ]
}
```

```bash
# Create the policy
aws iam create-policy \
  --policy-name s3-auto-upload-policy \
  --policy-document file://~/aws-setup/upload-policy.json

# Attach to the s3-auto-upload user (replace <account-id>)
aws iam attach-user-policy \
  --user-name s3-auto-upload \
  --policy-arn arn:aws:iam::<account-id>:policy/s3-auto-upload-policy
```

---

## Phase 7 — Configure rclone

```bash
# Configure AWS credentials for the s3-auto-upload IAM user
aws configure --profile s3-auto-upload
# Enter: Access Key ID, Secret Access Key, region (us-east-1), output format (json)

# Create rclone remote using those credentials
# WARNING: this command will print the secret key to the terminal.
# Immediately after running it, clear your history and secure the rclone config file.
rclone config create s3-klequis s3 \
  provider AWS \
  env_auth false \
  access_key_id "$(aws configure get aws_access_key_id --profile s3-auto-upload)" \
  secret_access_key "$(aws configure get aws_secret_access_key --profile s3-auto-upload)" \
  region us-east-1 \
  server_side_encryption aws:kms

# Clear terminal history and secure config files immediately after
history -c
chmod 600 ~/.config/rclone/rclone.conf
chmod 600 ~/.aws/credentials

# Verify rclone can see the buckets
rclone lsd s3-klequis:
```

---

## Phase 8 — Enable CloudTrail logging

```bash
# Create a bucket to store CloudTrail logs
aws s3api create-bucket \
  --bucket cloudtrail-klequis-us-east-1 \
  --region us-east-1

# Block public access on the log bucket
aws s3api put-public-access-block \
  --bucket cloudtrail-klequis-us-east-1 \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Apply required CloudTrail bucket policy (replace <account-id>)
aws s3api put-bucket-policy \
  --bucket cloudtrail-klequis-us-east-1 \
  --policy '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Sid": "AWSCloudTrailAclCheck",
        "Effect": "Allow",
        "Principal": {"Service": "cloudtrail.amazonaws.com"},
        "Action": "s3:GetBucketAcl",
        "Resource": "arn:aws:s3:::cloudtrail-klequis-us-east-1"
      },
      {
        "Sid": "AWSCloudTrailWrite",
        "Effect": "Allow",
        "Principal": {"Service": "cloudtrail.amazonaws.com"},
        "Action": "s3:PutObject",
        "Resource": "arn:aws:s3:::cloudtrail-klequis-us-east-1/AWSLogs/<account-id>/*",
        "Condition": {
          "StringEquals": {"s3:x-amz-acl": "bucket-owner-full-control"}
        }
      }
    ]
  }'

# Create trail
aws cloudtrail create-trail \
  --name klequis-s3-trail \
  --s3-bucket-name cloudtrail-klequis-us-east-1 \
  --include-global-service-events \
  --is-multi-region-trail

# Enable S3 data events for both buckets
aws cloudtrail put-event-selectors \
  --trail-name klequis-s3-trail \
  --event-selectors '[
    {
      "ReadWriteType": "All",
      "IncludeManagementEvents": true,
      "DataResources": [
        {
          "Type": "AWS::S3::Object",
          "Values": [
            "arn:aws:s3:::media-klequis-us-east-1/",
            "arn:aws:s3:::documents-klequis-us-east-1/"
          ]
        }
      ]
    }
  ]'

# Start logging
aws cloudtrail start-logging --name klequis-s3-trail
```

---

## Phase 9 — Upload media (~380 GB)

**Schedule** (adjust these if needed):
- Start: 11pm PDT = **06:00 UTC** → cron: `0 6`
- Stop:   6am PDT = **13:00 UTC** → cron: `0 13`

PDT is UTC−7. If clocks change (PST = UTC−8), adjust by 1 hour:
- PST start: 11pm PST = 07:00 UTC → `0 7`
- PST stop:  6am PST  = 14:00 UTC → `0 14`

```bash
# Dry run first — verify what will be uploaded
rclone copy /run/media/carl/A1-2026-05/Media s3-klequis:media-klequis-us-east-1 \
  --s3-storage-class INTELLIGENT_TIERING \
  --bwlimit 50M \
  --transfers 4 \
  --progress \
  --dry-run

# Add cron jobs
crontab -e
```

Add these two lines (first column = minute, second = hour UTC):
```
# Start upload at 11pm PDT (06:00 UTC)
0 6 * * * rclone copy /run/media/carl/A1-2026-05/Media s3-klequis:media-klequis-us-east-1 --s3-storage-class INTELLIGENT_TIERING --bwlimit 50M --transfers 4 --log-file /home/carl/rclone-media.log --log-level INFO
# Stop upload at 6am PDT (13:00 UTC)
0 13 * * * pkill -f "rclone copy.*media-klequis"
```

---

## Phase 10 — Upload documents (~20 GB)

```bash
# Dry run first
rclone copy /run/media/carl/A1-2026-05/Documents s3-klequis:documents-klequis-us-east-1 \
  --s3-storage-class INTELLIGENT_TIERING \
  --bwlimit 50M \
  --transfers 4 \
  --progress \
  --dry-run

# Add cron jobs (same window as media, separate log)
crontab -e
```

Add these two lines:
```
# Start documents upload at 11pm PDT (06:00 UTC)
0 6 * * * rclone copy /run/media/carl/A1-2026-05/Documents s3-klequis:documents-klequis-us-east-1 --s3-storage-class INTELLIGENT_TIERING --bwlimit 50M --transfers 4 --log-file /home/carl/rclone-documents.log --log-level INFO
# Stop documents upload at 6am PDT (13:00 UTC)
0 13 * * * pkill -f "rclone copy.*documents-klequis"
```

> Keep these cron jobs active after the initial upload — they will serve as the nightly sync for ongoing changes.

---

## Phase 11 — Verify uploads

```bash
# Compare local vs S3 — reports missing or changed files
rclone check /run/media/carl/A1-2026-05/Media s3-klequis:media-klequis-us-east-1 \
  --log-file /home/carl/rclone-check-media.log

rclone check /run/media/carl/A1-2026-05/Documents s3-klequis:documents-klequis-us-east-1 \
  --log-file /home/carl/rclone-check-documents.log

# Count objects in each bucket
aws s3 ls s3://media-klequis-us-east-1 --recursive --summarize | tail -2
aws s3 ls s3://documents-klequis-us-east-1 --recursive --summarize | tail -2
```
