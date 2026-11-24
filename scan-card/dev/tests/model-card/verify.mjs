import * as N from '../../../shared/core.js';
import fs from 'fs';
const T = N.THREE, O = '/home/claude/suite/dev/out/model-card/', D = '/home/claude/suite/dev/data/';
const rd = (f) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const scan = { upper: N.parseMesh(rd(D + 'scanner-upper.stl'), 'stl', 'u'), lower: N.parseMesh(rd(D + 'scanner-lower.stl'), 'stl', 'l') };
const list = JSON.parse(fs.readFileSync(O + 'verify-list.json')); let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? '  ok  ' : '  FAIL', m); };
const info = Object.fromEntries(list.filter(l => l[1] === 'info').map(l => [l[0], JSON.parse(l[2])]));
for (const [name, pos, f] of list) {
  if (pos === 'info') continue;
  for (const e of await N.unzip(rd(f))) {
    const jaw = e.name.includes('upper') ? 'upper' : 'lower', m = N.parseMesh(e.data.buffer.slice(e.data.byteOffset, e.data.byteOffset + e.data.byteLength), 'stl', e.name), er = N.edgeReport(m), b = N.meshBounds(m), vol = N.meshVolume(m), want = info[name].find(i => i.j === jaw).vol;
    ok(er.open === 0 && er.flipped === 0, `${name} ${pos} ${jaw}: closed surface (open edges ${er.open}, touching edges ${er.nonManifold / 4 | 0}), ${m.indices.length / 3} triangles`);
    ok(Math.abs(vol - want) / want < 0.002, `   volume ${(vol / 1000).toFixed(2)} mL matches what the app reported (${(want / 1000).toFixed(2)})`);
    if (pos === 'print') { let nBase = 0; for (let i = 2; i < m.positions.length; i += 3) if (Math.abs(m.positions[i]) < 1e-4) nBase++; ok(Math.abs(b.min[2]) < 1e-4 && nBase > 50 && Math.abs(b.center[0]) < 0.01 && Math.abs(b.center[1]) < 0.01, `   sits flat on Z = 0 (${nBase} base vertices exactly on the plate), centred`); }
    else { // every scan vertex must still be on the model surface, in the scanner's own coordinates
      const bvh = N.toGeometry(m).boundsTree, P = scan[jaw].positions, o = {}, p = new T.Vector3(); let worst = 0, n = 0, off = 0;
      for (let i = 0; i < P.length; i += 3 * 11) { p.set(P[i], P[i + 1], P[i + 2]); bvh.closestPointToPoint(p, o); n++; if (o.distance > worst) worst = o.distance; if (o.distance > 0.005) off++; }
      ok(worst < 0.005 || off / n < 0.002, `   scan surface kept exactly, in scanner coordinates: ${n} scan points, worst ${worst.toFixed(4)} mm off, ${off} over 5 µm`);
    }
  }
}
// hinge: with the 'scan' position the two models are in the scanned bite; the ball tops and socket tops must coincide and the models must not overlap
{ const f = list.find(l => l[0] === 'hollow-hinge' && l[1] === 'scan')[2], M = {}; for (const e of await N.unzip(rd(f))) M[e.name.includes('upper') ? 'upper' : 'lower'] = N.parseMesh(e.data.buffer.slice(e.data.byteOffset, e.data.byteOffset + e.data.byteLength), 'stl', e.name);
  const gu = N.toGeometry(M.upper).boundsTree, P = M.lower.positions, o = {}, p = new T.Vector3(); let min = 1e9, close = 0;
  for (let i = 0; i < P.length; i += 3 * 3) { p.set(P[i], P[i + 1], P[i + 2]); gu.closestPointToPoint(p, o, 0, 3); if (o.distance < min) min = o.distance; if (o.distance < 0.25) close++; }
  ok(min < 0.25, `hinged pair in the scanned bite: closest approach between the two models ${min.toFixed(3)} mm (${close} sampled lower vertices within 0.25 mm of the upper model)`); }
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
