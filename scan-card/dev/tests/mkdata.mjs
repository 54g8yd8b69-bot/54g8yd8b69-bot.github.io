// Test data: demo arches as a scanner would export them (tilted, shifted), plus awkward variants.
import * as N from '../../shared/core.js';
import fs from 'fs';
const out = (n, m) => fs.writeFileSync('/home/claude/suite/dev/data/' + n, Buffer.from(N.stlBinary(m)));
const d = N.makeDemoPair({ res: 0.3, scannerFrame: true });
out('scanner-upper.stl', d.upper); out('scanner-lower.stl', d.lower);
fs.writeFileSync('/home/claude/suite/dev/data/scanner-truth.json', JSON.stringify({ matrix: d.matrix.toArray(), truth: d.truth }));
const h = N.makeDemoPair({ res: 0.3, missing: { 12: 5.5, 22: 5.5 }, spacing: 0.4 });
out('hypodontia-upper.stl', h.upper); out('hypodontia-lower.stl', h.lower);
fs.writeFileSync('/home/claude/suite/dev/data/hypodontia-truth.json', JSON.stringify({ truth: h.truth }));
// a "dirty" lower: floating bits, a patch of flipped triangles, a few punched holes
{ const m = N.makeDemoArch({ jaw: 'lower', res: 0.3 }).mesh; const P = Array.from(m.positions), I = Array.from(m.indices), nV = P.length / 3;
  const keep = []; for (let f = 0; f < I.length / 3; f++) { const c = [0, 1, 2].map(k => P[3 * I[3 * f] + k]); const hole = Math.hypot(c[0] - 21, c[1] - 5, c[2] + 3) < 1.6 || Math.hypot(c[0] + 12, c[1] + 16, c[2] + 4) < 1.2; if (!hole) keep.push(I[3 * f], I[3 * f + 1], I[3 * f + 2]); }
  for (let f = 2000; f < 2600; f++) { const s = keep[3 * f + 1]; keep[3 * f + 1] = keep[3 * f + 2]; keep[3 * f + 2] = s; }
  for (let b = 0; b < 4; b++) { const o = P.length / 3, x = 30 + 3 * b, y = -20 + 2 * b, z = 4; P.push(x, y, z, x + 1.5, y, z, x, y + 1.5, z, x, y, z + 1.5); keep.push(o, o + 1, o + 2, o, o + 3, o + 1, o, o + 2, o + 3); }
  out('dirty-lower.stl', { positions: Float32Array.from(P), indices: Uint32Array.from(keep) }); }
// a quadrant-only scan (auto-orient is expected to be unsure)
{ const m = N.makeDemoArch({ jaw: 'lower', res: 0.3 }).mesh, P = m.positions, I = m.indices, keep = [];
  for (let f = 0; f < I.length / 3; f++) { if (P[3 * I[3 * f]] > 6 && P[3 * I[3 * f + 1]] > 6 && P[3 * I[3 * f + 2]] > 6) keep.push(I[3 * f], I[3 * f + 1], I[3 * f + 2]); }
  out('quadrant-lower.stl', N.compact({ positions: P, indices: Uint32Array.from(keep) })); }
console.log(fs.readdirSync('/home/claude/suite/dev/data').map(f => f + ' ' + (fs.statSync('/home/claude/suite/dev/data/' + f).size / 1e6).toFixed(1) + 'MB').join('\n'));
