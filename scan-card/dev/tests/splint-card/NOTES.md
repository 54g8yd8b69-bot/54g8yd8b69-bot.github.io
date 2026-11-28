# Splint Card — working notes (state at hand-back, 24 Nov 2026)

App: `/home/claude/suite/splint-card/index.html` (1,203 lines, one file). The geometry kernel sits between the
`KERNEL:BEGIN` / `KERNEL:END` markers; `kernel.mjs` here lifts that block out, so the Node tests run the code that ships.

## Status
Complete and verified: all eight steps, three starting points (even-thickness guard, flat-plane splint, thin tray),
opposing arch (hinge / straight opening, table meeting the cusps, imprints, contact map), margin control points,
cross-section, both STL positions, case round trip, mouse / touch / phone layout.

Not done / half-done (nothing of this is wired to a dead control):
- Full palatal plate. The "tongue / palate side" slider (to 14 mm) only deepens the palatal flange. Where the margin
  runs past the edge of the scan the appliance wraps the scan's edge and comes out thin; the app now detects this
  (`report.edge`, mm of scan edge covered) and warns in Check. A ramp / taper of the border at its limits was tried
  and reverted (it gave handles, genus 3).
- "Resume last case" autosave (`scans.touch()`, new in core) is not called after Splint Card's own changes.
- Speed: first build 5.4–7.0 s in Node and 8–11 s in the browser on 155–200k-triangle scans; later shell / bite
  changes about 2 s. Never timed on a 350k-triangle scan with the final pipeline.
- Nothing was tried on a real patient scan (demo arches are synthetic; `scanner-*.stl` are the same arches moved).

## Marked teeth (added 28 Nov 2026)
Margin step: "Mark teeth" / "Find the teeth" / "Clear". `P.teeth` = null (not decided: found by `N.findTeeth` the first time the Margin
step opens), [] (whole-arch margin, as before; what an older case gets) or [{ p, c, a, b | r, fdi }] in the scan's own coordinates,
for `P.teethJaw`. Kernel: `K.toothArch` (tips, a line through the teeth in the form of `K.analyseArch`, which then replaces `D.arch`;
`D.arch0` keeps the whole-arch one), `K.toothMargin` (flood per tooth on the mesh above the depth below the tips, inside its own box
or 7 mm; undercut gate; grid kinds tooth / bridge / near / far; gum raise `gz`), `K.tmBorder` / `K.tmKind`, `mp.tm` in `K.borderAt`
(the cavity's cover and limit take the deeper of whole-arch and teeth, `tmWiden`), `p.tm` in `K.build` (cavity cache key includes
`tm.key`; a bridged cell counts as crown for the flat table). Tests: `t20-teeth.mjs` (Node), `f7-teeth.cjs` (browser).
Known: with teeth marked the old f1/f2 numbers move a little (the line along the teeth is not the whole-arch line, so dragged dots land
at other stations); a margin pushed far below the gum (f2's tongue side 12 mm, f1's local −6 mm) leaves a thin edge at the gum line
that Check reports as a thin wall (0.14 / 1.63 mm; the whole-arch margin gave 0.35 / 1.88 there). Bridges over a gap step down to the
ridge in a guard; a flat table fills them.

## Frames
Case frame LPS (+X patient's left, +Y back, +Z up) → ARCH frame A (teeth +Z; upper turned 180° about Y) → WORK
frame W = tilt · A (path of insertion = +Z). Margin and table are defined in the arch frame, so tilting the path does
not move them. Output goes back to the case frame, and through the scan's matrix to scanner coordinates on request.

## Pipeline (K.build), and why
1. **Model** (cache key: scan + tilt): scan → work frame, `S.scanToSolid`, envelope raster `hf` at 0.075 mm.
2. **Cavity** (key: + clearance, retention, coverage): what must be empty.
   - `K.growScan`: the scan's own triangles moved out by the clearance (limited in grooves so the surface never
     overlaps itself — overlapping subtrahends make Manifold return rubbish). This is the fit surface nearly everywhere,
     so the fit is the scan's, not a resampled grid's.
   - `K.cavity`: marching cubes on a 0.2 mm grid with exact signed distances (`K.distanceBand`). It supplies the offset
     where the grown scan was limited (nodes flagged "sharp", set 0.04 mm + a curvature allowance further out), and all
     of the block-out. Elsewhere on the visible side it is held 0.3 mm inside the scan, out of the way (`own`).
   - Block-out = sideways depth into the scan's shadow (`lateral`) beyond retention − 0.03. Neck rule (shadow widened by
     r + 0.4) stops strands under contact points. Fin relief (closing by 0.25 of the clearance-grown envelope) gives up
     slits narrower than 0.7 mm. NEW: the shadow used for block-out (`hfT`) includes those slits and a rim of
     clearance + 2 cells round them; without it a 0.15 mm sheet stood between slit and block-out (perforated septum,
     genus 1–2 on the upper). Thin-sheet removal in shadow stays as a net.
   - Rejected: neck rule / fin relief at half resolution (quicker, fit error p95 0.08); bilinear instead of nearest-node
     lookup for the fin relief (genus 2).
   - One Manifold union (MC cavity ∪ grown scan), cached.
3. **Body** (`K.body`, marching cubes 0.25 mm on an implicit field): ρ-neighbourhood of the covered envelope columns
   (ρ = thickness + clearance + 0.08); flat type adds the table (crown-zone column up to the plane, edges rounded), and
   keeps the minimum thickness over the biting 3 mm of the crowns even above the table (never wider than the table;
   `report.lift` says by how much). NEW: that minimum no longer thickens the walls, so "Wall thickness" works for the
   flat type. Level table = `arch.zMax` (true highest point, new) + clearance + "table above the highest cusp".
   Opposing cap: 0.05 mm under the opposing arch's lowest point within one body cell sideways (NEW: was 4 raster nodes;
   steep faces of opposing teeth were entered by up to 0.10 mm when the bite had not been opened).
   Margin cut with a rounded edge. `info.edge` counts covered columns on the edge of the scan (NEW).
4. **Cut**: body − cavity, largest piece kept, crumbs counted; `triKind` 0 outer / 1 fit / 2 block-out.

Checks: `K.thickness` (BVH, border = near the margin line), `K.contacts` (signed, patches within 0.1 mm),
`K.tableRoom` (for "Open just enough"), `K.undercutDepth` (map), `K.restPlane` (table touching ≥ 3 cusps).
UI `gradeThickness`: biting surface = beyond the cusp tips and facing the other jaw (normal > 0.6) → minimum
thickness; everything else → min(wall, minimum).

## Verified numbers (final file) — `node accuracy.mjs <demo|scanner> <lower|upper>`; full log in
`dev/out/splint-card/accuracy-final.txt`. Clearance 0.1, retention 0.1; guard wall 2.0; flat wall 1.5 / min 2.0.
All 12 STL files re-read from disk: watertight, 0 open / flipped / non-manifold edges, 1 piece, genus 0.

| arch | design | seat min | gap mean / p95 | err p95 | within ±0.05 | engaged max | thinnest |
|---|---|---|---|---|---|---|---|
| demo lower | guard | 0.090 | 0.108 / 0.144 | 0.044 | 96.0 % | 0.046 | 1.958 |
| demo lower | flat | 0.090 | 0.110 / 0.147 | 0.047 | 95.4 % | 0.046 | wall 1.467, biting 1.996 |
| demo upper | guard | 0.097 | 0.109 / 0.147 | 0.047 | 95.5 % | 0.046 | 1.931 |
| demo upper | flat | 0.097 | 0.110 / 0.150 | 0.050 | 95.0 % | 0.046 | wall 1.425, biting 2.014 |
| scanner lower | guard | 0.093 | 0.107 / 0.142 | 0.042 | 96.3 % | 0.025 | 1.947 |
| scanner lower | flat | 0.093 | 0.109 / 0.147 | 0.047 | 95.4 % | 0.025 | wall 1.444, biting 1.983 |
| scanner upper | guard | 0.100 | 0.109 / 0.147 | 0.047 | 95.5 % | 0.046 | 1.950 |
| scanner upper | flat | 0.100 | 0.110 / 0.149 | 0.049 | 95.2 % | 0.046 | wall 1.438, biting 2.068 |

Flat meeting the opposing cusps (hinge): demo lower 5 mm → 4 patches (2 L, 2 R), nearest 0.056, through 0;
demo upper 6 mm → 7 patches (3 L, 4 R), nearest 0.050, through 0; scanner lower 5 mm → 4; scanner upper 6 mm → 7.
Variants on demo lower (`node t6.mjs all`): r 0 → no vertex in an undercut; c 0.2 / r 0.25 → seat 0.190, err p95 0.052
(just over the bar), engaged 0.075; c 0.05 / t 1 → seat 0.050, err p95 0.035, engaged 0.116, thinnest 0.926.
Thin tray 0.8 mm: thinnest 0.706 (finer body grid did not help), err p95 0.054.
Edited margin (one point 6 mm down, tilt 4°, r 0.2): thinnest wall 1.88–1.89 for 2.0 set (opposite a crease where the
cavity carries its safety allowance).

Browser (harness CSP, `errors` empty in every run):
- `f1.cjs` 1400×900: scanner STLs → lower guard, tilt, "use view direction", dot dragged, build 8.3–9.8 s, STL in both
  positions, case saved and reopened: no parameter differs, margin edits kept, same 332,745 vertex values, no rebuild.
- `f2.cjs` 1400×900: demo → upper flat: unopened → warnings, 0 through; "Open just enough" → 6 mm hinge, biting 2.18,
  walls 1.42, 7 contacts (3·2·2), nearest 0.05, through 0; straight 5.25 mm → 6 contacts; imprint 0.3 → 19 contacts;
  case round trip equal; palate side 12 mm → scan-edge warning shown.
- `f3.cjs` 820×1180 touch: thin tray, dot dragged by touch (CDP touch events), build, section, STL by tap;
  390×780: no sideways overflow, viewer 390×358, Next on screen, whole flow works.
- `f4.cjs`: every remaining control (paReset, mgReset, shC, shT, shMin, shE, shUse, shOpen, shShow, shOcc, shMeet,
  ckFlip, ckFace) changes what it says; no text inputs on the page.
- `f5.cjs`: every button has a tooltip; no requests to other hosts after load.
- `checkstl.mjs`: the five downloaded STL files re-read: watertight, 1 piece; the scanner-coordinate export lies on the
  untouched `scanner-lower.stl` with nearest vertex 0.096 mm, median 0.100.

## Sources checked (web, November 2026) — shown in the "Sources" tip of step 6
- Formlabs application guide for splints, 3Shape / exocad settings: offset 0.05–0.10 mm for Dental LT Clear V2,
  0.01 to −0.03 mm for Dental LT Comfort → default clearance 0.1 mm.
- Formlabs manufacturing guide, Dental LT Comfort (PRNT-0106 rev 03, 29 Feb 2024): occlusal ≥ 2 mm, walls ≥ 1 mm
  → flat preset minimum 2 mm, guard preset minimum 1 mm.
- Xu & Bu 2026 (Research Square preprint, doi 10.21203/rs.3.rs-9872297/v1): Bonwill 101.6 mm, Balkwill 22–30°
  (mean about 26°) as classical values; their own 101.0 mm and 22.7°. J Adv Pharm Technol Res 2022;13(S1):S194–7:
  sides 97.4–98.6 mm on dry mandibles → `K.HINGE = { side: 101.6, balkwill: 26 }`.
- NOT verified: minimum thickness for Dental LT Clear V2 (Formlabs PDFs refused the fetch); the original Bonwill and
  Balkwill papers (only secondary quotations read). Everything else in the presets is a plain starting value.

## Core requests
- `createShell` Back / Next and the orientation step's Both / Upper / Lower buttons have no `title`; the app sets them.
- `injectCSS` adds a Google Fonts `<link>` (allowed by the harness CSP, but it is a request to another host).
- `N.MeshBVH` reorders the index array it is given unless `{ indirect: true }`: pass a copy.
- `viewer.marker` px draws about three times its nominal size (the app uses px 4 and 7).
- `viewer.fit()` with no argument frames hidden scans too; the app fits the working arch once itself.

## Files
Node: `accuracy.mjs` (final bar), `verify.mjs`, `t6.mjs` (variants), `t7.mjs` / `t14.mjs` (topology), `t11.mjs`
(opposing), `t12/t13/t15/t16/t17.mjs` (handle hunting: slabs, piece, thin spots, septa, text slices), `t18.mjs`
(thinnest wall), `prof.mjs` (cavity profile), `checkstl.mjs`. Browser: `f1`–`f5.cjs` final; `b1`–`b7.cjs` earlier.
