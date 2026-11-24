// Loads the geometry kernel straight out of splint-card/index.html (the block between KERNEL:BEGIN and KERNEL:END),
// so the Node tests exercise exactly the code that ships.
import fs from 'fs';
const html = fs.readFileSync('/home/claude/suite/splint-card/index.html', 'utf8');
const m = html.match(/\/\/ ═+ KERNEL:BEGIN[^\n]*\n([\s\S]*?)\/\/ ═+ KERNEL:END/);
if (!m) throw new Error('kernel block not found');
const gen = '/home/claude/suite/dev/tests/splint-card/.kernel.gen.mjs';
fs.writeFileSync(gen, `import * as N from '/home/claude/suite/shared/core.js';\nimport * as S from '/home/claude/suite/shared/solid.js';\nconst THREE = N.THREE;\n${m[1]}\nexport { K, N, S };\n`);
const mod = await import(gen + '?' + Date.now());
export const K = mod.K, N = mod.N, S = mod.S;
export const OUT = '/home/claude/suite/dev/out/splint-card/', DATA = '/home/claude/suite/dev/data/';
export const loadStl = (f) => { const b = fs.readFileSync(f.startsWith('/') ? f : DATA + f); return N.parseMesh(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), 'stl', f); };
export const saveStl = (name, mesh) => fs.writeFileSync(OUT + name, Buffer.from(N.stlBinary(mesh)));
