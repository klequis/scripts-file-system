# AI Handoff

## Project goal

This workspace is for verifying that two directory trees are identical after copying data between storage devices.

Current focus:
- Compare an existing source tree and destination tree without modifying either tree.
- Produce human-readable logs plus a machine-readable CSV listing differences.
- Keep all generated output under the project directory so the results move with the project.

## Current files

- `verify-copies.sh`
  - Main verification script.
- `verify-two-copies-are-identical.md`
  - Older documentation snippet. It is stale and does not reflect the current script behavior.
- `rsync-copy-process.md`
  - Separate notes about using `rsync` for copying.
- `src/` and `dest/`
  - Local sample directories used for testing.
- `verify-logs/`
  - Output from test runs.

## Current behavior of verify-copies.sh

The script takes two arguments:

```bash
./verify-copies.sh /path/to/src /path/to/dest
```

What it does:
- Reads all regular files under both trees.
- Builds sorted SHA-256 manifests for each tree using relative paths.
- Diffs the two manifest files.
- Writes logs and output files into:

```text
<script-directory>/verify-logs/YYYY-MM-DD_HHMMSS/
```

Generated files per run:
- `run.log`
- `src-files.sha256`
- `dst-files.sha256`
- `checksum-diff.txt`
- `differences.csv` only when differences are found

Important behavior notes:
- The process is read-only with respect to the two compared trees.
- The process is not globally read-only because it writes logs and reports into `verify-logs/`.
- It does not use `rsync` for verification. It uses per-file SHA-256 manifests and compares them afterward.

## CSV format

When differences are found, the script writes `differences.csv` with header:

```csv
sourceFile,distFile,match
```

Semantics:
- File exists in both trees but content differs:

```csv
"./path/file.txt","./path/file.txt",false
```

- File exists only in source:

```csv
"./path/file.txt","",false
```

- File exists only in destination:

```csv
"","./path/file.txt",false
```

The user asked for `distFile` in the CSV, even though the script variable name is `DST`.

## Verified test behavior in this workspace

Sample test data was created in `src/` and `dest/`.

Observed cases that were tested successfully:
- Same file on both sides: `a.txt`
- Same file on both sides: `sub-b.txt`
- Same relative filename but different content: `mismatch.txt`
- Only in source: `only-src.txt`
- Only in destination: `only-dest.txt`

Observed `rsync` dry-run output for the sample data:

```text
*deleting   only-dest.txt
>fcsT...... mismatch.txt
>f+++++++++ only-src.txt
```

Observed `differences.csv` output for the sample data:

```csv
sourceFile,distFile,match
"./mismatch.txt","./mismatch.txt",false
"","./only-dest.txt",false
"./only-src.txt","",false
```

## Why rsync is not the current implementation

The user asked whether `rsync` could do the same job.

Conclusion reached:
- `rsync -rcn --delete --itemize-changes src/ dest/` can compare trees in dry-run mode without modifying files.
- That is useful for a yes/no style verification and path-level difference report.
- It does not naturally produce the manifest artifacts or the custom CSV output the user requested.
- The current script keeps explicit SHA-256 manifests, a unified diff, and a CSV report.

## Important repo state notes

- `verify-copies.sh` is the source of truth.
- `verify-two-copies-are-identical.md` still contains an older version of the script:
  - logs to `$HOME/verify-logs/...` instead of the script directory
  - contains the old broken multiline redirections
  - does not mention `differences.csv`

If continuing this work, either update that markdown or replace it with content copied from the current script behavior.

## Likely next tasks

Possible next improvements, depending on what the user wants:
- Update `verify-two-copies-are-identical.md` so it matches the current script.
- Always emit `differences.csv`, even when there are no differences, for a stable output contract.
- Add an overall tree checksum derived from the sorted manifest for quick yes/no comparison.
- Add better summary counts for mismatched vs source-only vs destination-only files.
- Decide whether `differences.csv` should contain absolute paths or keep the current relative paths.

## Environment assumptions

- Linux shell environment.
- `bash`, `find`, `xargs`, `sha256sum`, `sort`, `diff`, `grep`, and `awk` available.
- The script directory must be writable because logs are created under `verify-logs/`.

## Recommended starting point for the next agent

1. Read `verify-copies.sh` first.
2. Treat `verify-two-copies-are-identical.md` as outdated unless it has been updated.
3. If validating behavior, rerun the script against `src/` and `dest/`.
4. Inspect the latest directory under `verify-logs/` for concrete output examples.