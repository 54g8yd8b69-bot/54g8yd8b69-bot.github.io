# Scan Card

One app for everything that starts from a patient scan. The scans are loaded, oriented and tidied **once**; the tools
are tabs that all work on those scans.

| tab | what it is | address on the site |
|---|---|---|
| Scans | load, check orientation, tidy and trim, choose a tool; keeps the case file | `/scan-card/` (the hub) |
| Models | Model Card: scan to printable model (base, hollowing, label, bite hinge) | `/scan-card/model/` |
| Analysis | Analysis Card: tooth widths, Bolton, space, arch form, occlusion, restorative space, report | `/scan-card/analysis/` |
| Splint | Splint Card: splints and guards, checked against the opposing arch | `/scan-card/splint/` |
| Trays | the existing Tray Card page, as it is | `/tray-card/` |
| Wax-up | the existing Wax Card page, as it is | `/wax-card/` |

Each tool page is still a complete app when opened on its own address (with its own Load and Orient steps).

## Layout

```
scan-card/
  src/             the source: edit here
    index.html       the hub
    model.html  analysis.html  splint.html
    core.js          shared engine: shell, 3D viewer, mesh tools, scan loading, orientation, trim, case file, hub hand-off
    solid.js         scan to watertight solid, booleans, hollowing, lettering (Manifold, WebAssembly)
  index.html  model/  analysis/  splint/  manifest.webmanifest     built for the site: do not edit
  dev/             test harness, tests and conventions (see dev/README.md)
tools/build_scan_card.py     builds the site pages (and the artifact copy) from src/
```

`src/` runs as it is from any static server, given `manifold-wasm.js` beside it (the build writes one) and access to
jsdelivr for three.js, three-mesh-bvh and manifold-3d. That is also exactly what the Claude artifact copy contains.

## Building

```
npm i three@0.160.0 three-mesh-bvh@0.7.8 manifold-3d@3.5.5 esbuild@0.24.0        # once, in any folder: the "deps" folder
python3 tools/build_scan_card.py --deps <deps>                                   # the four site pages + manifest
python3 tools/build_scan_card.py --deps <deps> --artifact <out> --tray <Tray Card artifact files> --wax <Wax Card artifact files>
```

The site build bundles the libraries (the site's CSP allows no CDN), inlines the WebAssembly engine into the two pages
that use it, and adds the site head. After a build: bump `CACHE` in `/sw.js` if a page was added, run `tests/smoke.js`,
and rebuild the offline single file (`tools/build_offline_suite.py`), which carries Scan Card and its tools too.

## How the hub and the tools talk

Everything is same-origin frames and plain function calls; nothing is posted or uploaded.

* The hub sets `window.SCANHUB` before any frame exists. `core.js` looks for `parent.SCANHUB` when a page starts
  (`N.HUB`, `N.EMBED`). A tool page that finds it:
  hides its own Load / Orient steps (Model Card also its Trim step) and its top bar, turns off its own autosave, sends
  dropped files, "Save case" and every download to the hub, and registers a small API with the hub:
  `importCase(blob)`, `exportPart()`, `clear()`, `hasScans()`, `step()`, `goto(id)`.
* **Into a tool:** when its tab is opened and it does not hold the current scans, the hub packs a case file (stored, not
  compressed) with the scans and that tool's own section, and the tool opens it like any saved case.
* **Out of a tool:** when its tab is left, and before the case is saved, the hub asks for `exportPart()` (the tool's
  `data.<key>` section and the meshes it made, without the scans) and merges that into the master case
  (`scans.dcase` on the hub). Items nobody opened travel as their original bytes (`CaseItem` in core.js).
* **Which scans is this work for?** The hub keeps a signature of the scans (CRC of vertices and triangles, plus the
  matrices). A tool's work counts only while it carries the signature of the current scans (`H.basis`, `valid()`), so
  work made on an earlier version of the scans is never saved, autosaved or handed back beside a later one
  (`buildCase()`).
* **The lock.** While any tool depends on the scans as they are, the Load / Orient / Trim steps on the Scans tab are
  inert behind a note with a "Change the scans anyway" button. After a change, a tool starts again on the new scans the
  next time its tab is opened, and the hub says so.
* **Tray Card and Wax Card** are not built on core.js. Their pages are loaded as they are and driven through what they
  already expose (`TC.loadScan / loadAnt / setArch`, `__wax.loadScan`). They get the scans as files in the **scanner's
  own coordinates** (tidied, not turned), so what they export still lines up with the original scan in other software.
  Tray Card's Maxilla / Mandible switch chooses which scan the tray is made on (the other goes in as the opposing arch).
  They are never emptied or overwritten without being asked: where they already hold a scan, an earlier autosaved case
  or work in progress, the hub shows a one-line offer above them instead. Their animation frames are held back while
  their tab is hidden (Tray Card redraws continuously). They keep their own project files; "Save case" does not
  include their work.
* **Memory.** Every open tool holds a copy of the scans. From 500,000 triangles (both scans together) only the tool in
  front and the one used before it stay open; others are closed and come back from the master case, at the step they
  were on. Tray Card and Wax Card are never closed this way.
* **Where files are saved from.** A tool's downloads go through the hub page (`SCANHUB.saveFile`). Inside a Claude
  artifact only the top page has `claude.use('downloads')`; the hub hands the two existing apps a stand-in
  (`SCANHUB.claude`) so their own save code works there too.
* **Offline single file.** There are no addresses to load inside `Notile-Suite.html`; the hub asks the suite for each
  tool's page (`SUITE.page(path)`) and puts it in the frame with `srcdoc`.
* **Artifact copy.** `window.SCAN_CARD = { frames: 'both', urls: {...} }` makes the hub try a frame address first and,
  if the page does not report in, fetch it and hand it over with `srcdoc`.

Settings a host page can give before the scripts run: `window.SCAN_CARD = { home, urls, tools, frames }` for the hub,
`window.NOTILE = { fonts, family, home, homeTitle }` for every page on core.js.

## Rules that must keep holding

* No box where a patient name, CHI or hospital number could be typed. The only text boxes are the 4-character model
  labels (the site build refuses to write a page with any other).
* Nothing leaves the device. No requests except the page's own files (and, in the artifact copy, the pinned libraries).
* Design aids, not certified medical-device software: every export says to check the result against the scan and the
  patient.

## What has been checked, and what has not

Checked in headless Chrome (see `dev/README.md` for the tests): each tool on its own and inside the hub gives the same
results; scans reach every tool byte for byte; work survives tab switches, the case file, the autosaved copy and a
tool being closed for memory; the lock and the "start again" path; Tray Card and Wax Card hand-off; the site pages
under the site CSP; the offline single file; the artifact layout under an artifact-like policy; phone and iPad sizes.

Not checked: any real patient scan (all tests use synthetic arches), a real iPad or Apple Pencil, and the artifact copy
running inside Claude itself.
