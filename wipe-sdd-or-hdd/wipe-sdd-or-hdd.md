## Instructions for SSD

### Step 1 — Identify the interface (SATA vs NVMe)

Boot from the Ubuntu live USB on the machine that has the SSD. Then run:

```bash
lsblk -d -o NAME,TRAN,MODEL
```

- If `TRAN` shows `sata` and the device is `/dev/sdX` → follow the **SATA SSD** path below
- If `TRAN` shows `nvme` and the device is `/dev/nvme0n1` → follow the **NVMe SSD** path below

**This drive: NVMe — `/dev/nvme0n1` (WD Green SN3000 2TB)**

---

### Step 2 — Install nvme-cli

```bash
sudo apt update && sudo apt install -y nvme-cli
```

### Step 3 — Confirm the device and check for cryptographic erase support

```bash
sudo nvme id-ctrl /dev/nvme0n1 | grep -i fna
```

Look for `fna` field. If bit 0 is set, cryptographic erase is supported (preferred).

Also double-check you have the right drive:

```bash
sudo nvme id-ctrl /dev/nvme0n1 | grep -i "mn\|sn"
```

`mn` = model name, `sn` = serial number. Confirm it matches the drive you intend to erase.

### Step 4 — Erase

**Preferred: cryptographic erase** (destroys the internal encryption key — instant and irreversible)

```bash
sudo nvme format /dev/nvme0n1 --ses=2
```

**Fallback: user data erase** (if `--ses=2` is rejected by the drive)

```bash
sudo nvme format /dev/nvme0n1 --ses=1
```

If the command completes without error, the drive is erased. There is no progress bar — it finishes in seconds.

### Step 5 — Verify (optional)

```bash
sudo nvme id-ns /dev/nvme0n1 | grep nsze
```

If it returns namespace info without error, the drive is functional and erased.

---

## Secure Erase Recommendations

### SSD (2TB — system disk)

SSDs **cannot be reliably erased with overwrite tools** like `shred` or DBAN. Wear leveling and over-provisioning hide data in areas that overwrite passes never touch. Use the drive's built-in firmware erase instead.

**Determine interface first:**
```bash
lsblk -d -o NAME,TRAN,MODEL
```

**If SATA SSD — ATA Secure Erase via `hdparm`:**
```bash
# Check status (must not say "frozen")
hdparm -I /dev/sdX | grep -i security

# If "frozen": suspend the machine for 1 second to unfreeze, then retry
systemctl suspend

# Set a temporary password, then erase
hdparm --user-master u --security-set-pass temppass /dev/sdX
hdparm --user-master u --security-erase temppass /dev/sdX
# Use --security-erase-enhanced if offered — it's more thorough
```

**If NVMe SSD:**
```bash
dnf install nvme-cli
nvme format /dev/nvme0n1 --ses=1   # ses=1 = user data erase; ses=2 = cryptographic erase (preferred)
```

Cryptographic erase (`--ses=2`) is the gold standard for NVMe — it destroys the internal encryption key, rendering all data unrecoverable instantly.

---

### HDDs

Standard overwrite is effective on magnetic disks.

**Recommended tool: `nwipe`** (DBAN's successor, has a TUI)
```bash
dnf install nwipe
nwipe  # interactive — select drives and method
```

Choose **DoD Short** (3 passes) or **Gutmann** (35 passes, overkill but thorough). For drives being disposed of, DoD Short is widely accepted. For drives being returned to a store, a single-pass zero wipe is usually sufficient and faster.

**Or with `shred` (no TUI needed):**
```bash
shred -vz -n 3 /dev/sdX   # 3 random passes + final zero pass
```

---

### Before starting

Install and verify tools, identify all drives:
```bash
dnf install hdparm nvme-cli nwipe smartmontools
lsblk -d -o NAME,SIZE,TRAN,MODEL,SERIAL
smartctl -i /dev/sdX   # confirm you have the right drive before erasing
```

---

### Summary table

| Drive | Method | Tool | Notes |
|---|---|---|---|
| SATA SSD | ATA Secure Erase | `hdparm` | May need suspend to unfreeze |
| NVMe SSD | Cryptographic Erase | `nvme format --ses=2` | Instant, very reliable |
| HDD (dispose) | DoD 3-pass | `nwipe` | ~hours per TB |
| HDD (return to store) | Single zero pass | `shred -n0 -z` | Fast, removes your data |

For extremely sensitive data on HDDs that won't be returned to a store, physical destruction (drill through platters) is the only guarantee — no software erase is 100% irreversible against a lab with electron microscopes.