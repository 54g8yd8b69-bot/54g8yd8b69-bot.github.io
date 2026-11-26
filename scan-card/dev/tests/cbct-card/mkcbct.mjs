// mkcbct.mjs — writes the made-up CBCT test scans into dev/data/cbct/ (node dev/tests/cbct-card/mkcbct.mjs).
// All of them are the synthetic jaw of shared/dicom.js (makePhantom: lower arch, 14 teeth, exact geometry), written in the
// layouts and compressions the CBCT tab reads, with fake patient details in the tags (FAKE in dcmwrite.mjs).
//   full  0.3 mm, 242×207×111        half  every second voxel of full (121×104×56), declared with the spacings below
//   a-explicit/      full · one file per slice · explicit VR LE · unsigned, 12 bits stored with junk in the 4 bits above · shuffled names
//                    + a DICOMDIR and a text file (to be passed over)
//   b-implicit-flip/ half · implicit VR LE · signed · rows run front-wards and slices top-down (IOP 1,0,0,0,-1,0) · 0.6 × 0.5 × 0.7 mm
//   c-rle/           full · RLE Lossless · signed
//   d-jpegll/        full · JPEG Lossless SV1 (.70) · restart every row · unsigned 12 bit
//   e-enhanced.dcm   full · Enhanced CT multi-frame · functional groups · frames stored top-down · an icon image inside a sequence
//   f-zip.zip        a-explicit's slices in a folder inside a zip (deflated)
//   g-bigendian/     half · explicit VR big endian          h-deflated/  half · deflated explicit VR LE
//   i-jpegll57/      half · JPEG Lossless (.57) predictor 6 · each frame in 3 fragments · offset table
//   j-coronal/       half · coronal slices (IOP 1,0,0,0,0,-1) · 0.6 (x) × 0.55 (y) × 0.65 (z) mm
//   k-legacymf.dcm   half · plain multi-frame (one position + spacing between slices)
//   n-jpeg8/         half · JPEG baseline, 8 bits (value = stored × 16 − 1200), stored as MONOCHROME1 (dark is high) · lossy: within 3 steps
//   m-u16/           half · unsigned 16 bits stored, intercept −1200 (fits 16 signed bits as values: no shift wanted)
//   l-j2k/           3 tiny slices said to be JPEG 2000 (cannot be read: must be named as such)
//   truth.json       dims, spacing, origin and sample voxel values for each, and the fake identifiers
import fs from 'node:fs';
import path from 'node:path';
import { makePhantom } from '../../../shared/dicom.js';
import { writeDicom, zipBuffer, TS, FAKE, fakeTags } from './dcmwrite.mjs';
import { createRequire } from 'node:module';
const sharp = createRequire(import.meta.url)('../../../node_modules/sharp');

const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../data/cbct');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const { vol } = makePhantom({ voxel: 0.3 });
console.log('phantom', vol.dims.join('×'), ((Date.now() - t0) / 1000).toFixed(1) + ' s', 'range', vol.min, vol.max);
const full = { data: vol.data, dims: vol.dims, origin: vol.origin, spacing: vol.spacing };
const half = (() => {
  const [nx, ny, nz] = full.dims, hx = Math.ceil(nx / 2), hy = Math.ceil(ny / 2), hz = Math.ceil(nz / 2), d = new Int16Array(hx * hy * hz);
  for (let k = 0; k < hz; k++) for (let j = 0; j < hy; j++) for (let i = 0; i < hx; i++) d[i + hx * (j + hy * k)] = full.data[2 * i + nx * (2 * j + ny * 2 * k)];
  return { data: d, dims: [hx, hy, hz], origin: full.origin };
})();
const at = (V, i, j, k) => V.data[i + V.dims[0] * (j + V.dims[1] * k)];
let uidN = 0; const uid = () => `1.2.826.0.1.3680043.9.7777.${Date.now() % 1e6}.${++uidN}`;
const STUDY = uid();

/** the slices of a volume in one orientation → [{ pixels(r,c) as a frame, ipp, index }] */
function slicesOf(V, sp, orient) {
  const [nx, ny, nz] = V.dims, [sx, sy, sz] = sp, o = V.origin, out = [];
  if (orient === 'coronal') {                                     // one file per j: rows go down (−z), columns +x
    for (let j = 0; j < ny; j++) { const f = new Int16Array(nz * nx); for (let r = 0; r < nz; r++) for (let c = 0; c < nx; c++) f[r * nx + c] = at(V, c, j, nz - 1 - r); out.push({ f, ipp: [o[0], o[1] + j * sy, o[2] + (nz - 1) * sz], rows: nz, cols: nx, ps: [sz, sx], iop: [1, 0, 0, 0, 0, -1], step: sy }); }
    return out;
  }
  for (let k = 0; k < nz; k++) {
    const f = new Int16Array(ny * nx);
    if (orient === 'flip') { for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) f[r * nx + c] = at(V, c, ny - 1 - r, k); out.push({ f, ipp: [o[0], o[1] + (ny - 1) * sy, o[2] + k * sz], rows: ny, cols: nx, ps: [sy, sx], iop: [1, 0, 0, 0, -1, 0], step: sz }); }
    else { f.set(V.data.subarray(k * nx * ny, (k + 1) * nx * ny)); out.push({ f, ipp: [o[0], o[1], o[2] + k * sz], rows: ny, cols: nx, ps: [sy, sx], iop: [1, 0, 0, 0, 1, 0], step: sz }); }
  }
  return out;
}
const ds = (v) => Number(v.toFixed(6)).toString();
/** stored values from the volume's values: signed as is, or unsigned 12 bit with an intercept (and junk above bit 11 if asked) */
function stored(f, enc) {
  if (enc.signed) return f;
  const o = new Uint16Array(f.length), top = enc.bits16 ? 65535 : 4095; for (let i = 0; i < f.length; i++) { const s = f[i] - enc.intercept; if (s < 0 || s > top) throw new Error('value out of range ' + s); o[i] = s | (enc.junk ? ((i * 7919) & 15) << 12 : 0); }
  return o;
}
function imageTags(s, enc, extra = []) {
  return [
    ...fakeTags(), [0x00080020, 'DA', '20240315'], [0x00080060, 'CS', 'CT'],
    [0x00280002, 'US', 1], [0x00280004, 'CS', 'MONOCHROME2'], [0x00280010, 'US', s.rows], [0x00280011, 'US', s.cols], [0x00280030, 'DS', s.ps.map(ds)],
    [0x00280100, 'US', 16], [0x00280101, 'US', enc.signed || enc.bits16 ? 16 : 12], [0x00280102, 'US', enc.signed || enc.bits16 ? 15 : 11], [0x00280103, 'US', enc.signed ? 1 : 0],
    [0x00281050, 'DS', '500'], [0x00281051, 'DS', '3000'], ...extra,
  ];
}
function writeSeries(dir, V, sp, o) {
  const d = path.join(OUT, dir); fs.mkdirSync(d, { recursive: true });
  const sl = slicesOf(V, sp, o.orient || 'axial'), series = uid(), order = sl.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = (i * 2654435761) % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }   // file names in no particular order
  sl.forEach((s, n) => {
    const enc = o.enc, extra = [[0x00080016, 'UI', '1.2.840.10008.5.1.4.1.1.2'], [0x00080018, 'UI', uid()], [0x0020000D, 'UI', STUDY], [0x0020000E, 'UI', series], [0x00200013, 'IS', String(n + 1)],
      [0x00200032, 'DS', s.ipp.map(ds)], [0x00200037, 'DS', s.iop.map(ds)], [0x00180050, 'DS', ds(s.step)], [0x00281052, 'DS', ds(enc.signed ? 0 : enc.intercept)], [0x00281053, 'DS', '1']];
    const buf = writeDicom({ ts: o.ts, sopClass: '1.2.840.10008.5.1.4.1.1.2', sopInstance: uid(), rows: s.rows, cols: s.cols, bits: 16, elements: imageTags(s, enc, extra), frames: [stored(s.f, enc)], jpeg: o.jpeg, splitFragments: o.split, offsetTable: o.table });
    fs.writeFileSync(path.join(d, `IMG${String(order[n] + 1).padStart(4, '0')}${o.ext || '.dcm'}`), buf);
  });
  return d;
}
function writeMultiframe(file, V, sp, o) {
  const sl = slicesOf(V, sp, 'axial'), enc = o.enc, n = sl.length, s0 = sl[0];
  const frames = o.order === 'down' ? sl.slice().reverse() : sl;
  const els = imageTags(s0, enc, [[0x00080016, 'UI', o.sop], [0x00080018, 'UI', uid()], [0x0020000D, 'UI', STUDY], [0x0020000E, 'UI', uid()], [0x00200013, 'IS', '1'], [0x00280008, 'IS', String(n)]]);
  if (o.enhanced) {
    const shared = [[0x00209116, 'SQ', { items: [[[0x00200037, 'DS', s0.iop.map(ds)]]] }], [0x00289110, 'SQ', { items: [[[0x00180050, 'DS', ds(sp[2])], [0x00180088, 'DS', ds(sp[2])], [0x00280030, 'DS', s0.ps.map(ds)]]] }],
      [0x00289145, 'SQ', { items: [[[0x00281052, 'DS', ds(enc.signed ? 0 : enc.intercept)], [0x00281053, 'DS', '1'], [0x00281054, 'LO', 'HU']]] }]];
    const per = frames.map((s, f) => [[0x00209111, 'SQ', { items: [[[0x00209157, 'UL', [1, f + 1]]]] }], [0x00209113, 'SQ', { items: [[[0x00200032, 'DS', s.ipp.map(ds)]]], undefinedLength: true, itemsUndefined: true }]]);
    els.push([0x52009229, 'SQ', { items: [shared], undefinedLength: true, itemsUndefined: true }], [0x52009230, 'SQ', { items: per, undefinedLength: true }]);
    // an icon image (with a name in its own items, and pixel data of its own) inside a sequence: it must be stepped over
    els.push([0x00880200, 'SQ', { items: [[[0x00280002, 'US', 1], [0x00280004, 'CS', 'MONOCHROME2'], [0x00280010, 'US', 4], [0x00280011, 'US', 4], [0x00280100, 'US', 8], [0x00280101, 'US', 8], [0x00280102, 'US', 7], [0x00280103, 'US', 0], [0x00100010, 'PN', FAKE.name], [0x7FE00010, 'OB', Buffer.alloc(16, 200)]]] }]);
  } else {
    els.push([0x00200032, 'DS', s0.ipp.map(ds)], [0x00200037, 'DS', s0.iop.map(ds)], [0x00180050, 'DS', ds(sp[2])], [0x00180088, 'DS', ds(sp[2])], [0x00281052, 'DS', ds(enc.signed ? 0 : enc.intercept)], [0x00281053, 'DS', '1']);
  }
  fs.writeFileSync(path.join(OUT, file), writeDicom({ ts: o.ts || TS.explicit, sopClass: o.sop, sopInstance: uid(), rows: s0.rows, cols: s0.cols, bits: 16, elements: els, frames: frames.map((s) => stored(s.f, enc)) }));
}

const vmin = full.data.reduce((m, v) => Math.min(m, v), 32767), U12 = { signed: false, intercept: vmin - 10 }, SIGNED = { signed: true };
const truth = { fake: FAKE, variants: {} };
const sampleSet = (V) => {                                      // voxels to check: corners, the middle, and 400 spread through the volume
  const [nx, ny, nz] = V.dims, s = [[0, 0, 0], [nx - 1, 0, 0], [0, ny - 1, 0], [0, 0, nz - 1], [nx - 1, ny - 1, nz - 1], [nx >> 1, ny >> 1, nz >> 1]];
  let r = 12345; const rnd = (n) => { r = (Math.imul(r, 1103515245) + 12345) >>> 0; return r % n; };
  for (let q = 0; q < 400; q++) s.push([rnd(nx), rnd(ny), rnd(nz)]);
  return s.map(([i, j, k]) => [i, j, k, at(V, i, j, k)]);
};
const FULL_S = sampleSet(full), HALF_S = sampleSet(half);
const note = (name, V, spacing, extra = {}) => { truth.variants[name] = { dims: V.dims, spacing, origin: V.origin, samples: V === full ? FULL_S : HALF_S, ...extra }; };
const sp3 = [0.3, 0.3, 0.3], sp6 = [0.6, 0.6, 0.6];

const dA = writeSeries('a-explicit', full, sp3, { ts: TS.explicit, enc: { ...U12, junk: true } }); note('a-explicit', full, sp3);
fs.writeFileSync(path.join(dA, 'DICOMDIR'), writeDicom({ ts: TS.explicit, sopClass: '1.2.840.10008.1.3.10', sopInstance: uid(), elements: [[0x00041130, 'CS', 'ZZFILESET'], ...fakeTags()], frames: [], bits: 16 }).subarray(0, 1000));
fs.writeFileSync(path.join(dA, 'notes.txt'), 'not a scan\n');
writeSeries('b-implicit-flip', half, [0.6, 0.5, 0.7], { ts: TS.implicit, enc: SIGNED, orient: 'flip' }); note('b-implicit-flip', half, [0.6, 0.5, 0.7]);
writeSeries('c-rle', full, sp3, { ts: TS.rle, enc: SIGNED }); note('c-rle', full, sp3);
writeSeries('d-jpegll', full, sp3, { ts: TS.jpegll70, enc: U12, jpeg: { predictor: 1, restart: full.dims[0], precision: 12 } }); note('d-jpegll', full, sp3);
writeMultiframe('e-enhanced.dcm', full, sp3, { enc: SIGNED, enhanced: true, order: 'down', sop: '1.2.840.10008.5.1.4.1.1.2.1' }); note('e-enhanced', full, sp3);
{ const files = fs.readdirSync(dA).filter((f) => f.startsWith('IMG')).sort(); fs.writeFileSync(path.join(OUT, 'f-zip.zip'), zipBuffer(files.map((f) => ({ name: `${FAKE.folder}/CT/${f}`, data: fs.readFileSync(path.join(dA, f)) })).concat([{ name: `${FAKE.folder}/readme.txt`, data: Buffer.from('hello') }]), { deflate: true })); note('f-zip', full, sp3); }
writeSeries('g-bigendian', half, sp6, { ts: TS.big, enc: SIGNED }); note('g-bigendian', half, sp6);
writeSeries('h-deflated', half, sp6, { ts: TS.deflated, enc: U12 }); note('h-deflated', half, sp6);
writeSeries('i-jpegll57', half, sp6, { ts: TS.jpegll57, enc: SIGNED, jpeg: { predictor: 6 }, split: 3, table: true }); note('i-jpegll57', half, sp6);
writeSeries('j-coronal', half, [0.6, 0.55, 0.65], { ts: TS.explicit, enc: SIGNED, orient: 'coronal' }); note('j-coronal', half, [0.6, 0.55, 0.65]);
writeMultiframe('k-legacymf.dcm', half, sp6, { enc: U12, sop: '1.2.840.10008.5.1.4.1.1.2' }); note('k-legacymf', half, sp6);
writeSeries('m-u16', half, sp6, { ts: TS.explicit, enc: { signed: false, bits16: true, intercept: -1200 } }); note('m-u16', half, sp6);
{ const tiny = { data: half.data.subarray(0, 32 * 32 * 3), dims: [32, 32, 3], origin: [0, 0, 0] }; writeSeries('l-j2k', tiny, sp6, { ts: TS.j2k, enc: SIGNED }); }
{ // JPEG baseline, 8-bit, MONOCHROME1: stored = 255 − round((v + 1200) / 16)
  const d = path.join(OUT, 'n-jpeg8'); fs.mkdirSync(d, { recursive: true }); const sl = slicesOf(half, sp6, 'axial'), series = uid(), q8 = (v) => Math.max(0, Math.min(255, Math.round((v + 1200) / 16)));
  for (let n = 0; n < sl.length; n++) {
    const s = sl[n], px = Buffer.alloc(s.rows * s.cols); for (let i = 0; i < px.length; i++) px[i] = 255 - q8(s.f[i]);
    const jpg = await sharp(px, { raw: { width: s.cols, height: s.rows, channels: 1 } }).toColourspace('b-w').jpeg({ quality: 100 }).toBuffer();
    const els = [...fakeTags(), [0x00080020, 'DA', '20240315'], [0x00080060, 'CS', 'CT'], [0x00080016, 'UI', '1.2.840.10008.5.1.4.1.1.2'], [0x00080018, 'UI', uid()], [0x0020000D, 'UI', STUDY], [0x0020000E, 'UI', series], [0x00200013, 'IS', String(n + 1)],
      [0x00200032, 'DS', s.ipp.map(ds)], [0x00200037, 'DS', s.iop.map(ds)], [0x00180050, 'DS', ds(s.step)], [0x00280002, 'US', 1], [0x00280004, 'CS', 'MONOCHROME1'], [0x00280010, 'US', s.rows], [0x00280011, 'US', s.cols], [0x00280030, 'DS', s.ps.map(ds)],
      [0x00280100, 'US', 8], [0x00280101, 'US', 8], [0x00280102, 'US', 7], [0x00280103, 'US', 0], [0x00281052, 'DS', '-1200'], [0x00281053, 'DS', '16']];
    fs.writeFileSync(path.join(d, `IMG${String(n + 1).padStart(4, '0')}.dcm`), writeDicom({ ts: TS.jpeg, sopClass: '1.2.840.10008.5.1.4.1.1.2', sopInstance: uid(), rows: s.rows, cols: s.cols, bits: 8, elements: els, frames: [], compressed: [jpg] }));
  }
  truth.variants['n-jpeg8'] = { dims: half.dims, spacing: sp6, origin: half.origin, samples: HALF_S.map(([i, j, k, v]) => [i, j, k, q8(v) * 16 - 1200]), tol: 48, lossy: true };
}
fs.writeFileSync(path.join(OUT, 'truth.json'), JSON.stringify(truth));
let total = 0; const walk = (p) => { for (const f of fs.readdirSync(p)) { const q = path.join(p, f), st = fs.statSync(q); if (st.isDirectory()) walk(q); else total += st.size; } }; walk(OUT);
console.log('written to', OUT, (total / 1e6).toFixed(1) + ' MB', ((Date.now() - t0) / 1000).toFixed(1) + ' s');
