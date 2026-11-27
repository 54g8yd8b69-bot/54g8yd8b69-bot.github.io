#!/usr/bin/env python3
"""Builds photo-card/PhotoCardSorter.gs, the Google Apps Script that files image.canon photos in Drive into case folders.
It is drive-sorter/core.js with the QR and JPEG readers (from vendor/) wrapped in after it, as one file to paste.
Run from anywhere: python3 photo-card/tools/build_drive_sorter.py"""
import pathlib
here = pathlib.Path(__file__).resolve().parent.parent
core = (here / 'drive-sorter/core.js').read_text()
jsqr = (here / 'vendor/jsQR-1.4.0.js').read_text()
jpeg = (here / 'vendor/jpeg-js-decoder-0.4.4.js').read_text()
libs = f"""

// ---------------------------------------------------------------------------------------------------------------
// The QR and JPEG readers the sorter uses, unchanged: jsQR 1.4.0 (Apache-2.0) and the jpeg-js 0.4.4 decoder
// (Apache-2.0 / BSD-3-Clause). Nothing below here needs changing.
function PhotoCardLibs() {{
  if (PhotoCardLibs.cache) return PhotoCardLibs.cache;
  var jsQR, jpegDecode;
  (function () {{ var module = {{ exports: {{}} }}, exports = module.exports, define;
{jsqr}
  jsQR = module.exports; }})();
  (function () {{ var module = {{ exports: {{}} }}, exports = module.exports, window;
{jpeg}
  jpegDecode = module.exports; }})();
  return (PhotoCardLibs.cache = {{ jsQR: jsQR, jpegDecode: jpegDecode }});
}}
"""
out = here / 'PhotoCardSorter.gs'
out.write_text(core.rstrip() + libs)
print(out, out.stat().st_size, 'bytes')
