# Scan Card: working on it

`../src/` is the source and `../README.md` says how the pieces fit. This folder holds what is needed to change the code
and prove the change: the test harness, the tests, and the conventions every page keeps.

## The working folder

The tests were written against a working folder at `/home/claude/suite` and use that path (harness, test data, output).
`setup.sh` builds it from `../src/`; `sync.sh` copies edited pages back.

```
sh scan-card/dev/setup.sh            # src/ -> /home/claude/suite  (npm packages, Manifold engine file, test scans)
…edit /home/claude/suite/{shared,scan-card,model-card,analysis-card,splint-card}…
sh scan-card/dev/sync.sh             # /home/claude/suite -> src/
python3 tools/build_scan_card.py --deps /home/claude/suite
```

| working folder | source file |
|---|---|
| `shared/core.js`, `shared/solid.js` | `src/core.js`, `src/solid.js` |
| `scan-card/index.html` | `src/index.html` (the hub) |
| `model-card/index.html` | `src/model.html` |
| `analysis-card/index.html` | `src/analysis.html` |
| `splint-card/index.html` | `src/splint.html` |

`pw.cjs` is the harness: `openApp('<folder>')` serves the working folder to headless Chrome under a content security
policy close to a Claude artifact's, maps the jsdelivr imports to `node_modules`, blocks every other outside request and
collects page errors. It needs Playwright (`PLAYWRIGHT=playwright` to take it from `NODE_PATH`) and Chrome
(`CHROME_PATH`). `NO_CSP=1` switches the policy off (needed for the hub tests that open the site's Tray Card and Wax
Card pages, which bring their own policy and fonts).

## The tests

Run one with `node dev/tests/<folder>/<file>` from the working folder. A script prints what it measured; lines marked ✗
or FAIL, or a non-empty `errors`, mean it failed.

| folder | what it proves |
|---|---|
| `tests/core.test.mjs`, `tests/solid.test.mjs`, `tests/coretest.cjs` | the engine in Node and in the browser: mesh clean-up, orientation, case file, scan to solid, hollowing |
| `tests/model-card/` | Model Card on its own: every option, trim, file types, iPad and phone, exports re-read and measured (`verify.cjs` then `verify.mjs`, `verify-hinge.mjs`) |
| `tests/analysis-card/` | Analysis Card on its own: `t1` … `t11` (widths against the designed teeth, Bolton by hand calculation, arch, sections, touch); `NOTES.md` has the numbers |
| `tests/splint-card/` | Splint Card on its own: `f1` … `f5` in the browser, `verify.mjs` / `accuracy.mjs` and the kernel tests in Node; `NOTES.md` has the pipeline and its limits |
| `tests/suite/` | one case file through all three stand-alone pages and back (`roundtrip.cjs` then `roundtrip.mjs`); an independent check of exported splints |
| `tests/hub/` | Scan Card itself, below |

| hub test | what it proves |
|---|---|
| `h1-flow.cjs` | scans loaded once reach Models, Analysis and Splint byte for byte; own Load/Orient/Trim steps hidden; the lock; trim on the Scans tab starts a tool again; undo |
| `h2-work.cjs` | real work inside the tools (48 clicked contact points, a built splint, hollow models) gives the stand-alone results, is saved as one case, and comes back in a fresh Scan Card and in a stand-alone page |
| `h3-layout.cjs` | iPad portrait, iPad landscape and phone: nothing spills, tabs reachable (needs `NO_CSP=1` and the site's `tray-card`, `wax-card`, `fonts`, `icons` folders linked into the working folder) |
| `h4-edges.cjs` | tools opened before scans, one arch only, scans removed, files dropped on a tool, reload and resume, a tool page that never starts |
| `h5-artifact.cjs` | the artifact copy: frames by address, the fetch + srcdoc fallback, and saving through a stand-in for the artifact's downloads (copy the built artifact folder to `art-test/`, add `index-srcdoc.html` with `"frames":"srcdoc"` and `index-claude.html` with a fake `window.claude`) |
| `h6-big.cjs`, `h6-mem.cjs` | times and memory with 448k + 350k triangle scans |
| `h7-lru.cjs` | with large scans the least recently used tool is closed and comes back with its work, at its step |
| `h8-exports.cjs` | STL files saved through the hub are byte-identical to what the tool computes; a colour PLY scan keeps its colours into Wax Card (needs `NO_CSP=1`) |

The built site pages are tested from the site's own `tests/smoke.js` (three Scan Card tests, under the real site CSP)
and `tests/offline/offline.js` (Scan Card and all five tools inside the single offline file).

Test scans are synthetic (regular mesh, idealised teeth). `tests/mkdata.mjs` and `mkdata2.mjs` write them to `data/`:
scanner-position pairs with ground truth, a hypodontia pair, a dirty scan (holes, flipped patch, floating bits), a part
arch, colour PLY, wrong units, broken files. After the demo button, `APP.scans.demoTruth` holds each tooth's designed
width and contact points. Nothing has been tried on a real patient scan.

## Rules for a page

* One HTML file: markup, a small `<style>` for its own extras, one inline `<script type="module">` importing `./core.js`
  (and `./solid.js` if it builds solids). No framework; any further library pinned from `cdn.jsdelivr.net/npm` only.
* It must run as a Claude artifact and on the Notile site: no `alert` / `confirm` / `prompt`, no `window.open`, no
  network requests; files are offered only through `N.saveFile` / `N.saveFiles` from a click handler; `localStorage`
  and IndexedDB may be missing (try/catch, never depend on them).
* No patient identifiers: no input where a name, date of birth, CHI or hospital number could be typed, no free text.
* Design aids, not certified medical-device software: say so once where output is exported. No clinical threshold is
  presented as fact unless it carries a named, checked source.
* Plain UK English, a `title` on every button, `.tip` paragraphs for a step's "?" help.
* Mouse, touch and Apple Pencil: `viewer.setTool` and pointer events; nothing hover-only or right-click-only.
* A test hook: `window.APP = { N, shell, viewer, scans, … }`.
* A new tool for the hub: build it like the three existing ones (they need nothing hub-specific beyond what
  `createScanSet` does), then add it to `TOOLS` in `src/index.html` with its case `key` and item `roles`, to
  `tools/build_scan_card.py`, `/sw.js` and `tools/build_offline_suite.py`.

## Conventions the core fixes for everyone

* Millimetres. **Case frame = LPS**: `+X` patient's left, `+Y` posterior, `+Z` up. Occlusal plane ≈ `z = 0`.
  Lower teeth point `+Z`, upper teeth point `−Z`. The viewer is z-up.
  View presets: `top` looks down on the lower occlusal surface; `bottom` looks up at the upper occlusal surface.
* Mesh = `{ positions: Float32Array, indices: Uint32Array, colors?: Float32Array }` ("MeshData").
* A scan keeps its original scanner coordinates (`raw`) plus `matrix` (raw → case frame). `scans.framed(jaw)` gives the
  mesh in the case frame. Scan objects in the scene carry that matrix, so picks come back in case-frame (world) coordinates.
* The **case file** is a zip (`case.json` + `meshes/*.ply`). Scans are items with roles `upper-scan` / `lower-scan`.
  Each app keeps its own saved state under `dcase.data.<appKey>` (`model`, `splint`, `analysis`) and may add mesh items
  with roles `upper-model`, `lower-model`, `splint`. Unknown sections must be left untouched (the core does this).

## Skeleton

```html
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Analysis Card — model analysis</title>
<script type="importmap">
{"imports":{
 "three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
 "three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/",
 "three-mesh-bvh":"https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.7.8/build/index.module.js"
}}
</script>
<!-- only if you import ./solid.js: add  "manifold-3d/manifold.js":"https://cdn.jsdelivr.net/npm/manifold-3d@3.5.5/manifold.js"
     to the importmap above, and this tag:  <script src="manifold-wasm.js"></script> -->
<style>/* app-specific extras only — the core injects the shared look */</style>
</head><body>
<script type="module">
import * as N from './core.js';
const THREE = N.THREE;
let scans;
const shell = N.createShell({ name: 'Analysis Card', tagline: 'Model analysis', title: document.title,
  emptyHtml: '<div><b>No scan loaded</b>Drop an STL, PLY or OBJ scan here, or use “Load scans”.</div>',
  onDropFiles: (f) => scans.loadFiles(f),
  steps: [ { id: 'load', title: 'Load scans', html: '' }, { id: 'orient', title: 'Check orientation', html: '' },
           { id: 'mine', title: 'My step', html: '<p class="lead">…</p>' } ] });
const viewer = N.createViewer(shell.view);
N.addViewButtons(shell, viewer);
scans = N.createScanSet({ shell, viewer, appName: 'Analysis Card', loadStep: 'load', orientStep: 'orient',
  onChange: (what) => { /* 'loaded' | 'cleared' | 'oriented' | 'case' | 'visibility' */ },
  extendCase: (dcase) => { dcase.data.analysis = { /* your saved state */ }; },
  readCase: (dcase) => { /* restore from dcase.data.analysis */ } });
shell.onStepChange((i, prev) => { /* switch tools / overlays per step */ });
shell.goto(0);
window.APP = { N, shell, viewer, scans };
</script></body></html>
```

`core.js` is documented inline — read its header comments and JSDoc (shell, viewer, tools, mesh utilities, topology,
file I/O, case file, orientation, height fields, demo scans with ground truth, `PointTool`, `createScanSet`).
`dev/coretest/index.html` is a tiny working example.

## Solids (`solid.js`, only for apps that build printable parts)

`import * as S from './solid.js'; await S.ready();` — Manifold (WebAssembly) for watertight booleans. Documented inline. In short:

* `S.scanToSolid(mesh, { baseZ, margin, smooth })` closes an open scan (teeth pointing +Z) into a watertight solid by dropping a
  wall from its border to a flat base. The scan's own triangles are kept exactly, so undercuts and fit surfaces are true to the scan.
* `S.toManifold(mesh)` / `S.fromManifold(man)`; then `a.add(b)`, `a.subtract(b)`, `a.intersect(b)`, `man.translate/rotate/transform`,
  `M.Manifold.cylinder/cube/sphere/extrude/levelSet`, `M.CrossSection` (2D offset/boolean) — see `node_modules/manifold-3d/manifold-encapsulated-types.d.ts`.
  Manifold objects live in wasm memory: `S.free(a, b)` when done with them.
* `S.fieldSolid(topField, bottomFieldOrZ, { mask })` — watertight solid between two height fields (core `rasterHeightfield`, `morphField`).
* `S.hollow(man, { wall, openBelow })`, `S.distanceField(man)`, `S.textSolid('AB12', { height, depth })`, `S.cleanOutline(loop, …)`.
* Node can import `core.js` and `solid.js` directly for fast geometry-only tests (see `dev/tests/solid.test.mjs`);
  `dev/tests/stlshots.cjs` renders STL files from `dev/out/` to PNG so you can look at what you made.
