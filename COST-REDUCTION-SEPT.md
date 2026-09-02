# AWS Cost Reduction — September 2026

> **STATUS: NOT FINAL — DRAFT FOR DISCUSSION**
> Nothing in this document has been executed. No AWS resources have been
> changed. Every action below is a proposal pending Carl's decision.
> Written 2026-08-31.

---

## 1. The Problem

The monthly AWS bill jumped from ~$3/mo to a peak of ~$20/mo after three
buckets were created on 2026-05-11. It is now drifting back down on its own
(Intelligent-Tiering is aging objects into cheaper tiers), but it has settled
far above the planned spend.

### Billing history

| Month | Total | S3 | Route 53 | KMS | CloudTrail |
|---|---|---|---|---|---|
| May 2026 | $10.88 | $6.99 | $2.51 | $1.30 | $0.08 |
| Jun 2026 | $19.74 | $15.02 | $2.51 | $1.99 | $0.22 |
| Jul 2026 | $17.04 | $12.47 | $2.57 | $2.00 | — |
| Aug 2026 | $13.49 | $9.03 | $2.52 | $1.94 | — |
| Sep 2026 | **$12.50 (AWS forecast)** | | | | |

### Where the money goes (steady state, ~$12.70/mo)

| Line | $/mo | Detail |
|---|---|---|
| `media-klequis-us-east-1` | 6.68 | 769 GB, 80,355 objects, Intelligent-Tiering |
| Route 53 | 2.50 | 5 hosted zones x $0.50 |
| KMS | 2.00 | 2 customer-managed keys x $1.00 |
| `documents.current.bk` (us-west-2) | 1.22 | 48.5 GB Standard, 19 objects, created 2021 |
| `cjb-my-music` | 0.29 | 12.8 GB Standard |

### The surprise

**`media-klequis-us-east-1` holds 769 GB, not the ~360 GB assumed.**

Verified 2026-08-31:
- 80,355 current objects, 825,630,674,581 bytes
- Average object size 9.6 MB (no small-file / 128 KB-minimum penalty)
- Versioning is **enabled** but there are **no noncurrent versions** and no
  delete markers — so the 769 GB is real data, not duplication
- Tier split: 400.9 GB Infrequent Access + 367.9 GB Archive Instant Access
- No lifecycle configuration, no Intelligent-Tiering configuration
- Encrypted SSE-KMS with `alias/media-klequis`, BucketKeyEnabled = true
- Content appears to be family photos (e.g. `2022.sophie-slide-show/...`)

### The blocker: egress

Storing this data is cheap. **Getting it back out is not.** Downloading all
769 GB to a home machine costs roughly **$69 in internet data transfer**,
independent of storage class. This is the reason to hesitate before pushing
everything into Deep Archive, and the reason the bucket should probably shrink
before anything else is decided.

**Important mitigation to verify:** AWS's always-free tier includes **100 GB/mo
of data transfer out to the internet, per account**. Retrieving the bucket
gradually — 100 GB/month over 8 months — would cost **$0 in egress**. A single
bulk download is what costs $69. This materially changes the calculus and
should be confirmed against current AWS terms before relying on it.

---

## 2. Possible Steps

### 2.1 Carl: consider if some folders can be deleted

> **UPDATE 2026-08-31: measured — see section 2A.** Two named delete
> candidates, `Pictures-old` (401 GB) and `of-daniel.tmp` (4.6 GB), account for
> **53% of the bucket**. This is now the top-priority action.

The single highest-leverage move. Every GB removed saves storage cost *and*
future egress cost, and it is the only step that reduces the $69 retrieval
exposure. 769 GB of photos very likely contains duplicates and discards.

Relevant tooling already in this repo:
- `find-duplicate-files.sh`
- `dedup-images/`
- `org-picture-files/`
- `aws-upload-media-and-documents/`

Open question: is there a complete local copy of the bucket to dedupe against,
or does the analysis have to happen in S3? Deduping locally and re-uploading a
clean set is far cheaper than reasoning about it in the cloud.

### 2.2 Carl & Claude: would breaking it into smaller buckets help reduce cost?

**Short answer: not directly — S3 rates are per-GB and identical regardless of
how many buckets the data sits in.** Splitting 769 GB across five buckets costs
exactly what one bucket costs.

**But it helps indirectly, and that may matter more:**
- Different data deserves different storage classes. Today one policy has to
  cover everything. Separate buckets (or just separate key prefixes) allow
  "definitely never needed" to go to Deep Archive at $0.00099/GB while
  "might browse on a whim" stays instantly readable.
- Per-bucket cost attribution becomes possible without CloudWatch archaeology.
- Deleting a whole category later becomes a one-line operation.

**Cheaper alternative to consider first:** lifecycle rules and
Intelligent-Tiering configurations both accept **prefix filters**. The same
targeting can be achieved without moving a single byte — and moving objects
between buckets means re-uploading, which resets every object's tiering clock
and incurs request charges. Prefix-based policies are almost certainly the
right tool here.

**To decide this we need:** a breakdown of the 769 GB by top-level prefix, and
Carl's judgement on which prefixes are "never" vs "maybe". That analysis is
cheap to run and has not been done yet.

### 2.3 Carl & Claude: would a second AWS account help reduce cost?

**For storage: no.** S3 per-GB rates are the same in any account. The only
volume discount is S3 Standard's 50 TB tier boundary, which is irrelevant at
this scale — and splitting across accounts would make that *worse*, not
better, since usage is aggregated per account.

**For egress: possibly, marginally.** The 100 GB/mo free data-transfer-out
allowance is **per account**. Two accounts would in principle provide
200 GB/mo of free retrieval, halving the time needed to pull everything down
for free.

**Costs of doing this:**
- Cross-account data transfer within the same region is free, so moving data
  between the accounts is not itself expensive.
- But it doubles the surface for credential management, IAM policy, billing
  review, and KMS keys ($1/mo per key, per account).
- Consolidated billing under AWS Organizations aggregates the free tier across
  member accounts, which would **eliminate the benefit** — the second account
  would have to be genuinely standalone.
- It adds a permanent operational burden to save what is, at most, a one-time
  ~$35 on a retrieval that may never happen.

**Preliminary assessment: not worth it.** The far better answer to the egress
problem is (a) shrink the data, and (b) keep a local copy so retrieval is
never needed in the first place. Revisit only if a full bulk retrieval on a
deadline becomes a real scenario.

**Note:** deliberately splitting across accounts to multiply a free-tier
allowance sits in a grey area of AWS's terms. Worth reading the current Free
Tier terms before pursuing it.

### 2.4 General cleanup of the klequis AWS account — one item at a time

Deliberately sequenced to avoid mistakes. Each item is independent and
individually reversible except where noted.

| # | Item | Saves | Risk | Status |
|---|---|---|---|---|
| A | Delete orphan KMS key `alias/documents-klequis` | $12/yr | None — bucket has 0 objects | Not done |
| B | Archive or delete `documents.current.bk` (48.5 GB, 19 objects, 2021) | ~$13/yr | Review contents first | Not done |
| C | Prune unused Route 53 hosted zones | $6/yr each | Carl's call on domains | Not done |
| D | Decide storage class for `media-klequis` | up to $69/yr | Retrieval latency | **Blocked on 2.1** |
| E | Review `cjb-my-music` (12.8 GB Standard) | ~$2/yr | Low | Not done |
| F | Audit ~35 legacy buckets from 2017-2021 | Unknown | Low | Not done |

**Route 53 zones (5 total, $30/yr):**
`trivalleycoders.com` (8 records), `trivalleycoders.org` (9),
`carlbecker.com` (8), `klequis.io` (8), `carlbecker.dev` (3 — NS + SOA only,
nothing pointed at it).

**KMS keys (2 total, $24/yr):**
- `5b1f63b0-160c-4708-a4a7-28c7d26f9a00` — `alias/media-klequis`. **Keep.**
  Re-encrypting 769 GB to free SSE-S3 would cost more in request charges and
  reset tiering than the $12/yr it saves.
- `84d01762-ccce-4373-a30f-1b625c9edf18` — `alias/documents-klequis`.
  **Deletable.** Guards an empty bucket.

**Legacy buckets:** roughly 35 buckets remain from 2017-2021
(`trivalleycoders.*`, `klequis-todo.tk`, `responsive-images`, `tvc-*`, etc.).
Most appear to hold little data — total non-media S3 storage is only ~$0.29/mo
— so this is housekeeping, not savings.

---

## 2A. Prefix Breakdown — measured 2026-08-31

This answers what was Open Question #2 and changes the shape of the problem.

| Top-level prefix | GB | Objects | $/mo @ IA rate | Delete candidate? |
|---|---|---|---|---|
| `Pictures-old` | **400.96** | 41,570 | 5.01 | **YES — Carl** |
| `photos` | 285.23 | 32,870 | 3.57 | no |
| `videos` | 39.51 | 410 | 0.49 | no |
| `Scanned Pictures` | 35.47 | 849 | 0.44 | no |
| `of-daniel.tmp` | **4.63** | 839 | 0.06 | **YES — Carl** |
| `dev-images` | 1.43 | 3,447 | 0.02 | ? |
| `2022.sophie-slide-show` | 1.15 | 287 | 0.01 | no |
| `other` + `daniel` | 0.54 | 83 | 0.01 | ? |
| **TOTAL** | **768.93** | **80,355** | | |

(Note: the folder is `of-daniel.tmp`, not `of-dalien.tmp`.)

### The headline

**The two delete candidates are 405.6 GB — 53% of the bucket.** Removing them
leaves **363 GB**, which is essentially the ~360 GB originally assumed. The
original mental model was correct; `Pictures-old` was expected to have been
deleted and was not.

Cross-check confirming this: `Pictures-old` (400.96 GB) matches the Infrequent
Access tier (400.92 GB) almost exactly, and everything else (368.0 GB) matches
the Archive Instant Access tier (367.93 GB). `Pictures-old` alone is **$5.01/mo
— roughly 40% of the entire AWS bill.**

### Caution: `Pictures-old` is NOT a duplicate of `photos`

Overlap analysis by filename + exact byte size:
- 863 files overlap, totalling 3.24 GB
- out of 35,186 distinct `Pictures-old` filenames

By name, the two sets are overwhelmingly **distinct content**. This does not
mean `Pictures-old` is worth keeping — old exports and renamed copies would
not match by name — but deleting it is **not a safe no-op**. Verify against the
local HDD first.

**Checksum dedup is not available server-side:** the bucket is SSE-KMS
encrypted, so S3 ETags are not MD5 hashes. Content-level comparison must happen
against local files.

### Local copy status (Carl, 2026-08-31)

- **No** complete local copy of the 769 GB.
- A local copy exists of what is most precious, and likely most of it.
- HDD to be brought online for review.

### THE VERSIONING TRAP — read before deleting anything

Versioning is **enabled** on `media-klequis-us-east-1`.

`aws s3 rm` will **not** reduce the bill. It writes delete markers and retains
every object as a noncurrent version, which continues to be billed. To actually
stop the charges, the object *versions* must be deleted.

Dry run to size it up first:

```bash
aws s3api list-object-versions --bucket media-klequis-us-east-1 \
  --prefix "Pictures-old/" --query 'length(Versions)'
```

The actual deletion should be walked through interactively rather than run from
a one-liner pasted out of this document.

### Effect of deleting the two candidates

| | Before | After |
|---|---|---|
| Bucket size | 769 GB | 363 GB |
| Storage cost (current tiers) | $6.68/mo | ~$1.55/mo |
| Full retrieval egress (bulk) | ~$69 | ~$33 |
| Full retrieval, free-tier paced | 8 months | 4 months |

Deletion itself is free — S3 DELETE requests carry no charge, and
Intelligent-Tiering has no minimum storage duration, so there is no
early-deletion penalty at any time.

**This single step does more for both cost and the egress problem than every
other item in this document combined.** It should happen before any decision
about storage classes (Plan item 1).

---

## 3. Current Plan — **NOT FINAL**

> This is the plan as it stood before the egress concern was raised. Item 1 is
> now explicitly **on hold** pending the size-reduction work in 2.1. Items 2-4
> are independent of that decision and remain safe to proceed with.

### ON HOLD — 1. Enable archive tiers on `media-klequis-us-east-1`

Would save ~$69/yr ($6.68/mo → $0.96/mo). Intelligent-Tiering charges nothing
for tier transitions and the change is reversible.

```bash
aws s3api put-bucket-intelligent-tiering-configuration \
  --bucket media-klequis-us-east-1 --id archive-deep \
  --intelligent-tiering-configuration '{
    "Id":"archive-deep","Status":"Enabled","Filter":{},
    "Tierings":[{"Days":90,"AccessTier":"ARCHIVE_ACCESS"},
                {"Days":180,"AccessTier":"DEEP_ARCHIVE_ACCESS"}]}'
```

**Why it is on hold:** these are family photos. Deep Archive Access means an
explicit restore request and up to 12 hours before any object can be read, and
a 180-day minimum storage duration. Do not commit to this until the bucket has
been reduced to data genuinely classified as "archive".

**Middle option:** drop the `DEEP_ARCHIVE_ACCESS` line and keep only
`ARCHIVE_ACCESS`. Result is $3.28/mo with 3-5 hour restores instead of 12.

**Better option, pending 2.2:** apply the aggressive tiering to specific
prefixes only, leaving anything browsable in an instant-access tier.

### 2. Delete orphan KMS key — saves $12/yr, zero risk

`alias/documents-klequis` protects `documents-klequis-us-east-1`, verified to
contain **0 objects**. Nothing can be lost.

```bash
aws kms schedule-key-deletion \
  --key-id 84d01762-ccce-4373-a30f-1b625c9edf18 \
  --pending-window-in-days 30
```

The 30-day window is reversible via `cancel-key-deletion`.

### 3. Archive `documents.current.bk` — saves ~$13/yr

48.5 GB across only 19 objects, so transition cost is ~$0.001.

```bash
aws s3 cp s3://documents.current.bk s3://documents.current.bk --recursive \
  --storage-class DEEP_ARCHIVE --region us-west-2
```

**Review the 19 objects first** — it is a 2021 backup and may simply be
deletable, which saves the same $13/yr with no retrieval penalty at all.

### 4. Prune Route 53 hosted zones — $6/yr each

Carl's decision on which domains are still wanted. `carlbecker.dev` is the
obvious first candidate (NS + SOA only). No DNS changes to be made without
explicit per-zone confirmation.

### Projected outcome

| Scenario | $/mo |
|---|---|
| Today | ~12.70 |
| Items 2-4 only (media bucket untouched) | ~9.00 |
| Items 2-4 + media bucket archived | ~4.80 |
| Above + Route 53 pruned to 2 zones | ~3.30 |

---

## 4. Open Questions

1. ~~Is there a complete local copy of the 769 GB?~~ **ANSWERED 2026-08-31:**
   No complete copy. A local copy exists of what is most precious and likely
   most of it. HDD to be brought online for review. See 2A.
2. ~~What is the breakdown of the 769 GB by top-level prefix?~~
   **ANSWERED 2026-08-31 — see section 2A.** `Pictures-old` (401 GB) and
   `of-daniel.tmp` (4.6 GB) are 53% of the bucket and both are delete
   candidates.
2b. **NEW:** How much of `photos` / `videos` / `Scanned Pictures` (360 GB) is
   covered by the local HDD copy? Determines the real backup gap.
3. Confirm the 100 GB/mo free egress allowance against current AWS Free Tier
   terms.
4. How much of the 769 GB is genuinely irreplaceable vs. re-derivable
   (exports, renders, downloaded media)?
5. What is the actual target monthly spend? "Around $3" was the historical
   baseline — is that the goal, or is $5-6 acceptable for real backup value?

---

## 5. Note on Data Safety

Separate from cost, and worth stating: 769 GB of irreplaceable family photos
in a single S3 bucket is one copy, in one provider, under one set of
credentials. S3's durability protects against hardware failure — not against
an accidental delete, a lost login, or a billing lapse.

Versioning is already enabled on the bucket, which is good. A local copy on an
external drive would both close the backup gap and make the $69 egress
question moot permanently. There is a `mout-brand-new-4-tb-drive/` directory
in this repo, which suggests this may already be in hand.

**The cheapest fix for the egress problem is not needing to retrieve.**

---

## 6. How to Resume (session handover)

This document is intended to be self-sufficient. Everything below regenerates
the numbers in it. All commands are **read-only**.

**State as of 2026-08-31:** analysis complete, nothing executed, no AWS
resources modified. Blocked on Carl bringing the HDD online (see 2A).

### Regenerate the prefix breakdown (section 2A)

The working file `media-keys.tsv` lived in a session scratchpad and is gone.
Rebuild it — ~81 LIST requests, about $0.0004, a few seconds:

```bash
aws s3api list-objects-v2 --bucket media-klequis-us-east-1 \
  --query 'Contents[].[Key,Size]' --output text > media-keys.tsv
```

Then aggregate by top-level prefix:

```bash
python3 -c '
import collections
agg=collections.defaultdict(lambda:[0,0])
for line in open("media-keys.tsv"):
    p=line.rstrip("\n").split("\t")
    if len(p)!=2: continue
    k,s=p[0],int(p[1])
    top=k.split("/")[0] if "/" in k else "(root)"
    agg[top][0]+=s; agg[top][1]+=1
for k,(b,n) in sorted(agg.items(), key=lambda x:-x[1][0]):
    print("%-40s %8.2f GB %7d obj" % (k, b/1073741824, n))
'
```

### Regenerate the billing picture (section 1)

```bash
# cost by service, by month
aws ce get-cost-and-usage --time-period Start=2026-05-01,End=2026-09-01 \
  --granularity MONTHLY --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE

# S3 broken out by usage type (shows the tier split)
aws ce get-cost-and-usage --time-period Start=2026-06-01,End=2026-09-01 \
  --granularity MONTHLY --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=USAGE_TYPE \
  --filter '{"Dimensions":{"Key":"SERVICE","Values":["Amazon Simple Storage Service"]}}'

aws ce get-cost-forecast --time-period Start=2026-09-01,End=2026-10-01 \
  --metric UNBLENDED_COST --granularity MONTHLY
```

Note: Cost Explorer API calls cost $0.01 each.

### Regenerate bucket sizes without paying for LIST requests

CloudWatch is free and gives size per storage class. Storage types to query:
`StandardStorage`, `StandardIAStorage`, `IntelligentTieringFAStorage`,
`IntelligentTieringIAStorage`, `IntelligentTieringAIAStorage`,
`GlacierInstantRetrievalStorage`, `GlacierStorage`, `DeepArchiveStorage`.
Use `NumberOfObjects` with `StorageType=AllStorageTypes` for counts.

```bash
aws cloudwatch list-metrics --namespace AWS/S3 --metric-name BucketSizeBytes \
  --region us-east-1     # then get-metric-statistics per bucket+storage-type
```

**Check both regions** — `documents.current.bk` is in **us-west-2**, everything
else is us-east-1. It was missed on the first pass.

### Gotchas that cost time on the first pass

- CloudWatch `BucketSizeBytes` reports each Intelligent-Tiering tier as a
  **separate metric**. Querying only FA and IA under-reports the bucket by the
  AIA tier — that is how 769 GB initially looked like 401 GB.
- Buckets in us-west-2 are invisible to us-east-1 CloudWatch calls.
- SSE-KMS means ETags are **not** MD5, so no server-side checksum dedup.
- Versioning is enabled: `aws s3 rm` does not reduce billed storage. See 2A.

### Next action

Carl brings the HDD online and determines coverage of `Pictures-old` (401 GB)
and `of-daniel.tmp` (4.6 GB). Everything else waits on that.
