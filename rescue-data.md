# Rescue data

```bash
carl@fedora:~$ lsblk -o NAME,SIZE,MOUNTPOINT
NAME          SIZE MOUNTPOINT
sda           1.8T 
└─sda1        1.8T 
sdb           1.8T 
└─sdb1        1.8T /mnt/storage
zram0           8G [SWAP]
nvme0n1     465.8G 
├─nvme0n1p1   600M /boot/efi
├─nvme0n1p2     2G /boot
└─nvme0n1p3 463.2G /home
```