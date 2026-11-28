// dicom.js — reading CT / CBCT DICOM files in the browser, for the Notile suite (CBCT tab of Scan Card).
//
// Everything happens on the device. PRIVACY: the reader keeps only the handful of technical tags listed in KEEP below
// (image size, spacing, position, rescale, modality, study date). Every other element — the patient's name, ID, date of
// birth, address, the institution, the referring clinician, accession numbers, descriptions — is stepped over by its
// length and never decoded into a string, so it cannot reach the page, a saved case or an export. The series UID is only
// used, hashed, to tell one series from another.
//
// What it reads
//   transfer syntaxes  implicit VR little endian, explicit VR little endian, deflated explicit VR little endian,
//                      explicit VR big endian, RLE Lossless, JPEG Lossless (process 14, any predictor, .57 and .70),
//                      JPEG baseline 8-bit (through the browser's own decoder); JPEG Extended 12-bit (lossy, as i-CAT and
//                      others write it) by the DCT decoder here.
//   not yet            JPEG 2000, JPEG-LS, progressive JPEG — these are named clearly so the user can export again.
//   layouts            one file per slice (classic CT), multi-frame files (Enhanced CT with functional groups, or a
//                      plain multi-frame file with a frame spacing), several series mixed in one folder, a .zip of any of these.
//
//   const set = await scanSeries(fileLikes, onProgress)      → { series:[…], skipped }
//   const vol = await loadVolume(set.series[0], onProgress)  → { data:Int16Array, dims, spacing, origin, … }
//   zipEntries(blob) → file-likes read (and inflated) only when asked for
//   makePhantom(opts) → a synthetic jaw with teeth and its exact geometry (the demo, and the tests' ground truth)
//
// Working with the volume (pure functions, no page; at the end of the file): histogram, windowPresets, downsample (the 3D
// texture), surfaceField (a threshold surface for core's isoMesh), archCurve / proposeArch / panorama / crossSection (the
// panoramic), segmentTooth / replicaField / taubin / offsetMesh (a donor tooth cut out, and its replica), cropVolume.

// ───────────────────────────── transfer syntaxes ─────────────────────────────
const TS = {
  '1.2.840.10008.1.2': { name: 'uncompressed', implicit: true },
  '1.2.840.10008.1.2.1': { name: 'uncompressed' },
  '1.2.840.10008.1.2.1.99': { name: 'deflated', deflated: true },
  '1.2.840.10008.1.2.2': { name: 'uncompressed (big endian)', big: true },
  '1.2.840.10008.1.2.5': { name: 'RLE Lossless', codec: 'rle' },
  '1.2.840.10008.1.2.4.50': { name: 'JPEG baseline', codec: 'jpeg' },
  '1.2.840.10008.1.2.4.51': { name: 'JPEG extended', codec: 'jpeg' },
  '1.2.840.10008.1.2.4.57': { name: 'JPEG Lossless', codec: 'jpegll' },
  '1.2.840.10008.1.2.4.70': { name: 'JPEG Lossless', codec: 'jpegll' },
  '1.2.840.10008.1.2.4.80': { name: 'JPEG-LS', codec: null },
  '1.2.840.10008.1.2.4.81': { name: 'JPEG-LS', codec: null },
  '1.2.840.10008.1.2.4.90': { name: 'JPEG 2000', codec: null },
  '1.2.840.10008.1.2.4.91': { name: 'JPEG 2000', codec: null },
  '1.2.840.10008.1.2.4.92': { name: 'JPEG 2000', codec: null },
  '1.2.840.10008.1.2.4.93': { name: 'JPEG 2000', codec: null },
  '1.2.840.10008.1.2.4.201': { name: 'High-throughput JPEG 2000', codec: null },
  '1.2.840.10008.1.2.4.202': { name: 'High-throughput JPEG 2000', codec: null },
  '1.2.840.10008.1.2.4.203': { name: 'High-throughput JPEG 2000', codec: null },
};
export const tsInfo = (uid) => TS[uid] || { name: 'an unknown compression', codec: null, unknown: true };

// ───────────────────────────── the only tags that are ever read ─────────────────────────────
// tag → [name, type]   US: 16-bit number · N: number(s) written as text (DS/IS) · S: short code text (CS/UI/DA)
const KEEP = {
  0x00020010: ['ts', 'S'],
  0x00080060: ['modality', 'S'], 0x00080020: ['studyDate', 'S'], 0x00080016: ['sopClass', 'S'],
  0x0020000E: ['seriesUid', 'S'], 0x00200013: ['instance', 'N'], 0x00200032: ['ipp', 'N'], 0x00200037: ['iop', 'N'], 0x00201041: ['sliceLocation', 'N'],
  0x00180050: ['sliceThickness', 'N'], 0x00180088: ['spacingBetween', 'N'],
  0x00280002: ['samples', 'US'], 0x00280004: ['photometric', 'S'], 0x00280006: ['planar', 'US'], 0x00280008: ['frames', 'N'],
  0x00280010: ['rows', 'US'], 0x00280011: ['cols', 'US'], 0x00280030: ['pixelSpacing', 'N'],
  0x00280100: ['bitsAllocated', 'US'], 0x00280101: ['bitsStored', 'US'], 0x00280102: ['highBit', 'US'], 0x00280103: ['signed', 'US'],
  0x00281052: ['intercept', 'N'], 0x00281053: ['slope', 'N'], 0x3004000C: ['frameOffsets', 'N'],
};
// sequences that are opened (the functional groups of multi-frame files); every other sequence is stepped over
const SEQ = { 0x52009229: 'shared', 0x52009230: 'perFrame', 0x00209113: 'planePosition', 0x00209116: 'planeOrientation', 0x00289110: 'pixelMeasures', 0x00289145: 'pixelValue' };
/** the most voxels a volume may have (an Int16Array of this many is 1.2 GB) */
export const MAX_VOXELS = 600e6;
const LONG_VR = new Set(['OB', 'OW', 'OF', 'SQ', 'UT', 'UN', 'OD', 'OL', 'UC', 'UR', 'OV', 'SV', 'UV']);
class Truncated extends Error { constructor() { super('truncated'); } }

function textOf(u8, p, len) { let s = ''; for (let i = 0; i < len; i++) { const c = u8[p + i]; if (c === 0) break; s += String.fromCharCode(c); } return s.trim(); }
function valueOf(R, p, len, type) {
  if (type === 'US') return len >= 2 ? R.dv.getUint16(p, R.le) : undefined;
  const s = textOf(R.u8, p, len);
  if (type === 'N') { const a = s.split('\\').map((x) => parseFloat(x)).filter((x) => Number.isFinite(x)); return a.length === 1 ? a[0] : a.length ? a : undefined; }
  return s;
}
/** One data set (the file's own, or an item of a sequence): keeps what KEEP and SEQ name, steps over the rest. */
function readDataset(R, end, out, explicit, stopAfterMeta, top) {
  const { dv, u8 } = R;
  while (R.p + 8 <= end) {
    if (R.p + 8 > R.n) throw new Truncated();
    const g = dv.getUint16(R.p, R.le), e = dv.getUint16(R.p + 2, R.le);
    if (stopAfterMeta && g !== 0x0002) return 'meta';
    if (g === 0xFFFE) { R.p += 8; if (e === 0xE00D || e === 0xE0DD) return 'delim'; continue; }
    const tag = ((g << 16) | e) >>> 0; let vr = '', len;
    if (explicit) {
      vr = String.fromCharCode(u8[R.p + 4], u8[R.p + 5]);
      if (LONG_VR.has(vr)) { if (R.p + 12 > R.n) throw new Truncated(); len = dv.getUint32(R.p + 8, R.le); R.p += 12; } else { len = dv.getUint16(R.p + 6, R.le); R.p += 8; }
    } else { len = dv.getUint32(R.p + 4, R.le); R.p += 8; }
    if (tag === 0x7FE00010 && top) { out.pixel = { offset: R.p, length: len, encapsulated: len === 0xFFFFFFFF }; return 'pixel'; }   // (pixel data inside a sequence item is a thumbnail: stepped over like the rest)
    if (len === 0xFFFFFFFF || vr === 'SQ' || (!explicit && SEQ[tag])) {         // a sequence (or an element of unknown kind written like one)
      const name = SEQ[tag], arr = name ? [] : null, stop = len === 0xFFFFFFFF ? R.n : R.p + len;
      if (len !== 0xFFFFFFFF && stop > R.n) throw new Truncated();
      readItems(R, stop, arr, explicit && vr !== 'UN', len === 0xFFFFFFFF);
      if (len !== 0xFFFFFFFF) R.p = stop;
      if (arr) out[name] = arr; continue;
    }
    if (R.p + len > R.n) throw new Truncated();
    const k = KEEP[tag]; if (k && len > 0 && len < 4096) { const v = valueOf(R, R.p, len, k[1]); if (v !== undefined) out[k[0]] = v; }
    R.p += len;
  }
  return 'end';
}
function readItems(R, end, arr, explicit, undefinedLength) {
  const { dv } = R;
  while (R.p + 8 <= end) {
    if (R.p + 8 > R.n) throw new Truncated();
    const g = dv.getUint16(R.p, R.le), e = dv.getUint16(R.p + 2, R.le), len = dv.getUint32(R.p + 4, R.le);
    if (g !== 0xFFFE) { if (undefinedLength) throw new Error('bad sequence'); return; }
    R.p += 8;
    if (e === 0xE0DD) return;
    if (e !== 0xE000) continue;
    const item = arr ? {} : null, sink = item || {};
    if (len === 0xFFFFFFFF) readDataset(R, R.n, sink, explicit, false);
    else { const stop = R.p + len; if (stop > R.n) throw new Truncated(); if (item) readDataset(R, stop, sink, explicit, false); R.p = stop; }
    if (arr) arr.push(item);
  }
}
async function inflateRaw(u8) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()); }

/**
 * parseDicom(buffer, { partial }) → header | null (not DICOM) | { truncated:true } (partial buffer ended before the pixel data).
 * header: { ts, rows, cols, frames, bitsAllocated, bitsStored, signed, slope, intercept, pixelSpacing, ipp, iop, …,
 *           pixel:{ offset, length, encapsulated, fragments? }, bytes: Uint8Array the offsets refer to }
 */
export async function parseDicom(buf, o = {}) {
  let u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const R = { u8, dv: new DataView(u8.buffer, u8.byteOffset, u8.byteLength), p: 0, n: u8.length, le: true }, out = {};
  let explicit = true;
  try {
    if (u8.length >= 132 && u8[128] === 0x44 && u8[129] === 0x49 && u8[130] === 0x43 && u8[131] === 0x4D) {
      R.p = 132; readDataset(R, R.n, out, true, true, true);
    } else {                                                       // no preamble: an old-style file that starts straight with its data set
      if (u8.length < 16) return null;
      const g = R.dv.getUint16(0, true); if (g !== 0x0008 && g !== 0x0002) return null;
      const a = u8[4], b = u8[5]; explicit = a >= 65 && a <= 90 && b >= 65 && b <= 90; if (!explicit) out.ts = '1.2.840.10008.1.2';
      if (g === 0x0002) readDataset(R, R.n, out, true, true, true);
    }
    const ts = out.ts || '1.2.840.10008.1.2.1', info = tsInfo(ts); out.ts = ts;
    if (info.implicit) explicit = false;
    if (info.big) R.le = false;
    if (info.deflated) {
      if (o.partial) return { truncated: true };
      u8 = await inflateRaw(u8.subarray(R.p)); R.u8 = u8; R.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); R.p = 0; R.n = u8.length;
    }
    readDataset(R, R.n, out, explicit, false, true);
  } catch (e) { if (e instanceof Truncated) return o.partial ? { truncated: true } : null; return null; }
  if (!out.rows || !out.cols || !out.pixel) return out.rows && o.partial ? { truncated: true } : null;
  out.bytes = u8; out.big = !R.le; out.frames = Math.max(1, Math.round(out.frames || 1));
  const px = out.pixel;
  if (px.encapsulated) {
    if (o.partial) { px.fragments = null; }
    else {                                                         // the compressed pieces: a table of offsets (often empty), then one or more fragments per frame
      const dv = R.dv; let p = px.offset; const frags = []; let first = true; px.table = [];
      while (p + 8 <= R.n) {
        const g = dv.getUint16(p, true), e = dv.getUint16(p + 2, true), len = dv.getUint32(p + 4, true); p += 8;
        if (g !== 0xFFFE || e !== 0xE000) break;
        if (first) { first = false; for (let i = 0; i + 4 <= len; i += 4) px.table.push(dv.getUint32(p + i, true)); px.first = p + len; }
        else frags.push([p, Math.min(len, R.n - p)]);
        p += len;
      }
      px.fragments = frags;
    }
  } else if (!o.partial && px.offset + px.length > R.n) px.length = R.n - px.offset;
  return out;
}

// ───────────────────────────── pixel decoding ─────────────────────────────
/** RLE Lossless (PackBits per byte plane, most significant plane first) → Uint8Array | Uint16Array of stored values */
export function decodeRLE(u8, n, bytesPer) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), segs = dv.getUint32(0, true), out = bytesPer === 2 ? new Uint16Array(n) : new Uint8Array(n);
  if (segs < bytesPer) throw new Error('RLE: too few segments');
  for (let s = 0; s < bytesPer; s++) {
    let p = dv.getUint32(4 + 4 * s, true); const end = s + 1 < segs ? dv.getUint32(8 + 4 * s, true) : u8.length, shift = 8 * (bytesPer - 1 - s); let i = 0;
    while (p < end && i < n) {
      const c = u8[p++];
      if (c < 128) { for (let k = 0; k <= c && i < n; k++) out[i++] |= u8[p++] << shift; }
      else if (c > 128) { const v = u8[p++] << shift; for (let k = 257 - c; k > 0 && i < n; k--) out[i++] |= v; }
    }
  }
  return out;
}
/** JPEG Lossless (ITU T.81 process 14: Huffman, any predictor 1–7, point transform, restart intervals), one component.
 *  → { data: Uint16Array (values modulo 65536), width, height, precision } */
export function decodeJpegLossless(u8) {
  let p = 0; const n = u8.length, u16 = () => { const v = (u8[p] << 8) | u8[p + 1]; p += 2; return v; };
  if (u8[0] !== 0xFF || u8[1] !== 0xD8) throw new Error('not a JPEG stream'); p = 2;
  const tables = []; let P = 0, X = 0, Y = 0, Nf = 0, ri = 0, sel = 1, pt = 0, td = 0, found = false;
  while (p < n && !found) {
    if (u8[p] !== 0xFF) { p++; continue; }
    const m = u8[p + 1]; p += 2;
    if (m === 0xFF || m === 0x00 || m === 0x01 || (m >= 0xD0 && m <= 0xD8)) { if (m === 0xFF) p--; continue; }
    const len = u16(), end = p + len - 2;
    if (m === 0xC3) { P = u8[p]; Y = (u8[p + 1] << 8) | u8[p + 2]; X = (u8[p + 3] << 8) | u8[p + 4]; Nf = u8[p + 5]; }
    else if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) throw new Error('This JPEG is not the lossless kind');
    else if (m === 0xC4) {
      let q = p;
      while (q < end) {
        const id = u8[q] & 15, counts = u8.subarray(q + 1, q + 17); q += 17; let total = 0; for (let i = 0; i < 16; i++) total += counts[i];
        // a table indexed by the next 16 bits of the stream: (code length << 8) | symbol
        const look = new Uint16Array(65536); let code = 0, k = q;
        for (let l = 1; l <= 16; l++) { for (let i = 0; i < counts[l - 1]; i++) { const sym = u8[k++], lo = code << (16 - l), hi = lo + (1 << (16 - l)); look.fill((l << 8) | sym, lo, hi); code++; } code <<= 1; }
        tables[id] = look; q += total;
      }
    } else if (m === 0xDD) ri = (u8[p] << 8) | u8[p + 1];
    else if (m === 0xDA) { const ns = u8[p]; if (ns !== 1) throw new Error('Colour JPEG Lossless is not supported'); td = u8[p + 2] >> 4; sel = u8[p + 1 + 2 * ns]; pt = u8[p + 3 + 2 * ns] & 15; found = true; }
    p = end;
  }
  if (!found || !X || !Y) throw new Error('JPEG Lossless: no image found');
  if (Nf !== 1) throw new Error('Colour JPEG Lossless is not supported');
  const look = tables[td]; if (!look) throw new Error('JPEG Lossless: missing Huffman table');
  const out = new Uint16Array(X * Y), start = 1 << (P - pt - 1);
  let buf = 0, cnt = 0;                                            // bit buffer: `cnt` valid bits at the top of a 32-bit word
  const fill = () => { while (cnt <= 24) { let b = 0; if (p < n) { b = u8[p]; if (b === 0xFF) { if (u8[p + 1] === 0) p += 2; else b = 0; } else p++; } buf |= b << (24 - cnt); cnt += 8; } };
  const total = X * Y; let i = 0, sinceRestart = 0, rowOfInterval = 0;
  for (let y = 0; y < Y; y++) {
    for (let x = 0; x < X; x++, i++) {
      if (ri && sinceRestart === ri) {                             // a restart marker: bytes realign and prediction starts again
        buf = 0; cnt = 0; while (p < n - 1 && !(u8[p] === 0xFF && u8[p + 1] >= 0xD0 && u8[p + 1] <= 0xD7)) p++; p += 2; sinceRestart = 0; rowOfInterval = 0;
      }
      fill();
      const e = look[buf >>> 16], l = e >> 8, t = e & 255; if (!l) throw new Error('JPEG Lossless: bad code');
      buf <<= l; cnt -= l;
      let diff = 0;
      if (t === 16) diff = 32768;
      else if (t) { fill(); const v = buf >>> (32 - t); buf <<= t; cnt -= t; diff = v < (1 << (t - 1)) ? v - (1 << t) + 1 : v; }
      let pred;
      if (rowOfInterval === 0) pred = x === 0 || sinceRestart === 0 ? start : out[i - 1];
      else if (x === 0) pred = out[i - X];
      else {
        const a = out[i - 1], b = out[i - X], c = out[i - X - 1];
        pred = sel === 1 ? a : sel === 2 ? b : sel === 3 ? c : sel === 4 ? a + b - c : sel === 5 ? a + ((b - c) >> 1) : sel === 6 ? b + ((a - c) >> 1) : (a + b) >> 1;
      }
      out[i] = (pred + diff) & 0xFFFF; sinceRestart++;
    }
    rowOfInterval++;
  }
  if (pt) for (let k = 0; k < total; k++) out[k] <<= pt;
  return { data: out, width: X, height: Y, precision: P };
}
// ───────────── JPEG baseline / extended (DCT, Huffman, 8- or 12-bit) ─────────────
// Browsers decode only 8-bit JPEG, and 12-bit lossy JPEG ("JPEG Extended", 1.2.840.10008.1.2.4.51) is what several CBCT
// machines write (i-CAT among them), so the sequential DCT decoder is done here: frame and Huffman tables, restart markers,
// dequantisation, a separable 8×8 inverse DCT, level shift and clamping. Greyscale (one component) only; progressive and
// hierarchical JPEG are named, not read.
const ZIGZAG = Int32Array.from([0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63]);
const IDCT_C = (() => { const c = new Float64Array(64); for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) c[x * 8 + u] = (u ? 1 : Math.SQRT1_2) * Math.cos((2 * x + 1) * u * Math.PI / 16) / 2; return c; })();
/** decodeJpegDCT(bytes) → { data: Uint8Array | Uint16Array (width × height), width, height, precision } */
export function decodeJpegDCT(u8) {
  let p = 0; const n = u8.length, u16 = () => { const v = (u8[p] << 8) | u8[p + 1]; p += 2; return v; };
  if (u8[0] !== 0xFF || u8[1] !== 0xD8) throw new Error('not a JPEG stream'); p = 2;
  const qt = [], dc = [], ac = []; let P = 0, X = 0, Y = 0, comp = null, ri = 0, scan = null;
  while (p < n && !scan) {
    if (u8[p] !== 0xFF) { p++; continue; }
    const m = u8[p + 1]; p += 2;
    if (m === 0xFF || m === 0x00 || m === 0x01 || (m >= 0xD0 && m <= 0xD8)) { if (m === 0xFF) p--; continue; }
    const len = u16(), end = p + len - 2;
    if (m === 0xC0 || m === 0xC1) {
      P = u8[p]; Y = (u8[p + 1] << 8) | u8[p + 2]; X = (u8[p + 3] << 8) | u8[p + 4]; const nf = u8[p + 5];
      if (nf !== 1) throw new Error('Colour JPEG is not supported'); comp = { id: u8[p + 6], tq: u8[p + 8] };
    } else if (m === 0xC2 || m === 0xC6 || m === 0xCA || m === 0xCE) throw new Error('Progressive JPEG is not supported yet');
    else if (m === 0xC3) throw new Error('This JPEG is the lossless kind');
    else if ((m >= 0xC5 && m <= 0xCF) && m !== 0xC8 && m !== 0xCC) throw new Error('This kind of JPEG (hierarchical or arithmetic-coded) is not supported');
    else if (m === 0xDB) {
      let q = p;
      while (q < end) { const pq = u8[q] >> 4, tq = u8[q] & 15, t = new Float64Array(64); q++; for (let k = 0; k < 64; k++) { t[ZIGZAG[k]] = pq ? (u8[q] << 8) | u8[q + 1] : u8[q]; q += pq ? 2 : 1; } qt[tq] = t; }
    } else if (m === 0xC4) {
      let q = p;
      while (q < end) {
        const cls = u8[q] >> 4, id = u8[q] & 15, counts = u8.subarray(q + 1, q + 17); q += 17; let total = 0; for (let i = 0; i < 16; i++) total += counts[i];
        const look = new Uint16Array(65536); let code = 0, k = q;       // indexed by the next 16 bits: (code length << 8) | symbol
        for (let l = 1; l <= 16; l++) { for (let i = 0; i < counts[l - 1]; i++) { const sym = u8[k++], lo = code << (16 - l); look.fill((l << 8) | sym, lo, lo + (1 << (16 - l))); code++; } code <<= 1; }
        (cls ? ac : dc)[id] = look; q += total;
      }
    } else if (m === 0xDD) ri = (u8[p] << 8) | u8[p + 1];
    else if (m === 0xDA) { const ns = u8[p]; if (ns !== 1) throw new Error('Colour JPEG is not supported'); scan = { td: u8[p + 2] >> 4, ta: u8[p + 2] & 15 }; }
    p = end;
  }
  if (!scan || !comp || !X || !Y) throw new Error('JPEG: no image found');
  const q = qt[comp.tq], dcl = dc[scan.td], acl = ac[scan.ta]; if (!q || !dcl || !acl) throw new Error('JPEG: missing tables');
  const out = P > 8 ? new Uint16Array(X * Y) : new Uint8Array(X * Y), top = (1 << P) - 1, shift = 1 << (P - 1);
  const bw = Math.ceil(X / 8), bh = Math.ceil(Y / 8), coef = new Float64Array(64), tmp = new Float64Array(64);
  let buf = 0, cnt = 0;                                            // bit buffer: `cnt` valid bits at the top of a 32-bit word
  const fill = () => { while (cnt <= 24) { let b = 0; if (p < n) { b = u8[p]; if (b === 0xFF) { if (u8[p + 1] === 0) p += 2; else b = 0; } else p++; } buf |= b << (24 - cnt); cnt += 8; } };
  const decode = (look) => { fill(); const e = look[buf >>> 16], l = e >> 8; if (!l) throw new Error('JPEG: bad Huffman code'); buf <<= l; cnt -= l; return e & 255; };
  const receive = (s) => { fill(); const v = buf >>> (32 - s); buf <<= s; cnt -= s; return v < (1 << (s - 1)) ? v - (1 << s) + 1 : v; };
  let pred = 0, mcu = 0;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++, mcu++) {
    if (ri && mcu && mcu % ri === 0) {                             // a restart marker: bytes realign and the DC prediction starts again
      buf = 0; cnt = 0; while (p < n - 1 && !(u8[p] === 0xFF && u8[p + 1] >= 0xD0 && u8[p + 1] <= 0xD7)) p++; p += 2; pred = 0;
    }
    coef.fill(0);
    const t = decode(dcl); if (t) pred += receive(t); coef[0] = pred * q[0];
    for (let k = 1; k < 64;) {
      const rs = decode(acl), r = rs >> 4, s = rs & 15;
      if (!s) { if (r === 15) { k += 16; continue; } break; }
      k += r; if (k > 63) break; const z = ZIGZAG[k]; coef[z] = receive(s) * q[z]; k++;
    }
    for (let v = 0; v < 8; v++) {                                  // rows (horizontal frequencies), skipping empty ones
      const o = v * 8; let any = false; for (let u = 0; u < 8; u++) if (coef[o + u]) { any = true; break; }
      if (!any) { for (let x = 0; x < 8; x++) tmp[o + x] = 0; continue; }
      for (let x = 0; x < 8; x++) { const c = x * 8; let a = 0; for (let u = 0; u < 8; u++) a += IDCT_C[c + u] * coef[o + u]; tmp[o + x] = a; }
    }
    const x0 = bx * 8, y0 = by * 8;
    for (let x = 0; x < 8; x++) {                                  // columns
      const xx = x0 + x; if (xx >= X) break;
      for (let y = 0; y < 8; y++) {
        const yy = y0 + y; if (yy >= Y) break; const c = y * 8; let a = 0; for (let v = 0; v < 8; v++) a += IDCT_C[c + v] * tmp[v * 8 + x];
        const val = Math.round(a + shift); out[yy * X + xx] = val < 0 ? 0 : val > top ? top : val;
      }
    }
  }
  return { data: out, width: X, height: Y, precision: P };
}
async function decodeJpegBrowser(u8, n) {
  if (typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined') throw new Error('This browser cannot open JPEG-compressed slices');
  const bmp = await createImageBitmap(new Blob([u8], { type: 'image/jpeg' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, bmp.width, bmp.height).data, out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = d[4 * i]; if (bmp.close) bmp.close();
  return out;
}
const concat = (parts) => { if (parts.length === 1) return parts[0]; let n = 0; for (const a of parts) n += a.length; const o = new Uint8Array(n); let p = 0; for (const a of parts) { o.set(a, p); p += a.length; } return o; };
/** the compressed bytes of each frame of an encapsulated file */
function frameBytes(h) {
  const px = h.pixel, F = px.fragments, u8 = h.bytes, sub = ([p, l]) => u8.subarray(p, p + l);
  if (h.frames === 1) return [concat(F.map(sub))];
  if (F.length === h.frames) return F.map(sub);
  const starts = [];                                               // several fragments per frame: the offset table says where each frame starts, else a JPEG start-of-image does
  if (px.table.length === h.frames) for (let i = 0; i < F.length; i++) if (px.table.includes(F[i][0] - 8 - px.first)) starts.push(i);
  if (starts.length !== h.frames) { starts.length = 0; for (let i = 0; i < F.length; i++) if (u8[F[i][0]] === 0xFF && u8[F[i][0] + 1] === 0xD8) starts.push(i); }
  if (starts.length !== h.frames) throw new Error('The compressed frames could not be told apart');
  return starts.map((s, i) => concat(F.slice(s, i + 1 < starts.length ? starts[i + 1] : F.length).map(sub)));
}
/** Why a header cannot be decoded here, in words for the user — or '' when it can. */
export function unsupported(h) {
  const info = tsInfo(h.ts);
  if (info.unknown) return 'it uses a compression this viewer does not know';
  if (info.codec === null) return `it is compressed with ${info.name}, which this viewer cannot read yet`;
  if ((h.samples || 1) !== 1) return 'it is a colour image, not a scan';
  if (h.bitsAllocated !== 8 && h.bitsAllocated !== 16) return `it stores ${h.bitsAllocated}-bit values`;
  return '';
}
/** → a function frame(i) → typed array of the stored values (rows × cols), masked to the bits stored and sign-extended */
export function frameReader(h) {
  const n = h.rows * h.cols, info = tsInfo(h.ts), bytesPer = h.bitsAllocated / 8, why = unsupported(h); if (why) throw new Error('This series cannot be opened: ' + why + '.');
  const stored = h.bitsStored || h.bitsAllocated, signed = !!h.signed, mask = stored >= 16 ? 0xFFFF : (1 << stored) - 1, signBit = 1 << (stored - 1), mono1 = h.photometric === 'MONOCHROME1';
  const finish = (raw) => {                                        // raw: unsigned stored words
    let out = raw;
    if (signed) { out = new Int16Array(n); for (let i = 0; i < n; i++) { const v = raw[i] & mask; out[i] = v & signBit ? v - (mask + 1) : v; } }
    else if (mask !== (bytesPer === 2 ? 0xFFFF : 0xFF) || mono1) { out = bytesPer === 2 ? new Uint16Array(n) : new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = raw[i] & mask; }
    if (mono1) { const top = signed ? -1 : mask; for (let i = 0; i < n; i++) out[i] = top - out[i]; }
    return out;
  };
  if (!h.pixel.encapsulated) {
    const u8 = h.bytes, base = h.pixel.offset, dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), le = !h.big;
    return async (f) => {
      const p = base + f * n * bytesPer; if (p + n * bytesPer > u8.length) throw new Error('The file is shorter than its header says');
      if (bytesPer === 1) return finish(u8.subarray(p, p + n));
      const raw = new Uint16Array(n);
      if (le && (u8.byteOffset + p) % 2 === 0) raw.set(new Uint16Array(u8.buffer, u8.byteOffset + p, n)); else for (let i = 0; i < n; i++) raw[i] = dv.getUint16(p + 2 * i, le);
      return finish(raw);
    };
  }
  const frames = frameBytes(h);
  return async (f) => {
    const b = frames[f];
    if (info.codec === 'rle') return finish(decodeRLE(b, n, bytesPer));
    if (info.codec === 'jpegll') { const r = decodeJpegLossless(b); if (r.width * r.height !== n) throw new Error('JPEG Lossless: the image size does not match the header'); return finish(r.data); }
    if (h.bitsAllocated === 16 || typeof createImageBitmap === 'undefined') {   // 12-bit lossy JPEG (and any JPEG where the browser can't decode it): done here
      const r = decodeJpegDCT(b); if (r.width * r.height !== n) throw new Error('JPEG: the image size does not match the header'); return finish(r.data);
    }
    return finish(await decodeJpegBrowser(b, n));
  };
}

// ───────────────────────────── zip, read entry by entry ─────────────────────────────
/** zipEntries(blob) → [{ name, size, arrayBuffer() }]: each entry is inflated only when it is asked for, so a zip of a
 *  whole scan never sits in memory twice. Stored and deflated entries; no zip64, no encryption. */
export async function zipEntries(blob) {
  const size = blob.size, tailN = Math.min(size, 65557), tail = new Uint8Array(await blob.slice(size - tailN).arrayBuffer()), tv = new DataView(tail.buffer);
  let p = tail.length - 22; while (p >= 0 && tv.getUint32(p, true) !== 0x06054b50) p--;
  if (p < 0) throw new Error('That is not a zip file');
  const n = tv.getUint16(p + 10, true), cdSize = tv.getUint32(p + 12, true), cdOff = tv.getUint32(p + 16, true);
  if (cdOff === 0xFFFFFFFF || n === 0xFFFF) throw new Error('That zip is too large to open here (zip64): unzip it and choose the folder instead');
  const cd = new Uint8Array(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer()), dv = new DataView(cd.buffer), out = []; let c = 0;
  for (let i = 0; i < n && c + 46 <= cd.length; i++) {
    if (dv.getUint32(c, true) !== 0x02014b50) break;
    const flags = dv.getUint16(c + 8, true), method = dv.getUint16(c + 10, true), csz = dv.getUint32(c + 20, true), usz = dv.getUint32(c + 24, true), nl = dv.getUint16(c + 28, true), xl = dv.getUint16(c + 30, true), cl = dv.getUint16(c + 32, true), lo = dv.getUint32(c + 42, true);
    const name = new TextDecoder().decode(cd.subarray(c + 46, c + 46 + nl)); c += 46 + nl + xl + cl;
    if (name.endsWith('/') || /(^|\/)(__MACOSX\/|\.DS_Store$)/.test(name)) continue;
    out.push({ name, size: usz, async arrayBuffer() {
      if (flags & 1) throw new Error('That zip is password-protected');
      const lh = new DataView(await blob.slice(lo, lo + 30).arrayBuffer()), ds = lo + 30 + lh.getUint16(26, true) + lh.getUint16(28, true), raw = blob.slice(ds, ds + csz);
      if (method === 0) return raw.arrayBuffer();
      if (method !== 8) throw new Error('Unsupported zip compression');
      return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    } });
  }
  return out;
}
export async function looksLikeZip(file) { if (!file.slice) return false; const b = new Uint8Array(await file.slice(0, 4).arrayBuffer()); return b[0] === 0x50 && b[1] === 0x4B && b[2] === 3 && b[3] === 4; }

// ───────────────────────────── series ─────────────────────────────
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const tick = () => new Promise((r) => setTimeout(r, 0));
/** The technical header of a file, reading no more of it than needed. → header (without its bytes) | null */
async function readHeader(file) {
  let n = 1 << 16;
  for (;;) {
    const whole = !file.slice || n >= file.size, buf = whole ? await file.arrayBuffer() : await file.slice(0, n).arrayBuffer();
    const h = await parseDicom(buf, { partial: !whole });
    if (h && h.truncated) { if (whole) return null; n *= 8; continue; }
    if (h) { h.bytes = null; h.whole = whole; }
    return h;
  }
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const okVec = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);
/**
 * scanSeries(files, onProgress(done, total)) → { series:[{ id, modality, rows, cols, count, compression, reason, date, items }], skipped }
 * Files that are not DICOM images are passed over. The largest readable series comes first. Nothing identifying is kept.
 */
export async function scanSeries(files, onProgress) {
  const map = new Map(); let skipped = 0, last = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i]; let h = null;
    try { h = await readHeader(f); } catch (_) { h = null; }
    if (!h) skipped++;
    else {
      const iop = okVec(h.iop, 6) ? h.iop.map((v) => Math.round(v * 100)).join(',') : '', key = hash(`${h.seriesUid || ''}|${h.rows}x${h.cols}|${iop}|${h.ts}|${h.frames > 1 ? i : ''}`);
      delete h.seriesUid;                                          // only its hash was needed
      let s = map.get(key); if (!s) map.set(key, s = { id: key, modality: /^[A-Z]{2,4}$/.test(h.modality || '') ? h.modality : '', rows: h.rows, cols: h.cols, count: 0, ts: h.ts, compression: tsInfo(h.ts).name, reason: unsupported(h), date: /^\d{8}$/.test(h.studyDate || '') ? h.studyDate : '', items: [] });
      s.items.push({ file: f, h }); s.count += h.frames;
    }
    if (onProgress && (i - last >= 16 || i === files.length - 1)) { last = i; onProgress(i + 1, files.length); await tick(); }
  }
  const series = [...map.values()].sort((a, b) => (!!a.reason - !!b.reason) || (b.count * b.rows * b.cols - a.count * a.rows * a.cols));
  return { series, skipped };
}

/**
 * loadVolume(series, onProgress(done, total)) → the volume:
 *   data     Int16Array, value at (i, j, k) = data[i + nx·(j + ny·k)] + shift   (shift is 0 unless the values need more than 16 signed bits)
 *   dims     [nx, ny, nz]      spacing [sx, sy, sz] mm
 *   origin   patient position (LPS, mm) of voxel (0, 0, 0); voxel (i, j, k) is at origin + (i·sx, j·sy, k·sz):
 *            the volume is turned on loading so that +i is the patient's left, +j posterior and +k up
 *   min, max (of data), modality, date, compression, warnings[]
 *   guessed  true when the files gave no slice positions and the first slice was taken as the top (see flipStack)
 */
export async function loadVolume(series, onProgress) {
  if (series.reason) throw new Error('This series cannot be opened: ' + series.reason + '. Export it from the CBCT software as uncompressed DICOM and try again.');
  const h0 = series.items[0].h, nx = series.cols, ny = series.rows, warnings = [];
  const iop = okVec(h0.iop, 6) ? h0.iop : (h0.shared && h0.shared[0] && h0.shared[0].planeOrientation && okVec(h0.shared[0].planeOrientation[0].iop, 6) ? h0.shared[0].planeOrientation[0].iop : null);
  const R = iop ? iop.slice(0, 3) : [1, 0, 0], C = iop ? iop.slice(3, 6) : [0, 1, 0], Nn = cross(R, C);
  if (!iop) warnings.push('The files do not say which way the scan faces: left/right and front/back are assumed.');
  // every slice: which file and frame, and where it lies along the stack
  const slices = []; let havePos = true, guessed = false;
  for (const it of series.items) {
    const h = it.h, sh = (h.shared && h.shared[0]) || {}, pm = (sh.pixelMeasures && sh.pixelMeasures[0]) || {};
    const step = pm.spacingBetween || h.spacingBetween || pm.sliceThickness || h.sliceThickness || 0;
    for (let f = 0; f < h.frames; f++) {
      let ipp = null;
      if (h.frames > 1) {
        const pf = h.perFrame && h.perFrame[f], pp = pf && pf.planePosition && pf.planePosition[0];
        if (pp && okVec(pp.ipp, 3)) ipp = pp.ipp;
        else if (okVec(h.ipp, 3)) { const off = Array.isArray(h.frameOffsets) && h.frameOffsets.length === h.frames ? h.frameOffsets[f] - h.frameOffsets[0] : f * step; ipp = [h.ipp[0] + Nn[0] * off, h.ipp[1] + Nn[1] * off, h.ipp[2] + Nn[2] * off]; if (!step && !Array.isArray(h.frameOffsets)) havePos = false; }
      } else if (okVec(h.ipp, 3)) ipp = h.ipp;
      if (!ipp) havePos = false;
      slices.push({ it, f, ipp, d: ipp ? dot(ipp, Nn) : 0, order: (h.instance || 0) * 4096 + f });
    }
  }
  const pm0 = (h0.shared && h0.shared[0] && h0.shared[0].pixelMeasures && h0.shared[0].pixelMeasures[0]) || {};
  const ps = okVec(h0.pixelSpacing, 2) ? h0.pixelSpacing : okVec(pm0.pixelSpacing, 2) ? pm0.pixelSpacing : null;
  if (!ps) warnings.push('The files do not give a pixel size: 1 mm is assumed, so measurements are not in real millimetres.');
  const sx = ps ? ps[1] : 1, sy = ps ? ps[0] : 1; let sz;
  if (havePos) {
    slices.sort((a, b) => a.d - b.d);
    for (let i = slices.length - 1; i > 0; i--) if (Math.abs(slices[i].d - slices[i - 1].d) < 1e-4) slices.splice(i, 1);   // the same slice twice
    const gaps = []; for (let i = 1; i < slices.length; i++) gaps.push(slices[i].d - slices[i - 1].d);
    const sorted = gaps.slice().sort((a, b) => a - b); sz = sorted.length ? Math.round(sorted[sorted.length >> 1] * 1e5) / 1e5 : (h0.sliceThickness || sx);
    if (gaps.some((g) => Math.abs(g - sz) > 0.05 * sz + 1e-3)) warnings.push('The slices are not evenly spaced (some may be missing): distances up and down may be wrong.');
  } else {
    // No positions in the files: the numbered order is all there is to go by. The CBCT units that write such files (one file,
    // every slice a frame, no positions) number the slices from the top of the head down, so the first is taken as the top:
    // where the slices' own normal points up, the stack runs against the numbers. That is a guess (guessed: true below), and
    // flipStack turns the scan over if it is wrong.
    slices.sort((a, b) => a.order - b.order); if (Math.abs(Nn[2]) > 0.7 && Nn[2] > 0) slices.reverse(); guessed = true;
    sz = pm0.spacingBetween || h0.spacingBetween || pm0.sliceThickness || h0.sliceThickness || sx;
    warnings.push('The files do not say where each slice lies: the first slice is taken as the top. If the scan is upside-down, turn it over with “Flip top to bottom”.');
  }
  const nz = slices.length; if (nz < 2) throw new Error('Only one slice was found: a CBCT volume needs the whole series.');
  if (nx * ny * nz > MAX_VOXELS) throw new Error(`This scan is too large to open here (${Math.round(nx * ny * nz / 1e6)} million voxels; the limit is ${MAX_VOXELS / 1e6} million).`);
  let data; try { data = new Int16Array(nx * ny * nz); } catch (_) { throw new Error('Not enough memory to open this scan on this device: close other tabs and try again, or use a computer with more memory.'); }
  // values: stored × slope + intercept, kept as 16-bit signed numbers (with one shift for the whole volume if they would not fit)
  const pv0 = (h0.shared && h0.shared[0] && h0.shared[0].pixelValue && h0.shared[0].pixelValue[0]) || {};
  const rescale = (h) => { const s = Number.isFinite(h.slope) ? h.slope : Number.isFinite(pv0.slope) ? pv0.slope : 1, b = Number.isFinite(h.intercept) ? h.intercept : Number.isFinite(pv0.intercept) ? pv0.intercept : 0; return [s || 1, b]; };
  // Most scans fit 16 signed bits as they are. Whether this one does is judged from the values of its middle slice (not from
  // what its bits could hold: a 16-bit unsigned CT with an intercept of −1024 could reach 64511 but never does). If they do not
  // fit, one shift is taken off the whole volume (value = data + shift) and anything still outside is clipped, with a warning.
  const mid = slices[slices.length >> 1], [sm, bm] = rescale(mid.it.h); let shift = 0;
  try {
    const hm = mid.it.h.pixel.encapsulated || mid.it.h.frames === 1 || !mid.it.file.slice ? await parseDicom(await mid.it.file.arrayBuffer()) : null;
    let raw; if (hm) raw = await frameReader(hm)(mid.f); else { const fl = mid.it.h.rows * mid.it.h.cols * (mid.it.h.bitsAllocated / 8), off = mid.it.h.pixel.offset + mid.f * fl; raw = await frameReader({ ...mid.it.h, frames: 1, bytes: new Uint8Array(await mid.it.file.slice(off, off + fl).arrayBuffer()), pixel: { offset: 0, length: fl, encapsulated: false } })(0); }
    let a = Infinity, b = -Infinity; for (let i = 0; i < raw.length; i++) { const v = raw[i] * sm + bm; if (v < a) a = v; if (v > b) b = v; }
    if (a < -32000 || b > 32000) shift = Math.round((a + b) / 2);
  } catch (_) { shift = 0; }
  let min = 32767, max = -32768, clipped = false, done = 0;
  const put = (k, raw, h) => {
    const [s, b] = rescale(h), o = k * nx * ny, n = nx * ny, add = b - shift;
    if (s === 1 && Number.isInteger(add)) for (let i = 0; i < n; i++) { let v = raw[i] + add; if (v > 32767) { v = 32767; clipped = true; } else if (v < -32768) { v = -32768; clipped = true; } data[o + i] = v; if (v < min) min = v; if (v > max) max = v; }
    else for (let i = 0; i < n; i++) { let v = Math.round(raw[i] * s + add); if (v > 32767) { v = 32767; clipped = true; } else if (v < -32768) { v = -32768; clipped = true; } data[o + i] = v; if (v < min) min = v; if (v > max) max = v; }
  };
  const byItem = new Map(); slices.forEach((s, k) => { if (!byItem.has(s.it)) byItem.set(s.it, []); byItem.get(s.it).push([s.f, k]); });
  for (const [it, list] of byItem) {
    const h = it.h, file = it.file, frameLen = h.rows * h.cols * (h.bitsAllocated / 8);
    if (h.rows !== ny || h.cols !== nx) throw new Error('The slices of this series are not all the same size.');
    if (h.frames > 1 && !h.pixel.encapsulated && !tsInfo(h.ts).deflated && file.slice && file.size > 96e6) {
      // a large uncompressed multi-frame file: read a few frames at a time rather than the whole file at once
      const hh = { ...h, frames: 1 }; list.sort((a, b) => a[0] - b[0]);
      for (let a = 0; a < list.length;) {
        let b = a; while (b + 1 < list.length && list[b + 1][0] === list[b][0] + 1 && b - a < 15) b++;
        const off = h.pixel.offset + list[a][0] * frameLen, buf = new Uint8Array(await file.slice(off, off + (b - a + 1) * frameLen).arrayBuffer());
        for (let q = a; q <= b; q++) { const rd = frameReader({ ...hh, bytes: buf, pixel: { offset: (q - a) * frameLen, length: frameLen, encapsulated: false } }); put(list[q][1], await rd(0), h); }
        done += b - a + 1; a = b + 1; if (onProgress) { onProgress(done, nz); await tick(); }
      }
      continue;
    }
    const full = await parseDicom(await file.arrayBuffer()); if (!full) throw new Error('A file of the series could not be read.');
    const rd = frameReader(full);
    for (const [f, k] of list) { put(k, await rd(f), h); done++; if (onProgress && (done % 8 === 0 || done === nz)) { onProgress(done, nz); await tick(); } }
  }
  if (clipped) warnings.push('Some values were outside the range that can be shown and were clipped.');
  let vol = { data, dims: [nx, ny, nz], spacing: [sx, sy, sz], origin: slices[0].ipp ? slices[0].ipp.slice() : [0, 0, 0], min, max, shift, modality: series.modality, date: series.date, compression: series.compression, warnings };
  if (guessed) vol.guessed = true;
  vol = reorient(vol, [R, C, Nn]);
  return vol;
}
/** Turn the volume so its axes are the patient's: +i left, +j posterior, +k up (a copy is made only when a turn is needed). */
export function reorient(vol, dirs) {
  const m = [0, 1, 2], sgn = [1, 1, 1], used = new Set(); let tilt = 0;
  for (let a = 0; a < 3; a++) { let best = -1, bv = -1; for (let j = 0; j < 3; j++) { const v = Math.abs(dirs[j][a]); if (!used.has(j) && v > bv) { bv = v; best = j; } } used.add(best); m[a] = best; sgn[a] = dirs[best][a] < 0 ? -1 : 1; tilt = Math.max(tilt, Math.acos(Math.min(1, bv)) * 180 / Math.PI); }
  if (tilt > 2) vol.warnings.push(`The scan is tilted ${tilt.toFixed(0)}° in its own coordinates: it is shown along its own axes.`);
  const n = vol.dims, S = vol.spacing, o = [0, 0, 0]; for (let a = 0; a < 3; a++) o[m[a]] = sgn[a] > 0 ? 0 : n[m[a]] - 1;
  const origin = [0, 1, 2].map((c) => vol.origin[c] + o[0] * S[0] * dirs[0][c] + o[1] * S[1] * dirs[1][c] + o[2] * S[2] * dirs[2][c]);
  if (m[0] === 0 && m[1] === 1 && m[2] === 2) {                 // the axes are in order: at most some of them run backwards — turned in place, no copy
    const [nx, ny, nz] = n, d = vol.data, sl = nx * ny;
    if (sgn[2] < 0) { const tmp = new Int16Array(sl); for (let k = 0; k < nz >> 1; k++) { const a = k * sl, b = (nz - 1 - k) * sl; tmp.set(d.subarray(a, a + sl)); d.copyWithin(a, b, b + sl); d.set(tmp, b); } }
    if (sgn[1] < 0) { const tmp = new Int16Array(nx); for (let k = 0; k < nz; k++) for (let j = 0; j < ny >> 1; j++) { const a = k * sl + j * nx, b = k * sl + (ny - 1 - j) * nx; tmp.set(d.subarray(a, a + nx)); d.copyWithin(a, b, b + nx); d.set(tmp, b); } }
    if (sgn[0] < 0) for (let r = 0; r < ny * nz; r++) d.subarray(r * nx, (r + 1) * nx).reverse();
    return { ...vol, origin };
  }
  const nn = [n[m[0]], n[m[1]], n[m[2]]], st = [1, n[0], n[0] * n[1]], out = new Int16Array(vol.data.length), src = vol.data;
  const s0 = st[m[0]] * sgn[0], s1 = st[m[1]] * sgn[1], s2 = st[m[2]] * sgn[2], base = o[0] * st[0] + o[1] * st[1] + o[2] * st[2]; let q = 0;
  for (let k = 0; k < nn[2]; k++) for (let j = 0; j < nn[1]; j++) { let p = base + k * s2 + j * s1; for (let i = 0; i < nn[0]; i++, p += s0) out[q++] = src[p]; }
  return { ...vol, data: out, dims: nn, spacing: [S[m[0]], S[m[1]], S[m[2]]], origin };
}

// ───────────────────────────── the phantom: a made-up lower jaw ─────────────────────────────
// A horseshoe of bone (cortex over spongy bone) with fourteen teeth: enamel caps, dentine, a pulp chamber and canal, roots
// in sockets with a thin dark periodontal ligament space and a bright socket lining. All of it is plain geometry, so the
// tests know exactly where everything is. Coordinates are the patient's (LPS, mm): +X left, +Y posterior, +Z up.
export const PHANTOM = { air: -1000, soft: 60, spongy: 550, cortex: 1300, pdl: 150, pulp: 80, dentine: 1700, enamel: 2800, pdlWidth: 0.3, crest: 0, boneBottom: -17, boneHalf: 5.6 };
// A second set of values and shapes, "clinical": measured from a real 0.25 mm CBCT (i-CAT) — what each tissue reads once the
// scanner's blur is allowed for, the blur itself (a Gaussian of sigma 0.32 mm in the slice, 0.28 mm along the axis) and the
// noise (sd 27, smooth over about a voxel). Narrow canals, a thin ligament space, bone as bright as dentine: what a real
// scan gives the tooth and canal finders to work with.
export const CLINICAL = { air: -1000, soft: 60, spongy: 550, marrow: 220, trabecula: 980, cortex: 1300, pdl: 60, pulp: 60, dentine: 1350, enamel: 2900, pdlWidth: 0.2, lining: 0.3, cortexWidth: 1.5, crest: 0, boneBottom: -17, boneHalf: 5.6, blur: 0.32, blurZ: 0.28, noise: 27, noiseBlur: 0.26, noiseBlurZ: 0.19 };
const TEETH = [ // one side, from the midline back: name digit, mesiodistal width, buccolingual width, root length, crown height, two roots?
  [1, 5.4, 6.0, 12.0, 9.0, 0], [2, 6.0, 6.3, 13.0, 9.2, 0], [3, 7.0, 7.6, 15.0, 10.0, 0], [4, 7.0, 7.8, 13.5, 8.4, 0], [5, 7.2, 8.2, 14.0, 8.0, 0], [6, 10.8, 10.0, 12.5, 7.4, 1], [7, 10.2, 9.8, 12.0, 7.0, 1],
];
function archLine() {                                             // the centre line of the arch, right to left, as a dense polyline with its arc length
  const a = 24, b = 27, leg = 17, pts = [];
  for (let i = 40; i >= 1; i--) pts.push([-(a + 2 * i / 40), leg * i / 40]);
  for (let i = 0; i <= 160; i++) { const t = -Math.PI / 2 + Math.PI * i / 160; pts.push([a * Math.sin(t), -b * Math.cos(t)]); }
  for (let i = 1; i <= 40; i++) pts.push([a + 2 * i / 40, leg * i / 40]);
  const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, s, length: s[s.length - 1] };
}
function archAt(L, s) {                                           // point and unit tangent at arc length s
  const S = L.s; let lo = 0, hi = S.length - 1; s = Math.max(0, Math.min(L.length, s));
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
  const t = (s - S[lo]) / ((S[hi] - S[lo]) || 1), a = L.pts[lo], b = L.pts[hi], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
  return { p: [a[0] + dx * t, a[1] + dy * t], t: [dx / l, dy / l] };
}
const sminK = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
function roundCone(px, py, pz, a, b, r1, r2) {                    // exact distance to a cone with rounded ends between a (radius r1) and b (radius r2)
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2], l2 = bax * bax + bay * bay + baz * baz, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2], y = pax * bax + pay * bay + paz * baz, z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y, x2 = qx * qx + qy * qy + qz * qz, y2 = y * y * l2, z2 = z * z * l2, k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
const ellipsoid = (x, y, z, rx, ry, rz) => { const a = x / rx, b = y / ry, c = z / rz, k0 = Math.sqrt(a * a + b * b + c * c), d = a / rx, e = b / ry, f = c / rz, k1 = Math.sqrt(d * d + e * e + f * f); return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz); };
/** distance to a chain of round cones through pts = [[a, b, c, radius], …] */
function chain(a, b, c, pts) { let d = Infinity; for (let i = 0; i + 1 < pts.length; i++) { const v = roundCone(a, b, c, pts[i], pts[i + 1], pts[i][3], pts[i + 1][3]); if (v < d) d = v; } return d; }
const cappedCyl = (a, b, c, c0, hh, r) => { const dr = Math.hypot(a, b) - r, dz = Math.abs(c - c0) - hh; return Math.min(Math.max(dr, dz), 0) + Math.hypot(Math.max(dr, 0), Math.max(dz, 0)); };
/**
 * The clinical shapes of a tooth, in its own coordinates (a towards +u, b towards the tongue, c up the axis from the bone crest):
 * { lobes: [chain, …] (each root, or each half of a figure-of-eight root, as a chain of round cones, curving at the apex),
 *   trunk: { c0, hh, r } | null, canals: [chain, …] (one per lobe, from inside the chamber to about a millimetre short of the
 *   apex, tapering from about 0.9 mm across to 0.25 mm), horns: [chain, …], chamber: { c, ra, rb, rc }, roots (how many) }
 * dist: +1 or −1, which way along a is distal. Lower molars have a figure-of-eight mesial root with two canals and a distal
 * root; with three (46) the distal root is two separate roots.
 */
function clinicalShape(t, d, dist) {
  const R = t.root, md = t.md, bl = t.bl, m = -dist;
  if (!t.two) {
    const R0 = 0.40 * Math.min(md, bl), bend = 0.5 + 0.1 * d;
    return { roots: 1, trunk: null, chamber: { c: 2.6, ra: md / 5.5, rb: bl / 5.5, rc: 1.7 }, horns: [],
      lobes: [[[0, 0, 1.5, R0], [0.25 * bend * dist, 0, -0.45 * R, 0.72 * R0], [bend * dist, 0.2, -R + 0.7, 0.55]]],
      canals: [[[0, 0, 2.4, 0.5], [0.08 * bend * dist, 0, -0.2 * R, 0.3], [0.25 * bend * dist, 0, -0.45 * R, 0.2], [0.85 * bend * dist, 0.17, -R + 1.25, 0.125]]] };
  }
  const off = 0.27 * md, s = 0.16 * bl, three = t.name === 46, lobes = [], canals = [];
  for (const sb of [-1, 1]) {                                       // the mesial root: two lobes that run into one another, a canal in each
    lobes.push([[m * off * 0.85, sb * s, 1.0, 2.0], [m * off * 1.05, sb * s * 0.95, -0.5 * R, 1.45], [m * off * 0.93, sb * s * 0.8, -R + 0.7, 0.6]]);
    canals.push([[m * 1.2, sb * 0.9, 1.1, 0.45], [m * off * 0.8, sb * s, -1.6, 0.34], [m * off * 1.05, sb * s * 0.95, -0.5 * R, 0.2], [m * off * 0.95, sb * s * 0.82, -R + 1.3, 0.12]]);
  }
  if (three) for (const sb of [-1, 1]) {                            // two separate distal roots
    const len = sb > 0 ? 0.88 * R : R;
    lobes.push([[dist * off * 0.85, sb * 1.7, 1.0, 1.65], [dist * off * 1.1, sb * 2.2, -0.5 * len, 1.25], [dist * off * 1.2, sb * 2.5, -len + 0.9, 0.55]]);
    canals.push([[dist * 1.2, sb * 0.9, 1.1, 0.45], [dist * off * 0.85, sb * 1.8, -1.6, 0.36], [dist * off * 1.1, sb * 2.2, -0.5 * len, 0.22], [dist * off * 1.19, sb * 2.45, -len + 1.5, 0.13]]);
  } else {
    lobes.push([[dist * off * 0.85, 0, 1.0, 2.15], [dist * off * 1.1, 0, -0.5 * R, 1.6], [dist * off * 1.25, 0, -R + 0.9, 0.65]]);
    canals.push([[dist * 1.2, 0, 1.1, 0.55], [dist * off * 0.85, 0, -1.6, 0.42], [dist * off * 1.1, 0, -0.5 * R, 0.26], [dist * off * 1.23, 0, -R + 1.5, 0.14]]);
  }
  const horns = []; for (const sa of [-1, 1]) for (const sb of [-1, 1]) horns.push([[sa * 1.2, sb * 1.0, 3.0, 0.35], [sa * md * 0.25, sb * bl * 0.22, 4.5, 0.1]]);
  return { roots: three ? 3 : 2, trunk: { c0: -0.8, hh: 2.0, r: 0.38 * md }, chamber: { c: 2.2, ra: md / 5.5, rb: bl / 5.5, rc: 1.5 }, horns, lobes, canals };
}
/**
 * The phantom's teeth with their frames: [{ name (FDI), s, base:[x,y,0], u (mesiodistal), v (buccolingual), w (axis, up), md, bl, root, crown, two }]
 * { clinical: true }: each also has clin, its clinical shapes (clinicalShape): the fields below then follow those.
 */
export function phantomTeeth(o = {}) {
  const L = archLine(), mid = L.length / 2, out = [];
  for (const side of [-1, 1]) {
    let s = 0.1;                                                    // from the midline outwards
    TEETH.forEach(([d, md, bl, root, crown, two], i) => {
      const name = (side > 0 ? 30 : 40) + d, gap = (side > 0 && d === 6) ? -0.15 : (i % 2 ? 0.3 : 0.2);   // 35 and 36 are in tight contact
      if (i > 0) s += gap; const sc = s + md / 2; s += md;
      const at = archAt(L, mid + side * sc), u = [at.t[0], at.t[1], 0], v0 = [-at.t[1], at.t[0], 0];        // v0 points towards the tongue side on one half, the cheek on the other: fix below
      const inward = (0 - at.p[0]) * v0[0] + (4 - at.p[1]) * v0[1] > 0 ? 1 : -1, v = [v0[0] * inward, v0[1] * inward, 0];   // v: towards the tongue
      const tu = 0.05 * Math.sin(1.7 * d + side), tv = 0.09 + 0.03 * Math.cos(2.3 * d), wl = Math.hypot(1, tu, tv), w = [(tu * u[0] + tv * v[0]) / wl, (tu * u[1] + tv * v[1]) / wl, 1 / wl];
      // an orthonormal frame about the tilted axis
      const ud = u[0] * w[0] + u[1] * w[1] + u[2] * w[2], u2 = [u[0] - ud * w[0], u[1] - ud * w[1], u[2] - ud * w[2]], ul = Math.hypot(...u2), uu = u2.map((c) => c / ul), vv = cross(w, uu);
      const t = { name, side, s: mid + side * sc, base: [at.p[0], at.p[1], PHANTOM.crest], u: uu, v: vv, w, md, bl, root, crown, two: !!two };
      if (o.clinical) t.clin = clinicalShape(t, d, uu[0] * at.t[0] + uu[1] * at.t[1] > 0 ? side : -side);   // (the arch line runs right to left: distal is along it on the left side, against it on the right)
      out.push(t);
    });
  }
  return out.sort((a, b) => a.s - b.s);
}
/** A tooth's outer surface as a field: negative inside, positive outside, close to millimetres near the surface. Local coordinates. */
function toothLocal(t, a, b, c) {
  const hc = t.crown / 2 + 0.5, crown = ellipsoid(a, b, c - (hc - 0.9), t.md / 2, t.bl / 2, hc);
  if (t.clin) { let d = crown; if (t.clin.trunk) d = sminK(d, cappedCyl(a, b, c, t.clin.trunk.c0, t.clin.trunk.hh, t.clin.trunk.r), 1.0); for (const L of t.clin.lobes) d = sminK(d, chain(a, b, c, L), 0.9); return d; }
  let root;
  if (t.two) { const r = 0.36 * Math.min(t.md / 2, t.bl) , off = t.md * 0.27; root = Math.min(roundCone(a, b, c, [-off, 0, 1.5], [-off * 1.15, 0, -t.root + 0.8], r, 0.8), roundCone(a, b, c, [off, 0, 1.5], [off * 1.15, 0, -t.root + 0.8], r, 0.8)); }
  else root = roundCone(a, b, c, [0, 0, 1.5], [0, 0, -t.root + 0.8], 0.40 * Math.min(t.md, t.bl), 0.8);
  return sminK(crown, root, 1.2);
}
const toLocal = (t, x, y, z) => { const dx = x - t.base[0], dy = y - t.base[1], dz = z - t.base[2]; return [dx * t.u[0] + dy * t.u[1] + dz * t.u[2], dx * t.v[0] + dy * t.v[1] + dz * t.v[2], dx * t.w[0] + dy * t.w[1] + dz * t.w[2]]; };
/** phantomToothField(tooth) → f(x, y, z): the tooth's surface field in patient coordinates (negative inside) */
export function phantomToothField(t) { return (x, y, z) => { const [a, b, c] = toLocal(t, x, y, z); return toothLocal(t, a, b, c); }; }
/** the pulp (chamber and canals) as a field, negative inside. Local coordinates. */
function pulpLocal(t, a, b, c) {
  if (t.clin) { const ch = t.clin.chamber; let p = ellipsoid(a, b, c - ch.c, ch.ra, ch.rb, ch.rc); for (const L of t.clin.canals) p = Math.min(p, chain(a, b, c, L)); for (const L of t.clin.horns) p = Math.min(p, chain(a, b, c, L)); return p; }
  let p = ellipsoid(a, b, c - 3.2, t.md / 5.5, t.bl / 5.5, 1.7);
  if (t.two) { const off = t.md * 0.27; p = Math.min(p, roundCone(a, b, c, [-off, 0, 3], [-off * 1.15, 0, -t.root + 2.2], 0.45, 0.3), roundCone(a, b, c, [off, 0, 3], [off * 1.15, 0, -t.root + 2.2], 0.45, 0.3)); }
  else p = Math.min(p, roundCone(a, b, c, [0, 0, 3], [0, 0, -t.root + 2.2], 0.5, 0.3));
  return p;
}
/** phantomPulpField(tooth) → f(x, y, z): the pulp chamber and canals in patient coordinates (negative inside) */
export function phantomPulpField(t) { return (x, y, z) => { const [a, b, c] = toLocal(t, x, y, z); return pulpLocal(t, a, b, c); }; }
/** what a point inside a tooth is made of → [value, margin]: margin is about how far (mm) the point is from where that changes */
function toothMaterial(t, a, b, c, T) {
  const p = pulpLocal(t, a, b, c);
  if (t.clin) {                                                     // (dentine a few per cent brighter or darker from place to place, as on a real scan)
    if (p < 0) return [CLINICAL.pulp, -p]; const hc = t.crown / 2 + 0.5, ce = ellipsoid(a, b, c - (hc - 0.9), t.md / 2, t.bl / 2, hc), en = c > 1.6 && T > -1.3 && ce > -1.3;
    return [en ? CLINICAL.enamel : CLINICAL.dentine * (1 + 0.05 * Math.sin(0.8 * a + 0.45 * c + t.name)), Math.min(p, Math.abs(c - 1.6), Math.abs(T + 1.3), Math.abs(ce + 1.3))];
  }
  if (p < 0) return [PHANTOM.pulp, -p];
  const hc = t.crown / 2 + 0.5, ce = ellipsoid(a, b, c - (hc - 0.9), t.md / 2, t.bl / 2, hc);
  return [c > 1.6 && T > -1.3 && ce > -1.3 ? PHANTOM.enamel : PHANTOM.dentine, Math.min(p, Math.abs(c - 1.6), Math.abs(T + 1.3), Math.abs(ce + 1.3))];
}
/** smooth random values in [0, 1) at any point (the same for the same point): for the texture of spongy bone */
function vnoise(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), sm = (t) => t * t * (3 - 2 * t), tx = sm(x - i), ty = sm(y - j), tz = sm(z - k);
  const hsh = (a, b, c) => { let q = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1274126177)) | 0; q = Math.imul(q ^ (q >>> 13), 1274126177); return ((q ^ (q >>> 16)) >>> 0) / 4294967296; };
  const l = (p, q, t) => p + (q - p) * t;
  return l(l(l(hsh(i, j, k), hsh(i + 1, j, k), tx), l(hsh(i, j + 1, k), hsh(i + 1, j + 1, k), tx), ty), l(l(hsh(i, j, k + 1), hsh(i + 1, j, k + 1), tx), l(hsh(i, j + 1, k + 1), hsh(i + 1, j + 1, k + 1), tx), ty), tz);
}
/**
 * makePhantom({ voxel = 0.3, noise = 25, seed = 7, sub = 3 }) → { vol, truth }
 *   vol    as loadVolume gives it (modality 'CT')
 *   truth  { teeth (phantomTeeth()), arch:{ pts, s, length }, values: PHANTOM, bounds, boneField(x, y, z) (negative inside the bone) }
 * Each voxel near a boundary is the average of sub³ samples, as a real scanner averages what lies inside a voxel.
 * { clinical: true, voxel = 0.25 }: the same jaw as a real scanner shows it (CLINICAL): teeth with curved roots, a trunk and
 * narrow tapering canals that join the chamber (46 has three roots), a 0.2 mm ligament space with a thin socket lining,
 * spongy bone with a texture of trabeculae and marrow, the scanner's blur and its smooth noise, air clipped at −1000.
 * blur, blurZ, noise override the measured values.
 */
export function makePhantom(o = {}) {
  const clin = !!o.clinical, h = o.voxel || (clin ? 0.25 : 0.3), sub = o.sub || 3, L = archLine(), teeth = phantomTeeth({ clinical: clin }), V = clin ? CLINICAL : PHANTOM;
  const lo = [-36.2, -40.4, -20.6], hi = [36.2, 21.4, 12.4], nx = Math.round((hi[0] - lo[0]) / h) + 1, ny = Math.round((hi[1] - lo[1]) / h) + 1, nz = Math.round((hi[2] - lo[2]) / h) + 1;
  const data = clin ? new Float32Array(nx * ny * nz) : new Int16Array(nx * ny * nz);
  // distance to the arch line in the axial plane, on a fine map (the bone and the soft tissue depend only on it and on z)
  const mh = h / 2, mx = Math.round((hi[0] - lo[0]) / mh) + 3, my = Math.round((hi[1] - lo[1]) / mh) + 3, dmap = new Float32Array(mx * my), P = L.pts;
  for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) {
    const x = lo[0] + (i - 1) * mh, y = lo[1] + (j - 1) * mh; let best = Infinity;
    for (let q = 0; q < P.length; q += 4) { const d = (P[q][0] - x) ** 2 + (P[q][1] - y) ** 2; if (d < best) best = d; }
    if (best < 400) { best = Infinity; for (let q = 0; q < P.length - 1; q++) { const ax = P[q][0], ay = P[q][1], bx = P[q + 1][0] - ax, by = P[q + 1][1] - ay, t = Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by) / (bx * bx + by * by))), d = (ax + bx * t - x) ** 2 + (ay + by * t - y) ** 2; if (d < best) best = d; } }
    dmap[i + mx * j] = Math.sqrt(best);
  }
  const dArch = (x, y) => { const fx = Math.max(0, Math.min(mx - 1.001, (x - lo[0]) / mh + 1)), fy = Math.max(0, Math.min(my - 1.001, (y - lo[1]) / mh + 1)), i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, q = i + mx * j; return (dmap[q] * (1 - tx) + dmap[q + 1] * tx) * (1 - ty) + (dmap[q + mx] * (1 - tx) + dmap[q + mx + 1] * tx) * ty; };
  const zc = (V.crest + V.boneBottom) / 2, zh = (V.crest - V.boneBottom) / 2, rr = 2.5;
  const boneD = (d, z) => { const qx = d - (V.boneHalf - rr), qy = Math.abs(z - zc) - (zh - rr), px = qx > 0 ? qx : 0, py = qy > 0 ? qy : 0; return Math.sqrt(px * px + py * py) + Math.min(Math.max(qx, qy), 0) - rr; };   // < 0 inside the bone
  const softD = (d, z) => { const qx = d - (V.boneHalf + 1.2), qy = Math.abs(z - (zc - 0.2)) - (zh - 1.2), px = qx > 0 ? qx : 0, py = qy > 0 ? qy : 0; return Math.sqrt(px * px + py * py) + Math.min(Math.max(qx, qy), 0) - 3.2; };
  const cw = clin ? V.cortexWidth : 1.4, lining = clin ? V.lining : 0.45;
  const inBone = clin ? (bd, x, y, z) => (bd > -cw ? V.cortex : Math.abs(vnoise(x / 0.9, y / 0.9, z / 0.9) - 0.5) < 0.13 ? V.trabecula : V.marrow) : (bd) => (bd > -1.4 ? V.cortex : V.spongy);   // (clinical: plates of trabeculae where the random field crosses its middle value)
  const ground = (x, y, z) => { const d = dArch(x, y), bd = boneD(d, z); if (bd < 0) return inBone(bd, x, y, z); return softD(d, z) < 0 ? V.soft : V.air; };
  // 1) bone, soft tissue and air (boundaries smoothed over a voxel by sampling)
  const offs = []; for (let a = 0; a < sub; a++) offs.push(((a + 0.5) / sub - 0.5) * h);
  for (let k = 0; k < nz; k++) { const z = lo[2] + k * h; for (let j = 0; j < ny; j++) { const y = lo[1] + j * h; for (let i = 0; i < nx; i++) {
    const x = lo[0] + i * h, d = dArch(x, y), bd = boneD(d, z), sd = softD(d, z); let v;
    if (Math.abs(bd) > h && Math.abs(bd + cw) > h && Math.abs(sd) > h) v = bd < 0 ? inBone(bd, x, y, z) : (sd < 0 ? V.soft : V.air);
    else { let sum = 0; for (const oz of offs) for (const oy of offs) for (const ox of offs) sum += ground(x + ox, y + oy, z + oz); v = sum / (sub * sub * sub); }
    data[i + nx * (j + ny * k)] = v;
  } } }
  // 2) the teeth, their ligament spaces and socket linings, each in its own box
  const fields = teeth.map((t) => ({ t, f: phantomToothField(t) }));
  // the material at a point close to the given teeth → [value, margin]; margin: about how far (mm) to the nearest change of material
  const mat = (x, y, z, near) => {
    let best = Infinity, second = Infinity, bt = null;
    for (const q of near) { const T = q.f(x, y, z); if (T < best) { second = best; best = T; bt = q.t; } else if (T < second) second = T; }
    if (best < 0) { const [a, b, c] = toLocal(bt, x, y, z), r = toothMaterial(bt, a, b, c, best); return [r[0], Math.min((second - best) / 2, -best, r[1])]; }
    const d = dArch(x, y), bd = boneD(d, z);
    if (bd < 0) return [best < V.pdlWidth ? V.pdl : best < V.pdlWidth + lining ? V.cortex : inBone(bd, x, y, z), Math.min(-bd, Math.abs(bd + cw), best, Math.abs(best - V.pdlWidth), Math.abs(best - V.pdlWidth - lining))];
    const sd = softD(d, z); return [sd < 0 ? V.soft : V.air, Math.min(best, bd, Math.abs(sd))];
  };
  const tv = new Float64Array(fields.length), cand = [];
  const safe = h * 0.87 * 1.6;                                     // a voxel whose centre is further than this from every change of material is all one material
  for (const q of fields) {
    const t = q.t, R = Math.max(t.md, t.bl) / 2 + 2.2, near = fields.filter((g) => Math.hypot(g.t.base[0] - t.base[0], g.t.base[1] - t.base[1]) < 12);
    const zt = [t.base[2] - t.root - 2.5, t.base[2] + t.crown + 2], tilt = 3.2;
    const i0 = Math.max(0, Math.floor((t.base[0] - R - tilt - lo[0]) / h)), i1 = Math.min(nx - 1, Math.ceil((t.base[0] + R + tilt - lo[0]) / h)), j0 = Math.max(0, Math.floor((t.base[1] - R - tilt - lo[1]) / h)), j1 = Math.min(ny - 1, Math.ceil((t.base[1] + R + tilt - lo[1]) / h)), k0 = Math.max(0, Math.floor((zt[0] - lo[2]) / h)), k1 = Math.min(nz - 1, Math.ceil((zt[1] - lo[2]) / h));
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = lo[0] + i * h, y = lo[1] + j * h, z = lo[2] + k * h;
      const Tq = q.f(x, y, z); if (Tq > V.pdlWidth + lining + h) continue;   // not this tooth's business
      // only the teeth that can be the nearest somewhere inside this voxel take part
      let best = Infinity; for (let g = 0; g < near.length; g++) { tv[g] = near[g] === q ? Tq : near[g].f(x, y, z); if (tv[g] < best) best = tv[g]; }
      cand.length = 0; for (let g = 0; g < near.length; g++) if (tv[g] <= best + 2 * h) cand.push(near[g]);
      const [v0, m] = mat(x, y, z, cand); let v = v0;
      if (m < safe) { let sum = 0; for (const oz of offs) for (const oy of offs) for (const ox of offs) sum += mat(x + ox, y + oy, z + oz, cand)[0]; v = sum / (sub * sub * sub); }
      data[i + nx * (j + ny * k)] = v;
    }
  }
  // 3) clinical: the scanner's blur (the voxel's own averaging is part of it), then noise that is smooth over about a voxel
  if (clin) {
    const dims = [nx, ny, nz], bs = [o.blur ?? V.blur, o.blur ?? V.blur, o.blurZ ?? V.blurZ].map((b) => Math.sqrt(Math.max(0, b * b - h * h / 12)) / h); gauss3(data, dims, bs);
    const sg = o.noise ?? V.noise, out = new Int16Array(data.length);
    if (sg > 0) {
      let sd = (o.seed || 7) >>> 0; const rnd = () => { sd = (sd + 0x6D2B79F5) >>> 0; let t = Math.imul(sd ^ (sd >>> 15), 1 | sd); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const nse = new Float32Array(data.length); for (let i = 0; i < nse.length; i += 2) { const u = Math.sqrt(-2 * Math.log(rnd() + 1e-12)), a = 6.283185307 * rnd(); nse[i] = u * Math.cos(a); if (i + 1 < nse.length) nse[i + 1] = u * Math.sin(a); }
      gauss3(nse, dims, [V.noiseBlur / h, V.noiseBlur / h, V.noiseBlurZ / h]); let s2 = 0; for (let i = 0; i < nse.length; i += 7) s2 += nse[i] * nse[i]; const k = sg / Math.sqrt(s2 / Math.ceil(nse.length / 7));
      for (let i = 0; i < data.length; i++) data[i] += k * nse[i];
    }
    let mn = 32767, mx2 = -32768; for (let i = 0; i < data.length; i++) { const v = Math.round(Math.max(V.air, Math.min(3095, data[i]))); out[i] = v; if (v < mn) mn = v; if (v > mx2) mx2 = v; }
    const vol = { data: out, dims: [nx, ny, nz], spacing: [h, h, h], origin: lo.slice(), min: mn, max: mx2, shift: 0, modality: 'CT', date: '', compression: 'made up', warnings: [] };
    return { vol, truth: { teeth, arch: L, values: V, bounds: { lo, hi }, boneField: (x, y, z) => boneD(dArch(x, y), z) } };
  }
  // 3) noise
  const sigma = o.noise ?? 25;
  if (sigma > 0) { let s = (o.seed || 7) >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = 0; i < data.length; i += 2) { const u = Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * sigma, a = 6.283185307 * rnd(); data[i] += u * Math.cos(a); if (i + 1 < data.length) data[i + 1] += u * Math.sin(a); } }
  let min = 32767, max = -32768; for (let i = 0; i < data.length; i++) { const v = data[i]; if (v < min) min = v; if (v > max) max = v; }
  const vol = { data, dims: [nx, ny, nz], spacing: [h, h, h], origin: lo.slice(), min, max, shift: 0, modality: 'CT', date: '', compression: 'made up', warnings: [] };
  return { vol, truth: { teeth, arch: L, values: V, bounds: { lo, hi }, boneField: (x, y, z) => boneD(dArch(x, y), z) } };
}

// ───────────────────────────── working with the volume ─────────────────────────────
// Pure functions on a volume as loadVolume returns it (no page, no WebGL), for the CBCT tab and its tests.
// Positions are the patient's (LPS, mm): voxel (i, j, k) lies at origin + (i·sx, j·sy, k·sz). Values are the volume's own
// data (the scan's value minus vol.shift, which is nearly always 0).
export const worldOf = (vol, i, j, k) => [vol.origin[0] + i * vol.spacing[0], vol.origin[1] + j * vol.spacing[1], vol.origin[2] + k * vol.spacing[2]];
export const voxelOf = (vol, x, y, z) => [(x - vol.origin[0]) / vol.spacing[0], (y - vol.origin[1]) / vol.spacing[1], (z - vol.origin[2]) / vol.spacing[2]];
/** trilinear value at a patient position (outside the volume: its lowest value) */
export function sampleAt(vol, x, y, z) {
  const [nx, ny, nz] = vol.dims, fx = (x - vol.origin[0]) / vol.spacing[0], fy = (y - vol.origin[1]) / vol.spacing[1], fz = (z - vol.origin[2]) / vol.spacing[2];
  if (!(fx >= 0 && fy >= 0 && fz >= 0 && fx <= nx - 1 && fy <= ny - 1 && fz <= nz - 1)) return vol.min;
  const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(ny - 2, Math.floor(fy)), k = Math.min(nz - 2, Math.floor(fz)), tx = fx - i, ty = fy - j, tz = fz - k, d = vol.data, X = 1, Y = nx, Z = nx * ny, b = i + nx * (j + ny * k);
  return ((d[b] * (1 - tx) + d[b + X] * tx) * (1 - ty) + (d[b + Y] * (1 - tx) + d[b + Y + X] * tx) * ty) * (1 - tz) + ((d[b + Z] * (1 - tx) + d[b + Z + X] * tx) * (1 - ty) + (d[b + Z + Y] * (1 - tx) + d[b + Z + Y + X] * tx) * ty) * tz;
}
/** histogram(vol) of up to ~4 million voxels spread through the volume → { lo, hi, bins (one per value), total, step, pct(q) } */
export function histogram(vol, maxSamples = 4e6) {
  const d = vol.data, step = Math.max(1, Math.floor(d.length / maxSamples)) | 1, lo = vol.min, hi = vol.max, bins = new Uint32Array(hi - lo + 1); let total = 0;
  for (let i = step >> 1; i < d.length; i += step) { bins[d[i] - lo]++; total++; }
  const pct = (q) => { const target = q * total; let acc = 0; for (let b = 0; b < bins.length; b++) { acc += bins[b]; if (acc >= target) return lo + b; } return hi; };
  return { lo, hi, bins, total, step, pct };
}
/**
 * windowPresets(vol) → { hu, bone, teeth, soft, full } each { w, l } in data units. Display presets only.
 * A scan whose darkest values sit at air's −1000 is taken to be in Hounsfield-like units and gets fixed windows; any other
 * scan gets the same windows stretched between its own air (2nd percentile) and its brightest (99.9th percentile) values.
 */
export function windowPresets(vol, H = histogram(vol)) {
  const sh = vol.shift || 0; let inAir = 0; for (let v = Math.max(H.lo, -1150 - sh); v <= Math.min(H.hi, -850 - sh); v++) inAir += H.bins[v - H.lo];
  const p2 = H.pct(0.02) + sh, hu = inAir / H.total > 0.03 || (p2 > -1150 && p2 < -850);
  const a = hu ? -1000 : p2, b = hu ? 2800 : H.pct(0.999) + sh, k = (b - a) / 3800;   // scan units per "Hounsfield-like" unit
  const win = (l, w) => ({ l: Math.round(a + (l + 1000) * k - sh), w: Math.max(1, Math.round(w * k)) });
  return { hu, bone: win(700, 2600), teeth: win(1600, 2400), soft: win(40, 400), full: { l: Math.round((vol.min + vol.max) / 2), w: Math.max(1, vol.max - vol.min) } };
}
/** downsample(vol, { maxVoxels, maxDim, lo, hi }) → a smaller copy for the 3D view: box averages as bytes (0 … 255 = lo … hi)
 *  → { data: Uint8Array, dims, spacing, origin (centre of voxel 0), lo, hi, f } */
export function downsample(vol, o = {}) {
  const maxV = o.maxVoxels || 16e6, maxD = o.maxDim || 512, [nx, ny, nz] = vol.dims, [sx, sy, sz] = vol.spacing, d = vol.data;
  let f = 1; while (Math.ceil(nx / f) * Math.ceil(ny / f) * Math.ceil(nz / f) > maxV || Math.max(nx, ny, nz) / f > maxD) f++;
  const mx = Math.ceil(nx / f), my = Math.ceil(ny / f), mz = Math.ceil(nz / f), out = new Uint8Array(mx * my * mz), lo = o.lo ?? vol.min, hi = o.hi ?? vol.max, sc = 255 / Math.max(1, hi - lo);
  const acc = new Float32Array(mx * my), cnt = new Float32Array(mx * my);
  for (let kk = 0; kk < mz; kk++) {
    acc.fill(0); cnt.fill(0);
    for (let k = kk * f; k < Math.min(nz, kk * f + f); k++) for (let j = 0; j < ny; j++) { const row = (j / f | 0) * mx, b = nx * (j + ny * k); for (let i = 0; i < nx; i++) { const q = row + (i / f | 0); acc[q] += d[b + i]; cnt[q]++; } }
    for (let q = 0; q < mx * my; q++) { const v = (acc[q] / cnt[q] - lo) * sc; out[kk * mx * my + q] = v < 0 ? 0 : v > 255 ? 255 : v + 0.5; }
  }
  return { data: out, dims: [mx, my, mz], spacing: [sx * f, sy * f, sz * f], origin: [vol.origin[0] + (f - 1) / 2 * sx, vol.origin[1] + (f - 1) / 2 * sy, vol.origin[2] + (f - 1) / 2 * sz], lo, hi, f };
}
/** surfaceField(vol, T, h, lo?, hi?) → { F, n, origin, h }: T − value on an even grid of h mm (negative where the scan is at or
 *  above T), for core's isoMesh. lo/hi: the part of the volume wanted (patient mm), else all of it. */
export function surfaceField(vol, T, h, lo = null, hi = null) {
  const [nx, ny, nz] = vol.dims, [sx, sy, sz] = vol.spacing, o = vol.origin, d = vol.data;
  const L = lo || o, Hh = hi || [o[0] + (nx - 1) * sx, o[1] + (ny - 1) * sy, o[2] + (nz - 1) * sz];
  const n = [0, 1, 2].map((a) => Math.max(2, Math.floor((Hh[a] - L[a]) / h) + 1)), F = new Float32Array(n[0] * n[1] * n[2]);
  const ix = new Int32Array(n[0]), tx = new Float32Array(n[0]), outX = new Uint8Array(n[0]);
  for (let a = 0; a < n[0]; a++) { const f = (L[0] + a * h - o[0]) / sx; outX[a] = f < 0 || f > nx - 1 ? 1 : 0; const i = Math.max(0, Math.min(nx - 2, Math.floor(f))); ix[a] = i; tx[a] = Math.max(0, Math.min(1, f - i)); }
  for (let c = 0; c < n[2]; c++) {
    const fz = (L[2] + c * h - o[2]) / sz, k = Math.max(0, Math.min(nz - 2, Math.floor(fz))), wz = Math.max(0, Math.min(1, fz - k)), oz = fz < 0 || fz > nz - 1;
    for (let b = 0; b < n[1]; b++) {
      const fy = (L[1] + b * h - o[1]) / sy, j = Math.max(0, Math.min(ny - 2, Math.floor(fy))), wy = Math.max(0, Math.min(1, fy - j)), oy = fy < 0 || fy > ny - 1, row = (c * n[1] + b) * n[0];
      for (let a = 0; a < n[0]; a++) {
        if (oz || oy || outX[a]) { F[row + a] = T - vol.min; continue; }
        const q = ix[a] + nx * (j + ny * k), t = tx[a], Y = nx, Z = nx * ny;
        const v = ((d[q] * (1 - t) + d[q + 1] * t) * (1 - wy) + (d[q + Y] * (1 - t) + d[q + Y + 1] * t) * wy) * (1 - wz) + ((d[q + Z] * (1 - t) + d[q + Z + 1] * t) * (1 - wy) + (d[q + Z + Y] * (1 - t) + d[q + Z + Y + 1] * t) * wy) * wz;
        F[row + a] = T - v;
      }
    }
  }
  return { F, n, origin: L.slice(), h };
}

// ── the arch, and images along it ──
/**
 * archCurve(points) → the smooth curve through the tapped points (centripetal Catmull-Rom), in the axial plane, running from the
 * patient's right to their left: { pts:[[x,y]…], s:[…] (arc length), length, at(s) → { p:[x,y], t:[tx,ty], n:[nx,ny] } }.
 * n points to the cheek / lip side (buccal) wherever the arch is a U opening backwards.
 */
export function archCurve(points, step = 0.2) {
  const P = points.map((p) => [p[0], p[1]]).filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1e-6);
  if (P.length < 2) return null;
  if (P[0][0] > P[P.length - 1][0]) P.reverse();
  const n = P.length, ext = [[2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1]], ...P, [2 * P[n - 1][0] - P[n - 2][0], 2 * P[n - 1][1] - P[n - 2][1]]], pts = [];
  const dd = (a, b) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  for (let s = 1; s < ext.length - 2; s++) {
    const p0 = ext[s - 1], p1 = ext[s], p2 = ext[s + 1], p3 = ext[s + 2], t0 = 0, t1 = t0 + dd(p0, p1), t2 = t1 + dd(p1, p2), t3 = t2 + dd(p2, p3), m = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let q = 0; q < m; q++) {
      const t = t1 + (t2 - t1) * q / m, L = (a, b, ta, tb) => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3), B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3); pts.push(L(B1, B2, t1, t2));
    }
  }
  pts.push(P[n - 1].slice());
  const S = [0]; for (let i = 1; i < pts.length; i++) S.push(S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const length = S[S.length - 1];
  const at = (sv) => {
    sv = Math.max(0, Math.min(length, sv)); let lo = 0, hi = S.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= sv) lo = m; else hi = m; }
    const a = pts[lo], b = pts[hi], l = (S[hi] - S[lo]) || 1, u = (sv - S[lo]) / l, tx = (b[0] - a[0]) / l, ty = (b[1] - a[1]) / l, tl = Math.hypot(tx, ty) || 1;
    return { p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], t: [tx / tl, ty / tl], n: [ty / tl, -tx / tl] };
  };
  return { pts, s: S, length, at, points: P };
}
/** the four voxels round (fx, fy) of a slice, and the weights: [offset, wx, wy] (offset −1: outside) */
function bilinearTap(vol, x, y) {
  const [nx, ny] = vol.dims, fx = (x - vol.origin[0]) / vol.spacing[0], fy = (y - vol.origin[1]) / vol.spacing[1];
  if (!(fx >= 0 && fy >= 0 && fx <= nx - 1 && fy <= ny - 1)) return [-1, 0, 0];
  const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(ny - 2, Math.floor(fy)); return [i + nx * j, fx - i, fy - j];
}
/** an image made of columns, each a vertical line through the volume at (x, y), averaged or maximised over its own taps */
function columnImage(vol, taps, cols, M, mode) {
  const [nx, ny, nz] = vol.dims, d = vol.data, rows = nz, out = new Int16Array(cols * rows), S = nx * ny, max = mode === 'max';
  for (let k = 0; k < nz; k++) {
    const base = k * S, r = nz - 1 - k;
    for (let c = 0; c < cols; c++) {
      let acc = max ? -32768 : 0;
      for (let m = 0; m < M; m++) {
        const q = 3 * (c * M + m), o = taps[q]; let v;
        if (o < 0) v = vol.min; else { const wx = taps[q + 1], wy = taps[q + 2], b = base + o; v = (d[b] * (1 - wx) + d[b + 1] * wx) * (1 - wy) + (d[b + nx] * (1 - wx) + d[b + nx + 1] * wx) * wy; }
        if (max) { if (v > acc) acc = v; } else acc += v;
      }
      out[r * cols + c] = Math.round(max ? acc : acc / M);
    }
  }
  return out;
}
/**
 * panorama(vol, curve, { slab, px, mode }) → the curved planar reformation along the arch: column c is the arch at
 * s = (c + ½)·px from the patient's right, row r the slice nz−1−r (top row = highest). Each pixel averages (mode 'mean') or takes
 * the highest of (mode 'max') the values across a slab `slab` mm thick, centred on the curve and square to it.
 * → { data: Int16Array, cols, rows, px, pz, slab }
 */
export function panorama(vol, curve, o = {}) {
  const px = o.px || Math.min(vol.spacing[0], vol.spacing[1]), slab = Math.max(0, o.slab || 0), cols = Math.max(1, Math.round(curve.length / px));
  const M = slab > 0 ? Math.max(2, Math.round(slab / Math.min(px, 0.5))) : 1, taps = new Float64Array(cols * M * 3);
  for (let c = 0; c < cols; c++) { const g = curve.at((c + 0.5) * px); for (let m = 0; m < M; m++) { const t = M === 1 ? 0 : -slab / 2 + slab * (m + 0.5) / M, tp = bilinearTap(vol, g.p[0] + t * g.n[0], g.p[1] + t * g.n[1]), q = 3 * (c * M + m); taps[q] = tp[0]; taps[q + 1] = tp[1]; taps[q + 2] = tp[2]; } }
  return { data: columnImage(vol, taps, cols, M, o.mode), cols, rows: vol.dims[2], px, pz: vol.spacing[2], slab };
}
/** crossSection(vol, curve, s, { width, px }) → the plane square to the arch at s: column c at t = width/2 − (c + ½)·px along the
 *  buccal normal (so the cheek / lip side is on the left), rows as in panorama. → { data, cols, rows, px, pz, s, p, n, width } */
export function crossSection(vol, curve, s, o = {}) {
  const px = o.px || Math.min(vol.spacing[0], vol.spacing[1]), width = o.width || 30, cols = Math.max(2, Math.round(width / px)), g = curve.at(s), taps = new Float64Array(cols * 3);
  for (let c = 0; c < cols; c++) { const t = width / 2 - (c + 0.5) * px, tp = bilinearTap(vol, g.p[0] + t * g.n[0], g.p[1] + t * g.n[1]); taps[3 * c] = tp[0]; taps[3 * c + 1] = tp[1]; taps[3 * c + 2] = tp[2]; }
  return { data: columnImage(vol, taps, cols, 1, 'mean'), cols, rows: vol.dims[2], px, pz: vol.spacing[2], s, p: g.p, n: g.n, width: cols * px };
}
/** box blur of a 2D map in place, radius r cells, along both axes */
function blur2(D, nx, ny, r) {
  if (r < 1) return; const tmp = new Float32Array(Math.max(nx, ny));
  for (let j = 0; j < ny; j++) { let acc = 0; for (let i = -r; i < nx + r; i++) { if (i + r < nx && i + r >= 0) acc += D[j * nx + i + r]; if (i - r - 1 >= 0 && i - r - 1 < nx) acc -= D[j * nx + i - r - 1]; if (i >= 0 && i < nx) tmp[i] = acc; } for (let i = 0; i < nx; i++) D[j * nx + i] = tmp[i]; }
  for (let i = 0; i < nx; i++) { let acc = 0; for (let j = -r; j < ny + r; j++) { if (j + r < ny && j + r >= 0) acc += D[(j + r) * nx + i]; if (j - r - 1 >= 0 && j - r - 1 < ny) acc -= D[(j - r - 1) * nx + i]; if (j >= 0 && j < ny) tmp[j] = acc; } for (let j = 0; j < ny; j++) D[j * nx + i] = tmp[j]; }
}
/**
 * proposeArch(vol) → { points:[[x,y]…], T, z } — a first guess at the dental arch, to be checked and moved by the user.
 * The brightest few cm³ of the scan (enamel, dentine, metal) are found; seen from above, within the 20 mm band of slices that
 * holds most of them, they make a U. Rays from a point near the back of the U find the middle of the band in each direction.
 * points: control points about every 10 mm, from the patient's right to their left. null if no arch-like band is found.
 */
export function proposeArch(vol, H = histogram(vol)) {
  const [nx, ny, nz] = vol.dims, [sx, sy, sz] = vol.spacing, d = vol.data, want = 4000 / (sx * sy * sz) / H.step;
  let acc = 0, T = H.hi; for (let b = H.bins.length - 1; b >= 0; b--) { acc += H.bins[b]; if (acc >= want) { T = H.lo + b; break; } }
  T = Math.max(T, H.pct(0.5) + 1);
  const prof = new Float64Array(nz); for (let k = 0; k < nz; k++) { let c = 0; const b = k * nx * ny; for (let q = 0; q < nx * ny; q += 2) if (d[b + q] >= T) c++; prof[k] = c; }
  const w = Math.max(1, Math.round(2.5 / sz)); let kc = 0, best = -1; for (let k = 0; k < nz; k++) { let s = 0; for (let q = Math.max(0, k - w); q <= Math.min(nz - 1, k + w); q++) s += prof[q]; if (s > best) { best = s; kc = k; } }
  if (best <= 0) return null;
  const band = Math.round(10 / sz), D = new Float32Array(nx * ny);
  for (let k = Math.max(0, kc - band); k <= Math.min(nz - 1, kc + band); k++) { const b = k * nx * ny; for (let q = 0; q < nx * ny; q++) if (d[b + q] >= T) D[q]++; }
  blur2(D, nx, ny, Math.max(1, Math.round(1.5 / sx))); blur2(D, nx, ny, Math.max(1, Math.round(1.5 / sx)));
  let W = 0, X = 0; const rowW = new Float64Array(ny); for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = D[i + nx * j]; W += v; X += v * i; rowW[j] += v; }
  if (W <= 0) return null;
  const ci = X / W; let cj = 0, cum = 0; for (let j = 0; j < ny; j++) { cum += rowW[j]; if (cum >= 0.85 * W) { cj = j; break; } }
  const cx = vol.origin[0] + ci * sx, cy = vol.origin[1] + cj * sy, Rmax = Math.hypot(nx * sx, ny * sy), dr = 0.5 * Math.min(sx, sy), rays = [];
  const Dat = (x, y) => { const fx = (x - vol.origin[0]) / sx, fy = (y - vol.origin[1]) / sy; if (!(fx >= 0 && fy >= 0 && fx <= nx - 1 && fy <= ny - 1)) return 0; const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(ny - 2, Math.floor(fy)), tx = fx - i, ty = fy - j, q = i + nx * j; return (D[q] * (1 - tx) + D[q + 1] * tx) * (1 - ty) + (D[q + nx] * (1 - tx) + D[q + nx + 1] * tx) * ty; };
  for (let th = -115; th <= 115; th += 2.5) {
    const a = th * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a); let sw = 0, sr = 0;
    for (let r = 0; r < Rmax; r += dr) { const v = Dat(cx + r * dx, cy + r * dy); sw += v; sr += v * r; }
    rays.push({ th, dx, dy, w: sw, r: sw > 0 ? sr / sw : 0 });
  }
  const ws = rays.filter((r) => r.w > 0).map((r) => r.w).sort((a, b) => a - b); if (!ws.length) return null;
  const med = ws[ws.length >> 1], keep = rays.filter((r) => r.w >= 0.2 * med);
  if (keep.length < 5) return null;
  const sm = keep.map((r, i) => { let s = 0, n = 0; for (let q = Math.max(0, i - 1); q <= Math.min(keep.length - 1, i + 1); q++) { s += keep[q].r; n++; } return s / n; });
  const line = keep.map((r, i) => [cx + sm[i] * r.dx, cy + sm[i] * r.dy]);
  const c = archCurve(line, 0.5); if (!c || c.length < 20) return null;
  const nP = Math.max(5, Math.round(c.length / 10)), points = []; for (let q = 0; q <= nP; q++) points.push(c.at(c.length * q / nP).p.map((v) => Math.round(v * 100) / 100));
  return { points, T, z: vol.origin[2] + kc * sz };
}

// ── one tooth out of the scan ──
const N6 = (nx, ny) => [1, -1, nx, -nx, nx * ny, -nx * ny];
// ── one tooth out of the scan, followed from slice to slice ──
// The grey values that mark a tooth off from what is round it are local: dentine reads up to a quarter brighter in one part of
// a tooth than in another, cortical bone reads as bright as dentine, and the ligament space between a root and its socket is
// only a faint dark line (a dip of about a third, less than a voxel wide). So the tooth is not cut out by one threshold. Its
// outline is found in the slice through the widest part of the crown, where it stands in air and soft tissue, and followed
// from there slice by slice towards the cusps and towards the root ends:
//   · each piece of the outline (the crown, then each root) is a closed curve round its own middle. Along rays from the
//     middle, the edge is where the grey falls from the tooth's own level into something darker — soft tissue, marrow, or
//     the dip of the ligament space — close to where the edge was in the slice before. Where no fall shows (a root against
//     bone as bright as itself, a crown against its neighbour) the outline carries on as it was going: shifting and
//     narrowing at the rate it had.
//   · inside the outline a voxel is tooth if it is not much darker than the tooth's own tissue next to it in the slice
//     before (so the pulp, the gap between two roots and the fissures drop out, and each root goes its own way);
//   · the tooth may only grow sideways where a fall in grey shows just beyond the new voxels, so it cannot spread into bone.
const NRAY = 72, RCOS = new Float64Array(NRAY), RSIN = new Float64Array(NRAY); for (let t = 0; t < NRAY; t++) { RCOS[t] = Math.cos(2 * Math.PI * t / NRAY); RSIN[t] = Math.sin(2 * Math.PI * t / NRAY); }
/** out[p] = 1 for a slice's mask and for what it shuts in (not reachable from the slice's edge) */
function solid2(M, n0, n1, out) {
  out.fill(1); const st = [], push = (p) => { if (!M[p] && out[p]) { out[p] = 0; st.push(p); } };
  for (let i = 0; i < n0; i++) { push(i); push(i + n0 * (n1 - 1)); } for (let j = 0; j < n1; j++) { push(n0 * j); push(n0 - 1 + n0 * j); }
  while (st.length) { const p = st.pop(), i = p % n0, j = (p / n0) | 0; if (i > 0) push(p - 1); if (i < n0 - 1) push(p + 1); if (j > 0) push(p - n0); if (j < n1 - 1) push(p + n0); }
  return out;
}
/**
 * The cheapest closed chain: one of S states for each of n rays (cost U[t·S + s]), changing by at most maxStep states from
 * one ray to the next at lam a state → Int16Array of states. Closed by starting at ray t0 — one whose cost is telling — in
 * each of its three best states in turn.
 */
function closedChain(U, n, S, maxStep, lam, t0 = 0) {
  const cost = new Float32Array(S), nxt = new Float32Array(S), back = new Int16Array(n * S), tries = [], u0 = t0 * S, order = Array.from({ length: S }, (_, s) => s).sort((a, b) => U[u0 + a] - U[u0 + b]);
  for (const s of order) { if (tries.every((c) => Math.abs(c - s) > maxStep)) tries.push(s); if (tries.length >= 3) break; }
  let best = null;
  for (const s0 of tries) {
    cost.fill(Infinity); cost[s0] = U[u0 + s0];
    for (let m = 1; m < n; m++) { const t = (t0 + m) % n; for (let s = 0; s < S; s++) { let b = Infinity, bi = 0; for (let d = -maxStep; d <= maxStep; d++) { const p = s + d; if (p < 0 || p >= S) continue; const c = cost[p] + lam * Math.abs(d); if (c < b) { b = c; bi = p; } } nxt[s] = b + U[t * S + s]; back[m * S + s] = bi; } cost.set(nxt); }
    let e = -1, eb = Infinity; for (let d = -maxStep; d <= maxStep; d++) { const s = s0 + d; if (s < 0 || s >= S) continue; const c = cost[s] + lam * Math.abs(d); if (c < eb) { eb = c; e = s; } }
    if (e >= 0 && (!best || eb < best.c)) { const path = new Int16Array(n); let s = e; for (let m = n - 1; m >= 1; m--) { path[(t0 + m) % n] = s; s = back[m * S + s]; } path[t0] = s0; best = { c: eb, path }; }
  }
  return best ? best.path : new Int16Array(n);
}
/** a closed outline given as a radius (voxels) for each ray about (ci, cj) → its area and centroid; and whether a voxel lies inside it */
function outlineStats(r, ci, cj) { let A = 0, sx = 0, sy = 0; for (let t = 0; t < NRAY; t++) { const u = (t + 1) % NRAY, x0 = r[t] * RCOS[t], y0 = r[t] * RSIN[t], x1 = r[u] * RCOS[u], y1 = r[u] * RSIN[u], c = x0 * y1 - x1 * y0; A += c; sx += (x0 + x1) * c; sy += (y0 + y1) * c; } A /= 2; return { area: A, cx: A ? ci + sx / (6 * A) : ci, cy: A ? cj + sy / (6 * A) : cj }; }
function radiusAt(r, dx, dy) { let a = Math.atan2(dy, dx) * NRAY / (2 * Math.PI); if (a < 0) a += NRAY; const t = Math.floor(a) % NRAY, f = a - Math.floor(a); return r[t] * (1 - f) + r[(t + 1) % NRAY] * f; }
/** the middle value of the darker and of the brighter of two groups a list of values falls into best (Otsu) → { lo, hi, cut, share } (share: how much of the list is in the brighter group) */
function twoLevels(v) {
  const a = Float64Array.from(v).sort(), n = a.length; if (n < 8) return null; let tot = 0; for (let i = 0; i < n; i++) tot += a[i];
  let best = -1, bi = 0, s = 0; for (let i = 0; i < n - 1; i++) { s += a[i]; const w0 = (i + 1) / n, m0 = s / (i + 1), m1 = (tot - s) / (n - i - 1), bv = w0 * (1 - w0) * (m1 - m0) * (m1 - m0); if (bv > best) { best = bv; bi = i; } }
  return { lo: a[bi >> 1], hi: a[(bi + n) >> 1], cut: (a[bi] + a[bi + 1]) / 2, share: (n - bi - 1) / n };
}
/**
 * trackTooth(G, seed, P) — the tooth a point lies on, followed through the slices of a grid.
 *   G     { I (Int16Array), n0, n1, n2, h (mm in a slice), hz (mm between slices), allow (Uint8Array: 1 where the tooth may be, 0 where it was
 *         cut away, 2 outside the region it must lie in) }: slices run across the tooth
 *   seed  [i, j, k] on the crown        P  { T (the level between soft tissue and tooth), more:[[i, j, k]…] (points that are tooth too),
 *         smoothRoots (false: the roots are left as followed, not redrawn as smooth curves) }
 * → { mask (Uint8Array, 1 = tooth; the pulp is left out), kEq (the slice the outline started in), cEq [i, j], D0 (the dentine's
 *     level), E0 (the enamel's, or null), Dcap, C (dentine against soft tissue), dark }  or { error }
 */
const polyArea = (r) => { let a = 0; for (let t = 0; t < NRAY; t++) a += r[t] * r[(t + 1) % NRAY]; return 0.5 * a * Math.sin(2 * Math.PI / NRAY); };
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function trackTooth(G, seed, P) {
  const { I, n0, n1, n2, h, allow } = G, hz = G.hz || h, sl = n0 * n1, n = sl * n2, T = P.T, mm = (x) => x / h;
  const B = new Uint8Array(sl), S2 = new Uint8Array(sl), rraw = new Float32Array(NRAY), rmax = Math.min(mm(12), Math.max(n0, n1));
  // ── the outline of the crown in one slice: the bright blob the point is in (holes filled), its edge along rays, smoothed
  //    round so that where it runs on into the next tooth it is carried across from either side ──
  const outline = (k, ci, cj) => {
    const base = k * sl; for (let p = 0; p < sl; p++) B[p] = allow[base + p] && I[base + p] >= T ? 1 : 0; solid2(B, n0, n1, S2);   // (bright outside the region too: the region's edge is not an edge of the tooth)
    let i0 = Math.round(ci), j0 = Math.round(cj); if (i0 < 0 || j0 < 0 || i0 >= n0 || j0 >= n1) return null;
    if (!S2[i0 + n0 * j0]) { let bd = mm(1.5) ** 2 + 1e-6, f = -1; const R = Math.ceil(mm(1.5)); for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) { const ii = i0 + a, jj = j0 + b; if (ii < 0 || jj < 0 || ii >= n0 || jj >= n1 || !S2[ii + n0 * jj]) continue; const d = a * a + b * b; if (d < bd) { bd = d; f = ii + n0 * jj; } } if (f < 0) return null; i0 = f % n0; j0 = (f / n0) | 0; ci = i0; cj = j0; }
    let r = null, q = 0;
    for (let pass = 0; pass < 3; pass++) {
      const Sn = Math.ceil(rmax * 2) + 1, U = new Float32Array(NRAY * Sn), cap = mm(1.5);
      for (let t = 0; t < NRAY; t++) { let tt = 0.5, out = -1; for (; tt <= rmax; tt += 0.5) { const ii = Math.round(ci + tt * RCOS[t]), jj = Math.round(cj + tt * RSIN[t]); if (ii < 0 || jj < 0 || ii >= n0 || jj >= n1) break; const p = ii + n0 * jj; if (!S2[p]) { out = tt - 0.25; break; } if (allow[base + p] === 2) break; } rraw[t] = out; }
      // a ray that runs on far beyond most (through a contact into the next tooth) tells nothing about this tooth's edge
      const vr = Array.from(rraw).filter((x) => x >= 0).sort((a, b) => a - b), med = vr.length ? vr[vr.length >> 1] : 0, far = 1.35 * med + mm(0.5);
      for (let t = 0; t < NRAY; t++) { const out = rraw[t] > far ? -1 : rraw[t]; rraw[t] = out; for (let s = 0; s < Sn; s++) U[t * Sn + s] = out < 0 ? 0.15 * Math.max(0, s * 0.5 - med) : Math.min(Math.abs(s * 0.5 - out), cap); }
      let t0 = 0; { const v = Array.from(rraw).filter((x) => x >= 0).sort((a, b) => a - b), want = v.length ? v[Math.floor(v.length * 0.3)] : 0; let bd = Infinity; for (let t = 0; t < NRAY; t++) if (rraw[t] >= 0 && Math.abs(rraw[t] - want) < bd) { bd = Math.abs(rraw[t] - want); t0 = t; } }   // start the chain at a ray that surely ends on the tooth's own edge
      const path = closedChain(U, NRAY, Sn, 3, 0.6, t0); r = new Float32Array(NRAY); let good = 0; for (let t = 0; t < NRAY; t++) { r[t] = Math.max(0.5, path[t] * 0.5); if (rraw[t] >= 0 && Math.abs(r[t] - rraw[t]) <= 1.5) good++; } q = good / NRAY;
      const st = outlineStats(r, ci, cj); if (P.debug) P.debug({ what: 'outline', k, pass, ci, cj, rraw: Array.from(rraw), r: Array.from(r), q, area: st.area * h * h, cx: st.cx, cy: st.cy });
      if (Math.hypot(st.cx - ci, st.cy - cj) < 1 || pass === 2) return { r, q, area: st.area * h * h, ci, cj, cx: st.cx, cy: st.cy };
      if (!S2[Math.round(st.cx) + n0 * Math.round(st.cy)]) return { r, q, area: st.area * h * h, ci, cj, cx: st.cx, cy: st.cy }; ci = st.cx; cj = st.cy;
    }
    return null;
  };
  // the slice to start in: within 4 mm of the point, the one where the crown is widest and its outline clear
  let eq = null; const span = Math.round(4 / hz), ok = (o) => o && o.q >= 0.6 && o.area < 200 && o.area > 3;
  const o0 = outline(seed[2], seed[0], seed[1]); if (!ok(o0)) return { error: 'No tooth crown was found where you tapped: tap the middle of the crown, in a slice where it stands clear of the bone.' };
  const found = new Map([[seed[2], o0]]), softL = P.soft != null ? Math.min(P.soft, T - 50) : null;
  for (const dir of [1, -1]) { let last = o0; for (let s = 1; s <= span; s++) { const k = seed[2] + dir * s; if (k < 0 || k >= n2) break; const o = outline(k, last.cx, last.cy); if (!ok(o) || Math.hypot(o.cx - seed[0], o.cy - seed[1]) > mm(4)) break; found.set(k, o); last = o; } }
  // enamel: over those slices together the tooth's own values fall into two levels, the upper half as bright again as the lower
  // (above soft tissue). Dentine brightens towards the enamel and from crown to root by a quarter, which is not a second level
  const valsIn = (o, k, out) => { const base = k * sl, R = Math.ceil(Math.max(...o.r)) + 1; for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) { const ii = Math.round(o.ci) + a, jj = Math.round(o.cj) + b; if (ii < 0 || jj < 0 || ii >= n0 || jj >= n1) continue; const dx = ii - o.ci, dy = jj - o.cj, p = ii + n0 * jj; if (allow[base + p] === 1 && I[base + p] >= T && Math.hypot(dx, dy) <= radiusAt(o.r, dx, dy)) out.push(I[base + p]); } return out; };
  const isTwo = (two) => !!two && two.share > 0.05 && two.share < 0.95 && (softL != null ? two.hi - softL >= 1.45 * (two.lo - softL) : two.hi - two.lo > 0.5 * (two.lo - T));
  let pool = []; for (const [k, o] of found) { o.vals = valsIn(o, k, []); pool = pool.concat(o.vals); } if (pool.length > 40000) { const f = Math.ceil(pool.length / 40000); pool = pool.filter((_, i) => i % f === 0); }
  const twoP = twoLevels(pool), Eth = isTwo(twoP) ? twoP.cut : Infinity; for (const o of found.values()) { let e = 0; for (const v of o.vals) if (v > Eth) e++; o.en = o.vals.length ? e / o.vals.length : 0; }
  // the slice to start in: within 4 mm of the point, the one where the crown is widest and its outline clear. Cusps join into the
  // whole crown within a slice or two, so its size may jump — where there is enamel; without it a jump is the bone joining in.
  // And once it has narrowed (to the neck, or to the tips of the cusps), what widens again is the bone or the tooth it bites on
  eq = { ...o0, k: seed[2] };
  for (const dir of [1, -1]) { let lastA = o0.area, top = o0.area, low = o0.area; for (let s = 1; s <= span; s++) { const k = seed[2] + dir * s, o = found.get(k); if (!o) break;
      if (o.area > 1.3 * lastA + 1 && !(o.en >= 0.15)) break; if (o.area > top) { top = o.area; low = o.area; } else if (o.area < low) low = o.area; if (low < 0.7 * top && o.area > 1.15 * low + 1) break; lastA = o.area; if (o.area * o.q > eq.area * eq.q) eq = { ...o, k }; } }
  const mask = new Uint8Array(n), kEq = eq.k, start = new Uint8Array(sl);
  { const base = kEq * sl, R = Math.ceil(Math.max(...eq.r)) + 1; for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) { const ii = Math.round(eq.ci) + a, jj = Math.round(eq.cj) + b; if (ii < 0 || jj < 0 || ii >= n0 || jj >= n1) continue; const dx = ii - eq.ci, dy = jj - eq.cj, p = ii + n0 * jj; if (Math.hypot(dx, dy) <= radiusAt(eq.r, dx, dy) && allow[base + p] === 1 && I[base + p] >= T) start[p] = 1; } }
  { // only the piece the middle of the outline is on (the outline may take in a corner of the next tooth across the gap between them)
    const keep = new Uint8Array(sl), st0 = []; let p0 = Math.round(eq.cx) + n0 * Math.round(eq.cy); if (!start[p0]) { let bd = Infinity; for (let p = 0; p < sl; p++) if (start[p]) { const d = (p % n0 - eq.cx) ** 2 + (((p / n0) | 0) - eq.cy) ** 2; if (d < bd) { bd = d; p0 = p; } } }
    if (start[p0]) { keep[p0] = 1; st0.push(p0); while (st0.length) { const p = st0.pop(), i = p % n0, j = (p / n0) | 0; if (i > 0 && start[p - 1] && !keep[p - 1]) { keep[p - 1] = 1; st0.push(p - 1); } if (i < n0 - 1 && start[p + 1] && !keep[p + 1]) { keep[p + 1] = 1; st0.push(p + 1); } if (j > 0 && start[p - n0] && !keep[p - n0]) { keep[p - n0] = 1; st0.push(p - n0); } if (j < n1 - 1 && start[p + n0] && !keep[p + n0]) { keep[p + n0] = 1; st0.push(p + n0); } } start.set(keep); } }
  // the levels: dentine and enamel from the crown's own values; soft tissue from just outside it
  const vals = [], ring = []; { const base = kEq * sl, R = Math.ceil(Math.max(...eq.r)) + 8; for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) { const ii = Math.round(eq.ci) + a, jj = Math.round(eq.cj) + b; if (ii < 0 || jj < 0 || ii >= n0 || jj >= n1) continue; const p = ii + n0 * jj; if (start[p]) vals.push(I[base + p]); else { const dx = ii - eq.ci, dy = jj - eq.cj, d = Math.hypot(dx, dy) - radiusAt(eq.r, dx, dy); if (d > 3 && d <= 7 && allow[base + p] === 1) ring.push(I[base + p]); } } }
  if (vals.length < 6) return { error: 'No tooth crown was found where you tapped: tap the middle of the crown.' };
  const two = twoLevels(vals), srt = Float64Array.from(vals).sort(); let D0 = srt[srt.length >> 1], E0 = null;
  ring.sort((a, b) => a - b); const S0 = ring.length ? ring[Math.floor(ring.length * 0.3)] : -Infinity, soft = softL;
  if (isTwo(two) && two.share > 0.08 && two.share < 0.8) { D0 = two.lo; E0 = two.hi; }
  else if (Eth < Infinity) { const low = vals.filter((v) => v <= Eth).sort((a, b) => a - b); if (low.length >= 6) D0 = low[low.length >> 1]; E0 = twoP.hi; }   // (no enamel to speak of in this slice: its level from the slices beside it)
  const C = soft != null ? Math.max(D0 - soft, 1.2 * (D0 - T), 50) : Math.max(D0 - Math.max(S0, D0 - 2.5 * (D0 - T)), 1.2 * (D0 - T), 50), Dcap = E0 != null ? (D0 + E0) / 2 : D0 + 0.35 * C, dark = Math.round(T - C);
  // ── following it: from a slice's mask to the next slice's ──
  const W = Math.max(2, Math.round(mm(1.25))), Ro = Math.max(1, Math.round(mm(0.75))), lab = new Int32Array(sl), hull = new Int16Array(sl), cand = new Int8Array(sl), cur = new Uint8Array(sl), sol = new Uint8Array(sl), motOf = new Int16Array(sl), motPrev = new Int16Array(sl);
  const isum = new Float64Array((n0 + 1) * (n1 + 1)), icnt = new Int32Array((n0 + 1) * (n1 + 1)), isum2 = new Float64Array((n0 + 1) * (n1 + 1)), icnt2 = new Int32Array((n0 + 1) * (n1 + 1)), prof = new Float32Array(512), OI = 4, NS = OI + 4, U = new Float32Array(NRAY * NS), st = [];   // (the edge is looked for from 2 voxels inside where it was to 1½ outside: further in, a fall in grey is the gap opening between two roots — or a canal — and what lies beyond it is still tooth)
  const polys = [], force = new Uint8Array(sl), Tlow = soft != null ? (soft + T) / 2 : T - 0.4 * C, age = new Uint8Array(sl), freshMot = () => ({ unsup: 0, cx: 0, cy: 0, area: 0, fresh: true, hist: [], trail: [], uh: [], over: 0 });
  const run = (startMask, kStart, dirs) => {
    for (let p = 0; p < sl; p++) if (startMask[p]) mask[kStart * sl + p] = 1;
    for (const dir of dirs) {
      let prev = startMask.slice(), mots = [freshMot()], Aeq = 0; motPrev.fill(0); for (let p = 0; p < sl; p++) age[p] = startMask[p] ? 0 : 255;
      for (let k = kStart + dir; k >= 0 && k < n2; k += dir) {
        const base = k * sl, pbase = (k - dir) * sl, val = (i, j) => { if (i < 0 || j < 0 || i >= n0 || j >= n1) return NaN; const a = allow[base + i + n0 * j]; return a === 1 ? I[base + i + n0 * j] : a === 0 ? dark : NaN; };   // (cut away: dark; outside the region: not known)
        const bil = (x, y) => { const i = Math.floor(x), j = Math.floor(y), tx = x - i, ty = y - j; return (val(i, j) * (1 - tx) + val(i + 1, j) * tx) * (1 - ty) + (val(i, j + 1) * (1 - tx) + val(i + 1, j + 1) * tx) * ty; };
        // the tooth's own level round each place, from the slice before (its tissue below the enamel's level)
        for (let j = 0; j < n1; j++) { let rs = 0, rc = 0, rs2 = 0, rc2 = 0; for (let i = 0; i < n0; i++) { const p = i + n0 * j; if (prev[p] && I[pbase + p] >= T) { const v = I[pbase + p]; if (v <= Dcap) { rs += v; rc++; } rs2 += Math.min(v, Dcap); rc2++; } const q = (i + 1) + (n0 + 1) * (j + 1); isum[q] = isum[q - (n0 + 1)] + rs; icnt[q] = icnt[q - (n0 + 1)] + rc; isum2[q] = isum2[q - (n0 + 1)] + rs2; icnt2[q] = icnt2[q - (n0 + 1)] + rc2; } }
        const Dloc = (i, j) => { const a0 = Math.max(0, i - W), a1 = Math.min(n0, i + W + 1), b0 = Math.max(0, j - W), b1 = Math.min(n1, j + W + 1), w = n0 + 1, c = icnt[a1 + w * b1] - icnt[a0 + w * b1] - icnt[a1 + w * b0] + icnt[a0 + w * b0]; if (c >= 3) return (isum[a1 + w * b1] - isum[a0 + w * b1] - isum[a1 + w * b0] + isum[a0 + w * b0]) / c;
          const c2 = icnt2[a1 + w * b1] - icnt2[a0 + w * b1] - icnt2[a1 + w * b0] + icnt2[a0 + w * b0]; return c2 > 0 ? (isum2[a1 + w * b1] - isum2[a0 + w * b1] - isum2[a1 + w * b0] + isum2[a0 + w * b0]) / c2 : NaN; };   // (all enamel there: its level, capped)
        // may a voxel be tooth? not much darker than the tooth's own tissue beside it (a fifth of the way to soft tissue), or
        // above the level half way to the darkest thing within ¾ mm (the blurred edge of the tooth against something dark)
        cand.fill(-1);
        const isCand = (i, j) => { if (i < 0 || j < 0 || i >= n0 || j >= n1) return 0; const p = i + n0 * j; if (cand[p] >= 0) return cand[p]; let c = 0; const v = I[base + p];
          if (allow[base + p] === 1 && v >= T) { const D = Dloc(i, j); if (D === D) { let lim = D - 0.2 * C; if (v < lim) { let mn = v; for (let b = -Ro; b <= Ro; b++) for (let a = -Ro; a <= Ro; a++) { const u = val(i + a, j + b); if (u < mn) mn = u; } lim = Math.min(lim, (D + mn) / 2); } c = v >= Math.max(T, lim) ? 1 : 0; } }
          cand[p] = c; return c; };
        // the pieces of the mask in the slice before, and an outline round each in this slice
        lab.fill(0); hull.fill(0); force.fill(0); const comps = [], outl = [null];
        const inward = (p, i, j) => { const o = outl[hull[p]]; if (!o) return false; const dx = i - o.cx, dy = j - o.cy; return Math.hypot(dx, dy) < radiusAt(o.rp, dx, dy) - 1; };   // (within the piece's own reach from its middle: in a hollow of it, not on its outside)
        for (let p0 = 0; p0 < sl; p0++) { if (!prev[p0] || lab[p0]) continue; const id = comps.length + 1, vox = []; lab[p0] = id; st.push(p0); while (st.length) { const p = st.pop(), i = p % n0, j = (p / n0) | 0; vox.push(p); if (i > 0 && prev[p - 1] && !lab[p - 1]) { lab[p - 1] = id; st.push(p - 1); } if (i < n0 - 1 && prev[p + 1] && !lab[p + 1]) { lab[p + 1] = id; st.push(p + 1); } if (j > 0 && prev[p - n0] && !lab[p - n0]) { lab[p - n0] = id; st.push(p - n0); } if (j < n1 - 1 && prev[p + n0] && !lab[p + n0]) { lab[p + n0] = id; st.push(p + n0); } } comps.push(vox); }
        // a piece that cannot be seen whole from its own middle (two roots still joined by a neck of tooth between them: a
        // dumb-bell) is followed as its parts: it is worn down evenly until it falls apart, and each voxel goes to the part nearest it
        for (let c0 = 0, nC = comps.length; c0 < nC; c0++) { const vox = comps[c0], id = c0 + 1; if (vox.length < 40) continue; let sx = 0, sy = 0; for (const p of vox) { sx += p % n0; sy += (p / n0) | 0; } const cx = sx / vox.length, cy = sy / vox.length, Rr = new Float32Array(NRAY);
          for (let t = 0; t < NRAY; t++) { let last = 0; for (let tt = 0; tt < 200; tt += 0.5) { const ii = Math.round(cx + tt * RCOS[t]), jj = Math.round(cy + tt * RSIN[t]); if (ii < 0 || jj < 0 || ii >= n0 || jj >= n1) break; if (lab[ii + n0 * jj] === id) last = tt; else if (tt > last + 12) break; } Rr[t] = last; }
          let hidden = 0; for (const p of vox) { const dx = (p % n0) - cx, dy = ((p / n0) | 0) - cy; let a = Math.atan2(dy, dx) / (2 * Math.PI) * NRAY; if (a < 0) a += NRAY; const ta = Math.floor(a) % NRAY; if (Math.hypot(dx, dy) > Math.max(Rr[ta], Rr[(ta + 1) % NRAY]) + 1) hidden++; }
          if (hidden <= Math.max(8, 0.06 * vox.length)) continue;
          let E = new Set(vox), cores = null;
          for (let r = 1; r <= 8 && E.size > 8 && !cores; r++) { const E2 = new Set(); for (const p of E) { const i = p % n0, j = (p / n0) | 0; if (i > 0 && j > 0 && i < n0 - 1 && j < n1 - 1 && E.has(p - 1) && E.has(p + 1) && E.has(p - n0) && E.has(p + n0)) E2.add(p); } E = E2;
            const seenE = new Set(), parts = []; for (const p0 of E) { if (seenE.has(p0)) continue; const part = []; seenE.add(p0); st.push(p0); while (st.length) { const p = st.pop(); part.push(p); for (const q of [p - 1, p + 1, p - n0, p + n0]) if (E.has(q) && !seenE.has(q)) { seenE.add(q); st.push(q); } } parts.push(part); }
            const big = parts.filter((x) => x.length >= 4); if (big.length >= 2) cores = big; }
          if (!cores) continue;
          const own = new Map(); let front = []; cores.forEach((part, m) => { for (const p of part) { own.set(p, m); front.push(p); } });
          while (front.length) { const nxt = []; for (const p of front) { const m = own.get(p); for (const q of [p - 1, p + 1, p - n0, p + n0]) if (lab[q] === id && !own.has(q)) { own.set(q, m); nxt.push(q); } } front = nxt; }
          const subs = cores.map(() => []); for (const p of vox) { const m = own.get(p); if (m != null) subs[m].push(p); else subs[0].push(p); }
          comps[c0] = subs[0]; for (let m = 1; m < subs.length; m++) { const nid = comps.length + 1; for (const p of subs[m]) lab[p] = nid; comps.push(subs[m]); } }
        const newMots = [null];
        comps.forEach((vox, ci0) => {
          const id = ci0 + 1; let sx = 0, sy = 0, i0 = n0, i1 = 0, j0 = n1, j1 = 0; const tally = new Map();
          for (const p of vox) { const i = p % n0, j = (p / n0) | 0; sx += i; sy += j; if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; tally.set(motPrev[p], (tally.get(motPrev[p]) || 0) + 1); }
          const cx = sx / vox.length, cy = sy / vox.length; let mi = 0, mc = -1; for (const [key, c] of tally) if (c > mc) { mc = c; mi = key; }
          const m0 = mots[mi] || mots[0], split = !m0.fresh && m0.area > 0 && vox.length < 0.7 * m0.area, m = { unsup: m0.unsup, cx, cy, area: vox.length, fresh: false };
          newMots.push(m); const mid = newMots.length - 1;
          if (split && vox.length < Math.max(mm(1) * mm(1), 0.04 * m0.area)) return;   // a crumb breaking off a large piece (a bit of bone or of the next tooth that hung on it) is not a root
          if (vox.length < 6) { for (const p of vox) if (!hull[p]) hull[p] = mid; return; }   // the last of a root's tip: it may only shrink
          // rays from its middle: how far the piece reaches (rp: the outer face of its outermost voxel), how far it reached in the
          // last three slices (rm: what it may win back), and the fall in grey near there
          const rp = new Float32Array(NRAY), rm = new Float32Array(NRAY), qp = new Int16Array(NRAY), rh = new Float32Array(NRAY), rf = new Float32Array(NRAY), seen = new Uint8Array(NRAY), faceR = new Uint8Array(NRAY), ext = Math.hypot(i1 - i0 + 1, j1 - j0 + 1) + 2; let sup = 0, strong = 0, blind = 0, brt = 0;
          for (let t = 0; t < NRAY; t++) { let last = 0; for (let tt = 0; tt <= ext; tt += 0.5) { const ii = Math.round(cx + tt * RCOS[t]), jj = Math.round(cy + tt * RSIN[t]); if (ii < 0 || jj < 0 || ii >= n0 || jj >= n1) break; if (lab[ii + n0 * jj] === id) last = tt; }
            rp[t] = Math.max(0.5, last); qp[t] = Math.max(2, Math.round(2 * rp[t])); let far = rp[t]; for (let tt = rp[t] + 0.5; tt <= rp[t] + 3; tt += 0.5) { const ii = Math.round(cx + tt * RCOS[t]), jj = Math.round(cy + tt * RSIN[t]); if (ii < 0 || jj < 0 || ii >= n0 || jj >= n1) break; const q = ii + n0 * jj; if (lab[q] === id) continue; if (lab[q] || age[q] > 2) break; far = tt; } rm[t] = far; }
          // the piece's history: its size when smallest, and whether it may still widen. A piece that has split off (a root, a cusp),
          // has narrowed by a tenth, or no longer stands free only ever narrows: what would widen it is bone it lies against, or the
          // tooth it bites on
          const Aprev = polyArea(rp), n4 = Math.max(1, Math.round(1 / hz)), n10 = Math.max(2, Math.round(2.5 / hz)); let par = 0, parArmed = false; for (const [key, c] of tally) if (key && mots[key] && c >= Math.max(6, 0.2 * vox.length)) { par++; if (mots[key].armed) parArmed = true; }
          if (m0.fresh && !Aeq) Aeq = Aprev;
          if (m0.fresh || split || par > 1) { m.a0 = m.amin = Aprev; m.armed = !m0.fresh && (split || parArmed); m.hist = []; m.over = 0; m.trail = [{ base: pbase, vox, A: Aprev }]; m.uh = []; }
          else { m.a0 = Math.max(m0.a0, Aprev); m.amin = Math.min(m0.amin, Aprev); m.armed = m0.armed || m.amin < 0.9 * m.a0; m.hist = Aprev <= m0.amin ? [] : m0.hist.concat([{ base: pbase, vox }]); m.over = m0.over; m.trail = m0.trail.concat([{ base: pbase, vox, A: Aprev }]).slice(-(n10 + 1)); m.uh = m0.uh; }
          outl[mid] = { cx, cy, rp };
          const ev = (t, q, out) => {               // the fall in grey at half-voxel q along ray t → 0…1 (1: a fifth of the way to soft tissue, or more); out: [inside level, darkest beyond, where]
            if (q < 2) return 0; let inn = -Infinity, mn = Infinity, mq = q + 1; for (let a = Math.max(0, q - 6); a < q; a++) if (prof[a] > inn) inn = prof[a]; for (let a = q + 1; a <= q + 6; a++) { const u = prof[a]; if (u !== u) return 0; if (u < mn) { mn = u; mq = a; } }
            if (inn > capIn[t]) inn = capIn[t]; if (!(inn >= T) || !(prof[q - 1] >= prof[q + 1])) return 0; if (out) { out[0] = inn; out[1] = mn; out[2] = mq; } return N_clamp((inn - mn) / (0.2 * C), 0, 1); };
          // (a fall in grey is measured from no higher than the tooth's own level there: from enamel down to dentine — its own or the next tooth's — is not an edge of the tooth)
          // (the side a leaning root is moving towards — by what its two sides agreed on in the slice before — is looked for further out)
          const lead = new Uint8Array(NRAY); if (!m0.fresh && !split) for (let t = 0; t < NRAY; t++) if ((m0.Dx || 0) * RCOS[t] + (m0.Dy || 0) * RSIN[t] > 0.15) lead[t] = 1;
          const profs = new Float32Array(NRAY * 64), tmp = [0, 0, 0], capIn = new Float32Array(NRAY); for (let t = 0; t < NRAY; t++) { const rr = Math.max(0, rp[t] - 1.5), d = Dloc(Math.round(cx + rr * RCOS[t]), Math.round(cy + rr * RSIN[t])); capIn[t] = (d === d ? d : D0) + 0.1 * C; }
          for (let t = 0; t < NRAY; t++) { const Q = Math.min(63, qp[t] + 14); for (let q = 0; q <= Q; q++) prof[q] = bil(cx + 0.5 * q * RCOS[t], cy + 0.5 * q * RSIN[t]); for (let q = Q + 1; q < 64; q++) prof[q] = NaN; profs.set(prof.subarray(0, 64), t * 64);
            for (let s = 0; s < NS; s++) { const o = s - OI, q = qp[t] + o; U[t * NS + s] = q < 2 || q > 56 || (m.armed && o > (lead[t] ? 3 : 1)) ? 2 : -ev(t, q) + 0.06 * Math.abs(o); } }
          let t0 = 0, bu = Infinity; for (let t = 0; t < NRAY; t++) for (let s2 = 0; s2 < NS; s2++) if (U[t * NS + s2] < bu) { bu = U[t * NS + s2]; t0 = t; }
          const path = closedChain(U, NRAY, NS, 3, 0.05, t0);
          for (let t = 0; t < NRAY; t++) { prof.set(profs.subarray(t * 64, t * 64 + 64)); const q = qp[t] + path[t] - OI, e = ev(t, q, tmp);
            if (e >= 0.5) { sup++; seen[t] = 1; const inn = tmp[0], mn = tmp[1], mq = tmp[2]; if (inn - mn >= 0.6 * C) { strong++; faceR[t] = 1; } let aft = mn; for (let a = mq; a <= Math.min(63, mq + 6); a++) if (prof[a] > aft) aft = prof[a]; const rho = N_clamp((aft - mn) / Math.max(1, inn - mn), 0, 1), L = inn - (0.5 + 0.43 * rho) * (inn - mn); let qe = q; for (let a = Math.max(1, q - 4); a <= mq; a++) if (prof[a] <= L) { qe = a - (L - prof[a]) / Math.max(1e-6, prof[a - 1] - prof[a]); break; } rf[t] = Math.max(0.5, qe / 2); }
            else { rf[t] = rp[t]; let kn = true; for (let a = qp[t] + 1; a <= Math.min(63, qp[t] + 6); a++) if (prof[a] !== prof[a]) { kn = false; break; } if (kn) blind++; }
            { let sm = 0, c = 0; for (let a = qp[t] + 4; a <= Math.min(63, qp[t] + 8); a++) { if (prof[a] !== prof[a]) { c = 0; break; } sm += prof[a]; c++; } if (c && sm / c >= capIn[t] - 0.2 * C) brt++; } }   // (2 to 4 voxels beyond: as bright as the tooth itself)
          m.mg = brt >= 0.1 * NRAY ? (m0.mg || 0) + 1 : Math.max(0, (m0.mg || 0) - 2);   // (slices running in which it lies against something as bright as itself along a tenth of its outline or more)
          if (sup < 0.2 * NRAY && blind >= 0.5 * NRAY) { m.unsup += hz; m.uh = m.uh.concat([{ base: pbase, vox }]); } else { m.unsup = 0; m.uh = []; }
          if (m.unsup > 3) { for (const g of m.uh) for (const p of g.vox) mask[g.base + p] = 0; return; }   // no edge to be seen for 3 mm: this piece ended where the edges did
          // how far the piece has moved sideways since the slice before, as far as its two sides agree (one edge out, the opposite edge
          // in by as much; or one edge in and nothing to be seen opposite: half of it). A root that leans is followed; an edge that
          // moves out on one side alone (bone widening beside a root) is not
          let Dx = 0, Dy = 0; { let sxx = 2, sxy = 0, syy = 2, bx = 0, by = 0; const H = NRAY >> 1, fl = (x) => Math.sign(x) * Math.max(0, Math.abs(x) - 0.15);
            for (let t = 0; t < H; t++) { const u = t + H; if (!seen[t] && !seen[u]) continue; const a = rf[t] - rp[t], b = rf[u] - rp[u]; let tau = 0;
              if (seen[t] && seen[u]) { if (a * b < 0) tau = Math.sign(a) * Math.max(0, Math.min(Math.abs(a), Math.abs(b)) - 0.15); } else if (seen[t]) { if (a < 0) tau = 0.5 * fl(a); } else if (b < 0) tau = -0.5 * fl(b);
              sxx += RCOS[t] * RCOS[t]; sxy += RCOS[t] * RSIN[t]; syy += RSIN[t] * RSIN[t]; bx += RCOS[t] * tau; by += RSIN[t] * tau; }
            const det = sxx * syy - sxy * sxy; Dx = (syy * bx - sxy * by) / det; Dy = (sxx * by - sxy * bx) / det; const dn = Math.hypot(Dx, Dy); if (dn > 0.8) { Dx *= 0.8 / dn; Dy *= 0.8 / dn; } } m.Dx = Dx; m.Dy = Dy;
          if (!m.armed && strong < 0.5 * NRAY && sup + blind >= 0.7 * NRAY) m.armed = true;   // (soft tissue or air round less than half of it: it is in the bone)
          // the outline: where an edge was seen, up to ¾ voxel beyond it (the voxels on the edge itself are judged by their grey). A
          // piece that only narrows wins back at most ¾ voxel a slice towards an edge it sees, and where it sees none stays where
          // it was, but for the shift its sides agree on
          for (let t = 0; t < NRAY; t++) { rh[t] = rf[t] + (seen[t] && seen[(t + 1) % NRAY] && seen[(t + NRAY - 1) % NRAY] ? 0.75 : 0); if (m.armed) { const rr = Math.max(rp[t], rm[t]), sh = Math.max(0, Dx * RCOS[t] + Dy * RSIN[t]), lm = (seen[t] && rf[t] - rr <= (lead[t] ? 3 : 1.5) ? rr + (lead[t] ? 1.5 : 0.75) : seen[t] ? rr : rp[t]) + sh; if (!seen[t]) rh[t] = rp[t] + sh; if (rh[t] > lm) rh[t] = lm; } }   // (an edge far outside it is not its own: the outer face of bone it lies against. Where none is seen, it moves on by the shift its sides agree on)
          if (P.debug) P.debug({ what: 'piece', k, dir, cx, cy, n: vox.length, Aprev, amin: m.amin, a0: m.a0, armed: m.armed, sup, strong, brt, mg: m.mg, Dx, Dy, unsup: m.unsup, split, par, Afree: polyArea(rf), Ah: polyArea(rh), rp, rf, rh, rm, seen, profs, path, qp });
          if (m.armed) {
            // a small piece (the tip of a cusp, of a root) that finds itself inside something wider, twice running, has run into the tooth it bites on (or into bone): it ended where it was smallest
            if (m.amin < mm(2) * mm(2) && polyArea(rf) > 1.6 * m.amin + 8) { if (++m.over >= 2) { for (const g of m.hist) for (const p of g.vox) mask[g.base + p] = 0; return; } } else m.over = 0;
            // and a piece that lies against something as bright as itself (a plate of bone) and has stopped
            // narrowing — for a millimetre if it is small, for 2½ mm if it is a third of the crown's size or less — is no longer
            // a root: a root narrows to its tip, the bone it lies against does not
            if (m.mg) { const L = m.trail.length, back = Aprev < mm(2.25) * mm(2.25) && L > n4 && m.mg > n4 ? n4 : Aprev < 0.35 * Aeq && L > n10 && m.mg > n10 ? n10 : 0;
              if (back && Aprev > 0.9 * m.trail[L - 1 - back].A) { for (const g of m.trail.slice(L - (back >> 1))) for (const p of g.vox) mask[g.base + p] = 0; return; } } }   // (the root itself narrowed inside what was followed, so its end is put midway)
          const R = Math.ceil(Math.max(...rh)) + 2, ic = Math.round(cx), jc = Math.round(cy);
          for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) { const ii = ic + a, jj = jc + b; if (ii < 0 || jj < 0 || ii >= n0 || jj >= n1) continue; const dx = ii - cx, dy = jj - cy, p = ii + n0 * jj; if (!hull[p] && Math.hypot(dx, dy) <= radiusAt(rh, dx, dy)) hull[p] = mid; }

          // an outline seen nearly all round, of a small piece: inside it, anything brighter than midway between soft tissue and the
          // threshold is the tooth (the wall of a root near its tip, too thin to read as bright as dentine); and see below
          if (m.armed && sup >= 0.8 * NRAY) { polys.push({ k, dir, cx, cy, r: rf.slice() });
            if (Aprev < mm(2.5) * mm(2.5)) for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) { const ii = ic + a, jj = jc + b; if (ii < 0 || jj < 0 || ii >= n0 || jj >= n1) continue; const dx = ii - cx, dy = jj - cy, p = ii + n0 * jj; if (allow[base + p] === 1 && I[base + p] >= Tlow && Math.hypot(dx, dy) <= radiusAt(rf, dx, dy) - 0.25) force[p] = 1; } }
          // and what the piece already had stays unless an edge was seen inside it, on the rays to either side of it (a root that stands
          // off to one side, beyond the gap between the roots, is not cut down to what the rays between happen to reach)
          for (const p of vox) { if (hull[p]) continue; const dx = (p % n0) - cx, dy = ((p / n0) | 0) - cy, d = Math.hypot(dx, dy); let a = Math.atan2(dy, dx) / (2 * Math.PI) * NRAY; if (a < 0) a += NRAY; const ta = Math.floor(a) % NRAY, tb = (ta + 1) % NRAY;
            if (!(seen[ta] && seen[tb] && d > Math.max(rh[ta], rh[tb]))) hull[p] = mid; }
        });
        // inside the outlines: what stays, what may be added (a ring at a time, twice, each new voxel with a fall in grey beyond it), holes of tooth tissue
        let count = 0; cur.fill(0); for (let p = 0; p < sl; p++) if (prev[p] && hull[p] && isCand(p % n0, (p / n0) | 0)) { cur[p] = 1; count++; }
        if (count) for (let ring2 = 0; ring2 < 2; ring2++) { const add = []; for (let p = 0; p < sl; p++) { if (cur[p] || !hull[p]) continue; const i = p % n0, j = (p / n0) | 0; let di = 0, dj = 0;
            if (i > 0 && cur[p - 1]) di = 1; else if (i < n0 - 1 && cur[p + 1]) di = -1; else if (j > 0 && cur[p - n0]) dj = 1; else if (j < n1 - 1 && cur[p + n0]) dj = -1; else continue;
            if (!isCand(i, j) || (I[base + p] > Dcap && inward(p, i, j))) continue; let supd = false; const dl = Dloc(i, j), lev = Math.min(I[base + p], (dl === dl ? dl : D0) + 0.1 * C) - 0.2 * C; for (let t = 1; t <= 3 && !supd; t++) { const u = val(i + t * di, j + t * dj); if (u <= lev) supd = true; }   // (a fall from the new voxel's own level: not a step from enamel to dentine, nor the region's edge)
            if (!supd && ((i > 0 && cur[p - 1]) + (i < n0 - 1 && cur[p + 1]) + (j > 0 && cur[p - n0]) + (j < n1 - 1 && cur[p + n0])) >= 3) supd = true;   // (a notch in the outline may fill)
            if (supd) add.push(p); } for (const p of add) { cur[p] = 1; count++; } }
        // holes of tooth tissue (the roof and the floor of the pulp chamber, which may stand as an island in the pulp): bright and
        // enclosed. Not an island as bright as enamel: that is a cusp of the opposing tooth biting into the hollow of this one
        if (count) { solid2(cur, n0, n1, sol); lab.fill(0);
          const fits = (p) => sol[p] && !cur[p] && hull[p] && isCand(p % n0, (p / n0) | 0);
          for (let p0 = 0; p0 < sl; p0++) { if (lab[p0] || !fits(p0)) continue; const reg = []; let ne = 0; lab[p0] = 1; st.push(p0);
            while (st.length) { const p = st.pop(), i = p % n0, j = (p / n0) | 0; reg.push(p); if (I[base + p] > Dcap) ne++; for (const [a, b] of N4) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= n0 || jj >= n1) continue; const q = ii + n0 * jj; if (!cur[q] && !lab[q] && fits(q)) { lab[q] = 1; st.push(q); } } }
            if (ne < 0.4 * reg.length) for (const p of reg) { cur[p] = 1; count++; } } }
        for (let p = 0; p < sl; p++) if (force[p] && !cur[p]) { cur[p] = 1; count++; }
        if (P.debug) P.debug({ what: 'slice', k, dir, cur: cur.slice(), hull: hull.slice(), prev: prev.slice(), cand: Int8Array.from({ length: sl }, (_, p) => isCand(p % n0, (p / n0) | 0)), I: I.subarray(base, base + sl), n0, n1, comps: comps.length });
        if (!count) break;
        for (let p = 0; p < sl; p++) { if (cur[p]) { mask[base + p] = 1; motPrev[p] = hull[p]; } else motPrev[p] = 0; }
        for (let p = 0; p < sl; p++) age[p] = cur[p] ? 0 : age[p] < 255 ? age[p] + 1 : 255;
        prev = cur.slice(); mots = newMots; mots[0] = freshMot();
      }
    }
  };
  run(start, kEq, [1, -1]);
  // ── the biting surface: on the side that still has enamel some millimetres from the start, the crown narrows to the tips of
  //    its cusps; where it stops narrowing it has run on into the tooth it bites against, and is cut there ──
  let occ = 0; {
    const Eth = soft != null ? soft + 1.5 * (D0 - soft) : D0 + 0.45 * C, areaOf = (k) => { if (k < 0 || k >= n2) return [0, 0]; let a = 0, e = 0; const base = k * sl; for (let p = 0; p < sl; p++) if (mask[base + p]) { a++; if (I[base + p] > Eth) e++; } return [a, e]; };
    const sc = [1, -1].map((dir) => { let c = 0; for (let s = Math.round(0.5 / hz); s <= Math.round(5 / hz); s++) { const [a, e] = areaOf(kEq + dir * s); if (a && e >= 0.1 * a) c++; } return c; });
    if (sc[0] >= 1 / hz && sc[0] >= 2 * sc[1]) occ = 1; else if (sc[1] >= 1 / hz && sc[1] >= 2 * sc[0]) occ = -1;
    if (occ) { const A0 = areaOf(kEq)[0], n3 = Math.max(1, Math.round(0.75 / hz)); let cut = -1;
      for (let k = kEq + occ; k >= 0 && k < n2; k += occ) { const a = areaOf(k)[0]; if (!a) break; if (a >= 0.7 * A0) continue;
        if (a < Math.max(8, 0.04 * A0)) { cut = k; break; }   // (the last sliver of the highest cusp's tip — or of the tooth above, where they touch)
        if (areaOf(k + occ * n3)[0] > 0.85 * a) { let best = a; cut = k; for (let q = 1; q <= n3; q++) { const b = areaOf(k + occ * q)[0]; if (b && b < best) { best = b; cut = k + occ * q; } } break; } }
      if (P.debug) P.debug({ what: 'trim', occ, cut, kEq, A0, sc, areas: Array.from({ length: n2 }, (_, k) => areaOf(k)[0]) });
      if (cut >= 0) for (let k = cut + occ; k >= 0 && k < n2; k += occ) mask.fill(0, k * sl, (k + 1) * sl); } }
  // ── a root whose edge was seen nearly all round is solid inside that edge: its wall may be too thin near the tip to read as
  //    bright as dentine, and its canal is part of it. (On the biting side the same would fill the hollow between the cusps.) ──
  if (occ) for (const g of polys) { if (g.dir !== -occ || g.k === kEq) continue; const base = g.k * sl, R = Math.ceil(Math.max(...g.r)) + 1, ic = Math.round(g.cx), jc = Math.round(g.cy); let any = false;
    for (let b = -R; b <= R && !any; b++) for (let a = -R; a <= R && !any; a++) { const ii = ic + a, jj = jc + b; if (ii < 0 || jj < 0 || ii >= n0 || jj >= n1) continue; const dx = ii - g.cx, dy = jj - g.cy; if (mask[base + ii + n0 * jj] && Math.hypot(dx, dy) <= radiusAt(g.r, dx, dy)) any = true; }
    if (!any) continue;   // (the piece was given up after all: bone it ran on into)
    for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) { const ii = ic + a, jj = jc + b; if (ii < 0 || jj < 0 || ii >= n0 || jj >= n1) continue; const dx = ii - g.cx, dy = jj - g.cy, p = ii + n0 * jj; if (allow[base + p] === 1 && Math.hypot(dx, dy) <= radiusAt(g.r, dx, dy) - 0.25) mask[base + p] = 1; } }
  // ── roots in the bone, redrawn. Where bone as bright as the root lies against it, a voxel's grey cannot say which of the two
  //    it is, and an outline kept voxel by voxel takes in wedges of bone and comes out with bumps and spikes on it. A root is
  //    a smooth thing that changes little from slice to slice: so from the level at which the tooth first stands in bone, each
  //    piece is drawn again as a smooth closed curve — a few harmonics round its middle — and followed down the root slice by
  //    slice. In each slice the root's edge is looked for afresh in the picture, near the curve of the slice before; the curve
  //    is fitted to the edges of that slice and of those just above and below. Where no edge shows, the curve keeps the root's
  //    shape. Below that level the tooth is what the curves hold. ──
  if (P.smoothRoots !== false) {
    const inPoly = (g, ii, jj, pad) => { const dx = ii - g.cx, dy = jj - g.cy; return Math.hypot(dx, dy) <= radiusAt(g.r, dx, dy) + pad; };
    // what the tooth holds in each slice, as it stands: its separate pieces (hollows in them filled — a root's canal, the ring
    // of a wide one), each with its middle, its outline along rays from there, and how much of that outline falls away to
    // soft tissue or air. (The pieces as they were followed will not do: a ring is followed as several lengths of wall.)
    const chains = [], S1 = new Uint8Array(sl), S3 = new Uint8Array(sl); let lbPrev = null, prev = [];
    const blobs = (k, dir) => { const base = k * sl, lb = new Int32Array(sl), list = [], st2 = []; for (let p = 0; p < sl; p++) S1[p] = mask[base + p]; solid2(S1, n0, n1, S3);
      for (let p0 = 0; p0 < sl; p0++) { if (!S3[p0] || lb[p0]) continue; const id = list.length + 1, vox = []; let sx = 0, sy = 0; lb[p0] = id; st2.push(p0);
        while (st2.length) { const p = st2.pop(), i = p % n0, j = (p / n0) | 0; vox.push(p); sx += i; sy += j; if (i > 0 && S3[p - 1] && !lb[p - 1]) { lb[p - 1] = id; st2.push(p - 1); } if (i < n0 - 1 && S3[p + 1] && !lb[p + 1]) { lb[p + 1] = id; st2.push(p + 1); } if (j > 0 && S3[p - n0] && !lb[p - n0]) { lb[p - n0] = id; st2.push(p - n0); } if (j < n1 - 1 && S3[p + n0] && !lb[p + n0]) { lb[p + n0] = id; st2.push(p + n0); } }
        list.push({ k, dir, id, cx: sx / vox.length, cy: sy / vox.length, n: vox.length, vox }); }
      for (const g of list) { if (g.n < 6) continue; const r = new Float32Array(NRAY), reach = 2 * Math.sqrt(g.n) + 4; let strong = 0;
        for (let t = 0; t < NRAY; t++) { let out = 0.5; for (let q = 0.5; q <= reach; q += 0.5) { const ii = Math.round(g.cx + q * RCOS[t]), jj = Math.round(g.cy + q * RSIN[t]); if (ii < 0 || jj < 0 || ii >= n0 || jj >= n1) break; if (lb[ii + n0 * jj] === g.id) out = q + 0.5; } r[t] = out;
          const at = (q) => { const ii = Math.round(g.cx + q * RCOS[t]), jj = Math.round(g.cy + q * RSIN[t]); return ii < 0 || jj < 0 || ii >= n0 || jj >= n1 ? NaN : I[base + ii + n0 * jj]; }, a1 = at(Math.max(0, out - 1.5)), a2 = at(Math.max(0, out - 2.5)), b1 = at(out + 1), b2 = at(out + 2), b3 = at(out + 3);
          if (Math.max(a1, a2) - Math.min(b1, b2, b3) >= 0.6 * C) strong++; }
        g.r = r; g.strong = strong; g.inBone = strong < 0.5 * NRAY; }
      return { lb, list: list.filter((g) => g.r) }; };
    // each piece joined to the one it came from in the slice before (the one it lies over most): a root from the furcation to
    // its tip. A piece that alone goes on from another is the same line; two or more that go on from one are parts it has
    // parted into, each a line of its own
    for (const dir of occ ? [-occ] : [1, -1]) { lbPrev = null; prev = []; let gap = 0; for (let k = kEq + dir; k >= 0 && k < n2; k += dir) { const { lb, list } = blobs(k, dir); if (!list.length) { if (++gap > 2) break; continue; } gap = 0;
        for (const g of list) { g.par = null; if (lbPrev) { const cnt = new Map(); for (const p of g.vox) { const id = lbPrev[p]; if (id) cnt.set(id, (cnt.get(id) || 0) + 1); } let bo = 0; for (const [id, c] of cnt) if (c > bo) { const q = prev.find((x) => x.id === id); if (q) { bo = c; g.par = q; } } } }
        for (const q of prev) { const kids = list.filter((g) => g.par === q); if (kids.length === 1) { kids[0].chain = q.chain; q.chain.push(kids[0]); } }
        for (const g of list) if (!g.chain) { g.chain = [g]; g.chain.parent = g.par; chains.push(g.chain); }
        lbPrev = lb; prev = list; } }
    // from the level at which a piece of some size first stands in bone for 1½ mm running (not for a slice or two: where two
    // roots part, each faces the other for a moment; and not a scrap), every piece on the root side is redrawn
    let Aeq = 0; for (let p = 0; p < sl; p++) if (mask[kEq * sl + p]) Aeq++;
    const nmm = Math.max(2, Math.round(1 / hz)), nrun = Math.max(3, Math.round(1.5 / hz)), rootSide = (ch) => !occ || ch[0].dir === -occ, level = { 1: Infinity, [-1]: Infinity };
    for (const ch of chains) { ch.a0 = -1; ch.kids = []; if (!rootSide(ch)) continue; const d = ch[0].dir; let run = ch.parent && ch.parent.run ? ch.parent.run : 0;   // (a run goes on from a piece into those it parts into)
      for (let a = 0; a < ch.length; a++) { const g = ch[a]; run = g.inBone && g.n >= 0.12 * Aeq ? run + 1 : 0; g.run = run; if (run >= nrun) level[d] = Math.min(level[d], Math.max(1, Math.abs(g.k - kEq) - (run - 1))); } }
    for (const ch of chains) { if (!rootSide(ch)) continue; ch.a0 = ch.findIndex((g) => Math.abs(g.k - kEq) >= level[ch[0].dir]); if (ch.parent) ch.parent.chain.kids.push(ch); }
    const solveN = (N, b, n) => { const A = Float64Array.from(N), x = Float64Array.from(b); for (let c = 0; c < n; c++) { let pv = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[pv * n + c])) pv = r; if (Math.abs(A[pv * n + c]) < 1e-12) return null; if (pv !== c) { for (let q = 0; q < n; q++) { const t = A[c * n + q]; A[c * n + q] = A[pv * n + q]; A[pv * n + q] = t; } const t = x[c]; x[c] = x[pv]; x[pv] = t; }
        for (let r = c + 1; r < n; r++) { const f = A[r * n + c] / A[c * n + c]; if (!f) continue; for (let q = c; q < n; q++) A[r * n + q] -= f * A[c * n + q]; x[r] -= f * x[c]; } }
      for (let c = n - 1; c >= 0; c--) { let v = x[c]; for (let q = c + 1; q < n; q++) v -= A[c * n + q] * x[q]; x[c] = v / A[c * n + c]; } return x; };
    // the grey at a point of a slice (between voxels; evened out with the slices next to it, where they lie close)
    const zsm = hz <= 0.35, samp = (k, x, y) => { if (!(x >= 0 && y >= 0 && x <= n0 - 1 && y <= n1 - 1)) return NaN; const i = Math.min(n0 - 2, x | 0), j = Math.min(n1 - 2, y | 0), fx = x - i, fy = y - j; let v = 0, w = 0;
      for (let d = zsm ? -1 : 0; d <= (zsm ? 1 : 0); d++) { const kk = k + d; if (kk < 0 || kk >= n2) continue; const q = kk * sl + i + n0 * j, wt = d ? 1 : 2; v += wt * ((I[q] * (1 - fx) + I[q + 1] * fx) * (1 - fy) + (I[q + n0] * (1 - fx) + I[q + n0 + 1] * fx) * fy); w += wt; } return v / w; };
    // the root's edge looked for afresh in the picture, along rays from a middle, near where a curve says it should be (no
    // further in or out of it than given): a fall from tooth to something darker, where it is steepest — the nearest such to
    // the curve, a stronger one a little further off counting for more. Where there is none: is it dark on either side of the
    // curve (then the root is not there, and its edge is as far in as it is bright), or bright on and on beyond it (open)?
    const gmin = 0.1 * C, gfull = 0.3 * C, stepZ = hz / h, inB = Math.max(1, 1.5 * stepZ), outB = Math.max(0.15, 0.2 * stepZ), G = new Float32Array(64);
    const measure = (k, cx, cy, Rp, inw, outw, Tb) => { const r = new Float32Array(NRAY).fill(-1), w = new Float32Array(NRAY), kind = new Uint8Array(NRAY), lev = [], base = k * sl;
      for (let t = 0; t < NRAY; t++) { const c = RCOS[t], s = RSIN[t], v = (q) => samp(k, cx + q * c, cy + q * s), wall = v(Math.max(0.4 * Rp[t], Rp[t] - mm(0.6))); if (wall === wall) lev.push(wall);
        let n = 0, blind = false; const q0 = Math.max(1, Rp[t] - inw) - 0.25; for (let q = q0; q <= Rp[t] + outw + 0.25 + 1e-6 && n < 64; q += 0.25, n++) { const ii = Math.round(cx + q * c), jj = Math.round(cy + q * s); if (ii < 0 || jj < 0 || ii >= n0 || jj >= n1 || allow[base + ii + n0 * jj] === 0) { blind = true; break; } const a = v(q - 1), b = v(q + 1); if (!(a === a && b === b)) { blind = true; break; } G[n] = a - b; }
        let best = -1, bs = 0, bg = 0; for (let i = 1; i < n - 1; i++) { const g = G[i]; if (g < gmin || g < G[i - 1] || g < G[i + 1]) continue; const den = G[i - 1] - 2 * g + G[i + 1], q = q0 + 0.25 * (i + (den < 0 ? 0.5 * (G[i - 1] - G[i + 1]) / den : 0)); if (Math.max(v(Math.max(0, q - 2)), v(Math.max(0, q - 1.25))) < Tb) continue; const sc = Math.min(g, gfull) * (1 - 0.35 * Math.min(2, Math.abs(q - Rp[t]))); if (sc > bs) { bs = sc; bg = g; best = q; } }
        // (the fall found, the edge itself is put where the grey passes the threshold on it — as everywhere else on the tooth.
        //  Blurred together with the dark ligament the fall is steepest a little inside the root's face. Where it does not come
        //  down to the threshold — bone as bright beyond: at the darkest point of the thin line between, if one shows)
        if (best >= 0) { const v0 = v(best); let q = best, hit = false; if (v0 >= T) { while (q < best + 1.5 && v(q + 0.125) >= T) q += 0.125; if (q < best + 1.5) { const a = v(q), b = v(q + 0.125); q += 0.125 * (a - T) / Math.max(1e-6, a - b); hit = true; } } else { while (q > best - 1 && v(q - 0.125) < T) q -= 0.125; if (q > best - 1) { const a = v(q - 0.125), b = v(q); q -= 0.125 * (T - b) / Math.max(1e-6, a - b); hit = true; } }
          if (hit) best = q; else if (v0 >= T) { let qm = best, vm = v0; for (let x = best + 0.25; x <= best + 2.5; x += 0.25) { const y = v(x); if (!(y === y)) break; if (y < vm) { vm = y; qm = x; } } let back = vm; for (let x = qm + 0.25; x <= qm + 2; x += 0.25) { const y = v(x); if (y > back) back = y; } if (qm > best && back - vm >= 0.4 * (v(best - 1) - vm)) best = qm - 0.25; }
          r[t] = best; w[t] = Math.max(0.3, Math.min(1, bg / gfull)); kind[t] = 1; continue; } if (blind) continue;
        const qi = Rp[t] - 1, vin = v(Math.max(0.5, qi));
        if (qi >= 0.5 && vin < Tb && v(Rp[t] + 1) < Tb && v(Rp[t] + 2) < Tb) { let q = qi; const lim = Math.max(0.5, Rp[t] - 2 * inw - 1); while (q > lim && !(v(q) >= Tb)) q -= 0.25; r[t] = Math.max(0.5, q + 0.5); w[t] = 0.5; kind[t] = 2; }
        else if (vin >= Tb && v(Rp[t] + mm(0.75)) >= Tb && v(Rp[t] + mm(1.5)) >= Tb) kind[t] = 3; }
      let open = 0, opp = 0; const sp = Math.round(NRAY / 12); for (let t = 0; t < NRAY; t++) { if (kind[t] !== 3) continue; open++; for (let d = -sp; d <= sp; d++) if (kind[(t + NRAY / 2 + d + NRAY) % NRAY] === 3) { opp++; break; } }
      lev.sort((a, b) => a - b); return { r, w, kind, open, opp, inside: lev.length ? lev[lev.length >> 1] : -Infinity }; };
    const inCurve = (c, x, y, pad) => { const dx = x - c.cx, dy = y - c.cy; return Math.hypot(dx, dy) <= radiusAt(c.R, dx, dy) + pad; };
    const middle = (c) => { let A = 0, sx = 0, sy = 0; for (let t = 0; t < NRAY; t++) { const u = (t + 1) % NRAY, x1 = c.R[t] * RCOS[t], y1 = c.R[t] * RSIN[t], x2 = c.R[u] * RCOS[u], y2 = c.R[u] * RSIN[u], a = x1 * y2 - x2 * y1; A += a; sx += a * (x1 + x2); sy += a * (y1 + y2); } return A > 1e-9 ? [c.cx + sx / (3 * A), c.cy + sy / (3 * A)] : [c.cx, c.cy]; };
    const about = (c, nx, ny) => { if (!inCurve(c, nx, ny, 0)) return null; const R = new Float32Array(NRAY); for (let t = 0; t < NRAY; t++) { let lo = 0, hi = 0.5; while (hi < 400 && inCurve(c, nx + hi * RCOS[t], ny + hi * RSIN[t], 0)) { lo = hi; hi += 0.5; } for (let i = 0; i < 5; i++) { const m = (lo + hi) / 2; if (inCurve(c, nx + m * RCOS[t], ny + m * RSIN[t], 0)) lo = m; else hi = m; } R[t] = Math.max(0.5, lo); } return { cx: nx, cy: ny, R }; };
    // (how much of the smallest outline without hollows that goes round an outline the outline itself fills: 1 for an oval, less for one with a waist)
    const solidity = (R) => { const P = Array.from(R, (r, t) => [r * RCOS[t], r * RSIN[t]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), H = []; for (const p of P) { while (H.length >= 2 && cr(H[H.length - 2], H[H.length - 1], p) <= 0) H.pop(); H.push(p); } const lo = H.length + 1; for (let i = P.length - 2; i >= 0; i--) { const p = P[i]; while (H.length >= lo && cr(H[H.length - 2], H[H.length - 1], p) <= 0) H.pop(); H.push(p); }
      let A = 0; for (let i = 0; i < H.length - 1; i++) A += H[i][0] * H[i + 1][1] - H[i + 1][0] * H[i][1]; return polyArea(R) / Math.max(1e-9, Math.abs(A) / 2); };
    const clipped = (g, pc, pad) => inCurve(pc, g.cx, g.cy, 0) ? Float32Array.from(g.r, (r, t) => { let q = r; while (q > 0.5 && !inCurve(pc, g.cx + q * RCOS[t], g.cy + q * RSIN[t], pad)) q -= 0.25; return q; }) : null;
    const fits = [], PHI = Float64Array.from({ length: NRAY }, (_, t) => 2 * Math.PI * t / NRAY);
    // follow(ch) — one line of pieces, redrawn from the level on; follow([], { k, dir, cur }) — a line that starts from a curve
    // alone (one of two roots a curve has come to hold: see below)
    const follow = (ch, start) => { const L = ch.length, a0 = start ? 0 : ch.a0, dir = start ? start.dir : ch[0].dir; if (a0 < 0) return;
      // (a piece that begins below the level is a root that parted from the piece before it — not one that came from nothing or
      //  from a piece given up; nor one that lies, for the most part, outside the curve of a root that itself goes on: that is
      //  bone the root ran on into)
      const par = start ? null : ch.parent, kill = (from) => { for (let a = from; a < L; a++) ch[a].dead = true; }; if (!start && (ch.dropped || (par && par.dead) || (!par && a0 === 0 && Math.abs(ch[0].k - kEq) > 1))) { kill(0); return; }
      if (!start && a0 === 0 && par && par.fit && !par.raw && par.chain[par.chain.length - 1] !== par) { const R = clipped(ch[0], { cx: par.sx, cy: par.sy, R: par.fit }, 0.5); if (!R || polyArea(R) < 0.6 * polyArea(ch[0].r)) { kill(0); return; } }
      const med = (start ? polyArea(start.cur.R) : ch.map((g) => g.n).sort((a, b) => a - b)[L >> 1]) * h * h, r0s = Array.from(start ? start.cur.R : ch[a0].r).sort((a, b) => a - b), long = r0s[Math.floor(0.9 * NRAY)] / Math.max(0.5, r0s[Math.floor(0.1 * NRAY)]);   // (a long outline — a ribbon of a root — takes more waves to draw)
      const M = (med >= 40 ? 6 : med >= 15 ? 5 : med >= 8 ? 4 : med >= 3 ? 3 : 2) + (med >= 8 && long > 2 ? 2 : med >= 8 && long > 1.5 ? 1 : 0), Pn = 2 * M + 1, B = new Float64Array(Pn), basis = (phi) => { B[0] = 1; for (let m = 1; m <= M; m++) { B[2 * m - 1] = Math.cos(m * phi); B[2 * m] = Math.sin(m * phi); } };
      const curveOf = (coef) => { const R = new Float32Array(NRAY); for (let t = 0; t < NRAY; t++) { basis(PHI[t]); let rr = 0; for (let i = 0; i < Pn; i++) rr += coef[i] * B[i]; R[t] = Math.max(0.5, rr); } return R; };
      const add = (s, phi, rho, w) => { basis(phi); for (let i = 0; i < Pn; i++) { s.b[i] += w * B[i] * rho; for (let j = 0; j < Pn; j++) s.N[i * Pn + j] += w * B[i] * B[j]; } }, blank = (k, cx, cy) => ({ k, cx, cy, N: new Float64Array(Pn * Pn), b: new Float64Array(Pn), sup: 0 });
      // (where no edge shows, the curve as it was, lightly; and a ray counts by the length of outline it stands for — the longer the further out)
      const edges = (s, ms, Rk, rho) => { let mr = 0; for (let t = 0; t < NRAY; t++) mr += Rk[t] / NRAY; for (let t = 0; t < NRAY; t++) { const real = ms.kind[t] === 1 || ms.kind[t] === 2; if (ms.kind[t] === 1) s.sup++; add(s, PHI[t], real ? ms.r[t] : Rk[t] * rho, (real ? ms.w[t] : 0.2) * Math.max(0.5, Math.min(3, Rk[t] / mr))); } return s; };
      // one slice's edges, with those of the slices next to it (the nearer the more): the smooth curve that fits them, with no
      // more wave in it than they call for
      const solve = (N, b) => { for (let m = 1; m <= M; m++) { N[(2 * m - 1) * Pn + 2 * m - 1] += 0.5 * m * m; N[2 * m * Pn + 2 * m] += 0.5 * m * m; } N[0] += 1e-6; const c = solveN(N, b, Pn); return c ? curveOf(c) : null; };
      const st = [], sg = Math.max(1, 0.6 / hz), win = Math.ceil(2.5 * sg), pooled = (a, lo, hi) => { const N = new Float64Array(Pn * Pn), b = new Float64Array(Pn); let any = false; for (let c = Math.max(0, lo); c <= hi; c++) { const q = st[c]; if (!q) continue; any = true; const gw = Math.exp(-0.5 * ((c - a) / sg) ** 2); for (let i = 0; i < Pn * Pn; i++) N[i] += gw * q.N[i]; for (let i = 0; i < Pn; i++) b[i] += gw * q.b[i]; } return any ? solve(N, b) : null; };
      // above the level the pieces stand as they were drawn: their edges, round a middle evened out along the tooth
      for (let a = Math.max(0, a0 - win - 1); a < a0; a++) { const g = ch[a]; let sx = 0, sy = 0, c = 0; for (let q = Math.max(0, a - 2); q <= Math.min(a0 - 1, a + 2); q++) { sx += ch[q].cx; sy += ch[q].cy; c++; } const s = blank(g.k, sx / c, sy / c);
        for (let t = 0; t < NRAY; t++) { const x = g.cx + g.r[t] * RCOS[t] - s.cx, y = g.cy + g.r[t] * RSIN[t] - s.cy; add(s, Math.atan2(y, x), Math.hypot(x, y), 1); } st[a] = s; }
      const wallOf = (k, c) => { const lv = []; for (let t = 0; t < NRAY; t++) { const q = Math.max(0.4 * c.R[t], c.R[t] - mm(0.6)), v = samp(k, c.cx + q * RCOS[t], c.cy + q * RSIN[t]); if (v === v) lv.push(v); } lv.sort((x, y) => x - y); return lv.length ? lv[lv.length >> 1] : D0; };
      // the curve to start from: that of the slices just above — or, for a piece that begins below the level, its own first
      // outline, smoothed. Either is then settled onto the edges of the first slice (in or out: it was drawn voxel by voxel;
      // and one half of a curve that held two roots may have a way to go)
      const kAt = (a) => start ? start.k + dir * a : a < L ? ch[a].k : ch[L - 1].k + dir * (a - L + 1); let cur = start ? start.cur : null; if (a0 > 0) { const R = pooled(a0 - 1, a0 - 1 - win, a0 - 1); if (R) cur = { cx: st[a0 - 1].cx, cy: st[a0 - 1].cy, R }; }
      if (!cur) { const g = ch[a0], s = blank(g.k, g.cx, g.cy); for (let t = 0; t < NRAY; t++) add(s, PHI[t], g.r[t], 1); const R = solve(s.N, s.b); cur = { cx: g.cx, cy: g.cy, R: R ? R.map((r, t) => Math.min(r, g.r[t] + 0.5)) : Float32Array.from(g.r) }; }
      let Dref = wallOf(kAt(a0), cur), Tb = T + 0.5 * Math.max(0, Dref - T);   // (as bright as tooth: half-way from the threshold to the root's own dentine, as it has been over the last millimetre)
      // (a piece such a curve cannot be made to fit is left as it was drawn, with only single-voxel spikes and nicks smoothed away)
      const asDrawn = () => { for (let a = a0; a < L; a++) { const g = ch[a]; fits.push({ k: g.k, sx: g.cx, sy: g.cy, fit: g.r, vox: g.vox, raw: true }); Object.assign(g, { sx: g.cx, sy: g.cy, fit: g.r, raw: true }); } ch.raw = true; };
      let was = new Uint8Array(NRAY);
      { const R0 = cur.R, more = start ? 4 : 1.5; for (let it = 0; it < (start ? 4 : 2); it++) { const ms = measure(kAt(a0), cur.cx, cur.cy, cur.R, 1.5, 1.5, Tb), s = edges(blank(kAt(a0), cur.cx, cur.cy), ms, cur.R, 1), R = solve(s.N, s.b); if (!R) break; was = Uint8Array.from(ms.kind, (x, t) => x === 1 && Math.abs(ms.r[t] - R[t]) <= 0.75 ? 1 : 0); cur = { cx: cur.cx, cy: cur.cy, R: R.map((r, t) => Math.max(0.5, Math.min(R0[t] + more, Math.max(R0[t] - 2.5, r)))) }; }
        const m = middle(cur); cur = about(cur, m[0], m[1]) || cur; Dref = wallOf(kAt(a0), cur); Tb = T + 0.5 * Math.max(0, Dref - T); }
      // (a curve drawn round one middle cannot hold a piece with a deep waist — two roots not yet parted: such a piece is left
      //  as it was drawn)
      if (!start) { const g = ch[a0]; let inn = 0; for (let t = 0; t < NRAY; t++) for (const f of [0.5, 0.9]) if (inCurve(cur, g.cx + f * g.r[t] * RCOS[t], g.cy + f * g.r[t] * RSIN[t], 0.5)) inn++; const q = Array.from(g.r).sort((x, y) => x - y), waist = q[Math.floor(0.9 * NRAY)] / Math.max(0.5, q[Math.floor(0.1 * NRAY)]); if (P.debug) P.debug({ what: 'cover', k: g.k, n: g.n, inn: inn / (2 * NRAY), M, A0: polyArea(g.r), A1: polyArea(cur.R), waist, sol0: solidity(g.r), sol1: solidity(cur.R) }); if (waist > 4 || solidity(cur.R) < 0.915) { asDrawn(); return; } }
      // down the root, slice by slice: the curve of the slice before, moved on as the root has been moving, says where this
      // slice's edge is to be looked for; where none shows, the root is taken to keep its shape (narrowing as it does where
      // its edge does show); and it may widen only little by little. The root ends where its own edge has shown round less
      // than a fifth of it for ¾ mm, or where what the curve holds is no longer as bright as tooth, or is next to nothing — or
      // where the curve lies open, on two opposite sides, onto more of the same brightness (a plate of bone the root has run
      // into) — or where, long since narrowed to a third, it has stopped narrowing (bone it has run on into)
      // (a tip with its edge, or darkness, nearly all round it need only be as bright as the threshold)
      const endKids = start ? [] : ch.kids.filter((q) => q.parent === ch[L - 1]), A0c = polyArea(cur.R), hist = [], areas = [], env = Float32Array.from(cur.R), fromLevel = !start && !(a0 === 0 && par && par.fit && !par.raw); let thin = false, vx = 0, vy = 0, lastOk = a0 - 1, split = false, cutAt = -1, waisted = 0, lobes = null;
      if (a0 >= 3) { vx = (st[a0 - 1].cx - st[a0 - 3].cx) / 2; vy = (st[a0 - 1].cy - st[a0 - 3].cy) / 2; }
      for (let a = a0; ; a++) { const k = kAt(a); if (k < 0 || k >= n2) break; const vn = Math.hypot(vx, vy), vm = 1.25 * stepZ; if (vn > vm) { vx *= vm / vn; vy *= vm / vn; }
        // (where the piece was drawn as parting into others: a root does part so, into two
        //  or more parts of some size that between them hold half and more of what it held (or a third, where the middle of
        //  the curve is by now not tooth at all) — they take over; a few scraps of bone it ran on into do not, and the root is
        //  followed on as it is)
        if (a === L && endKids.length) { let ak = 0, big = 0; const Ac = polyArea(cur.R); for (const q of endKids) { const R = clipped(q[0], cur, 1), A = R ? polyArea(R) : 0; q.share = A / Ac; ak += A; if (A >= 0.12 * Ac) big++; }
          if (P.debug) P.debug({ what: 'split', k, Ac: Ac * h * h, kids: endKids.map((q) => ({ n: q[0].n * h * h, share: q.share, cx: q[0].cx, cy: q[0].cy })), cur: { cx: cur.cx, cy: cur.cy } });
          const mid = []; for (let t = 0; t < NRAY; t++) { const v = samp(k, cur.cx + 0.2 * cur.R[t] * RCOS[t], cur.cy + 0.2 * cur.R[t] * RSIN[t]); if (v === v) mid.push(v); } mid.sort((x, y) => x - y); const hollow = mid.length > 0 && mid[mid.length >> 1] < Tb;
          if ((big >= 2 && ak >= 0.5 * Ac) || (hollow && ak >= 0.3 * Ac)) { for (const q of endKids) if (q.share < (hollow ? 0.05 : 0.12)) q.dropped = true; split = true; cutAt = L - 1; break; } for (const q of endKids) q.dropped = true; }
        const px = cur.cx + vx, py = cur.cy + vy, Rp = cur.R, ms = measure(k, px, py, Rp, inB, 1, Tb), rat = []; for (let t = 0; t < NRAY; t++) if (ms.kind[t] === 1) rat.push(ms.r[t] / Rp[t]); rat.sort((x, y) => x - y);
        const s = edges(blank(k, px, py), ms, Rp, rat.length ? Math.max(0.85, Math.min(1.02, rat[rat.length >> 1])) : 1); st[a] = s; let dk = 0; for (let t = 0; t < NRAY; t++) if (ms.kind[t] === 2) dk++;
        // (the curve may move in or out only so far in a slice — but, where the edge showed in the slice before as well, out as far
        //  as the edge, and never more than half a voxel inside it: left to its smoothness alone the curve would wear the ends off
        //  a long root, slice by slice. An edge that shows where none did before — none that the curve lay on — may be bone come
        //  up against the root; and no edge takes the curve out past where the root has lately been: a root does not widen so)
        const R = pooled(a, a - win, a) || Float32Array.from(Rp); for (let t = 0; t < NRAY; t++) { const e = ms.kind[t] === 1 && (was[t] || was[(t + 1) % NRAY] || was[(t + NRAY - 1) % NRAY]) ? ms.r[t] : -1, hi = Math.max(Rp[t] + outB, Math.min(e + 0.25, env[t] + outB)), lo = Math.min(hi, Math.max(0.5, Rp[t] - inB - 0.5, e - 0.5)); R[t] = Math.max(lo, Math.min(hi, R[t])); env[t] = Math.max(R[t], env[t] - 0.15); }
        s.held = Uint8Array.from(ms.kind, (x, t) => x === 1 && (was[t] || was[(t + 1) % NRAY] || was[(t + NRAY - 1) % NRAY]) ? 1 : 0); was = Uint8Array.from(ms.kind, (x, t) => x === 1 && Math.abs(ms.r[t] - R[t]) <= 0.75 ? 1 : 0); const A = polyArea(R); areas[a] = A; Object.assign(s, { R, inside: ms.inside, Tb, open: ms.open, opp: ms.opp });
        // (the curve itself come to hold two roots — pinched to a deep waist, with no tooth across the waist, two slices running:
        //  from here on two lines, one round each. So too where the pieces were not followed as parting, or not followed at all)
        { let t1 = 0; for (let t = 1; t < NRAY; t++) if (R[t] < R[t1]) t1 = t; let t2 = -1; for (let t = 0; t < NRAY; t++) { const d = Math.min((t - t1 + NRAY) % NRAY, (t1 - t + NRAY) % NRAY); if (d >= NRAY / 4 && (t2 < 0 || R[t] < R[t2])) t2 = t; }
          const ta = Math.min(t1, t2), tb = Math.max(t1, t2); let mA = 0, mB = 0; for (let t = 0; t < NRAY; t++) { if (t > ta && t < tb) mA = Math.max(mA, R[t]); else if (t !== ta && t !== tb) mB = Math.max(mB, R[t]); } let two = null;
          if (Math.max(R[t1], R[t2]) < 0.45 * Math.min(mA, mB) && Math.min(mA, mB) >= mm(1)) { const x1 = px + R[ta] * RCOS[ta], y1 = py + R[ta] * RSIN[ta], x2 = px + R[tb] * RCOS[tb], y2 = py + R[tb] * RSIN[tb]; let dark = 0, nn = 0; for (let f = 0.15; f <= 0.851; f += 0.1) { const v = samp(k, x1 + f * (x2 - x1), y1 + f * (y2 - y1)); if (v === v) { nn++; if (v < Tb) dark++; } } if (nn && dark >= 0.6 * nn) two = { ta, tb, x1, y1, x2, y2 }; }
          waisted = two ? waisted + 1 : 0;
          if (two && waisted >= 2 && a > a0) { const c = { cx: px, cy: py, R }, side = (x, y) => (two.x2 - two.x1) * (y - two.y1) - (two.y2 - two.y1) * (x - two.x1), made = [];
            for (const sec of [(t) => t > two.ta && t < two.tb, (t) => t < two.ta || t > two.tb]) { let sx = 0, sy = 0, cn = 0; for (let t = 0; t < NRAY; t++) if (sec(t)) { sx += px + 0.6 * R[t] * RCOS[t]; sy += py + 0.6 * R[t] * RSIN[t]; cn++; } if (!cn) continue; const mx = sx / cn, my = sy / cn, sg0 = Math.sign(side(mx, my)), inLobe = (x, y) => inCurve(c, x, y, 0) && sg0 * side(x, y) >= 0; if (!sg0 || !inLobe(mx, my)) continue;
              const Rl = new Float32Array(NRAY); for (let t = 0; t < NRAY; t++) { let lo = 0, hi = 0.5; while (hi < 400 && inLobe(mx + hi * RCOS[t], my + hi * RSIN[t])) { lo = hi; hi += 0.5; } for (let i = 0; i < 5; i++) { const m = (lo + hi) / 2; if (inLobe(mx + m * RCOS[t], my + m * RSIN[t])) lo = m; else hi = m; } Rl[t] = Math.max(0.5, lo); } if (polyArea(Rl) >= mm(1.2) * mm(1.2)) made.push({ cx: mx, cy: my, R: Rl }); }
            if (made.length === 2) { lobes = made; split = true; cutAt = a - 1; st.length = a; if (P.debug) P.debug({ what: 'two', k, a }); break; } } }
        const stall = a - nmm >= a0 && A < 0.3 * A0c && A > 0.95 * areas[a - nmm]; if (stall) lastOk = Math.min(lastOk, a - nmm);
        const plate = ms.opp >= NRAY / 9 && (A < 0.7 * A0c || !fromLevel), dim = !(ms.inside >= Tb || (ms.inside >= T && s.sup + dk >= 0.8 * NRAY)); if (a === lastOk + 1) thin = dim && !plate && !stall;   // (how it first gave out)
        if (!stall && s.sup >= 0.2 * NRAY && !dim && !plate && A >= mm(0.6) * mm(0.6)) { lastOk = a; hist.push(ms.inside); if (hist.length > nmm) hist.shift(); Dref = hist.slice().sort((x, y) => x - y)[hist.length >> 1]; Tb = T + 0.5 * Math.max(0, Dref - T); } else if ((a - lastOk) * hz > 0.75) break;
        if (P.debug) { let res = 0, nr = 0, big = 0; for (let t = 0; t < NRAY; t++) if (ms.kind[t] === 1) { const d = Math.abs(ms.r[t] - R[t]); res += d * d; nr++; if (d > 1.5) big++; } P.debug({ what: 'step', k, a, A: A * h * h, sup: s.sup, rms: Math.sqrt(res / Math.max(1, nr)), big, open: ms.open, shr: ms.kind.filter((x) => x === 2).length, inside: ms.inside, Tb }); }
        const c = { cx: px, cy: py, R }, [mx, my] = middle(c), nc = about(c, mx, my) || c; vx = 0.5 * vx + 0.5 * (nc.cx - cur.cx); vy = 0.5 * vy + 0.5 * (nc.cy - cur.cy); cur = nc; }
      // (a piece of some length on which no curve would hold at all is left as it was drawn)
      if (lastOk < a0 && !split) { if (L - a0 >= 1.5 * nmm && fromLevel) asDrawn(); else kill(a0); return; }   // (… unless it parted from a root already redrawn: then it is no root)
      const end = split ? cutAt : Math.min(st.length - 1, lastOk + Math.round(0.25 / hz));
      // (and one that was drawn going on for 2 mm and more past where the curve gave out — still half the size it began at, the
      //  curve by then holding less than half of it — the curve has not followed: it too is left as drawn)
      if (!split && fromLevel && end < L - 1 - 2 * nmm && areas[end] < 0.5 * ch[end].n && ch[end].n >= 0.5 * ch[a0].n) { asDrawn(); return; }
      // (a tip the curve gave out on — too thin by then to show as bright as tooth — but along which something small was drawn
      //  on for a little: the tip is carried on along that, tapering)
      let tail = end; if (!split && thin && end < L - 1 && (L - 1 - end) * hz <= 2.2 && areas[end] <= mm(2) * mm(2)) { let fine = true; for (let a = end + 1; fine && a < L; a++) if (ch[a].n > Math.max(2 * areas[end], 1.5 * mm(2) * mm(2))) fine = false; if (fine) tail = L - 1; }
      // the curves themselves: each slice's edge looked for once more, now near the curve that the slices above and below it
      // agree on, and the curve fitted again
      const again = []; for (let a = a0; a <= end; a++) { const s = st[a], Rc = pooled(a, a - win, Math.min(end, a + win)) || s.R, ms = measure(s.k, s.cx, s.cy, Rc, 1, 0.5, s.Tb); again[a] = Object.assign(edges(blank(s.k, s.cx, s.cy), ms, Rc, 1), { R: s.R, sup: s.sup, inside: s.inside, open: s.open, opp: s.opp, ms, held: s.held }); }
      for (let a = a0; a <= end; a++) st[a] = again[a];
      for (let a = a0; a <= end; a++) { const s = st[a], R = pooled(a, a - win, Math.min(end, a + win)) || s.R; for (let t = 0; t < NRAY; t++) R[t] = Math.max(Math.min(R[t], s.R[t] + 0.75), s.ms.kind[t] === 1 && s.held[t] ? Math.min(s.ms.r[t] - 0.5, s.R[t] + 0.75) : 0.5); const f = { k: s.k, sx: s.cx, sy: s.cy, fit: R, sup: s.sup, inside: s.inside, open: s.open, opp: s.opp }; fits.push(f); if (a < L) Object.assign(ch[a], f); }
      for (let a = end + 1; a <= tail; a++) { const g = ch[a], sc = Math.min(1, Math.sqrt(areas[end] * (1 - 0.7 * (a - end) / (tail - end + 1)) / Math.max(1e-6, polyArea(g.r)))), f = { k: g.k, sx: g.cx, sy: g.cy, fit: Float32Array.from(g.r, (r, t) => Math.max(0.5, sc * (g.r[(t + NRAY - 1) % NRAY] + 2 * r + g.r[(t + 1) % NRAY]) / 4)), raw: true }; fits.push(f); Object.assign(g, f); }
      kill(tail + 1); ch.end = end; if (lobes) for (const c of lobes) follow([], { k: kAt(end + 1), dir, cur: c });
    };
    for (const ch of chains) follow(ch);
    if (P.debug) P.debug({ what: 'chains', level, chains: chains.map((ch) => ({ dir: ch[0].dir, k0: ch[0].k, a0: ch.a0, end: ch.end, raw: !!ch.raw, recs: ch.map((g) => ({ k: g.k, cx: g.cx, cy: g.cy, n: g.n, strong: g.strong, inBone: g.inBone, sup: g.sup, inside: g.inside, fit: !!g.fit, dead: !!g.dead, r: Array.from(g.r) })) })), fits: fits.map((f) => ({ k: f.k, sx: f.sx, sy: f.sy, sup: f.sup, inside: f.inside, open: f.open, opp: f.opp, area: polyArea(f.fit) * h * h, R: Array.from(f.fit) })) });
    // below the level the tooth is what those curves hold, and nothing else
    for (const dir of [1, -1]) if (level[dir] < Infinity) for (let k = kEq + dir * level[dir]; k >= 0 && k < n2; k += dir) mask.fill(0, k * sl, (k + 1) * sl);
    for (const g of fits) { const base = g.k * sl, R = Math.ceil(Math.max(...g.fit)) + 1, ic = Math.round(g.sx), jc = Math.round(g.sy);
      if (g.vox) { S1.fill(0); for (const p of g.vox) S1[p] = 1; for (const p of g.vox) for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const i = p % n0 + a, j = ((p / n0) | 0) + b; if (i < 1 || j < 1 || i >= n0 - 1 || j >= n1 - 1) continue; const q = i + n0 * j; if (mask[base + q] || allow[base + q] !== 1) continue; let c = 0; for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) c += S1[q + u + n0 * v]; if (c >= 5) mask[base + q] = 1; } continue; }
      for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) { const ii = ic + a, jj = jc + b; if (ii < 0 || jj < 0 || ii >= n0 || jj >= n1) continue; const dx = ii - g.sx, dy = jj - g.sy, p = ii + n0 * jj; if (allow[base + p] === 1 && Math.hypot(dx, dy) <= radiusAt(g.fit, dx, dy)) mask[base + p] = 1; } }
  }
  // further points that are tooth (a root the outline lost): a small start round each, followed both ways and added
  for (const q of P.more || []) {
    if (q[2] < 0 || q[2] >= n2 || mask[q[0] + n0 * q[1] + sl * q[2]]) continue; const base = q[2] * sl, R = Math.ceil(mm(1.25)), s2 = new Uint8Array(sl), ref = I[base + q[0] + n0 * q[1]];
    for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) { const ii = q[0] + a, jj = q[1] + b; if (ii < 0 || jj < 0 || ii >= n0 || jj >= n1 || a * a + b * b > R * R) continue; const p = ii + n0 * jj; if (allow[base + p] === 1 && I[base + p] >= Math.max(T, Math.min(ref, D0) - 0.2 * C)) s2[p] = 1; }
    if (s2[q[0] + n0 * q[1]]) run(s2, q[2], [1, -1]);
  }
  return { mask, kEq, cEq: [eq.cx, eq.cy], D0, E0, Dcap, C, dark, soft, occ };
}
const N_clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/**
 * cavities(mask, inRegion, nx, ny, nz) → Uint8Array: the dark spaces shut inside the mask — not reachable from the edge of the box
 * (or from outside the region) without crossing it. Also those reached only through a passage one voxel narrow, such as a root
 * canal opening at the apex: the dark space is first thinned by a voxel, so such passages close; what is shut in is then grown
 * back by the voxel it lost.
 */
function cavities(mask, inR, nx, ny, nz) {
  const n = nx * ny * nz, nb = N6(nx, ny), atEdge = (q) => { const i = q % nx, j = ((q / nx) | 0) % ny, k = (q / (nx * ny)) | 0; return i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1; };
  const dark = (q) => !mask[q], open = new Uint8Array(n), core = new Uint8Array(n);
  for (let q = 0; q < n; q++) { if (!dark(q)) continue; if (atEdge(q) || (inR && !inR[q])) { core[q] = 1; continue; } let all = 1; for (const s of nb) if (!dark(q + s)) { all = 0; break; } core[q] = all; }
  const flood = (start, ok) => { const st = []; for (let q = 0; q < n; q++) if (start(q)) { open[q] = 1; st.push(q); } while (st.length) { const q = st.pop(); const i = q % nx, j = ((q / nx) | 0) % ny, k = (q / (nx * ny)) | 0; for (let t = 0; t < 6; t++) { if ((t === 0 && i === nx - 1) || (t === 1 && i === 0) || (t === 2 && j === ny - 1) || (t === 3 && j === 0) || (t === 4 && k === nz - 1) || (t === 5 && k === 0)) continue; const u = q + nb[t]; if (!open[u] && ok(u)) { open[u] = 1; st.push(u); } } } };
  flood((q) => core[q] && (atEdge(q) || (inR && !inR[q])), (u) => core[u]);   // the thinned dark space that reaches the outside
  const cav = new Uint8Array(n);
  for (let q = 0; q < n; q++) if (core[q] && !open[q]) { cav[q] = 1; const i = q % nx, j = ((q / nx) | 0) % ny, k = (q / (nx * ny)) | 0; for (let t = 0; t < 6; t++) { if ((t === 0 && i === nx - 1) || (t === 1 && i === 0) || (t === 2 && j === ny - 1) || (t === 3 && j === 0) || (t === 4 && k === nz - 1) || (t === 5 && k === 0)) continue; const u = q + nb[t]; if (dark(u)) cav[u] = 1; } }
  // and the plain holes (dark voxels that cannot reach the edge at all, however narrow)
  open.fill(0); flood((q) => dark(q) && (atEdge(q) || (inR && !inR[q])), (u) => dark(u));
  for (let q = 0; q < n; q++) if (dark(q) && !open[q]) cav[q] = 1;
  return cav;
}
/**
 * segmentTooth(vol, o) — one tooth, crown and roots, cut out from the bone and its neighbours.
 *   o.seeds  [[x,y,z]…] points on the tooth: the first on its crown; any more are parts the outline lost (a root)
 *   o.not    [[x,y,z]…] points that are not the tooth: what hangs on the tooth there is cut off at its narrowest, darkest neck
 *   o.erase  [{ p:[x,y,z], r }…] balls cut away      o.roi   { shape:'cyl'|'box', c:[x,y], r, z0, z1 } (mm): the tooth lies inside
 *   o.T      the level between soft tissue and tooth (data units)        o.fill  fill the pulp (default true)
 *   o.method 'flood': the earlier way (floodTooth), which shares the bright material out between the tooth and the region's edge
 *   o.smoothRoots  false: leave the roots as they were followed, voxel by voxel (default: roots standing in bone are redrawn)
 * The outline is found in the widest slice of the crown and followed slice by slice (trackTooth); from the level where the
 * tooth first stands in bone each root is then redrawn, slice by slice, as a smooth closed curve fitted to its own edge. Holes
 * left inside (the pulp) are filled. Slices are the scan's own: a tooth lying more than about 45° from the scan's long axis
 * is not followed well.
 * → { lab: Uint8Array over box (1 = tooth), box:{ i0, j0, k0, nx, ny, nz }, count, volume (mm³), lo, hi (mm), touch (voxels
 *     of it against the edge of the region), T, dI, ref, seedOk, axis, centre, crown:+1|−1 (which way along axis the crown
 *     is), length, ends, top (the middle of the crown's widest slice), levels:{ dentine, enamel, contrast } }  or { error }
 */
export function segmentTooth(vol, o) {
  if (o.method === 'flood') return floodTooth(vol, o);
  const [NX, NY, NZ] = vol.dims, [sx, sy, sz] = vol.spacing, org = vol.origin, d = vol.data, roi = o.roi, T = o.T;
  const rr = roi.r, bi = (x, a) => Math.floor((x - org[a]) / vol.spacing[a]), pad = 1;
  const i0 = Math.max(0, bi(roi.c[0] - rr - pad, 0)), i1 = Math.min(NX - 1, bi(roi.c[0] + rr + pad, 0) + 1), j0 = Math.max(0, bi(roi.c[1] - rr - pad, 1)), j1 = Math.min(NY - 1, bi(roi.c[1] + rr + pad, 1) + 1);
  const k0 = Math.max(0, bi(Math.min(roi.z0, roi.z1) - pad, 2)), k1 = Math.min(NZ - 1, bi(Math.max(roi.z0, roi.z1) + pad, 2) + 1);
  const nx = i1 - i0 + 1, ny = j1 - j0 + 1, nz = k1 - k0 + 1, n = nx * ny * nz;
  if (nx < 3 || ny < 3 || nz < 3) return { error: 'The region is outside the scan.' };
  // a scan with very fine voxels: the tooth is found on a copy of that part of the scan with voxels f times larger (averaged, up
  // to about 0.25 mm), so it stays quick; the result (and the replica made from it) then refers to that copy, seg.vol
  const maxV = o.maxVoxels ?? 5e6, fb = Math.min(Math.ceil(Math.cbrt(n / maxV)), Math.max(1, Math.floor(0.26 / Math.min(sx, sy, sz))));
  if (n > maxV && fb > 1) { const sub = cropVolume(vol, [i0, j0, k0], [i1, j1, k1], fb); return segmentTooth(sub, { ...o, maxVoxels: Infinity }); }
  const box = { i0, j0, k0, nx, ny, nz }, I = new Int16Array(n), allow = new Uint8Array(n), zl = Math.min(roi.z0, roi.z1), zh = Math.max(roi.z0, roi.z1);
  for (let k = 0; k < nz; k++) { const z = org[2] + (k0 + k) * sz; for (let j = 0; j < ny; j++) { const y = org[1] + (j0 + j) * sy; for (let i = 0; i < nx; i++) {
    const x = org[0] + (i0 + i) * sx, q = i + nx * (j + ny * k); I[q] = d[(i0 + i) + NX * ((j0 + j) + NY * (k0 + k))];
    allow[q] = z >= zl && z <= zh && (roi.shape === 'box' ? Math.abs(x - roi.c[0]) <= rr && Math.abs(y - roi.c[1]) <= rr : (x - roi.c[0]) ** 2 + (y - roi.c[1]) ** 2 <= rr * rr) ? 1 : 2;
  } } }
  for (const e of o.erase || []) {                                // balls cut away
    const r = e.r, a0 = Math.max(0, bi(e.p[0] - r, 0) - i0), a1 = Math.min(nx - 1, bi(e.p[0] + r, 0) + 1 - i0), b0 = Math.max(0, bi(e.p[1] - r, 1) - j0), b1 = Math.min(ny - 1, bi(e.p[1] + r, 1) + 1 - j0), c0 = Math.max(0, bi(e.p[2] - r, 2) - k0), c1 = Math.min(nz - 1, bi(e.p[2] + r, 2) + 1 - k0);
    for (let k = c0; k <= c1; k++) for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) { const x = org[0] + (i0 + i) * sx - e.p[0], y = org[1] + (j0 + j) * sy - e.p[1], z = org[2] + (k0 + k) * sz - e.p[2]; if (x * x + y * y + z * z <= r * r) allow[i + nx * (j + ny * k)] = 0; }
  }
  const vq = (p) => [Math.max(0, Math.min(nx - 1, Math.round((p[0] - org[0]) / sx) - i0)), Math.max(0, Math.min(ny - 1, Math.round((p[1] - org[1]) / sy) - j0)), Math.max(0, Math.min(nz - 1, Math.round((p[2] - org[2]) / sz) - k0))];
  const seeds = (o.seeds || []).map(vq); if (!seeds.length) return { error: 'Tap the tooth.', box };
  const tr = trackTooth({ I, n0: nx, n1: ny, n2: nz, h: (sx + sy) / 2, hz: sz, allow }, seeds[0], { T, more: seeds.slice(1), debug: o.debug, soft: o.soft ?? windowPresets(vol).soft.l, smoothRoots: o.smoothRoots }); if (tr.error) return { error: tr.error, box };
  let lab = tr.mask;
  if (o.not && o.not.length) { const f = floodTooth(vol, { ...o, pad, within: lab, noBorder: true, fill: false, maxVoxels: Infinity }); if (!f.error) lab = f.lab; }
  // the piece the first point is on (or the largest, if the point fell in the pulp), then the pulp filled
  { const id = new Int32Array(n), st = [], sizes = [0]; let want = 0;
    for (let q0 = 0; q0 < n; q0++) { if (!lab[q0] || id[q0]) continue; const L = sizes.length; let c = 0; id[q0] = L; st.push(q0);
      while (st.length) { const q = st.pop(), i = q % nx, j = ((q / nx) | 0) % ny, k = (q / (nx * ny)) | 0; c++; for (let cc = -1; cc <= 1; cc++) { const kk = k + cc; if (kk < 0 || kk >= nz) continue; for (let b = -1; b <= 1; b++) { const jj = j + b; if (jj < 0 || jj >= ny) continue; for (let a = -1; a <= 1; a++) { const ii = i + a; if (ii < 0 || ii >= nx) continue; const u = ii + nx * (jj + ny * kk); if (lab[u] && !id[u]) { id[u] = L; st.push(u); } } } } }
      sizes.push(c); }
    const sq = seeds[0][0] + nx * (seeds[0][1] + ny * seeds[0][2]); want = id[sq]; if (!want) for (let L = 1; L < sizes.length; L++) if (!want || sizes[L] > sizes[want]) want = L;
    for (let q = 0; q < n; q++) if (lab[q] && id[q] !== want) lab[q] = 0; }
  if (o.fill !== false) { const cav = cavities(lab, null, nx, ny, nz); for (let q = 0; q < n; q++) if (cav[q]) lab[q] = 1;
    // … and what the tooth rings in a slice with tooth above it, towards the biting surface: a canal that is open at the root's
    // end, where the outline stopped short of the tip, is pulp all the same (the dip between the cusps, open above, is not)
    if (tr.occ) { const sl2 = nx * ny, A = new Uint8Array(sl2), B = new Uint8Array(sl2), topK = new Int32Array(sl2).fill(-1);
      for (let k = 0; k < nz; k++) for (let r = 0; r < sl2; r++) if (lab[k * sl2 + r] && (topK[r] < 0 || tr.occ > 0)) topK[r] = k;   // (each column's own voxel of the tooth nearest the biting surface)
      for (let k = 0; k < nz; k++) { let any = false; for (let r = 0; r < sl2; r++) { A[r] = lab[k * sl2 + r]; if (A[r]) any = true; } if (!any) continue; solid2(A, nx, ny, B);
        for (let r = 0; r < sl2; r++) if (B[r] && !A[r] && allow[k * sl2 + r] === 1 && topK[r] >= 0 && (tr.occ > 0 ? topK[r] > k : topK[r] < k)) lab[k * sl2 + r] = 1; } } }
  // size, extent, how much of it presses on the edge of the region, and its long axis
  let count = 0, touch = 0, near = 0; const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], m1 = [0, 0, 0], m2 = [0, 0, 0, 0, 0, 0], nearD = Math.max(1, Math.round(1.5 / sx));
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const q = i + nx * (j + ny * k); if (!lab[q]) continue; count++;
    const x = org[0] + (i0 + i) * sx, y = org[1] + (j0 + j) * sy, z = org[2] + (k0 + k) * sz; lo[0] = Math.min(lo[0], x); lo[1] = Math.min(lo[1], y); lo[2] = Math.min(lo[2], z); hi[0] = Math.max(hi[0], x); hi[1] = Math.max(hi[1], y); hi[2] = Math.max(hi[2], z);
    m1[0] += x; m1[1] += y; m1[2] += z; m2[0] += x * x; m2[1] += y * y; m2[2] += z * z; m2[3] += x * y; m2[4] += x * z; m2[5] += y * z;
    for (let t = 0; t < 6; t++) { const ii = i + (t === 0) - (t === 1), jj = j + (t === 2) - (t === 3), kk = k + (t === 4) - (t === 5); if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz || (allow[ii + nx * (jj + ny * kk)] === 2 && I[ii + nx * (jj + ny * kk)] >= T)) { touch++; break; } }
    // (and how much of it comes within 1½ mm of the region's side: the outline cannot be followed where what lies beside it is out of the region)
    for (let t = 0; t < 4; t++) { const ii = i + (t === 0 ? nearD : t === 1 ? -nearD : 0), jj = j + (t === 2 ? nearD : t === 3 ? -nearD : 0); if (ii < 0 || jj < 0 || ii >= nx || jj >= ny || allow[ii + nx * (jj + ny * k)] === 2) { near++; break; } }
  }
  if (!count) return { error: 'Nothing was found.', box };
  const c = m1.map((v) => v / count), Cv = [[m2[0] / count - c[0] * c[0], m2[3] / count - c[0] * c[1], m2[4] / count - c[0] * c[2]], [0, m2[1] / count - c[1] * c[1], m2[5] / count - c[1] * c[2]], [0, 0, m2[2] / count - c[2] * c[2]]]; Cv[1][0] = Cv[0][1]; Cv[2][0] = Cv[0][2]; Cv[2][1] = Cv[1][2];
  let ax = [0, 0, 1]; for (let it = 0; it < 60; it++) { const v = [0, 1, 2].map((r) => Cv[r][0] * ax[0] + Cv[r][1] * ax[1] + Cv[r][2] * ax[2]), l = Math.hypot(...v) || 1; ax = v.map((x) => x / l); }
  if (ax[2] < 0) ax = ax.map((x) => -x);
  // the crown is the end with the brighter material (enamel)
  let tmin = Infinity, tmax = -Infinity; const tq = [];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const q = i + nx * (j + ny * k); if (!lab[q]) continue; const t = (org[0] + (i0 + i) * sx - c[0]) * ax[0] + (org[1] + (j0 + j) * sy - c[1]) * ax[1] + (org[2] + (k0 + k) * sz - c[2]) * ax[2]; tq.push(t, I[q]); if (t < tmin) tmin = t; if (t > tmax) tmax = t; }
  // a tooth that lies across the slices (an impacted tooth on its side: what was followed has its long axis more than 35° from
  // the slices' own) cannot be followed from slice to slice: it is outlined by flooding from the taps instead, as bright
  // tissue ringed by something darker — if that finds plainly more of it, and no more of it pressing on the region's edge
  if (o.method !== 'track' && Math.abs(ax[2]) < 0.82 && tmax - tmin > 9 && tmax - tmin > 1.15 * (hi[2] - lo[2])) { const fl = floodTooth(vol, o); if (!fl.error && fl.volume > 1.2 * count * sx * sy * sz && fl.touch <= touch + 20) {
      // (… unless what the flood finds stands upright: then the tooth is not lying — the outline went wrong from where it was
      //  started, as from a tap by the biting surface where the tooth it bites on is met. It is followed once more from the
      //  bright point nearest the middle of the crown the flood found, and that is kept if it holds a tooth standing up)
      if (!o.again && fl.axis && Math.abs(fl.axis[2]) >= 0.9 && fl.top) { const q = voxelOf(vol, fl.top[0], fl.top[1], fl.top[2]).map(Math.round), [nx, ny, nz] = vol.dims, R = Math.ceil(3 / sx); let bd = Infinity, sd = null;
        if (q[2] >= 0 && q[2] < nz) for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) { const i = q[0] + a, j = q[1] + b, d = a * a + b * b; if (i < 0 || j < 0 || i >= nx || j >= ny || d >= bd || vol.data[i + nx * (j + ny * q[2])] < o.T + 0.25 * Math.abs(o.T)) continue; bd = d; sd = [vol.origin[0] + i * sx, vol.origin[1] + j * sy, vol.origin[2] + q[2] * sz]; }
        if (sd) { const sg2 = segmentTooth(vol, { ...o, seeds: [sd, ...seeds.slice(1)], again: true }); if (!sg2.error && !sg2.lying && Math.abs(sg2.axis[2]) >= 0.82 && sg2.volume >= 0.5 * fl.volume && sg2.touch <= fl.touch + 20) { sg2.restarted = true; return sg2; } } }
      fl.lying = true; return fl; } }
  let up = 0, nu = 0, dn = 0, nd = 0; const qt = (tmax - tmin) / 4; for (let a = 0; a < tq.length; a += 2) { if (tq[a] > tmax - qt) { up += tq[a + 1]; nu++; } else if (tq[a] < tmin + qt) { dn += tq[a + 1]; nd++; } }
  const crown = (nu ? up / nu : 0) >= (nd ? dn / nd : 0) ? 1 : -1, ref = tr.E0 != null ? (tr.D0 + tr.E0) / 2 : tr.D0, dI = Math.max(50, ref - T);
  const top = [org[0] + (i0 + tr.cEq[0]) * sx, org[1] + (j0 + tr.cEq[1]) * sy, org[2] + (k0 + tr.kEq) * sz];
  return { lab, box, count, volume: count * sx * sy * sz, lo, hi, touch, near, T, dI, ref, seedOk: true, axis: ax, centre: c, crown, length: tmax - tmin, ends: [tmin, tmax], top, vol, levels: { dentine: tr.D0, enamel: tr.E0, contrast: tr.C, soft: tr.soft } };
}
/**
 * floodTooth(vol, o) — the earlier tooth finder (o as for segmentTooth), kept for cutting off what hangs on a tooth at a "not
 * tooth" point (o.within: only these voxels of the box may be tooth; o.noBorder: the region's edge is not a marker; o.pad).
 * Every voxel inside the region, at or above the threshold and not cut away, may be tooth. They are shared out by flooding from
 * markers — the tooth seeds on one side; the edge of the region and the "not tooth" points on the other — taking first the
 * voxels that lie deepest inside the bright material (distance to the nearest dark voxel) and are brightest. The two floods
 * therefore meet where the bright material is thinnest and darkest. Holes left inside (the pulp) are filled.
 */
function floodTooth(vol, o) {
  const [NX, NY, NZ] = vol.dims, [sx, sy, sz] = vol.spacing, org = vol.origin, d = vol.data, roi = o.roi, T = o.T;
  const rr = roi.r, bi = (x, a) => Math.floor((x - org[a]) / vol.spacing[a]), pad = o.pad ?? 6;   // the box reaches well past the region (more than half a molar), so a neighbour cut by the region still has its own thick middle
  const i0 = Math.max(0, bi(roi.c[0] - rr - pad, 0)), i1 = Math.min(NX - 1, bi(roi.c[0] + rr + pad, 0) + 1), j0 = Math.max(0, bi(roi.c[1] - rr - pad, 1)), j1 = Math.min(NY - 1, bi(roi.c[1] + rr + pad, 1) + 1);
  const k0 = Math.max(0, bi(Math.min(roi.z0, roi.z1) - pad, 2)), k1 = Math.min(NZ - 1, bi(Math.max(roi.z0, roi.z1) + pad, 2) + 1);
  const nx = i1 - i0 + 1, ny = j1 - j0 + 1, nz = k1 - k0 + 1, n = nx * ny * nz;
  if (nx < 3 || ny < 3 || nz < 3) return { error: 'The region is outside the scan.' };
  // a scan with very fine voxels: the region is worked out on a copy of that part of the scan with voxels f times larger
  // (averaged, up to about 0.25 mm), so it stays quick; the result (and the replica made from it) then refers to that copy, seg.vol
  const maxV = o.maxVoxels ?? 5e6;
  const fb = Math.min(Math.ceil(Math.cbrt(n / maxV)), Math.max(1, Math.floor(0.26 / Math.min(sx, sy, sz))));   // (never coarser than about 0.25 mm: the ligament space must still show)
  if (n > maxV && fb > 1) { const sub = cropVolume(vol, [i0, j0, k0], [i1, j1, k1], fb); return floodTooth(sub, { ...o, maxVoxels: Infinity }); }
  const box = { i0, j0, k0, nx, ny, nz }, I = new Int16Array(n), inR = new Uint8Array(n), M = new Uint8Array(n), B = new Uint8Array(n), zl = Math.min(roi.z0, roi.z1), zh = Math.max(roi.z0, roi.z1);   // B: bright (all the box) · M: bright and in the region (may be tooth)
  for (let k = 0; k < nz; k++) { const z = org[2] + (k0 + k) * sz; for (let j = 0; j < ny; j++) { const y = org[1] + (j0 + j) * sy; for (let i = 0; i < nx; i++) {
    const x = org[0] + (i0 + i) * sx, q = i + nx * (j + ny * k), v = d[(i0 + i) + NX * ((j0 + j) + NY * (k0 + k))]; I[q] = v;
    const inside = z >= zl && z <= zh && (roi.shape === 'box' ? Math.abs(x - roi.c[0]) <= rr && Math.abs(y - roi.c[1]) <= rr : (x - roi.c[0]) ** 2 + (y - roi.c[1]) ** 2 <= rr * rr);
    inR[q] = inside ? 1 : 0; B[q] = v >= T ? 1 : 0; M[q] = inside && B[q] && (!o.within || o.within[q]) ? 1 : 0;
  } } }
  for (const e of o.erase || []) {                                // balls cut away
    const r = e.r, a0 = Math.max(0, bi(e.p[0] - r, 0) - i0), a1 = Math.min(nx - 1, bi(e.p[0] + r, 0) + 1 - i0), b0 = Math.max(0, bi(e.p[1] - r, 1) - j0), b1 = Math.min(ny - 1, bi(e.p[1] + r, 1) + 1 - j0), c0 = Math.max(0, bi(e.p[2] - r, 2) - k0), c1 = Math.min(nz - 1, bi(e.p[2] + r, 2) + 1 - k0);
    for (let k = c0; k <= c1; k++) for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) { const x = org[0] + (i0 + i) * sx - e.p[0], y = org[1] + (j0 + j) * sy - e.p[1], z = org[2] + (k0 + k) * sz - e.p[2]; if (x * x + y * y + z * z <= r * r) { M[i + nx * (j + ny * k)] = 0; B[i + nx * (j + ny * k)] = 0; } }
  }
  // depth inside the bright material: distance (mm) to the nearest dark voxel (two passes over the 26 neighbours). Dark cavities
  // shut inside the bright material — the pulp chamber and canals — count as solid here (see cavities), so the depth peaks in the
  // middle of each tooth and dips at a contact with the next tooth, where the two crowns meet in a narrower waist.
  const solid = cavities(B, null, nx, ny, nz); for (let q = 0; q < n; q++) if (B[q]) solid[q] = 1;
  const D = new Float32Array(n), off = [], wt = [];
  for (let c = -1; c <= 1; c++) for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { if (c < 0 || (c === 0 && b < 0) || (c === 0 && b === 0 && a < 0)) { off.push([a, b, c]); wt.push(Math.hypot(a * sx, b * sy, c * sz)); } }
  for (let q = 0; q < n; q++) D[q] = solid[q] ? 1e9 : 0;
  for (const dir of [1, -1]) {
    const ks = dir > 0 ? 0 : nz - 1, ke = dir > 0 ? nz : -1;
    for (let k = ks; k !== ke; k += dir) for (let j = dir > 0 ? 0 : ny - 1; j !== (dir > 0 ? ny : -1); j += dir) for (let i = dir > 0 ? 0 : nx - 1; i !== (dir > 0 ? nx : -1); i += dir) {
      const q = i + nx * (j + ny * k); if (!solid[q]) continue; let best = D[q];
      for (let t = 0; t < off.length; t++) { const a = i + dir * off[t][0], b = j + dir * off[t][1], c = k + dir * off[t][2]; const v = a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz ? wt[t] : D[a + nx * (b + ny * c)] + wt[t]; if (v < best) best = v; }
      D[q] = best;
    }
  }
  const hbar = (sx + sy + sz) / 3, vq = (x, y, z) => { const i = Math.round((x - org[0]) / sx) - i0, j = Math.round((y - org[1]) / sy) - j0, k = Math.round((z - org[2]) / sz) - k0; return i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz ? [i, j, k] : null; };
  /** the voxel of M near a point (within 1.5 mm) that lies deepest inside the bright material */
  const snap = (p) => {
    const c = vq(p[0], p[1], p[2]); if (!c) return -1; const R = 1.5, ra = Math.ceil(R / sx), rb = Math.ceil(R / sy), rc = Math.ceil(R / sz); let best = -1, bd = 0;
    for (let k = c[2] - rc; k <= c[2] + rc; k++) for (let j = c[1] - rb; j <= c[1] + rb; j++) for (let i = c[0] - ra; i <= c[0] + ra; i++) { if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue; if (((i - c[0]) * sx) ** 2 + ((j - c[1]) * sy) ** 2 + ((k - c[2]) * sz) ** 2 > R * R) continue; const q = i + nx * (j + ny * k); if (M[q] && D[q] > bd) { bd = D[q]; best = q; } }
    return best;
  };
  const seeds = (o.seeds || []).map(snap).filter((q) => q >= 0); if (!seeds.length) return { error: 'No bright tooth material was found where you tapped: tap the middle of the tooth, or lower the threshold.', box };
  // how bright the tooth is: the median of M near the first seed — this scales the brightness part of the flood order
  const sv = []; { const c = [seeds[0] % nx, ((seeds[0] / nx) | 0) % ny, (seeds[0] / (nx * ny)) | 0], R = 2; for (let k = c[2] - Math.ceil(R / sz); k <= c[2] + Math.ceil(R / sz); k++) for (let j = c[1] - Math.ceil(R / sy); j <= c[1] + Math.ceil(R / sy); j++) for (let i = c[0] - Math.ceil(R / sx); i <= c[0] + Math.ceil(R / sx); i++) { if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue; const q = i + nx * (j + ny * k); if (M[q]) sv.push(I[q]); } }
  sv.sort((a, b) => a - b); const ref = sv.length ? sv[sv.length >> 1] : T + 500, dI = Math.max(50, ref - T);
  // the order of the flood: depth (in voxels) + brightness above the threshold (in units of the tooth's own brightness above it)
  const Q = 2048, pf = new Float32Array(n), pr = new Uint16Array(n); for (let q = 0; q < n; q++) if (M[q]) { pf[q] = D[q] / hbar + (I[q] - T) / dI; pr[q] = Math.max(0, Math.min(Q - 1, Math.round(pf[q] * 8))); }
  const lab = new Uint8Array(n), buckets = new Array(Q), push = (q, l) => { (buckets[l] || (buckets[l] = [])).push(q); }, nb = N6(nx, ny);
  const edge = (q) => { const i = q % nx, j = ((q / nx) | 0) % ny, k = (q / (nx * ny)) | 0; if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) return true; for (const s of nb) if (!inR[q + s]) return true; return false; };
  // A marker floods only what lies below it in this order, so each one first climbs to the top of its own hill (the thickest,
  // brightest part of the tooth it is in) and claims the way up. Otherwise a tap beside the pulp would wait while the edge's flood
  // came in through a contact with the next tooth and took the crown.
  const nb26 = []; for (let c = -1; c <= 1; c++) for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if (a || b || c) nb26.push([a, b, c]);
  const climb = (q, L) => {
    for (let step = 0; step < 400; step++) {
      if (lab[q] && lab[q] !== L) return q; if (!lab[q]) { lab[q] = L; push(q, pr[q]); }
      const i = q % nx, j = ((q / nx) | 0) % ny, k = (q / (nx * ny)) | 0; let best = q, bv = pf[q];
      for (const [a, b, c] of nb26) { const ii = i + a, jj = j + b, kk = k + c; if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue; const u = ii + nx * (jj + ny * kk); if (M[u] && pf[u] > bv) { bv = pf[u]; best = u; } }
      if (best === q) return q; q = best;
    }
    return q;
  };
  const border = new Uint8Array(n); for (let q = 0; q < n; q++) if (M[q] && edge(q)) border[q] = 1;
  let topQ = -1; for (const q of seeds) { const e = climb(q, 1); if (topQ < 0) topQ = e; }   // where the first tap's climb ended: the thickest part of the tooth it is on
  for (const p of o.not || []) { const q = snap(p); if (q >= 0) climb(q, 2); }
  if (!o.noBorder) for (let q = 0; q < n; q++) if (border[q] && !lab[q]) climb(q, 2);
  for (let lv = Q - 1; lv >= 0; lv--) {
    const b = buckets[lv]; if (!b) continue;
    for (let h = 0; h < b.length; h++) {
      const q = b[h], L = lab[q], i = q % nx, j = ((q / nx) | 0) % ny, k = (q / (nx * ny)) | 0;
      for (let t = 0; t < 6; t++) {
        if ((t === 0 && i === nx - 1) || (t === 1 && i === 0) || (t === 2 && j === ny - 1) || (t === 3 && j === 0) || (t === 4 && k === nz - 1) || (t === 5 && k === 0)) continue;
        const u = q + nb[t]; if (!M[u] || lab[u]) continue; lab[u] = L; push(u, Math.min(pr[u], lv));
      }
    }
    buckets[lv] = null;
  }
  const dbg = o.debug ? { D, labels: lab.slice(), M, B, solid, border, seeds } : undefined;
  for (let q = 0; q < n; q++) if (lab[q] !== 1) lab[q] = 0;
  if (o.fill !== false) { const cav = cavities(lab, null, nx, ny, nz); for (let q = 0; q < n; q++) if (cav[q]) lab[q] = 1; }   // the pulp, even where its canal opens at the apex
  // size, extent, how much of it presses on the edge of the region, and its long axis
  let count = 0, touch = 0; const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], m1 = [0, 0, 0], m2 = [0, 0, 0, 0, 0, 0];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const q = i + nx * (j + ny * k); if (!lab[q]) continue; count++;
    const x = org[0] + (i0 + i) * sx, y = org[1] + (j0 + j) * sy, z = org[2] + (k0 + k) * sz; lo[0] = Math.min(lo[0], x); lo[1] = Math.min(lo[1], y); lo[2] = Math.min(lo[2], z); hi[0] = Math.max(hi[0], x); hi[1] = Math.max(hi[1], y); hi[2] = Math.max(hi[2], z);
    m1[0] += x; m1[1] += y; m1[2] += z; m2[0] += x * x; m2[1] += y * y; m2[2] += z * z; m2[3] += x * y; m2[4] += x * z; m2[5] += y * z;
    for (let t = 0; t < 6; t++) { const ii = i + (t === 0) - (t === 1), jj = j + (t === 2) - (t === 3), kk = k + (t === 4) - (t === 5); if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) { touch++; break; } if (border[ii + nx * (jj + ny * kk)]) { touch++; break; } }
  }
  if (!count) return { error: 'Nothing was found.', box };
  const c = m1.map((v) => v / count), C = [[m2[0] / count - c[0] * c[0], m2[3] / count - c[0] * c[1], m2[4] / count - c[0] * c[2]], [0, m2[1] / count - c[1] * c[1], m2[5] / count - c[1] * c[2]], [0, 0, m2[2] / count - c[2] * c[2]]]; C[1][0] = C[0][1]; C[2][0] = C[0][2]; C[2][1] = C[1][2];
  let ax = [0, 0, 1]; for (let it = 0; it < 60; it++) { const v = [0, 1, 2].map((r) => C[r][0] * ax[0] + C[r][1] * ax[1] + C[r][2] * ax[2]), l = Math.hypot(...v) || 1; ax = v.map((x) => x / l); }   // largest eigenvector (power iteration)
  if (ax[2] < 0) ax = ax.map((x) => -x);
  // the crown is the end with the brighter material (enamel)
  let tmin = Infinity, tmax = -Infinity; const tq = [];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const q = i + nx * (j + ny * k); if (!lab[q]) continue; const t = (org[0] + (i0 + i) * sx - c[0]) * ax[0] + (org[1] + (j0 + j) * sy - c[1]) * ax[1] + (org[2] + (k0 + k) * sz - c[2]) * ax[2]; tq.push(t, I[q]); if (t < tmin) tmin = t; if (t > tmax) tmax = t; }
  let up = 0, nu = 0, dn = 0, nd = 0; const qt = (tmax - tmin) / 4; for (let a = 0; a < tq.length; a += 2) { if (tq[a] > tmax - qt) { up += tq[a + 1]; nu++; } else if (tq[a] < tmin + qt) { dn += tq[a + 1]; nd++; } }
  const crown = (nu ? up / nu : 0) >= (nd ? dn / nd : 0) ? 1 : -1;
  // the middle of the thickest part of the tooth the first tap is on: from where its climb ended, the bright material at least
  // ¾ as deep, then the same again from the deepest voxel of that (so a tap on a cusp still finds the body of the crown, and the
  // flat top of a broad crown gives its middle and not a chance corner of it)
  let top = null;
  if (topQ >= 0) {
    const plateau = (q0) => { const lim = 0.75 * D[q0], seen = new Set([q0]), st = [q0], out = { n: 0, s: [0, 0, 0], best: q0 };
      while (st.length && out.n < 200000) { const q = st.pop(), i = q % nx, j = ((q / nx) | 0) % ny, k = (q / (nx * ny)) | 0; out.n++; out.s[0] += i; out.s[1] += j; out.s[2] += k; if (D[q] > D[out.best]) out.best = q;
        for (const [a, b, c] of nb26) { const ii = i + a, jj = j + b, kk = k + c; if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue; const u = ii + nx * (jj + ny * kk); if (M[u] && D[u] >= lim && !seen.has(u)) { seen.add(u); st.push(u); } } }
      return out; };
    const p1 = plateau(topQ), p2 = p1.best === topQ ? p1 : plateau(p1.best);
    top = [org[0] + (i0 + p2.s[0] / p2.n) * sx, org[1] + (j0 + p2.s[1] / p2.n) * sy, org[2] + (k0 + p2.s[2] / p2.n) * sz];
  }
  return { lab, box, count, volume: count * sx * sy * sz, lo, hi, touch, T, dI, ref, seedOk: true, axis: ax, centre: c, crown, length: tmax - tmin, ends: [tmin, tmax], top, vol, dbg };
}
/** cropVolume(vol, [i0, j0, k0], [i1, j1, k1], f) → a new volume of that part of vol, each voxel the average of f³ (f ≥ 1) */
export function cropVolume(vol, a, b, f = 1) {
  const [NX, NY] = vol.dims, d = vol.data, n = [0, 1, 2].map((q) => Math.max(1, Math.floor((b[q] - a[q] + 1) / f))), out = new Int16Array(n[0] * n[1] * n[2]); let min = 32767, max = -32768;
  for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) {
    let s = 0; for (let c = 0; c < f; c++) for (let bb = 0; bb < f; bb++) { const base = (a[0] + i * f) + NX * ((a[1] + j * f + bb) + NY * (a[2] + k * f + c)); for (let aa = 0; aa < f; aa++) s += d[base + aa]; }
    const v = Math.round(s / (f * f * f)); out[i + n[0] * (j + n[1] * k)] = v; if (v < min) min = v; if (v > max) max = v;
  }
  const sp = vol.spacing.map((x) => x * f), origin = [0, 1, 2].map((q) => vol.origin[q] + (a[q] + (f - 1) / 2) * vol.spacing[q]);
  return { ...vol, data: out, dims: n, spacing: sp, origin, min, max, warnings: [] };
}
/**
 * replicaField(vol, seg, { smooth, handle:{ r, length } }) → { F, n, origin, h } for core's isoMesh: the tooth's surface on an even
 * grid of h mm (half the voxel size), negative inside. Where the tooth meets darker surroundings the surface sits where the
 * scan crosses the threshold, between voxels; where it was cut from something bright (a neighbour, a bridge across the
 * ligament space), it runs between the last tooth voxel and the first one that is not. smooth: Gaussian σ (mm).
 * handle: a round peg along the tooth's long axis, out of the crown's end, joined into the surface.
 */
export function replicaField(vol, seg, o = {}) {
  vol = seg.vol || vol;                                           // (the copy the tooth was found on, for a scan with very fine voxels)
  const { lab, box, T, dI } = seg, [sx, sy, sz] = vol.spacing, org = vol.origin, d = vol.data, { nx, ny, nz, i0, j0, k0 } = box, NX = vol.dims[0], NY = vol.dims[1];
  const Fc = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const q = i + nx * (j + ny * k), v = d[(i0 + i) + NX * ((j0 + j) + NY * (k0 + k))], f = (T - v) / dI;
    Fc[q] = Math.max(-2, Math.min(2, lab[q] ? Math.min(f, -0.02) : v >= T ? 0.5 : f));
  }
  const h = o.h || Math.max(0.08, Math.min(sx, sy, sz) / 2), sig = Math.max(0, o.smooth ?? 0.15), H = o.handle || null;
  let hA = null, hB = null, hr = 0;
  if (H) { const a = seg.axis.map((v) => v * seg.crown), tEnd = seg.crown > 0 ? seg.ends[1] : -seg.ends[0]; hA = [0, 1, 2].map((q) => seg.centre[q] + a[q] * (tEnd - 1.5)); hB = [0, 1, 2].map((q) => seg.centre[q] + a[q] * (tEnd + H.length)); hr = H.r; }
  const pad = 3 * sig + 2 * h + 0.6, lo = seg.lo.map((v) => v - pad), hi = seg.hi.map((v) => v + pad);
  if (H) for (let q = 0; q < 3; q++) { lo[q] = Math.min(lo[q], hB[q] - hr - 1); hi[q] = Math.max(hi[q], hB[q] + hr + 1); }
  const n = [0, 1, 2].map((q) => Math.max(3, Math.ceil((hi[q] - lo[q]) / h) + 1)), F = new Float32Array(n[0] * n[1] * n[2]);
  for (let c = 0; c < n[2]; c++) { const fz = (lo[2] + c * h - org[2]) / sz - k0; for (let b = 0; b < n[1]; b++) { const fy = (lo[1] + b * h - org[1]) / sy - j0; for (let a = 0; a < n[0]; a++) {
    const fx = (lo[0] + a * h - org[0]) / sx - i0, idx = a + n[0] * (b + n[1] * c);
    if (!(fx >= 0 && fy >= 0 && fz >= 0 && fx <= nx - 1 && fy <= ny - 1 && fz <= nz - 1)) { F[idx] = 2; continue; }
    const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(ny - 2, Math.floor(fy)), k = Math.min(nz - 2, Math.floor(fz)), tx = fx - i, ty = fy - j, tz = fz - k, X = 1, Y = nx, Z = nx * ny, q = i + nx * (j + ny * k);
    F[idx] = ((Fc[q] * (1 - tx) + Fc[q + X] * tx) * (1 - ty) + (Fc[q + Y] * (1 - tx) + Fc[q + Y + X] * tx) * ty) * (1 - tz) + ((Fc[q + Z] * (1 - tx) + Fc[q + Z + X] * tx) * (1 - ty) + (Fc[q + Z + Y] * (1 - tx) + Fc[q + Z + Y + X] * tx) * ty) * tz;
  } } }
  if (sig > 0) gauss3(F, n, sig / h);
  if (H) {                                                        // the peg: a capped cylinder, as a field of about the same steepness (3 per mm)
    const ax = [hB[0] - hA[0], hB[1] - hA[1], hB[2] - hA[2]], L = Math.hypot(...ax), u = ax.map((v) => v / L);
    for (let c = 0; c < n[2]; c++) for (let b = 0; b < n[1]; b++) for (let a = 0; a < n[0]; a++) {
      const px = lo[0] + a * h - hA[0], py = lo[1] + b * h - hA[1], pz = lo[2] + c * h - hA[2], t = px * u[0] + py * u[1] + pz * u[2], rx = px - t * u[0], ry = py - t * u[1], rz = pz - t * u[2];
      const dr = Math.sqrt(rx * rx + ry * ry + rz * rz) - hr, dz = Math.abs(t - L / 2) - L / 2, sd = Math.min(Math.max(dr, dz), 0) + Math.hypot(Math.max(dr, 0), Math.max(dz, 0)), idx = a + n[0] * (b + n[1] * c);
      if (sd * 3 < F[idx]) F[idx] = sd * 3;
    }
  }
  return { F, n, origin: lo, h, handle: H ? { a: hA, b: hB, r: hr } : null };
}
/** separable Gaussian blur of a 3D grid in place (σ in cells: one number, or one per axis) */
function gauss3(F, n, s) {
  const [nx, ny, nz] = n, line = new Float32Array(Math.max(nx, ny, nz)), res = new Float32Array(line.length), S = typeof s === 'number' ? [s, s, s] : s;
  const pass = (sg, len, count, base, stride) => {
    if (!(sg > 0.01)) return; const r = Math.max(1, Math.ceil(3 * sg)), w = new Float32Array(2 * r + 1); let ws = 0; for (let q = -r; q <= r; q++) { w[q + r] = Math.exp(-q * q / (2 * sg * sg)); ws += w[q + r]; } for (let q = 0; q < w.length; q++) w[q] /= ws;
    for (let c = 0; c < count; c++) { const b0 = base(c); for (let t = 0; t < len; t++) line[t] = F[b0 + t * stride]; for (let t = 0; t < len; t++) { let acc = 0; for (let q = -r; q <= r; q++) { const u = t + q < 0 ? 0 : t + q >= len ? len - 1 : t + q; acc += w[q + r] * line[u]; } res[t] = acc; } for (let t = 0; t < len; t++) F[b0 + t * stride] = res[t]; }
  };
  pass(S[0], nx, ny * nz, (c) => c * nx, 1);
  pass(S[1], ny, nx * nz, (c) => (c % nx) + nx * ny * ((c / nx) | 0), nx);
  pass(S[2], nz, nx * ny, (c) => c, nx * ny);
}
// ── the root canals of a tooth that has been cut out ──
/**
 * segmentCanal(vol, seg, o) — the pulp chamber and the root canals inside a picked tooth (seg from segmentTooth).
 *
 * A canal narrower than the scan's own blur does not read as dark as pulp: it is a faint dip in the dentine's grey — a tenth of
 * the way down to soft tissue for a canal a third of a millimetre across — and the noise of a single voxel is a fifth of that.
 * So:
 *   · the grey is resampled on a grid that stands along the tooth's own axis, as fine as the scan's voxels, and evened out
 *     along the tooth (canals run along it; noise does not);
 *   · at every voxel inside the tooth, how far the grey dips below the dentine round it: across the slice in four directions,
 *     the brightest tissue of the tooth within 1 mm on either side; a voxel lies in a dip only if it is walled on both sides in
 *     at least three of the four (so the darker rim of the tooth itself is no dip, and a ribbon-shaped canal still is). The
 *     dip is expressed from the wall towards soft tissue, 0 … 1;
 *   · a wide hollow — the pulp chamber, a wide canal — is as dark as pulp in its middle, and its edge lies where the grey is
 *     midway between pulp and dentine (the threshold T);
 *   · narrower canals are followed from slice to slice instead: the line through the tooth, moving at most one voxel sideways
 *     per slice, along which the dip adds up to the most — above what noise alone adds up to — is a canal. It ends where the
 *     dip ahead no longer outweighs the noise. Lines are taken one after another, each from the chamber or from a canal
 *     already found, until none is left that stands out;
 *   · a line leaves the chamber rootwards: it has no part at or above the chamber's roof (the furthest slice towards the
 *     crown in which the chamber is a quarter of its largest size: horns do not count), a short line that leaves a hollow
 *     only to come back to the same hollow is that hollow's flank, and so is a line that keeps within 1.4 mm of a hollow
 *     or canal already found for most of its way (0.6 mm round either counts as found already);
 *   · the noise floor is read from plain dentine — not from within 1 mm of a wide hollow, whose flank dips too;
 *   · each is drawn as a tube whose width follows from the depth of its dip and the scan's blur: a canal d across dips
 *     by 1 − exp(−d² / 8σ²);
 *   · a canal runs on to the end of its root whether the scan shows it or not. The roots are read from the tooth's own
 *     outline (its pieces slice by slice; a piece with nothing below it, after 1½ mm of root of its own, is a tip). A line
 *     that gives out short of its root's tip is carried on to ¾ mm from the tip along the likeliest course — through what
 *     dip there is, otherwise down the middle of the root — or into the first canal or hollow it meets; a root no canal
 *     reached gets one from the chamber the same way. Such a stretch is "seen" only where its own dip stands out as a
 *     found line's must; the rest is "presumed": kept apart in every result, so that it can be drawn and counted apart.
 * → { mask (seen: wide hollows and the voxels the canals pass through), maskP (presumed stretches), wide,
 *     paths: [{ q, pts, r, f, pres (per point: 1 presumed), forcedFrom (index from which it was carried on), score }],
 *     grid: { n, h, O, u, v, w }, I, inT, f, T, auto, pulp, dentine, and of what is seen: count, volume, pieces, lo, hi, length,
 *     apexGap, crownGap, canals, levels, faint (mm of canal drawn from its dip alone); presumed (mm), apexGapAll, loAll, hiAll
 *     (with the presumed stretches), roots (tips found), noise: { level, spread, floor },
 *     has(x, y, z) → 0 | 1 seen | 2 presumed (read between the voxels once canalField has been worked out) } or { error }
 * o: T (the grey below which a wide hollow counts — default midway between pulp and dentine; set higher, fainter canals are
 *    followed too), faint (1 … 5, default 3: how faint a line of dip may be and still count as a canal — its dip, added up
 *    along it above the noise floor, must reach 2.2, 1.6, 1.2, 0.9 or 0.65 voxel-dips per ¼ mm of voxel; minScore sets
 *    that figure itself), psf (the scan's blur σ in mm: default 1¼ voxels), maxVoxels, sidePad, endPad, minRun (mm),
 *    maxPaths, reach (false: no canal is carried on beyond what its dip shows), trace (a function given every line the
 *    search tries, kept or not — for looking into a result: { run, gain, ok, flank, afloat, … })
 */
export function segmentCanal(vol, seg, o = {}) {
  if (!seg || seg.error || !seg.lab) return { error: 'Pick the tooth first.' };
  const W = seg.vol || vol, { lab, box } = seg, c = seg.centre, w = seg.axis.slice(), sW = W.spacing, oW = W.origin;
  const r0 = Math.abs(w[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], ud = dot(r0, w), u0 = [r0[0] - ud * w[0], r0[1] - ud * w[1], r0[2] - ud * w[2]], ul = Math.hypot(...u0), u = u0.map((x) => x / ul), v = cross(w, u);
  // how far the tooth reaches in that frame
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < box.nz; k++) for (let j = 0; j < box.ny; j++) for (let i = 0; i < box.nx; i++) {
    if (!lab[i + box.nx * (j + box.ny * k)]) continue; const d = [oW[0] + (box.i0 + i) * sW[0] - c[0], oW[1] + (box.j0 + j) * sW[1] - c[1], oW[2] + (box.k0 + k) * sW[2] - c[2]], e = [dot(d, u), dot(d, v), dot(d, w)];
    for (let a = 0; a < 3; a++) { if (e[a] < lo[a]) lo[a] = e[a]; if (e[a] > hi[a]) hi[a] = e[a]; }
  }
  if (!(lo[0] < Infinity)) return { error: 'Pick the tooth first.' };
  const fromTop = seg.crown > 0, vox = Math.min(...vol.spacing); let h = Math.max(0.04, vox);
  // the grid: 1½ mm wider than the tooth all round and 3 mm past its root end
  const side = o.sidePad ?? 1.5, endPad = o.endPad ?? 3, pl = [side, side, fromTop ? endPad : 1], ph = [side, side, fromTop ? 1 : endPad], size = (hh) => [0, 1, 2].map((a) => Math.max(3, Math.ceil((hi[a] - lo[a] + pl[a] + ph[a]) / hh) + 1));
  while (size(h).reduce((p, x) => p * x, 1) > (o.maxVoxels ?? 6e6)) h *= 1.12;
  const [n0, n1, n2] = size(h), sl = n0 * n1, n = sl * n2, O = [0, 1, 2].map((a) => c[a] + (lo[0] - pl[0]) * u[a] + (lo[1] - pl[1]) * v[a] + (lo[2] - pl[2]) * w[a]);
  const I = new Int16Array(n), inT = new Uint8Array(n);
  for (let k = 0; k < n2; k++) for (let j = 0; j < n1; j++) for (let i = 0; i < n0; i++) {
    const x = O[0] + h * (i * u[0] + j * v[0] + k * w[0]), y = O[1] + h * (i * u[1] + j * v[1] + k * w[1]), z = O[2] + h * (i * u[2] + j * v[2] + k * w[2]), q = i + n0 * j + sl * k;
    I[q] = Math.round(sampleAt(vol, x, y, z));
    const a = Math.round((x - oW[0]) / sW[0]) - box.i0, b = Math.round((y - oW[1]) / sW[1]) - box.j0, cc = Math.round((z - oW[2]) / sW[2]) - box.k0;
    inT[q] = a >= 0 && b >= 0 && cc >= 0 && a < box.nx && b < box.ny && cc < box.nz && lab[a + box.nx * (b + box.ny * cc)] ? 1 : 0;
  }
  let t0 = n2, t1 = -1; for (let k = 0; k < n2; k++) { let any = 0; for (let r = 0; r < sl && !any; r++) any = inT[k * sl + r]; if (any) { if (k < t0) t0 = k; t1 = k; } }   // the tooth's ends along its axis
  if (t1 < 0) return { error: 'Pick the tooth first.' };
  const rootEnd = fromTop ? t0 : t1, crownTip = fromTop ? t1 : t0, ap = fromTop ? -1 : 1, cej = Math.round(crownTip + 0.42 * (rootEnd - crownTip)), inCrown = (k) => (fromTop ? k >= cej : k <= cej), grid = { n: [n0, n1, n2], h, O, u, v, w };
  const disc = (r) => { const d = []; for (let b = -r; b <= r; b++) for (let a = -r; a <= r; a++) if (a * a + b * b <= r * r + 0.5) d.push(a, b); return Int8Array.from(d); }, st = [];
  // ── inside the tooth: its outline in each slice with gaps of up to ½ mm closed (no wider: the gap between two roots is not a
  //    canal), and everything that outline rings (the pulp).
  //    Under the tip of a root — a small piece with nothing of the tooth below it — 2 mm further (2): the tooth's outline may
  //    stop short of a root's end, where the root lies in bone as bright as itself.
  //    A hollow with none of the tooth above it (towards the crown's tip) is not pulp: the dip between the cusps is ringed by
  //    them slice by slice, but it is open above ──
  const ins = new Uint8Array(n), rC = Math.max(1, Math.round(0.25 / h)), dC = disc(rC), A = new Uint8Array(sl), B = new Uint8Array(sl);
  for (let k = t0; k <= t1; k++) { const base = k * sl; A.fill(0);
    for (let j = 0; j < n1; j++) for (let i = 0; i < n0; i++) if (inT[base + i + n0 * j]) for (let m = 0; m < dC.length; m += 2) { const ii = i + dC[m], jj = j + dC[m + 1]; if (ii >= 0 && jj >= 0 && ii < n0 && jj < n1) A[ii + n0 * jj] = 1; }
    solid2(A, n0, n1, B);
    for (let j = 0; j < n1; j++) for (let i = 0; i < n0; i++) { const r = i + n0 * j; if (inT[base + r]) { ins[base + r] = 1; continue; } if (!B[r]) continue; let ok = true; for (let m = 0; m < dC.length && ok; m += 2) { const ii = i + dC[m], jj = j + dC[m + 1]; if (ii < 0 || jj < 0 || ii >= n0 || jj >= n1 || !B[ii + n0 * jj]) ok = false; } if (ok) ins[base + r] = 1; } }
  { const top = new Int32Array(sl).fill(-1); for (let k = t0; k <= t1; k++) for (let r = 0; r < sl; r++) if (inT[k * sl + r] && (top[r] < 0 || fromTop)) top[r] = k;   // (each column's own highest voxel of the tooth, crownwards)
    for (let k = t0; k <= t1; k++) for (let r = 0; r < sl; r++) { const q = k * sl + r; if (ins[q] && !inT[q] && (top[r] < 0 || (fromTop ? k > top[r] : k < top[r]))) ins[q] = 0; } }
  { const tipA = Math.round(4 / (h * h)), ext = Math.round(2 / h), seenS = new Uint8Array(sl);
    for (let k = t0; k <= t1; k++) { const base = k * sl, kb = k + ap; seenS.fill(0);
      for (let r0 = 0; r0 < sl; r0++) { if (ins[base + r0] !== 1 || seenS[r0]) continue; const comp = []; seenS[r0] = 1; st.push(r0);
        while (st.length) { const r = st.pop(), i = r % n0, j = (r / n0) | 0; comp.push(r); if (i > 0 && ins[base + r - 1] === 1 && !seenS[r - 1]) { seenS[r - 1] = 1; st.push(r - 1); } if (i < n0 - 1 && ins[base + r + 1] === 1 && !seenS[r + 1]) { seenS[r + 1] = 1; st.push(r + 1); } if (j > 0 && ins[base + r - n0] === 1 && !seenS[r - n0]) { seenS[r - n0] = 1; st.push(r - n0); } if (j < n1 - 1 && ins[base + r + n0] === 1 && !seenS[r + n0]) { seenS[r + n0] = 1; st.push(r + n0); } }
        if (comp.length > tipA) continue; let below = 0; if (kb >= 0 && kb < n2) for (const r of comp) if (ins[kb * sl + r] === 1) below++; if (below > 0.25 * comp.length) continue;
        for (const r of comp) for (let s = 1; s <= ext; s++) { const kk = k + ap * s; if (kk < 0 || kk >= n2 || ins[kk * sl + r]) break; ins[kk * sl + r] = 2; } } } }
  // ── levels ──
  const lv = seg.levels || {}, dentine = lv.dentine != null ? lv.dentine : seg.ref ?? seg.T + 500, softL = lv.soft != null ? lv.soft : windowPresets(vol).soft.l, pulp = Math.round(Math.min(softL, dentine - 300)), span = Math.max(1, dentine - pulp);
  const Dcap = lv.enamel != null ? (dentine + lv.enamel) / 2 : dentine + 0.35 * span, auto = Math.round(pulp + 0.5 * span), T = Math.round(o.T ?? auto), frac = Math.max(0.05, Math.min(0.97, (T - pulp) / span)), base0 = { T, auto, pulp, dentine };
  // the grey, evened out along the tooth and capped at what dentine may be (enamel is not a wall round anything)
  const Is = new Float32Array(n); for (let q = 0; q < n; q++) { if (!ins[q]) continue; const a = q >= sl ? I[q - sl] : I[q], b = q + sl < n ? I[q + sl] : I[q]; Is[q] = Math.min(Dcap, (a + 2 * I[q] + b) / 4); }
  // each slice's own dentine level (the wall of a hollow too wide to see across)
  const slLev = new Float32Array(n2).fill(NaN);
  for (let k = 0; k < n2; k++) { const vals = []; for (let r = 0; r < sl; r++) if (ins[k * sl + r] === 1) vals.push(Is[k * sl + r]); if (vals.length >= 12) { vals.sort((a, b) => a - b); slLev[k] = Math.min(vals[Math.floor(vals.length * 0.7)], dentine + 0.15 * span); } }   // (no brighter than dentine: a crown's slice is mostly enamel)
  { let last = dentine; for (let s = 0; s < n2; s++) { const k = fromTop ? n2 - 1 - s : s; if (slLev[k] === slLev[k]) last = slLev[k]; else slLev[k] = last; } }
  // ── the dip at every voxel ──
  const DIR = [[1, 0], [0, 1], [1, 1], [1, -1]], f = new Float32Array(n), wide = new Uint8Array(n), tW = 1 - frac, R1 = [0, 1].map((d) => Math.max(2, Math.round(1 / (h * (d ? Math.SQRT2 : 1))))), R2 = [0, 1].map((d) => Math.max(3, Math.round(6 / (h * (d ? Math.SQRT2 : 1))))), wd = [0, 0, 0, 0];
  const sideMax = (q, i, j, a, b, R) => { let m = -Infinity; for (let s = 1; s <= R; s++) { const ii = i + s * a, jj = j + s * b; if (ii < 0 || jj < 0 || ii >= n0 || jj >= n1) break; const r = q + s * (a + n0 * b); if (!ins[r]) break; if (Is[r] > m) m = Is[r]; } return m; };
  for (let k = 0; k < n2; k++) for (let j = 0; j < n1; j++) for (let i = 0; i < n0; i++) { const q = i + n0 * j + sl * k; if (!ins[q]) continue;
    for (let d = 0; d < 4; d++) { const a = DIR[d][0], b = DIR[d][1], R = R1[d < 2 ? 0 : 1]; wd[d] = Math.min(sideMax(q, i, j, a, b, R), sideMax(q, i, j, -a, -b, R)); }
    let m1 = Infinity, m2 = Infinity; for (let d = 0; d < 4; d++) { if (wd[d] < m1) { m2 = m1; m1 = wd[d]; } else if (wd[d] < m2) m2 = wd[d]; }   // the second least: walled in three directions of the four
    let fv = m2 > Is[q] && m2 > pulp + 1 ? (m2 - Is[q]) / (m2 - pulp) : 0;
    // a wide hollow: dark against the slice's own dentine, and walled further off
    const L = slLev[k], f2 = (L - Is[q]) / Math.max(1, L - pulp);
    if (ins[q] === 1 && f2 >= Math.min(tW, 0.35) && f2 > fv) { const need = L - 0.3 * span; let ok = 0; for (let d = 0; d < 4; d++) { const a = DIR[d][0], b = DIR[d][1], R = R2[d < 2 ? 0 : 1]; if (sideMax(q, i, j, a, b, R) >= need && sideMax(q, i, j, -a, -b, R) >= need) ok++; } if (ok >= 3) fv = f2; }
    f[q] = Math.min(1.2, fv); if (ins[q] === 1 && fv >= tW) wide[q] = 1; }
  // (a single voxel of a wide hollow that noise left out — hollow on all four sides in its slice and above or below — belongs to it)
  for (let pass = 0; pass < 2; pass++) for (let k = 1; k < n2 - 1; k++) for (let j = 1; j < n1 - 1; j++) for (let i = 1; i < n0 - 1; i++) { const q = i + n0 * j + sl * k; if (!wide[q] && ins[q] === 1 && wide[q - 1] && wide[q + 1] && wide[q - n0] && wide[q + n0] && (wide[q - sl] || wide[q + sl])) wide[q] = 1; }
  // ── wide hollows: the pulp (chamber and wide canal) is the largest; others count when a canal leads to them ──
  const id = new Int32Array(n), list = [null];
  for (let q0 = 0; q0 < n; q0++) { if (!wide[q0] || id[q0]) continue; const L = list.length, P = { size: 0, crown: 0, vox: [] }; id[q0] = L; st.push(q0);
    while (st.length) { const q = st.pop(), i = q % n0, j = ((q / n0) | 0) % n1, k = (q / sl) | 0; P.size++; P.vox.push(q); if (inCrown(k)) P.crown++;
      for (let dc = -1; dc <= 1; dc++) { const kk = k + dc; if (kk < 0 || kk >= n2) continue; for (let db = -1; db <= 1; db++) { const jj = j + db; if (jj < 0 || jj >= n1) continue; for (let da = -1; da <= 1; da++) { const ii = i + da; if (ii < 0 || ii >= n0) continue; const r = ii + n0 * jj + sl * kk; if (wide[r] && !id[r]) { id[r] = L; st.push(r); } } } } }
    list.push(P); }
  const minVox = Math.max(3, Math.ceil((o.minPiece ?? 0.1) / (h * h * h))); let ch = 0;
  for (let L = 1; L < list.length; L++) if (list[L].size >= minVox && (!ch || list[L].size > list[ch].size)) ch = L;
  const keep = new Uint8Array(n), anch = new Uint8Array(n), near = new Uint8Array(n), nid = new Int16Array(n), joined = new Uint8Array(list.length);
  const markN = (q, r, idn) => { const i = q % n0, j = ((q / n0) | 0) % n1, base = q - i - n0 * j; for (let b = -r; b <= r; b++) for (let a = -r; a <= r; a++) { const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < n0 && jj < n1 && a * a + b * b <= r * r + 0.5) { const t = base + ii + n0 * jj; near[t] = 1; if (idn && !nid[t]) nid[t] = idn; } } };
  const mark = (arr, q, r, rz = 0) => { const i = q % n0, j = ((q / n0) | 0) % n1, k = (q / sl) | 0; for (let cz = -rz; cz <= rz; cz++) { const kk = k + cz; if (kk < 0 || kk >= n2) continue; for (let b = -r; b <= r; b++) for (let a = -r; a <= r; a++) { const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < n0 && jj < n1 && a * a + b * b <= r * r + 0.5) arr[ii + n0 * jj + sl * kk] = 1; } } };
  // (round a wide hollow, as round a line, 0.6 mm counts as found already: the hollow's own shoulder dips too, and a line along it is not a second canal)
  const shell = o.shell === false ? 1 : Math.max(1, Math.round(0.6 / h));
  const by = new Uint8Array(n), rBy = Math.max(shell + 1, Math.round(1.4 / h));   // within 1.4 mm of what is found
  const join = (L) => { if (!L || joined[L]) return; joined[L] = 1; for (const q of list[L].vox) { keep[q] = 1; mark(anch, q, Math.max(2, shell), 1); markN(q, shell, -1); mark(by, q, rBy); } };
  join(ch);
  // (the chamber's roof: the slice furthest towards the crown in which the chamber is at least a quarter as large as in its
  //  largest slice — a horn above that is not the roof. A canal leaves the chamber's floor, so no line has any part within
  //  ½ mm of the roof's level, or beyond it: that is a horn of the chamber, or the crown's own grain)
  let kRoof = null; if (ch) { const area = new Int32Array(n2); let top = 0; for (const q of list[ch].vox) { const k = (q / sl) | 0; if (++area[k] > top) top = area[k]; } for (let k = 0; k < n2; k++) if (area[k] >= 0.25 * top && (kRoof == null || (k - kRoof) * ap < 0)) kRoof = k; }
  const kTopLine = kRoof == null ? null : kRoof + ap * Math.round(0.5 / h);
  // ── what noise alone looks like: the dips of plain dentine (most of the tooth). A line that picks the darkest of nine voxels
  //    at every step gathers, from noise alone, about what the darkest twentieth of them shows: that is the floor a canal's
  //    dip must stand above (with the threshold set higher, a little less) ──
  //    (not the dentine within 1 mm of a wide hollow: its flank dips too, and a tooth with wide canals has a great deal of it —
  //    counted as noise it raised the floor by a third, and a faint second canal was lost under it)
  const dv = []; { const flank = new Uint8Array(n), rF = Math.max(2, Math.round(1 / h)); if (o.flank !== false) for (let q = 0; q < n; q++) if (wide[q]) mark(flank, q, rF); const stp = 1 + ((n / 120000) | 0); for (let q = 0; q < n; q += stp) if (ins[q] === 1 && !wide[q] && !flank[q] && f[q] < 0.4) dv.push(f[q]); if (dv.length < 200) { dv.length = 0; for (let q = 0; q < n; q += stp) if (ins[q] === 1 && !wide[q] && f[q] < 0.4) dv.push(f[q]); } } dv.sort((a, b) => a - b);
  const pos = dv.filter((x) => x > 0), mf = pos.length ? pos[pos.length >> 1] : 0.02, qd = Math.max(0.8, Math.min(0.995, o.quantile ?? 0.95 - 0.25 * (frac - 0.5))), sf = dv.length ? dv[Math.floor((dv.length - 1) * 0.9)] : 0.04, delta = Math.max(0.02, dv.length ? dv[Math.floor((dv.length - 1) * qd)] : 0.06);
  // (only the middle of a dip counts — where it is deepest across the slice: the blurred flank of a canal is not a second canal beside it)
  const crest = new Uint8Array(n); for (let k = 0; k < n2; k++) for (let j = 1; j < n1 - 1; j++) for (let i = 1; i < n0 - 1; i++) { const q = i + n0 * j + sl * k, x = f[q]; if (x > 0 && x >= f[q - 1] && x >= f[q + 1] && x >= f[q - n0] && x >= f[q + n0] && x >= f[q - n0 - 1] && x >= f[q - n0 + 1] && x >= f[q + n0 - 1] && x >= f[q + n0 + 1]) crest[q] = 1; }
  // (a canal has dentine all round it: a dip within ⅓ mm of the tooth's own outline is its darker rim, or the ligament just
  //  outside it where the outline runs a little wide — not a canal, and it scores nothing)
  { const dR = disc(Math.max(1, Math.round(0.35 / h))); for (let k = 0; k < n2; k++) { const base = k * sl; for (let j = 0; j < n1; j++) for (let i = 0; i < n0; i++) { const q = base + i + n0 * j; if (!crest[q] || wide[q]) continue;
        for (let m = 0; m < dR.length; m += 2) { const ii = i + dR[m], jj = j + dR[m + 1]; if (ii < 0 || jj < 0 || ii >= n0 || jj >= n1 || ins[base + ii + n0 * jj] !== 1) { crest[q] = 0; break; } } } } }
  // ── the canals: lines of dip from slice to slice (the best continuation worked out from the root end up), one after another ──
  const s = new Float32Array(n), V = new Float32Array(n), ptr = new Int8Array(n), paths = [], kA = fromTop ? 0 : n2 - 1, sup = Math.max(1, Math.round(0.6 / h)), minScore = (o.minScore ?? [2.2, 1.6, 1.2, 0.9, 0.65][Math.max(1, Math.min(5, Math.round(o.faint ?? 3))) - 1]) * (0.25 / h), maxPaths = o.maxPaths ?? 10, minRun = Math.max(2, Math.round((o.minRun ?? 1) / h));
  for (let it = 0; it < maxPaths + 8 && paths.length < maxPaths; it++) {
    for (let q = 0; q < n; q++) s[q] = !ins[q] ? -Infinity : near[q] ? (keep[q] ? 0 : -0.01) : crest[q] || wide[q] ? f[q] - delta : -0.5 * delta;   // (what is found already neither adds nor costs; a wide hollow not yet reached counts in full)
    for (let t = 0; t < n2; t++) { const k = kA - ap * t, kb = k + ap, base = k * sl;
      for (let j = 0; j < n1; j++) for (let i = 0; i < n0; i++) { const q = base + i + n0 * j; if (!ins[q]) { V[q] = -Infinity; ptr[q] = -1; continue; } let best = 0, bp = -1;
        if (kb >= 0 && kb < n2) for (let db = -1; db <= 1; db++) { const jj = j + db; if (jj < 0 || jj >= n1) continue; for (let da = -1; da <= 1; da++) { const ii = i + da; if (ii < 0 || ii >= n0) continue; const val = V[kb * sl + ii + n0 * jj] - (da || db ? 0.004 : 0); if (val > best) { best = val; bp = (da + 1) + 3 * (db + 1); } } }
        V[q] = s[q] + best; ptr[q] = bp; } }
    // the best line that starts at the chamber or at a canal already found (anywhere, while there is nothing to start from)
    let q0 = -1, bv = minScore; const anchored = !!ch || paths.length > 0; for (let q = 0; q < n; q++) if (V[q] > bv && (!anchored || anch[q])) { bv = V[q]; q0 = q; }
    if (q0 < 0) break;
    const pts = []; let q = q0; for (;;) { pts.push(q); const bp = ptr[q]; if (bp < 0) break; const i = q % n0, j = ((q / n0) | 0) % n1, k = (q / sl) | 0; q = (i + (bp % 3) - 1) + n0 * (j + ((bp / 3) | 0) - 1) + sl * (k + ap); }
    let first = 0; while (first < pts.length - 1 && near[pts[first + 1]]) first++;   // (its run through what is already found is not part of it, but for the voxel it leaves from)
    if (ch) for (let a = pts.length - 1; a > first; a--) if (id[pts[a]] === ch) { first = a; break; }   // (nor is a line that comes up to the chamber from the crown's side: a canal leaves the chamber rootwards)
    let afloat = false; if (kTopLine != null && o.roof !== false && (((pts[first] / sl) | 0) - kTopLine) * ap < 0) { while (first < pts.length - 1 && (((pts[first] / sl) | 0) - kTopLine) * ap < 0) first++;
      afloat = !by[pts[first]]; }   // (what is left of it must still begin beside the chamber or a canal: within 1.4 mm)
    const run = pts.slice(first); let gain = 0, beside = 0, out = 0; for (const p of run) if (!near[p]) { gain += crest[p] || wide[p] ? f[p] - delta : -0.5 * delta; out++; if (by[p]) beside++; }
    // (a line that keeps within 1.4 mm of a hollow or canal already found for most of its way is that one's flank — the blur of
    //  a wide canal dips beside it too — not a canal of its own: a second canal runs apart and, at most, closes in at its end)
    const flank = o.flankLines !== false && out > 0 && beside > 0.7 * out, okRun = run.length >= minRun && gain >= minScore && !flank && !afloat; for (const p of run) markN(p, sup, okRun ? paths.length + 1 : 0);
    if (o.trace) o.trace({ run, gain, ok: okRun, flank, afloat, first, pts, kTopLine, kRoof, ap, minScore, minRun, n0, n1, sl });
    if (!okRun) continue;
    for (const p of run) { mark(anch, p, 2, 1); mark(by, p, rBy); if (id[p]) join(id[p]); else { const i = p % n0, j = ((p / n0) | 0) % n1; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < n0 && jj < n1) join(id[p + a + n0 * b]); } } }
    paths.push({ q: run, score: gain });
  }
  if (!ch && !paths.length) return { ...base0, grid, I, inT, f, error: 'No canal space shows inside this tooth: raise the canal threshold, or check the tooth was picked whole.' };
  // ── the roots, and the canals carried on to their ends ──
  //    A canal runs on to the end of its root whether the scan shows it or not. So: the pieces of the tooth in each slice are
  //    linked from slice to slice towards the root end, and a piece with nothing below it, at the end of 1½ mm of root of its
  //    own, is a root's tip. Where a line of dip gives out short of its root's tip, and for a root in which no canal was
  //    found, the most likely course is taken as far as ¾ mm from the tip: through what dip there is, otherwise down the
  //    middle of the root (o.reach === false: not done). Such a stretch counts as seen only where its dip stands above the
  //    noise; the rest is "presumed".
  const tips = [];
  if (o.reach !== false) {
    const comp = new Int32Array(n), CP = [null], dt = new Uint8Array(n);
    for (let k = t0; k <= t1; k++) { const base = k * sl; for (let r0 = 0; r0 < sl; r0++) { if (ins[base + r0] !== 1 || comp[base + r0]) continue; const c = { k, vox: [], up: [], down: [] }, L = CP.length; comp[base + r0] = L; st.push(r0);
        while (st.length) { const r = st.pop(), i = r % n0, j = (r / n0) | 0; c.vox.push(r);
          if (i > 0 && ins[base + r - 1] === 1 && !comp[base + r - 1]) { comp[base + r - 1] = L; st.push(r - 1); } if (i < n0 - 1 && ins[base + r + 1] === 1 && !comp[base + r + 1]) { comp[base + r + 1] = L; st.push(r + 1); }
          if (j > 0 && ins[base + r - n0] === 1 && !comp[base + r - n0]) { comp[base + r - n0] = L; st.push(r - n0); } if (j < n1 - 1 && ins[base + r + n0] === 1 && !comp[base + r + n0]) { comp[base + r + n0] = L; st.push(r + n0); } }
        CP.push(c); } }
    for (let L = 1; L < CP.length; L++) { const c = CP[L], kb = c.k + ap; if (kb < t0 || kb > t1) continue; const got = new Set(), base = kb * sl; for (const r of c.vox) { const d = comp[base + r]; if (d && !got.has(d)) { got.add(d); c.down.push(d); CP[d].up.push(L); } } }
    const depth = new Int32Array(CP.length); for (let a = 1; a < CP.length; a++) { const L = fromTop ? a : CP.length - a; let m = 0; for (const d of CP[L].down) if (depth[d] > m) m = depth[d]; depth[L] = m + 1; }
    // (how far each voxel lies inside its slice's outline, in tenths of a voxel)
    { const A = new Float32Array(sl); for (let k = t0; k <= t1; k++) { const base = k * sl; for (let r = 0; r < sl; r++) A[r] = ins[base + r] === 1 ? 1e3 : 0;
        for (let j = 0; j < n1; j++) for (let i = 0; i < n0; i++) { const r = i + n0 * j; if (!A[r]) continue; let m = A[r]; m = Math.min(m, (i > 0 ? A[r - 1] : 0) + 1, (j > 0 ? A[r - n0] : 0) + 1, (i > 0 && j > 0 ? A[r - n0 - 1] : 0) + 1.414, (i < n0 - 1 && j > 0 ? A[r - n0 + 1] : 0) + 1.414); A[r] = m; }
        for (let j = n1 - 1; j >= 0; j--) for (let i = n0 - 1; i >= 0; i--) { const r = i + n0 * j; if (!A[r]) continue; let m = A[r]; m = Math.min(m, (i < n0 - 1 ? A[r + 1] : 0) + 1, (j < n1 - 1 ? A[r + n0] : 0) + 1, (i < n0 - 1 && j < n1 - 1 ? A[r + n0 + 1] : 0) + 1.414, (i > 0 && j < n1 - 1 ? A[r + n0 - 1] : 0) + 1.414); A[r] = m; }
        for (let r = 0; r < sl; r++) dt[base + r] = Math.min(250, Math.round(A[r] * 10)); } }
    const largestUp = (L) => { let up = CP[L].up[0]; for (const x of CP[L].up) if (CP[x].vox.length > CP[up].vox.length) up = x; return up; };
    const backN = Math.max(1, Math.round(0.75 / h)), minRoot = Math.max(3, Math.round(1.5 / h)), tipOf = new Map();
    for (let L = 1; L < CP.length; L++) { if (CP[L].down.length || inCrown(CP[L].k)) continue; let m = L, len = 1;
      while (CP[m].up.length && len < minRoot) { const up = largestUp(m); let deepest = true; for (const d of CP[up].down) if (d !== m && (depth[d] > depth[m] || (depth[d] === depth[m] && d < m))) deepest = false; if (!deepest) break; m = up; len++; }
      if (len < minRoot) continue;
      let S = L; for (let s2 = 0; s2 < backN && CP[S].up.length; s2++) S = largestUp(S);
      let md = 0; const bS = CP[S].k * sl; for (const r of CP[S].vox) if (dt[bS + r] > md) md = dt[bS + r];
      const tp = { L, S, k: CP[L].k, kS: CP[S].k, stop: CP[S].vox.filter((r) => dt[bS + r] >= 0.5 * md) }; tips.push(tp); tipOf.set(L, tp); }
    // the best course from a voxel down to a tip's end: what dip there is counts as in the search above; plain dentine costs
    // half the noise floor a voxel, up to three times that next to the root's surface; a step sideways costs a little
    const dC = 10 * Math.max(1, 0.75 / h), side = 0.1 * delta;
    const sF = (q) => (near[q] ? 0 : (crest[q] || wide[q]) && f[q] > delta ? f[q] - delta : -0.5 * delta * (1 + 2 * Math.max(0, 1 - dt[q] / dC)));
    const forcedFrom = (tp, kTop) => { const bS = tp.kS * sl; for (let r = 0; r < sl; r++) { V[bS + r] = -Infinity; ptr[bS + r] = -1; } for (const r of tp.stop) V[bS + r] = sF(bS + r);
      const steps = Math.abs(kTop - tp.kS); for (let t = 1; t <= steps; t++) { const k = tp.kS - ap * t, kb = k + ap, base = k * sl;
        for (let j = 0; j < n1; j++) for (let i = 0; i < n0; i++) { const q = base + i + n0 * j; if (ins[q] !== 1) { V[q] = -Infinity; ptr[q] = -1; continue; } let best = -Infinity, bp = -1;
          for (let db = -1; db <= 1; db++) { const jj = j + db; if (jj < 0 || jj >= n1) continue; for (let da = -1; da <= 1; da++) { const ii = i + da; if (ii < 0 || ii >= n0) continue; const val = V[kb * sl + ii + n0 * jj] - (da || db ? side : 0); if (val > best) { best = val; bp = (da + 1) + 3 * (db + 1); } } }
          if (best > -Infinity) { V[q] = sF(q) + best; ptr[q] = bp; } else { V[q] = -Infinity; ptr[q] = -1; } } } };
    const follow = (q0) => { const pts = []; let q = q0; for (;;) { pts.push(q); const bp = ptr[q]; if (bp < 0) break; const i = q % n0, j = ((q / n0) | 0) % n1, k = (q / sl) | 0; q = (i + (bp % 3) - 1) + n0 * (j + ((bp / 3) | 0) - 1) + sl * (k + ap); } return pts; };
    const hollowAt = (q, r) => { const i = q % n0, j = ((q / n0) | 0) % n1, k = (q / sl) | 0; for (let c = -1; c <= 1; c++) { const kk = k + c; if (kk < 0 || kk >= n2) continue; for (let b = -r; b <= r; b++) for (let a = -r; a <= r; a++) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= n0 || jj >= n1) continue; const t = ii + n0 * jj + sl * kk; if (keep[t] && id[t]) return id[t]; } } return 0; };
    const lay = (run, idn) => { for (const p of run) { markN(p, sup, idn); mark(anch, p, 2, 1); mark(by, p, rBy); if (id[p]) join(id[p]); } };
    // 1. each line found, on to the tip of the root it is in (or into another canal, where that is the likelier course)
    for (let a = 0; a < paths.length; a++) { const P = paths[a], e = P.q[P.q.length - 1], ke = (e / sl) | 0, L0 = comp[e]; if (!L0) continue;
      const cands = [], seenC = new Set([L0]), stack = [L0]; while (stack.length) { const L = stack.pop(), tp = tipOf.get(L); if (tp && (tp.kS - ke) * ap > backN) cands.push(tp); for (const d of CP[L].down) if (!seenC.has(d)) { seenC.add(d); stack.push(d); } }
      let best = null, bv = -Infinity; for (const tp of cands) { forcedFrom(tp, ke); if (V[e] > bv) { bv = V[e]; best = tp; } } if (!best) continue;
      if (cands.length > 1) forcedFrom(best, ke);
      const ext = follow(e).slice(1); let cut = 0; while (cut < ext.length && (!nid[ext[cut]] || nid[ext[cut]] === a + 1)) cut++;
      if (cut < ext.length && nid[ext[cut]] < 0) { ext.length = cut + 1; P.merged = true;   // it runs into a wide hollow: it ends there
        // (a short line that leaves a hollow only to come back to it is that hollow's own flank, not a canal)
        const h0 = hollowAt(P.q[0], shell + 2); if (h0 && h0 === hollowAt(ext[cut], shell + 1) && P.q.length + ext.length < Math.round(4 / h)) { P.drop = true; for (let q = 0; q < n; q++) if (nid[q] === a + 1) nid[q] = 0; continue; } }
      else if (cut < ext.length) { P.merged = true;   // it runs into another canal: drawn into that canal's own line, at no more than 45°
        const B = paths[nid[ext[cut]] - 1], qc = cut > 0 ? ext[cut - 1] : e, ic = qc % n0, jc = ((qc / n0) | 0) % n1, kc = (qc / sl) | 0, at = (k) => { let bq = -1, bd = Infinity; for (const q of B.q) { const d = Math.abs(((q / sl) | 0) - k); if (d < bd) { bd = d; bq = q; } } return bq; };
        const q1 = at(kc + ap), g = Math.max(1, Math.ceil(Math.max(Math.abs((q1 % n0) - ic), Math.abs((((q1 / n0) | 0) % n1) - jc)))), qt = at(kc + ap * g), kt = (qt / sl) | 0, it = qt % n0, jt = ((qt / n0) | 0) % n1, steps = (kt - kc) * ap; ext.length = cut;
        if (steps >= 1 && Math.max(Math.abs(it - ic), Math.abs(jt - jc)) <= steps) for (let t = 1; t <= steps; t++) ext.push(Math.round(ic + (it - ic) * t / steps) + n0 * Math.round(jc + (jt - jc) * t / steps) + sl * (kc + ap * t));
        if (!ext.length) continue; }
      else if (ext.length < minRun) continue;
      P.forcedFrom = P.q.length; for (const p of ext) P.q.push(p); lay(ext, a + 1); }
    // 2. a root no canal has reached (none ends within 1½ mm of its tip's end): from the chamber, or from the canal nearest at hand
    const served = new Set(); for (const P of paths) { if (P.drop) continue; let c = P.q.length - 1; while (c > 0 && !comp[P.q[c]]) c--; const e = P.q[c], ke = (e / sl) | 0, L0 = comp[e]; if (!L0) continue; const seenC = new Set([L0]), stack = [L0]; while (stack.length) { const L = stack.pop(), tp = tipOf.get(L); if (tp && (tp.kS - ke) * ap <= backN + 2) served.add(tp); for (const d of CP[L].down) if (!seenC.has(d)) { seenC.add(d); stack.push(d); } } }
    // (nor does a root need one whose wide canal — a hollow that was kept — itself reaches that far)
    for (const tp of tips) { if (served.has(tp)) continue; let m = tp.S; for (let t2 = 0; t2 <= backN; t2++) { const b = CP[m].k * sl; if (CP[m].vox.some((r) => keep[b + r])) { served.add(tp); break; } if (!CP[m].up.length) break; m = largestUp(m); } }
    for (const tp of tips) { if (served.has(tp)) continue;
      forcedFrom(tp, crownTip); let q0 = -1, bv = -Infinity; const steps = Math.abs(crownTip - tp.kS); for (let t = 1; t <= steps; t++) { const base = (tp.kS - ap * t) * sl; for (let r = 0; r < sl; r++) if (anch[base + r] && V[base + r] > bv) { bv = V[base + r]; q0 = base + r; } }
      if (q0 < 0) continue; const pts = follow(q0); let first = 0; for (let a = pts.length - 1; a > 0; a--) if (nid[pts[a]]) { first = a; break; }   // (from where it last leaves a hollow or a canal: what lies before is theirs)
      const run = pts.slice(first); if (run.length < minRun) continue;
      paths.push({ q: run, score: bv, forcedFrom: 0 }); lay(run, paths.length); }
  }
  for (let a = paths.length - 1; a >= 0; a--) if (paths[a].drop) paths.splice(a, 1);
  // ── each canal's width from the depth of its dip: a canal d across, blurred by the scan (σ), dips by 1 − exp(−d²/8σ²) ──
  const sig = o.psf ?? 1.25 * vox, mask = Uint8Array.from(keep), maskP = new Uint8Array(n), minR = o.minRadius ?? 0.1; let faint = 0, tubeVol = 0, presumed = 0;
  for (const P of paths) { const m = P.q.length, fr = new Float32Array(m), r = new Float32Array(m), ij = new Float32Array(2 * m), kk = new Int32Array(m), pres = new Uint8Array(m); P.f = fr; P.r = r; P.ij = ij; P.k = kk; P.pres = pres;
    // the line itself, evened out: from voxel to voxel it steps a whole voxel sideways or none; the canal does not
    for (let a = 0; a < m; a++) { const q = P.q[a]; ij[2 * a] = q % n0; ij[2 * a + 1] = ((q / n0) | 0) % n1; kk[a] = (q / sl) | 0; }
    for (let pass = 0; pass < 4; pass++) { const c = ij.slice(); for (let a = 1; a < m - 1; a++) { ij[2 * a] = (c[2 * a - 2] + 2 * c[2 * a] + c[2 * a + 2]) / 4; ij[2 * a + 1] = (c[2 * a - 1] + 2 * c[2 * a + 1] + c[2 * a + 3]) / 4; } }
    P.pts = Array.from({ length: m }, (_, a) => [0, 1, 2].map((d) => O[d] + h * (ij[2 * a] * u[d] + ij[2 * a + 1] * v[d] + kk[a] * w[d])));
    // a stretch that was carried on: seen where its own dip, over 1½ mm of it, stands above the noise — for at least 1 mm, and
    // by as much in all as a line found by its dip must. A presumed stretch shorter than 1 mm between two that are seen is seen
    if (P.forcedFrom != null) { const f0 = P.forcedFrom, Wn = Math.max(2, Math.round(0.75 / h)), ev = new Float32Array(m); for (let a = f0; a < m; a++) { const q = P.q[a]; ev[a] = keep[q] ? delta : crest[q] || wide[q] ? f[q] - delta : -0.5 * delta; }
      for (let a = f0; a < m; a++) { let sm = 0, cnt = 0; for (let b = Math.max(f0, a - Wn); b <= Math.min(m - 1, a + Wn); b++) { sm += ev[b]; cnt++; } pres[a] = sm / cnt > 0 ? 0 : 1; }
      const minS = Math.max(2, Math.round(1 / h));
      for (let a = f0; a < m;) { let b = a, gain = 0; while (b < m && pres[b] === 0) { gain += ev[b]; b++; } if (b > a && (b - a < minS || gain < minScore)) for (let c = a; c < b; c++) pres[c] = 1; a = Math.max(b, a) + (b === a ? 1 : 0); }   // (and it must stand out as a line found by its dip does)
      for (let a = f0; a < m;) { let b = a; while (b < m && pres[b] === 1) b++; if (b > a && b - a < minS && (b < m || P.merged) && (a > f0 || f0 > 0)) for (let c = a; c < b; c++) pres[c] = 0; a = Math.max(b, a) + (b === a ? 1 : 0); } }   // (or between one and the canal it runs into)
    // (the dip over 5 voxels of the line — not counting a wide hollow next to a narrow stretch: its depth is not that stretch's)
    for (let a = 0; a < m; a++) { let sm = 0, cnt = 0; for (let b = Math.max(0, a - 2); b <= Math.min(m - 1, a + 2); b++) { if (b !== a && keep[P.q[b]] && !keep[P.q[a]]) continue; sm += f[P.q[b]]; cnt++; } fr[a] = sm / cnt; const fe = Math.max(0, Math.min(0.6, fr[a] - mf)); r[a] = keep[P.q[a]] || pres[a] ? minR : Math.max(minR, Math.min(0.45, 0.5 * sig * Math.sqrt(-8 * Math.log(1 - fe)))); }   // (inside a wide hollow the hollow's own surface is drawn, not a tube)
    { const c = r.slice(); for (let a = 1; a < m - 1; a++) r[a] = (c[a - 1] + 2 * c[a] + c[a + 1]) / 4; }
    for (let a = 0; a < m; a++) { const q = P.q[a]; if (pres[a]) { presumed += h; if (!mask[q]) maskP[q] = 1; continue; } if (!keep[q]) { faint += h; tubeVol += Math.PI * r[a] * r[a] * h; } mask[q] = 1; maskP[q] = 0; if (r[a] > 0.75 * h) mark(mask, q, 1); } }
  for (let q = 0; q < n; q++) if (!ins[q]) mask[q] = maskP[q] = 0; else if (mask[q]) maskP[q] = 0;
  // ── what was found ──
  let count = 0, wideN = 0, c0 = n2, c1 = -1; const plo = [Infinity, Infinity, Infinity], phi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < n2; k++) for (let j = 0; j < n1; j++) for (let i = 0; i < n0; i++) { const q = i + n0 * j + sl * k; if (!mask[q]) continue; count++; if (keep[q]) wideN++; if (k < c0) c0 = k; if (k > c1) c1 = k;
    for (let a = 0; a < 3; a++) { const x = O[a] + h * (i * u[a] + j * v[a] + k * w[a]); if (x < plo[a]) plo[a] = x; if (x > phi[a]) phi[a] = x; } }
  // its pieces (touching by a face, an edge or a corner)
  let pieces = 0; { const seenP = new Uint8Array(n); for (let q0 = 0; q0 < n; q0++) { if (!mask[q0] || seenP[q0]) continue; pieces++; seenP[q0] = 1; st.push(q0);
      while (st.length) { const q = st.pop(), i = q % n0, j = ((q / n0) | 0) % n1, k = (q / sl) | 0; for (let dc = -1; dc <= 1; dc++) { const kk = k + dc; if (kk < 0 || kk >= n2) continue; for (let db = -1; db <= 1; db++) { const jj = j + db; if (jj < 0 || jj >= n1) continue; for (let da = -1; da <= 1; da++) { const ii = i + da; if (ii < 0 || ii >= n0) continue; const r = ii + n0 * jj + sl * kk; if (mask[r] && !seenP[r]) { seenP[r] = 1; st.push(r); } } } } } } }
  // along the axis: how many canals lie side by side at each level, and the most that last for ¾ mm of the root
  const fromRoot = (k) => (fromTop ? k - rootEnd : rootEnd - k) * h, levels = [], seenS = new Uint8Array(sl), fat = new Uint8Array(sl);
  for (let k = c0; k <= c1; k++) { fat.fill(0); seenS.fill(0); let cnt = 0;
    for (let r = 0; r < sl; r++) if (mask[k * sl + r]) { const i = r % n0, j = (r / n0) | 0; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < n0 && jj < n1) fat[ii + n0 * jj] = 1; } }
    for (let r0 = 0; r0 < sl; r0++) { if (!fat[r0] || seenS[r0]) continue; cnt++; seenS[r0] = 1; st.push(r0); while (st.length) { const r = st.pop(), i = r % n0, j = (r / n0) | 0; if (i > 0 && fat[r - 1] && !seenS[r - 1]) { seenS[r - 1] = 1; st.push(r - 1); } if (i < n0 - 1 && fat[r + 1] && !seenS[r + 1]) { seenS[r + 1] = 1; st.push(r + 1); } if (j > 0 && fat[r - n0] && !seenS[r - n0]) { seenS[r - n0] = 1; st.push(r - n0); } if (j < n1 - 1 && fat[r + n0] && !seenS[r + n0]) { seenS[r + n0] = 1; st.push(r + n0); } } }
    levels.push({ t: fromRoot(k), count: cnt, root: !inCrown(k) }); }
  const runL = Math.max(2, Math.round(0.75 / h)); let canals = 1;
  for (let m = 2; m <= 6; m++) { let len = 0, ok = false; for (const L of levels) { len = L.root && L.count >= m ? len + 1 : 0; if (len >= runL) { ok = true; break; } } if (ok) canals = m; else break; }
  const apexEnd = fromTop ? c0 : c1, crownEnd = fromTop ? c1 : c0;
  // all of it, presumed stretches too: how far it reaches and its bounds
  let a0 = c0, a1 = c1; const alo = plo.slice(), ahi = phi.slice();
  for (let k = 0; k < n2; k++) for (let j = 0; j < n1; j++) for (let i = 0; i < n0; i++) { if (!maskP[i + n0 * j + sl * k]) continue; if (k < a0) a0 = k; if (k > a1) a1 = k; for (let a = 0; a < 3; a++) { const x = O[a] + h * (i * u[a] + j * v[a] + k * w[a]); if (x < alo[a]) alo[a] = x; if (x > ahi[a]) ahi[a] = x; } }
  const out = { ...base0, by: 'tooth', mask, maskP, wide: keep, paths, f, I, inT, grid, tW, count, volume: wideN * h * h * h + tubeVol, pieces, lo: plo, hi: phi, loAll: alo, hiAll: ahi, length: (c1 - c0 + 1) * h, apexGap: Math.max(0, fromRoot(apexEnd)), apexGapAll: Math.max(0, fromRoot(fromTop ? a0 : a1)), crownGap: Math.abs(crownTip - crownEnd) * h, canals, levels, faint, presumed, roots: tips.length, voxel: vox, noise: { level: mf, spread: sf, floor: delta }, fine: null };
  // has(x, y, z) → 0 (not canal), 1 (canal seen in the scan) or 2 (a presumed stretch). Once canalField has been worked out
  // for it (out.fine), the answer is read between the voxels — the hollow's own smooth edge, and a narrow canal wherever the
  // slice, one voxel thick, touches its tube; before that, by voxel.
  out.has = (x, y, z) => { const d = [x - O[0], y - O[1], z - O[2]], a = dot(d, u), b = dot(d, v), c = dot(d, w), F = out.fine;
    if (F) { const fx = (a - F.off[0]) / F.h, fy = (b - F.off[1]) / F.h, fz = (c - F.off[2]) / F.h, [m0, m1, m2] = F.n; if (fx < 0 || fy < 0 || fz < 0 || fx > m0 - 1 || fy > m1 - 1 || fz > m2 - 1) return 0;
      const i = Math.min(m0 - 2, fx | 0), j = Math.min(m1 - 2, fy | 0), k = Math.min(m2 - 2, fz | 0), tx = fx - i, ty = fy - j, tz = fz - k, q = i + m0 * (j + m1 * k), ms = m0 * m1;
      const tri = (G) => ((G[q] * (1 - tx) + G[q + 1] * tx) * (1 - ty) + (G[q + m0] * (1 - tx) + G[q + m0 + 1] * tx) * ty) * (1 - tz) + ((G[q + ms] * (1 - tx) + G[q + ms + 1] * tx) * (1 - ty) + (G[q + ms + m0] * (1 - tx) + G[q + ms + m0 + 1] * tx) * ty) * tz;
      if (tri(F.Fw) < 0) return 1; if (tri(F.Ft) >= F.margin) return 0; return F.cls[Math.round(fx) + m0 * (Math.round(fy) + m1 * Math.round(fz))] === 2 ? 2 : 1; }
    const i = Math.round(a / h), j = Math.round(b / h), k = Math.round(c / h); if (i < 0 || j < 0 || k < 0 || i >= n0 || j >= n1 || k >= n2) return 0; const q = i + n0 * j + sl * k; return mask[q] ? 1 : maskP[q] ? 2 : 0; };
  return out;
}
/**
 * canalField(cs, o) → { F, n, h, Fw, Ft, cls, part(which), any }: the canals as a field for N.isoMesh, on a grid three times
 * as fine as the canal grid (twice for a large tooth) and only as large as the canals: below 0 inside. A wide hollow's
 * surface lies where its dip is at the threshold (Fw); a narrow canal is a tube of its own width round its line (Ft: the
 * distance to the nearest tube's surface; cls: that tube's kind, 1 seen, 2 presumed). F is all of it; part('seen') and
 * part('presumed') are the two apart, for drawing them apart (any.presumed: whether there is a presumed stretch at all).
 * It also gives cs.has its fine answer (cs.fine; o.keep === false: not) — a narrow canal counts wherever a slice one voxel
 * thick touches its tube (o.margin, default half a voxel). (Coordinates: canalToPatient.)
 */
export function canalField(cs, o = {}) {
  const { grid, f, wide, mask, paths, tW } = cs, [n0, n1, n2] = grid.n, h = grid.h, sl = n0 * n1, n = mask.length, maskP = cs.maskP;
  let b0 = [n0, n1, n2], b1 = [-1, -1, -1]; for (let q = 0; q < n; q++) if (mask[q] || (maskP && maskP[q])) { const p = [q % n0, ((q / n0) | 0) % n1, (q / sl) | 0]; for (let a = 0; a < 3; a++) { if (p[a] < b0[a]) b0[a] = p[a]; if (p[a] > b1[a]) b1[a] = p[a]; } }
  for (let a = 0; a < 3; a++) { b0[a] = Math.max(0, b0[a] - 2); b1[a] = Math.min(grid.n[a] - 1, b1[a] + 2); }
  const cells = (b1[0] - b0[0]) * (b1[1] - b0[1]) * (b1[2] - b0[2]), sub = o.sub ?? (cells * 27 <= 12e6 ? 3 : cells * 8 <= 16e6 ? 2 : 1), hf = h / sub, m = [0, 1, 2].map((a) => (b1[a] - b0[a]) * sub + 1), N3 = m[0] * m[1] * m[2], Fw = new Float32Array(N3), Ft = new Float32Array(N3).fill(1e3), cls = new Uint8Array(N3);
  // the wide hollows: the dip, where it belongs to one of them or lies next to one (elsewhere none). The surface is drawn a
  // little outside where the dip is at the threshold: a voxel only counts as hollow once the hollow covers most of it
  const lev = tW - 0.06, fk = new Float32Array(n); for (let q = 0; q < n; q++) { if (!wide[q]) continue; const i = q % n0, j = ((q / n0) | 0) % n1, k = (q / sl) | 0; for (let dc = -1; dc <= 1; dc++) { const kk = k + dc; if (kk < 0 || kk >= n2) continue; for (let db = -1; db <= 1; db++) { const jj = j + db; if (jj < 0 || jj >= n1) continue; for (let da = -1; da <= 1; da++) { const ii = i + da; if (ii < 0 || ii >= n0) continue; const r = ii + n0 * jj + sl * kk; fk[r] = wide[r] ? Math.max(f[r], tW + 0.02) : Math.min(f[r], lev - 0.02); } } } }
  for (let c = 0; c < m[2]; c++) { const zc = b0[2] + c / sub, k = Math.min(n2 - 2, Math.floor(zc)), tz = zc - k; for (let b = 0; b < m[1]; b++) { const yc = b0[1] + b / sub, j = Math.min(n1 - 2, Math.floor(yc)), ty = yc - j; for (let a = 0; a < m[0]; a++) {
    const xc = b0[0] + a / sub, i = Math.min(n0 - 2, Math.floor(xc)), tx = xc - i, q = i + n0 * j + sl * k;
    const fv = ((fk[q] * (1 - tx) + fk[q + 1] * tx) * (1 - ty) + (fk[q + n0] * (1 - tx) + fk[q + n0 + 1] * tx) * ty) * (1 - tz) + ((fk[q + sl] * (1 - tx) + fk[q + sl + 1] * tx) * (1 - ty) + (fk[q + sl + n0] * (1 - tx) + fk[q + sl + n0 + 1] * tx) * ty) * tz;
    Fw[a + m[0] * (b + m[1] * c)] = 0.75 * (lev - fv); } } }   // (¾ mm: about the width over which a blurred edge falls)
  // the narrow canals: tubes round their lines (each grid point keeps its nearest tube's kind: seen 1, presumed 2)
  const reach = Math.max(2 * hf, o.reach ?? 0.75 * (cs.voxel || h));
  for (const P of paths) for (let s = 0; s < P.q.length; s++) { const e = Math.min(P.q.length - 1, s + 1), ra = P.r[s], rb = P.r[e], kind = P.pres && P.pres[s] && P.pres[e] ? 2 : 1;
    const pa = [(P.ij[2 * s] - b0[0]) * h, (P.ij[2 * s + 1] - b0[1]) * h, (P.k[s] - b0[2]) * h], pb = [(P.ij[2 * e] - b0[0]) * h, (P.ij[2 * e + 1] - b0[1]) * h, (P.k[e] - b0[2]) * h], ab = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], L2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2], rr = Math.max(ra, rb) + reach;
    const lo3 = [0, 1, 2].map((a) => Math.max(0, Math.floor((Math.min(pa[a], pb[a]) - rr) / hf))), hi3 = [0, 1, 2].map((a) => Math.min(m[a] - 1, Math.ceil((Math.max(pa[a], pb[a]) + rr) / hf)));
    for (let c = lo3[2]; c <= hi3[2]; c++) for (let b = lo3[1]; b <= hi3[1]; b++) for (let a = lo3[0]; a <= hi3[0]; a++) { const x = a * hf - pa[0], y = b * hf - pa[1], z = c * hf - pa[2], t = L2 > 0 ? Math.max(0, Math.min(1, (x * ab[0] + y * ab[1] + z * ab[2]) / L2)) : 0, d = Math.hypot(x - t * ab[0], y - t * ab[1], z - t * ab[2]) - (ra + t * (rb - ra)), g = a + m[0] * (b + m[1] * c); if (d < Ft[g] - (kind === 2 && cls[g] === 1 ? 0.05 : 0)) { Ft[g] = d; cls[g] = kind; } } }
  grid.off = [b0[0] * h, b0[1] * h, b0[2] * h];
  // all of it (F), and its two parts for drawing apart: what the scan shows, and the presumed stretches
  const F = new Float32Array(N3); for (let g = 0; g < N3; g++) F[g] = Math.min(Fw[g], Ft[g]);
  const part = (which) => { const G = new Float32Array(N3); if (which === 'presumed') for (let g = 0; g < N3; g++) G[g] = cls[g] === 2 ? Ft[g] : 1e3; else for (let g = 0; g < N3; g++) G[g] = Math.min(Fw[g], cls[g] === 2 ? 1e3 : Ft[g]); return G; };
  if (o.keep !== false) cs.fine = { Fw, Ft, cls, n: m, h: hf, off: grid.off, margin: o.margin ?? 0.5 * (cs.voxel || h) };
  return { F, n: m, h: hf, Fw, Ft, cls, part, any: { presumed: cls.includes(2) } };
}
/** a canal mesh from N.isoMesh(canalField(cs)…) (millimetres in the canal grid's own frame) → the patient's coordinates */
export function canalToPatient(mesh, cs) {
  const { O, u, v, w } = cs.grid, off = cs.grid.off || [0, 0, 0], P = mesh.positions;
  for (let q = 0; q < P.length; q += 3) { const a = P[q] + off[0], b = P[q + 1] + off[1], c = P[q + 2] + off[2]; P[q] = O[0] + a * u[0] + b * v[0] + c * w[0]; P[q + 1] = O[1] + a * u[1] + b * v[1] + c * w[1]; P[q + 2] = O[2] + a * u[2] + b * v[2] + c * w[2]; }
  return mesh;
}
/** vertex normals of a closed mesh (area-weighted, outwards for an outward-facing mesh) */
export function vertexNormalsOf(mesh) {
  const P = mesh.positions, I = mesh.indices, N = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) { const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2], ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2], nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; for (const v of [a, b, c]) { N[v] += nx; N[v + 1] += ny; N[v + 2] += nz; } }
  for (let v = 0; v < N.length; v += 3) { const l = Math.hypot(N[v], N[v + 1], N[v + 2]) || 1; N[v] /= l; N[v + 1] /= l; N[v + 2] /= l; }
  return N;
}
/** Taubin smoothing in place (λ|μ): smooths the steps a voxel grid leaves without shrinking the shape */
export function taubin(mesh, iters = 6, lambda = 0.5, mu = -0.53) {
  const P = mesh.positions, I = mesh.indices, nV = P.length / 3, deg = new Uint32Array(nV + 1);
  for (let t = 0; t < I.length; t++) deg[I[t] + 1] += 2; for (let v = 0; v < nV; v++) deg[v + 1] += deg[v];
  const fill = deg.slice(0, nV), adj = new Uint32Array(deg[nV]); for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const a = I[t + e], b = I[t + (e + 1) % 3]; adj[fill[a]++] = b; adj[fill[b]++] = a; }
  const tmp = new Float32Array(P.length);
  for (let it = 0; it < 2 * iters; it++) {
    const f = it % 2 ? mu : lambda;
    for (let v = 0; v < nV; v++) { let x = 0, y = 0, z = 0; const s = deg[v], e = deg[v + 1]; for (let q = s; q < e; q++) { const u = 3 * adj[q]; x += P[u]; y += P[u + 1]; z += P[u + 2]; } const c = e - s || 1; tmp[3 * v] = P[3 * v] + f * (x / c - P[3 * v]); tmp[3 * v + 1] = P[3 * v + 1] + f * (y / c - P[3 * v + 1]); tmp[3 * v + 2] = P[3 * v + 2] + f * (z / c - P[3 * v + 2]); }
    P.set(tmp);
  }
  return mesh;
}
/** move every vertex out along its normal by dist mm (a uniform enlargement for small dist on a smooth closed mesh) */
export function offsetMesh(mesh, dist) { if (!dist) return mesh; const N = vertexNormalsOf(mesh), P = mesh.positions; for (let v = 0; v < P.length; v++) P[v] += N[v] * dist; return mesh; }

// ───────────────────────────── the trained tooth model ─────────────────────────────
// The CBCT tab can outline the tapped tooth with a neural network in place of the rules of trackTooth: the "instance" network
// of ToothSeg (Isensee, van Nistelrooij, Krämer, Vinayahalingam and others, 2025; weights CC BY 4.0), trained on the ToothFairy2
// scans to mark every voxel of a 0.2 mm grid as background, the middle of a tooth ("centre") or its 0.6 mm rim ("border").
// The network itself runs elsewhere (a worker with ONNX Runtime: see toothseg/ beside the CBCT page). What is here is
// everything round it, as plain code the tests can check: the cube of scan handed to it (modelFrame, modelCube), the teeth made
// from its answer (modelTeeth), the tapped one of them parted from a tooth it is joined to (modelTooth), and the tooth result,
// as from segmentTooth, made from that (toothFromMask) — so the replica and the canal finder work from it unchanged.
export const TOOTH_MODEL = { h: 0.2, lo: -58.305023384094184, hi: 4021, mean: 1907.0513121865397, std: 670.6687916924831, soft: 40, dentine: 1750,
  credit: 'ToothSeg (Isensee, van Nistelrooij, Krämer, Vinayahalingam and others; weights CC BY 4.0), trained on the ToothFairy2 scans (CC BY-SA)' };

/**
 * flipStack(vol) → the same scan with its slices in the opposite order, turned over in place (no copy of the voxels). For a
 * scan whose files did not say which way up it is (vol.guessed) and was stacked the wrong way.
 */
export function flipStack(vol) {
  const [nx, ny, nz] = vol.dims, sl = nx * ny, d = vol.data, tmp = new Int16Array(sl);
  for (let k = 0; k < nz >> 1; k++) { const a = k * sl, b = (nz - 1 - k) * sl; tmp.set(d.subarray(a, a + sl)); d.copyWithin(a, b, b + sl); d.set(tmp, b); }
  return { ...vol, flipped: !vol.flipped };
}

/**
 * modelMap(vol, levels, P) → [gain, offset] | null: how the scan's values (data + shift) are put on the CT-like scale the
 * network was trained on, v·gain + offset. null (as they are) when the tooth's own levels — levels: { dentine, soft } in
 * data units, from segmentTooth — are where a CT has them; otherwise soft tissue is sent to 40 and dentine to 1750. With no
 * levels, a scan that is not CT-like at all (P = windowPresets(vol)) is stretched as its window presets are.
 */
export function modelMap(vol, levels = null, P = null) {
  const M = TOOTH_MODEL, sh = vol.shift || 0;
  if (levels && levels.dentine > levels.soft + 100) {
    const dn = levels.dentine + sh, so = levels.soft + sh; if (dn >= 900 && dn <= 2600 && so >= -300 && so <= 400) return null;
    const g = (M.dentine - M.soft) / (dn - so); return [g, M.soft - g * so];
  }
  P = P || windowPresets(vol); if (P.hu) return null;
  // (windowPresets: value = a + (HU-like + 1000)·k, soft at 40 and the bone window's level at 700)
  const k = (P.bone.l - P.soft.l) / 660; if (!(k > 0)) return null; return [1 / k, 40 - (P.soft.l + sh) / k];
}

/**
 * modelFrame(vol, seed, rules) → { centre, n }: the cube of scan handed to the network for the tooth tapped at seed (patient
 * mm). With the tooth the rules found (rules: segmentTooth's result) it is centred on that and reaches 4½ mm past it all
 * round, so that a root the rules cut short is still inside; without, it is 25.6 × 25.6 × 32 mm round the tap. n = [n0, n1, n2]
 * voxels of 0.2 mm, in sizes the network takes (multiples of 32 across the slices, of 16 along them), about 2.9 million voxels
 * at most; the tap is kept at least 3 mm inside.
 */
export function modelFrame(vol, seed, rules = null, o = {}) {
  const h = TOOTH_MODEL.h, ok = !!(rules && !rules.error && rules.lo && rules.hi), pad = o.pad ?? 4.5;
  const ext = ok ? [0, 1, 2].map((a) => rules.hi[a] - rules.lo[a]) : [25.6 - 2 * pad, 25.6 - 2 * pad, 32 - 2 * pad];
  const centre = ok ? [0, 1, 2].map((a) => (rules.lo[a] + rules.hi[a]) / 2) : seed.slice(0, 3);
  const n = [0, 1, 2].map((a) => { const m = a === 2 ? 16 : 32; return Math.max(96, Math.min(a === 2 ? 176 : 160, Math.ceil((ext[a] + 2 * pad) / h / m - 1e-6) * m)); });
  while (n[0] * n[1] * n[2] > 2.9e6) { const a = n[2] > 128 ? 2 : n[0] >= n[1] ? 0 : 1; n[a] -= a === 2 ? 16 : 32; }
  for (let a = 0; a < 3; a++) { const half = Math.max(0, (n[a] - 1) / 2 * h - 3); centre[a] = Math.max(seed[a] - half, Math.min(seed[a] + half, centre[a])); }
  return { centre, n };
}

/**
 * modelCube(vol, centre, n, map) → { x: Float32Array (n0·n1·n2, x fastest), n, o, h }: the scan round centre on the network's
 * own 0.2 mm grid, o the patient position of its first voxel. The cube is first moved onto a voxel of the scan, so a 0.2 mm
 * scan is copied as it is rather than blurred; any other is read between its voxels (trilinear; past the scan's edge the edge
 * is repeated). The values (data + shift, then map = [gain, offset] if given) are put on the network's scale: clipped to its
 * range, less its mean, over its spread.
 */
export function modelCube(vol, centre, n, map = null) {
  const M = TOOTH_MODEL, h = M.h, dims = vol.dims, sp = vol.spacing, org = vol.origin, d = vol.data, sh = vol.shift || 0, NX = dims[0], NY = dims[1];
  const o = [0, 1, 2].map((a) => org[a] + Math.round((centre[a] - (n[a] - 1) / 2 * h - org[a]) / sp[a]) * sp[a]);
  const axis = (a) => { const N = dims[a], i0 = new Int32Array(n[a]), i1 = new Int32Array(n[a]), w = new Float32Array(n[a]);
    for (let q = 0; q < n[a]; q++) { const f = Math.max(0, Math.min(N - 1, (o[a] + q * h - org[a]) / sp[a])), i = Math.min(N - 1, Math.floor(f + 1e-9)); i0[q] = i; i1[q] = Math.min(N - 1, i + 1); const t = f - i; w[q] = t < 1e-6 ? 0 : t; } return [i0, i1, w]; };
  const [xa, xb, xw] = axis(0), [ya, yb, yw] = axis(1), [za, zb, zw] = axis(2), x = new Float32Array(n[0] * n[1] * n[2]), g = map ? map[0] : 1, b = (map ? map[1] : 0) + g * sh; let q = 0;
  for (let k = 0; k < n[2]; k++) { const k0 = za[k] * NX * NY, k1 = zb[k] * NX * NY, tz = zw[k];
    for (let j = 0; j < n[1]; j++) { const r00 = k0 + ya[j] * NX, r01 = k0 + yb[j] * NX, r10 = k1 + ya[j] * NX, r11 = k1 + yb[j] * NX, ty = yw[j];
      for (let i = 0; i < n[0]; i++, q++) { const a0 = xa[i], a1 = xb[i], tx = xw[i];
        let v = tx || ty || tz ? ((d[r00 + a0] * (1 - tx) + d[r00 + a1] * tx) * (1 - ty) + (d[r01 + a0] * (1 - tx) + d[r01 + a1] * tx) * ty) * (1 - tz) + ((d[r10 + a0] * (1 - tx) + d[r10 + a1] * tx) * (1 - ty) + (d[r11 + a0] * (1 - tx) + d[r11 + a1] * tx) * ty) * tz : d[r00 + a0];
        v = v * g + b; x[q] = ((v < M.lo ? M.lo : v > M.hi ? M.hi : v) - M.mean) / M.std; } } }
  return { x, n: n.slice(), o, h };
}

/** the six neighbours of voxel q of an n0 × n1 × n2 grid (x fastest) that lie inside it, written into out → how many */
function six(q, n0, n1, n2, out) {
  const sl = n0 * n1, i = q % n0, j = ((q / n0) | 0) % n1, k = (q / sl) | 0; let c = 0;
  if (i > 0) out[c++] = q - 1; if (i < n0 - 1) out[c++] = q + 1; if (j > 0) out[c++] = q - n0; if (j < n1 - 1) out[c++] = q + n0; if (k > 0) out[c++] = q - sl; if (k < n2 - 1) out[c++] = q + sl;
  return c;
}
/** joined-up blocks (faces touching) of the voxels where is(q), numbered from 1 in the order they are met → { ids, sizes } */
function blocks6(n, is) {
  const [n0, n1, n2] = n, N = n0 * n1 * n2, ids = new Uint16Array(N), st = new Int32Array(N), nb = new Int32Array(6), sizes = [0];
  for (let q0 = 0; q0 < N; q0++) { if (ids[q0] || !is(q0) || sizes.length > 65000) continue; const L = sizes.length; let c = 0, top = 0; st[top++] = q0; ids[q0] = L;
    while (top) { const q = st[--top]; c++; const m = six(q, n0, n1, n2, nb); for (let t = 0; t < m; t++) { const u = nb[t]; if (!ids[u] && is(u)) { ids[u] = L; st[top++] = u; } } }
    sizes.push(c); }
  return { ids, sizes };
}
/** numbered voxels spread, a layer of one voxel at a time (at most `layers`), into the voxels where may(q) that have no number
 *  yet; a voxel reached by two numbers in the same layer takes the higher */
function spread6(ids, n, may, layers = Infinity) {
  const [n0, n1, n2] = n, N = n0 * n1 * n2, nb = new Int32Array(6), mark = new Uint8Array(N); let cur = []; for (let q = 0; q < N; q++) if (ids[q]) cur.push(q);
  for (let layer = 0; layer < layers && cur.length; layer++) {
    const cand = []; for (const q of cur) { const m = six(q, n0, n1, n2, nb); for (let t = 0; t < m; t++) { const u = nb[t]; if (!ids[u] && !mark[u] && may(u)) { mark[u] = 1; cand.push(u); } } }
    const val = new Uint16Array(cand.length); for (let c = 0; c < cand.length; c++) { const m = six(cand[c], n0, n1, n2, nb); let best = 0; for (let t = 0; t < m; t++) if (ids[nb[t]] > best) best = ids[nb[t]]; val[c] = best; }
    for (let c = 0; c < cand.length; c++) ids[cand[c]] = val[c];
    cur = cand;
  }
  return ids;
}

/**
 * modelTeeth(lab, n) → { ids: Uint16Array (0 none, 1… a tooth), count }: the network's answer (per voxel 0 background,
 * 1 centre, 2 border) as teeth. Every joined-up block of centre voxels of 4 mm³ or more is a tooth; each is grown outwards a
 * voxel at a time (ten at most) into the border voxels, which go to the tooth that reaches them first.
 */
export function modelTeeth(lab, n, o = {}) {
  const h = TOOTH_MODEL.h, { ids, sizes } = blocks6(n, (q) => lab[q] === 1), min = (o.minCore ?? 4) / (h * h * h), re = new Uint16Array(sizes.length); let count = 0;
  for (let L = 1; L < sizes.length; L++) if (sizes[L] >= min) re[L] = ++count;
  for (let q = 0; q < ids.length; q++) if (ids[q]) ids[q] = re[ids[q]];
  spread6(ids, n, (q) => lab[q] === 2, o.layers ?? 10);
  return { ids, count };
}

/**
 * modelTooth(ids, n, o, seed) → { mask: Uint8Array, id, parted, touches } | { error }: the tooth of modelTeeth at the tap (seed,
 * patient mm; o the cube's first voxel) — the one the tap is in, else the nearest within 1½ mm.
 * Where two teeth touch (an upper and a lower tooth biting together) the network may give them one number. Such a tooth is
 * parted at the narrow bridge: it is shrunk by 0.6, 1.0, 1.4 and then 1.8 mm (city-block) until it falls into two or more
 * sizeable pieces (each 15% of what is left and 30 mm³), every voxel then goes to the piece that reaches it first, and the
 * piece at the tap is kept. parted: the sizes of the shrunken pieces (mm³), or null.
 * touches: for each axis, whether the tooth reaches the cube's first and last layer of voxels (the cube was too small or off-centre).
 */
export function modelTooth(ids, n, o, seed) {
  const [n0, n1, n2] = n, sl = n0 * n1, N = sl * n2, h = TOOTH_MODEL.h, q = [0, 1, 2].map((a) => Math.round((seed[a] - o[a]) / h));
  if (q.some((v, a) => !(v >= 0 && v < n[a]))) return { error: 'The tap lies outside the part of the scan the model was given.' };
  const sq = q[0] + n0 * (q[1] + n1 * q[2]); let id = ids[sq];
  if (!id) { const R = Math.round(1.5 / h); let bd = R * R + 1;
    for (let k = Math.max(0, q[2] - R); k <= Math.min(n2 - 1, q[2] + R); k++) for (let j = Math.max(0, q[1] - R); j <= Math.min(n1 - 1, q[1] + R); j++) for (let i = Math.max(0, q[0] - R); i <= Math.min(n0 - 1, q[0] + R); i++) {
      const u = i + n0 * (j + n1 * k); if (!ids[u]) continue; const dd = (i - q[0]) ** 2 + (j - q[1]) ** 2 + (k - q[2]) ** 2; if (dd < bd) { bd = dd; id = ids[u]; } } }
  if (!id) return { error: 'The model found no tooth where you tapped: tap the middle of the crown.' };
  let mask = new Uint8Array(N); for (let u = 0; u < N; u++) if (ids[u] === id) mask[u] = 1;
  // how deep each voxel lies inside the tooth (city-block, in voxels, counted to 10; 255 = deeper still)
  const depth = new Uint8Array(N), nb = new Int32Array(6); let cur = [];
  for (let u = 0; u < N; u++) { if (!mask[u]) continue; const m = six(u, n0, n1, n2, nb); let edge = m < 6; for (let t = 0; t < m && !edge; t++) if (!mask[nb[t]]) edge = true; if (edge) { depth[u] = 1; cur.push(u); } }
  for (let dp = 2; dp <= 10 && cur.length; dp++) { const next = []; for (const u of cur) { const m = six(u, n0, n1, n2, nb); for (let t = 0; t < m; t++) { const w = nb[t]; if (mask[w] && !depth[w]) { depth[w] = dp; next.push(w); } } } cur = next; }
  for (let u = 0; u < N; u++) if (mask[u] && !depth[u]) depth[u] = 255;
  let parted = null; const vv = h * h * h;
  for (const K of [3, 5, 7, 9]) {
    const { ids: cl, sizes } = blocks6(n, (u) => depth[u] > K); if (sizes.length < 3) continue;
    let tot = 0; for (let L = 1; L < sizes.length; L++) tot += sizes[L];
    const big = []; for (let L = 1; L < sizes.length; L++) if (sizes[L] >= 0.15 * tot && sizes[L] * vv >= 30) big.push(L);
    if (big.length < 2) continue;
    const keep = new Uint8Array(sizes.length); for (const L of big) keep[L] = 1; for (let u = 0; u < N; u++) if (cl[u] && !keep[cl[u]]) cl[u] = 0;
    spread6(cl, n, (u) => mask[u] === 1);
    let piece = mask[sq] ? cl[sq] : 0;
    if (!piece) { let bd = Infinity; for (let u = 0; u < N; u++) { if (!cl[u]) continue; const i = u % n0, j = ((u / n0) | 0) % n1, k = (u / sl) | 0, dd = (i - q[0]) ** 2 + (j - q[1]) ** 2 + (k - q[2]) ** 2; if (dd < bd) { bd = dd; piece = cl[u]; } } }
    const m2 = new Uint8Array(N); for (let u = 0; u < N; u++) if (cl[u] === piece) m2[u] = 1; mask = m2;
    parted = { at: K * h, sizes: big.map((L) => Math.round(sizes[L] * vv)) }; break;
  }
  const touches = [[false, false], [false, false], [false, false]];
  for (let u = 0; u < N; u++) { if (!mask[u]) continue; const i = u % n0, j = ((u / n0) | 0) % n1, k = (u / sl) | 0;
    if (i === 0) touches[0][0] = true; if (i === n0 - 1) touches[0][1] = true; if (j === 0) touches[1][0] = true; if (j === n1 - 1) touches[1][1] = true; if (k === 0) touches[2][0] = true; if (k === n2 - 1) touches[2][1] = true; }
  return { mask, id, parted, touches };
}

/**
 * toothFromMask(vol, cube, mask, o) → the tooth result, as segmentTooth gives it (with model: true), for a tooth outlined on
 * another grid: cube { n, o, h } and mask (Uint8Array on it, x fastest), as from modelTooth.
 * Each voxel of the scan takes the cube voxel nearest to it. o.seeds: the taps (the piece the first is on is kept, or the
 * largest); o.erase: balls { p, r } cut away, as for segmentTooth; o.not: "not tooth" points, cut away as balls of o.notR
 * (1 mm); o.rules: segmentTooth's own result for the same tap, whose grey levels are kept (otherwise dentine is the tooth's
 * median grey and soft tissue o.soft or the scan's soft-tissue window). Pulp spaces are filled.
 * The threshold T — which sets where the replica's surface sits between a tooth voxel and a darker one beside it — is the grey
 * half way across the outline that was given (the median over its faces), kept between 30% and 80% of the way from soft tissue
 * to dentine: the network chooses which edge is the tooth's, the scan's own grey places it.
 */
export function toothFromMask(vol, cube, mask, o = {}) {
  const [n0, n1, n2] = cube.n, h = cube.h || TOOTH_MODEL.h, co = cube.o, [NX, NY, NZ] = vol.dims, [sx, sy, sz] = vol.spacing, org = vol.origin, d = vol.data;
  let a0 = n0, a1 = -1, b0 = n1, b1 = -1, c0 = n2, c1 = -1;
  for (let k = 0, u = 0; k < n2; k++) for (let j = 0; j < n1; j++) for (let i = 0; i < n0; i++, u++) if (mask[u]) { if (i < a0) a0 = i; if (i > a1) a1 = i; if (j < b0) b0 = j; if (j > b1) b1 = j; if (k < c0) c0 = k; if (k > c1) c1 = k; }
  if (a1 < 0) return { error: 'The model found no tooth where you tapped: tap the middle of the crown.' };
  const lim = (v, N) => Math.max(0, Math.min(N - 1, v));
  const i0 = lim(Math.floor((co[0] + a0 * h - org[0]) / sx) - 2, NX), i1 = lim(Math.ceil((co[0] + a1 * h - org[0]) / sx) + 2, NX), j0 = lim(Math.floor((co[1] + b0 * h - org[1]) / sy) - 2, NY), j1 = lim(Math.ceil((co[1] + b1 * h - org[1]) / sy) + 2, NY);
  const k0 = lim(Math.floor((co[2] + c0 * h - org[2]) / sz) - 2, NZ), k1 = lim(Math.ceil((co[2] + c1 * h - org[2]) / sz) + 2, NZ), nx = i1 - i0 + 1, ny = j1 - j0 + 1, nz = k1 - k0 + 1, n = nx * ny * nz;
  if (nx < 3 || ny < 3 || nz < 3) return { error: 'The model found no tooth where you tapped: tap the middle of the crown.' };
  const box = { i0, j0, k0, nx, ny, nz }, I = new Int16Array(n), lab = new Uint8Array(n);
  const near = (m, a, from, sp, lenC) => { const out = new Int32Array(m); for (let t = 0; t < m; t++) { const c = Math.floor((org[a] + (from + t) * sp - co[a]) / h + 0.5); out[t] = c >= 0 && c < lenC ? c : -1; } return out; };
  const cx = near(nx, 0, i0, sx, n0), cy = near(ny, 1, j0, sy, n1), cz = near(nz, 2, k0, sz, n2);
  for (let k = 0, q = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++, q++) { I[q] = d[(i0 + i) + NX * ((j0 + j) + NY * (k0 + k))]; if (cx[i] >= 0 && cy[j] >= 0 && cz[k] >= 0 && mask[cx[i] + n0 * (cy[j] + n1 * cz[k])]) lab[q] = 1; }
  // what was cut away by hand
  const balls = (o.erase || []).concat((o.not || []).map((p) => ({ p, r: o.notR ?? 1 }))), bi = (x, a) => Math.floor((x - org[a]) / vol.spacing[a]);
  for (const e of balls) { const r = e.r, p0 = Math.max(0, bi(e.p[0] - r, 0) - i0), p1 = Math.min(nx - 1, bi(e.p[0] + r, 0) + 1 - i0), q0 = Math.max(0, bi(e.p[1] - r, 1) - j0), q1 = Math.min(ny - 1, bi(e.p[1] + r, 1) + 1 - j0), r0 = Math.max(0, bi(e.p[2] - r, 2) - k0), r1 = Math.min(nz - 1, bi(e.p[2] + r, 2) + 1 - k0);
    for (let k = r0; k <= r1; k++) for (let j = q0; j <= q1; j++) for (let i = p0; i <= p1; i++) { const x = org[0] + (i0 + i) * sx - e.p[0], y = org[1] + (j0 + j) * sy - e.p[1], z = org[2] + (k0 + k) * sz - e.p[2]; if (x * x + y * y + z * z <= r * r) lab[i + nx * (j + ny * k)] = 0; } }
  // the piece the first tap is on (or the largest), then the pulp filled
  { const id = new Int32Array(n), st = new Int32Array(n), sizes = [0]; let want = 0;
    for (let q0 = 0; q0 < n; q0++) { if (!lab[q0] || id[q0]) continue; const L = sizes.length; let c = 0, top = 0; id[q0] = L; st[top++] = q0;
      while (top) { const q = st[--top], i = q % nx, j = ((q / nx) | 0) % ny, k = (q / (nx * ny)) | 0; c++;
        for (let cc = -1; cc <= 1; cc++) { const kk = k + cc; if (kk < 0 || kk >= nz) continue; for (let b = -1; b <= 1; b++) { const jj = j + b; if (jj < 0 || jj >= ny) continue; for (let a = -1; a <= 1; a++) { const ii = i + a; if (ii < 0 || ii >= nx) continue; const u = ii + nx * (jj + ny * kk); if (lab[u] && !id[u]) { id[u] = L; st[top++] = u; } } } } }
      sizes.push(c); }
    const s = o.seeds && o.seeds[0]; if (s) { const si = Math.round((s[0] - org[0]) / sx) - i0, sj = Math.round((s[1] - org[1]) / sy) - j0, sk = Math.round((s[2] - org[2]) / sz) - k0; if (si >= 0 && sj >= 0 && sk >= 0 && si < nx && sj < ny && sk < nz) want = id[si + nx * (sj + ny * sk)]; }
    if (!want) for (let L = 1; L < sizes.length; L++) if (!want || sizes[L] > sizes[want]) want = L;
    for (let q = 0; q < n; q++) if (lab[q] && id[q] !== want) lab[q] = 0; }
  { const cav = cavities(lab, null, nx, ny, nz); for (let q = 0; q < n; q++) if (cav[q]) lab[q] = 1; }
  // size, extent and long axis, as in segmentTooth
  let count = 0; const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], m1 = [0, 0, 0], m2 = [0, 0, 0, 0, 0, 0];
  for (let k = 0, q = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++, q++) { if (!lab[q]) continue; count++;
    const x = org[0] + (i0 + i) * sx, y = org[1] + (j0 + j) * sy, z = org[2] + (k0 + k) * sz; if (x < lo[0]) lo[0] = x; if (y < lo[1]) lo[1] = y; if (z < lo[2]) lo[2] = z; if (x > hi[0]) hi[0] = x; if (y > hi[1]) hi[1] = y; if (z > hi[2]) hi[2] = z;
    m1[0] += x; m1[1] += y; m1[2] += z; m2[0] += x * x; m2[1] += y * y; m2[2] += z * z; m2[3] += x * y; m2[4] += x * z; m2[5] += y * z; }
  if (!count) return { error: 'Nothing is left of the tooth: undo the last cut.' };
  const c = m1.map((v) => v / count), Cv = [[m2[0] / count - c[0] * c[0], m2[3] / count - c[0] * c[1], m2[4] / count - c[0] * c[2]], [0, m2[1] / count - c[1] * c[1], m2[5] / count - c[1] * c[2]], [0, 0, m2[2] / count - c[2] * c[2]]]; Cv[1][0] = Cv[0][1]; Cv[2][0] = Cv[0][2]; Cv[2][1] = Cv[1][2];
  let ax = [0, 0, 1]; for (let it = 0; it < 60; it++) { const v = [0, 1, 2].map((r) => Cv[r][0] * ax[0] + Cv[r][1] * ax[1] + Cv[r][2] * ax[2]), l = Math.hypot(...v) || 1; ax = v.map((x) => x / l); }
  if (ax[2] < 0) ax = ax.map((x) => -x);
  let tmin = Infinity, tmax = -Infinity; const tq = new Float32Array(2 * count), vals = new Int16Array(count); let w = 0;
  for (let k = 0, q = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++, q++) { if (!lab[q]) continue; const t = (org[0] + (i0 + i) * sx - c[0]) * ax[0] + (org[1] + (j0 + j) * sy - c[1]) * ax[1] + (org[2] + (k0 + k) * sz - c[2]) * ax[2]; tq[2 * w] = t; tq[2 * w + 1] = I[q]; vals[w++] = I[q]; if (t < tmin) tmin = t; if (t > tmax) tmax = t; }
  // the crown is the end with the brighter material (enamel)
  let up = 0, nu = 0, dn = 0, nd = 0; const qt = (tmax - tmin) / 4; for (let a = 0; a < tq.length; a += 2) { if (tq[a] > tmax - qt) { up += tq[a + 1]; nu++; } else if (tq[a] < tmin + qt) { dn += tq[a + 1]; nd++; } }
  const crown = (nu ? up / nu : 0) >= (nd ? dn / nd : 0) ? 1 : -1;
  // grey levels: the tooth's own. Its voxels fall into two classes where there is enamel — dentine (the middle of the darker
  // class) and enamel (of the brighter); with no second class to speak of, dentine is the tooth's median grey. (Not the
  // rules' levels for the same tap: they are read in the one slice the rules start from, and differ from tap to tap — and with
  // them what the canal finder made of the same tooth. Only soft tissue, read just outside the tooth, is taken from them.)
  const R = o.rules && !o.rules.error && o.rules.levels ? o.rules : null; vals.sort();
  const soft = R ? R.levels.soft : (o.soft ?? windowPresets(vol).soft.l), stp = 1 + ((count / 60000) | 0), smp = []; for (let a = 0; a < count; a += stp) smp.push(vals[a]);
  const two = o.ownLevels === false ? null : twoLevels(smp), split = !!two && two.share > 0.03 && two.share < 0.6 && two.hi - two.lo > 0.3 * Math.max(1, two.lo - soft);
  const dentine = o.ownLevels === false && R ? R.levels.dentine : split ? two.lo : vals[count >> 1];
  const levels = o.ownLevels === false && R ? { ...R.levels } : { dentine, enamel: split ? two.hi : null, contrast: dentine - soft, soft }, ref = o.ownLevels === false && R && R.ref != null ? R.ref : dentine;
  // the grey half way across the outline: over the faces between a tooth voxel and a darker voxel beside it that is not
  const mids = [], steps = [1, -1, nx, -nx, nx * ny, -nx * ny];
  for (let k = 1, sl = nx * ny; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) { const q = i + nx * (j + ny * k); if (!lab[q]) continue; for (let t = 0; t < 6; t++) { const u = q + steps[t]; if (!lab[u] && I[u] < I[q]) mids.push((I[q] + I[u]) / 2); } }
  mids.sort((a, b) => a - b); const C = Math.max(1, dentine - soft);
  const T = Math.round(mids.length ? Math.max(soft + 0.3 * C, Math.min(soft + 0.8 * C, mids[mids.length >> 1])) : (R ? R.T : soft + 0.55 * C)), dI = Math.max(50, ref - T);
  // the middle of the crown: of the fifth of the tooth nearest its crown end
  const top = [0, 0, 0]; { let nT = 0; const cut = crown > 0 ? tmax - (tmax - tmin) / 5 : tmin + (tmax - tmin) / 5;
    for (let k = 0, q = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++, q++) { if (!lab[q]) continue; const x = org[0] + (i0 + i) * sx, y = org[1] + (j0 + j) * sy, z = org[2] + (k0 + k) * sz, t = (x - c[0]) * ax[0] + (y - c[1]) * ax[1] + (z - c[2]) * ax[2]; if (crown > 0 ? t >= cut : t <= cut) { top[0] += x; top[1] += y; top[2] += z; nT++; } }
    for (let a = 0; a < 3; a++) top[a] = nT ? top[a] / nT : c[a]; }
  return { lab, box, count, volume: count * sx * sy * sz, lo, hi, touch: 0, near: 0, T, dI, ref, seedOk: true, axis: ax, centre: c, crown, length: tmax - tmin, ends: [tmin, tmax], top, vol, levels, model: true };
}
