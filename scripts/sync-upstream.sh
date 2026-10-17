#!/usr/bin/env bash
# Merge upstream (oblien/openship) into the sync/upstream branch with branding
# factored out. Used by .github/workflows/upstream-sync.yml and by people resolving
# a sync by hand: the same command gives the same merge in both places.
#
#   bash scripts/sync-upstream.sh [base-branch]     # base defaults to main
#
# Exit status:
#   0  merged cleanly; overlay applied and verified; committed on sync/upstream
#   1  conflicts: left in the working tree, nothing committed. Resolve each one (it
#      is a fork change overlapping an upstream change, so which side wins is your
#      call), then `git add`, `node scripts/rebrand-kovalio.mjs`, and `git commit`.
#   3  already up to date with upstream
set -euo pipefail

base="${1:-main}"
upstream_url="https://github.com/oblien/openship.git"
branch="sync/upstream"

cd "$(git rev-parse --show-toplevel)"

git remote add upstream "$upstream_url" 2>/dev/null || git remote set-url upstream "$upstream_url"
git fetch --no-tags upstream main
git fetch --no-tags origin "$base"

# Brand-aware merge driver, configured locally only (never a committed
# .gitattributes, which upstream owns and would conflict on).
git config merge.kovalio-brand.name "three-way merge with Kovalio branding factored out"
git config merge.kovalio-brand.driver "node scripts/brand-merge-driver.mjs %O %A %B %L %P"
attributes="$(git rev-parse --git-path info/attributes)"
mkdir -p "$(dirname "$attributes")"
grep -qx '\* merge=kovalio-brand' "$attributes" 2>/dev/null || echo '* merge=kovalio-brand' >> "$attributes"

git checkout -B "$branch" "origin/$base"

if git merge-base --is-ancestor upstream/main HEAD; then
  echo "Already up to date with upstream."
  exit 3
fi

upstream_sha="$(git rev-parse --short upstream/main)"
git -c merge.renameLimit=20000 merge upstream/main --no-ff --no-commit || true

conflicts="$(git diff --name-only --diff-filter=U)"
if [ -n "$conflicts" ]; then
  echo "::group::Conflicts needing a decision"
  echo "$conflicts"
  echo "::endgroup::"
  printf '%s\n' "$conflicts" > .git/SYNC_CONFLICTS
  exit 1
fi

# Paths: new or moved upstream files arrive under the old name. A rename that would
# collide with a different Kovalio-named file is a conflict too (exit 2).
if ! node scripts/rebrand-kovalio.mjs; then
  echo "Overlay found path collisions; see above."
  exit 1
fi
node scripts/rebrand-kovalio.mjs --check
if git grep -lE '^(<<<<<<<|>>>>>>>) ' -- . ; then
  echo "Conflict markers left in the tree."
  exit 1
fi

git add -A
git commit --no-edit -m "chore(sync): merge upstream/main (${upstream_sha}) with Kovalio branding"
echo "Merged upstream ${upstream_sha} into ${branch}."
