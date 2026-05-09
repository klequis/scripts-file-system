**Why:** KDE auto-mounts drives at `/run/media/carl/<name>` — fine for removable use, but for permanent storage use `/etc/fstab` so the drive mounts automatically at boot at a stable path.

**Steps:**

1. Get the drive's UUID:
    ```bash
    sudo blkid
    ```
2. Create a mount point (name it whatever makes sense):
    ```bash
    sudo mkdir /mnt/storage
    ```
3. Add to `/etc/fstab`:
    ```bash
    sudo nano /etc/fstab
    ```
    Append (adjust UUID, path, and filesystem type as needed):
    ```
    UUID=your-uuid-here  /mnt/storage  btrfs  compress=zstd,defaults  0  0
    ```
    For ext4, use: `UUID=...  /mnt/storage  ext4  defaults  0  2`
    Save: `Ctrl+O`, Enter, `Ctrl+X`
4. Unmount the KDE auto-mount if the drive is already mounted:
    ```bash
    sudo umount /run/media/carl/drive-name
    ```
    If "target is busy": `cd ~` first, or find the process with `lsof +D /run/media/carl/drive-name`
5. Test without rebooting:
    ```bash
    sudo mount -a
    df -h /mnt/storage
    ```
6. Fix ownership so your user can write:
    ```bash
    sudo chown carl:carl /mnt/storage
    ```

**Common pitfall:** Typo `/etc/fsab` instead of `/etc/fstab` — double-check the filename when editing.