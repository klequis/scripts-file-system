## Check permissions for a EXT4 drive

Assuming the drive is mounted at, say, `/mnt/mydrive`:

```bash
# Set permissions on the mount point itself
sudo chmod 775 /mnt/mydrive

# Set all directories to 775
sudo find /mnt/mydrive -type d -exec chmod 775 {} +

# Set files to 664 (no execute for regular files)
sudo find /mnt/mydrive -type f -exec chmod 664 {} +
```

If you also want to set the **owner and group**:

```bash
sudo chown -R carl:carl /mnt/mydrive
```

**Why not `chmod -R 775` for everything?**  
`-R` applies the same mode to both files and directories. Giving files the execute bit (`x`) is usually wrong — only binaries/scripts should have it. Using `find` with `-type d` and `-type f` separately gives you proper control.

**For executables/scripts only:**
```bash
sudo find /mnt/mydrive -type f -name "*.sh" -exec chmod 775 {} +
```