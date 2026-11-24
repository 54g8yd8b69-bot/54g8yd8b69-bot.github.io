# Analysis Card — working notes (kept up to date for hand-over)

Deliverable: `/home/claude/suite/analysis-card/index.html` (single file, imports `./core.js` only)
Tests: this folder · Screenshots and exported files: `/home/claude/suite/dev/out/analysis-card/`
Backup of the last fully verified version: `dev/out/analysis-card/index.stage3.html` (identical to the deliverable at the time of
writing; if `analysis-card/index.html` is ever found broken, copy that file back over it).

## Status: complete — every item of the brief is built and has been run in the browser

| What | State | Test |
|---|---|---|
| Steps 1–2 from `createScanSet`, two demo buttons | working | all |
| Step 3 tooth widths (chart FDI / Palmer, guided clicks, auto-advance, undo, drag, missing / not measured, second molars, width definition) | verified | t1, t6, t11 |
| Step 4 Bolton (norms, mm excess, incomplete data named, contralateral substitution flagged, "what the missing teeth would total") | verified | t1, t6, t7 |
| Step 5 gaps list + space analysis (arch line: curve / segments, drag / add / delete points, planned-width balance) | verified | t1, t3, t6 |
| Step 6 intercanine / intermolar width, arch depth, overjet, overbite, midlines (views: upper, lower, front, section) | verified | t2, t5 |
| Step 7 restorative space (contact / crest / vertical, occlusal + side view, what-if, implant sum) | verified | t7, t3 |
| Step 8 measure: distance, angle, **section** (the stretch goal) + top-bar toggle | verified | t6, t9 |
| Step 9 report: copy text, PNG sheet, CSV; case save + reopen; resume after reload | verified | t2, t3, t8 |
| 1400×900 mouse and 820×1180 touch | verified | t4, galleries |
| scanner-frame STL files, part-arch and dirty scans, one scan only, not in bite | verified | t5, t8 |
| house rules (tooltips, no free text, no dialogs, no network, downloads through the core) | verified | t10 |

Run everything (about 4 minutes, one browser at a time):
`cd /home/claude/suite && for t in t1-widths t2-arch-report t3-case t4-touch t5-scanner t6-logic t7-resto t8-edge t9-section t10-audit t11-zoom; do node dev/tests/analysis-card/$t.cjs; done`
Galleries: `node dev/tests/analysis-card/shots.cjs` → `pc-*.png`; `node dev/tests/analysis-card/shots.cjs touch` → `ipad-*.png`.
Every run so far ends with `errors []` (console errors, page errors, blocked requests and CSP refusals are all recorded by the harness).

## Design decisions (made without asking, as instructed)

* **Orthographic camera** (`createViewer(view, { ortho: true })`): the occlusal view is a true parallel projection, so a click lands
  where a vertical ray would and what is seen is to scale. Needs a local work-round for the core's markers (see Core requests).
* **Width definition**: default = distance between the two contact points measured *in the occlusal plane* (height ignored);
  option = straight 3D. Reason: from the occlusal view the user cannot control the height of a click (in the hypodontia demo the
  click on 13 mesial lands 3.9 mm lower than 13 distal, which turns 7.60 into 8.52 in 3D). The price is that it depends on the
  orientation set in step 2 (see the scanner-frame numbers below). The chosen definition is used for every contact-point length.
* **Click order** runs round the arch from the patient's right (right side: distal then mesial; left side: mesial then distal),
  so the pointer never doubles back. The prompt always names the next point ("16 — distal contact").
* A plain click always places the point being asked for, even on top of an existing point (neighbours share a contact);
  dragging moves an existing point and says so in the status line (a slipped tap could otherwise move a neighbour unnoticed).
* "Keep the occlusal view (no rotation)" is on by default in steps 3 and 5 (a slipped tap would otherwise spin the model); wheel /
  pinch zoom and right-drag / two-finger pan still work.
* **Landmarks are stored in scanner (raw) coordinates** per jaw, so re-orienting later keeps them on the surface and every figure is
  recomputed. A fingerprint of each scan is stored; if a different scan is loaded into a slot its landmarks are dropped (kept if
  ≥ 90 % of them still lie within 0.25 mm of the new surface, e.g. after trimming in another app). A demo is a new case.
* **Gaps**: neighbouring teeth → separation of the facing contact points *along the arch* (so a displaced tooth is not a "space");
  missing-tooth span → straight distance between the contact points either side. Gaps under a user-set tolerance (default 0.5 mm —
  a click-noise filter, not a clinical figure) count as contacts.
* **Arch line** for space analysis: least-squares smooth curve (5th-order, parametric) through all contact points 6M→6M, given as
  7 draggable points joined by a centripetal Catmull-Rom curve (or straight segments). Not a published method; described in the tip.
* **Cusp tips and incisal points are found automatically** (the point of the crown nearest the opposing arch in a box set out from
  the tooth's two contact points) and are marked as automatic (dashed buttons, * in tables and report) until the user moves them.
* Bolton result is not graded; SD distance and mm are shown, thresholds only quoted in the Sources tip. No proportion or implant
  clearance is pre-set in the restorative what-if; published figures are quoted in the tip with what they describe.
* The Measure step keeps the current view and visibility (so you measure what you were looking at); the top-bar "Measure" button
  toggles between it and the step you came from.
* No free-text or patient fields anywhere; the report carries a date only.

## Verified in the browser (numbers)

* `t1-widths.cjs`, standard demo, 1400×900, 48 simulated clicks at `mesialPick`/`distalPick`, width = in occlusal plane:
  worst |measured − designed width| = **0.138 mm** (the incisors: the demo's own truth contact points are 1.6 % narrower than the
  designed width, 8.6 → 8.462); worst |measured − distance between truth contact points| = **0.008 mm**.
* Bolton, same run: app anterior **79.565 %**, overall **92.223 %**. Hand calculation from the truth contact points 79.537 % / 92.207 %;
  from the designed widths 79.476 % / 92.111 %. Excess: lower 1.07 mm (anterior), lower 0.86 mm (overall).
* `t6-logic.cjs`: Bolton function on the designed widths = hand calculation exactly (79.4760 / 92.1109; anterior excess lower 1.042,
  or upper shortfall 1.350; overall excess lower 0.761); ratio below the mean gives upper excess (48 − 36/0.772 = 1.368).
  Missing 12 + not measured 35 → both ratios withheld with the teeth named; substitution → 79.565 (hand 79.565), flagged.
  Undo, Ctrl+Z, Palmer, second molars, chart jump, redo tooth, mouse drag all behave. Measure: distance 50.683 (hand 50.683),
  angle 66.35° (hand 66.35°). Space analysis on perfectly aligned synthetic arches with shared contacts: circle R 24 → curve reads
  +0.07 mm, six segments −0.43 mm; demo-shaped arch with real tooth sizes → curve −0.09 mm, six segments −0.69 mm.
* `t2-arch-report.cjs` (standard demo): intercanine upper 30.616 (truth tips 30.662), lower 24.988 (24.989); intermolar upper
  51.271 (51.278), lower 46.492 (46.465); arch depth upper 28.727 (28.727), lower 24.789 (24.789). Automatic cusp tips land
  0.03–0.23 mm from the truth tips. Overjet 2.143 (independent brute force over mesh vertices 2.167); overbite 1.608 (truth tip
  heights 1.608); midlines 0.0. Section view: dragging the lower incisal point keeps it on the scan and within 0.02 mm of the cut.
  Clipboard text equals the on-screen text; PNG 1.4 MB, 1600 px wide; CSV 151 rows.
* `t3-case.cjs` (hypodontia demo, 12 and 22 marked missing through the UI, 44 clicks, crest width, planned width, implant sum,
  distance + angle + section, edited arch line): spans 13–11 and 21–23 = **7.2696 mm** (hand calculation from the truth contact
  points 7.270); 11–21 = 1.946 (1.946). Case saved (3.2 MB) and reopened in a fresh page: state JSON identical, every derived
  value and the report text identical, another app's `data.model` section still there.
* `t7-resto.cjs` (hypodontia demo): contact level 7.270 (hand 7.270) both sides; crest level 6.013 (clicked points 6.013 apart);
  vertical with the ridge point over 43: 0.376 mm (independent 0.372); the automatic ridge point under the span reads 16.29 mm and
  is flagged as probably gum (opposing surface 7.9 mm beyond the occlusal plane); what-if 77 % of 8.46 = 6.5 → 0.77 mm spare;
  8.0 planned → "Short by 0.7 mm"; implant sum 3.3 + 2×1.5 = 6.3 against crest 6.01 → −0.29. Bolton what-if: 36.04/0.772 − 32.12
  = 14.56 mm left for 12 + 22 (app 14.56).
* `t5-scanner.cjs` (dev/data/scanner-*.stl through the file input): core auto-orient leaves a residual rotation of **3.86°** and a
  shift of (−0.04, 3.28, −1.45) mm; inBite true, shared matrix. Clicking the truth *pick* points: 21 of 24 teeth within 0.14 mm, but
  12 +0.21, 22 +0.31, 32 −0.46 (their pick points lie on the gum ~7 mm below the contact, so a 3.86° tilt moves them 0.2–0.5 mm
  in the view); Bolton then 77.50 / 90.85. Clicking the truth *contact* points (what a user aims at): worst **0.141 mm**, Bolton
  **79.528 / 92.195** (aligned demo 79.565 / 92.223). Arch in that frame: intercanine 30.73 / 24.99, intermolar 51.28 / 46.49,
  depth 29.03 / 24.44, overjet 1.76, overbite 1.45 (aligned demo 30.62 / 24.99, 51.27 / 46.49, 28.73 / 24.79, 2.14, 1.61) — the
  plane-relative figures move with the 3.86° tilt. Re-tilting 6° in step 2 afterwards: landmarks stay on the surface (0.0001 mm)
  and the widths are recomputed.
* `t4-touch.cjs` (820×1180, touch): 48 taps, worst |width − truth contact distance| 0.008 mm, Bolton 79.56 / 92.22; finger-drag of a
  point changes the width, Undo restores it.
* `t8-edge.cjs`: after a reload "Resume last case (Analysis Card)" is offered and brings back the 7 landmarks placed before it,
  carrying on at "13 — mesial contact"; removing the lower scan drops its landmarks and every step still opens (Bolton and
  occlusion say why they are empty); a different STL in the upper slot clears the old landmarks with a message; `inBite = false`
  disables Front / Section and explains; quadrant-lower.stl and dirty-lower.stl load, all steps open, clicks land.
* `t9-section.cjs`: cut through both lower first-molar mesiobuccal cusps: cut length 46.465 (points 46.465 apart); outline tops at
  z −0.03 (truth cusp height 0.00); two clicks on the outline, each a few pixels off, snap and read 46.50 mm (truth 46.465);
  survives a state round trip; dragging an end of the cut clears the measurement made on it.
* `t11-zoom.cjs`: wheel zoom 1.68 → 2.39, markers stay 8 px, left-drag does not rotate the locked view, right-drag pans, a tooth
  clicked while zoomed and panned measures 6.700.
* `t10-audit.cjs`: no alert / confirm / prompt / window.open / print / fetch / XHR / localStorage / free-text input in the source;
  the only URLs are the three import-map entries; every button in this app's steps has a tooltip; CSV rows well-formed.

## Not verified / limits (say so in the report)

* Nothing was tried on a real patient scan — only the synthetic demo arches and the STL files in `dev/data`.
* Not run on a real iPad / Safari / Apple Pencil, nor inside a published Claude artifact (downloads capability, clipboard there).
  Pinch-zoom and two-finger pan rely on OrbitControls and were not simulated.
* Automatic cusp-tip / incisal-point finding was only checked on the idealised demo teeth (worn cusps, restorations, rotated or
  tipped teeth will fool it — hence the dashed "automatic" marking and the drag handles).
* Bolton 1958 and 1962 were not read in the original; the figures were confirmed through secondary sources that agree.
* Performance on very large scans (> 500k triangles) not measured; cusp finding and the section tool loop over every vertex /
  triangle (fine at 350k).
* Colour (PLY) scans not tried in this app.
* No primary teeth or third molars in the chart; a retained primary tooth has to be measured in its successor's place (Bolton is
  then not valid for it) or marked "not measured".

## Things found about the demo data (for the lead)

* `truth.gaps[].width` (5.5 mm for the missing laterals) is the arc slot left in the generator, **not** the distance between the
  neighbouring contact points. From the truth file itself: 11 distal → 13 mesial = **7.27 mm** in the occlusal plane (8.65 mm
  straight 3D between the pick points). Causes: 0.4 mm of spacing is added on top, and the incisor contact points sit ~1.7 mm
  labial of the arch line on a tooth that is a straight block on a curved arch. So check (c) "5.5 ± 0.3" cannot be met by any
  contact-point measurement on this mesh; the app is checked against the 7.27 mm hand calculation instead.
* In the standard demo the truth contact points of neighbouring front teeth do not coincide (13–12: 1.57 mm apart, 12–11: 1.24,
  11–21: 1.47), so the demo honestly lists small anterior "spaces" (0.6 / 1.1 / 1.5 mm along the arch).
* The truth `tip` of a molar is the mesiobuccal cusp on one side and the distobuccal on the other (cusps[0] is +u).
* The pick points of the lateral incisors (and 13 mesial in the hypodontia demo) lie on the gum several mm below the contact.

## Sources checked (web)

* Bolton norms — overall 91.3 % (SD 1.91, range 87.5–94.8), anterior 77.2 % (SD 1.65, range 74.5–80.4), n = 55 excellent occlusions:
  Bolton 1958 Angle Orthod 28:113–130 (title / volume / pages confirmed on the journal's own page; the PDF could not be fetched).
  Figures confirmed through: PMC7583543 (means, SDs, SEs 0.26 / 0.22, n = 55); Sakoda et al., Braz J Oral Sci 2016;15:269–272
  (n = 55 excellent occlusions, means, SDs); Lombardo et al. AJODO manuscript (ranges, citing Othman & Harradine 2006); the
  ClearCorrect Bolton worksheet (means and ranges, Bolton's chart wording).
* mm discrepancy (excess = lower − upper × mean/100, or upper − lower × 100/mean): ClearCorrect worksheet quoting Bolton's chart
  method; a teaching slide deck with the same formulas. Bolton 1962 Am J Orthod 48:504–529 not read directly.
* Thresholds quoted in the tip, not applied: Othman & Harradine, Angle Orthod 2007;77:668–674 (journal page read): 2 SD used by many
  authors (Crosby & Alexander 1989 etc.), Proffit < 1.5 mm rarely significant (not quoted in the app), their own recommendation
  2 mm; Bolton's own "look closer beyond 1 SD" via Sakoda et al. Sources differ on the threshold — the tip says so.
* Proportions (restorative what-if; none is a default): Cinelli et al., Dent J 2024;12(1):3 (read, incl. reference list): Levin 1978
  J Prosthet Dent 40:244–252 (golden proportion, apparent / frontal widths); Preston 1993 J Esthet Dent 5:247–251 (66 %);
  Ward 2001 Dent Clin North Am 45:143–154 (RED, 70 % preferred; the review's text says 2000, its reference list 2001);
  mean true widths Magne et al. 2003 J Prosthet Dent 89:453–461 (9.10 / 7.07 unworn) and Orozco-Varo et al. 2015 J Prosthet Dent
  113:565–570 (8.6–8.9 / 6.7–6.9) → lateral ≈ 77–78 % of central (my arithmetic, stated as such).
* Implant spacing (quoted in a tip only): Buser, Martin & Belser, IJOMI 2004;19 Suppl:43–61 (ITI PDF read): danger zone about
  1.0–1.5 mm next to adjacent roots; ≥ 3 mm between adjacent implants ("no studies yet to support it"); minimal gap 7 mm
  standard-neck, 5.5 mm narrow-neck (the last two are not quoted in the app).
* Definitions (no norms shown): intercanine = cusp tips, intermolar = mesiobuccal cusp tips (as used in BMC Oral Health 2022,
  s12903-022-02656-7, table 2). Overjet / overbite / arch depth are defined in the app's own words; published definitions of
  overjet differ on whether it is taken from the incisal edge or the labial face of the upper incisor.

## Core requests / bugs found

1. `viewer.marker()` sprites use `sizeAttenuation:false`, which three.js only honours for perspective cameras; with
   `createViewer(el, { ortho: true })` markers are ~0.02 mm and invisible (also the orient step's own 3-click markers). Worked
   round locally by wrapping `viewer.marker` and rescaling from the zoom in `onRender`.
2. `viewer.fit()` / `setView()` in ortho ignore the aspect ratio and frame a sphere, wasting space; local `frame(box, dir, inset)`.
3. README says every button needs a `title`; these core buttons have none: "Replace…", "Open case…" (step 1), "Auto-orient",
   "Set biting plane with 3 clicks", and the demo buttons (`demos: [{ label, opts }]` has no `title` field).
4. `onChange('loaded')` cannot tell a new scan from `replaceRaw` or `swap`, and `loadDemo` does not announce a new case; the app
   fingerprints `raw.positions` and wraps `scans.loadDemo`. An epoch / reason on the event would be cleaner.
5. The core only stashes the case on scan events; an app has to call `N.stashCase(scans.toCase(), name)` itself after its own
   changes or "Resume last case" loses them (done here, 2.5 s after the last change and on tab hide). A `scans.touch()` would help.
6. Click detection in the viewer (`down.moved` at 5 px) is tight for finger / Pencil taps; a pointer-type-dependent threshold
   would lose fewer taps. Also `onClick` fires after a captured press that did not move (in addition to `onUp`) — worth documenting.
7. `#viewBtns` buttons are nearly invisible over a light scan when zoomed in (white 10 % background).
8. Demo truth: see "Things found about the demo data".
9. Auto-orient leaves 3.86° on `scanner-*.stl`; plane-relative measurements move with it (see t5 numbers).
10. FYI: this app sets `viewer.renderer.localClippingEnabled = true` and puts a clipping plane on the scan materials while the
    Section view of step 6 is open (removed on leaving), and temporarily resizes the renderer to draw the report pictures.
