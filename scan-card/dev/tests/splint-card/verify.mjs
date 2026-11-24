// Accuracy checks for a built appliance (all in the arch frame unless stated). Used by the Node tests.
import { K, N } from './kernel.mjs';
const T = N.THREE;
const bvhOf = (mesh, tris = null) => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(mesh.positions, 3)); g.setIndex(new T.BufferAttribute(Uint32Array.from(tris || mesh.indices), 1)); return new N.MeshBVH(g); };   // copy: MeshBVH reorders the index in place
const q = (arr, f) => { if (!arr.length) return NaN; const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
/**
 * scanA: scan (arch frame); res: K.build result; p: full parameter set used; arch: K.analyseArch result
 * → { seatMin, seatN, fitMean, fitP95, fitMax, fitN, fitOver05, retMax, retP99, retN, thickMin, thickAt, ... }
 */
export function checkAppliance(scanA, arch, res, p) {
  const out = {}, P = res.mesh.positions, I = res.mesh.indices, kind = res.triKind, nT = I.length / 3, c = p.clearance;
  const fitTris = [], modelTris = []; for (let f = 0; f < nT; f++) { if (kind[f]) fitTris.push(I[3 * f], I[3 * f + 1], I[3 * f + 2]); if (kind[f] === 1) modelTris.push(I[3 * f], I[3 * f + 1], I[3 * f + 2]); }
  const appAll = bvhOf(res.mesh), scanB = bvhOf(scanA), v = new T.Vector3(), hit = {};
  // undercut depth of every scan vertex along the path of insertion (work frame)
  const R = K.tiltMatrix(p.tiltX, p.tiltY), Ri = R.clone().invert(), mw = N.transformMesh(scanA, R), hf = N.rasterHeightfield(mw, { cell: 0.05, pad: 0.6 }), uc = K.undercutDepth(mw, hf, 2.5);
  const SP = scanA.positions, nS = SP.length / 3, o = {};
  // ---- seating + fit: scan vertices under the appliance ----
  const mp = { buccal: p.buccal, lingual: p.lingual, adjB: p.adjB, adjL: p.adjL };
  let seatMin = Infinity, seatAt = null, seatN = 0; const fitErr = [], gaps = [];
  for (let i = 0; i < nS; i++) {
    const x = SP[3 * i], y = SP[3 * i + 1], z = SP[3 * i + 2];
    K.borderAt(arch, mp, x, y, o); if (!(z > o.z - 0.5)) continue;          // at or above the margin (a little below it too)
    v.set(x, y, z); appAll.closestPointToPoint(v, hit, 0, 1.5); if (!(hit.distance < 1.5)) continue;
    seatN++; if (hit.distance < seatMin) { seatMin = hit.distance; seatAt = [x, y, z]; }
    if (z > o.z + 0.6 && uc[i] === 0) { gaps.push(hit.distance); fitErr.push(Math.abs(hit.distance - c)); }
  }
  Object.assign(out, { seatMin, seatAt, seatN, fitN: gaps.length, gapMean: gaps.reduce((a, b) => a + b, 0) / gaps.length, gapP05: q(gaps, 0.05), gapP50: q(gaps, 0.5), gapP95: q(gaps, 0.95), gapMax: q(gaps, 1), fitErrMean: fitErr.reduce((a, b) => a + b, 0) / fitErr.length, fitErrP95: q(fitErr, 0.95), fitWithin05: fitErr.filter((e) => e <= 0.05).length / fitErr.length });
  // ---- fit-side vertices of the appliance: distance to the scan (must not be closer than the clearance) and engaged undercut ----
  const isFit = new Uint8Array(P.length / 3), isOut = new Uint8Array(P.length / 3); for (let f = 0; f < nT; f++) for (let k = 0; k < 3; k++) { if (kind[f]) isFit[I[3 * f + k]] = 1; else isOut[I[3 * f + k]] = 1; }
  let closeMin = Infinity; const eng = [], fw = [];
  const fitPts = []; for (let i = 0; i < isFit.length; i++) if (isFit[i]) fitPts.push(i);
  const FW = new Float32Array(fitPts.length * 3); fitPts.forEach((i, k) => { v.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]).applyMatrix4(R); FW[3 * k] = v.x; FW[3 * k + 1] = v.y; FW[3 * k + 2] = v.z; });
  const ucFit = K.undercutDepth({ positions: FW }, hf, 2.5);
  fitPts.forEach((i, k) => { v.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]); scanB.closestPointToPoint(v, hit); if (hit.distance < closeMin) closeMin = hit.distance; if (ucFit[k] > 0) eng.push(ucFit[k]); });
  Object.assign(out, { fitVerts: fitPts.length, fitToScanMin: closeMin, engagedN: eng.length, engagedMax: q(eng, 1), engagedP99: q(eng, 0.99), engagedP50: q(eng, 0.5) });
  // ---- thickness ----
  const th = K.thickness(res.mesh, kind, (p.edge ?? 0.6) + 0.25); out.thickMin = th.min; out.thickAt = th.minAt;
  const tv = []; for (let i = 0; i < th.t.length; i++) if (th.t[i] === th.t[i] && !th.border[i]) tv.push(th.t[i]);
  out.thickP01 = q(tv, 0.01); out.thickP50 = q(tv, 0.5); out.thickP99 = q(tv, 0.99); out.thickN = tv.length;
  out.volume_mL = res.report.volume / 1000; out.watertight = res.report.watertight; out.parts = res.report.parts; out.tris = res.report.tris;
  return out;
}
export const fmtCheck = (r) => Object.entries(r).map(([k, v]) => `${k}=${typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(3)) : Array.isArray(v) ? '[' + v.map((x) => x.toFixed(1)) + ']' : v}`).join('  ');

/** Opposing arch checks (arch frame): no penetration, clearance, contacts. oppA = opposing mesh in the opened bite. */
export function checkOpposing(res, oppA) {
  const P = res.mesh.positions, I = res.mesh.indices, kind = res.triKind, isOut = new Uint8Array(P.length / 3);
  for (let f = 0; f < kind.length; f++) if (!kind[f]) for (let k = 0; k < 3; k++) isOut[I[3 * f + k]] = 1;
  const ob = bvhOf(oppA), low = N.rasterHeightfield(oppA, { cell: 0.1, mode: 'min' }), v = new T.Vector3(), hit = {};
  let minD = Infinity, pen = 0, worstPen = 0, near = 0; const cl = new Map();
  for (let i = 0; i < isOut.length; i++) { if (!isOut[i]) continue; const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
    const zl = N.sampleField(low, x, y); if (zl === zl && z > zl + 0.005) { pen++; if (z - zl > worstPen) worstPen = z - zl; }
    if (zl === zl && zl - z > 1.2) continue;
    v.set(x, y, z); ob.closestPointToPoint(v, hit, 0, 1.2); if (!(hit.distance < 1.2)) continue; if (hit.distance < minD) minD = hit.distance;
    if (hit.distance <= 0.1) { near++; const key = Math.floor(x / 4) * 100 + Math.floor(y / 4); const e = cl.get(key) || [0, 0, 0, Infinity]; e[0] += x; e[1] += y; e[2]++; e[3] = Math.min(e[3], hit.distance); cl.set(key, e); } }
  const contacts = [...cl.values()].map((e) => [e[0] / e[2], e[1] / e[2], e[3]]);
  const xs = contacts.map((q) => q[0]), ys = contacts.map((q) => q[1]);
  return { oppMinDist: minD, penetrating: pen, worstPen, contactVerts: near, contactPatches: contacts.length, spreadX: contacts.length ? Math.max(...xs) - Math.min(...xs) : 0, spreadY: contacts.length ? Math.max(...ys) - Math.min(...ys) : 0, left: contacts.filter((q) => q[0] > 5).length, right: contacts.filter((q) => q[0] < -5).length, front: contacts.filter((q) => Math.abs(q[0]) <= 12 && q[1] < -12).length };
}
