
**Check for bad blocks**

```
sudo badblocks -v /dev/sdX
```

**Check drive health**

```
sudo smartctl -a /dev/sdX

// extended

sudo smartctl -a -x /dev/sdX
```
