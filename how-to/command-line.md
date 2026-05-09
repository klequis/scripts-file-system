
## Find files

**case sensitive**
find /run/media/carl/A1-2026-05 -name ".BridgeSort"

**case insensitive**
find /run/media/carl/A1-2026-05 -iname ".bridgesort"

## Delete files

find /run/media/carl/A1-2026-05 -name ".BridgeSort" -delete

## File count

*Counts only files. Directories are excluded*

find /run/media/carl/A1-2026-05/orig -type f | wc -l


