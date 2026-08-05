#!/usr/bin/env bash
# One deploy, both origins. Run from the repo root: ./deploy.sh
#
# WHY THIS EXISTS. The app has always been reachable at two URLs:
#   thesolvagroup.com/gym      - the VPS web root, where Mark's phone installed from
#   pyramidman23.github.io/gym - GitHub Pages, switched on in the repo SETTINGS (no workflow file,
#                                no CNAME), serving whatever is on `main`
# GitHub Pages predates the VPS path and nobody turned it off, so the two drifted apart every time
# a build shipped to the VPS without `main` moving. On 2026-08-05 the VPS was on w63 while Pages was
# still serving w59, four builds behind. This has stranded a user on an old build before.
#
# The fix is NOT to delete one URL: an installed PWA keeps its ORIGIN, and localStorage is
# per-origin, so redirecting github.io would make a user who installed from there look like they had
# lost every workout they had logged. Instead both origins are published from the SAME commit, in
# one command, so they cannot diverge.
set -euo pipefail

BOX="root@45.32.242.242"
WEBROOT="/root/.openclaw/workspace/solva-website/gym"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
BUILD="$(grep -o "w[0-9]*-[0-9a-z-]*" build.js | head -1)"
# Every file the service worker lists, plus the icons it caches. Never `git archive` - that shipped
# tests/ and the artifacts PNGs to the public web root once already.
FILES=(index.html styles.css build.js core.js exercises.js profiles.js sync.js coach.js app.js
       manifest.json sw.js icon.svg icon-maskable.svg icon-180.png icon-512.png icon-maskable-512.png)

echo "== deploying ${BUILD} from ${BRANCH} =="

# A deploy must correspond to a real commit, or nobody can ever say what is live.
if [ -n "$(git status --porcelain)" ]; then
  echo "REFUSING: working tree is dirty. Commit first." >&2
  exit 1
fi

echo "-- 1/4 backup + push to the VPS"
ssh -o StrictHostKeyChecking=no "$BOX" "cp -a ${WEBROOT} /root/gym-backup-$(date +%Y%m%d-%H%M%S)-pre-${BUILD}"
scp -o StrictHostKeyChecking=no "${FILES[@]}" "${BOX}:${WEBROOT}/"
ssh -o StrictHostKeyChecking=no "$BOX" "chmod -R a+rX ${WEBROOT}"

echo "-- 2/4 fast-forward main so GitHub Pages serves the same commit"
git push -q origin "${BRANCH}"
git push -q origin "${BRANCH}:main"

echo "-- 3/4 verify the VPS serves ${BUILD}, byte-identical"
STAMP=$(date +%s); FAIL=0
LIVE=$(curl -s "https://thesolvagroup.com/gym/build.js?cb=${STAMP}" | grep -o "w[0-9]*-[0-9a-z-]*" | head -1)
[ "$LIVE" = "$BUILD" ] || { echo "   MISMATCH: vps serves ${LIVE}"; FAIL=1; }
for f in "${FILES[@]}"; do
  case "$f" in *.png) continue;; esac   # binaries are compared by the build id, not by curl
  L=$(tr -d '\r' < "$f" | md5sum | cut -d' ' -f1)
  R=$(curl -s "https://thesolvagroup.com/gym/${f}?cb=${STAMP}" | tr -d '\r' | md5sum | cut -d' ' -f1)
  [ "$L" = "$R" ] || { echo "   DRIFT: $f"; FAIL=1; }
done
[ "$FAIL" = "0" ] && echo "   vps ok: ${BUILD}, all files byte-identical"

echo "-- 4/4 GitHub Pages (rebuilds asynchronously, so this polls)"
for i in $(seq 1 30); do
  PAGES=$(curl -s "https://pyramidman23.github.io/gym/build.js?cb=$(date +%s)" | grep -o "w[0-9]*-[0-9a-z-]*" | head -1 || true)
  [ "$PAGES" = "$BUILD" ] && { echo "   pages ok: ${BUILD}"; break; }
  [ "$i" = "30" ] && { echo "   pages still on ${PAGES:-unknown} after 5 min - check the repo's Pages build"; FAIL=1; }
  sleep 10
done

exit "$FAIL"
