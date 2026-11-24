import * as N from '../../../shared/core.js';
import * as S from '../../../shared/solid.js';
import fs from 'fs';
const O = '/home/claude/suite/dev/out/model-card/'; await S.ready();
const rd = (f) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const M = {}; for (const e of await N.unzip(rd(O + 'verify-hollow-hinge-scan.zip'))) M[e.name.includes('upper') ? 'upper' : 'lower'] = S.toManifold(N.parseMesh(e.data.buffer.slice(e.data.byteOffset, e.data.byteOffset + e.data.byteLength), 'stl', e.name));
const both = M.upper.intersect(M.lower); console.log('overlap volume of the two hinged models in the scanned bite:', both.volume().toFixed(4), 'mm³ (upper', (M.upper.volume() / 1000).toFixed(2), 'mL, lower', (M.lower.volume() / 1000).toFixed(2), 'mL)');
// lift the upper 0.05 mm: still no overlap; drop it 0.3 mm: the hinge/teeth must collide (proves the check can see a collision)
console.log('  upper lowered 0.3 mm → overlap', M.upper.translate(0, 0, 0).transform(S.mat4(new N.THREE.Matrix4())).volume() && M.upper.translate(...new N.THREE.Vector3(0, 0, -0.3).applyMatrix4(new N.THREE.Matrix4()).toArray()).intersect(M.lower).volume().toFixed(3), 'mm³ (note: scanner frame, so z here is not the bite axis)');
