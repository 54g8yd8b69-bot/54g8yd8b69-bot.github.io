#!/bin/sh
# Build the working folder the tests expect from scan-card/src (see README.md here).   sh scan-card/dev/setup.sh [folder]
set -e
HERE=$(cd "$(dirname "$0")" && pwd); SRC="$HERE/../src"; SITE=$(cd "$HERE/../.." && pwd); W=${1:-/home/claude/suite}
[ "$W" = /home/claude/suite ] || echo "note: the tests use absolute paths under /home/claude/suite"
mkdir -p "$W/shared" "$W/model-card" "$W/analysis-card" "$W/splint-card" "$W/compare-card" "$W/prep-card" "$W/survey-card" "$W/scan-card" "$W/dev/data" "$W/dev/out"
cp "$SRC/core.js" "$SRC/solid.js" "$W/shared/"
cp "$SRC/index.html" "$W/scan-card/index.html"
cp "$SRC/model.html" "$W/model-card/index.html"; cp "$SRC/analysis.html" "$W/analysis-card/index.html"; cp "$SRC/splint.html" "$W/splint-card/index.html"
cp "$SRC/compare.html" "$W/compare-card/index.html"; cp "$SRC/prep.html" "$W/prep-card/index.html"; cp "$SRC/survey.html" "$W/survey-card/index.html"
for t in model analysis splint compare prep survey; do ln -sfn "../$t-card/index.html" "$W/scan-card/$t.html"; done      # the hub's default addresses, served from the tool folders
for d in tray-card wax-card fonts icons; do ln -sfn "$SITE/$d" "$W/$d"; done                          # the site's pages for the Trays and Wax-up tabs
cp "$HERE/pw.cjs" "$W/dev/"; cp -r "$HERE/tests" "$HERE/coretest" "$HERE/stlview" "$W/dev/"
cd "$W"
[ -f package.json ] || npm init -y >/dev/null
[ -d node_modules/manifold-3d ] || npm i three@0.160.0 three-mesh-bvh@0.7.8 three-bvh-csg@0.0.17 manifold-3d@3.5.5 esbuild@0.24.0
node -e "const fs=require('fs');fs.writeFileSync('shared/manifold-wasm.js','window.MANIFOLD_WASM_B64=\"'+fs.readFileSync('node_modules/manifold-3d/manifold.wasm').toString('base64')+'\";\n')"
[ -f dev/data/demo-lower.stl ] || { node dev/tests/mkdata.mjs && node dev/tests/mkdata2.mjs; }
[ -f dev/data/prep-lower.stl ] || node dev/tests/prep-card/mkprep.mjs
[ -f dev/data/prep-lean-lower.stl ] || LEAN=25 node dev/tests/prep-card/mkprep.mjs
[ -f dev/data/bite-key.stl ] || node dev/tests/bite/mkbite.mjs
[ -f dev/data/prep-onlay-lower.stl ] || KIND=onlay node dev/tests/prep-card/mkpartial.mjs
[ -f dev/data/prep-inlay-lower.stl ] || KIND=inlay node dev/tests/prep-card/mkpartial.mjs
echo "working folder ready: $W"
