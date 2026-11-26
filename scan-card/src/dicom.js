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
//                      JPEG baseline 8-bit (through the browser's own decoder).
//   not yet            JPEG 2000, JPEG-LS, 12-bit lossy JPEG — these are named clearly so the user can export again.
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
  if (info.codec === 'jpeg' && h.bitsAllocated !== 8) return 'it is compressed with 12-bit lossy JPEG, which this viewer cannot read yet';
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
 */
export async function loadVolume(series, onProgress) {
  if (series.reason) throw new Error('This series cannot be opened: ' + series.reason + '. Export it from the CBCT software as uncompressed DICOM and try again.');
  const h0 = series.items[0].h, nx = series.cols, ny = series.rows, warnings = [];
  const iop = okVec(h0.iop, 6) ? h0.iop : (h0.shared && h0.shared[0] && h0.shared[0].planeOrientation && okVec(h0.shared[0].planeOrientation[0].iop, 6) ? h0.shared[0].planeOrientation[0].iop : null);
  const R = iop ? iop.slice(0, 3) : [1, 0, 0], C = iop ? iop.slice(3, 6) : [0, 1, 0], Nn = cross(R, C);
  if (!iop) warnings.push('The files do not say which way the scan faces: left/right and front/back are assumed.');
  // every slice: which file and frame, and where it lies along the stack
  const slices = []; let havePos = true;
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
    slices.sort((a, b) => a.order - b.order); sz = pm0.spacingBetween || h0.spacingBetween || pm0.sliceThickness || h0.sliceThickness || sx;
    warnings.push('The files do not give slice positions: they are stacked in their numbered order.');
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
/** The phantom's teeth with their frames: [{ name (FDI), s, base:[x,y,0], u (mesiodistal), v (buccolingual), w (axis, up), md, bl, root, crown, two }] */
export function phantomTeeth() {
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
      out.push({ name, side, s: mid + side * sc, base: [at.p[0], at.p[1], PHANTOM.crest], u: uu, v: vv, w, md, bl, root, crown, two: !!two });
    });
  }
  return out.sort((a, b) => a.s - b.s);
}
/** A tooth's outer surface as a field: negative inside, positive outside, close to millimetres near the surface. Local coordinates. */
function toothLocal(t, a, b, c) {
  const hc = t.crown / 2 + 0.5, crown = ellipsoid(a, b, c - (hc - 0.9), t.md / 2, t.bl / 2, hc);
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
  let p = ellipsoid(a, b, c - 3.2, t.md / 5.5, t.bl / 5.5, 1.7);
  if (t.two) { const off = t.md * 0.27; p = Math.min(p, roundCone(a, b, c, [-off, 0, 3], [-off * 1.15, 0, -t.root + 2.2], 0.45, 0.3), roundCone(a, b, c, [off, 0, 3], [off * 1.15, 0, -t.root + 2.2], 0.45, 0.3)); }
  else p = Math.min(p, roundCone(a, b, c, [0, 0, 3], [0, 0, -t.root + 2.2], 0.5, 0.3));
  return p;
}
/** phantomPulpField(tooth) → f(x, y, z): the pulp chamber and canals in patient coordinates (negative inside) */
export function phantomPulpField(t) { return (x, y, z) => { const [a, b, c] = toLocal(t, x, y, z); return pulpLocal(t, a, b, c); }; }
/** what a point inside a tooth is made of → [value, margin]: margin is about how far (mm) the point is from where that changes */
function toothMaterial(t, a, b, c, T) {
  const p = pulpLocal(t, a, b, c); if (p < 0) return [PHANTOM.pulp, -p];
  const hc = t.crown / 2 + 0.5, ce = ellipsoid(a, b, c - (hc - 0.9), t.md / 2, t.bl / 2, hc);
  return [c > 1.6 && T > -1.3 && ce > -1.3 ? PHANTOM.enamel : PHANTOM.dentine, Math.min(p, Math.abs(c - 1.6), Math.abs(T + 1.3), Math.abs(ce + 1.3))];
}
/**
 * makePhantom({ voxel = 0.3, noise = 25, seed = 7, sub = 3 }) → { vol, truth }
 *   vol    as loadVolume gives it (modality 'CT')
 *   truth  { teeth (phantomTeeth()), arch:{ pts, s, length }, values: PHANTOM, bounds, boneField(x, y, z) (negative inside the bone) }
 * Each voxel near a boundary is the average of sub³ samples, as a real scanner averages what lies inside a voxel.
 */
export function makePhantom(o = {}) {
  const h = o.voxel || 0.3, sub = o.sub || 3, L = archLine(), teeth = phantomTeeth(), V = PHANTOM;
  const lo = [-36.2, -40.4, -20.6], hi = [36.2, 21.4, 12.4], nx = Math.round((hi[0] - lo[0]) / h) + 1, ny = Math.round((hi[1] - lo[1]) / h) + 1, nz = Math.round((hi[2] - lo[2]) / h) + 1;
  const data = new Int16Array(nx * ny * nz);
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
  const ground = (x, y, z) => { const d = dArch(x, y), bd = boneD(d, z); if (bd < 0) return bd > -1.4 ? V.cortex : V.spongy; return softD(d, z) < 0 ? V.soft : V.air; };
  // 1) bone, soft tissue and air (boundaries smoothed over a voxel by sampling)
  const offs = []; for (let a = 0; a < sub; a++) offs.push(((a + 0.5) / sub - 0.5) * h);
  for (let k = 0; k < nz; k++) { const z = lo[2] + k * h; for (let j = 0; j < ny; j++) { const y = lo[1] + j * h; for (let i = 0; i < nx; i++) {
    const x = lo[0] + i * h, d = dArch(x, y), bd = boneD(d, z), sd = softD(d, z); let v;
    if (Math.abs(bd) > h && Math.abs(bd + 1.4) > h && Math.abs(sd) > h) v = bd < 0 ? (bd > -1.4 ? V.cortex : V.spongy) : (sd < 0 ? V.soft : V.air);
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
    if (bd < 0) return [best < V.pdlWidth ? V.pdl : best < V.pdlWidth + 0.45 ? V.cortex : bd > -1.4 ? V.cortex : V.spongy, Math.min(-bd, Math.abs(bd + 1.4), best, Math.abs(best - V.pdlWidth), Math.abs(best - V.pdlWidth - 0.45))];
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
      const Tq = q.f(x, y, z); if (Tq > V.pdlWidth + 0.45 + h) continue;   // not this tooth's business
      // only the teeth that can be the nearest somewhere inside this voxel take part
      let best = Infinity; for (let g = 0; g < near.length; g++) { tv[g] = near[g] === q ? Tq : near[g].f(x, y, z); if (tv[g] < best) best = tv[g]; }
      cand.length = 0; for (let g = 0; g < near.length; g++) if (tv[g] <= best + 2 * h) cand.push(near[g]);
      const [v0, m] = mat(x, y, z, cand); let v = v0;
      if (m < safe) { let sum = 0; for (const oz of offs) for (const oy of offs) for (const ox of offs) sum += mat(x + ox, y + oy, z + oz, cand)[0]; v = sum / (sub * sub * sub); }
      data[i + nx * (j + ny * k)] = v;
    }
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
 *   o.seeds  [[x,y,z]…] points on the tooth          o.not   [[x,y,z]…] points that are not the tooth
 *   o.erase  [{ p:[x,y,z], r }…] balls cut away      o.roi   { shape:'cyl'|'box', c:[x,y], r, z0, z1 } (mm)
 *   o.T      threshold (data units)                   o.fill  fill the pulp (default true)
 * Every voxel inside the region, at or above the threshold and not cut away, may be tooth. They are shared out by flooding from
 * markers — the tooth seeds on one side; the edge of the region and the "not tooth" points on the other — taking first the
 * voxels that lie deepest inside the bright material (distance to the nearest dark voxel) and are brightest. The two floods
 * therefore meet where the bright material is thinnest and darkest: across the periodontal ligament space (voxels there are a
 * mix of tooth and dark ligament), and at the narrow neck where two teeth touch. Holes left inside (the pulp) are filled.
 * → { lab: Uint8Array over box (1 = tooth), box:{ i0, j0, k0, nx, ny, nz }, count, volume (mm³), lo, hi (mm), touch, T, dI, ref,
 *     seedOk, axis, centre, crown:+1|−1 (which way along axis the crown is) }  or { error }
 */
export function segmentTooth(vol, o) {
  const [NX, NY, NZ] = vol.dims, [sx, sy, sz] = vol.spacing, org = vol.origin, d = vol.data, roi = o.roi, T = o.T;
  const rr = roi.r, bi = (x, a) => Math.floor((x - org[a]) / vol.spacing[a]), pad = 2.5;   // the box reaches past the region, so depths near its edge are true
  const i0 = Math.max(0, bi(roi.c[0] - rr - pad, 0)), i1 = Math.min(NX - 1, bi(roi.c[0] + rr + pad, 0) + 1), j0 = Math.max(0, bi(roi.c[1] - rr - pad, 1)), j1 = Math.min(NY - 1, bi(roi.c[1] + rr + pad, 1) + 1);
  const k0 = Math.max(0, bi(Math.min(roi.z0, roi.z1) - pad, 2)), k1 = Math.min(NZ - 1, bi(Math.max(roi.z0, roi.z1) + pad, 2) + 1);
  const nx = i1 - i0 + 1, ny = j1 - j0 + 1, nz = k1 - k0 + 1, n = nx * ny * nz;
  if (nx < 3 || ny < 3 || nz < 3) return { error: 'The region is outside the scan.' };
  // a scan with very fine voxels: the region is worked out on a copy of that part of the scan with voxels f times larger
  // (averaged, up to about 0.25 mm), so it stays quick; the result (and the replica made from it) then refers to that copy, seg.vol
  const maxV = o.maxVoxels ?? 5e6;
  const fb = Math.min(Math.ceil(Math.cbrt(n / maxV)), Math.max(1, Math.floor(0.26 / Math.min(sx, sy, sz))));   // (never coarser than about 0.25 mm: the ligament space must still show)
  if (n > maxV && fb > 1) { const sub = cropVolume(vol, [i0, j0, k0], [i1, j1, k1], fb); return segmentTooth(sub, { ...o, maxVoxels: Infinity }); }
  const box = { i0, j0, k0, nx, ny, nz }, I = new Int16Array(n), inR = new Uint8Array(n), M = new Uint8Array(n), B = new Uint8Array(n), zl = Math.min(roi.z0, roi.z1), zh = Math.max(roi.z0, roi.z1);   // B: bright (all the box) · M: bright and in the region (may be tooth)
  for (let k = 0; k < nz; k++) { const z = org[2] + (k0 + k) * sz; for (let j = 0; j < ny; j++) { const y = org[1] + (j0 + j) * sy; for (let i = 0; i < nx; i++) {
    const x = org[0] + (i0 + i) * sx, q = i + nx * (j + ny * k), v = d[(i0 + i) + NX * ((j0 + j) + NY * (k0 + k))]; I[q] = v;
    const inside = z >= zl && z <= zh && (roi.shape === 'box' ? Math.abs(x - roi.c[0]) <= rr && Math.abs(y - roi.c[1]) <= rr : (x - roi.c[0]) ** 2 + (y - roi.c[1]) ** 2 <= rr * rr);
    inR[q] = inside ? 1 : 0; B[q] = v >= T ? 1 : 0; M[q] = inside && B[q] ? 1 : 0;
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
      if (lab[q] && lab[q] !== L) return; if (!lab[q]) { lab[q] = L; push(q, pr[q]); }
      const i = q % nx, j = ((q / nx) | 0) % ny, k = (q / (nx * ny)) | 0; let best = q, bv = pf[q];
      for (const [a, b, c] of nb26) { const ii = i + a, jj = j + b, kk = k + c; if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue; const u = ii + nx * (jj + ny * kk); if (M[u] && pf[u] > bv) { bv = pf[u]; best = u; } }
      if (best === q) return; q = best;
    }
  };
  const border = new Uint8Array(n); for (let q = 0; q < n; q++) if (M[q] && edge(q)) border[q] = 1;
  for (const q of seeds) climb(q, 1);
  for (const p of o.not || []) { const q = snap(p); if (q >= 0) climb(q, 2); }
  for (let q = 0; q < n; q++) if (border[q] && !lab[q]) climb(q, 2);
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
  return { lab, box, count, volume: count * sx * sy * sz, lo, hi, touch, T, dI, ref, seedOk: true, axis: ax, centre: c, crown, length: tmax - tmin, ends: [tmin, tmax], vol };
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
/** separable Gaussian blur of a 3D grid in place (σ in cells) */
function gauss3(F, n, s) {
  const r = Math.max(1, Math.ceil(3 * s)), w = new Float32Array(2 * r + 1); let ws = 0; for (let q = -r; q <= r; q++) { w[q + r] = Math.exp(-q * q / (2 * s * s)); ws += w[q + r]; } for (let q = 0; q < w.length; q++) w[q] /= ws;
  const [nx, ny, nz] = n, line = new Float32Array(Math.max(nx, ny, nz)), res = new Float32Array(line.length);
  const pass = (len, count, idx) => { for (let c = 0; c < count; c++) { for (let t = 0; t < len; t++) line[t] = F[idx(c, t)]; for (let t = 0; t < len; t++) { let acc = 0; for (let q = -r; q <= r; q++) { const u = t + q < 0 ? 0 : t + q >= len ? len - 1 : t + q; acc += w[q + r] * line[u]; } res[t] = acc; } for (let t = 0; t < len; t++) F[idx(c, t)] = res[t]; } };
  pass(nx, ny * nz, (c, t) => c * nx + t);
  pass(ny, nx * nz, (c, t) => (c % nx) + nx * (t + ny * ((c / nx) | 0)));
  pass(nz, nx * ny, (c, t) => c + nx * ny * t);
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
