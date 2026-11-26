// Synthetic dental models WITH A BASE, built from the demo arches the way Model Card builds them
// (scan → S.scanToSolid with a flat base → optional full plate → optional hollowing), for testing autoOrient.
//
//   import { makeBasedModel, randomPose } from './mkbased.mjs';
//   const m = await makeBasedModel(N, S, { jaw: 'upper', style: 'horseshoe' | 'full', hollow: false | 'open' | 'closed',
//                                         baseH: 5, tilt: 0 (deg between base and occlusal plane), tiltAz: 0 (deg, which way it tilts), res: 0.3,
//                                         label: '' (raised letters on the underside) });
//   → { mesh (case frame: occlusal plane z ≈ 0, front −Y, teeth +Z lower / −Z upper), baseNormal: [x,y,z] (out of the underside, case frame), info }
// Pure synthetic data — no patient scans.
export async function makeBasedModel(N, S, o = {}) {
  const THREE = N.THREE, jaw = o.jaw === 'upper' ? 'upper' : 'lower', M = await S.ready();
  const arch = o.arch || N.makeDemoArch({ jaw, res: o.res || 0.3 }).mesh;
  const W = jaw === 'upper' ? N.rotationAbout('y', 180) : new THREE.Matrix4();          // work frame: teeth up (as Model Card)
  const az = THREE.MathUtils.degToRad(o.tiltAz || 0), axis = new THREE.Vector3(Math.cos(az), Math.sin(az), 0);
  const T = new THREE.Matrix4().makeRotationAxis(axis, THREE.MathUtils.degToRad(o.tilt || 0)); // base built in a frame turned this much from the occlusal plane
  const WT = T.clone().multiply(W), back = WT.clone().invert();
  const scan = N.transformMesh(arch, WT), b = N.meshBounds(scan), baseH = o.baseH ?? 5, baseZ = b.min[2] - baseH;
  const r = S.scanToSolid(scan, { baseZ, margin: o.margin || 0, smooth: o.smooth ?? 2 });
  let man = S.toManifold(r.mesh);
  const add = (q) => { const t = man.add(q); S.free(man, q); man = t; }, sub = (q) => { const t = man.subtract(q); S.free(man, q); man = t; };
  const O = r.outline, style = o.style || 'horseshoe', wall = o.wall ?? 2.5;
  if (O && style === 'full') { const cs = new M.CrossSection([O], 'NonZero'), hull = cs.hull(); add(hull.extrude(Math.min(o.plateT ?? 3, baseH)).translate(0, 0, baseZ)); S.free(cs, hull); }
  let cavity = 0;
  if (o.hollow) {
    const open = o.hollow === 'open', h = S.hollow(man, { wall, openBelow: open ? baseZ : undefined });
    if (h.cavityVolume > 0) {
      S.free(man); man = h.solid; cavity = h.cavityVolume;
      if (open && O) { const nO = O.length, notches = o.notches ?? 4; for (let k = 0; k < notches; k++) { const j = Math.floor((k + 0.5) * nO / notches), p = O[j], q0 = O[(j + nO - 2) % nO], q1 = O[(j + 2) % nO], ang = Math.atan2(q1[1] - q0[1], q1[0] - q0[0]) * 180 / Math.PI; sub(M.Manifold.cylinder(2 * wall + 6, 1.5, 1.5, 24, true).rotate([90, 0, 0]).rotate([0, 0, ang]).translate(p[0], p[1], baseZ)); } }
      if (!open) { const F = h.field, k = Math.min(F.nz - 1, Math.max(0, Math.round((baseZ + wall + 1.2 - F.z0) / F.cell - 0.5)));
        for (const side of [-1, 1]) { let best = wall + 0.8, bi = -1, bj = -1; for (const far of [12, 1]) { for (let j = 0; j < F.ny; j++) for (let i = 0; i < F.nx; i++) { const x = F.x0 + (i + 0.5) * F.cell; if (x * side <= far) continue; const d = F.d[(k * F.ny + j) * F.nx + i]; if (d > best) { best = d; bi = i; bj = j; } } if (bi >= 0) break; } if (bi >= 0) sub(M.Manifold.cylinder(wall + 4, 1.75, 1.75, 24).translate(F.x0 + (bi + 0.5) * F.cell, F.y0 + (bj + 0.5) * F.cell, baseZ - 1)); } }
    } else S.free(h.solid);
  }
  if (o.label && O) {                                              // a raised label on the underside, as Model Card places one (letters stand 0.5 mm proud)
    let cx = 0, cy = 0; for (const p of O) { cx += p[0]; cy += p[1]; } cx /= O.length; cy /= O.length; if (style === 'horseshoe') { let yMin = Infinity; for (const p of O) if (Math.abs(p[0] - cx) < 4 && p[1] < yMin) yMin = p[1]; cx = 0; cy = yMin + 4; }
    const n = new THREE.Vector3(0, 0, -1), y = new THREE.Vector3(0, 1, 0), x = new THREE.Vector3().crossVectors(y, n), L = new THREE.Matrix4().makeBasis(x, y, n).setPosition(cx, cy, baseZ);
    const txt = S.textSolid(o.label, { height: 3.5, depth: 1 }); if (txt) { const placed = txt.translate(0, 0, -0.5).transform(S.mat4(L)); S.free(txt); add(placed); }
  }
  { const parts = man.decompose(); if (parts.length > 1) { let big = parts[0]; for (const q of parts) if (q.volume() > big.volume()) big = q; const nm = big.translate(0, 0, 0); S.free(man); man = nm; } S.free(...parts); }
  const work = S.fromManifold(man); S.free(man);
  const mesh = N.transformMesh(work, back);
  const bn = new THREE.Vector3(0, 0, -1).transformDirection(back);
  return { mesh, baseNormal: bn.toArray(), info: { jaw, style, hollow: o.hollow || false, baseH, tilt: o.tilt || 0, tiltAz: o.tiltAz || 0, cavity, tris: mesh.indices.length / 3, watertight: N.isWatertight(mesh) } };
}

/** A seeded random rigid pose (any rotation, translation up to ±tr mm) as a THREE.Matrix4. */
export function randomPose(N, rnd, tr = 80) {
  const THREE = N.THREE, u1 = rnd(), u2 = rnd(), u3 = rnd();
  const q = new THREE.Quaternion(Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2), Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2), Math.sqrt(u1) * Math.sin(2 * Math.PI * u3), Math.sqrt(u1) * Math.cos(2 * Math.PI * u3));
  return new THREE.Matrix4().compose(new THREE.Vector3((rnd() * 2 - 1) * tr, (rnd() * 2 - 1) * tr, (rnd() * 2 - 1) * tr), q, new THREE.Vector3(1, 1, 1));
}
/** mulberry32 */
export const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/**
 * How far an autoOrient result is from the truth.  M = autoOrient matrix (file → case frame), pose = the matrix that put the
 * case-frame model into the file (so the ideal M is pose⁻¹).  → { axis (deg between found and true occlusal axis, 180 = upside down),
 * yaw (deg between found and true front direction, within the occlusal plane), dx, dz (mm: midline and occlusal-plane height) }
 */
export function orientError(N, M, pose) {
  const E = M.clone().multiply(pose).elements;                         // case frame → found case frame; identity is perfect
  const z = [E[8], E[9], E[10]], axis = Math.acos(Math.max(-1, Math.min(1, z[2]))) * 180 / Math.PI;
  const yx = E[4], yy = E[5], yaw = Math.abs(Math.atan2(-yx, yy)) * 180 / Math.PI;   // where case-frame +Y (back) went, seen from above
  return { axis, yaw, dx: E[12], dz: E[14] };
}
