// toothseg-worker.js — runs the ToothSeg tooth network for the CBCT tab, off the page's own thread (a module worker).
//
// It is bundled with ONNX Runtime Web (MIT; its WebAssembly build, one thread) into toothseg/worker.js, and reads the rest of
// the pack from the folder it is told (toothseg/): manifest.json, the runtime's .wasm and the network's weights in parts.
// The pack is fetched once and kept on the device (Cache Storage, under its own name so that updates of the site leave it
// alone); it is checked whole (size and SHA-256) before it is used. Nothing of the scan leaves the device: the page hands
// the worker a cube of grey values and gets back, for each voxel, 0 (background), 1 (the middle of a tooth) or 2 (its rim).
//
//   → { type: 'load', base, allow }                ← { type: 'need', total } (the pack is not on the device and allow was not given), or
//                                                    { type: 'progress', done, total } … then { type: 'ready', … }, or { type: 'error', message }
//   → { type: 'run', id, x: Float32Array, n }      ← { type: 'done', id, lab: Uint8Array, secs } or { type: 'error', id, message }
//   (x: n[0]·n[1]·n[2] values, x fastest, already on the network's scale — see modelCube in dicom.js)
import * as ort from 'onnxruntime-web/wasm';

const STORE = 'toothseg-v1';
let session = null, names = { input: 'x', output: 'y' };
const post = (m, t) => self.postMessage(m, t || []);
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (buf) => (self.crypto && crypto.subtle ? hex(await crypto.subtle.digest('SHA-256', buf)) : null);
const openStore = async () => { try { return self.caches ? await caches.open(STORE) : null; } catch (_) { return null; } };

/** one file of the pack: from the device's store if a whole copy is there, else fetched (and kept); onBytes(n, kept) as it arrives */
async function getFile(store, url, bytes, onBytes) {
  if (store) {
    try { const hit = await store.match(url); if (hit) { const b = await hit.arrayBuffer(); if (b.byteLength === bytes) { onBytes(bytes, true); return b; } await store.delete(url); } } catch (_) { /* fetched below */ }
  }
  const r = await fetch(url); if (!r.ok) throw new Error(`The tooth model could not be fetched (${r.status}).`);
  let buf;
  if (r.body && r.body.getReader) {
    const rd = r.body.getReader(), out = new Uint8Array(bytes); let o = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; if (o + value.length > bytes) throw new Error('The tooth model did not arrive whole: try again.'); out.set(value, o); o += value.length; onBytes(value.length, false); }
    if (o !== bytes) throw new Error('The tooth model did not arrive whole: try again.'); buf = out.buffer;
  } else { buf = await r.arrayBuffer(); if (buf.byteLength !== bytes) throw new Error('The tooth model did not arrive whole: try again.'); onBytes(bytes, false); }
  return buf;
}

async function load(m) {
  const t0 = performance.now(), base = m.base;
  const mr = await fetch(new URL('manifest.json', base), { cache: 'no-cache' }); if (!mr.ok) throw new Error(`The tooth model is not available here (${mr.status}).`);
  const man = await mr.json(), store = await openStore(), files = [man.wasm, ...man.model.parts], total = files.reduce((s, f) => s + f.bytes, 0); let done = 0, kept = true;
  const urls = files.map((f) => new URL(f.file, base).href), got = [];
  // unless the page says the pack may be fetched (allow), it is only taken from the device's store: if it is not all there, the page is told what it would take
  if (!m.allow) { let all = !!store; if (store) for (const u of urls) { let hit = null; try { hit = await store.match(u); } catch (_) { /* not there */ } if (!hit) { all = false; break; } } if (!all) return post({ type: 'need', total }); }
  post({ type: 'progress', done: 0, total });
  for (let i = 0; i < files.length; i++) got.push(await getFile(store, urls[i], files[i].bytes, (n, hit) => { done += n; if (!hit) kept = false; post({ type: 'progress', done, total }); }));
  const model = new Uint8Array(man.model.bytes); let o = 0; for (let i = 1; i < got.length; i++) { model.set(new Uint8Array(got[i]), o); o += got[i].byteLength; }
  const bad = async () => { if (store) for (const u of urls) { try { await store.delete(u); } catch (_) { /* nothing kept */ } } throw new Error('The tooth model did not arrive whole: try again.'); };
  if (o !== man.model.bytes) await bad();
  const [hw, hm] = await Promise.all([sha256(got[0]), sha256(model.buffer)]);
  if ((hw && man.wasm.sha256 && hw !== man.wasm.sha256) || (hm && man.model.sha256 && hm !== man.model.sha256)) await bad();
  if (store && !kept) for (let i = 0; i < files.length; i++) { try { if (!(await store.match(urls[i]))) await store.put(urls[i], new Response(got[i], { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(files[i].bytes) } })); } catch (_) { /* no room: it is fetched again next time */ } }
  if (man.input) names = { input: man.input, output: man.output };
  ort.env.wasm.wasmBinary = got[0]; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
  session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  post({ type: 'ready', secs: (performance.now() - t0) / 1000, kept, stored: !!store, bytes: total, version: man.version || '', name: man.name || '' });
}

async function run(m) {
  if (!session) throw new Error('The tooth model is not loaded.');
  const t0 = performance.now(), n = m.n, N = n[0] * n[1] * n[2];
  const out = await session.run({ [names.input]: new ort.Tensor('float32', m.x, [1, 1, n[2], n[1], n[0]]) }), T = out[names.output], y = T.data, lab = new Uint8Array(N);
  if (y.length !== 3 * N) throw new Error('The tooth model gave an answer of the wrong size.');
  for (let q = 0; q < N; q++) { const a = y[q], b = y[N + q], c = y[2 * N + q]; lab[q] = b > a ? (c > b ? 2 : 1) : (c > a ? 2 : 0); }
  if (T.dispose) T.dispose();
  post({ type: 'done', id: m.id, lab, secs: (performance.now() - t0) / 1000 }, [lab.buffer]);
}

self.onmessage = (e) => {
  const m = e.data || {};
  (m.type === 'load' ? load(m) : m.type === 'run' ? run(m) : Promise.resolve()).catch((err) => post({ type: 'error', id: m.id, message: String((err && err.message) || err) }));
};
