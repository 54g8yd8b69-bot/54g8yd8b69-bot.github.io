// Letter Card "Polish wording": rewrites letter paragraphs with a small language model that runs on this
// device (transformers.js + ONNX Runtime, WebGPU). The engine is Notile's own copy in /notile/vendor/; the
// model files are downloaded once from Hugging Face at a pinned revision and kept in this browser's Cache API.
// The letter text stays inside this worker: nothing but the model download goes over the network.
import { pipeline, env } from '/notile/vendor/transformers/transformers.min.js';

const CACHE = 'notile-polish-v2'; // bump when the model or revision changes (v1 held the single-file model)
const ENGINE = new URL('/notile/vendor/transformers/', self.location.href).href;

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = false; // this worker keeps its own single copy (below); Dictate clears transformers.js's default cache
env.backends.onnx.wasm.wasmPaths = ENGINE;
env.backends.onnx.wasm.numThreads = 1; // GitHub Pages is not cross-origin isolated

// ---- download each file once and keep it; report progress for the big ones ----
const inflight = new Map();
const progress = {};
function report() {
  let l = 0, t = 0;
  for (const [a, b] of Object.values(progress)) { l += a; t += b; }
  if (t) postMessage({ type: 'progress', loaded: l, total: t });
}
async function openCache() { try { return await caches.open(CACHE); } catch (e) { return null; } }
async function download(url, cache) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok || !res.body) return res;
  const total = Number(res.headers.get('content-length')) || 0;
  const name = url.split('/').pop();
  // count bytes as they stream past, without keeping a copy in memory
  let loaded = 0;
  const counter = new TransformStream({ transform(chunk, ctl) {
    loaded += chunk.length;
    if (total > 2e6 || loaded > 2e6) { progress[name] = [loaded, Math.max(total, loaded)]; report(); }
    ctl.enqueue(chunk);
  } });
  const headers = { 'content-type': res.headers.get('content-type') || 'application/octet-stream' };
  if (total) headers['content-length'] = String(total);
  const streamed = new Response(res.body.pipeThrough(counter), { status: 200, headers });
  if (cache) {
    // stream straight into the Cache API (on disk), then hand back the stored copy
    try { await cache.put(url, streamed); const hit = await cache.match(url); if (hit) return hit; } catch (e) { /* storage full or private mode: fetch again without keeping it */ }
    return fetch(url, { credentials: 'omit' });
  }
  return streamed;
}
async function cachedFetch(input, init) {
  const url = new URL(typeof input === 'string' ? input : (input.url || String(input)), self.location.href).href;
  const mine = url.startsWith('https://huggingface.co/') || url.startsWith(ENGINE);
  if (!mine) return fetch(input, init);
  const cache = await openCache();
  if (cache) { const hit = await cache.match(url); if (hit) return hit; }
  if (!inflight.has(url)) inflight.set(url, download(url, cache).finally(() => setTimeout(() => inflight.delete(url), 0)));
  const res = await inflight.get(url);
  return res.clone();
}
env.fetch = cachedFetch;
// free the space used by older versions of this feature (v1 kept the 1.4 GB single-file model)
caches.keys().then(ks => ks.filter(k => k.startsWith('notile-polish-') && k !== CACHE).forEach(k => caches.delete(k))).catch(() => {});

// ---- prompt (tested against Qwen3 1.7B: keeps facts, tooth codes and numbers; flags are checked again on the page) ----
function messages(text, audience, noThink) {
  const who = audience === 'patient'
    ? 'a letter to a patient. Use plain, warm English and address the patient as "you".'
    : 'a letter from a hospital dentist to a dental colleague. Use a clear, professional clinical tone.';
  const nt = noThink ? ' /no_think' : '';
  const pt = audience === 'patient';
  return [
    { role: 'system', content:
`You tidy the wording of one section of a UK dental clinical letter. Turn the notes into smooth, complete sentences for ${who} Note fragments and 'Label: value' lines must become full sentences.
Rules:
- Keep every fact. Do not add, remove or change any clinical information, opinion, advice or diagnosis.
- Copy every number, measurement, drug name and tooth code (such as UL1, LR6) exactly as written.
- Keep each finding separate and attached to the test or tooth it belongs to. Never merge two findings into one.
- Keep abbreviations as written unless you are certain what they mean.
- Keep anything in [square brackets] exactly as written.
- Use UK English. Do not add greetings, headings, sign-offs or comments.
Reply with the rewritten text only.` },
    { role: 'user', content: (pt
      ? 'Upper left front tooth (UL1) not tender. Responds to cold. X-ray: no change. Splint removed.'
      : 'UL1: asymptomatic. Colour normal. TTP negative. Cold positive, EPT 32. PA: no change. Splint removed.') + nt },
    { role: 'assistant', content: pt
      ? 'Your upper left front tooth (UL1) is not tender and responds to cold. The X-ray shows no change, and we removed the splint.'
      : 'UL1 was asymptomatic and normal in colour. It was not tender to percussion and responded to cold, with an EPT reading of 32. The periapical radiograph showed no change, and the splint was removed.' },
    { role: 'user', content: text + nt },
  ];
}

let gen = null, cfg = null;
async function load(c) {
  if (gen && cfg && cfg.model === c.model && cfg.dtype === c.dtype && cfg.device === c.device) return gen;
  cfg = c;
  // hand the WebAssembly engine to ONNX Runtime from the same cache, so it isn't fetched twice
  if (!env.backends.onnx.wasm.wasmBinary) {
    try { const w = await cachedFetch(ENGINE + 'ort-wasm-simd-threaded.asyncify.wasm'); if (w.ok) env.backends.onnx.wasm.wasmBinary = await w.arrayBuffer(); } catch (e) { /* ONNX Runtime fetches it itself */ }
  }
  gen = await pipeline('text-generation', c.model, { revision: c.revision, dtype: c.dtype, device: c.device });
  return gen;
}

self.onmessage = async (e) => {
  const m = e.data || {};
  try {
    if (m.type === 'cached') {
      const cache = await openCache();
      const keys = cache ? await cache.keys() : [];
      const want = `${m.model}/resolve/${m.revision}/onnx/model_${m.dtype}.onnx_data`;
      postMessage({ type: 'cached', yes: keys.some(r => r.url.includes(want)) });
    } else if (m.type === 'init') {
      await load(m);
      postMessage({ type: 'ready' });
    } else if (m.type === 'run') {
      const g = await load(cfg || m);
      const t0 = performance.now();
      const out = await g(messages(m.text, m.audience, /qwen3/i.test(cfg.model)), {
        max_new_tokens: Math.min(700, Math.ceil(m.text.length / 2.4) + 80), do_sample: false, repetition_penalty: 1.05,
      });
      const last = out && out[0] && out[0].generated_text;
      let text = Array.isArray(last) ? String((last[last.length - 1] || {}).content || '') : String(last || '');
      text = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^\s*<think>[\s\S]*$/, '').trim();
      postMessage({ type: 'result', id: m.id, text, ms: Math.round(performance.now() - t0) });
    }
  } catch (err) {
    postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err) });
  }
};
