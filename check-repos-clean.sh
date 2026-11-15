#!/usr/bin/env bash
set -uo pipefail

# check-repos-clean.sh
# Usage: ./check-repos-clean.sh [--root <dir>] [--fetch] [--all]
# Walks every top-level directory under --root (default ~/P), and for each one
# that is a git repo reports anything that is NOT "everything committed and
# everything pushed":
#   - staged, unstaged or untracked changes
#   - stashes
#   - detached HEAD
#   - local branches with no upstream
#   - local branches ahead of their upstream
# Exit code: 0 when every repo is clean, 1 when at least one is not.

usage() {
    echo "Usage: $0 [--root <dir>] [--fetch] [--all]"
    echo "  --root <dir>  Parent directory whose child directories are checked (default: ~/P)"
    echo "  --fetch       Run 'git fetch --all --quiet' in each repo first, so ahead/behind"
    echo "                counts reflect the remote and not a stale local tracking ref"
    echo "  --all         Also list repos that are clean (default: only repos with problems)"
    exit 1
}

ROOT_DIR="$HOME/P"
DO_FETCH=false
SHOW_ALL=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --root)  ROOT_DIR="$2"; shift 2 ;;
        --fetch) DO_FETCH=true; shift ;;
        --all)   SHOW_ALL=true; shift ;;
        -h|--help) usage ;;
        *) echo "Unknown argument: $1"; usage ;;
    esac
done

if [[ ! -d "$ROOT_DIR" ]]; then
    echo "Not a directory: $ROOT_DIR" >&2
    exit 2
fi

repos_checked=0
repos_with_problems=0
non_git_dirs=()

for repo_dir in "$ROOT_DIR"/*/; do
    repo_dir="${repo_dir%/}"
    repo_name="$(basename "$repo_dir")"

    if ! git -C "$repo_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        non_git_dirs+=("$repo_name")
        continue
    fi
    repos_checked=$((repos_checked + 1))

    if $DO_FETCH; then
        git -C "$repo_dir" fetch --all --quiet 2>/dev/null || true
    fi

    problems=()

    # Staged / unstaged / untracked changes
    staged_count=$(git -C "$repo_dir" diff --cached --name-only | wc -l)
    unstaged_count=$(git -C "$repo_dir" diff --name-only | wc -l)
    untracked_count=$(git -C "$repo_dir" ls-files --others --exclude-standard | wc -l)
    [[ $staged_count    -gt 0 ]] && problems+=("$staged_count staged file(s) not committed")
    [[ $unstaged_count  -gt 0 ]] && problems+=("$unstaged_count modified file(s) not staged")
    [[ $untracked_count -gt 0 ]] && problems+=("$untracked_count untracked file(s)")

    # Stashes
    stash_count=$(git -C "$repo_dir" stash list | wc -l)
    [[ $stash_count -gt 0 ]] && problems+=("$stash_count stash(es)")

    # Detached HEAD
    if ! git -C "$repo_dir" symbolic-ref -q HEAD >/dev/null; then
        problems+=("detached HEAD at $(git -C "$repo_dir" rev-parse --short HEAD)")
    fi

    # Every local branch: must have an upstream and be ahead by 0
    while IFS=$'\t' read -r branch_name upstream_name ahead_behind; do
        [[ -z "$branch_name" ]] && continue
        if [[ -z "$upstream_name" ]]; then
            problems+=("branch '$branch_name' has no upstream (never pushed)")
            continue
        fi
        # ahead_behind looks like "[ahead 2]", "[behind 1]", "[ahead 2, behind 1]", "[gone]" or ""
        if [[ "$ahead_behind" == *gone* ]]; then
            problems+=("branch '$branch_name' tracks '$upstream_name' which no longer exists")
        elif [[ "$ahead_behind" =~ ahead\ ([0-9]+) ]]; then
            problems+=("branch '$branch_name' is ahead of '$upstream_name' by ${BASH_REMATCH[1]} commit(s)")
        fi
    done < <(git -C "$repo_dir" for-each-ref --format='%(refname:short)%09%(upstream:short)%09%(upstream:track)' refs/heads/)

    if [[ ${#problems[@]} -gt 0 ]]; then
        repos_with_problems=$((repos_with_problems + 1))
        echo "NOT CLEAN  $repo_name"
        for problem in "${problems[@]}"; do
            echo "           - $problem"
        done
    elif $SHOW_ALL; then
        echo "clean      $repo_name"
    fi
done

echo
echo "Checked $repos_checked repo(s) under $ROOT_DIR: $repos_with_problems with uncommitted or unpushed work."
if [[ ${#non_git_dirs[@]} -gt 0 ]]; then
    echo "Skipped ${#non_git_dirs[@]} non-git director(ies): ${non_git_dirs[*]}"
fi

[[ $repos_with_problems -eq 0 ]]
