// N.findTeeth — automatic tooth detection and FDI numbering — against the demo arches' truth. Synthetic data only.
//   node dev/tests/core-teeth/t1-find.test.mjs          (about two minutes: ~25 arches, three models with a base built with Manifold)
// Checks, for each arch: every tooth there gets its own number and no number is given to a tooth that is not there; the tip within
// 1 mm of the truth; the width within 0.5 mm of the designed width (plus, on the curved front, the demo's own ambiguity there — lib.mjs
// widthAmbiguity: up to 0.8 mm on the lower incisors, 0 on the premolars and molars); missing teeth come
// back as gaps with the right numbers. Arches: full upper and lower, hypodontia (12 and 22 missing, spaces kept and part-closed;
// 35 missing, space kept and closed), spaced front teeth, crowded / turned / displaced teeth, an arch in scanner coordinates (matrix
// option), models with a flat base (horseshoe, full plate, tall base), part arches (a quadrant from the midline, a sextant 13–23,
// 33–37 alone), corrections (relabel with pins), and things that are not an arch.
// Pictures for looking at go to dev/out/core-teeth/ (row-*.png: the straightened row; top-*.png: the arch from the biting side).
import * as N from '../../../shared/core.js';
import * as S from '../../../shared/solid.js';
import fs from 'fs';
import { score, line, picture, topView } from './lib.mjs';
import { makeBasedModel } from '../core-orient/mkbased.mjs';
const OUT = new URL('../../out/core-teeth/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) { fails++; process.exitCode = 1; } return c; };
const t00 = Date.now(), times = [];
function run(name, mesh, truth, opts = {}, lim = {}) {
  const t0 = Date.now(), r = N.findTeeth(mesh, { jaw: truth.jaw, ...opts }); times.push(Date.now() - t0);
  // widths are measured in the occlusal plane, so with a matrix (results in file coordinates) both sides are scored in the case frame
  const M = opts.matrix, mv = (p) => new N.THREE.Vector3(...p).applyMatrix4(M).toArray(), KEYS = ['tip', 'tap', 'centre', 'mesial', 'distal', 'mesialPick', 'distalPick'];
  const inCase = (o) => (M ? { ...o, teeth: o.teeth.map((t) => { const q = { ...t }; for (const k of KEYS) if (q[k]) q[k] = mv(q[k]); return q; }) } : o);
  const s = score(inCase(r), inCase(truth), { skipWidth: lim.skipWidth }), extraNums = r.teeth.map((t) => t.fdi).filter((f) => !truth.teeth.some((q) => q.fdi === f) && !(lim.allow || []).includes(f));
  console.log(name); console.log('    ' + line('found', s) + ` · ${times[times.length - 1]} ms`);
  ok(s.found === s.n && !extraNums.length, `${name}: every tooth numbered right (${s.found}/${s.n})${extraNums.length ? ' — extra numbers ' + extraNums.join(' ') : ''}`);
  ok(s.tipMax <= (lim.tip ?? 1), `${name}: tips within ${lim.tip ?? 1} mm (max ${s.tipMax.toFixed(2)})`);
  if (lim.width !== false && !ok(s.widthMax <= (lim.width ?? 0.5), `${name}: widths within ${lim.width ?? 0.5} mm (max ${s.widthMax.toFixed(2)})`)) console.log('      widths found − designed (± demo ambiguity): ' + s.rows.map((q) => `${q.fdi} ${q.dw >= 0 ? '+' : ''}${q.dw.toFixed(2)}${q.amb > 0.05 ? ' (±' + q.amb.toFixed(1) + ')' : ''}`).join(', '));
  const wantGaps = (truth.gaps || []).map((g) => g.fdi).sort(), gotGaps = r.gaps.flatMap((g) => g.fdi).sort();
  if (lim.gaps !== false) ok(JSON.stringify(wantGaps) === JSON.stringify(gotGaps), `${name}: gaps ${gotGaps.join(' ') || 'none'} (truth ${wantGaps.join(' ') || 'none'})`);
  const slug = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase(); if (r.debug) picture(r, OUT + `row-${slug}.png`); if (!opts.matrix) topView(N, mesh, r, OUT + `top-${slug}.png`, { truth });
  return { r, s };
}
/** keep only the listed teeth and the gum nearest them (each triangle goes with the nearest tooth centre) */
function partArch(d, keep) {
  const C = d.truth.teeth.map((t) => [t.centre[0], t.centre[1], keep.includes(t.fdi)]), P = d.mesh.positions, I = d.mesh.indices, out = [];
  for (let t = 0; t < I.length; t += 3) { const x = (P[3 * I[t]] + P[3 * I[t + 1]] + P[3 * I[t + 2]]) / 3, y = (P[3 * I[t] + 1] + P[3 * I[t + 1] + 1] + P[3 * I[t + 2] + 1]) / 3; let bd = Infinity, bk = false; for (const c of C) { const dd = (x - c[0]) ** 2 + (y - c[1]) ** 2; if (dd < bd) { bd = dd; bk = c[2]; } } if (bk) out.push(I[t], I[t + 1], I[t + 2]); }
  return { mesh: N.compact({ positions: P, indices: Uint32Array.from(out) }), truth: { ...d.truth, teeth: d.truth.teeth.filter((t) => keep.includes(t.fdi)), gaps: [] } };
}

console.log('── full arches');
for (const jaw of ['lower', 'upper']) { const d = N.makeDemoArch({ jaw, res: 0.3 }), { r } = run(`demo ${jaw}`, d.mesh, d.truth); ok(r.midline && r.side === 'both' && !r.extras.length, `demo ${jaw}: crosses the midline, nothing left unnumbered`); ok(r.teeth.every((t) => t.confidence > 0.3), `demo ${jaw}: every tooth confident (lowest ${Math.min(...r.teeth.map((t) => t.confidence)).toFixed(2)})`); }

console.log('── hypodontia and extractions');
for (const [name, jaw, o] of [['upper, 12 and 22 missing (spaces kept)', 'upper', { missing: { 12: true, 22: true } }], ['upper, 12 and 22 missing (spaces part-closed, front spaced)', 'upper', { missing: { 12: 5.5, 22: 5.5 }, spacing: 0.4 }],
  ['lower, 35 missing (space kept)', 'lower', { missing: { 35: true } }], ['lower, 35 missing (space closed to 3 mm)', 'lower', { missing: { 35: 3 } }], ['lower, 35 and 45 missing (spaces closed to 1 mm)', 'lower', { missing: { 35: 1, 45: 1 } }]]) {
  const d = N.makeDemoArch({ jaw, res: 0.3, ...o }); run(name, d.mesh, d.truth);
}

console.log('── spacing and crowding');
{ const d = N.makeDemoArch({ jaw: 'upper', res: 0.3, spacing: 1.5 }); run('upper, front teeth spaced 1.5 mm', d.mesh, d.truth); }
{ const d = N.makeDemoArch({ jaw: 'upper', res: 0.3, turn: { 12: 25, 22: -20, 15: 15 }, shift: { 13: 1.5, 22: -1.5 } }); run('upper, 12 22 15 turned, 13 out, 22 in', d.mesh, d.truth, {}, { width: 1.0 }); }
{ const d = N.makeDemoArch({ jaw: 'lower', res: 0.3, spacing: -0.6, turn: { 32: 20, 42: -25 }, shift: { 41: -1.2, 31: 1 } }); run('lower, front crowded (overlapping 0.6 mm), 32 42 turned, 41 in, 31 out', d.mesh, d.truth, {}, { width: false }); }

console.log('── scanner coordinates (matrix option)');
{ const p = N.makeDemoPair({ res: 0.3, scannerFrame: true });
  for (const jaw of ['upper', 'lower']) { const M = N.autoOrient(p[jaw], jaw).matrix, { r } = run(`${jaw} in scanner coordinates`, p[jaw], p.truth[jaw], { matrix: M });
    const off = r.teeth.map((t) => { const q = p.truth[jaw].teeth.find((x) => x.fdi === t.fdi); return q ? Math.hypot(t.tap[0] - q.tip[0], t.tap[1] - q.tip[1], t.tap[2] - q.tip[2]) : 0; });
    ok(Math.max(...off) < 6, `${jaw} in scanner coordinates: tap points in file coordinates, on their teeth (max ${Math.max(...off).toFixed(1)} mm from the tip)`); } }

console.log('── models with a flat base');
for (const [name, cfg] of [['upper model, horseshoe base', { jaw: 'upper', style: 'horseshoe' }], ['lower model, full base', { jaw: 'lower', style: 'full' }], ['upper model, tall base (14 mm)', { jaw: 'upper', style: 'full', baseH: 14 }]]) {
  const d = N.makeDemoArch({ jaw: cfg.jaw, res: 0.3 }), m = await makeBasedModel(N, S, { ...cfg, arch: d.mesh }); run(name, m.mesh, d.truth);
}

console.log('── part arches');
// (the tooth at a cut end is cut through its contact, so its width there is left out)
for (const [name, jaw, keep, side, cut] of [['lower 33–37 alone', 'lower', [33, 34, 35, 36, 37], 'left', [33]], ['upper sextant 13–23', 'upper', [13, 12, 11, 21, 22, 23], 'both', [13, 23]], ['upper quadrant 21–27', 'upper', [21, 22, 23, 24, 25, 26, 27], 'left', [21]], ['lower quadrant 41–47', 'lower', [41, 42, 43, 44, 45, 46, 47], 'right', [41]]]) {
  const d = partArch(N.makeDemoArch({ jaw, res: 0.3 }), keep), { r } = run(name, d.mesh, d.truth, {}, { gaps: false, skipWidth: cut });
  ok(side === 'both' ? r.midline : r.side === side, `${name}: side ${r.side}${r.midline ? ' (crosses the midline)' : ''}`);
}

console.log('── corrections (relabel with pins)');
{ const d = N.makeDemoArch({ jaw: 'lower', res: 0.3 }), r = N.findTeeth(d.mesh, { jaw: 'lower' }), t44 = r.teeth.find((t) => t.fdi === 44), t31 = r.teeth.find((t) => t.fdi === 31);
  const r2 = r.relabel([{ p: t44.centre, fdi: 45 }]), at = (res, p) => res.teeth.find((t) => Math.hypot(t.centre[0] - p[0], t.centre[1] - p[1]) < 2);
  ok(at(r2, t44.centre) && at(r2, t44.centre).fdi === 45, `pin "this is 45" on 44: it becomes ${at(r2, t44.centre) && at(r2, t44.centre).fdi}`);
  ok(r2.teeth.every((t, i) => i === 0 || N.FDI_ORDER.lower.indexOf(t.fdi) > N.FDI_ORDER.lower.indexOf(r2.teeth[i - 1].fdi)), `… numbers still run in order round the arch: ${r2.teeth.map((t) => t.fdi).join(' ')}`);
  const r3 = r.relabel([{ p: t31.centre, fdi: 0 }]); ok(!at(r3, t31.centre) && r3.teeth.length === 13 && r3.teeth.some((t) => t.fdi === 41), `pin "not a tooth" on 31: ${r3.teeth.length} teeth left, ${r3.extras.length} lump(s) without a number`);
  const r4 = r.relabel([]); ok(JSON.stringify(r4.teeth.map((t) => t.fdi)) === JSON.stringify(r.teeth.map((t) => t.fdi)), 'relabel with no pins gives the same numbers');
  const r5 = N.findTeeth(d.mesh, { jaw: 'lower', pins: [{ p: t44.centre, fdi: 45 }] }); ok(at(r5, t44.centre) && at(r5, t44.centre).fdi === 45, 'pins can also be given to findTeeth directly'); }

console.log('── not an arch');
{ const plane = { positions: new Float32Array([-30, -30, 0, 30, -30, 0, 30, 30, 0, -30, 30, 0]), indices: new Uint32Array([0, 1, 2, 0, 2, 3]) };
  let r, err = null; try { r = N.findTeeth(plane, { jaw: 'lower' }); } catch (e) { err = e; } ok(!err && r && !r.ok && r.teeth.length === 0 && r.note, `a flat plate: no teeth, a note (“${r && r.note}”)`);
  try { r = N.findTeeth({ positions: new Float32Array(0), indices: new Uint32Array(0) }, { jaw: 'upper' }); err = null; } catch (e) { err = e; } ok(!err && r && !r.ok, 'an empty mesh: no teeth, no error'); }

console.log(`\nfindTeeth: median ${times.sort((a, b) => a - b)[times.length >> 1]} ms, slowest ${times[times.length - 1]} ms per arch (node, one core); whole test ${((Date.now() - t00) / 1000).toFixed(0)} s`);
console.log(fails ? `${fails} FAILED` : 'all passed');
