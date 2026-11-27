// dcmwrite.mjs — a small DICOM writer, for the CBCT tests only (node). It writes made-up scans in the layouts and
// transfer syntaxes shared/dicom.js reads, with fake patient details in the tags so the tests can check that none of
// them ever reaches the page, a saved case or an export.
//
//   writeDicom({ ts, sopClass, elements: [[tag, vr, value], …], frames: [Int16Array|Uint16Array…], bits, signed, rows, cols, rle?, jpegll? })
//     → Buffer (a complete Part 10 file: preamble, meta group, data set)
//   encodeRLE(words, rows, cols) · encodeJpegLossless(words, rows, cols, { predictor, restart, precision })
//   zipStore(entries, { deflate }) → Buffer
import zlib from 'node:zlib';

export const TS = {
  implicit: '1.2.840.10008.1.2', explicit: '1.2.840.10008.1.2.1', deflated: '1.2.840.10008.1.2.1.99', big: '1.2.840.10008.1.2.2',
  rle: '1.2.840.10008.1.2.5', jpeg: '1.2.840.10008.1.2.4.50', jpeg12: '1.2.840.10008.1.2.4.51', jpegll57: '1.2.840.10008.1.2.4.57', jpegll70: '1.2.840.10008.1.2.4.70', j2k: '1.2.840.10008.1.2.4.90',
};
const LONG = new Set(['OB', 'OW', 'OF', 'SQ', 'UT', 'UN', 'OD', 'OL', 'UC', 'UR', 'OV', 'SV', 'UV']);
const NUM = { US: 2, SS: 2, UL: 4, SL: 4, FL: 4, FD: 8 };

/** the bytes of one value */
function valueBytes(vr, v, le) {
  if (Buffer.isBuffer(v)) return v.length % 2 ? Buffer.concat([v, Buffer.from([0])]) : v;
  if (NUM[vr]) {
    const a = Array.isArray(v) ? v : [v], n = NUM[vr], b = Buffer.alloc(a.length * n);
    a.forEach((x, i) => { const o = i * n; if (vr === 'US') le ? b.writeUInt16LE(x, o) : b.writeUInt16BE(x, o); else if (vr === 'SS') le ? b.writeInt16LE(x, o) : b.writeInt16BE(x, o); else if (vr === 'UL') le ? b.writeUInt32LE(x, o) : b.writeUInt32BE(x, o); else if (vr === 'SL') le ? b.writeInt32LE(x, o) : b.writeInt32BE(x, o); else if (vr === 'FL') le ? b.writeFloatLE(x, o) : b.writeFloatBE(x, o); else le ? b.writeDoubleLE(x, o) : b.writeDoubleBE(x, o); });
    return b;
  }
  let s = Array.isArray(v) ? v.map(String).join('\\') : String(v);
  if (s.length % 2) s += vr === 'UI' ? '\0' : ' ';
  return Buffer.from(s, 'latin1');
}
function tagBytes(tag, le) { const b = Buffer.alloc(4), g = tag >>> 16, e = tag & 0xFFFF; if (le) { b.writeUInt16LE(g, 0); b.writeUInt16LE(e, 2); } else { b.writeUInt16BE(g, 0); b.writeUInt16BE(e, 2); } return b; }
function u32(v, le) { const b = Buffer.alloc(4); le ? b.writeUInt32LE(v >>> 0, 0) : b.writeUInt32BE(v >>> 0, 0); return b; }
function u16(v, le) { const b = Buffer.alloc(2); le ? b.writeUInt16LE(v, 0) : b.writeUInt16BE(v, 0); return b; }
/**
 * One element. value for SQ: { items: [elements…], undefinedLength?, itemsUndefined? }.
 */
export function element(tag, vr, value, o) {
  const { explicit = true, le = true } = o;
  let body, undef = false;
  if (vr === 'SQ') {
    const parts = [];
    for (const it of value.items) {
      const ib = dataset(it, o);
      if (value.itemsUndefined) parts.push(tagBytes(0xFFFEE000, le), u32(0xFFFFFFFF, le), ib, tagBytes(0xFFFEE00D, le), u32(0, le));
      else parts.push(tagBytes(0xFFFEE000, le), u32(ib.length, le), ib);
    }
    if (value.undefinedLength) { parts.push(tagBytes(0xFFFEE0DD, le), u32(0, le)); undef = true; }
    body = Buffer.concat(parts);
  } else body = valueBytes(vr, value, le);
  const len = undef ? 0xFFFFFFFF : body.length;
  if (!explicit) return Buffer.concat([tagBytes(tag, le), u32(len, le), body]);
  const head = [tagBytes(tag, le), Buffer.from(vr, 'latin1')];
  if (LONG.has(vr)) head.push(Buffer.alloc(2), u32(len, le)); else head.push(u16(len, le));
  return Buffer.concat([...head, body]);
}
export function dataset(elements, o) {
  const sorted = elements.slice().sort((a, b) => (a[0] >>> 0) - (b[0] >>> 0));
  return Buffer.concat(sorted.map(([t, vr, v]) => element(t >>> 0, vr, v, o)));
}

// ───────────── pixel encoders ─────────────
function packBits(bytes) {                                       // PackBits as DICOM RLE wants it
  const out = []; let i = 0; const n = bytes.length;
  while (i < n) {
    let r = 1; while (i + r < n && r < 128 && bytes[i + r] === bytes[i]) r++;
    if (r >= 2) { out.push(257 - r, bytes[i]); i += r; continue; }
    let j = i + 1; while (j < n && j - i < 128 && !(j + 1 < n && bytes[j] === bytes[j + 1])) j++;
    out.push(j - i - 1); for (let k = i; k < j; k++) out.push(bytes[k]); i = j;
  }
  if (out.length % 2) out.push(128);                             // (128 is a no-op: pads the segment to an even length)
  return Buffer.from(out);
}
/** RLE Lossless frame of 16-bit words (two byte planes, most significant first) */
export function encodeRLE(words) {
  const n = words.length, hi = new Uint8Array(n), lo = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const w = words[i] & 0xFFFF; hi[i] = w >> 8; lo[i] = w & 255; }
  const s0 = packBits(hi), s1 = packBits(lo), head = Buffer.alloc(64);
  head.writeUInt32LE(2, 0); head.writeUInt32LE(64, 4); head.writeUInt32LE(64 + s0.length, 8);
  return Buffer.concat([head, s0, s1]);
}
/** canonical Huffman code lengths (≤ 16) for symbols 0..16 from their counts */
function huffLengths(freq) {
  const syms = freq.map((f, s) => ({ s, f })).filter((x) => x.f > 0);
  if (syms.length === 1) syms.push({ s: syms[0].s === 0 ? 1 : 0, f: 1 });   // a code needs two symbols
  let nodes = syms.map((x) => ({ f: x.f, leaves: [x.s] })); const len = new Array(17).fill(0);
  while (nodes.length > 1) { nodes.sort((a, b) => a.f - b.f); const a = nodes.shift(), b = nodes.shift(); for (const s of [...a.leaves, ...b.leaves]) len[s]++; nodes.push({ f: a.f + b.f, leaves: [...a.leaves, ...b.leaves] }); }
  if (Math.max(...len) > 16) throw new Error('Huffman code too long');
  // no symbol may get the all-ones code: JPEG reserves it. Giving the longest code one more bit (a spare slot) avoids it.
  const maxL = Math.max(...len), longest = len.indexOf(maxL); if (maxL < 16) len[longest]++;
  return len;
}
// ───────── JPEG extended (process 2/4): sequential DCT, Huffman, 12-bit — as i-CAT and other CBCT machines write it ─────────
const ZZ = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const STD_LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const DCT_C = (() => { const c = new Float64Array(64); for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) c[x * 8 + u] = (u ? 1 : Math.SQRT1_2) * Math.cos((2 * x + 1) * u * Math.PI / 16) / 2; return c; })();
/** optimal Huffman table limited to 16 bits (ITU T.81 Annex K.2 / K.3, as libjpeg does it): → { bits[1..16] counts, vals } */
function optimalTable(freq) {
  const f = Array.from({ length: 257 }, (_, i) => (i < 256 ? freq[i] || 0 : 1)), size = new Int32Array(257), others = new Int32Array(257).fill(-1);
  for (;;) {
    let c1 = -1, c2 = -1;
    for (let i = 0; i <= 256; i++) if (f[i] && (c1 < 0 || f[i] <= f[c1])) c1 = i;
    for (let i = 0; i <= 256; i++) if (f[i] && i !== c1 && (c2 < 0 || f[i] <= f[c2])) c2 = i;
    if (c2 < 0) break;
    f[c1] += f[c2]; f[c2] = 0;
    size[c1]++; while (others[c1] >= 0) { c1 = others[c1]; size[c1]++; } others[c1] = c2;
    size[c2]++; while (others[c2] >= 0) { c2 = others[c2]; size[c2]++; }
  }
  const bits = new Int32Array(33); for (let i = 0; i <= 256; i++) if (size[i]) bits[size[i]]++;
  for (let i = 32; i > 16; i--) while (bits[i] > 0) { let j = i - 2; while (bits[j] === 0) j--; bits[i] -= 2; bits[i - 1]++; bits[j + 1] += 2; bits[j]--; }
  let i = 16; while (bits[i] === 0) i--; bits[i]--;                 // drop the reserved symbol's code (all ones)
  const vals = []; for (let l = 1; l <= 32; l++) for (let s = 0; s < 256; s++) if (size[s] === l) vals.push(s);
  return { bits: Array.from(bits.subarray(1, 17)), vals };
}
const canon = (t) => { const code = new Int32Array(256), len = new Int32Array(256); let c = 0, k = 0; for (let l = 1; l <= 16; l++) { for (let i = 0; i < t.bits[l - 1]; i++) { code[t.vals[k]] = c; len[t.vals[k]] = l; c++; k++; } c <<= 1; } return { code, len }; };
const cat = (v) => { let a = Math.abs(v), n = 0; while (a) { n++; a >>= 1; } return n; };
/** encodeJpegDCT(words, rows, cols, { precision 12, qdiv, restart }) → { jpeg: Buffer, recon: Uint16Array } — recon is the image an exact
 *  decoder must give back (the dequantised coefficients through the inverse DCT, rounded and clamped), so a decoder can be held to ±1 */
export function encodeJpegDCT(words, rows, cols, o = {}) {
  const P = o.precision || 12, top = (1 << P) - 1, shift = 1 << (P - 1), ri = o.restart || 0, q = STD_LUMA.map((v) => Math.max(1, Math.round(v / (o.qdiv || 4))));
  const bw = Math.ceil(cols / 8), bh = Math.ceil(rows / 8), blocks = [], recon = new Uint16Array(rows * cols), f = new Float64Array(64), t = new Float64Array(64), F = new Float64Array(64);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const r = Math.min(rows - 1, by * 8 + y), c = Math.min(cols - 1, bx * 8 + x); f[y * 8 + x] = (words[r * cols + c] & top) - shift; }
    for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let a = 0; for (let x = 0; x < 8; x++) a += DCT_C[x * 8 + u] * f[y * 8 + x]; t[y * 8 + u] = a; }
    for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) { let a = 0; for (let y = 0; y < 8; y++) a += DCT_C[y * 8 + v] * t[y * 8 + u]; F[v * 8 + u] = a; }
    const zz = new Int32Array(64); for (let k = 0; k < 64; k++) zz[k] = Math.round(F[ZZ[k]] / q[ZZ[k]]); blocks.push(zz);
    // what the decoder must make of it
    const D = new Float64Array(64); for (let k = 0; k < 64; k++) D[ZZ[k]] = zz[k] * q[ZZ[k]];
    for (let v = 0; v < 8; v++) for (let x = 0; x < 8; x++) { let a = 0; for (let u = 0; u < 8; u++) a += DCT_C[x * 8 + u] * D[v * 8 + u]; t[v * 8 + x] = a; }
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const r = by * 8 + y, c = bx * 8 + x; if (r >= rows || c >= cols) continue; let a = 0; for (let v = 0; v < 8; v++) a += DCT_C[y * 8 + v] * t[v * 8 + x]; recon[r * cols + c] = Math.min(top, Math.max(0, Math.round(a + shift))); }
  }
  const walk = (emit) => {                                         // DC differences and AC run/size symbols, block by block, restarts included
    let pred = 0;
    blocks.forEach((zz, b) => {
      if (ri && b && b % ri === 0) { emit({ restart: (b / ri - 1) & 7 }); pred = 0; }
      const d = zz[0] - pred; pred = zz[0]; emit({ dc: cat(d), v: d });
      let run = 0; for (let k = 1; k < 64; k++) { const v = zz[k]; if (!v) { run++; continue; } while (run > 15) { emit({ ac: 0xF0 }); run -= 16; } emit({ ac: (run << 4) | cat(v), v, s: cat(v) }); run = 0; }
      if (run) emit({ ac: 0x00 });
    });
  };
  const dcF = new Array(256).fill(0), acF = new Array(256).fill(0); walk((e) => { if (e.dc !== undefined) dcF[e.dc]++; else if (e.ac !== undefined) acF[e.ac]++; });
  const dcT = optimalTable(dcF), acT = optimalTable(acF), dcC = canon(dcT), acC = canon(acT), out = []; let acc = 0, nb = 0;
  const put = (v, bits) => { for (let b = bits - 1; b >= 0; b--) { acc = (acc << 1) | ((v >>> b) & 1); nb++; if (nb === 8) { out.push(acc); if (acc === 0xFF) out.push(0); acc = 0; nb = 0; } } };
  const flush = () => { while (nb) put(1, 1); };
  const val = (v, s) => (v > 0 ? v : v + (1 << s) - 1);
  walk((e) => {
    if (e.restart !== undefined) { flush(); out.push(0xFF, 0xD0 + e.restart); return; }
    if (e.dc !== undefined) { put(dcC.code[e.dc], dcC.len[e.dc]); if (e.dc) put(val(e.v, e.dc), e.dc); return; }
    put(acC.code[e.ac], acC.len[e.ac]); if (e.s) put(val(e.v, e.s), e.s);
  });
  flush();
  const dqt = [0xFF, 0xDB, 0, 2 + 1 + 128, 0x10]; for (let k = 0; k < 64; k++) dqt.push(q[ZZ[k]] >> 8, q[ZZ[k]] & 255);   // 16-bit table entries (Pq = 1)
  const dht = (cls, T) => [0xFF, 0xC4, 0, 3 + 16 + T.vals.length, cls << 4, ...T.bits, ...T.vals];
  const head = [0xFF, 0xD8, ...dqt, 0xFF, 0xC1, 0, 11, P, rows >> 8, rows & 255, cols >> 8, cols & 255, 1, 1, 0x11, 0, ...dht(0, dcT), ...dht(1, acT)];
  if (ri) head.push(0xFF, 0xDD, 0, 4, ri >> 8, ri & 255);
  head.push(0xFF, 0xDA, 0, 8, 1, 1, 0x00, 0, 63, 0);
  return { jpeg: Buffer.concat([Buffer.from(head), Buffer.from(out), Buffer.from([0xFF, 0xD9])]), recon };
}
/** JPEG Lossless (process 14), one component. words: stored values (taken modulo 2^precision). */
export function encodeJpegLossless(words, rows, cols, o = {}) {
  const P = o.precision || 16, sel = o.predictor || 1, ri = o.restart || 0, mod = 65536, half = 32768, n = rows * cols;   // differences are taken modulo 2^16 whatever the precision (T.81 H.1.2.1)
  const x = new Uint32Array(n); for (let i = 0; i < n; i++) { x[i] = words[i] & 0xFFFF; if (x[i] >= 2 ** P) throw new Error('value above the precision'); }
  const start = 1 << (P - 1), diffs = new Int32Array(n);
  let since = 0, rowOf = 0;
  for (let y = 0, i = 0; y < rows; y++) {
    for (let c = 0; c < cols; c++, i++) {
      if (ri && since === ri) { since = 0; rowOf = 0; }
      let pred;
      if (rowOf === 0) pred = c === 0 || since === 0 ? start : x[i - 1];
      else if (c === 0) pred = x[i - cols];
      else { const a = x[i - 1], b = x[i - cols], cc = x[i - cols - 1]; pred = sel === 1 ? a : sel === 2 ? b : sel === 3 ? cc : sel === 4 ? a + b - cc : sel === 5 ? a + ((b - cc) >> 1) : sel === 6 ? b + ((a - cc) >> 1) : (a + b) >> 1; }
      let d = ((x[i] - pred) % mod + mod) % mod; if (d > half) d -= mod; diffs[i] = d; since++;
    }
    rowOf++;
  }
  const cat = (d) => (d === half ? 16 : d === 0 ? 0 : 32 - Math.clz32(Math.abs(d)));
  const freq = new Array(17).fill(0); for (let i = 0; i < n; i++) freq[cat(diffs[i])]++;
  const len = huffLengths(freq), order = []; for (let l = 1; l <= 16; l++) for (let s = 0; s <= 16; s++) if (len[s] === l) order.push(s);
  const code = new Array(17).fill(0); { let c = 0, l = 1, k = 0; for (; l <= 16; l++) { for (const s of order) if (len[s] === l) { code[s] = c++; k++; } c <<= 1; } }
  const out = []; let acc = 0, nb = 0;
  const put = (v, bits) => { for (let b = bits - 1; b >= 0; b--) { acc = (acc << 1) | ((v >>> b) & 1); nb++; if (nb === 8) { out.push(acc); if (acc === 0xFF) out.push(0); acc = 0; nb = 0; } } };
  const flush = () => { if (nb) { put((1 << (8 - nb)) - 1, 8 - nb); } };
  let rst = 0; since = 0;
  for (let i = 0; i < n; i++) {
    if (ri && since === ri) { flush(); out.push(0xFF, 0xD0 + (rst & 7)); rst++; since = 0; }
    const d = diffs[i], t = cat(d); put(code[t], len[t]);
    if (t && t < 16) put(d > 0 ? d : d + (1 << t) - 1, t);
    since++;
  }
  flush();
  const counts = []; for (let l = 1; l <= 16; l++) counts.push(order.filter((s) => len[s] === l).length);
  const head = [0xFF, 0xD8, 0xFF, 0xC3, 0, 11, P, rows >> 8, rows & 255, cols >> 8, cols & 255, 1, 1, 0x11, 0,
    0xFF, 0xC4, 0, 3 + 16 + order.length, 0x00, ...counts, ...order];
  if (ri) head.push(0xFF, 0xDD, 0, 4, ri >> 8, ri & 255);
  head.push(0xFF, 0xDA, 0, 8, 1, 1, 0x00, sel, 0, 0);
  return Buffer.concat([Buffer.from(head), Buffer.from(out), Buffer.from([0xFF, 0xD9])]);
}

// ───────────── the file ─────────────
/**
 * writeDicom(o) → Buffer
 *   o.ts         transfer syntax UID      o.sopClass, o.sopInstance
 *   o.elements   [[tag, vr, value], …]  (the data set without pixel data)
 *   o.frames     typed arrays of stored values, one per frame (rows × cols)
 *   o.bits       bits allocated (16 or 8)
 *   o.jpeg       { predictor, restart } for the JPEG Lossless syntaxes
 *   o.offsetTable  true: fill the basic offset table of encapsulated data
 *   o.splitFragments  n: cut each compressed frame into n fragments
 *   o.compressed  [Buffer…]: frames already compressed (e.g. JPEG baseline from sharp), written as they are
 */
export function writeDicom(o) {
  const ts = o.ts, le = ts !== TS.big, explicit = ts !== TS.implicit, encaps = !!o.compressed || ts === TS.rle || ts === TS.jpegll57 || ts === TS.jpegll70 || ts === TS.j2k;
  const meta = dataset([
    [0x00020001, 'OB', Buffer.from([0, 1])], [0x00020002, 'UI', o.sopClass], [0x00020003, 'UI', o.sopInstance],
    [0x00020010, 'UI', ts], [0x00020012, 'UI', '1.2.826.0.1.3680043.9.7777.1'], [0x00020013, 'SH', 'NOTILE_TEST'],
  ], { explicit: true, le: true });
  const metaAll = Buffer.concat([element(0x00020000, 'UL', meta.length, { explicit: true, le: true }), meta]);
  const opt = { explicit, le };
  let body = dataset(o.elements, opt), pix;
  const words = o.bits === 8 ? 1 : 2;
  if (!encaps) {
    const parts = o.frames.map((f) => { const b = Buffer.alloc(f.length * words); for (let i = 0; i < f.length; i++) { if (words === 1) b[i] = f[i] & 255; else if (le) b.writeUInt16LE(f[i] & 0xFFFF, 2 * i); else b.writeUInt16BE(f[i] & 0xFFFF, 2 * i); } return b; });
    pix = element(0x7FE00010, words === 1 ? 'OB' : 'OW', Buffer.concat(parts), opt);
  } else {
    const comp = o.compressed || o.frames.map((f) => (ts === TS.rle ? encodeRLE(f) : ts === TS.j2k ? Buffer.from([0xFF, 0x4F, 0xFF, 0x51, 0, 0]) : encodeJpegLossless(f, o.rows, o.cols, o.jpeg || {})));
    const frags = []; const offsets = []; let off = 0;
    for (const c0 of comp) {
      const c = c0.length % 2 ? Buffer.concat([c0, Buffer.from([0])]) : c0, nsp = o.splitFragments || 1, step = Math.ceil(c.length / nsp / 2) * 2;
      offsets.push(off);
      for (let p = 0; p < c.length; p += step) { const piece = c.subarray(p, Math.min(c.length, p + step)); frags.push(Buffer.concat([tagBytes(0xFFFEE000, true), u32(piece.length, true), piece])); off += 8 + piece.length; }
    }
    const bot = o.offsetTable ? Buffer.concat(offsets.map((v) => u32(v, true))) : Buffer.alloc(0);
    pix = Buffer.concat([tagBytes(0x7FE00010, true), Buffer.from('OB'), Buffer.alloc(2), u32(0xFFFFFFFF, true), tagBytes(0xFFFEE000, true), u32(bot.length, true), bot, ...frags, tagBytes(0xFFFEE0DD, true), u32(0, true)]);
  }
  let data = Buffer.concat([body, pix]);
  if (ts === TS.deflated) data = zlib.deflateRawSync(data);
  return Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), metaAll, data]);
}

// ───────────── zip ─────────────
export function zipBuffer(entries, o = {}) {
  const parts = [], cent = []; let off = 0;
  for (const { name, data } of entries) {
    const nm = Buffer.from(name, 'utf8'), crc = zlib.crc32(data), comp = o.deflate ? zlib.deflateRawSync(data) : data, method = o.deflate ? 8 : 0;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(method, 8); h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nm.length, 26);
    parts.push(h, nm, comp);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(method, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    cent.push(c, nm); off += 30 + nm.length + comp.length;
  }
  const cs = cent.reduce((s, b) => s + b.length, 0), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cs, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, ...cent, e]);
}

// ───────────── the made-up people and places (the privacy tests look for every one of these) ─────────────
export const FAKE = {
  name: 'ZZTESTPATIENT^FAKEPERSON', id: 'ZZID4455667788', chi: '9123456780', birth: '19010203', address: 'ZZ 99 FAKELANE ROAD', institution: 'ZZFAKE HOSPITAL TRUST',
  instAddress: 'ZZ 1 FAKE STREET', referrer: 'ZZREFERRER^DOCTOR', accession: 'ZZACC99887766', studyDesc: 'ZZSTUDYDESCRIPTION', seriesDesc: 'ZZSERIESDESCRIPTION', studyId: 'ZZSTUDYID77',
  operator: 'ZZOPERATOR^NAME', requester: 'ZZREQUESTER^NAME', privateName: 'ZZPRIVATECOPY^NAME', folder: 'ZZFOLDER_SMITH_JOHN',
};
/** the identifying tags every test file carries (including some inside sequences and a private block) */
export function fakeTags() {
  const F = FAKE;
  return [
    [0x00080005, 'CS', 'ISO_IR 100'], [0x00080030, 'TM', '101500'], [0x00080050, 'SH', F.accession], [0x00080080, 'LO', F.institution], [0x00080081, 'ST', F.instAddress],
    [0x00080090, 'PN', F.referrer], [0x00081030, 'LO', F.studyDesc], [0x0008103E, 'LO', F.seriesDesc], [0x00081070, 'PN', F.operator],
    [0x00081110, 'SQ', { items: [[[0x00081150, 'UI', '1.2.3.4'], [0x00081155, 'UI', '1.2.3.4.5'], [0x00321032, 'PN', F.requester]]], undefinedLength: true, itemsUndefined: true }],
    [0x00090010, 'LO', 'ZZ PRIVATE CREATOR'], [0x00091001, 'LO', F.privateName],
    [0x00100010, 'PN', F.name], [0x00100020, 'LO', F.id], [0x00100030, 'DA', F.birth], [0x00100040, 'CS', 'F'], [0x00101000, 'LO', F.chi], [0x00101040, 'LO', F.address],
    [0x00200010, 'SH', F.studyId],
    [0x00400275, 'SQ', { items: [[[0x00321060, 'LO', F.studyDesc], [0x00401001, 'SH', F.accession]]] }],
  ];
}
