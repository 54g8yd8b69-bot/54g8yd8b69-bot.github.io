// u1-reader.mjs — shared/dicom.js in node against the test scans (mkcbct.mjs; checked independently by validate_pydicom.py):
// every variant gives the right size, spacing, position and voxel values; series are told apart; unreadable ones are named;
// nothing identifying is kept in what the reader returns.   node dev/tests/cbct-card/u1-reader.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as D from '../../../shared/dicom.js';

const DATA = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../data/cbct');
const truth = JSON.parse(fs.readFileSync(path.join(DATA, 'truth.json')));
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) { fails++; process.exitCode = 1; } };
const blobOf = async (p) => { const b = await fs.openAsBlob(p); return b; };
const filesIn = async (dir) => Promise.all(fs.readdirSync(path.join(DATA, dir)).sort().map((f) => blobOf(path.join(DATA, dir, f))));
const near = (a, b, e = 1e-4) => a.every((v, i) => Math.abs(v - b[i]) < e);
function checkVol(name, vol) {
  const t = truth.variants[name]; let bad = 0;
  for (const [i, j, k, v] of t.samples) if (Math.abs(vol.data[i + vol.dims[0] * (j + vol.dims[1] * k)] + vol.shift - v) > (t.tol || 0)) bad++;
  ok(near(vol.dims, t.dims, 0.5) && near(vol.spacing, t.spacing) && near(vol.origin, t.origin, 1e-3) && bad === 0,
    `${name}: ${vol.dims.join('×')} at ${vol.spacing.join(' × ')} mm, origin ${vol.origin.map((v) => v.toFixed(2)).join(', ')}, ${bad} of ${t.samples.length} voxels wrong${vol.warnings.length ? ' · warnings: ' + vol.warnings.join(' | ') : ''}`);
  return vol;
}
async function load(name, files) {
  const t0 = Date.now(), set = await D.scanSeries(files), vol = await D.loadVolume(set.series[0]);
  checkVol(name, vol); return { set, vol, ms: Date.now() - t0 };
}
(async () => {
  for (const n of ['a-explicit', 'b-implicit-flip', 'c-rle', 'd-jpegll', 'g-bigendian', 'h-deflated', 'i-jpegll57', 'j-coronal', 'm-u16', 'o-jpeg12']) {
    const r = await load(n, await filesIn(n));
    if (n === 'a-explicit') ok(r.set.series.length === 1 && r.set.skipped === 2, `a-explicit: one series, the DICOMDIR and the text file passed over (skipped ${r.set.skipped})`);
    if (n === 'm-u16') ok(r.vol.shift === 0 && r.vol.min === Math.min(...truth.variants[n].samples.map((x) => x[3]).concat([r.vol.min])), `m-u16: unsigned 16-bit with intercept −1200 needs no shift (shift ${r.vol.shift}, values ${r.vol.min} … ${r.vol.max})`);
    if (n === 'a-explicit' || n === 'c-rle' || n === 'd-jpegll') console.log(`     (${(r.ms / 1000).toFixed(1)} s)`);
  }
  for (const n of ['e-enhanced', 'k-legacymf']) await load(n, [await blobOf(path.join(DATA, n + '.dcm'))]);
  { // no slice positions in the file: the first frame is taken as the top (so this scan, stored top-down, comes out the right way up), the reader says it guessed, and flipStack turns it over
    const r = await load('p-mfnopos', [await blobOf(path.join(DATA, 'p-mfnopos.dcm'))]), v = r.vol, t = truth.variants['p-mfnopos'], at = (V, i, j, k) => V.data[i + V.dims[0] * (j + V.dims[1] * k)] + V.shift;
    ok(v.guessed === true && !v.flipped && v.warnings.some((w) => /first slice is taken as the top/.test(w)), `p-mfnopos: the reader says the slice order was assumed (guessed ${v.guessed}): ${v.warnings.join(' | ')}`);
    const f = D.flipStack(v), nz = f.dims[2]; let bad = 0; for (const [i, j, k, val] of t.samples) if (at(f, i, j, nz - 1 - k) !== val) bad++;
    ok(f.flipped === true && f.guessed === true && bad === 0 && f.data === v.data, `flipStack turns it over in place: ${bad} of ${t.samples.length} voxels wrong after the flip (flipped ${f.flipped})`);
    const g = D.flipStack(f); bad = 0; for (const [i, j, k, val] of t.samples) if (at(g, i, j, k) !== val) bad++;
    ok(g.flipped === false && bad === 0, `… and back again: ${bad} wrong (flipped ${g.flipped})`);
    ok(!(await load('k-legacymf', [await blobOf(path.join(DATA, 'k-legacymf.dcm'))])).vol.guessed, 'a file that does give a position is not marked as guessed');
  }
  { const z = await D.zipEntries(await blobOf(path.join(DATA, 'f-zip.zip'))); ok(z.length === 112, `zip: ${z.length} entries`); await load('f-zip', z); }
  // several series in one go: the largest readable comes first, the JPEG 2000 one is named
  const mix = [...await filesIn('b-implicit-flip'), ...await filesIn('l-j2k'), ...await filesIn('c-rle')];
  const set = await D.scanSeries(mix);
  ok(set.series.length === 3 && set.series[0].count === 111 && set.series[1].count === 56 && /JPEG 2000/.test(set.series[2].reason), `mixed folder: ${set.series.map((s) => `${s.count}×${s.rows}×${s.cols} ${s.compression}${s.reason ? ' (' + s.reason + ')' : ''}`).join(' · ')}`);
  let err = ''; try { await D.loadVolume(set.series[2]); } catch (e) { err = e.message; }
  ok(/JPEG 2000/.test(err), 'opening the JPEG 2000 series says why it cannot: ' + err);
  // privacy: what the reader hands back holds none of the fake identifiers
  const F = truth.fake, keep = JSON.stringify(set.series.map((s) => ({ ...s, items: s.items.map((it) => it.h) })), (k, v) => (ArrayBuffer.isView(v) ? '[bytes]' : v));
  const hits = Object.values(F).filter((v) => keep.includes(v) || keep.includes(v.split('^')[0]));
  ok(hits.length === 0 && /20240315/.test(keep), `the headers kept hold no identifiers (only technical tags; study date kept): ${hits.join(', ') || 'none found'}`);
  const hk = Object.keys(set.series[0].items[0].h).sort().join(',');
  console.log('     header keys kept:', hk);
  console.log(fails ? `${fails} FAILED` : 'all passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
