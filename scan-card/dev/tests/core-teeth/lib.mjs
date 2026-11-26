// Shared by the findTeeth tests: scoring a detection against the demo arches' truth, and a picture for debugging.
import fs from 'fs'; import { execSync } from 'child_process';
/** How far a demo tooth's own width is from being measurable. The demo's neighbouring crowns are fused, and where the arch curves (the
 *  front teeth) each crown's own ends (truth mesialPick / distalPick, set out along the tooth's own straight axis, at the labial contact
 *  level of a proclined incisor) lie up to 1.6 mm apart although the crowns touch — they run into each other on the inside of the curve.
 *  One contact lies somewhere between two such ends, so a width measured to it can differ from the designed width by up to half that
 *  separation at each end. → Map fdi → amb (mm; 0 for crowns whose ends meet, e.g. the premolars and molars). Ends over 1.7 mm apart
 *  are spaced teeth (no shared contact) and add nothing. */
export function widthAmbiguity(truth) {
  const ORDER = truth.jaw === 'upper' ? [17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27] : [47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37];
  const by = new Map(truth.teeth.map((t) => [t.fdi, t])), out = new Map(truth.teeth.map((t) => [t.fdi, 0])), right = (f) => [1, 4].includes((f / 10) | 0);
  const facing = (t, side) => (side === 'next' ? (right(t.fdi) ? t.mesialPick : t.distalPick) : (right(t.fdi) ? t.distalPick : t.mesialPick));
  for (let q = 0; q + 1 < ORDER.length; q++) { const a = by.get(ORDER[q]), b = by.get(ORDER[q + 1]); if (!a || !b) continue; const pa = facing(a, 'next'), pb = facing(b, 'prev'), sep = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
    if (sep > 1.7) continue; out.set(a.fdi, out.get(a.fdi) + sep / 2); out.set(b.fdi, out.get(b.fdi) + sep / 2); }
  return out;
}
/** Each true tooth against the detected tooth with the same number. width = how far the width found is from the designed width beyond
 *  the demo's own ambiguity there (widthAmbiguity); dw = found − designed.
 *  → { n, found, wrong:[fdi…] (numbers given that are not in the truth), missed:[…], tipMax, tipMean, widthMax, widthMean, contactMax, centreMax, rows } */
export function score(res, truth, o = {}) {
  const amb = widthAmbiguity(truth);
  const by = new Map(res.teeth.map((t) => [t.fdi, t])), d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]), d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const rows = [], missed = [], want = new Set(truth.teeth.map((t) => t.fdi)), wrong = res.teeth.filter((t) => !want.has(t.fdi)).map((t) => t.fdi);
  for (const t of truth.teeth) { const r = by.get(t.fdi); if (!r || d2(r.centre, t.centre) > 4) { missed.push(t.fdi); continue; }
    const ab = amb.get(t.fdi); rows.push({ fdi: t.fdi, tip: d3(r.tip, t.tip), tip2: d2(r.tip, t.tip), width: Math.max(0, Math.abs(r.width - t.width) - ab), dw: r.width - t.width, amb: ab, mes: d2(r.mesial, t.mesialPick), dis: d2(r.distal, t.distalPick), centre: d2(r.centre, t.centre), conf: r.confidence }); }
  const mx = (k) => rows.reduce((m, r) => (k === 'width' && (o.skipWidth || []).includes(r.fdi) ? m : Math.max(m, r[k])), 0), mean = (k) => rows.reduce((s, r) => s + r[k], 0) / (rows.length || 1);
  return { n: truth.teeth.length, found: rows.length, wrong, missed, tipMax: mx('tip'), tipMean: mean('tip'), widthMax: mx('width'), widthMean: mean('width'), contactMax: Math.max(mx('mes'), mx('dis')), centreMax: mx('centre'), rows };
}
export const line = (name, s) => `${name}: ${s.found}/${s.n} numbered right${s.wrong.length ? ', wrong ' + s.wrong.join(' ') : ''}${s.missed.length ? ', missed ' + s.missed.join(' ') : ''}; tip max ${s.tipMax.toFixed(2)} (mean ${s.tipMean.toFixed(2)}); width max ${s.widthMax.toFixed(2)} (mean ${s.widthMean.toFixed(2)}); contacts max ${s.contactMax.toFixed(2)}; centre max ${s.centreMax.toFixed(2)} mm`;
/** A picture of the straightened row (height as grey), the crown-material curve under it, the boundaries and the numbers. For looking at, not for tests. */
export function picture(res, file) {
  const D = res.debug, { S, NT, ns, A, nodes } = D, sc = 3, W = ns * sc, Hs = NT * sc, Hp = 160, Ht = Hs + Hp, rgb = new Uint8Array(W * Ht * 3).fill(20);
  let top = -Infinity; for (const v of S) if (v > top) top = v; const px = (x, y, r, g, b) => { if (x < 0 || y < 0 || x >= W || y >= Ht) return; const k = 3 * (y * W + x); rgb[k] = r; rgb[k + 1] = g; rgb[k + 2] = b; };
  for (let i = 0; i < ns; i++) for (let k = 0; k < NT; k++) { const v = S[i * NT + k], g = v < -900 ? 0 : Math.max(0, 255 - (top - v) * 22); for (let a = 0; a < sc; a++) for (let b = 0; b < sc; b++) px(i * sc + a, (NT - 1 - k) * sc + b, v < -900 ? 50 : g, v < -900 ? 0 : g, v < -900 ? 70 : g); }
  let am = 1; for (const v of A) if (v > am) am = v;
  for (let i = 0; i < ns; i++) { const h = Math.round(A[i] / am * (Hp - 10)); for (let y = 0; y < h; y++) for (let a = 0; a < sc; a++) px(i * sc + a, Ht - 1 - y, 90, 160, 220); }
  for (const nd of nodes) { const c = nd.edge ? [255, 80, 80] : [255, 220, 0]; for (let y = 0; y < Ht; y++) if (nd.edge || y % 4 < Math.ceil(4 * nd.q)) px(nd.i * sc + 1, y, ...c); }
  for (const t of res.teeth) { const x0 = Math.round(t.s0 / 0.25) * sc, x1 = Math.round(t.s1 / 0.25) * sc; for (let x = x0 + 3; x < x1 - 3; x++) for (let y = Hs + 2; y < Hs + 6; y++) px(x, y, 60, 230, 120); }
  if (D.sMid != null) for (let y = 0; y < Ht; y += 2) px(Math.round(D.sMid / 0.25) * sc, y, 255, 0, 255);
  const tmp = file.replace(/\.png$/, '.ppm'); fs.writeFileSync(tmp, Buffer.concat([Buffer.from(`P6\n${W} ${Ht}\n255\n`), Buffer.from(rgb)]));
  const labels = res.teeth.map((t) => `-annotate +${Math.round((t.s0 + t.s1) / 2 / 0.25) * sc - 8}+${Hs + 22} '${t.fdi}'`).join(' ');
  execSync(`convert ${tmp} -fill white -pointsize 14 ${labels} ${file} && rm ${tmp}`);
}
/** A picture of the arch seen from the biting side (height as grey) with what findTeeth found: the line along the row (blue), the
 *  boundaries (red = a crown's end, yellow = between two crowns), each tooth's number at its centre, its tip (green), its mesial and
 *  distal points (magenta) and the gaps (orange). mesh in the case frame. For looking at, not for tests. */
export function topView(N, mesh, res, file, o = {}) {
  const up = res.jaw === 'upper', hf = N.rasterHeightfield(mesh, { cell: o.cell || 0.2, mode: up ? 'min' : 'max', pad: 3 }), { nx, ny, x0, y0, cell } = hf;
  let top = up ? Infinity : -Infinity; for (const v of hf.z) if (Number.isFinite(v)) top = up ? Math.min(top, v) : Math.max(top, v);
  const rgb = new Uint8Array(nx * ny * 3);
  const zz = (i, j) => { const v = hf.z[clampI(j, ny) * nx + clampI(i, nx)]; return Number.isFinite(v) ? (up ? -v : v) : NaN; }, clampI = (a, n) => Math.min(n - 1, Math.max(0, a));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = hf.z[j * nx + i], k = 3 * (j * nx + i); if (!Number.isFinite(v)) { rgb[k] = 30; rgb[k + 1] = 10; rgb[k + 2] = 45; continue; }
    const gx = (zz(i + 1, j) - zz(i - 1, j)) / (2 * cell), gy = (zz(i, j + 1) - zz(i, j - 1)) / (2 * cell), nl = Math.hypot(gx || 0, gy || 0, 1), shade = Number.isFinite(gx + gy) ? Math.max(0, (-gx * -0.4 + -gy * -0.5 + 0.77) / nl) : 0.6;   // light from the upper left
    const g = Math.max(0, 255 - Math.abs(v - top) * 14) * (0.35 + 0.65 * shade); rgb[k] = rgb[k + 1] = rgb[k + 2] = Math.min(255, g); }
  const P = (p) => [(p[0] - x0) / cell, (p[1] - y0) / cell];
  const px = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= nx || y >= ny) return; const k = 3 * (y * nx + x); rgb[k] = c[0]; rgb[k + 1] = c[1]; rgb[k + 2] = c[2]; };
  const dot = (p, r, c) => { const [x, y] = P(p); for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) if (a * a + b * b <= r * r) px(x + a, y + b, c); };
  const seg = (a, b, c) => { const [x1, y1] = P(a), [x2, y2] = P(b), n = Math.ceil(Math.hypot(x2 - x1, y2 - y1)) + 1; for (let t = 0; t <= n; t++) px(x1 + (x2 - x1) * t / n, y1 + (y2 - y1) * t / n, c); };
  for (let q = 1; q < res.curve.length; q++) seg(res.curve[q - 1], res.curve[q], [60, 140, 255]);
  for (const g of res.gaps) seg(g.a, g.b, [255, 150, 0]);
  for (const t of res.teeth) { seg(t.mesial, t.distal, [230, 60, 230]); dot(t.mesial, 2, [230, 60, 230]); dot(t.distal, 2, [230, 60, 230]); dot(t.tip, 3, [40, 220, 90]); }
  for (const e of res.extras || []) dot(e.centre, 4, [255, 80, 80]);
  if (o.truth) for (const t of o.truth.teeth) { dot(t.tip, 1, [255, 0, 0]); }
  const tmp = file.replace(/\.png$/, '.ppm'); fs.writeFileSync(tmp, Buffer.concat([Buffer.from(`P6\n${nx} ${ny}\n255\n`), Buffer.from(rgb)]));
  const labels = res.teeth.map((t) => { const [x, y] = P(t.centre); return `-annotate +${Math.round(x) - 7}+${Math.round(y) + 5} '${t.fdi}'`; }).join(' ');
  execSync(`convert ${tmp} -fill '#ffd400' -stroke black -strokewidth 0.4 -pointsize ${o.pt || 15} ${labels} ${file} && rm ${tmp}`);
}
