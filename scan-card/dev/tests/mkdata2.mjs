import * as N from '../../shared/core.js';
import fs from 'fs';
const D = '/home/claude/suite/dev/data/';
const m = N.makeDemoArch({ jaw: 'lower', res: 0.3 }).mesh;
// colour PLY: gum pink below, teeth ivory above (linear RGB, as the loaders deliver it)
{ const C = new Float32Array(m.positions.length); for (let i = 0; i < C.length; i += 3) { const z = m.positions[i + 2], t = Math.min(1, Math.max(0, (z + 8) / 3)); C[i] = 0.55 + 0.35 * t; C[i + 1] = 0.18 + 0.62 * t; C[i + 2] = 0.2 + 0.5 * t; }
  fs.writeFileSync(D + 'colour-lower.ply', Buffer.from(N.plyBinary({ ...m, colors: C }))); }
// OBJ
{ const P = m.positions, I = m.indices, L = []; for (let i = 0; i < P.length; i += 3) L.push(`v ${P[i].toFixed(4)} ${P[i + 1].toFixed(4)} ${P[i + 2].toFixed(4)}`); for (let t = 0; t < I.length; t += 3) L.push(`f ${I[t] + 1} ${I[t + 1] + 1} ${I[t + 2] + 1}`); fs.writeFileSync(D + 'plain-lower.obj', L.join('\n')); }
// metres STL
fs.writeFileSync(D + 'metres-lower.stl', Buffer.from(N.stlBinary({ ...m, positions: m.positions.map(v => v / 1000) })));
// ASCII STL of a small part
{ const P = m.positions, I = m.indices, L = ['solid part']; let n = 0; for (let t = 0; t < I.length && n < 30000; t += 3) { if (P[3 * I[t]] < 8) continue; n++; L.push('facet normal 0 0 1', ' outer loop'); for (let k = 0; k < 3; k++) L.push(`  vertex ${P[3 * I[t + k]].toFixed(5)} ${P[3 * I[t + k] + 1].toFixed(5)} ${P[3 * I[t + k] + 2].toFixed(5)}`); L.push(' endloop', 'endfacet'); } L.push('endsolid part'); fs.writeFileSync(D + 'ascii-part.stl', L.join('\n')); }
console.log('ok');
