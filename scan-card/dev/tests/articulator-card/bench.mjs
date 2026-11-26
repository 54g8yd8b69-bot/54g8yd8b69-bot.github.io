// scratch benchmark: how fast are the collision queries on the demo pair?
import * as N from '../../../shared/core.js';
const THREE = N.THREE;
const d = N.makeDemoPair({ res: 0.3 });
const geo = (m) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(m.indices), 1)); g.boundsTree = new N.MeshBVH(g); return g; };
const gu = geo(d.upper), gl = geo(d.lower);
for (const dz of [0.2, 0.3, 0.4, 0.5, 0.7, 1, 2]) { const M = new THREE.Matrix4().makeTranslation(0, 0, dz); const t = performance.now(); const r = gu.boundsTree.intersectsGeometry(gl, M); console.log('dz', dz, r, (performance.now() - t).toFixed(1), 'ms'); }
{ const t = performance.now(); const a = {}, b = {}; gu.boundsTree.closestPointToGeometry(gl, new THREE.Matrix4(), a, b); console.log('closestPointToGeometry', a.distance, a.point, (performance.now() - t).toFixed(0), 'ms'); }
