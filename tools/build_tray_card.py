#!/usr/bin/env python3
"""Build the Notile-site copy of Tray Card (tray-card/index.html): one self-contained page (no CDN), under the site's CSP.

    python3 tools/build_tray_card.py <Tray Card source folder> --deps <folder with node_modules>

The source folder holds the Tray Card artifact's files: index.html, library.js, manifold-wasm.js.
Make the deps folder once with:
    npm i three@0.160.0 three-mesh-bvh@0.7.8 three-bvh-csg@0.0.17 manifold-3d@3.5.5 esbuild@0.24.0

* three.js, its add-ons, three-mesh-bvh, three-bvh-csg and the Manifold glue are bundled from node_modules with esbuild
  (the artifact copy loads them from jsdelivr, which the site CSP does not allow).
* library.js (Gothic arch plates) and manifold-wasm.js are inlined.
* Site head: CSP (with 'wasm-unsafe-eval' for the Manifold engine), manifest, icons; the logo returns to the launcher.
* Public-site rule: no box that takes patient details. The embossed ID text is limited to a 4-character label.
"""
import re, subprocess, sys, json, argparse
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument('src', help='folder with the Tray Card index.html, library.js and manifold-wasm.js')
ap.add_argument('--deps', required=True, help='folder where the npm packages above are installed')
a = ap.parse_args()
src_dir, site, here = Path(a.src), Path(__file__).resolve().parents[1], Path(a.deps).resolve()
html = (src_dir / 'index.html').read_text()
first, rest = html.split('\n', 1)
assert first.startswith('<!doctype html><html><head><meta charset=utf8>'), 'unexpected wrapper line'
doc = rest
if doc.rstrip().endswith('</html>\n\n</body></html>') or doc.rstrip().endswith('</body></html>'):
    doc = doc.rstrip()
    assert doc.endswith('</body></html>')
    doc = doc[:-len('</body></html>')].rstrip() + '\n'   # the artifact wrapper's closing tags

def sub1(pat, rep, s, flags=0):
    n = len(re.findall(pat, s, flags))
    assert n == 1, (n, pat[:80])
    return re.sub(pat, lambda m: rep, s, count=1, flags=flags)

# ---- bundle the module script ----
m = re.search(r'<script type="module">([\s\S]*?)</script>', doc)
code = m.group(1)
code = code.replace("import('https://cdn.jsdelivr.net/npm/manifold-3d@3.5.5/manifold.js')", "import('manifold-3d/manifold.js')")
assert 'cdn.jsdelivr' not in code, 'another CDN reference in the module'
(here / 'entry.js').write_text(code)
subprocess.run([str(here / 'node_modules/.bin/esbuild'), str(here / 'entry.js'), '--bundle', '--format=esm', '--platform=browser',
                '--target=es2020', '--minify', '--legal-comments=none', '--alias:three/addons=three/examples/jsm',
                '--external:node:module', '--outfile=' + str(here / 'bundle.js'), '--log-level=warning'], check=True, cwd=here)
bundle = (here / 'bundle.js').read_text()
(here / 'entry.js').unlink(); (here / 'bundle.js').unlink()
assert 'cdn.jsdelivr' not in bundle and 'https://unpkg' not in bundle
bundle = bundle.replace('</script', '<\\/script')
doc = doc[:m.start()] + '<script type="module">\n' + bundle + '\n</script>' + doc[m.end():]
doc = sub1(r'<script type="importmap">[\s\S]*?</script>\s*', '', doc)

# ---- inline the plate library and the Manifold engine ----
for f in ['library.js', 'manifold-wasm.js']:
    tag = f'<script src="{f}"></script>'
    assert doc.count(tag) == 1, f
    body = (src_dir / f).read_text().replace('</script', '<\\/script')
    doc = doc.replace(tag, '<script>\n' + body + '\n</script>')

# ---- fonts: the site's own (no third-party requests) ----
doc = sub1(r'<link rel="preconnect" href="https://fonts\.googleapis\.com">\n', '', doc)
doc = sub1(r'<link href="https://fonts\.googleapis\.com/css2\?family=Inter[^"]*" rel="stylesheet">\n', '<link rel="stylesheet" href="/fonts/fonts.css">\n', doc)
doc = sub1(r'font-family:Inter,system-ui,sans-serif;', "font-family:'Source Sans 3',Inter,system-ui,sans-serif;", doc)
assert 'googleapis' not in doc and 'gstatic' not in doc
# ---- site head ----
head_add = '''<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' data: blob:; worker-src 'self' blob:; manifest-src 'self'; base-uri 'self'; form-action 'none'; object-src 'none'; upgrade-insecure-requests">
<meta name="referrer" content="no-referrer">
<meta name="description" content="Tray Card: special trays and record bases from a scan, with Gothic arch plates built in, for 3D printing. Runs on your own device.">
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#0B2E4A">
<link rel="icon" href="/icons/icon-192.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-title" content="Tray Card">
'''
doc = sub1(r'<head>\n', '<head>\n' + head_add, doc)
assert '<html lang="en">' in doc
doc = doc.replace('<html lang="en">', '<html lang="en-GB">', 1)
# the logo returns to the launcher, as in the other apps
doc = sub1(r'<div class="brand"><i></i>Tray Card</div>', '<a class="brand" href="/" title="All Notile apps"><i></i>Tray Card</a>', doc)
doc = sub1(r'#top \.brand\{', '#top .brand{color:inherit;text-decoration:none;', doc)
# no box for patient details: the embossed ID is a short label only
doc = sub1(r'<input type="text" id="tText" placeholder="e\.g\. PATIENT ID / U">',
           '<input type="text" id="tText" maxlength="4" autocomplete="off" spellcheck="false" placeholder="e.g. U or L2" title="A short label only (up to 4 letters or numbers): no patient names or numbers">', doc)
doc = doc.replace('</body>', '<script>document.addEventListener("DOMContentLoaded",()=>{const t=document.getElementById("tText");if(t)t.addEventListener("input",e=>{const v=e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g,"").slice(0,4);if(v!==e.target.value)e.target.value=v;});});</script>\n</body>', 1)

out = site / 'tray-card'
out.mkdir(exist_ok=True)
(out / 'index.html').write_text(doc)
(out / 'manifest.webmanifest').write_text(json.dumps({
    "name": "Tray Card", "short_name": "Tray Card",
    "description": "Special trays and record bases with Gothic arch plates, for 3D printing.",
    "start_url": "./", "scope": "./", "display": "standalone",
    "background_color": "#0B2E4A", "theme_color": "#0B2E4A",
    "icons": [{"src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
              {"src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png"}]}, indent=2) + '\n')
print('wrote', out / 'index.html', len(doc), 'bytes')
