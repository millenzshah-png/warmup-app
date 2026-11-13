#!/bin/sh
# Build the app and publish dist/ to the gh-pages branch, which GitHub Pages
# serves. Run it with `npm run deploy` whenever the live link should change.
#
# The branch holds only the built site and is replaced on every deploy, so
# the push is forced. Nothing on main is touched.
set -e

cd "$(dirname "$0")/.."
ROOT=$(pwd)

if [ -n "$(git status --porcelain)" ]; then
  echo "There are uncommitted changes. Commit them first so the live site matches a commit." >&2
  exit 1
fi

npm test
npm run build

REMOTE=$(git remote get-url origin)
SHA=$(git rev-parse --short HEAD)
NAME=$(git config user.name)
EMAIL=$(git config user.email)

OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
cp -R "$ROOT/dist/." "$OUT/"
# Tell Pages to serve the files exactly as they are.
touch "$OUT/.nojekyll"

cd "$OUT"
git init -q -b gh-pages
git add -A
git -c user.name="$NAME" -c user.email="$EMAIL" commit -q -m "Deploy $SHA"
git push -q --force "$REMOTE" gh-pages

echo "Published commit $SHA to the gh-pages branch."
