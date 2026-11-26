// Partial-coverage preparations of exactly known shape on the demo lower 46, for Prep check's onlay and inlay checks.
//   KIND=onlay → dev/data/prep-onlay-lower.stl + prep-onlay-truth.json: the whole occlusal surface lowered by exactly 1.5 mm (the tooth's
//     own cusps and fossae moved down), axial walls of a round core converging 6°, a flat margin all round 0.5 mm above the contact
//     points (so the proximal contacts are kept, below the margin).
//   KIND=inlay → dev/data/prep-inlay-lower.stl + prep-inlay-truth.json: an MOD inlay — occlusal box 2.4 mm wide at its flat floor,
//     buccal and lingual walls each flaring 6°, proximal boxes 5.0 mm wide at their gingival floors 1.5 mm below the contact points, axial
//     walls leaning 6° — on a tooth built 0.4 mm short of each neighbour (open contacts of known width: the demo's teeth are nearly
//     parallel-sided below their contacts, so a box on a tooth in contact would still touch its neighbour at the gingival floor).
// Both use dev/data/prep-upper.stl (mkprep.mjs) as the opposing arch: the same demo upper, in the same bite. KIND=inlay also writes
// prep-inlay-upper-close.stl: that upper lowered until it just touches the inlay tooth's remaining cusps (for the occlusal contacts).
// The truths are worked out here from the designed shape itself (makeDemoArch's prepField / toothField, not the mesh): occlusal room
// from the designed occlusal surface to the opposing scan, remaining wall thickness along each wall's inward normal, wall heights.
import fs from 'fs';
import * as N from '/home/claude/suite/shared/core.js';
const THREE = N.THREE, DATA = '/home/claude/suite/dev/data/', KIND = process.env.KIND === 'inlay' ? 'inlay' : 'onlay', rad = Math.PI / 180;
const pair = N.makeDemoPair({ res: 0.3 }), t46 = pair.truth.lower.teeth.find((t) => t.fdi === 46), zc = (t46.mesial[2] + t46.distal[2]) / 2;
// the unprepared arch, to find the tooth's frame and its own surface before choosing the design's heights
const plain = N.makeDemoArch({ jaw: 'lower', res: 0.3, prep: { kind: 'onlay', fdi: 46, reduce: 0, zMargin: 99, R0: 99 } }), F = plain.prepFrame, TF = plain.toothField;
const at = (um, v, z) => [F.centre[0] + F.mesial[0] * um + F.buccal[0] * v, F.centre[1] + F.mesial[1] * um + F.buccal[1] * v, z];
const f3 = (fn, um, v, z) => fn(...at(um, v, z));
/** height of the top surface of a field over (um, v): first crossing coming down from above */
const topZ = (fn, um, v) => { let z = 3; if (f3(fn, um, v, z) < 0) return NaN; for (; z > -9; z -= 0.04) if (f3(fn, um, v, z) < 0) break; if (z <= -9) return NaN; let a = z, b = z + 0.04; for (let k = 0; k < 30; k++) { const m = (a + b) / 2; if (f3(fn, um, v, m) < 0) a = m; else b = m; } return (a + b) / 2; };
/** distance from the axis outwards (direction ang in the um–v plane) to the surface of a field at height z */
const radial = (fn, ang, z, r0 = 0.5, r1 = 9) => { const c = Math.cos(ang), s = Math.sin(ang); let a = r0, b = r1; if (f3(fn, a * c, a * s, z) > 0) return NaN; for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (f3(fn, m * c, m * s, z) < 0) a = m; else b = m; } return (a + b) / 2; };
const grad = (fn, p) => { const e = 0.005, g = [0, 1, 2].map((k) => { const a = p.slice(), b = p.slice(); a[k] += e; b[k] -= e; return (fn(...a) - fn(...b)) / (2 * e); }), l = Math.hypot(...g); return g.map((v) => v / l); };
const fossa = topZ(TF, 0, 0);
const upBvh = (() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pair.upper.positions, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(pair.upper.indices), 1)); return new N.MeshBVH(g); })();
const hit = {}, q = new THREE.Vector3(), clearOf = (p) => { q.set(p[0], p[1], p[2]); upBvh.closestPointToPoint(q, hit); return hit.distance; };
const wq = (list, frac) => { const s = list.slice().sort((a, b) => a[0] - b[0]), tot = s.reduce((t, x) => t + x[1], 0); let acc = 0; for (const x of s) { acc += x[1]; if (acc >= frac * tot) return x[0]; } return NaN; };
const r2 = (v) => Math.round(v * 1000) / 1000;

let prep, truth;
if (KIND === 'onlay') {
  prep = { kind: 'onlay', fdi: 46, reduce: 1.5, zMargin: zc + 0.5, R0: 4.5, taper: 6 };
  const lo = N.makeDemoArch({ jaw: 'lower', res: 0.3, prep }), PF = lo.prepField;
  fs.writeFileSync(DATA + 'prep-onlay-lower.stl', Buffer.from(N.stlBinary(lo.mesh)));
  // occlusal room over the designed occlusal surface: plan grid, area-weighted, facing the opposing arch (normal within 72° of up),
  // more than 0.4 mm above the margin (not the shoulder), by quarter (mesiobuccal, distobuccal, mesiolingual, distolingual)
  const Q = { mb: [], db: [], ml: [], dl: [] }, all = [], st = 0.1; let minAt = null, min = Infinity;
  for (let um = -6; um <= 6; um += st) for (let v = -6; v <= 6; v += st) {
    const z = topZ(PF, um, v); if (!(z === z) || z < prep.zMargin + 0.4) continue; const p = at(um, v, z), n = grad(PF, p); if (n[2] < 0.3) continue;
    const R = prep.R0 - (z - prep.zMargin) * Math.tan(prep.taper * rad); if (Math.hypot(um, v) > R - 0.15) continue;   // the anatomy, not the core's walls
    const c = clearOf(p), w = st * st / n[2]; all.push([c, w]); Q[(um >= 0 ? 'm' : 'd') + (v >= 0 ? 'b' : 'l')].push([c, w]); if (c < min) { min = c; minAt = p; }
  }
  const stat = (L) => ({ min: r2(Math.min(...L.map((x) => x[0]))), median: r2(wq(L, 0.5)), area: r2(L.reduce((t, x) => t + x[1], 0)) });
  // the unprepared tooth's own room, for comparison: reduction should add about 1.5 mm where the opposing tooth is overhead
  let min0 = Infinity; for (let um = -4; um <= 4; um += 0.2) for (let v = -4; v <= 4; v += 0.2) { const z = topZ(TF, um, v); if (z === z) min0 = Math.min(min0, clearOf(at(um, v, z))); }
  const loop = []; for (let k = 0; k < 12; k++) { const a = (k / 12) * 2 * Math.PI, r = radial(TF, a, prep.zMargin + 0.02); loop.push(at((r - 0.1) * Math.cos(a), (r - 0.1) * Math.sin(a), prep.zMargin)); }
  const below = (tgt) => r2(all.filter((x) => x[0] < tgt).reduce((t, x) => t + x[1], 0) / all.reduce((t, x) => t + x[1], 0));
  truth = { kind: 'onlay', ...prep, frame: F, fossa, zContact: zc, seed: at(0, 0, topZ(PF, 0, 0)), loop, room: { ...stat(all), at: minAt, belowTarget: { 1.5: below(1.5), 3.5: below(3.5), 4.0: below(4.0), 4.5: below(4.5) }, quarters: Object.fromEntries(Object.entries(Q).map(([k, L]) => [k, stat(L)])), unpreparedMin: r2(min0) } };
  console.log(`onlay 46: occlusal surface lowered ${prep.reduce} mm, margin at z ${prep.zMargin.toFixed(2)} (contacts at ${zc.toFixed(2)}); room closest ${truth.room.min} mm, typical ${truth.room.median} mm (unprepared tooth closest ${truth.room.unpreparedMin} mm); by quarter ${Object.entries(truth.room.quarters).map(([k, s]) => k + ' ' + s.min + '/' + s.median).join(', ')}; ${lo.mesh.indices.length / 3} triangles`);
} else {
  const zG = zc - 1.5, open = 0.4, aG = radial(TF, 0, zG) - open;                // the (narrowed) tooth's mesial contour at the gingival floor's height
  prep = { kind: 'inlay', fdi: 46, isthmus: 2.4, diverge: 6, zFloor: fossa - 1.8, zGing: zG, boxWidth: 5.0, axialAt: +(aG - 1.5).toFixed(3), axial: 6, open };
  const lo = N.makeDemoArch({ jaw: 'lower', res: 0.3, prep }), PF = lo.prepField, ta = Math.tan(prep.diverge * rad), TFi = lo.toothField;
  fs.writeFileSync(DATA + 'prep-inlay-lower.stl', Buffer.from(N.stlBinary(lo.mesh)));
  const hwO = (z) => prep.isthmus / 2 + (z - prep.zFloor) * ta, hwB = (z) => prep.boxWidth / 2 + (z - prep.zGing) * ta, uAx = (z) => prep.axialAt - (z - prep.zGing) * Math.tan(prep.axial * rad);
  // where a wall (v = hw(z), sign s: +1 buccal, −1 lingual) meets the tooth's own surface at um: its top edge
  const edgeZ = (um, s, hw) => { let z = topZ(TFi, um, s * hw(fossa)); for (let k = 0; k < 8; k++) z = topZ(TFi, um, s * hw(z)); return z; };
  // the mesial or distal end of a box wall: where the box's buccal / lingual wall meets the tooth's proximal surface, at height z
  const proxU = (s, side, z) => { const v = s * hwB(z); let a = uAx(z), b = 9; for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (f3(TFi, side * m, v, z) < 0) a = m; else b = m; } return (a + b) / 2; };
  // margin taps: round the cavity's edge, just outside it (0.15 mm), as a user taps the cavosurface margin; each point dropped onto the
  // mesh as a tap would land. Order: buccal occlusal edge (distal → mesial), the mesial box (buccal side down, across the gingival floor,
  // lingual side up), lingual occlusal edge (mesial → distal), the distal box (lingual side down, across, buccal side up).
  const O = 0.15, boxSide = (side, s) => {                                       // from the axial wall's corner on the isthmus to the gingival floor
    const zt = edgeZ(side * (uAx(-1) + 0.6), s, hwB), zm = (zt + prep.zGing) / 2, ax = uAx(zt) - O, ez = edgeZ(side * ax, s, hwO), eb = edgeZ(side * ax, s, hwB);
    return [[side * ax, s * (hwO(ez) + O), ez], [side * ax, s * (hwB(eb) + O), eb], [side * (proxU(s, side, zt - 0.3) + 0.05), s * (hwB(zt - 0.3) + O), zt - 0.3],
      [side * (proxU(s, side, zm) + 0.05), s * (hwB(zm) + O), zm], [side * (proxU(s, side, prep.zGing + 0.05) + O), s * (hwB(prep.zGing) + O / 2), prep.zGing + 0.05]];
  };
  const box = (side) => [...boxSide(side, 1), [side * (radial(TFi, side > 0 ? 0 : Math.PI, prep.zGing + 0.05) + O), 0, prep.zGing + 0.05], ...boxSide(side, -1).reverse()];
  const occ = (s, list) => list.map((um) => { const z = edgeZ(um, s, hwO); return [um, s * (hwO(z) + O), z]; });
  const pathUV = [...occ(1, [-1.6, 0, 1.6]), ...box(1), ...occ(-1, [1.6, 0, -1.6]), ...box(-1).reverse()];
  const loBvh = (() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(lo.mesh.positions, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(lo.mesh.indices), 1)); return new N.MeshBVH(g); })();
  const loopXYZ = pathUV.map((p) => { const h = {}; loBvh.closestPointToPoint(new THREE.Vector3(...at(p[0], p[1], p[2])), h); return h.point.toArray(); });
  // remaining wall thickness: from each point of the designed buccal / lingual walls, along the wall's inward normal (into the tooth)
  // to where it leaves the tooth; walls within 1 mm of where a box opens onto the proximal surface are left out (they thin to nothing
  // at the margin there), as Prep check leaves them out of its figure. Sampled evenly over the wall's area.
  const wallT = { buccal: [], lingual: [] };
  for (const s of [1, -1]) for (let um = -6; um <= 6; um += 0.1) for (let z = prep.zGing + 0.05; z < 3; z += 0.1) {
    const inBox = Math.abs(um) > uAx(z), hw = inBox ? hwB(z) : hwO(z); if (!inBox && z < prep.zFloor + 0.05) continue;
    const p = at(um, s * hw, z); if (TFi(...p) > -0.02) continue;                // above the tooth's own surface: not wall
    const nIn = [F.buccal[0] * s, F.buccal[1] * s, -ta]; const L = Math.hypot(...nIn); for (let k = 0; k < 3; k++) nIn[k] /= L;   // into the tooth
    let d = 0.02; while (d < 9 && PF(p[0] + nIn[0] * d, p[1] + nIn[1] * d, p[2] + nIn[2] * d) < 0) d += 0.01; if (d >= 9) continue;
    let near = Infinity; for (const side of [1, -1]) if (Math.sign(um) === side || !inBox) for (let zz = prep.zGing; zz < z + 2; zz += 0.1) { const u = proxU(s, side, zz); if (u === u) near = Math.min(near, Math.hypot(side * u - um, s * hwB(zz) - s * hw, zz - z)); }
    if (near < 1.0) continue;
    wallT[s > 0 ? 'buccal' : 'lingual'].push([d, 0.01 / Math.cos(prep.diverge * rad)]);
  }
  const thin = (L) => { const s = L.slice().sort((a, b) => a[0] - b[0]), tot = s.reduce((t, x) => t + x[1], 0), lim = Math.min(0.2, 0.03 * tot); let acc = 0; for (const x of s) { acc += x[1]; if (acc >= lim) return r2(x[0]); } return NaN; };
  // wall heights: buccal / lingual from the gingival floor to the highest point of the wall's top edge
  let topB = -Infinity, topL = -Infinity; for (let um = -5.5; um <= 5.5; um += 0.05) { const inBox = Math.abs(um) > uAx(fossa); topB = Math.max(topB, edgeZ(um, 1, inBox ? hwB : hwO) || -Infinity); topL = Math.max(topL, edgeZ(um, -1, inBox ? hwB : hwO) || -Infinity); }
  // occlusal room over the pulpal floor (away from its edges)
  let floorMin = Infinity, floorAt = null; const fl = [];
  for (let um = -uAx(prep.zFloor) + 0.3; um <= uAx(prep.zFloor) - 0.3; um += 0.1) for (let v = -hwO(prep.zFloor) + 0.3; v <= hwO(prep.zFloor) - 0.3; v += 0.1) { const p = at(um, v, prep.zFloor), c = clearOf(p); fl.push([c, 1]); if (c < floorMin) { floorMin = c; floorAt = p; } }
  // occlusal contacts: the same upper lowered until it just touches this tooth's remaining (uncut) cusps, 0.05 mm away — written as
  // prep-inlay-upper-close.stl. Contacts = remaining-surface points within 0.15 mm of it; their straight-line distance to the margin
  // (the tapped outline, densified) is a lower bound for the distance along the tooth that Prep check reports.
  const P0 = lo.mesh.positions, rem = []; for (let i = 0; i < P0.length; i += 3) { const p = [P0[i], P0[i + 1], P0[i + 2]], dx = p[0] - F.centre[0], dy = p[1] - F.centre[1]; if (dx * dx + dy * dy > 36 || p[2] < zc) continue; if (Math.abs(TFi(...p)) < 0.06 && Math.abs(PF(...p)) < 0.06) rem.push(p); }
  const upRay = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, 1)); let gap0 = Infinity; for (const p of rem) { upRay.origin.set(p[0], p[1], p[2]); const h = upBvh.raycastFirst(upRay, THREE.DoubleSide); if (h) gap0 = Math.min(gap0, h.distance); }
  const dz = -(gap0 - 0.05);                                                     // (lowered by the smallest vertical gap: no point of the tooth goes through it)
  const upClose = { positions: Float32Array.from(pair.upper.positions), indices: pair.upper.indices }; for (let i = 2; i < upClose.positions.length; i += 3) upClose.positions[i] += dz;
  fs.writeFileSync(DATA + 'prep-inlay-upper-close.stl', Buffer.from(N.stlBinary(upClose)));
  const dense = []; for (let i = 0; i < loopXYZ.length; i++) { const a = loopXYZ[i], b = loopXYZ[(i + 1) % loopXYZ.length]; for (let t = 0; t < 1; t += 0.02) dense.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
  let occE = Infinity, occAt = null, nC = 0; for (const p of rem) { q.set(p[0], p[1], p[2] - dz); upBvh.closestPointToPoint(q, hit); if (hit.distance > 0.15) continue; nC++; let e = Infinity; for (const m of dense) e = Math.min(e, Math.hypot(m[0] - p[0], m[1] - p[1], m[2] - p[2])); if (e < occE) { occE = e; occAt = p; } }
  truth = { kind: 'inlay', ...prep, frame: F, fossa, zContact: zc, seed: at(0, 0, prep.zFloor), loop: loopXYZ, closeUpper: { lowered: r2(-dz), contacts: nC, nearestToMargin: r2(occE), at: occAt },
    isthmusAt05: r2(prep.isthmus + 2 * 0.5 * ta), angles: { buccal: prep.diverge, lingual: prep.diverge, mesial: prep.axial, distal: prep.axial }, total: { bl: 2 * prep.diverge, md: 2 * prep.axial },
    wallHeight: { buccal: r2(topB - prep.zGing), lingual: r2(topL - prep.zGing) }, wallThin: { buccal: thin(wallT.buccal), lingual: thin(wallT.lingual) },
    wallMedian: { buccal: r2(wq(wallT.buccal, 0.5)), lingual: r2(wq(wallT.lingual, 0.5)) }, floorRoom: { min: r2(floorMin), median: r2(wq(fl, 0.5)), at: floorAt } };
  console.log(`inlay 46 (MOD): isthmus ${prep.isthmus} mm at the floor (z ${prep.zFloor.toFixed(2)}, ${(fossa - prep.zFloor).toFixed(2)} mm below the central fossa), walls flaring ${prep.diverge}°, boxes ${prep.boxWidth} mm wide to z ${prep.zGing.toFixed(2)} (contacts at ${zc.toFixed(2)}), axial walls ${prep.axialAt} mm from the centre;`);
  console.log(`  remaining wall, thinnest: buccal ${truth.wallThin.buccal} mm, lingual ${truth.wallThin.lingual} mm (typical ${truth.wallMedian.buccal} / ${truth.wallMedian.lingual}); wall heights B ${truth.wallHeight.buccal} L ${truth.wallHeight.lingual} mm; room over the floor closest ${truth.floorRoom.min} mm; ${lo.mesh.indices.length / 3} triangles; ${loopXYZ.length} margin points`);
  console.log(`  upper lowered ${truth.closeUpper.lowered} mm to touch the remaining cusps: ${nC} contact points, nearest ${truth.closeUpper.nearestToMargin} mm (straight) from the margin`);
}
fs.writeFileSync(DATA + `prep-${KIND}-truth.json`, JSON.stringify(truth, null, 1));
