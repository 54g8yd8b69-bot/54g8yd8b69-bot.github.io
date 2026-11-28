#!/bin/sh
# Copy the pages edited in the working folder back into scan-card/src.   sh scan-card/dev/sync.sh [folder]
set -e
HERE=$(cd "$(dirname "$0")" && pwd); D="$HERE/../src"; S=${1:-/home/claude/suite}
cp "$S/scan-card/index.html" "$D/index.html"
cp "$S/model-card/index.html" "$D/model.html"; cp "$S/analysis-card/index.html" "$D/analysis.html"; cp "$S/splint-card/index.html" "$D/splint.html"
cp "$S/compare-card/index.html" "$D/compare.html"; cp "$S/prep-card/index.html" "$D/prep.html"; cp "$S/survey-card/index.html" "$D/survey.html"; cp "$S/shell-card/index.html" "$D/shell.html"
cp "$S/articulator-card/index.html" "$D/articulator.html"; cp "$S/obturator-card/index.html" "$D/obturator.html"; cp "$S/cbct-card/index.html" "$D/cbct.html"
cp "$S/shared/core.js" "$D/core.js"; cp "$S/shared/solid.js" "$D/solid.js"; cp "$S/shared/dicom.js" "$D/dicom.js"
cp "$S/shared/toothseg-worker.js" "$D/toothseg-worker.js"      # the CBCT tab's tooth-model worker (bundled into scan-card/cbct/toothseg/worker.js by the build)
cp "$S/dev/pw.cjs" "$HERE/pw.cjs"
echo "src/ updated from $S (tests are not copied back: copy new ones into scan-card/dev/tests by hand)"
