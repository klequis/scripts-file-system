# Hard Drive Commands

```bash
lsblk
```

This shows all block devices (drives and partitions) regardless of mount status. For more detail:

```bash
lsblk -o NAME,SIZE,TYPE,MOUNTPOINT,SERIAL,MODEL
```

Other options:

```bash
# Show all disks with more detail including serial numbers
sudo fdisk -l

# List only disk-type devices
lsblk -d

# Using udev info
ls /dev/disk/by-id/
```

`lsblk` is usually the quickest and cleanest option.


## Chat GPT instructions for checking the health of a HDD

Use the Linux command line — here are concise, practical checks and commands for HDD health (works for 4TB drives).

1) Identify the device
- lsblk -o NAME,SIZE,MODEL,SERIAL,MOUNTPOINT
- sudo fdisk -l

2) SMART health (recommended)
- Install smartmontools if needed: sudo apt install smartmontools
- View overall SMART summary: sudo smartctl -H /dev/sdX
- Full SMART data: sudo smartctl -a /dev/sdX
- Run short self-test (non-destructive): sudo smartctl -t short /dev/sdX
  - Check results: sudo smartctl -l selftest /dev/sdX
- Run long/extended test (can take many hours): sudo smartctl -t long /dev/sdX

3) Check for reallocated sectors / errors
- sudo smartctl -A /dev/sdX | egrep 'Reallocated_Sector_Ct|Current_Pending_Sector|Offline_Uncorrectable'
- Any non-zero values are warning signs.

4) Read-only surface check (non-destructive)
- sudo badblocks -sv /dev/sdX
- To do a destructive test (writes), use badblocks -wsv — do not run on important data.

5) Filesystem check (unmounted)
- sudo umount /dev/sdXn
- For ext4: sudo e2fsck -f -y /dev/sdXn
- For XFS: sudo xfs_repair /dev/sdXn (must be unmounted)

6) Monitor I/O errors in kernel log
- sudo dmesg --ctime | egrep -i 'sdX|ata|error|fail'
- Or follow live: sudo journalctl -kf

7) Continuous monitoring
- Enable SMART daemon: sudo systemctl enable --now smartd
- Configure /etc/smartd.conf for alerts and periodic tests.

8) Quick read/write sanity test (non-destructive)
- dd if=/dev/sdX of=/dev/null bs=1M count=1000 status=progress

Replace /dev/sdX with your drive (e.g., /dev/sdb) and /dev/sdXn with the partition (e.g., /dev/sdb1). Back up important data before running destructive tests.