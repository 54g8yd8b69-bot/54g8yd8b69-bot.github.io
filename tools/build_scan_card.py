#!/usr/bin/env python3
"""Build the Notile-site copy of Scan Card from scan-card/src/: self-contained pages (no CDN), under the site's CSP.

    python3 tools/build_scan_card.py --deps <folder with node_modules> [--artifact <folder> --tray <folder> --wax <folder>]

Make the deps folder once with:
    npm i three@0.160.0 three-mesh-bvh@0.7.8 manifold-3d@3.5.5 esbuild@0.24.0

Scan Card is one app made of four pages that share scan-card/src/core.js (and solid.js for the two that build solids):

    scan-card/src/index.html     the hub: loads, orients and tidies the scans once, keeps the case file, shows the tools as tabs
    scan-card/src/model.html     Models   (Model Card)      ->  /scan-card/model/
    scan-card/src/analysis.html  Analysis (Analysis Card)   ->  /scan-card/analysis/
    scan-card/src/splint.html    Splint   (Splint Card)     ->  /scan-card/splint/
    scan-card/src/compare.html   Compare  (Compare Card)    ->  /scan-card/compare/
    scan-card/src/prep.html      Prep check (Prep Card)     ->  /scan-card/prep/
    scan-card/src/survey.html    Survey   (Survey Card)     ->  /scan-card/survey/
    scan-card/src/shell.html     Shells   (Shell Card)      ->  /scan-card/shell/

The hub shows each tool in a frame; a tool page that finds the hub above it takes its scans from there (see "inside
Scan Card" in core.js). Opened on its own address, each tool page is still the complete stand-alone app. The hub's
other two tabs are the existing /tray-card/ and /wax-card/ pages, loaded as they are.

What this script does for the site:
* three.js, its add-ons, three-mesh-bvh and the Manifold glue are bundled from node_modules with esbuild
  (the source pages load them from jsdelivr through an import map, which the site CSP does not allow).
* The Manifold engine (WebAssembly) is inlined into the two pages that use it.
* Site head: CSP ('wasm-unsafe-eval' only where the engine runs, frames only on the hub), the site's own fonts,
  manifest and icons; the hub's logo returns to the launcher and each tool's logo returns to the hub.
* Public-site rule: no box that takes patient details. The only text boxes are the model labels (4 characters).

--artifact <folder> also writes the files for the Claude artifact copy: the source pages as they are, plus
manifold-wasm.js (the artifact loads the libraries from jsdelivr, so nothing is bundled). --tray and --wax name folders
holding the Tray Card and Wax Card artifact files (index.html, and for Tray Card library.js and manifold-wasm.js); they
are copied to <folder>/tray/ and <folder>/wax/ so that the two tabs work inside the artifact too. One line is added
to the head of each copy: inside an artifact only the top page can save files, and that line points the page at the hub
for it (see SCANHUB.claude in src/index.html).
"""
import argparse, base64, json, re, shutil, subprocess, sys
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument('--deps', required=True, help='folder where the npm packages above are installed')
ap.add_argument('--artifact', help='also write the artifact copy into this folder')
ap.add_argument('--tray', help='folder with the Tray Card artifact files, for the artifact copy')
ap.add_argument('--wax', help='folder with the Wax Card artifact files, for the artifact copy')
a = ap.parse_args()
site, deps = Path(__file__).resolve().parents[1], Path(a.deps).resolve()
src, out = site / 'scan-card' / 'src', site / 'scan-card'

def sub1(pat, rep, s, flags=0):
    n = len(re.findall(pat, s, flags))
    assert n == 1, (n, pat[:80])
    return re.sub(pat, lambda m: rep, s, count=1, flags=flags)

FONT = "'Source Sans 3'"
CSP = ("default-src 'none'; script-src 'self' 'unsafe-inline'{wasm}; style-src 'self' 'unsafe-inline'; font-src 'self'; "
       "img-src 'self' data: blob:; connect-src 'self' data: blob:;{frames} worker-src 'self' blob:; manifest-src 'self'; "
       "base-uri 'self'; form-action 'none'; object-src 'none'; upgrade-insecure-requests")
PAGES = [
    # source, output, uses the solid engine, settings for core.js / the hub, description
    ('index.html', 'index.html', False,
     {'NOTILE': {'fonts': False, 'family': FONT},
      'SCAN_CARD': {'home': '/', 'urls': {'model': 'model/', 'analysis': 'analysis/', 'splint': 'splint/', 'compare': 'compare/', 'prep': 'prep/', 'survey': 'survey/', 'shell': 'shell/', 'tray': '/tray-card/', 'wax': '/wax-card/'}}},
     'Scan Card: study models, model analysis, splints, scan comparison, preparation checks, surveying and block-out, shell temporaries and matrices, special trays and wax-ups from one patient scan. Runs on your own device.'),
    ('model.html', 'model/index.html', True, {'NOTILE': {'fonts': False, 'family': FONT, 'home': '../', 'homeTitle': 'Scan Card'}},
     'Model Card, part of Scan Card: turn a scan into a printable study or working model. Runs on your own device.'),
    ('analysis.html', 'analysis/index.html', False, {'NOTILE': {'fonts': False, 'family': FONT, 'home': '../', 'homeTitle': 'Scan Card'}},
     'Analysis Card, part of Scan Card: tooth widths, Bolton, space, arch form and occlusion measured on a scan. Runs on your own device.'),
    ('splint.html', 'splint/index.html', True, {'NOTILE': {'fonts': False, 'family': FONT, 'home': '../', 'homeTitle': 'Scan Card'}},
     'Splint Card, part of Scan Card: design a splint or guard on a scan for 3D printing. Runs on your own device.'),
    ('compare.html', 'compare/index.html', False, {'NOTILE': {'fonts': False, 'family': FONT, 'home': '../', 'homeTitle': 'Scan Card'}},
     'Compare Card, part of Scan Card: line up two scans of the same arch and see what changed. Runs on your own device.'),
    ('prep.html', 'prep/index.html', False, {'NOTILE': {'fonts': False, 'family': FONT, 'home': '../', 'homeTitle': 'Scan Card'}},
     'Prep Card, part of Scan Card: undercuts, wall angles, convergence and clearance of a tooth preparation on a scan. Runs on your own device.'),
    ('survey.html', 'survey/index.html', True, {'NOTILE': {'fonts': False, 'family': FONT, 'home': '../', 'homeTitle': 'Scan Card'}},
     'Survey Card, part of Scan Card: survey lines, undercut depths and a blocked-out model for a path of insertion on a scan. Runs on your own device.'),
    ('shell.html', 'shell/index.html', False, {'NOTILE': {'fonts': False, 'family': FONT, 'home': '../', 'homeTitle': 'Scan Card'}},
     'Shell Card, part of Scan Card: a provisional crown or shell to reline from a scan before the preparation, or a clear matrix over a wax-up. Runs on your own device.'),
]
wasm_js = 'window.MANIFOLD_WASM_B64="' + base64.b64encode((deps / 'node_modules/manifold-3d/manifold.wasm').read_bytes()).decode() + '";\n'

work = deps / '.scan-card-build'
if work.exists():
    shutil.rmtree(work)
work.mkdir()
for f in ['core.js', 'solid.js']:
    shutil.copy(src / f, work / f)

for name, target, solid, settings, desc in PAGES:
    doc = (src / name).read_text(encoding='utf-8')
    hub = name == 'index.html'
    # ---- bundle the module script ----
    m = re.search(r'<script type="module">([\s\S]*?)</script>', doc)
    code = m.group(1)
    assert 'cdn.jsdelivr' not in code, 'a CDN reference in the module of ' + name
    (work / 'entry.js').write_text(code, encoding='utf-8')
    subprocess.run([str(deps / 'node_modules/.bin/esbuild'), str(work / 'entry.js'), '--bundle', '--format=esm', '--platform=browser',
                    '--target=es2020', '--minify', '--legal-comments=none', '--alias:three/addons=three/examples/jsm',
                    '--external:node:module', '--outfile=' + str(work / 'bundle.js'), '--log-level=warning'], check=True, cwd=work)
    bundle = (work / 'bundle.js').read_text(encoding='utf-8')
    assert 'cdn.jsdelivr' not in bundle and 'https://unpkg' not in bundle
    assert ('fonts.googleapis.com' in bundle) and ('NOTILE' in bundle), 'core.js no longer reads window.NOTILE?'
    bundle = bundle.replace('</script', '<\\/script')
    doc = doc[:m.start()] + '<script type="module">\n' + bundle + '\n</script>' + doc[m.end():]
    doc = sub1(r'<script type="importmap">[\s\S]*?</script>\s*', '', doc)
    # ---- the Manifold engine ----
    tag = '<script src="manifold-wasm.js"></script>'
    assert doc.count(tag) == (1 if solid else 0), name
    if solid:
        doc = doc.replace(tag, '<script>\n' + wasm_js + '</script>')
    # ---- site head ----
    conf = '<script>' + ';'.join(f'window.{k}={json.dumps(v, separators=(",", ":"))}' for k, v in settings.items()) + '</script>'
    title = re.search(r'<title>([^<]*)</title>', doc).group(1)
    app = title.split(' — ')[0]
    up = '' if hub else '../'
    head_add = f'''<meta http-equiv="Content-Security-Policy" content="{CSP.format(wasm=" 'wasm-unsafe-eval'" if solid else '', frames=" frame-src 'self';" if hub else '')}">
<meta name="referrer" content="no-referrer">
<meta name="description" content="{desc}">
<link rel="stylesheet" href="/fonts/fonts.css">
<link rel="manifest" href="{up}manifest.webmanifest">
<meta name="theme-color" content="#0B2E4A">
<link rel="icon" href="/icons/icon-192.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-title" content="{app if hub else 'Scan Card'}">
{conf}
'''
    doc = sub1(r'<meta charset="utf-8">\n', '<meta charset="utf-8">\n' + head_add, doc)
    doc = sub1(r'<html lang="en"', '<html lang="en-GB"', doc)
    assert 'googleapis.com' not in doc.replace(bundle, ''), 'a font link is left in the page of ' + name
    # the only text boxes allowed on the public site are the 4-character model labels
    boxes = re.findall(r'<(?:input(?![^>]*type="(?:range|checkbox|number|file|radio)")[^>]*|textarea[^>]*)>', doc.replace(bundle, ''))
    assert all('maxlength="4"' in b for b in boxes), ('a free-text box in ' + name, boxes)
    (out / target).parent.mkdir(parents=True, exist_ok=True)
    (out / target).write_text(doc, encoding='utf-8')
    print('wrote', (out / target).relative_to(site), len(doc.encode()), 'bytes')
shutil.rmtree(work)

(out / 'manifest.webmanifest').write_text(json.dumps({
    "name": "Scan Card", "short_name": "Scan Card",
    "description": "Study models, model analysis, splints, scan comparison, preparation checks, surveying and block-out, shell temporaries and matrices, special trays and wax-ups from one patient scan.",
    "start_url": "./", "scope": "./", "display": "standalone",
    "background_color": "#0B2E4A", "theme_color": "#0B2E4A",
    "icons": [{"src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
              {"src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png"}]}, indent=2) + '\n')

if a.artifact:
    art = Path(a.artifact)
    art.mkdir(parents=True, exist_ok=True)
    for f in ['model.html', 'analysis.html', 'splint.html', 'compare.html', 'prep.html', 'survey.html', 'shell.html', 'core.js', 'solid.js']:
        shutil.copy(src / f, art / f)
    (art / 'manifold-wasm.js').write_text(wasm_js)
    doc = (src / 'index.html').read_text(encoding='utf-8')
    # frames: 'both' = load each tool's page as a frame address and, if that does not start, fetch it and hand it over
    conf = '<script>window.SCAN_CARD=' + json.dumps({'urls': {'tray': 'tray/index.html', 'wax': 'wax/index.html'}, 'frames': 'both'}, separators=(',', ':')) + '</script>\n'
    (art / 'index.html').write_text(sub1(r'<script type="importmap">', conf + '<script type="importmap">', doc), encoding='utf-8')
    door = '<script>try{if(!window.claude&&parent!==window&&parent.SCANHUB&&parent.SCANHUB.claude)window.claude=parent.SCANHUB.claude}catch(e){}</script>'
    for name, folder, files in [('tray', a.tray, ['index.html', 'library.js', 'manifold-wasm.js']), ('wax', a.wax, ['index.html'])]:
        if not folder:
            continue
        (art / name).mkdir(exist_ok=True)
        for f in files:
            if f == 'index.html':
                page = (Path(folder) / f).read_text(encoding='utf-8')
                if door not in page:
                    page = sub1(r'<head[^>]*>', re.search(r'<head[^>]*>', page).group(0) + door, page) if len(re.findall(r'<head[^>]*>', page)) == 1 else page.replace('<head>', '<head>' + door, 1)
                (art / name / f).write_text(page, encoding='utf-8')
            else:
                shutil.copy(Path(folder) / f, art / name / f)
    print('artifact copy in', art)
