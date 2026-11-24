import * as N from '../../../shared/core.js';
import fs from 'fs';
import crypto from 'crypto';
const O = '/home/claude/suite/dev/out/suite/', rt = JSON.parse(fs.readFileSync(O + 'rt.json')); let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? '  ok  ' : '  FAIL', m); };
const sha = (u8) => crypto.createHash('sha1').update(u8).digest('hex').slice(0, 12);
const cases = [];
for (const f of rt.files) { const b = fs.readFileSync(f), es = await N.unzip(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), man = JSON.parse(new TextDecoder().decode(es.find(e => e.name === 'case.json').data));
  const items = Object.fromEntries(man.items.map(it => [it.role, { name: it.name, matrix: JSON.stringify(it.matrix), hash: sha(es.find(e => e.name === it.file).data) }]));
  cases.push({ f, app: man.app, items, data: man.data }); console.log(f.split('/').pop(), 'saved by', man.app, '| items:', Object.keys(items).join(', '), '| data:', Object.keys(man.data).join(', '), '|', (b.length / 1e6).toFixed(1), 'MB'); }
const [c1, c2, c3, c4] = cases;
for (const role of ['upper-scan', 'lower-scan', 'upper-model', 'lower-model']) for (const [i, c] of [[2, c2], [3, c3], [4, c4]]) ok(c.items[role] && c.items[role].hash === c1.items[role].hash && c.items[role].matrix === c1.items[role].matrix, `${role} identical after step ${i} (${c.app})`);
ok(JSON.stringify(c2.data.model) === JSON.stringify(c1.data.model) && JSON.stringify(c3.data.model) === JSON.stringify(c1.data.model), 'Model Card settings carried through the other two apps untouched');
if (c2.data.analysis) ok(JSON.stringify(c3.data.analysis) === JSON.stringify(c2.data.analysis) && JSON.stringify(c4.data.analysis) === JSON.stringify(c2.data.analysis), 'Analysis Card data carried through Splint Card and Model Card untouched');
if (c3.data.splint) ok(JSON.stringify(c4.data.splint) === JSON.stringify(c3.data.splint), 'Splint Card data carried through Model Card untouched');
if (c3.items.splint) ok(c4.items.splint && c4.items.splint.hash === c3.items.splint.hash, 'splint mesh carried through Model Card untouched');
ok(rt.back.hollow === true && rt.back.models.every(Boolean) && rt.back.dirty.every(v => !v), 'Model Card reopened its own models and settings from the much-travelled case');
ok(Object.values(rt.errs).every(e => e.length === 0), 'no browser errors in any app');
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
