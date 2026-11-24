// Are any appliance vertices inside the tooth? Robust test: close the scan into a solid (scan triangles untouched) and count ray crossings.
import * as N from '../../../shared/core.js';
import * as S from '../../../shared/solid.js';
import fs from 'fs';
const T = N.THREE; await S.ready();
const rd = (f) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
for (const name of process.argv.slice(2)) {
  const dc = await N.DentalCase.fromBlob(new Blob([rd(`/home/claude/suite/dev/out/suite/splint-${name}.zip`)])), sp = dc.get('splint'), P = dc.data.splint.params || dc.data.splint.P || dc.data.splint, jaw = P.jaw || sp.meta.jaw;
  const flip = jaw === 'upper' ? N.rotationAbout('y', 180) : new T.Matrix4(), A = N.transformMesh(dc.framed(jaw + '-scan'), flip), X = N.transformMesh(dc.framed(sp), flip);
  const solid = S.scanToSolid(A, { baseZ: N.meshBounds(A).min[2] - 6 }).mesh, bvh = N.toGeometry({ positions: solid.positions, indices: solid.indices.slice() }).boundsTree;
  const dirs = [new T.Vector3(0.137, 0.291, 0.947).normalize(), new T.Vector3(-0.31, 0.12, 0.943).normalize(), new T.Vector3(0.05, -0.22, 0.974).normalize()], ray = new T.Ray(), PX = X.positions, o = {}, p = new T.Vector3();
  let inside = 0, deepest = 0; const where = [];
  for (let i = 0; i < PX.length; i += 3) { p.set(PX[i], PX[i + 1], PX[i + 2]); let votes = 0; for (const d of dirs) { ray.origin.copy(p); ray.direction.copy(d); if (bvh.raycast(ray, T.DoubleSide).length % 2 === 1) votes++; } if (votes >= 2) { bvh.closestPointToPoint(p, o); if (o.distance > 0.005) { inside++; if (o.distance > deepest) deepest = o.distance; if (where.length < 5) where.push(`${PX[i].toFixed(1)},${PX[i + 1].toFixed(1)},${PX[i + 2].toFixed(1)} (${o.distance.toFixed(3)} mm in)`); } } }
  // and the reverse: volume shared by the appliance and the tooth solid
  const mA = S.toManifold(solid), mX = S.toManifold(N.weld(X.positions, X.indices)), both = mA.intersect(mX);
  console.log(`${name}: ${inside} of ${PX.length / 3} appliance vertices inside the tooth solid${inside ? ', deepest ' + deepest.toFixed(3) + ' mm: ' + where.join(' ; ') : ''}; volume shared with the teeth ${both.volume().toFixed(4)} mm³`);
  S.free(mA, mX, both);
}
