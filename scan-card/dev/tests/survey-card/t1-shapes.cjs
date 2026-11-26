// Survey Card on shapes where the answer is exact: an ellipsoid of revolution (a = 4 mm across, c = 5 mm tall, centre 3 mm up)
// standing in a flat plane (z = 0). Along the occlusal axis its height of contour is the equator (z = 3); below it the undercut
// depth at height z is a − a·√(1 − ((z − 3)/c)²), so the 0.25 / 0.5 / 0.75 mm gauges touch 1.740 / 2.421 / 2.915 mm below the
// survey line. Tilted by α (front up), the contour is the plane z − 3 = y·tan α·c²/a² through the centre.
// Checked: survey line height, undercut depth everywhere below it, the gauge heights from the tooth summary, the block-out
// (closed, nothing facing away from the path, contains the original, wall straight down from the contour), the tilted survey
// line, and the same shape as an upper arch (teeth pointing down).
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
let bad = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) { bad++; process.exitCode = 1; } };
(async () => {
  const { page, errors, close } = await openApp('survey-card', { width: 1200, height: 800 });
  await page.waitForFunction(() => window.APP);
  await page.evaluate(() => {
    const N = APP.N, THREE = APP.THREE;
    window.SHAPE = (o = {}) => {                                  // ellipsoid above the plane + the plane out to 12 mm, triangles facing out
      const a = 4, c = 5, zc = 3, M = 360, K = 120, phi0 = Math.acos(-zc / c), P = [0, 0, zc + c], I = [], ring = [];
      for (let k = 1; k <= K; k++) { const ph = phi0 * k / K, r = [], s = Math.sin(ph); for (let m = 0; m < M; m++) { const t = 2 * Math.PI * m / M; r.push(P.length / 3); P.push(a * s * Math.cos(t), a * s * Math.sin(t), k === K ? 0 : zc + c * Math.cos(ph)); } ring.push(r); }
      let rr = a * Math.sin(phi0), step = 0.08; while (rr < 12) { rr += step; step = Math.min(0.5, step * 1.06); const r = []; for (let m = 0; m < M; m++) { const t = 2 * Math.PI * m / M; r.push(P.length / 3); P.push(rr * Math.cos(t), rr * Math.sin(t), 0); } ring.push(r); }
      for (let m = 0; m < M; m++) I.push(0, ring[0][m], ring[0][(m + 1) % M]);
      for (let k = 0; k + 1 < ring.length; k++) for (let m = 0; m < M; m++) { const A = ring[k][m], B = ring[k + 1][m], C = ring[k + 1][(m + 1) % M], D = ring[k][(m + 1) % M]; I.push(A, B, C, A, C, D); }
      let mesh = { positions: Float32Array.from(P), indices: Uint32Array.from(I), colors: null };
      if (o.upper) mesh = N.transformMesh(mesh, new THREE.Matrix4().makeScale(1, 1, -1));
      return mesh;
    };
    window.TRUE_DEPTH = (r, z) => (z >= 3 ? 0 : 4 - 4 * Math.sqrt(1 - ((z - 3) / 5) ** 2));
  });
  const G = { 0.25: 3 - 1.26, 0.5: 3 - 0.5794, 0.75: 3 - 0.0852 };
  for (const g of [0.25, 0.5, 0.75]) G[g] = 3 - (3 - 5 * Math.sqrt(1 - (1 - g / 4) ** 2));

  // ── 1. along the occlusal axis
  const r1 = await page.evaluate(() => {
    const mesh = SHAPE(), S = APP.computeSurvey(mesh, APP.dirOf('lower', 0, 0), { jaw: 'lower' }), P = mesh.positions, nV = P.length / 3;
    let zs = [], err = [], above = 0, n = 0; for (let i = 2; i < S.seg.length; i += 3) zs.push(S.seg[i]);
    for (let v = 0; v < nV; v++) { const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2], r = Math.hypot(x, y); if (z <= 0.001 || r > 4.01) continue; n++; if (z > 3.02 && S.depth[v] > 0.02) above++; if (z < 2.98) err.push(S.depth[v] - TRUE_DEPTH(r, z)); }
    const ae = err.map(Math.abs).sort((a, b) => a - b);
    const R = APP.toothRegion(S, [0, 0, 8]), sum = R && APP.toothSummary(S, R), g = {}; if (sum) for (const k of ['buccal', 'lingual']) g[k] = sum[k].g.map((x) => x && x.below);
    let inR = 0; if (R) for (let v = 0; v < nV; v++) if (R.mask[v] && Math.hypot(P[3 * v], P[3 * v + 1]) < 4.05) inR++;
    let onBody = 0; for (let v = 0; v < nV; v++) if (Math.hypot(P[3 * v], P[3 * v + 1]) < 4.05) onBody++;
    return { tris: mesh.indices.length / 3, time: S.time, nSeg: S.seg.length / 6, zMin: Math.min(...zs), zMax: Math.max(...zs), zMean: zs.reduce((a, b) => a + b, 0) / zs.length, above, n, med: ae[ae.length >> 1], p99: ae[Math.floor(ae.length * 0.99)], max: ae[ae.length - 1], bias: err.reduce((a, b) => a + b, 0) / err.length, deep: Math.max(...Array.from(S.depth).filter(Number.isFinite)), g, inR, onBody, read: (() => { const q = APP.THREE; const p = new q.Vector3(4 * Math.sqrt(1 - (1.74 / 5) ** 2), 0, 1.26), h = S.heightBelow(p.x, p.y, p.z); return h; })() };
  });
  console.log(`   ${r1.tris} triangles surveyed in ${r1.time.toFixed(0)} ms; ${r1.nSeg} survey line pieces`);
  ok(Math.abs(r1.zMean - 3) < 0.02 && r1.zMin > 2.95 && r1.zMax < 3.05, `survey line at the equator: z ${r1.zMin.toFixed(3)} – ${r1.zMax.toFixed(3)} (mean ${r1.zMean.toFixed(3)}; exact 3.000)`);
  ok(r1.above === 0, `no undercut above the survey line (${r1.above} of ${r1.n} body points)`);
  ok(r1.med < 0.01 && r1.p99 < 0.03 && r1.max < 0.04 && Math.abs(r1.bias) < 0.01, `undercut depth below it against a − r(z): median error ${r1.med.toFixed(4)} mm, 99th centile ${r1.p99.toFixed(4)}, worst ${r1.max.toFixed(4)}, mean bias ${r1.bias.toFixed(4)} mm`);
  ok(Math.abs(r1.deep - 0.8) < 0.04, `deepest undercut ${r1.deep.toFixed(3)} mm where the body meets the plane (exact 0.800)`);
  ok(Math.abs(r1.read.depth - 0.25) < 0.03 && Math.abs(r1.read.below - G[0.25]) < 0.03, `reading at the 0.25 mm gauge height: ${r1.read.depth.toFixed(3)} mm undercut, ${r1.read.below.toFixed(3)} mm below the survey line (exact 0.250, ${G[0.25].toFixed(3)})`);
  ok(r1.inR === r1.onBody, `the tapped “tooth” takes in the whole body (${r1.inR} of ${r1.onBody} points)`);
  const sides = Object.entries(r1.g), gOk = sides.length === 2 && sides.every(([, v]) => v.every((x, i) => x != null && Math.abs(x - G[[0.25, 0.5, 0.75][i]]) < 0.06));
  ok(gOk, `the tooth summary has the gauges touching below the survey line, buccally and lingually, at ${sides.map(([k, v]) => k[0].toUpperCase() + ' ' + v.map((x) => (x == null ? '–' : x.toFixed(3))).join('/')).join(', ')} (exact ${G[0.25].toFixed(3)} / ${G[0.5].toFixed(3)} / ${G[0.75].toFixed(3)})`);

  // ── 2. the block-out along the occlusal axis
  const b1 = await page.evaluate(() => {
    const THREE = APP.THREE, N = APP.N, mesh = SHAPE(), S = APP.computeSurvey(mesh, APP.dirOf('lower', 0, 0), { jaw: 'lower' }), r = APP.blockOut(S), m = r.meshD, Pm = m.positions, Im = m.indices;
    let away = 0, worst = 1; for (let f = 0; f < Im.length; f += 3) { const a = Im[f] * 3, b = Im[f + 1] * 3, c = Im[f + 2] * 3; if (Pm[a + 2] <= r.baseZ + 1e-4 && Pm[b + 2] <= r.baseZ + 1e-4 && Pm[c + 2] <= r.baseZ + 1e-4) continue; const ux = Pm[b] - Pm[a], uy = Pm[b + 1] - Pm[a + 1], uz = Pm[b + 2] - Pm[a + 2], vx = Pm[c] - Pm[a], vy = Pm[c + 1] - Pm[a + 1], vz = Pm[c + 2] - Pm[a + 2], nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz); if (l < 1e-9) continue; const t = nz / l; if (t < worst) worst = t; if (t < -0.02) away++; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(Pm, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(Im), 1)); const bvh = new N.MeshBVH(g), hit = {}, q = new THREE.Vector3();
    // inside or outside the closed block-out: ray parity (three directions, majority), for every original point not on its surface
    const dirs = [new THREE.Vector3(0.3, 0.5, 0.81).normalize(), new THREE.Vector3(-0.6, 0.2, 0.77).normalize(), new THREE.Vector3(0.1, -0.7, 0.7).normalize()], pr = new THREE.Ray();
    const inside = (p) => { let n = 0; for (const d of dirs) { pr.origin.copy(p); pr.direction.copy(d); if (bvh.raycast(pr, THREE.DoubleSide).length % 2 === 1) n++; } return n >= 2; };
    let outside = 0, worstOut = 0; const P = S.Pd;
    for (let v = 0; v < P.length / 3; v++) { q.set(P[3 * v], P[3 * v + 1], P[3 * v + 2]); bvh.closestPointToPoint(q, hit); if (hit.distance < 0.002) continue; if (!inside(q)) { outside++; worstOut = Math.max(worstOut, hit.distance); } }
    // the wall: straight down from the contour (radius a = 4) — rays in from outside at three heights, eight directions
    const wall = [], ray = new THREE.Ray(); for (const z of [0.5, 1.5, 2.5]) for (let k = 0; k < 8; k++) { const t = k * Math.PI / 4; ray.origin.set(9 * Math.cos(t), 9 * Math.sin(t), z); ray.direction.set(-Math.cos(t), -Math.sin(t), 0); const h = bvh.raycastFirst(ray, THREE.DoubleSide); wall.push(h ? 9 - h.distance : NaN); }
    // above the contour it is the ellipsoid itself
    const top = []; for (const r0 of [0, 2, 3.5]) { ray.origin.set(r0, 0, 20); ray.direction.set(0, 0, -1); const h = bvh.raycastFirst(ray, THREE.DoubleSide); top.push([r0, h ? 20 - h.distance : NaN, 3 + 5 * Math.sqrt(1 - (r0 / 4) ** 2)]); }
    return { wt: r.watertight, tris: r.tris, time: r.time, away, worst, outside, worstOut, wall, top, vol: N.meshVolume(m), n: P.length / 3 };
  });
  console.log(`   block-out: ${b1.tris} triangles in ${b1.time.toFixed(0)} ms`);
  ok(b1.wt && b1.vol > 0, `blocked-out model is a closed solid (watertight, volume ${(b1.vol / 1000).toFixed(2)} mL)`);
  ok(b1.away === 0, `no face of it (above the flat base) faces away from the path: steepest n·d ${b1.worst.toFixed(4)}`);
  ok(b1.worstOut < 0.03, `it contains the original surface to within 0.03 mm: ${b1.outside} of ${b1.n} points lie outside it, by at most ${b1.worstOut.toFixed(4)} mm`);
  const wr = b1.wall.filter(Number.isFinite); ok(wr.length === 24 && wr.every((r) => Math.abs(r - 4) < 0.06), `below the contour the block-out wall stands at the widest radius: ${Math.min(...wr).toFixed(3)} – ${Math.max(...wr).toFixed(3)} mm (exact 4.000) at heights 0.5, 1.5, 2.5 mm`);
  ok(b1.top.every(([, z, t]) => z >= t - 0.01 && z - t < 0.06), 'above the contour it follows the body (never below it, at most 0.06 mm above): ' + b1.top.map(([r, z, t]) => `r ${r}: ${z.toFixed(3)} (${t.toFixed(3)})`).join(', '));

  // ── 3. tilted: 10° front up, then 8° patient's left up
  for (const [ap, lat] of [[10, 0], [0, 8], [-6, -5]]) {
    const t = await page.evaluate(([ap, lat]) => {
      const mesh = SHAPE(), d = APP.dirOf('lower', ap, lat), S = APP.computeSurvey(mesh, d, { jaw: 'lower' }), sg = S.seg; let res = [], front = null, back = null;
      // the contour of an ellipsoid along d is the plane through its centre  (x·dx + y·dy)/a² + (z − zc)·dz/c² = 0
      for (let i = 0; i < sg.length; i += 3) { const x = sg[i], y = sg[i + 1], z = sg[i + 2], f = (x * d.x + y * d.y) / 16 + (z - 3) * d.z / 25, g = Math.hypot(d.x / 16, d.y / 16, d.z / 25); res.push(Math.abs(f / g)); if (Math.abs(x) < 0.15) { if (y < 0 && (!front || y < front[0])) front = [y, z]; if (y > 0 && (!back || y > back[0])) back = [y, z]; } }
      res.sort((a, b) => a - b);
      const r = APP.blockOut(S), m = r.meshD, Pm = m.positions, Im = m.indices; let away = 0;
      for (let f = 0; f < Im.length; f += 3) { const a = Im[f] * 3, b = Im[f + 1] * 3, c = Im[f + 2] * 3; if (Pm[a + 2] <= r.baseZ + 1e-4 && Pm[b + 2] <= r.baseZ + 1e-4 && Pm[c + 2] <= r.baseZ + 1e-4) continue; const ux = Pm[b] - Pm[a], uy = Pm[b + 1] - Pm[a + 1], uz = Pm[b + 2] - Pm[a + 2], vx = Pm[c] - Pm[a], vy = Pm[c + 1] - Pm[a + 1], vz = Pm[c + 2] - Pm[a + 2], nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz); if (l > 1e-9 && nz / l < -0.02) away++; }
      return { med: res[res.length >> 1], max: res[res.length - 1], n: res.length, front, back, away, wt: r.watertight };
    }, [ap, lat]);
    const want = ap ? (() => { const a = 4, c = 5, ta = Math.tan(ap * Math.PI / 180), y = 1 / Math.sqrt(1 / a ** 2 + ta ** 2 * c ** 2 / a ** 4); return [3 - y * ta * c * c / a / a, 3 + y * ta * c * c / a / a]; })() : null;
    ok(t.max < 0.05 && t.med < 0.015, `${ap ? `front ${ap > 0 ? 'up' : 'down'} ${Math.abs(ap)}°` : ''}${ap && lat ? ', ' : ''}${lat ? `${lat > 0 ? 'left' : 'right'} up ${Math.abs(lat)}°` : ''}: the survey line lies on the tilted contour plane (median ${t.med.toFixed(4)} mm off it, worst ${t.max.toFixed(4)}, ${t.n} points)`);
    if (want && ap === 10) ok(Math.abs(t.front[1] - want[0]) < 0.06 && Math.abs(t.back[1] - want[1]) < 0.06, `  …it drops to z ${t.front[1].toFixed(3)} at the front and rises to ${t.back[1].toFixed(3)} at the back (exact ${want[0].toFixed(3)} and ${want[1].toFixed(3)})`);
    ok(t.wt && t.away === 0, '  …and the block-out along that path is closed with nothing facing away from it');
  }

  // ── 4. a clasp tip: 0.25 mm of undercut kept on the buccal half; the lingual half fully blocked out
  const k = await page.evaluate(async () => {
    const THREE = APP.THREE, N = APP.N, mesh = SHAPE(), S = APP.computeSurvey(mesh, APP.dirOf('lower', 0, 0), { jaw: 'lower' }), R = APP.toothRegion(S, [0, 0, 8]), t0 = performance.now();
    const r = await APP.blockOutKeep(S, [{ R, side: 'buccal', g: 0.25 }]), m = r.meshD, g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(m.indices), 1));
    const bvh = new N.MeshBVH(g), ray = new THREE.Ray(), at = (bx, by, z) => { ray.origin.set(9 * bx, 9 * by, z); ray.direction.set(-bx, -by, 0); const h = bvh.raycastFirst(ray, THREE.DoubleSide); return h ? 9 - h.distance : NaN; };
    const b = R.b, out = { ms: performance.now() - t0, wt: r.watertight, kept: r.kept, b };
    out.B = {}; out.L = {}; for (const z of [2.5, 2.0, 0.8, 0.4]) { out.B[z] = at(b[0], b[1], z); out.L[z] = at(-b[0], -b[1], z); }
    let minZ = Infinity; for (let i = 2; i < m.positions.length; i += 3) minZ = Math.min(minZ, m.positions[i]); out.flat = Math.abs(minZ - r.baseZ) < 1e-3;
    return out;
  });
  const orig = (z) => 4 * Math.sqrt(1 - ((z - 3) / 5) ** 2);
  console.log(`   clasp-tip block-out in ${k.ms.toFixed(0)} ms`);
  ok(k.wt && k.kept.length === 1 && k.kept[0].ok && k.flat, 'block-out keeping 0.25 mm buccally is a closed solid with a flat base');
  ok(Math.abs(k.B['2.5'] - orig(2.5)) < 0.03 && Math.abs(k.B['2'] - orig(2)) < 0.03, `buccally, between the survey line and the 0.25 mm line it is the tooth itself: r ${k.B['2.5'].toFixed(3)} at z 2.5, ${k.B['2'].toFixed(3)} at z 2.0 (tooth ${orig(2.5).toFixed(3)}, ${orig(2).toFixed(3)}; undercut kept ${(4 - k.B['2.5']).toFixed(3)}, ${(4 - k.B['2']).toFixed(3)} mm)`);
  ok(Math.abs(k.B['0.8'] - 3.75) < 0.06 && Math.abs(k.B['0.4'] - 3.75) < 0.06, `below the 0.25 mm line it is blocked out 0.25 mm inside the rod's line: r ${k.B['0.8'].toFixed(3)} at z 0.8, ${k.B['0.4'].toFixed(3)} at z 0.4 (3.750)`);
  ok([k.L['2.5'], k.L['2'], k.L['0.8'], k.L['0.4']].every((r) => Math.abs(r - 4) < 0.06), `lingually it is fully blocked out: r ${[k.L['2.5'], k.L['2'], k.L['0.8'], k.L['0.4']].map((r) => r.toFixed(3)).join(', ')} (4.000)`);

  // ── 5. the same shape as an upper arch (pointing down): the same answers, mirrored
  const u = await page.evaluate(() => {
    const mesh = SHAPE({ upper: true }), S = APP.computeSurvey(mesh, APP.dirOf('upper', 0, 0), { jaw: 'upper' }), P = mesh.positions; let zs = []; for (let i = 2; i < S.seg.length; i += 3) zs.push(S.seg[i]);
    let err = 0; for (let v = 0; v < P.length / 3; v++) { const r = Math.hypot(P[3 * v], P[3 * v + 1]), z = -P[3 * v + 2]; if (z <= 0.001 || r > 4.01 || z > 2.98) continue; err = Math.max(err, Math.abs(S.depth[v] - TRUE_DEPTH(r, z))); }
    const r = APP.blockOut(S); return { zMin: Math.min(...zs), zMax: Math.max(...zs), err, wt: r.watertight, flip: S.flip };
  });
  ok(u.zMin > -3.05 && u.zMax < -2.95 && u.err < 0.04 && u.wt, `as an upper (pointing down): survey line at z ${u.zMin.toFixed(3)} – ${u.zMax.toFixed(3)} (exact −3), worst depth error ${u.err.toFixed(4)} mm, block-out closed`);
  ok(errors.length === 0, 'no page errors ' + errors.slice(0, 3).join(' | '));
  await close(); console.log(bad ? bad + ' FAILED' : 'all passed');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
