// where does the cavity union time go?
import { K, N, S } from './kernel.mjs';
const M = await S.ready(); const demo = N.makeDemoPair({ res: 0.3 });
const jaw = 'lower', A = K.archMatrix(jaw), scanA = N.transformMesh(demo[jaw], A), arch = K.analyseArch(scanA), inp = { scanA, arch, cache: {} };
await K.build(inp, {}); const C = inp.cache;
console.log('tris: model', C.mMan.numTri(), 'shell', C.lMan.numTri(), 'blockout', C.bMan.numTri(), 'cavity', C.cav.numTri());
const tm = (l, f) => { const t = Date.now(); const r = f(); r.numTri(); console.log(l.padEnd(26), Date.now() - t, 'ms  tris', r.numTri()); return r; };
const ml = tm('M ∪ L', () => C.mMan.add(C.lMan)); const mb = tm('M ∪ B', () => C.mMan.add(C.bMan)); const lb = tm('L ∪ B', () => C.lMan.add(C.bMan));
tm('(M ∪ L) ∪ B', () => ml.add(C.bMan)); tm('(M ∪ B) ∪ L', () => mb.add(C.lMan)); tm('(L ∪ B) ∪ M', () => lb.add(C.mMan));
tm('union([M,L,B])', () => M.Manifold.union([C.mMan, C.lMan, C.bMan]));
process.exit(0);
