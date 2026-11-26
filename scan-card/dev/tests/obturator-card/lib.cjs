// helpers shared by the Obturator Card tests (synthetic data from mkobt.mjs only)
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs');
const DATA = '/home/claude/suite/dev/data/', OUT = '/home/claude/suite/dev/out/obturator-card/';
fs.mkdirSync(OUT, { recursive: true });
const TRUTH = JSON.parse(fs.readFileSync(DATA + 'obt-truth.json'));
TRUTH.zm = TRUTH.rim.reduce((s, p) => s + p[2], 0) / TRUTH.rim.length;           // the margin's mean level (case z; the scans are used in their own coordinates)
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) { fails++; process.exitCode = 1; } };
/** page-side helpers: BVHs, shells, signed distance to the scan, rays along the path */
const HELP = `window.TH = (() => {
  const THREE = APP.THREE, N = APP.N;
  const bvhOf = (m) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(m.indices), 1)); return new N.MeshBVH(g); };
  const shells = (m) => N.splitParts(m).map((p) => ({ mesh: p, vol: N.meshVolume(p) })).sort((a, b) => b.vol - a.vol);
  const q = (arr, f) => { if (!arr.length) return NaN; const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.floor(f * (s.length - 1))))]; };
  const sdScan = (x, y, z) => APP.realSd(APP.realSurf(), new THREE.Vector3(x, y, z), {});
  let SB = null; const scanBvh = () => SB || (SB = bvhOf(APP.scans.framed('upper')));
  /** rays from each vertex along dir (the way out), started 0.05 mm off it: those that meet the scan more than 0.3 mm on are caught in an undercut */
  /* (each ray starts 0.06 mm inside the solid, off its surface, so a point lying on a tooth at a grazing angle is not counted as caught) */
  const rayHits = (m, dir, keep) => { const b = scanBvh(), ray = new THREE.Ray(), D = new THREE.Vector3(...dir).normalize(), P = m.positions, Nm = N.vertexNormals(m), hits = []; let n = 0;
    for (let v = 0; v < P.length / 3; v++) { if (keep && !keep(P[3 * v], P[3 * v + 1], P[3 * v + 2])) continue; n++; ray.origin.set(P[3 * v] - 0.06 * Nm[3 * v], P[3 * v + 1] - 0.06 * Nm[3 * v + 1], P[3 * v + 2] - 0.06 * Nm[3 * v + 2]).addScaledVector(D, 0.05); ray.direction.copy(D); const h = b.raycastFirst(ray, THREE.DoubleSide); if (h && h.distance > 0.3 && h.distance < 40) hits.push([P[3 * v], P[3 * v + 1], P[3 * v + 2]].map((x) => +x.toFixed(2))); }
    return { n, hits: hits.length, first: hits.slice(0, 4) }; };
  /** the closest any of these points (e.g. a tooth's surface) comes to a closed mesh, signed (− inside it) */
  const insideDepth = (mesh, pts) => { const b = bvhOf(mesh), hit = {}, v3 = new THREE.Vector3(), P = mesh.positions, I = b.geometry.index.array; let worst = Infinity, n = 0;
    for (const p of pts) { v3.set(p[0], p[1], p[2]); if (!b.closestPointToPoint(v3, hit, 0, 1.5)) continue; n++; const f = 3 * hit.faceIndex, a = 3 * I[f], c1 = 3 * I[f + 1], c2 = 3 * I[f + 2];
      const ux = P[c1] - P[a], uy = P[c1 + 1] - P[a + 1], uz = P[c1 + 2] - P[a + 2], wx = P[c2] - P[a], wy = P[c2 + 1] - P[a + 1], wz = P[c2 + 2] - P[a + 2], nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const s = ((v3.x - hit.point.x) * nx + (v3.y - hit.point.y) * ny + (v3.z - hit.point.z) * nz) >= 0 ? hit.distance : -hit.distance; if (s < worst) worst = s; }
    return { n, worst }; };
  const polyDist = (poly, x, y) => { let best = Infinity, inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j], ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey || 1e-12, t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / L2)); best = Math.min(best, Math.hypot(x - a[0] - t * ex, y - a[1] - t * ey)); if ((a[1] > y) !== (b[1] > y) && x < ex * (y - a[1]) / ey + a[0]) inside = !inside; } return inside ? -best : best; };
  return { THREE, N, bvhOf, shells, q, sdScan, scanBvh, rayHits, polyDist, insideDepth };
})();`;
/** open Obturator Card on its own with these scans, in the scanner's own position (so the case frame is the files' frame) */
async function start(files, o = {}) {
  const a = await openApp('obturator-card', { width: 1400, height: 900, ...o });
  a.idle = async () => { await a.page.waitForTimeout(150); await a.page.waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 900000 }); };
  await a.page.waitForFunction(() => window.APP);
  await a.page.setInputFiles('input[data-ss=file]', files); await a.idle();
  await a.page.evaluate(() => APP.shell.goto('orient')); await a.page.click('[data-so=raw]'); await a.idle();
  await a.page.evaluate(HELP);
  return a;
}
/** set the design (P fields), make it, and return its report */
async function build(a, set = {}) {
  await a.page.evaluate((set) => { Object.assign(APP.P, set); APP.paramsToUI(); APP.shell.goto('design'); }, set); await a.idle();
  await a.page.click('#dBuild'); await a.idle(); await a.page.waitForTimeout(200);
  return a.page.evaluate(() => APP.B && APP.B.info);
}
module.exports = { start, build, ok, TRUTH, DATA, OUT, HELP, failed: () => fails };
