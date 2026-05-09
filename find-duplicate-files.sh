#!/usr/bin/env bash
set -euo pipefail

# find-duplicate-files.sh
# Usage: ./find-duplicate-files.sh --dir /path/to/search --ext jpg png nef [--skip-archives]
# Output: duplicates_<timestamp>.csv next to this script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Archive extensions excluded by --skip-archives
ARCHIVE_EXTENSIONS=(tar tgz gz bz2 xz zst lz4 lzma tbz2 txz zip 7z rar cab iso img dmg)

usage() {
    echo "Usage: $0 --dir <dir1> [--dir <dir2> ...] --ext <ext1> [ext2 ...] [--skip-archives]"
    echo "  --dir            Directory to search recursively (can be specified multiple times)"
    echo "  --ext            One or more file extensions (without dot), e.g. jpg png nef"
    echo "  --skip-archives  Exclude archive/compressed files (tar, gz, zip, 7z, iso, etc.)"
    exit 1
}

DIRS=()
EXTENSIONS=()
SKIP_ARCHIVES=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dir)
            DIRS+=("$2")
            shift 2
            ;;
        --ext)
            shift
            while [[ $# -gt 0 && "$1" != --* ]]; do
                EXTENSIONS+=("$1")
                shift
            done
            ;;
        --skip-archives)
            SKIP_ARCHIVES=true
            shift
            ;;
        *)
            echo "Unknown argument: $1"
            usage
            ;;
    esac
done

[[ ${#DIRS[@]} -eq 0 ]] && { echo "Error: --dir is required"; usage; }
[[ ${#EXTENSIONS[@]} -eq 0 ]] && { echo "Error: --ext is required"; usage; }
for d in "${DIRS[@]}"; do
    [[ ! -d "$d" ]] && { echo "Error: directory not found: $d"; exit 1; }
done

command -v jdupes &>/dev/null || { echo "Error: jdupes is not installed"; exit 1; }

TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
OUTPUT="$SCRIPT_DIR/duplicates_${TIMESTAMP}.csv"

# Build find expression for extensions
FIND_ARGS=()
for i in "${!EXTENSIONS[@]}"; do
    [[ $i -gt 0 ]] && FIND_ARGS+=(-o)
    FIND_ARGS+=(-iname "*.${EXTENSIONS[$i]}")
done

# Build find exclusion expression for archives
EXCLUDE_ARGS=()
if [[ "$SKIP_ARCHIVES" == true ]]; then
    for i in "${!ARCHIVE_EXTENSIONS[@]}"; do
        EXCLUDE_ARGS+=(-iname "*.${ARCHIVE_EXTENSIONS[$i]}" -o)
    done
    # Remove trailing -o
    unset 'EXCLUDE_ARGS[${#EXCLUDE_ARGS[@]}-1]'
fi

echo "Scanning:"
for d in "${DIRS[@]}"; do echo "  $d"; done
echo "Extensions: ${EXTENSIONS[*]}"
[[ "$SKIP_ARCHIVES" == true ]] && echo "Skipping archives: ${ARCHIVE_EXTENSIONS[*]}"
echo "Output: $OUTPUT"
echo

# Write CSV header
echo "group_id,file_path,size_bytes,hash" > "$OUTPUT"

group_id=0
current_group_files=()

flush_group() {
    if [[ ${#current_group_files[@]} -gt 1 ]]; then
        group_id=$((group_id + 1))
        for f in "${current_group_files[@]}"; do
            size=$(stat -c '%s' "$f")
            hash=$(xxhsum "$f" 2>/dev/null | awk '{print $1}' || sha256sum "$f" | awk '{print $1}')
            # Escape double quotes in path
            escaped="${f//\"/\"\"}"
            echo "$group_id,\"$escaped\",$size,$hash" >> "$OUTPUT"
        done
    fi
    current_group_files=()
}

# Build the find command based on options
if [[ "$SKIP_ARCHIVES" == true ]]; then
    FIND_CMD=(find "${DIRS[@]}" -type f ! \( "${EXCLUDE_ARGS[@]}" \) \( "${FIND_ARGS[@]}" \) -print0)
else
    FIND_CMD=(find "${DIRS[@]}" -type f \( "${FIND_ARGS[@]}" \) -print0)
fi

# Run jdupes and parse its output
# jdupes outputs groups separated by blank lines, one file per line
while IFS= read -r line; do
    if [[ -z "$line" ]]; then
        flush_group
    else
        current_group_files+=("$line")
    fi
done < <("${FIND_CMD[@]}" | jdupes -0 -r -)

# Flush final group (no trailing blank line)
flush_group

total_groups=$group_id
if [[ $total_groups -eq 0 ]]; then
    echo "No duplicates found."
    rm "$OUTPUT"
else
    echo "Found $total_groups duplicate group(s)."
    echo "Results written to: $OUTPUT"
fi
