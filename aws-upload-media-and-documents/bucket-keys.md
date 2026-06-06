# Various Info for S3-Auto-Upload

## Overview
- **Media bucket**: `media-klequis-us-east-1` ← `/run/media/carl/A1-2026-05/Media`
- **Documents bucket**: `documents-klequis-us-east-1` ← `/run/media/carl/A1-2026-05/Documents`
- **Region**: `us-east-1`
- **Storage class**: Intelligent-Tiering
- **Upload window**: 11pm–6am PDT, `--bwlimit 50M`, ~3 nights for media

## Misc

- default bucket name 

## Bucket names
- media-klequis-us-east-1
- documents-klequis-us-east-1

---

## Phase 1 — Install tools

```bash
# Install AWS CLI
sudo dnf install awscli2

# Verify
aws --version

# Install rclone
sudo dnf install rclone

# Verify
rclone version
```

---

## Phase 2 — Create IAM user for uploads

Do this in the AWS Console (https://console.aws.amazon.com/iam):

1. Go to **IAM → Users → Create user**
2. Name: `s3-auto-upload`
3. **Do not** grant console access
4. Skip "Add to group" and skip "Attach a policy directly" — the policy will be created and attached in Phase 6 after the buckets exist. Create the user with no permissions for now.
5. After user is created, click the username `s3-auto-upload` to open the user detail page
6. Click the **"Security credentials"** tab
7. Scroll down to **"Access keys"** → click **"Create access key"**
8. Choose **CLI** as the use case
9. Download or copy the **Access Key ID** and **Secret Access Key** — you will not see the secret again

The policy will be attached in Phase 6 after the buckets exist.

---

## Phase 2b — Store credentials in Bitwarden

Immediately after creating the IAM access key, save it to Bitwarden before closing the console — the secret access key is only shown once.

Create a new **Login** item in Bitwarden:

| Field | Value |
|---|---|
| Name | `AWS s3-auto-upload IAM user` |
| Username | Access Key ID (e.g. `AKIAIOSFODNN7EXAMPLE`) |
| Password | Secret Access Key |
| Notes | IAM user ARN, AWS account ID, region (`us-east-1`), purpose: rclone S3 uploads |

---

## Phase 2c — Configure admin user CLI credentials

The AWS CLI must be authenticated as your admin IAM user before running Phases 3–8.
Your admin user is a member of the `admin` group with `AdministratorAccess` policy.

1. In the AWS Console, open your admin IAM user → **Security credentials** tab
2. Create an access key (same steps as Phase 2, steps 7–9)
3. Store in Bitwarden as `AWS admin IAM user - CLI`
4. Run:

```bash
aws configure
# Enter: admin Access Key ID, Secret Access Key, region (us-east-1), output (json)
```

5. Verify:

```bash
aws sts get-caller-identity
# Should show your account ID and admin username
```

---

## Phase 3

## Media bucket key

carl@fedora:~/Downloads$ aws kms create-key \
  --description "S3 media-klequis-us-east-1 encryption key" \
  --region us-east-1
{
    "KeyMetadata": {
        "AWSAccountId": "230613527277",
        "KeyId": "5b1f63b0-160c-4708-a4a7-28c7d26f9a00",
        "Arn": "arn:aws:kms:us-east-1:230613527277:key/5b1f63b0-160c-4708-a4a7-28c7d26f9a00",
        "CreationDate": "2026-05-11T11:12:35.256000-07:00",
        "Enabled": true,
        "Description": "S3 media-klequis-us-east-1 encryption key",
        "KeyUsage": "ENCRYPT_DECRYPT",
        "KeyState": "Enabled",
        "Origin": "AWS_KMS",
        "KeyManager": "CUSTOMER",
        "CustomerMasterKeySpec": "SYMMETRIC_DEFAULT",
        "KeySpec": "SYMMETRIC_DEFAULT",
        "EncryptionAlgorithms": [
            "SYMMETRIC_DEFAULT"
        ],
        "MultiRegion": false,
        "CurrentKeyMaterialId": "8079ab0a8a15dd42fa8531f1662dbd32b69373e060a36e58cac7d2fc749d56b0"
    }
}

**command executed**
```
aws kms create-alias \
  --alias-name alias/media-klequis \
  --target-key-id "5b1f63b0-160c-4708-a4a7-28c7d26f9a00" \
  --region us-east-1
```

### Documents bucket key

carl@fedora:~/Downloads$ aws kms create-key \
  --description "S3 documents-klequis-us-east-1 encryption key" \
  --region us-east-1
{
    "KeyMetadata": {
        "AWSAccountId": "230613527277",
        "KeyId": "84d01762-ccce-4373-a30f-1b625c9edf18",
        "Arn": "arn:aws:kms:us-east-1:230613527277:key/84d01762-ccce-4373-a30f-1b625c9edf18",
        "CreationDate": "2026-05-11T11:15:52.428000-07:00",
        "Enabled": true,
        "Description": "S3 documents-klequis-us-east-1 encryption key",
        "KeyUsage": "ENCRYPT_DECRYPT",
        "KeyState": "Enabled",
        "Origin": "AWS_KMS",
        "KeyManager": "CUSTOMER",
        "CustomerMasterKeySpec": "SYMMETRIC_DEFAULT",
        "KeySpec": "SYMMETRIC_DEFAULT",
        "EncryptionAlgorithms": [
            "SYMMETRIC_DEFAULT"
        ],
        "MultiRegion": false,
        "CurrentKeyMaterialId": "e9434532a71425ebb9047dc0a3972c03ea7ea1df216f4ab49c8fffe70076d193"
    }
}


**command executed**
```
aws kms create-alias \
  --alias-name alias/documents-klequis \
  --target-key-id "84d01762-ccce-4373-a30f-1b625c9edf18" \
  --region us-east-1
```

## Phase 4 -- Create S3 buckets

```
carl@fedora:~/Downloads$ aws s3api create-bucket \
  --bucket media-klequis-us-east-1 \
  --region us-east-1
{
    "Location": "/media-klequis-us-east-1",
    "BucketArn": "arn:aws:s3:::media-klequis-us-east-1"
}
```

```
aws s3api create-bucket \
  --bucket documents-klequis-us-east-1 \
  --region us-east-1
{
    "Location": "/documents-klequis-us-east-1",
    "BucketArn": "arn:aws:s3:::documents-klequis-us-east-1"
}
```

## Phase 5

File is on system disk


## Phase 6
```
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
        "arn:aws:kms:us-east-1:230613527277:alias/media-klequis",
        "arn:aws:kms:us-east-1:230613527277:alias/documents-klequis"
      ]
    }
  ]
}
```

```
carl@fedora:~/aws-setup$ aws iam create-policy \
  --policy-name s3-upload-policy \
  --policy-document file://upload-policy.json
{
    "Policy": {
        "PolicyName": "s3-upload-policy",
        "PolicyId": "ANPATLMNDFLWVGQFPWFJN",
        "Arn": "arn:aws:iam::230613527277:policy/s3-upload-policy",
        "Path": "/",
        "DefaultVersionId": "v1",
        "AttachmentCount": 0,
        "PermissionsBoundaryUsageCount": 0,
        "IsAttachable": true,
        "CreateDate": "2026-05-11T20:07:54+00:00",
        "UpdateDate": "2026-05-11T20:07:54+00:00"
    }
}
```

```
carl@fedora:~/aws-setup$ aws iam attach-user-policy \
  --user-name s3-auto-upload \
  --policy-arn arn:aws:iam::230613527277:policy/s3-upload-policy
```

## Phase 7 — Configure rclone

## Phase 8

```
carl@fedora:~/aws-setup$ aws s3api create-bucket \
  --bucket cloudtrail-klequis-us-east-1 \
  --region us-east-1
{
    "Location": "/cloudtrail-klequis-us-east-1",
    "BucketArn": "arn:aws:s3:::cloudtrail-klequis-us-east-1"
}
```

```
carl@fedora:~/aws-setup$ aws s3api put-public-access-block \
  --bucket cloudtrail-klequis-us-east-1 \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

```
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
        "Resource": "arn:aws:s3:::cloudtrail-klequis-us-east-1/AWSLogs/230613527277/*",
        "Condition": {
          "StringEquals": {"s3:x-amz-acl": "bucket-owner-full-control"}
        }
      }
    ]
  }'
```

