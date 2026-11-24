// ─────────────────────────────────────────────────────────────────────────────
// Notile 3D core  ·  shared by Scan Card and its tools (Model Card, Splint Card, Analysis Card)
// One ES module, no build step. Ships beside each app's index.html as core.js.
//
// Conventions (every app and every case file uses these):
//   • Units are millimetres.
//   • CASE FRAME = "LPS":  +X = patient's LEFT,  +Y = POSTERIOR,  +Z = UP (superior).
//     The occlusal plane is z ≈ 0. Lower teeth point +Z, upper teeth point −Z, so an upper and
//     a lower scan that were exported together stay in their bite.
//   • A mesh is a plain object  { positions: Float32Array(3n), indices: Uint32Array(3m), colors?: Uint8Array(3n) }.
//   • Every item in a case keeps its ORIGINAL scanner coordinates plus a 4×4 `matrix` (local → case frame),
//     so anything designed here can be exported back in the scanner's own coordinates.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { MeshBVH, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const CORE_VERSION = '1.1.0';
export { THREE, OrbitControls, MeshBVH };

// ───────────────────────────── inside Scan Card ─────────────────────────────
// Scan Card (the hub page) shows each tool in a frame and owns the scans. A tool page that finds the hub above it
// hides its own Load / Orient steps and its top bar, takes its scans from the hub and hands its work back to it.
// Opened on its own, the same page is the full stand-alone app.
export const HUB = (() => { try { const p = typeof window !== 'undefined' && window.parent !== window ? window.parent : null; return (p && p.SCANHUB) || null; } catch (_) { return null; } })();
export const EMBED = !!HUB;

// ───────────────────────────── small helpers ─────────────────────────────
export const $ = (id) => document.getElementById(id);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '–');
export function el(tag, attrs = {}, html = '') {
  const e = document.createElement(tag);
  for (const k in attrs) { if (k === 'class') e.className = attrs[k]; else if (k === 'style') e.style.cssText = attrs[k]; else e.setAttribute(k, attrs[k]); }
  if (html) e.innerHTML = html;
  return e;
}

// ───────────────────────────── look and shell ─────────────────────────────
// Same visual language as Tray Card: navy top bar, teal accent, numbered step accordion on the left,
// dark 3D viewport on the right. Apps write their step bodies with these classes:
//   .row (label + control)  .btn / .btn.pri / .btn.on  .btns  .seg  .note / .note.warn  .drop  .slot
//   .h4  .lead  .tip (shown when the step's ? is on)  .kv (numbers)  table.tbl
export const CSS = `
:root{--navy:#0f2a44;--navy2:#16365a;--navy3:#1e4772;--teal:#14b8a6;--teal2:#0d9488;--tealsoft:#ccfbf1;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--bg:#f4f7fa;--warn:#f59e0b;--bad:#ef4444}
*{box-sizing:border-box}
html,body{margin:0;height:100%;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg);overflow:hidden;font-size:14px}
button{font:inherit;cursor:pointer}
[hidden]{display:none!important}
#app{display:grid;grid-template-rows:48px 1fr;grid-template-columns:340px 1fr;height:100%;position:relative}
#top{grid-column:1/3;background:var(--navy);color:#fff;display:flex;align-items:center;gap:14px;padding:0 14px;min-width:0}
#top .brand{font-weight:700;letter-spacing:.2px;font-size:16px;display:flex;align-items:center;gap:8px;white-space:nowrap;color:inherit;text-decoration:none}
#top .brand i{display:inline-block;width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,var(--teal),#5eead4)}
#top .sub{color:#9fb6cf;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
#top .sp{flex:1}
#topBtns{display:flex;gap:6px;flex:none}
#top button{background:var(--navy2);color:#e6f0fa;border:1px solid var(--navy3);border-radius:7px;padding:6px 10px;font-size:12px;white-space:nowrap}
#top button:hover{background:var(--navy3)}
#top button.on{background:var(--teal2);border-color:var(--teal)}
#side{background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;min-height:0;min-width:0}
#steps{flex:1;overflow:auto;padding:10px;-webkit-overflow-scrolling:touch}
.step{border:1px solid var(--line);border-radius:10px;margin-bottom:8px;overflow:hidden;background:#fff}
.step>h3{margin:0;font-size:13px;font-weight:600;padding:10px 12px;display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none}
.step>h3 .n{width:22px;height:22px;border-radius:50%;background:#eef2f7;color:var(--navy);display:grid;place-items:center;font-size:11px;font-weight:700;flex:none}
.step.done>h3 .n{background:var(--tealsoft);color:var(--teal2)}
.step.active{border-color:var(--teal);box-shadow:0 0 0 3px rgba(20,184,166,.12)}
.step.active>h3 .n{background:var(--teal);color:#fff}
.step .body{display:none;padding:2px 12px 12px;font-size:12.5px}
.step.active .body{display:block}
.body p{margin:6px 0;color:var(--muted);line-height:1.45}
.row{display:flex;align-items:center;gap:8px;margin:7px 0}
.row label{flex:1;color:#334155}
.row input[type=number]{width:72px;padding:5px 6px;border:1px solid var(--line);border-radius:6px;font:inherit}
.row input[type=text]{flex:1;min-width:0;padding:5px 6px;border:1px solid var(--line);border-radius:6px;font:inherit}
.row select{padding:5px;border:1px solid var(--line);border-radius:6px;font:inherit;max-width:170px;background:#fff}
.row input[type=range]{flex:1;min-width:0;accent-color:var(--teal2)}
.row input[type=checkbox]{accent-color:var(--teal2)}
.row .val{width:52px;text-align:right;font-variant-numeric:tabular-nums;color:var(--navy);font-weight:600;flex:none}
.btn{background:#fff;border:1px solid #cbd5e1;border-radius:7px;padding:6px 10px;font-size:12px;color:var(--navy)}
.btn:hover{border-color:var(--teal)}
.btn.pri{background:var(--teal2);color:#fff;border-color:var(--teal2);font-weight:600}
.btn.pri:hover{background:var(--teal)}
.btn.on{background:var(--navy);color:#fff;border-color:var(--navy)}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btns{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.seg{display:inline-flex;border:1px solid #cbd5e1;border-radius:7px;overflow:hidden;flex-wrap:nowrap}
.seg button{border:0;background:#fff;padding:6px 10px;font-size:12px;color:var(--navy);border-right:1px solid #e2e8f0}
.seg button:last-child{border-right:0}
.seg button.on{background:var(--navy);color:#fff}
.note{background:#f0fdfa;border:1px solid #99f6e4;color:#115e59;border-radius:8px;padding:7px 9px;font-size:12px;margin:8px 0;line-height:1.4}
.note.warn,.warn{background:#fffbeb;border-color:#fde68a;color:#92400e}
.note.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b}
hr{border:0;border-top:1px solid var(--line);margin:10px 0}
.h4{font-weight:600;font-size:12px;color:var(--navy);margin:10px 0 4px;text-transform:uppercase;letter-spacing:.4px}
.lead{font-size:12.5px;color:#0f172a;font-weight:500;margin:4px 0 8px;line-height:1.4}
.tip{display:none;background:#f8fafc;border-left:3px solid #99f6e4;padding:6px 8px;border-radius:0 6px 6px 0;margin:6px 0!important;font-size:11.5px!important}
.step.help .tip{display:block}
.qb{margin-left:auto;width:20px;height:20px;border-radius:50%;border:1px solid var(--line);background:#fff;color:var(--muted);font:700 11px/1 system-ui,sans-serif;cursor:pointer;display:grid;place-items:center;flex:none;padding:0}
.step.help .qb{background:var(--teal);color:#fff;border-color:var(--teal)}
.opt{font-size:9.5px;font-weight:600;color:var(--muted);background:#f1f5f9;border-radius:9px;padding:2px 7px;text-transform:uppercase;letter-spacing:.3px}
.slot{display:flex;align-items:center;gap:8px;border:1px dashed #cbd5e1;border-radius:8px;padding:7px 9px;margin:6px 0}
.slot b{width:64px;color:var(--navy);font-size:12.5px;flex:none}
.slot .fn{flex:1;font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.slot.ok{border-style:solid;border-color:#99f6e4;background:#f0fdfa}
.drop{border:2px dashed #cbd5e1;border-radius:9px;padding:14px;text-align:center;color:var(--muted);cursor:pointer;margin:6px 0}
.drop:hover,.drop.over{border-color:var(--teal);color:var(--teal2)}
.kv{font-variant-numeric:tabular-nums;color:var(--navy);font-weight:600}
table.tbl{width:100%;border-collapse:collapse;font-size:12px;margin:6px 0}
table.tbl th,table.tbl td{padding:4px 6px;border-bottom:1px solid var(--line);text-align:left}
table.tbl th{color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.3px}
table.tbl td.num,table.tbl th.num{text-align:right;font-variant-numeric:tabular-nums}
#nav{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line)}
#nav .btn{flex:1;padding:8px}
#nav #bNext{flex:2.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#view{position:relative;min-width:0;min-height:0;background:radial-gradient(ellipse at 50% 30%,#1c3a5c 0%,#0b1d31 75%);overflow:hidden}
#view canvas{display:block;touch-action:none;outline:none}
#labels{position:absolute;inset:0;pointer-events:none;overflow:hidden}
#labels .lbl{position:absolute;left:0;top:0;transform:translate(-50%,-50%);background:rgba(15,42,68,.88);color:#fff;font-size:11px;font-weight:600;padding:2px 6px;border-radius:5px;white-space:nowrap;font-variant-numeric:tabular-nums}
#viewBtns{position:absolute;right:10px;bottom:10px;display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;max-width:60%}
#viewBtns button{background:rgba(15,42,68,.8);color:#e6f0fa;border:1px solid rgba(255,255,255,.3);border-radius:6px;padding:4px 8px;font-size:11px}
#viewBtns button:hover{background:rgba(30,71,114,.95)}
.panel{position:absolute;top:10px;right:10px;background:rgba(255,255,255,.96);border-radius:10px;padding:10px;width:230px;font-size:12px;box-shadow:0 6px 24px rgba(0,0,0,.25);max-height:calc(100% - 60px);overflow:auto}
.panel .ph{all:unset;display:flex;align-items:center;width:100%;box-sizing:border-box;font-weight:600;font-size:12px;color:var(--navy);text-transform:uppercase;letter-spacing:.4px;cursor:pointer;gap:10px}
.panel .ph::after{content:"▾";margin-left:auto;color:var(--muted)}
.panel.collapsed{width:auto!important;min-width:0!important;padding:6px 9px}
.panel.collapsed .ph::after{content:"▸"}
.panel.collapsed>:not(.ph){display:none!important}
.panel .row{margin:4px 0}
.panel .row label{display:flex;align-items:center;gap:6px}
.panel input[type=range]{width:80px;flex:none}
.legend{position:absolute;left:10px;bottom:46px;background:rgba(255,255,255,.95);border-radius:9px;padding:8px 10px;font-size:11.5px;box-shadow:0 6px 24px rgba(0,0,0,.25);max-width:290px}
.legend div{display:flex;align-items:center;gap:7px;margin:3px 0}
.legend i{width:14px;height:10px;border-radius:2px;flex:none}
#hint{position:absolute;left:10px;bottom:10px;color:#cfe0f1;font-size:11.5px;background:rgba(10,25,45,.6);padding:6px 9px;border-radius:7px;max-width:38%;pointer-events:none}
#hint:empty{display:none}
#status{position:absolute;left:50%;top:12px;transform:translateX(-50%);background:var(--navy);color:#fff;font-size:12px;padding:7px 12px;border-radius:8px;opacity:0;transition:opacity .25s;pointer-events:none;max-width:60%;text-align:center;z-index:6;box-shadow:0 4px 16px rgba(0,0,0,.3)}
#status.show{opacity:1}
#status.err{background:#b91c1c}
#busy{position:absolute;inset:0;background:rgba(8,20,36,.55);display:none;place-items:center;color:#fff;font-size:14px;z-index:5}
#busy.show{display:grid}
#busy>div{background:var(--navy);padding:14px 20px;border-radius:10px;display:flex;gap:10px;align-items:center}
#busy>div::before{content:"";width:16px;height:16px;border:2px solid #5eead4;border-top-color:transparent;border-radius:50%;animation:sp .8s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
#empty{position:absolute;inset:0;display:grid;place-items:center;color:#9fb6cf;pointer-events:none;text-align:center;font-size:14px;padding:20px}
#empty b{color:#fff;font-size:18px;display:block;margin-bottom:6px}
#view.over::after{content:"Drop scan here";position:absolute;inset:12px;border:2px dashed #5eead4;border-radius:14px;display:grid;place-items:center;color:#5eead4;font-size:18px;font-weight:600;background:rgba(11,29,49,.6);pointer-events:none}
@media (max-width:820px){#app{grid-template-columns:1fr;grid-template-rows:48px 46% 1fr}#side{grid-row:3;grid-column:1;border-right:0;border-top:1px solid var(--line)}#view{grid-row:2;grid-column:1}#top .sub{display:none}.panel{width:180px;padding:6px}#hint{max-width:60%}}
@media (max-width:520px){#top{gap:8px;padding:0 8px}#top .brand{font-size:14px;gap:6px}#top .brand i{width:18px;height:18px}#topBtns{gap:4px}#top button{padding:5px 7px;font-size:11px}
#viewBtns{left:8px;right:8px;bottom:8px;max-width:none;flex-wrap:nowrap;overflow-x:auto;justify-content:flex-start;scrollbar-width:none}#viewBtns button{flex:none}
#hint{left:8px;right:8px;bottom:42px;max-width:none}.panel{top:8px;right:8px}}
html.embed #app{grid-template-rows:1fr}
html.embed #top{position:absolute;z-index:4;left:350px;top:10px;height:auto;background:none;padding:0;gap:0}
html.embed #top .brand,html.embed #top .sub,html.embed #top .sp{display:none}
html.embed #top button{background:rgba(15,42,68,.82);border-color:rgba(255,255,255,.3)}
html.embed #top button.on{background:var(--teal2);border-color:var(--teal)}
@media (max-width:820px){html.embed #app{grid-template-rows:46% 1fr}html.embed #view{grid-row:1}html.embed #side{grid-row:2}html.embed #top{left:8px;top:8px}}
`;

// Where the page is hosted can set  window.NOTILE = { fonts: false | 'url of a stylesheet', family: "'Source Sans 3'", home: '/', homeTitle: '…' }
// before the page's script: the font stylesheet to load (false: the page brings its own), the font family to put first,
// and where the app's name in the top bar links to. Without it the page loads Inter from Google Fonts and has no home link.
const SITE = (typeof window !== 'undefined' && window.NOTILE) || {};
/** the font stack, for anything drawn outside CSS (a canvas report, say) */
export const FONT = (SITE.family ? SITE.family + ', ' : '') + 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
let cssDone = false;
export function injectCSS() {
  if (cssDone || typeof document === 'undefined') return; cssDone = true;
  if (SITE.fonts !== false) document.head.appendChild(el('link', { rel: 'stylesheet', href: SITE.fonts || 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap' }));
  const s = el('style'); s.textContent = SITE.family ? CSS.replace('font-family:Inter,', `font-family:${SITE.family},Inter,`) : CSS; document.head.appendChild(s);
}

/**
 * Build the standard app shell.
 *   const shell = createShell({ name:'Model Card', tagline:'…', steps:[{id:'load', title:'Load scans', optional:false, html:'…'}],
 *                               emptyHtml:'<b>…</b>…', onStep:(i, prev)=>{}, onDropFiles:(files)=>{} });
 * shell.view  → the viewport element (give it to createViewer)
 * shell.goto(i|id), shell.current, shell.markDone(i|id, bool), shell.stepEl(i|id) → .step element
 * shell.status(text, isError), shell.hint(html), shell.busy(label, asyncFn), shell.setEmpty(bool)
 * shell.topButton(label, title, onClick) → button, shell.viewButton(label, title, onClick), shell.panel(html) → element
 */
export function createShell(cfg) {
  injectCSS();
  if (cfg.title) document.title = cfg.title;
  if (EMBED) { document.documentElement.classList.add('embed'); cfg = { ...cfg, emptyHtml: '<div><b>No scans yet</b>Load them on the Scans tab.</div>' }; }
  if (!cfg.home && SITE.home) cfg = { ...cfg, home: SITE.home, homeTitle: SITE.homeTitle };
  const brand = cfg.home ? `<a class="brand" href="${esc(cfg.home)}" title="${esc(cfg.homeTitle || 'Home')}"><i></i><span>${esc(cfg.name)}</span></a>` : `<div class="brand"><i></i><span>${esc(cfg.name)}</span></div>`;
  const root = el('div', { id: 'app' }, `
  <div id="top">${brand}<div class="sub">${esc(cfg.tagline || '')}</div><div class="sp"></div><div id="topBtns"></div></div>
  <div id="side"><div id="steps"></div><div id="nav"><button class="btn" id="bBack" type="button" title="Previous step">Back</button><button class="btn pri" id="bNext" type="button" title="Next step">Next</button></div></div>
  <div id="view"><div id="empty">${cfg.emptyHtml || ''}</div><div id="labels"></div><div id="viewBtns"></div><div id="hint"></div><div id="status"></div><div id="busy"><div><span id="busyText">Working…</span></div></div></div>`);
  document.body.appendChild(root);
  const stepsEl = $('steps'), steps = cfg.steps || [];
  steps.forEach((s, i) => {
    const d = el('div', { class: 'step', 'data-i': i, 'data-id': s.id }, `<h3><span class="n">${i + 1}</span><span>${esc(s.title)}</span>${s.optional ? '<span class="opt">optional</span>' : ''}<button class="qb" title="Show tips" type="button">?</button></h3><div class="body">${s.html || ''}</div>`);
    stepsEl.appendChild(d);
    d.querySelector('h3').addEventListener('click', (e) => { if (e.target.closest('.qb')) { d.classList.toggle('help'); return; } shell.goto(i); });
  });
  const idx = (k) => (typeof k === 'number' ? k : steps.findIndex((s) => s.id === k));
  let statusTimer = 0; const stepFns = [], gone = new Set(), shown = (i) => i >= 0 && i < steps.length && !gone.has(i);
  const nextShown = (i, dir) => { for (let j = i + dir; j >= 0 && j < steps.length; j += dir) if (shown(j)) return j; return -1; };
  const shell = {
    root, view: $('view'), steps, current: -1, onStep: cfg.onStep || null,
    stepEl: (k) => stepsEl.children[idx(k)],
    goto(k) {
      let i = clamp(idx(k), 0, steps.length - 1); const prev = shell.current;
      if (!shown(i)) { const f = nextShown(i, 1); i = f >= 0 ? f : nextShown(i, -1); if (i < 0) return; }   // a hidden step: go to the nearest one that is shown
      if (shell.canLeave && prev >= 0 && i !== prev && shell.canLeave(prev, i) === false) return;
      shell.current = i;
      [...stepsEl.children].forEach((c, j) => c.classList.toggle('active', j === i));
      const nx = nextShown(i, 1);
      $('bBack').disabled = nextShown(i, -1) < 0;
      $('bNext').textContent = nx >= 0 ? `Next: ${steps[nx].title} →` : (cfg.lastLabel || 'Done');
      $('bNext').disabled = nx < 0 && !cfg.onFinish;
      const a = stepsEl.children[i]; if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest' });
      if (shell.onStep) shell.onStep(i, prev);
      for (const f of stepFns) f(i, prev);
    },
    /** extra listeners for step changes: fn(index, previousIndex) */
    onStepChange(fn) { stepFns.push(fn); },
    /** take a step out of the list (inside Scan Card the scans are loaded once, on its Scans tab); the rest are renumbered */
    hideStep(k) { const i = idx(k); if (i < 0) return; gone.add(i); stepsEl.children[i].hidden = true; let n = 0; [...stepsEl.children].forEach((c, j) => { if (shown(j)) c.querySelector('.n').textContent = ++n; }); if (shell.current === i) shell.goto(i); },
    markDone(k, v = true) { const c = stepsEl.children[idx(k)]; if (c) c.classList.toggle('done', !!v); },
    status(text, isErr) { const s = $('status'); s.textContent = text; s.classList.toggle('err', !!isErr); s.classList.add('show'); clearTimeout(statusTimer); statusTimer = setTimeout(() => s.classList.remove('show'), isErr ? 6000 : 3200); },
    hint(html) { $('hint').innerHTML = html || ''; },
    setEmpty(v) { $('empty').hidden = !v; },
    async busy(label, fn) {
      $('busyText').textContent = label || 'Working…'; $('busy').classList.add('show');
      await sleep(30);
      try { return await fn(); } catch (e) { console.error(e); shell.status(String((e && e.message) || e), true); throw e; } finally { $('busy').classList.remove('show'); }
    },
    setBusyText(t) { $('busyText').textContent = t; },
    topButton(label, title, fn) { const b = el('button', { title: title || '', type: 'button' }); b.textContent = label; b.addEventListener('click', fn); $('topBtns').appendChild(b); return b; },
    viewButton(label, title, fn) { const b = el('button', { title: title || '', type: 'button' }); b.textContent = label; b.addEventListener('click', fn); $('viewBtns').appendChild(b); return b; },
    panel(html, cls = 'panel') { const p = el('div', { class: cls }, html); shell.view.appendChild(p); return p; },
  };
  $('bBack').addEventListener('click', () => { const j = nextShown(shell.current, -1); if (j >= 0) shell.goto(j); });
  $('bNext').addEventListener('click', () => { const j = nextShown(shell.current, 1); if (j < 0) { if (cfg.onFinish) cfg.onFinish(); } else shell.goto(j); });
  // drag and drop of files onto the viewport
  const v = shell.view;
  v.addEventListener('dragover', (e) => { e.preventDefault(); v.classList.add('over'); });
  v.addEventListener('dragleave', () => v.classList.remove('over'));
  v.addEventListener('drop', (e) => { e.preventDefault(); v.classList.remove('over'); const fs = [...(e.dataTransfer.files || [])]; if (fs.length && cfg.onDropFiles) cfg.onDropFiles(fs); });
  return shell;
}

/** Wire a `.seg` button group: segBind(el, value => {...}); buttons carry data-v. Returns setter(value). */
export function segBind(segEl, onChange, initial) {
  const set = (v, fire) => { [...segEl.children].forEach((b) => b.classList.toggle('on', b.dataset.v === String(v))); if (fire && onChange) onChange(v); };
  segEl.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && !b.disabled) set(b.dataset.v, true); });
  if (initial !== undefined) set(initial, false);
  return set;
}
/** Wire a range input with a live value readout: rangeBind('id', v => {...}, {fmt:v=>v.toFixed(1)+' mm', live:true}) */
export function rangeBind(input, onChange, o = {}) {
  const inp = typeof input === 'string' ? $(input) : input, out = inp.parentElement.querySelector('.val');
  const f = o.fmt || ((v) => String(v));
  const upd = () => { if (out) out.textContent = f(parseFloat(inp.value)); };
  inp.addEventListener('input', () => { upd(); if (o.live !== false && onChange) onChange(parseFloat(inp.value), false); });
  inp.addEventListener('change', () => { upd(); if (onChange) onChange(parseFloat(inp.value), true); });
  upd();
  return { get: () => parseFloat(inp.value), set: (v) => { inp.value = v; upd(); } };
}

// ───────────────────────────── 3D viewer ─────────────────────────────
export const COLORS = { scan: 0xe9dcc6, scanBack: 0x8a7f70, opposing: 0xb9c7d6, model: 0xd9c9a8, design: 0x2dd4bf, designAlt: 0x60a5fa, accent: 0xe879f9, warn: 0xf59e0b };
export const materials = {
  scan: (o = {}) => new THREE.MeshStandardMaterial({ color: COLORS.scan, roughness: 0.62, metalness: 0.02, side: THREE.DoubleSide, ...o }),
  opposing: (o = {}) => new THREE.MeshStandardMaterial({ color: COLORS.opposing, roughness: 0.7, metalness: 0.02, side: THREE.DoubleSide, transparent: true, opacity: 0.85, ...o }),
  model: (o = {}) => new THREE.MeshStandardMaterial({ color: COLORS.model, roughness: 0.75, metalness: 0.0, side: THREE.DoubleSide, ...o }),
  design: (o = {}) => new THREE.MeshStandardMaterial({ color: COLORS.design, roughness: 0.35, metalness: 0.05, side: THREE.DoubleSide, transparent: true, opacity: 0.9, ...o }),
};

/**
 * createViewer(containerEl, { ortho:false }) → viewer
 *  viewer.scene / camera / renderer / controls
 *  viewer.invalidate()                      render on the next frame (rendering is on demand, not a loop)
 *  viewer.fit(objectOrBox3?, {dir:[x,y,z]}) frame everything (or the given object/box)
 *  viewer.setView('front'|'back'|'left'|'right'|'top'|'bottom'|'iso')
 *  viewer.pick(clientX, clientY, meshes) → { point, normal, faceIndex, object, distance } | null
 *  viewer.setTool(tool|null)                tool = { cursor, onDown(i)→true to capture the drag, onMove(i), onUp(i), onClick(i), onKey(e) }
 *                                           (a press that does not move gives onUp and then onClick; a tap may wobble 5 px with a mouse, 10 px with a finger or pencil)
 *                                           i = { x, y, clientX, clientY, button, shift, alt, ctrl, pointerType, pressure, dragging, pick(meshes), event }
 *  viewer.toScreen(vec3) → {x, y, visible}  viewer.label(text, vec3) → {el, pos, remove()}
 *  viewer.marker(vec3, {color, px}) → Sprite (a round dot `px` screen pixels across, whatever the zoom; change sprite.userData.px to resize)     viewer.line(points, {color, width, closed, depthTest}) → Line2 (line.setPoints(pts))
 *  viewer.snapshot() → PNG data URL          viewer.onRender(fn)
 */
export function createViewer(container, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const dom = renderer.domElement; dom.tabIndex = 0;
  container.insertBefore(dom, container.firstChild);
  const scene = new THREE.Scene();
  const camera = opts.ortho ? new THREE.OrthographicCamera(-50, 50, 50, -50, -2000, 4000) : new THREE.PerspectiveCamera(26, 1, 1, 5000);
  camera.up.set(0, 0, 1); camera.position.set(60, -230, 120);
  scene.add(camera);
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-0.4, 0.7, 1);
  const fill = new THREE.DirectionalLight(0xdfe9ff, 0.9); fill.position.set(0.8, -0.3, 0.6);
  camera.add(key, key.target, fill, fill.target); key.target.position.set(0, 0, -1); fill.target.position.set(0, 0, -1);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x54657a, 1.15));

  // our pointer handling is registered BEFORE OrbitControls so a tool can claim a drag first
  let tool = null, cap = null, down = null;
  const raycaster = new THREE.Raycaster(); raycaster.firstHitOnly = true;
  const ndc = new THREE.Vector2();
  function pick(clientX, clientY, objects) {
    const r = dom.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const list = (Array.isArray(objects) ? objects : [objects]).filter((o) => o && o.visible !== false);
    const hits = raycaster.intersectObjects(list, false);
    if (!hits.length) return null;
    const h = hits[0];
    const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 0, 1);
    return { point: h.point.clone(), normal, faceIndex: h.faceIndex, object: h.object, distance: h.distance, ray: raycaster.ray.clone() };
  }
  const info = (e, dragging) => { const r = dom.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, clientX: e.clientX, clientY: e.clientY, button: e.button, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, pointerType: e.pointerType, pressure: e.pressure, dragging: !!dragging, pick: (objs) => pick(e.clientX, e.clientY, objs), event: e }; };
  dom.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, t: performance.now() };
    if (!tool || !e.isPrimary) return;
    if (tool.onDown && tool.onDown(info(e, false)) === true) {
      cap = e.pointerId; controls.enabled = false; try { dom.setPointerCapture(e.pointerId); } catch (_) {}
      e.stopImmediatePropagation(); e.preventDefault();
    }
  }, true);
  dom.addEventListener('pointermove', (e) => {
    if (down && e.pointerId === down.id && Math.hypot(e.clientX - down.x, e.clientY - down.y) > (e.pointerType === 'mouse' ? 5 : 10)) down.moved = true;
    if (!tool) return;
    if (cap !== null) { if (e.pointerId === cap && tool.onMove) tool.onMove(info(e, true)); e.stopImmediatePropagation(); return; }
    if (e.buttons === 0 && tool.onMove) tool.onMove(info(e, false));
  }, true);
  const end = (e) => {
    const wasCap = cap !== null && e.pointerId === cap;
    if (wasCap) { cap = null; controls.enabled = true; try { dom.releasePointerCapture(e.pointerId); } catch (_) {} if (tool && tool.onUp) tool.onUp(info(e, true)); e.stopImmediatePropagation(); }
    if (tool && tool.onClick && down && e.pointerId === down.id && !down.moved && e.type === 'pointerup' && (performance.now() - down.t) < 700) tool.onClick(info(e, false));
    if (down && e.pointerId === down.id) down = null;
  };
  dom.addEventListener('pointerup', end, true);
  dom.addEventListener('pointercancel', end, true);
  dom.addEventListener('contextmenu', (e) => e.preventDefault());
  dom.addEventListener('keydown', (e) => { if (tool && tool.onKey) tool.onKey(e); });

  const controls = new OrbitControls(camera, dom);
  controls.enableDamping = false; controls.rotateSpeed = 0.9; controls.zoomSpeed = 1.15; controls.screenSpacePanning = true;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  const renderFns = [], lineMats = new Set(), labels = [], dots = new Set();
  const dotScale = () => (camera.isOrthographicCamera ? (camera.top - camera.bottom) / camera.zoom / H : 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / H);   // sprite scale for one screen pixel
  const labelRoot = container.querySelector('#labels') || container.appendChild(el('div', { id: 'labels' }));
  let need = true, raf = 0, W = 1, H = 1;
  const tmp = new THREE.Vector3();
  function toScreen(v) { tmp.copy(v).project(camera); return { x: (tmp.x * 0.5 + 0.5) * W, y: (-tmp.y * 0.5 + 0.5) * H, visible: tmp.z > -1 && tmp.z < 1 }; }
  function render() {
    raf = 0; if (!need) return; need = false;
    if (dots.size) { const k = dotScale(); for (const sp of dots) { if (!sp.parent) { dots.delete(sp); continue; } const w = sp.userData.px * k; sp.scale.set(w, w, 1); } }
    renderer.render(scene, camera);
    for (const l of labels) { const s = toScreen(l.pos); l.el.style.transform = `translate(-50%,-50%) translate(${s.x + (l.dx || 0)}px,${s.y + (l.dy || 0)}px)`; l.el.style.display = s.visible && !l.hidden ? '' : 'none'; }
    for (const f of renderFns) f();
  }
  const invalidate = () => { need = true; if (!raf) raf = requestAnimationFrame(render); };
  controls.addEventListener('change', invalidate);
  function resize() {
    const r = container.getBoundingClientRect(); W = Math.max(1, Math.floor(r.width)); H = Math.max(1, Math.floor(r.height));
    renderer.setSize(W, H, false); dom.style.width = W + 'px'; dom.style.height = H + 'px';
    if (camera.isPerspectiveCamera) camera.aspect = W / H; else { const hh = (camera.top - camera.bottom) / 2 || 50; camera.left = -hh * W / H; camera.right = hh * W / H; }
    camera.updateProjectionMatrix();
    for (const m of lineMats) m.resolution.set(W, H);
    invalidate();
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(container); else window.addEventListener('resize', resize);
  resize();

  const VIEWS = { front: [0, -1, 0.0], back: [0, 1, 0.0], left: [1, 0, 0], right: [-1, 0, 0], top: [0, -0.0015, 1], bottom: [0, -0.0015, -1], iso: [0.55, -0.9, 0.62] };
  let radius = 60;
  function setDir(dir, center, r) {
    if (center) controls.target.copy(center); if (r) radius = r;
    const d = new THREE.Vector3(...dir).normalize();
    const dist = camera.isPerspectiveCamera ? radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.08 / Math.min(1, camera.aspect * 0.95 + 0.05) : radius * 4;
    camera.position.copy(controls.target).addScaledVector(d, dist);
    if (camera.isOrthographicCamera) { const hh = radius * 1.1 / Math.min(1, W / H); camera.top = hh; camera.bottom = -hh; camera.left = -hh * W / H; camera.right = hh * W / H; camera.zoom = 1; }
    camera.near = camera.isPerspectiveCamera ? Math.max(1, dist / 200) : -4000; camera.far = dist * 6 + 2000; camera.updateProjectionMatrix();
    camera.lookAt(controls.target); controls.update(); invalidate();
  }
  function fit(target, o = {}) {
    const box = new THREE.Box3();
    if (target && target.isBox3) box.copy(target); else if (target) box.setFromObject(target); else scene.traverse((c) => { if (!c.isMesh || c.userData.noFit) return; for (let q = c; q; q = q.parent) if (!q.visible) return; box.expandByObject(c); });
    if (box.isEmpty()) return;
    const s = box.getBoundingSphere(new THREE.Sphere());
    const dir = o.dir || camera.position.clone().sub(controls.target).normalize().toArray();
    setDir(dir, s.center, Math.max(5, s.radius));
  }
  const viewer = {
    scene, camera, renderer, controls, dom, container, invalidate, pick, toScreen, fit,
    setView(name) { setDir(VIEWS[name] || VIEWS.iso); },
    setTool(t) { tool = t || null; dom.style.cursor = (t && t.cursor) || ''; },
    get tool() { return tool; },
    onRender(fn) { renderFns.push(fn); },
    get size() { return { w: W, h: H }; },
    label(text, pos, o = {}) { const e = el('div', { class: 'lbl' + (o.class ? ' ' + o.class : '') }); e.textContent = text; if (o.color) e.style.background = o.color; labelRoot.appendChild(e); const l = { el: e, pos: pos.clone(), dx: o.dx || 0, dy: o.dy || 0, hidden: false, set(t) { e.textContent = t; }, remove() { e.remove(); const i = labels.indexOf(l); if (i >= 0) labels.splice(i, 1); } }; labels.push(l); invalidate(); return l; },
    clearLabels() { while (labels.length) labels[0].remove(); },
    marker(pos, o = {}) { const sp = new THREE.Sprite(dotMaterial(o.color ?? COLORS.accent, o.depthTest)); sp.userData.px = o.px || 16; { const w = sp.userData.px * dotScale(); sp.scale.set(w, w, 1); } dots.add(sp); sp.position.copy(pos); sp.renderOrder = 999; sp.userData.noFit = true; scene.add(sp); invalidate(); return sp; },
    line(points, o = {}) {
      const mat = new LineMaterial({ color: o.color ?? COLORS.accent, linewidth: o.width || 2.5, worldUnits: false, depthTest: o.depthTest !== false, transparent: true, opacity: o.opacity ?? 1, dashed: !!o.dashed, dashSize: 1, gapSize: 0.7 });
      mat.resolution.set(W, H); lineMats.add(mat);
      const ln = new Line2(new LineGeometry(), mat); ln.userData.noFit = true; ln.renderOrder = 998; ln.frustumCulled = false;
      ln.setPoints = (pts, closed = o.closed) => { const a = []; for (const p of pts) a.push(p.x, p.y, p.z); if (closed && pts.length > 2) a.push(pts[0].x, pts[0].y, pts[0].z); if (a.length < 6) { ln.visible = false; return; } ln.visible = true; ln.geometry.dispose(); ln.geometry = new LineGeometry(); ln.geometry.setPositions(a); if (o.dashed) ln.computeLineDistances(); invalidate(); };
      ln.dispose = () => { scene.remove(ln); ln.geometry.dispose(); mat.dispose(); lineMats.delete(mat); invalidate(); };
      ln.setPoints(points || []); scene.add(ln); return ln;
    },
    snapshot() { need = true; render(); return dom.toDataURL('image/png'); },
    add(obj) { scene.add(obj); invalidate(); return obj; },
    remove(obj) { if (!obj) return; scene.remove(obj); if (obj.geometry) obj.geometry.dispose(); invalidate(); },
  };
  return viewer;
}

const dotMats = new Map();
function dotMaterial(color, depthTest) {
  const k = color + (depthTest ? 'd' : '');
  if (dotMats.has(k)) return dotMats.get(k);
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.fillStyle = '#' + new THREE.Color(color).getHexString(); g.fill(); g.lineWidth = 6; g.strokeStyle = '#fff'; g.stroke();
  const m = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), sizeAttenuation: false, depthTest: !!depthTest, transparent: true });
  dotMats.set(k, m); return m;
}

/** Standard view buttons (Front, Top, …, Fit) into the shell's bottom-right cluster. */
export function addViewButtons(shell, viewer, names = ['front', 'top', 'bottom', 'left', 'right', 'back']) {
  const T = { front: 'Front', back: 'Back', left: "Patient's left", right: "Patient's right", top: 'From above', bottom: 'From below', iso: '3D' };
  for (const n of names) shell.viewButton(n[0].toUpperCase() + n.slice(1), T[n], () => viewer.setView(n));
  shell.viewButton('Fit', 'Fit everything in view', () => viewer.fit());
}

// ───────────────────────────── mesh data ─────────────────────────────
/** Merge bit-identical vertices (what an STL needs) and drop triangles that collapse. Returns a new mesh. */
export function weld(positions, indices = null, colors = null) {
  const pos = new Float32Array(positions), n = pos.length / 3;
  for (let i = 0; i < pos.length; i++) if (pos[i] === 0) pos[i] = 0;            // −0 → +0 so the bit patterns match
  const bits = new Uint32Array(pos.buffer, 0, n * 3);
  let cap = 1024; while (cap < n * 2) cap <<= 1; const mask = cap - 1;
  const table = new Int32Array(cap).fill(-1), remap = new Uint32Array(n), first = new Uint32Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const a = bits[3 * i], b = bits[3 * i + 1], c = bits[3 * i + 2];
    let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) & mask;
    for (;;) {
      const j = table[h];
      if (j < 0) { table[h] = m; first[m] = i; remap[i] = m++; break; }
      const k = first[j];
      if (bits[3 * k] === a && bits[3 * k + 1] === b && bits[3 * k + 2] === c) { remap[i] = j; break; }
      h = (h + 1) & mask;
    }
  }
  const P = new Float32Array(m * 3), C = colors ? new Float32Array(m * 3) : null;
  for (let j = 0; j < m; j++) { const k = first[j] * 3; P[3 * j] = pos[k]; P[3 * j + 1] = pos[k + 1]; P[3 * j + 2] = pos[k + 2]; if (C) { C[3 * j] = colors[k]; C[3 * j + 1] = colors[k + 1]; C[3 * j + 2] = colors[k + 2]; } }
  const nT = Math.floor((indices ? indices.length : n) / 3), I = new Uint32Array(nT * 3);
  let t = 0;
  for (let f = 0; f < nT; f++) {
    const a = remap[indices ? indices[3 * f] : 3 * f], b = remap[indices ? indices[3 * f + 1] : 3 * f + 1], c = remap[indices ? indices[3 * f + 2] : 3 * f + 2];
    if (a === b || b === c || a === c) continue;
    I[t++] = a; I[t++] = b; I[t++] = c;
  }
  return { positions: P, indices: I.slice(0, t), colors: C, dropped: nT - t / 3 };
}

/** Drop vertices no triangle uses. */
export function compact(mesh) {
  const P = mesh.positions, I = mesh.indices, n = P.length / 3, map = new Int32Array(n).fill(-1);
  let m = 0; for (let i = 0; i < I.length; i++) if (map[I[i]] < 0) map[I[i]] = m++;
  if (m === n) return mesh;
  const P2 = new Float32Array(m * 3), C2 = mesh.colors ? new Float32Array(m * 3) : null, I2 = new Uint32Array(I.length);
  for (let i = 0; i < n; i++) { const j = map[i]; if (j < 0) continue; P2[3 * j] = P[3 * i]; P2[3 * j + 1] = P[3 * i + 1]; P2[3 * j + 2] = P[3 * i + 2]; if (C2) { C2[3 * j] = mesh.colors[3 * i]; C2[3 * j + 1] = mesh.colors[3 * i + 1]; C2[3 * j + 2] = mesh.colors[3 * i + 2]; } }
  for (let i = 0; i < I.length; i++) I2[i] = map[I[i]];
  return { ...mesh, positions: P2, indices: I2, colors: C2 };
}

export function meshBounds(mesh) {
  const P = mesh.positions, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { const v = P[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]], center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] };
}

/** New mesh with every vertex moved by a THREE.Matrix4 (winding is flipped if the matrix mirrors). */
export function transformMesh(mesh, matrix) {
  const e = matrix.elements, P = mesh.positions, Q = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1], z = P[i + 2]; Q[i] = e[0] * x + e[4] * y + e[8] * z + e[12]; Q[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; Q[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]; }
  let I = mesh.indices;
  if (matrix.determinant() < 0) { I = new Uint32Array(I); for (let t = 0; t < I.length; t += 3) { const s = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = s; } }
  return { ...mesh, positions: Q, indices: I };
}

export function mergeMeshes(list) {
  let nv = 0, ni = 0; for (const m of list) { nv += m.positions.length; ni += m.indices.length; }
  const P = new Float32Array(nv), I = new Uint32Array(ni); let pv = 0, pi = 0;
  for (const m of list) { P.set(m.positions, pv); const off = pv / 3; for (let i = 0; i < m.indices.length; i++) I[pi + i] = m.indices[i] + off; pv += m.positions.length; pi += m.indices.length; }
  return { positions: P, indices: I, colors: null };
}

/** Signed volume (mm³; positive when triangles face outward) and surface area (mm²). */
export function meshVolume(mesh) {
  const P = mesh.positions, I = mesh.indices; let v = 0;
  for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3; v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]); }
  return v / 6;
}
export function meshArea(mesh) {
  const P = mesh.positions, I = mesh.indices; let s = 0;
  for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3; const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]; s += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx); }
  return s / 2;
}
/** Area-weighted vertex normals as Float32Array(3n). */
export function vertexNormals(mesh) {
  const P = mesh.positions, I = mesh.indices, N = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3; const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]; const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; N[a] += nx; N[a + 1] += ny; N[a + 2] += nz; N[b] += nx; N[b + 1] += ny; N[b + 2] += nz; N[c] += nx; N[c + 1] += ny; N[c + 2] += nz; }
  for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  return N;
}

/** Per-corner normals that stay smooth on curved surfaces but break across edges sharper than `deg` (fast; no vertex hashing). */
function creasedArrays(mesh, deg) {
  const P = mesh.positions, I = mesh.indices, C = mesh.colors, nT = I.length / 3, nV = P.length / 3, cosT = Math.cos(deg * Math.PI / 180);
  const FN = new Float32Array(nT * 3), FU = new Float32Array(nT * 3), start = new Uint32Array(nV + 2);
  for (let t = 0; t < nT; t++) {
    const a = I[3 * t] * 3, b = I[3 * t + 1] * 3, c = I[3 * t + 2] * 3, ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    FN[3 * t] = nx; FN[3 * t + 1] = ny; FN[3 * t + 2] = nz; FU[3 * t] = nx / l; FU[3 * t + 1] = ny / l; FU[3 * t + 2] = nz / l;
    start[I[3 * t] + 2]++; start[I[3 * t + 1] + 2]++; start[I[3 * t + 2] + 2]++;
  }
  for (let v = 0; v < nV; v++) start[v + 2] += start[v + 1];
  const adj = new Uint32Array(I.length);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) adj[start[I[3 * t + k] + 1]++] = t;
  const pos = new Float32Array(nT * 9), nor = new Float32Array(nT * 9), col = C ? new Float32Array(nT * 9) : null;
  for (let t = 0; t < nT; t++) {
    const tx = FU[3 * t], ty = FU[3 * t + 1], tz = FU[3 * t + 2];
    for (let k = 0; k < 3; k++) {
      const v = I[3 * t + k], o = 9 * t + 3 * k; let nx = 0, ny = 0, nz = 0;
      for (let q = start[v], e = start[v + 1]; q < e; q++) { const f = adj[q] * 3; if (FU[f] * tx + FU[f + 1] * ty + FU[f + 2] * tz >= cosT) { nx += FN[f]; ny += FN[f + 1]; nz += FN[f + 2]; } }
      const l = Math.hypot(nx, ny, nz) || 1; nor[o] = nx / l; nor[o + 1] = ny / l; nor[o + 2] = nz / l;
      pos[o] = P[3 * v]; pos[o + 1] = P[3 * v + 1]; pos[o + 2] = P[3 * v + 2]; if (col) { col[o] = C[3 * v]; col[o + 1] = C[3 * v + 1]; col[o + 2] = C[3 * v + 2]; }
    }
  }
  return { pos, nor, col };
}
/** MeshData → THREE.BufferGeometry (with BVH for fast picking). o.crease (degrees) gives crisp edges on CAD solids
 *  (the geometry is then un-indexed: triangle t = vertices 3t, 3t+1, 3t+2, in the mesh's own triangle order). */
export function toGeometry(mesh, o = {}) {
  const g = new THREE.BufferGeometry();
  if (o.crease) {
    const c = creasedArrays(mesh, o.crease);
    g.setAttribute('position', new THREE.BufferAttribute(c.pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(c.nor, 3)); if (c.col) g.setAttribute('color', new THREE.BufferAttribute(c.col, 3));
  } else {
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    if (mesh.colors) g.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3));
    g.computeVertexNormals();
  }
  if (o.bvh !== false) g.computeBoundsTree({ indirect: true });       // indirect: keeps our triangle order, so hit.faceIndex is the mesh's face
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}
/** Closest point on a THREE.Mesh (world space in, world space out) → { point, distance, faceIndex } */
export function closestOnMesh(obj, worldPoint) {
  const inv = obj.matrixWorld.clone().invert(), p = worldPoint.clone().applyMatrix4(inv), out = {};
  obj.geometry.boundsTree.closestPointToPoint(p, out);
  return { point: out.point.clone().applyMatrix4(obj.matrixWorld), distance: out.distance, faceIndex: out.faceIndex };
}

// ───────────────────────────── topology ─────────────────────────────
// Half-edge h = 3*face + corner runs from indices[h] to indices[next(h)].
const nextH = (h) => h - (h % 3) + ((h + 1) % 3);
/** twin[h] = opposite half-edge, −1 on an open border, −2 on an edge shared by 3+ triangles. same[h]=1 when the pair runs the same way (inconsistent winding). */
export function buildTwins(I) {
  const nh = I.length; let cap = 1024; while (cap < nh * 2) cap <<= 1; const mask = cap - 1;
  const slot = new Int32Array(cap).fill(-1), cnt = new Uint8Array(cap), twin = new Int32Array(nh).fill(-1), same = new Uint8Array(nh);
  let nonManifold = 0;
  for (let h = 0; h < nh; h++) {
    const a = I[h], b = I[nextH(h)], lo = a < b ? a : b, hi = a < b ? b : a;
    let s = (Math.imul(lo, 73856093) ^ Math.imul(hi, 19349663)) & mask;
    for (;;) {
      const g = slot[s];
      if (g < 0) { slot[s] = h; cnt[s] = 1; break; }
      const ga = I[g], gb = I[nextH(g)];
      if ((ga === a && gb === b) || (ga === b && gb === a)) {
        if (cnt[s] === 1) { twin[g] = h; twin[h] = g; if (ga === a) same[g] = same[h] = 1; cnt[s] = 2; }
        else { if (cnt[s] === 2) { const g2 = twin[g]; twin[g] = -2; if (g2 >= 0) twin[g2] = -2; cnt[s] = 3; nonManifold++; } twin[h] = -2; }
        break;
      }
      s = (s + 1) & mask;
    }
  }
  return { twin, same, nonManifold };
}

function dropDuplicateFaces(I) {
  const nF = I.length / 3; let cap = 1024; while (cap < nF * 2) cap <<= 1; const mask = cap - 1;
  const slot = new Int32Array(cap).fill(-1), keep = new Uint8Array(nF); let kept = 0;
  const key = (f, o) => { let a = I[3 * f], b = I[3 * f + 1], c = I[3 * f + 2], t; if (a > b) { t = a; a = b; b = t; } if (b > c) { t = b; b = c; c = t; } if (a > b) { t = a; a = b; b = t; } o[0] = a; o[1] = b; o[2] = c; };
  const k1 = [0, 0, 0], k2 = [0, 0, 0];
  for (let f = 0; f < nF; f++) {
    key(f, k1); let s = (Math.imul(k1[0], 73856093) ^ Math.imul(k1[1], 19349663) ^ Math.imul(k1[2], 83492791)) & mask, dup = false;
    for (;;) { const g = slot[s]; if (g < 0) { slot[s] = f; break; } key(g, k2); if (k1[0] === k2[0] && k1[1] === k2[1] && k1[2] === k2[2]) { dup = true; break; } s = (s + 1) & mask; }
    if (!dup) { keep[f] = 1; kept++; }
  }
  if (kept === nF) return I;
  const out = new Uint32Array(kept * 3); let t = 0;
  for (let f = 0; f < nF; f++) if (keep[f]) { out[t++] = I[3 * f]; out[t++] = I[3 * f + 1]; out[t++] = I[3 * f + 2]; }
  return out;
}

/**
 * Make a scan safe to work with: weld, drop collapsed / duplicate / non-manifold triangles, make the winding
 * consistent, and drop small floating islands.  o.islandFraction (default 0.04) = keep parts with at least this
 * fraction of the biggest part's triangles; o.keepIslands = keep everything.
 * → { mesh, report:{ inputTris, tris, degenerate, duplicate, nonManifold, flipped, conflicts, parts, islandsRemoved, islandTris } }
 */
export function cleanMesh(mesh, o = {}) {
  const rep = { inputTris: mesh.indices.length / 3, degenerate: 0, duplicate: 0, nonManifold: 0, flipped: 0, conflicts: 0, parts: 0, islandsRemoved: 0, islandTris: 0 };
  const w = weld(mesh.positions, mesh.indices, mesh.colors); rep.degenerate = w.dropped;
  let I = w.indices;
  const d = dropDuplicateFaces(I); rep.duplicate = (I.length - d.length) / 3; I = d;
  for (let pass = 0; pass < 6; pass++) {
    const tw = buildTwins(I); if (!tw.nonManifold) break;
    const out = new Uint32Array(I.length); let t = 0;
    for (let f = 0; f < I.length / 3; f++) { if (tw.twin[3 * f] === -2 || tw.twin[3 * f + 1] === -2 || tw.twin[3 * f + 2] === -2) continue; out[t++] = I[3 * f]; out[t++] = I[3 * f + 1]; out[t++] = I[3 * f + 2]; }
    rep.nonManifold += (I.length - t) / 3; I = out.slice(0, t);
  }
  const { twin, same } = buildTwins(I), nF = I.length / 3;
  const comp = new Int32Array(nF).fill(-1), flip = new Uint8Array(nF), sizes = [], flips = [], stack = [];
  for (let f0 = 0; f0 < nF; f0++) {
    if (comp[f0] >= 0) continue;
    const c = sizes.length; let size = 0, nflip = 0; comp[f0] = c; stack.push(f0);
    while (stack.length) {
      const f = stack.pop(); size++; nflip += flip[f];
      for (let e = 0; e < 3; e++) { const h = 3 * f + e, g = twin[h]; if (g < 0) continue; const nf = (g / 3) | 0, want = flip[f] ^ same[h]; if (comp[nf] < 0) { comp[nf] = c; flip[nf] = want; stack.push(nf); } else if (flip[nf] !== want) rep.conflicts++; }
    }
    sizes.push(size); flips.push(nflip);
  }
  const big = Math.max(0, ...sizes), minKeep = o.keepIslands ? 0 : Math.max(o.minTris || 0, big * (o.islandFraction ?? 0.04));
  const out = new Uint32Array(I.length); let t = 0;
  for (let f = 0; f < nF; f++) {
    const c = comp[f]; if (sizes[c] < minKeep) continue;
    const fl = flips[c] > sizes[c] / 2 ? 1 - flip[f] : flip[f]; if (fl) rep.flipped++;
    out[t++] = I[3 * f]; out[t++] = fl ? I[3 * f + 2] : I[3 * f + 1]; out[t++] = fl ? I[3 * f + 1] : I[3 * f + 2];
  }
  sizes.forEach((s) => { if (s < minKeep) { rep.islandsRemoved++; rep.islandTris += s; } else rep.parts++; });
  const res = compact({ positions: w.positions, indices: out.slice(0, t), colors: w.colors });
  rep.tris = res.indices.length / 3;
  return { mesh: { positions: res.positions, indices: res.indices, colors: res.colors, name: mesh.name }, report: rep };
}

/**
 * Open borders of a (clean) mesh as simple closed vertex loops, each running in the direction of its border half-edges.
 * Longest first. A border that pinches through one vertex twice is split there, so every loop visits each vertex once.
 * → [{ verts: Uint32Array, length: mm }]
 */
export function boundaryLoops(mesh, twins = null) {
  const I = mesh.indices, P = mesh.positions, twin = (twins || buildTwins(I)).twin, nh = I.length, seen = new Uint8Array(nh), loops = [];
  const emit = (cyc) => { if (cyc.length < 3) return; let len = 0; for (let i = 0; i < cyc.length; i++) { const a = cyc[i] * 3, b = cyc[(i + 1) % cyc.length] * 3; len += Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]); } loops.push({ verts: Uint32Array.from(cyc), length: len }); };
  for (let h0 = 0; h0 < nh; h0++) {
    if (twin[h0] !== -1 || seen[h0]) continue;
    const loop = []; let h = h0, ok = false;
    for (let guard = 0; guard <= nh; guard++) {
      if (seen[h]) { ok = h === h0; break; }
      seen[h] = 1; loop.push(I[h]);
      let g = nextH(h), spin = 0;
      while (twin[g] >= 0 && spin++ < 4096) g = nextH(twin[g]);
      if (twin[g] !== -1) break;
      h = g;
    }
    if (!ok) continue;
    const path = [], at = new Map();
    for (const v of loop) {
      if (at.has(v)) { const k = at.get(v), cyc = path.splice(k + 1); for (const w of cyc) at.delete(w); cyc.unshift(v); emit(cyc); }
      else { at.set(v, path.length); path.push(v); }
    }
    emit(path);
  }
  loops.sort((a, b) => b.length - a.length);
  return loops;
}

/** Close border loops with a fan around their centre. `loops` from boundaryLoops (pass only the ones to close). */
export function fillHoles(mesh, loops) {
  if (!loops.length) return mesh;
  let extraV = 0, extraT = 0; for (const l of loops) { const n = l.verts.length; if (n === 3) extraT += 1; else { extraV += 1; extraT += n; } }
  const P0 = mesh.positions, nV = P0.length / 3, P = new Float32Array(P0.length + extraV * 3), I = new Uint32Array(mesh.indices.length + extraT * 3);
  P.set(P0); I.set(mesh.indices); let v = nV, t = mesh.indices.length;
  const C = mesh.colors ? new Float32Array(P.length) : null; if (C) C.set(mesh.colors);
  for (const l of loops) {
    const L = l.verts, n = L.length;
    if (n === 3) { I[t++] = L[0]; I[t++] = L[2]; I[t++] = L[1]; continue; }
    let cx = 0, cy = 0, cz = 0; for (const i of L) { cx += P0[3 * i]; cy += P0[3 * i + 1]; cz += P0[3 * i + 2]; }
    P[3 * v] = cx / n; P[3 * v + 1] = cy / n; P[3 * v + 2] = cz / n; if (C) { C[3 * v] = C[3 * L[0]]; C[3 * v + 1] = C[3 * L[0] + 1]; C[3 * v + 2] = C[3 * L[0] + 2]; }
    for (let i = 0; i < n; i++) { I[t++] = L[(i + 1) % n]; I[t++] = L[i]; I[t++] = v; }
    v++;
  }
  return { ...mesh, positions: P, indices: I, colors: C };
}

/** Edge census of a mesh: { open: border half-edges, nonManifold: half-edges on edges shared by 3+ triangles, flipped: half-edges whose neighbour runs the same way }.
 *  open === 0 and flipped === 0 means the surface is closed; nonManifold > 0 then only means two sheets touch along an edge. */
export function edgeReport(mesh) {
  const { twin, same } = buildTwins(mesh.indices); let open = 0, nonManifold = 0, flipped = 0;
  for (let h = 0; h < twin.length; h++) { if (twin[h] === -1) open++; else if (twin[h] === -2) nonManifold++; if (same[h]) flipped++; }
  return { open, nonManifold, flipped };
}
/** True when every edge is shared by exactly two triangles running opposite ways (a watertight, printable shell). */
export function isWatertight(mesh) {
  const { twin, same } = buildTwins(mesh.indices);
  for (let h = 0; h < twin.length; h++) if (twin[h] < 0 || same[h]) return false;
  return mesh.indices.length > 0;
}

// ───────────────────────────── reading and writing meshes ─────────────────────────────
/** Parse an STL / PLY / OBJ ArrayBuffer into a welded mesh. */
export function parseMesh(buf, ext, name = 'scan') {
  ext = String(ext).toLowerCase(); let pos, idx = null, col = null;
  if (!['stl', 'ply', 'obj'].includes(ext)) throw new Error(`.${ext} files are not supported — use STL, PLY or OBJ.`);
  try {
  if (ext === 'stl') { const g = new STLLoader().parse(buf); pos = g.attributes.position.array; if (g.hasColors && g.attributes.color) col = g.attributes.color.array; }
  else if (ext === 'ply') { const g = new PLYLoader().parse(buf); if (!g.index) throw new Error(`${name} is a point cloud with no triangles — export it as a mesh.`); pos = g.attributes.position.array; idx = g.index.array; if (g.attributes.color) { const c = g.attributes.color; col = c.itemSize === 3 ? c.array : Float32Array.from({ length: c.count * 3 }, (_, i) => c.array[((i / 3) | 0) * c.itemSize + (i % 3)]); } }
  else if (ext === 'obj') { const grp = new OBJLoader().parse(new TextDecoder().decode(buf)); const parts = []; grp.traverse((c) => { if (c.isMesh) { const g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry; parts.push(g.attributes.position.array); } }); let n = 0; for (const p of parts) n += p.length; pos = new Float32Array(n); let o = 0; for (const p of parts) { pos.set(p, o); o += p.length; } }
  } catch (e) { if (/point cloud/.test(String(e && e.message))) throw e; throw new Error(`${name} could not be read as an ${ext.toUpperCase()} file.`); }
  if (!pos || pos.length < 9) throw new Error(`No triangles found in ${name}.`);
  const m = weld(pos, idx, col);
  if (!m.indices.length) throw new Error(`No usable triangles found in ${name}.`);
  return { positions: m.positions, indices: m.indices, colors: m.colors, name };
}
export async function readMeshFile(file) {
  const name = file.name || 'scan', ext = name.split('.').pop();
  return parseMesh(await file.arrayBuffer(), ext, name);
}
/** 'upper' if the scan covers the middle of the arch (a palate), else 'lower'. A guess for scans whose file name does not say. */
export function guessJaw(mesh) {
  const M = autoOrient(mesh, 'lower').matrix.elements, P = mesh.positions, cell = 1.5, rows = new Map(), st = Math.max(1, Math.floor(P.length / 3 / 60000)) * 3;
  for (let i = 0; i < P.length; i += st) { const x = M[0] * P[i] + M[4] * P[i + 1] + M[8] * P[i + 2] + M[12], y = M[1] * P[i] + M[5] * P[i + 1] + M[9] * P[i + 2] + M[13], r = Math.floor(y / cell), c = Math.floor(x / cell); let set = rows.get(r); if (!set) rows.set(r, set = new Set()); set.add(c); }
  let filled = 0, span = 0; for (const set of rows.values()) { let lo = Infinity, hi = -Infinity; for (const c of set) { if (c < lo) lo = c; if (c > hi) hi = c; } filled += set.size; span += hi - lo + 1; }
  return span > 0 && filled / span > 0.8 ? 'upper' : 'lower';
}
/** 1000 if the mesh looks like it is in metres, 10 for centimetres, else 1. (A dental arch is roughly 40–90 mm across.) */
export function unitScaleGuess(mesh) { const s = Math.max(...meshBounds(mesh).size); return s < 0.5 ? 1000 : s < 12 ? 10 : 1; }

/** Binary STL (ArrayBuffer) of one mesh or a list, optionally moved by a THREE.Matrix4. */
export function stlBinary(meshOrList, matrix = null, header = 'Notile') {
  const list = Array.isArray(meshOrList) ? meshOrList : [meshOrList];
  let nT = 0; for (const m of list) nT += m.indices.length / 3;
  const buf = new ArrayBuffer(84 + nT * 50), dv = new DataView(buf), e = matrix ? matrix.elements : null, flip = !!matrix && matrix.determinant() < 0;
  for (let i = 0; i < Math.min(79, header.length); i++) dv.setUint8(i, header.charCodeAt(i) & 127);
  dv.setUint32(80, nT, true); let o = 84; const v = new Float64Array(9);
  for (const m of list) {
    const P = m.positions, I = m.indices;
    for (let t = 0; t < I.length; t += 3) {
      const ids = [I[t], flip ? I[t + 2] : I[t + 1], flip ? I[t + 1] : I[t + 2]];
      for (let k = 0; k < 3; k++) { const p = ids[k] * 3, x = P[p], y = P[p + 1], z = P[p + 2]; if (e) { v[3 * k] = e[0] * x + e[4] * y + e[8] * z + e[12]; v[3 * k + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; v[3 * k + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]; } else { v[3 * k] = x; v[3 * k + 1] = y; v[3 * k + 2] = z; } }
      const ux = v[3] - v[0], uy = v[4] - v[1], uz = v[5] - v[2], wx = v[6] - v[0], wy = v[7] - v[1], wz = v[8] - v[2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const l = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
      for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + 4 * k, v[k], true);
      o += 50;
    }
  }
  return buf;
}
const lin2srgb = (c) => Math.round(255 * clamp(c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055, 0, 1));
/** Binary PLY (keeps vertex order, connectivity and colour — this is what case files store). */
export function plyBinary(mesh) {
  const nV = mesh.positions.length / 3, nF = mesh.indices.length / 3, hasC = !!mesh.colors;
  const head = `ply\nformat binary_little_endian 1.0\ncomment Notile case mesh, millimetres\nelement vertex ${nV}\nproperty float x\nproperty float y\nproperty float z\n${hasC ? 'property uchar red\nproperty uchar green\nproperty uchar blue\n' : ''}element face ${nF}\nproperty list uchar int vertex_indices\nend_header\n`;
  const hb = new TextEncoder().encode(head), vs = hasC ? 15 : 12, buf = new ArrayBuffer(hb.length + nV * vs + nF * 13), u8 = new Uint8Array(buf), dv = new DataView(buf);
  u8.set(hb); let o = hb.length; const P = mesh.positions, C = mesh.colors, I = mesh.indices;
  for (let i = 0; i < nV; i++) { dv.setFloat32(o, P[3 * i], true); dv.setFloat32(o + 4, P[3 * i + 1], true); dv.setFloat32(o + 8, P[3 * i + 2], true); o += 12; if (hasC) { u8[o] = lin2srgb(C[3 * i]); u8[o + 1] = lin2srgb(C[3 * i + 1]); u8[o + 2] = lin2srgb(C[3 * i + 2]); o += 3; } }
  for (let f = 0; f < nF; f++) { u8[o] = 3; dv.setInt32(o + 1, I[3 * f], true); dv.setInt32(o + 5, I[3 * f + 1], true); dv.setInt32(o + 9, I[3 * f + 2], true); o += 13; }
  return buf;
}
/** Read a PLY written by plyBinary without re-welding (vertex numbering is preserved). */
export function parsePLYExact(buf, name = 'mesh') {
  const g = new PLYLoader().parse(buf);
  if (!g.index) throw new Error('PLY has no faces');
  return { positions: new Float32Array(g.attributes.position.array), indices: Uint32Array.from(g.index.array), colors: g.attributes.color ? new Float32Array(g.attributes.color.array) : null, name };
}

// ───────────────────────────── zip + saving files ─────────────────────────────
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(u) { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = crcT[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
const toU8 = (d) => (d instanceof Uint8Array ? d : d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new TextEncoder().encode(String(d)));
async function pipe(u8, stream) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer()); }
/** Build a .zip Blob from [{name, data}] (data: string | ArrayBuffer | typed array). Deflates when the browser can. */
export async function zipFiles(files, o = {}) {
  const parts = [], cent = []; let off = 0;
  const canDeflate = o.compress !== false && typeof CompressionStream !== 'undefined';
  for (const f of files) {
    const raw = toU8(f.data), nm = new TextEncoder().encode(f.name), crc = crc32(raw);
    let data = raw, method = 0;
    if (canDeflate && raw.length > 256) { try { const d = await pipe(raw, new CompressionStream('deflate-raw')); if (d.length < raw.length) { data = d; method = 8; } } catch (_) {} }
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true); h.setUint16(10, 0, true); h.setUint16(12, 0x0021, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, raw.length, true); h.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(h.buffer), nm, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true); c.setUint16(12, 0, true); c.setUint16(14, 0x0021, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, raw.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    cent.push(new Uint8Array(c.buffer), nm); off += 30 + nm.length + data.length;
  }
  const cs = cent.reduce((s, u) => s + u.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...cent, new Uint8Array(e.buffer)], { type: 'application/zip' });
}
/** Read a .zip (Blob | ArrayBuffer) → [{name, data: Uint8Array}]. Handles stored and deflated entries. */
export async function unzip(src) {
  const buf = src instanceof ArrayBuffer ? src : await src.arrayBuffer(), u8 = new Uint8Array(buf), dv = new DataView(buf);
  let p = u8.length - 22; while (p >= 0 && dv.getUint32(p, true) !== 0x06054b50) p--;
  if (p < 0) throw new Error('Not a zip file');
  const n = dv.getUint16(p + 10, true); let c = dv.getUint32(p + 16, true); const out = [];
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(c, true) !== 0x02014b50) break;
    const method = dv.getUint16(c + 10, true), csz = dv.getUint32(c + 20, true), nl = dv.getUint16(c + 28, true), xl = dv.getUint16(c + 30, true), cl = dv.getUint16(c + 32, true), lo = dv.getUint32(c + 42, true);
    const name = new TextDecoder().decode(u8.subarray(c + 46, c + 46 + nl));
    const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), raw = u8.subarray(ds, ds + csz);
    if (!name.endsWith('/')) {
      if (method === 0) out.push({ name, data: raw.slice() });
      else if (method === 8) { if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open compressed zip files'); out.push({ name, data: await pipe(raw, new DecompressionStream('deflate-raw')) }); }
      else throw new Error('Unsupported zip compression in ' + name);
    }
    c += 46 + nl + xl + cl;
  }
  return out;
}

let dlNS; let dlAsked = false;
async function downloadsNS() { if (!dlAsked) { dlAsked = true; try { dlNS = (globalThis.claude && globalThis.claude.use) ? await globalThis.claude.use('downloads') : null; } catch (_) { dlNS = null; } } return dlNS; }
if (typeof window !== 'undefined') setTimeout(downloadsNS, 0);
const DL_OK = new Set('gif png jpg jpeg webp mp4 webm mov txt json md docx pptx epub csv ttf html svg pdf xlsx zip fig'.split(' '));
/**
 * Offer a file to the user. Works both as a hosted page (normal browser download) and inside a Claude artifact
 * (downloads capability — file types it does not allow, e.g. .stl, are wrapped in a .zip automatically).
 * → { ok, name, wrapped, code?, message }   Never throws. Call from a click handler.
 */
export async function saveFile(filename, data) {
  if (EMBED && HUB.saveFile) { try { return await HUB.saveFile(filename, data); } catch (e) { return { ok: false, code: 'unavailable', name: filename, message: 'Download failed: ' + ((e && e.message) || e) }; } }   // inside Scan Card the hub page does the saving
  const ext = filename.split('.').pop().toLowerCase(), ns = await downloadsNS();
  if (ns) {
    let name = filename, payload = data instanceof Blob ? data : toU8(data);
    if (!DL_OK.has(ext)) { name = filename.replace(/\.[^.]+$/, '') + '.zip'; payload = await zipFiles([{ name: filename, data: data instanceof Blob ? await data.arrayBuffer() : data }]); }
    try { await ns.save({ filename: name, data: payload }); return { ok: true, name, wrapped: name !== filename, message: name !== filename ? `Saved ${name} (${filename} inside)` : `Saved ${name}` }; }
    catch (e) { const code = (e && e.code) || 'unavailable'; return { ok: false, code, name, message: code === 'declined' ? 'Download cancelled' : `Download unavailable here (${(e && e.message) || code})` }; }
  }
  try {
    const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/octet-stream' }), url = URL.createObjectURL(blob), a = el('a', { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    return { ok: true, name: filename, wrapped: false, message: `Downloaded ${filename}` };
  } catch (e) { return { ok: false, code: 'unavailable', name: filename, message: 'Download failed: ' + ((e && e.message) || e) }; }
}
/** Several files at once: one file is saved as is, more are bundled into zipName. */
export async function saveFiles(zipName, files) {
  if (files.length === 1) return saveFile(files[0].name, files[0].data);
  return saveFile(zipName, await zipFiles(files));
}

// ───────────────────────────── the case file ─────────────────────────────
// A case is one .zip:  case.json (manifest) + meshes/<id>.ply (binary PLY, original scanner coordinates).
// Any app can open a case saved by any other; unknown `data` sections are carried through untouched.
export const ROLES = ['upper-scan', 'lower-scan', 'upper-model', 'lower-model', 'splint', 'bite', 'other'];
let uidN = 0; const uid = () => 'm' + Date.now().toString(36) + (uidN++).toString(36);
/** One mesh in a case. Its file is only read into a mesh when `.mesh` is first asked for, so an app can carry
 *  another app's items through untouched (and byte-for-byte) without paying for them. */
class CaseItem {
  constructor(o) { this.id = o.id || uid(); this.role = o.role || 'other'; this.name = o.name || o.role || 'mesh'; this.matrix = o.matrix ? o.matrix.clone() : new THREE.Matrix4(); this.meta = o.meta || {}; this._mesh = o.mesh || o._mesh || null; this._bytes = o.bytes || o._bytes || null; }
  get mesh() { if (!this._mesh && this._bytes) { const b = this._bytes; this._mesh = parsePLYExact(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), this.name); this._bytes = null; } return this._mesh; }
  set mesh(m) { this._mesh = m; this._bytes = null; }
  /** the item as a PLY file: the stored bytes if nobody opened it, written fresh otherwise */
  file() { return this._bytes || plyBinary(this._mesh); }
}
export class DentalCase {
  constructor() { const now = new Date().toISOString(); this.meta = { format: 'notile-case', version: 1, frame: 'LPS-mm', created: now, modified: now, app: '' }; this.items = []; this.data = {}; }
  /** add({ role, name, mesh, matrix?: THREE.Matrix4 (local → case frame), meta? }) → item */
  add(item) { const it = new CaseItem(item); this.items.push(it); return it; }
  get(role) { return this.items.find((i) => i.role === role) || null; }
  all(role) { return this.items.filter((i) => i.role === role); }
  remove(roleOrId) { this.items = this.items.filter((i) => i.role !== roleOrId && i.id !== roleOrId); }
  /** replace whatever holds this role */
  set(role, item) { this.remove(role); return this.add({ ...item, role }); }
  /** the item's mesh moved into the case frame (new arrays) */
  framed(roleOrItem) { const it = typeof roleOrItem === 'string' ? this.get(roleOrItem) : roleOrItem; return it ? transformMesh(it.mesh, it.matrix) : null; }
  get isEmpty() { return this.items.length === 0; }
  /** o.compress:false → stored, not deflated (quicker; used when a case is only passed between pages) */
  async toBlob(appName = '', o = {}) {
    this.meta.modified = new Date().toISOString(); if (appName) this.meta.app = appName;
    const files = [], items = [];
    for (const it of this.items) { const file = `meshes/${it.id}.ply`; files.push({ name: file, data: it.file() }); items.push({ id: it.id, role: it.role, name: it.name, file, matrix: it.matrix.toArray(), meta: it.meta }); }
    files.unshift({ name: 'case.json', data: JSON.stringify({ ...this.meta, items, data: this.data }, null, 1) });
    return zipFiles(files, o);
  }
  static async fromBlob(blob) {
    let entries; try { entries = await unzip(blob); } catch (e) { throw new Error('That file is not a Notile case (.zip).'); }
    const man = entries.find((e) => e.name === 'case.json'); if (!man) throw new Error('That zip is not a Notile case file (no case.json inside).');
    const j = JSON.parse(new TextDecoder().decode(man.data)); if (j.format !== 'notile-case') throw new Error('That zip is not a Notile case file.');
    const c = new DentalCase(); c.meta = { format: j.format, version: j.version, frame: j.frame || 'LPS-mm', created: j.created, modified: j.modified, app: j.app || '' }; c.data = j.data || {};
    for (const it of j.items || []) { const f = entries.find((e) => e.name === it.file); if (!f) continue; c.items.push(new CaseItem({ id: it.id, role: it.role, name: it.name, bytes: f.data, matrix: new THREE.Matrix4().fromArray(it.matrix), meta: it.meta || {} })); }
    return c;
  }
}
/** Was this File a case zip? (cheap check by name; fromBlob gives the real answer) */
export const looksLikeCase = (file) => /\.zip$/i.test(file.name || '');

// Small same-origin key/value store (IndexedDB). On a site where the apps share an origin this hands the
// current case from one app to the next; inside separate artifacts it simply gives each app "resume where I left off".
function idb() { return new Promise((res, rej) => { const r = indexedDB.open('notile-suite', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
export async function stashPut(key, value) { try { const db = await idb(); await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(value, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); db.close(); return true; } catch (_) { return false; } }
export async function stashGet(key) { try { const db = await idb(); const v = await new Promise((res, rej) => { const rq = db.transaction('kv').objectStore('kv').get(key); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); db.close(); return v === undefined ? null : v; } catch (_) { return null; } }
export async function stashDel(key) { try { const db = await idb(); await new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(key); tx.oncomplete = res; tx.onerror = res; }); db.close(); } catch (_) {} }
/** Remember the current case for the next app / next visit. */
export async function stashCase(dcase, appName) { if (EMBED) return false; try { return await stashPut('case', { blob: await dcase.toBlob(appName), app: appName, time: Date.now() }); } catch (_) { return false; } }
/** → { dcase, app, time } | null */
export async function unstashCase() { if (EMBED) return null; const s = await stashGet('case'); if (!s || !s.blob) return null; try { return { dcase: await DentalCase.fromBlob(s.blob), app: s.app, time: s.time }; } catch (_) { return null; } }

// ───────────────────────────── orientation ─────────────────────────────
/** Eigen-decomposition of a symmetric 3×3 [xx,xy,xz,yy,yz,zz] → { values:[3], vectors:[[x,y,z]×3] } sorted largest first. */
export function eigSym3(m) {
  const a = [[m[0], m[1], m[2]], [m[1], m[3], m[4]], [m[2], m[4], m[5]]], v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 32; sweep++) {
    if (Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]) < 1e-14) break;
    for (let p = 0; p < 2; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-18) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y; }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return { values: order.map((i) => a[i][i]), vectors: order.map((i) => [v[0][i], v[1][i], v[2][i]]) };
}
const quantile = (arr, q) => { const s = Float64Array.from(arr).sort(); return s.length ? s[clamp(Math.round(q * (s.length - 1)), 0, s.length - 1)] : 0; };
function planeFit(pts) { // pts: [[x,y,z]…] → { c:[..], n:[..] }
  const n = pts.length, c = [0, 0, 0]; for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; } c[0] /= n; c[1] /= n; c[2] /= n;
  const m = [0, 0, 0, 0, 0, 0]; for (const p of pts) { const x = p[0] - c[0], y = p[1] - c[1], z = p[2] - c[2]; m[0] += x * x; m[1] += x * y; m[2] += x * z; m[3] += y * y; m[4] += y * z; m[5] += z * z; }
  return { c, n: eigSym3(m).vectors[2] };
}
/**
 * Guess how a raw arch scan sits and return the matrix that moves it into the case frame.
 *   jaw 'lower': teeth end up pointing +Z.   jaw 'upper': teeth end up pointing −Z.
 * Occlusal plane → z = 0, arch centred on x = 0, front of the arch towards −Y.
 * Uses: the scan's flattest direction and its surface normals (which way is occlusal), a plane fitted to the
 * cusp tips, and the fact an arch is narrow at the front and wide at the back. Good for full arches; a
 * quadrant or a very partial scan needs the manual tools. → { matrix: THREE.Matrix4, ok: boolean, note }
 */
export function autoOrient(mesh, jaw = 'lower') {
  const P = mesh.positions, I = mesh.indices, nT = I.length / 3, st = Math.max(1, Math.floor(nT / 150000));
  let A = 0; const c = [0, 0, 0], mn = [0, 0, 0];
  for (let f = 0; f < nT; f += st) {
    const a = I[3 * f] * 3, b = I[3 * f + 1] * 3, d = I[3 * f + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, ar = Math.hypot(nx, ny, nz) / 2;
    A += ar; mn[0] += nx; mn[1] += ny; mn[2] += nz;
    c[0] += ar * (P[a] + P[b] + P[d]) / 3; c[1] += ar * (P[a + 1] + P[b + 1] + P[d + 1]) / 3; c[2] += ar * (P[a + 2] + P[b + 2] + P[d + 2]) / 3;
  }
  c[0] /= A; c[1] /= A; c[2] /= A;
  const m = [0, 0, 0, 0, 0, 0], sv = Math.max(1, Math.floor(P.length / 3 / 120000));
  for (let i = 0; i < P.length; i += 3 * sv) { const x = P[i] - c[0], y = P[i + 1] - c[1], z = P[i + 2] - c[2]; m[0] += x * x; m[1] += x * y; m[2] += x * z; m[3] += y * y; m[4] += y * z; m[5] += z * z; }
  let n = eigSym3(m).vectors[2].slice();
  const ml = Math.hypot(...mn) || 1; let agree = (n[0] * mn[0] + n[1] * mn[1] + n[2] * mn[2]) / ml;
  if (agree < 0) { n = n.map((v) => -v); agree = -agree; }
  let ok = agree > 0.5, tops = [];
  const basis = (nn) => { const t = Math.abs(nn[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]; let u = [nn[1] * t[2] - nn[2] * t[1], nn[2] * t[0] - nn[0] * t[2], nn[0] * t[1] - nn[1] * t[0]]; const l = Math.hypot(...u); u = u.map((x) => x / l); return [u, [nn[1] * u[2] - nn[2] * u[1], nn[2] * u[0] - nn[0] * u[2], nn[0] * u[1] - nn[1] * u[0]]]; };
  for (let iter = 0; iter < 3; iter++) {                       // plane through the cusp tips
    const [u, v] = basis(n), cells = new Map();
    for (let i = 0; i < P.length; i += 3 * sv) { const x = P[i] - c[0], y = P[i + 1] - c[1], z = P[i + 2] - c[2], h = x * n[0] + y * n[1] + z * n[2], k = Math.floor((x * u[0] + y * u[1] + z * u[2]) / 5) * 4096 + Math.floor((x * v[0] + y * v[1] + z * v[2]) / 5); const e = cells.get(k); if (!e || h > e[3]) cells.set(k, [P[i], P[i + 1], P[i + 2], h]); }
    const all = [...cells.values()], hTop = quantile(all.map((e) => e[3]), 0.95);
    tops = all.filter((e) => e[3] > hTop - 5.5);
    if (tops.length < 6) break;
    let pn = planeFit(tops).n; if (pn[0] * n[0] + pn[1] * n[1] + pn[2] * n[2] < 0) pn = pn.map((x) => -x);
    if (pn[0] * n[0] + pn[1] * n[1] + pn[2] * n[2] > 0.9) n = pn; else break;
  }
  // which in-plane direction is front-to-back: the arch widens towards the back
  const [u, v] = basis(n), aa = [], bb = [];
  for (let i = 0; i < P.length; i += 3 * sv) { const x = P[i] - c[0], y = P[i + 1] - c[1], z = P[i + 2] - c[2]; aa.push(x * u[0] + y * u[1] + z * u[2]); bb.push(x * v[0] + y * v[1] + z * v[2]); }
  const sub = Math.max(1, Math.floor(aa.length / 15000)), a2 = [], b2 = []; for (let i = 0; i < aa.length; i += sub) { a2.push(aa[i]); b2.push(bb[i]); }
  const score = (deg) => { const cs = Math.cos(deg * Math.PI / 180), sn = Math.sin(deg * Math.PI / 180), ap = new Float64Array(a2.length), tr = new Float64Array(a2.length); for (let i = 0; i < a2.length; i++) { ap[i] = a2[i] * cs + b2[i] * sn; tr[i] = -a2[i] * sn + b2[i] * cs; } const mt = quantile(tr, 0.5); let sa = 0, sw = 0; for (let i = 0; i < ap.length; i++) { tr[i] = Math.abs(tr[i] - mt); sa += ap[i]; sw += tr[i]; } sa /= ap.length; sw /= ap.length; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < ap.length; i++) { const x = ap[i] - sa, y = tr[i] - sw; sxy += x * y; sxx += x * x; syy += y * y; } return sxy / Math.sqrt(sxx * syy || 1); };
  let bestDeg = 0, bestC = 0; for (let dg = 0; dg < 180; dg += 4) { const cc = score(dg); if (Math.abs(cc) > Math.abs(bestC)) { bestC = cc; bestDeg = dg; } }
  for (let dg = bestDeg - 3.5; dg <= bestDeg + 3.5; dg += 0.5) { const cc = score(dg); if (Math.abs(cc) > Math.abs(bestC)) { bestC = cc; bestDeg = dg; } }
  const sgn = bestC >= 0 ? 1 : -1, cs = Math.cos(bestDeg * Math.PI / 180) * sgn, sn = Math.sin(bestDeg * Math.PI / 180) * sgn;
  let Y = [u[0] * cs + v[0] * sn, u[1] * cs + v[1] * sn, u[2] * cs + v[2] * sn];
  if (Math.abs(bestC) < 0.25) ok = false;
  const Z = jaw === 'upper' ? n.map((x) => -x) : n;
  let X = [Y[1] * Z[2] - Y[2] * Z[1], Y[2] * Z[0] - Y[0] * Z[2], Y[0] * Z[1] - Y[1] * Z[0]]; const xl = Math.hypot(...X); X = X.map((x) => x / xl);
  Y = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];
  const xs = [], ys = [];
  for (let i = 0; i < P.length; i += 3 * sv) { xs.push(P[i] * X[0] + P[i + 1] * X[1] + P[i + 2] * X[2]); ys.push(P[i] * Y[0] + P[i + 1] * Y[1] + P[i + 2] * Y[2]); }
  const x0 = (quantile(xs, 0.01) + quantile(xs, 0.99)) / 2, y0 = (quantile(ys, 0.01) + quantile(ys, 0.99)) / 2;
  let z0 = 0; if (tops.length) { for (const t of tops) z0 += t[0] * Z[0] + t[1] * Z[1] + t[2] * Z[2]; z0 /= tops.length; }
  const matrix = new THREE.Matrix4().set(X[0], X[1], X[2], -x0, Y[0], Y[1], Y[2], -y0, Z[0], Z[1], Z[2], -z0, 0, 0, 0, 1);
  return { matrix, ok, note: ok ? '' : 'Could not be sure of the orientation — check it and adjust by hand.' };
}
/** Matrix (in the case frame) that lays the plane through three picked points flat at z = 0 with the least turning. `up` = +1 keeps the side now facing +Z facing +Z. */
export function alignPlaneToZ0(p1, p2, p3) {
  const n = new THREE.Vector3().subVectors(p2, p1).cross(new THREE.Vector3().subVectors(p3, p1)).normalize(); if (n.z < 0) n.negate();
  const q = new THREE.Quaternion().setFromUnitVectors(n, new THREE.Vector3(0, 0, 1)), c = new THREE.Vector3().add(p1).add(p2).add(p3).multiplyScalar(1 / 3);
  return new THREE.Matrix4().makeTranslation(c.x, c.y, 0).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
}
/** Rotation by `deg` about an axis ('x'|'y'|'z' or Vector3) through `pivot` (default origin), as a Matrix4. */
export function rotationAbout(axis, deg, pivot = new THREE.Vector3()) {
  const ax = typeof axis === 'string' ? new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0) : axis.clone().normalize();
  return new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z).multiply(new THREE.Matrix4().makeRotationAxis(ax, THREE.MathUtils.degToRad(deg))).multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}

// ───────────────────────────── height fields ─────────────────────────────
// A height field is the scan seen straight down the z axis on a regular grid: z[j*nx+i] at (x0+i*cell, y0+j*cell).
// mode 'max' = the upper envelope (what a tray, splint or blocked-out model sees from above), 'min' = the lower envelope.
// Empty cells hold −Infinity (max) or +Infinity (min).
export function rasterHeightfield(mesh, o = {}) {
  const cell = o.cell || 0.25, isMax = (o.mode || 'max') === 'max', pad = o.pad ?? 1, b = o.bounds || meshBounds(mesh);
  const x0 = b.min[0] - pad, y0 = b.min[1] - pad, nx = Math.ceil((b.max[0] + pad - x0) / cell) + 1, ny = Math.ceil((b.max[1] + pad - y0) / cell) + 1;
  const z = new Float32Array(nx * ny).fill(isMax ? -Infinity : Infinity), P = mesh.positions, I = mesh.indices, inv = 1 / cell;
  const put = (i, j, v) => { if (i < 0 || j < 0 || i >= nx || j >= ny) return; const k = j * nx + i; if (isMax ? v > z[k] : v < z[k]) z[k] = v; };
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, bI = I[t + 1] * 3, c = I[t + 2] * 3;
    const ax = (P[a] - x0) * inv, ay = (P[a + 1] - y0) * inv, az = P[a + 2], bx = (P[bI] - x0) * inv, by = (P[bI + 1] - y0) * inv, bz = P[bI + 2], cx = (P[c] - x0) * inv, cy = (P[c + 1] - y0) * inv, cz = P[c + 2];
    put(Math.round(ax), Math.round(ay), az); put(Math.round(bx), Math.round(by), bz); put(Math.round(cx), Math.round(cy), cz);
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-12) continue;
    const i0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx))), i1 = Math.min(nx - 1, Math.floor(Math.max(ax, bx, cx))), j0 = Math.max(0, Math.ceil(Math.min(ay, by, cy))), j1 = Math.min(ny - 1, Math.floor(Math.max(ay, by, cy))), id = 1 / den;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const w0 = ((by - cy) * (i - cx) + (cx - bx) * (j - cy)) * id, w1 = ((cy - ay) * (i - cx) + (ax - cx) * (j - cy)) * id, w2 = 1 - w0 - w1;
      if (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) continue;
      const v = w0 * az + w1 * bz + w2 * cz, k = j * nx + i; if (isMax ? v > z[k] : v < z[k]) z[k] = v;
    }
  }
  return { nx, ny, x0, y0, cell, z, mode: isMax ? 'max' : 'min' };
}
/** Bilinear height at (x, y); NaN where the field is empty. */
export function sampleField(hf, x, y) {
  const fx = (x - hf.x0) / hf.cell, fy = (y - hf.y0) / hf.cell, i = Math.floor(fx), j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= hf.nx - 1 || j >= hf.ny - 1) return NaN;
  const tx = fx - i, ty = fy - j, k = j * hf.nx + i, a = hf.z[k], b = hf.z[k + 1], c = hf.z[k + hf.nx], d = hf.z[k + hf.nx + 1];
  let s = 0, w = 0; const add = (v, wt) => { if (Number.isFinite(v)) { s += v * wt; w += wt; } };
  add(a, (1 - tx) * (1 - ty)); add(b, tx * (1 - ty)); add(c, (1 - tx) * ty); add(d, tx * ty);
  return w > 1e-9 ? s / w : NaN;
}
/**
 * Grow or shrink the solid under/over a height field by radius r (mm).
 *   op 'dilate' = offset outward, 'erode' = offset inward.   shape 'sphere' = true 3D offset, 'flat' = sideways only.
 * (For a 'max' field: dilate raises and widens, erode lowers and narrows.)
 */
export function morphField(hf, r, o = {}) {
  const dil = (o.op || 'dilate') === 'dilate', sphere = (o.shape || 'sphere') === 'sphere', isMax = hf.mode !== 'min', { nx, ny, cell } = hf;
  const k = Math.ceil(r / cell), src = hf.z, grow = dil === isMax;            // grow: take max of (z + dz); shrink: take min of (z − dz)
  const out = new Float32Array(src.length).fill(grow ? -Infinity : Infinity);
  for (let dj = -k; dj <= k; dj++) for (let di = -k; di <= k; di++) {
    const d2 = (di * di + dj * dj) * cell * cell; if (d2 > r * r + 1e-9) continue;
    const dz = sphere ? Math.sqrt(Math.max(0, r * r - d2)) : 0, add = grow ? dz : -dz;
    const i0 = Math.max(0, -di), i1 = Math.min(nx, nx - di), j0 = Math.max(0, -dj), j1 = Math.min(ny, ny - dj);
    for (let j = j0; j < j1; j++) { let p = j * nx + i0, q = (j + dj) * nx + i0 + di; for (let i = i0; i < i1; i++, p++, q++) { const v = src[q] + add; if (grow ? v > out[p] : v < out[p]) out[p] = v; } }
  }
  if (!dil) { // erosion: cells whose neighbourhood ran off the grid edge count as empty
    const empty = isMax ? -Infinity : Infinity;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (i < k || j < k || i >= nx - k || j >= ny - k) out[j * nx + i] = empty;
  }
  return { ...hf, z: out };
}

// ───────────────────────────── demo scans ─────────────────────────────
// A procedural dental arch that behaves like an intraoral scan: an open surface with a ragged border, real
// undercuts below the height of contour, tight contacts and a scalloped gingival margin. Every tooth's
// mesiodistal width is known exactly, so measurements can be checked against the truth.
const DEMO = {
  upper: { md: [8.6, 6.7, 7.6, 7.0, 6.7, 10.3, 9.6], bl: [7.0, 6.2, 8.0, 9.0, 9.0, 11.0, 10.8], h: [9.2, 8.2, 9.0, 7.8, 7.2, 7.0, 6.8], y0: -25.2, c: 0.0215, ref: 7.0 },
  lower: { md: [5.4, 5.9, 6.9, 7.0, 7.1, 10.9, 10.3], bl: [6.0, 6.2, 7.2, 7.8, 8.2, 10.3, 10.0], h: [8.0, 8.0, 8.8, 7.8, 7.4, 7.2, 6.8], y0: -22.0, c: 0.0242, ref: 7.2 },
};
const DEMO_KEYS = ['mesial', 'distal', 'tip', 'centre', 'mesialPick', 'distalPick'];
const sminP = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smaxP = (a, b, k) => -sminP(-a, -b, k);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function demoToothF(T, u, v, w) {
  const a0 = T.md / 2, b0 = T.bl / 2, h = T.h;
  if (T.type <= 2) {                                           // incisor: a proclined wedge
    const q = clamp(w / h, -0.4, 1), a = a0 * (0.8 + 0.2 * q), b = b0 * (1 - 0.7 * Math.max(q, 0)), x = u / a, y = (v - 0.2 * w) / b;
    const x2 = x * x, y2 = y * y, r = Math.sqrt(Math.sqrt(x2 * x2 + y2 * y2));
    return smaxP((r - 1) * Math.min(a, b), w - h, 0.5);
  }
  const hc = 0.42 * h, dz = w - hc, e = dz < 0 ? dz / hc : dz / (h - hc), g = dz < 0 ? 1 - 0.16 * Math.min(1.6, e * e) : 1 - 0.22 * Math.min(1.6, e * e);
  const x = u / (a0 * g), y = v / (b0 * g), x2 = x * x, y2 = y * y, r = Math.sqrt(Math.sqrt(x2 * x2 + y2 * y2));
  let top;
  if (T.type === 3) top = h - 0.85 * Math.hypot(u, v - 0.08 * T.bl);
  else { let best = 0; for (const c of T.cusps) { const du = u - c[0], dv = v - c[1], q = c[2] * Math.exp(-(du * du + dv * dv) / 4.5); if (q > best) best = q; } top = h - 1.7 + best; }
  return smaxP((r - 1) * Math.min(a0, b0) * g, w - top, 0.45);
}
function surfaceNets(F, nx, ny, nz) {                           // F < 0 inside; returns grid-space vertices and triangles
  const V = [], T = [], buf = new Int32Array(nx * ny * nz).fill(-1), R = [1, nx, nx * ny], g = new Float32Array(8), x = [0, 0, 0];
  const CE = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (x[2] = 0; x[2] < nz - 1; x[2]++) for (x[1] = 0; x[1] < ny - 1; x[1]++) for (x[0] = 0; x[0] < nx - 1; x[0]++) {
    const m = x[0] + nx * (x[1] + ny * x[2]); let mask = 0;
    for (let k = 0; k < 8; k++) { const v = F[m + (k & 1) + ((k >> 1) & 1) * nx + ((k >> 2) & 1) * nx * ny]; g[k] = v; if (v < 0) mask |= 1 << k; }
    if (mask === 0 || mask === 255) continue;
    let px = 0, py = 0, pz = 0, cnt = 0;
    for (const [a, b] of CE) { if (((mask >> a) & 1) === ((mask >> b) & 1)) continue; const t = g[a] / (g[a] - g[b]); px += (a & 1) + ((b & 1) - (a & 1)) * t; py += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t; pz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t; cnt++; }
    buf[m] = V.length / 3; V.push(x[0] + px / cnt, x[1] + py / cnt, x[2] + pz / cnt);
    for (let i = 0; i < 3; i++) {
      if (((mask & 1) !== 0) === (((mask >> (1 << i)) & 1) !== 0)) continue;
      const iu = (i + 1) % 3, iv = (i + 2) % 3; if (x[iu] === 0 || x[iv] === 0) continue;
      const du = R[iu], dv = R[iv], a = buf[m], b = buf[m - du], c = buf[m - du - dv], d = buf[m - dv];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      if (mask & 1) T.push(a, b, c, a, c, d); else T.push(a, d, c, a, c, b);
    }
  }
  return { V, T };
}
/**
 * makeDemoArch({ jaw:'lower'|'upper', res:0.3, missing:{12:5.5, 22:true}, spacing:0, prep })
 *   missing: FDI → width of the gap left (true = the tooth's own width).   spacing: extra mm between each of the six front teeth.
 *   prep: { fdi, zTop, zMargin, R0, shoulder, taper, taperLingual } — that tooth is a preparation of exactly known shape instead of a
 *     crown: walls round its long axis (radius R0 at the margin) converging at `taper`° each (buccal, mesial, distal) and at
 *     `taperLingual`° on the lingual / palatal (negative = an undercut; blended over ±8° at the corners), flat occlusal surface at
 *     zTop, a shoulder `shoulder` mm wide at zMargin. Heights in the case frame. For testing preparation measurements.
 * → { mesh, truth:{ jaw, teeth:[{ fdi, type, width, mesial:[x,y,z], distal:[x,y,z], tip:[x,y,z], centre:[x,y,z] }], gaps:[{fdi,width,a,b}] } }
 *   tip = incisal edge midpoint, canine cusp, or the mesiobuccal cusp. gaps[].width = the slot left along the arch line (not the
 *   distance between the neighbours' contact points, which sit labial of that line on the front teeth).
 *   width = the designed mesiodistal width. mesial/distal = the contact points; neighbouring crowns are fused there (as in a real
 *   scan) so they can sit up to ~2 mm inside the surface. mesialPick/distalPick = the same points dropped onto the surface from
 *   the occlusal side — where a user's click lands when measuring widths from the occlusal view (their distance measured in
 *   the occlusal plane equals the designed width to within ~2%).
 * The mesh is already in the case frame (lower teeth up, upper teeth down, occlusal plane at z≈0).
 */
export function makeDemoArch(o = {}) {
  const jaw = o.jaw === 'upper' ? 'upper' : 'lower', D = DEMO[jaw], h = o.res || 0.3, PW = 2.3, upper = jaw === 'upper', missing = o.missing || {}, spacing = o.spacing || 0;
  const half = [[0, D.y0, 0]]; { let x = 0, y = D.y0, s = 0; while (s < 80) { const x2 = x + 0.01, y2 = D.y0 + D.c * Math.pow(x2, PW); s += Math.hypot(0.01, y2 - y); x = x2; y = y2; half.push([x, y, s]); } }
  const at = (s) => { const as = Math.abs(s); let lo = 0, hi = half.length - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (half[mid][2] <= as) lo = mid; else hi = mid; } const A = half[lo], B = half[hi], t = (as - A[2]) / (B[2] - A[2] || 1), sg = s < 0 ? -1 : 1, dx = (B[0] - A[0]) / (B[2] - A[2]), dy = (B[1] - A[1]) / (B[2] - A[2]); const tx = dx, ty = sg * dy; return { x: sg * (A[0] + (B[0] - A[0]) * t), y: A[1] + (B[1] - A[1]) * t, tx, ty, nx: ty, ny: -tx }; };
  const teeth = [], gaps = [], sEnd = [0, 0];
  [1, -1].forEach((sg, si) => {
    let s = spacing / 2;
    for (let i = 1; i <= 7; i++) {
      const quad = upper ? (sg > 0 ? 1 : 2) : (sg > 0 ? 3 : 4), fdi = quad * 10 + i, md = D.md[i - 1];
      if (missing[fdi]) { const gw = missing[fdi] === true ? md : +missing[fdi]; gaps.push({ fdi, width: gw, s0: sg * s, s1: sg * (s + gw) }); s += gw; continue; }
      const f = at(sg * (s + md / 2)), bl = D.bl[i - 1], hh = D.h[i - 1], T = { fdi, type: i, md, bl, h: hh, s: sg * (s + md / 2), cx: f.x, cy: f.y, tx: f.tx, ty: f.ty, nx: f.nx, ny: f.ny, mesialU: sg > 0 ? -1 : 1 };
      T.cusps = i >= 6 ? [[0.25 * md, 0.26 * bl, 1.7], [-0.25 * md, 0.26 * bl, 1.7], [0.25 * md, -0.26 * bl, 1.5], [-0.25 * md, -0.26 * bl, 1.5]] : [[0, 0.24 * bl, 1.7], [0, -0.26 * bl, upper ? 1.5 : 1.0]];
      teeth.push(T); s += md + (i <= 3 ? spacing : 0);
    }
    sEnd[si] = s;
  });
  const sMax = Math.max(...sEnd), samples = []; for (let s = -(sMax + 6); s <= sMax + 6; s += 0.25) { const f = at(s); samples.push([f.x, f.y, f.nx, f.ny, s]); }
  const eP = at(sMax + 6), wMin = upper ? -12.6 : -10, wMax = Math.max(...D.h) + 1;
  const x0 = -(eP.x + 12), y0 = D.y0 - 9, nx = Math.ceil((2 * (eP.x + 12)) / h) + 1, ny = Math.ceil((eP.y + 3 - y0) / h) + 1, nz = Math.ceil((wMax - wMin) / h) + 1;
  const nearest = (x, y) => { let bd = Infinity, bk = 0; for (let k = 0; k < samples.length; k++) { const dx = x - samples[k][0], dy = y - samples[k][1], d = dx * dx + dy * dy; if (d < bd) { bd = d; bk = k; } } const S = samples[bk], dx = x - S[0], dy = y - S[1]; return { d: Math.sqrt(bd) * (dx * S[2] + dy * S[3] >= 0 ? 1 : -1), s: S[4] }; };
  const domeAt = (d, s) => { const ad = Math.abs(d), wdt = 4.6 + 1.6 * sstep(8, 30, Math.abs(s)), q = ad / wdt; let T = 0.4 - 2.2 * Math.pow(q, 2.6), k = 1 / Math.sqrt(1 + Math.pow(2.2 * 2.6 / wdt * Math.pow(q, 1.6), 2)); if (upper && d < 0) { const pal = -1.5 - 9 * sstep(0, 14, ad); if (pal > T) { T = pal; k = 0.85; } } return [T, k]; };
  const F = new Float32Array(nx * ny * nz), pr = o.prep || null;
  const zw = (z) => (upper ? D.ref - z : z + D.ref);                 // case-frame height → this generator's height
  const toothF = (t, u, v, w) => {
    if (!pr || t.fdi !== pr.fdi) return demoToothF(t, u, v, w);
    const r = Math.hypot(u, v), lingual = r > 1e-6 ? -v / r : 0, ang = Math.acos(clamp(lingual, -1, 1)) * 180 / Math.PI, f = clamp((ang - 37) / 16, 0, 1);
    const tau = (pr.taperLingual + (pr.taper - pr.taperLingual) * f) * Math.PI / 180, wMg = zw(pr.zMargin), wTop = zw(pr.zTop), R = pr.R0 - (w - wMg) * Math.tan(tau);
    return Math.min(Math.max(r - R, w - wTop, wMg - w), Math.max(r - (pr.R0 + (pr.shoulder ?? 0.8)), w - wMg));
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * h, y = y0 + j * h, nr = nearest(x, y), [T, kT] = domeAt(nr.d, nr.s), cand = [];
    for (const t of teeth) { const dx = x - t.cx, dy = y - t.cy; if (dx * dx + dy * dy < (Math.max(t.md, t.bl) / 2 + 2.5) ** 2) cand.push([t, dx * t.tx + dy * t.ty, dx * t.nx + dy * t.ny]); }
    for (let k = 0; k < nz; k++) {
      const w = wMin + k * h; let f = (w - T) * kT;
      if (cand.length) { let ft = Infinity; for (const c of cand) ft = sminP(ft, toothF(c[0], c[1], c[2], w), 0.55); f = sminP(f, ft, 1.0); }
      F[i + nx * (j + ny * k)] = f;
    }
  }
  const sn = surfaceNets(F, nx, ny, nz), nV = sn.V.length / 3, keep = new Uint8Array(nV), P = new Float32Array(nV * 3), yEnd = at(sMax + 2.6).y;
  for (let v = 0; v < nV; v++) {
    const x = x0 + sn.V[3 * v] * h, y = y0 + sn.V[3 * v + 1] * h, w = wMin + sn.V[3 * v + 2] * h, nr = nearest(x, y);
    const cut = -6.6 + 0.9 * Math.sin(nr.s * 0.33 + (nr.d > 0 ? 0 : 2.1)) + 0.4 * Math.sin(nr.s * 1.7 + 1);
    let ok = true;
    if (upper) { if (nr.d > 0 && w < cut) ok = false; if (y > yEnd + 0.6 * Math.sin(x * 0.7)) ok = false; }
    else { if (w < cut) ok = false; if (Math.abs(nr.s) > (nr.s > 0 ? sEnd[0] : sEnd[1]) + 2.6 + 0.5 * Math.sin(nr.d * 1.3)) ok = false; }
    keep[v] = ok ? 1 : 0;
    if (upper) { P[3 * v] = -x; P[3 * v + 1] = y; P[3 * v + 2] = D.ref - w; } else { P[3 * v] = x; P[3 * v + 1] = y; P[3 * v + 2] = w - D.ref; }
  }
  const I = []; for (let t = 0; t < sn.T.length; t += 3) { const a = sn.T[t], b = sn.T[t + 1], c = sn.T[t + 2]; if (keep[a] && keep[b] && keep[c]) I.push(a, b, c); }
  let mesh = cleanMesh({ positions: P, indices: Uint32Array.from(I), colors: null }).mesh;
  { const lp = boundaryLoops(mesh); if (lp.length > 1) mesh = cleanMesh(fillHoles(mesh, lp.slice(1))).mesh; }
  { // make sure triangles face out of the tissue (towards the occlusal side)
    const N = vertexNormals(mesh); let sz = 0; for (let i = 2; i < N.length; i += 3) sz += N[i];
    if ((sz > 0) === upper) { const J = mesh.indices; for (let t = 0; t < J.length; t += 3) { const q = J[t + 1]; J[t + 1] = J[t + 2]; J[t + 2] = q; } }
  }
  mesh.name = `demo-${jaw}`;
  const world = (x, y, w) => (upper ? [-x, y, D.ref - w] : [x, y, w - D.ref]);
  const truth = { jaw, teeth: teeth.map((t) => { const wc = t.type <= 2 ? 0.92 * t.h : 0.42 * t.h, a = t.type <= 2 ? t.md / 2 * 0.984 : t.md / 2, vs = t.type <= 2 ? 0.2 * wc : 0, pt = (u, v, w) => world(t.cx + u * t.tx + v * t.nx, t.cy + u * t.ty + v * t.ny, w); return { fdi: t.fdi, type: t.type, width: t.md, mesial: pt(t.mesialU * a, vs, wc), distal: pt(-t.mesialU * a, vs, wc), tip: t.type <= 2 ? pt(0, 0.2 * t.h, t.h) : t.type === 3 ? pt(0, 0.08 * t.bl, t.h) : pt(t.mesialU * Math.abs(t.cusps[0][0]), t.cusps[0][1], t.h), centre: pt(0, 0, t.h * 0.5) }; }),
    gaps: gaps.map((g) => { const a = at(g.s0), b = at(g.s1); return { fdi: g.fdi, width: g.width, a: world(a.x, a.y, 2), b: world(b.x, b.y, 2) }; }) };
  truth.teeth.sort((a, b) => a.fdi - b.fdi);
  { // where a click from the occlusal view lands for each contact point
    const bvh = new MeshBVH(toGeometry(mesh, { bvh: false })), ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, upper ? 1 : -1));
    for (const t of truth.teeth) for (const k of ['mesial', 'distal']) { ray.origin.set(t[k][0], t[k][1], upper ? -60 : 60); const hit = bvh.raycastFirst(ray, THREE.DoubleSide); if (hit && Math.abs(hit.point.z - t[k][2]) < 2.5) t[k + 'Pick'] = hit.point.toArray(); else { const near = {}; bvh.closestPointToPoint(new THREE.Vector3(...t[k]), near); t[k + 'Pick'] = near.point ? near.point.toArray() : t[k].slice(); } }
  }
  return { mesh, truth };
}
/**
 * Upper and lower demo arches closed into light contact. Options as makeDemoArch (missing/spacing apply to the jaw the
 * FDI numbers belong to) plus scannerFrame:true to tilt and shift both as a scanner export might (to exercise auto-orient).
 * → { upper, lower, truth:{ upper, lower }, matrix }   (matrix = the scannerFrame transform that was applied, or identity)
 */
export function makeDemoPair(o = {}) {
  const lo = makeDemoArch({ ...o, jaw: 'lower' }), up = makeDemoArch({ ...o, jaw: 'upper' });
  const bl = meshBounds(lo.mesh), bu = meshBounds(up.mesh), bounds = { min: [Math.min(bl.min[0], bu.min[0]), Math.min(bl.min[1], bu.min[1]), 0], max: [Math.max(bl.max[0], bu.max[0]), Math.max(bl.max[1], bu.max[1]), 0] };
  const L = rasterHeightfield(lo.mesh, { cell: 0.3, mode: 'max', bounds }), U = rasterHeightfield(up.mesh, { cell: 0.3, mode: 'min', bounds });
  let gap = Infinity; for (let k = 0; k < L.z.length; k++) { const g = U.z[k] - L.z[k]; if (g < gap) gap = g; }
  const dz = Number.isFinite(gap) ? -gap + 0.08 : 0, shift = (p) => [p[0], p[1], p[2] + dz];
  for (let i = 2; i < up.mesh.positions.length; i += 3) up.mesh.positions[i] += dz;
  up.truth.teeth.forEach((t) => { for (const k of DEMO_KEYS) t[k] = shift(t[k]); }); up.truth.gaps.forEach((g) => { g.a = shift(g.a); g.b = shift(g.b); });
  let matrix = new THREE.Matrix4();
  if (o.scannerFrame) {
    matrix = new THREE.Matrix4().makeTranslation(12, -7, 33).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.31, -0.17, 2.4)));
    const mv = (p) => new THREE.Vector3(...p).applyMatrix4(matrix).toArray();
    for (const a of [lo, up]) { a.mesh = { ...transformMesh(a.mesh, matrix), name: a.mesh.name }; a.truth.teeth.forEach((t) => { for (const k of DEMO_KEYS) t[k] = mv(t[k]); }); a.truth.gaps.forEach((g) => { g.a = mv(g.a); g.b = mv(g.b); }); }
  }
  return { upper: up.mesh, lower: lo.mesh, truth: { upper: up.truth, lower: lo.truth }, matrix };
}

// ───────────────────────────── picking points on a scan ─────────────────────────────
/**
 * A reusable "click points onto the model" tool: click to add, drag to move, right-click (or Alt-click) to delete.
 *   const pts = new PointTool(viewer, { targets: () => [meshA, meshB], color: 0xe879f9, max: 3, onChange: (what, index) => {} });
 *   viewer.setTool(pts.tool);        // start     viewer.setTool(null);  // stop (points stay visible)
 *   pts.points → [{ p: Vector3, normal, object }]   pts.add(vec3)  pts.remove(i)  pts.clear()  pts.setVisible(bool)  pts.dispose()
 * onChange what: 'add' | 'move' (while dragging) | 'moved' (drag finished) | 'remove' | 'select' | 'clear'
 */
export class PointTool {
  constructor(viewer, o = {}) {
    this.viewer = viewer; this.targets = o.targets || (() => []); this.color = o.color ?? COLORS.accent; this.max = o.max ?? Infinity; this.px = o.px || 16;
    this.onChange = o.onChange || (() => {}); this.canAdd = o.canAdd !== false; this.points = []; this.sprites = []; this._drag = -1;
    this.tool = {
      cursor: 'crosshair',
      onDown: (i) => { if (i.button !== 0) return false; const k = this.hitTest(i.x, i.y); if (k < 0) return false; this._drag = k; return true; },
      onMove: (i) => { if (!i.dragging || this._drag < 0) return; const h = i.pick(this.targets()); if (h) { this._set(this._drag, h); this.onChange('move', this._drag); } },
      onUp: () => { if (this._drag >= 0) { const k = this._drag; this._drag = -1; this.onChange('moved', k); } },
      onClick: (i) => {
        const k = this.hitTest(i.x, i.y);
        if (i.button === 2 || i.alt) { if (k >= 0) this.remove(k); return; }
        if (k >= 0) { this.onChange('select', k); return; }
        if (!this.canAdd || this.points.length >= this.max) return;
        const h = i.pick(this.targets()); if (h) this.add(h.point, h);
      },
    };
  }
  hitTest(x, y, tol = 14) { let best = -1, bd = tol; this.points.forEach((pt, k) => { const s = this.viewer.toScreen(pt.p); if (!s.visible) return; const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = k; } }); return best; }
  _set(k, hit) { const pt = this.points[k]; pt.p.copy(hit.point || hit); if (hit.normal) pt.normal = hit.normal.clone(); if (hit.object) pt.object = hit.object; this.sprites[k].position.copy(pt.p); this.viewer.invalidate(); }
  add(p, hit = null, silent = false) { const pt = { p: p.clone(), normal: hit && hit.normal ? hit.normal.clone() : null, object: hit ? hit.object : null }; this.points.push(pt); this.sprites.push(this.viewer.marker(pt.p, { color: this.color, px: this.px })); if (!silent) this.onChange('add', this.points.length - 1); return pt; }
  remove(k, silent = false) { if (k < 0 || k >= this.points.length) return; this.points.splice(k, 1); const s = this.sprites.splice(k, 1)[0]; this.viewer.scene.remove(s); this.viewer.invalidate(); if (!silent) this.onChange('remove', k); }
  clear(silent = false) { for (const s of this.sprites) this.viewer.scene.remove(s); this.points = []; this.sprites = []; this.viewer.invalidate(); if (!silent) this.onChange('clear', -1); }
  setVisible(v) { for (const s of this.sprites) s.visible = v; this.viewer.invalidate(); }
  dispose() { this.clear(true); if (this.viewer.tool === this.tool) this.viewer.setTool(null); }
}

// ───────────────────────────── scans: load, clean, orient, case in/out ─────────────────────────────
/**
 * The shared "Load scans" + "Check orientation" steps, identical in every app.
 *
 *   const scans = createScanSet({ shell, viewer, appName: 'Model Card',
 *       loadStep: 'load', orientStep: 'orient',            // ids of two shell steps whose bodies this fills in
 *       demos: [{ label: 'Try the demo scans', opts: {} }],  // opts go to makeDemoPair
 *       onChange: (what, detail) => {},                      // 'loaded' | 'cleared' | 'oriented' | 'case' | 'visibility';
 *                                                            // detail = { jaw?, reason?: 'file' | 'demo' | 'replace' | 'swap' }
 *       extendCase: (dcase) => {},                           // add your own items / dcase.data.<app> before a case is saved
 *       readCase: (dcase) => {} });                          // called after a case was opened (scans are already in place)
 *
 *   scans.upper / scans.lower → null | { name, raw (MeshData, scanner coords), matrix (Matrix4 raw→case), object (THREE.Mesh), report }
 *   scans.has(jaw)   scans.framed(jaw) → MeshData in the case frame (cached)   scans.objects() → visible scan meshes for picking
 *   scans.inBite → true when upper and lower share one matrix (exported together, so their bite is real)
 *   scans.loadFiles(files)  scans.setScan(jaw, mesh, name, { matrix })  scans.replaceRaw(jaw, mesh)  scans.clear(jaw)  scans.swap()
 *   scans.applyTransform(Matrix4 in case frame, jaw?)  scans.autoOrient()  scans.setVisible(jaw, bool)
 *   scans.toCase() → DentalCase   scans.saveCase()   scans.openCase(fileOrBlob)   scans.demoTruth (after a demo was loaded)
 *   scans.touch() → schedule the “Resume last case” autosave after a change to your own state
 *   scans.panel → the small display panel (top right) — append your own rows to it (it folds to its “Show” heading; on a phone it starts folded)
 */
export function createScanSet(o) {
  const { shell, viewer } = o, appName = o.appName || 'Notile', JAWS = ['upper', 'lower'], TINT = { upper: 0xeadfcb, lower: 0xd7dfe8 };
  const S = { upper: null, lower: null, inBite: true, demoTruth: null, dcase: null, panel: null };
  const cache = { upper: null, lower: null }, subs = [], fire = (w, detail = {}) => { stashSoon(); if (o.onChange) o.onChange(w, detail); for (const f of subs) f(w, detail); };
  let stashT = 0; const stashSoon = () => { if (EMBED || o.autosave === false) return; clearTimeout(stashT); stashT = setTimeout(() => { if (S.upper || S.lower) stashCase(S.toCase(), appName); }, 1500); };
  const loadEl = shell.stepEl(o.loadStep).querySelector('.body'), orientEl = o.orientStep != null ? shell.stepEl(o.orientStep).querySelector('.body') : null;
  const demos = o.demos || [{ label: 'Try the demo scans', opts: {} }];
  loadEl.insertAdjacentHTML('afterbegin', `
    <p class="lead">Load the upper and/or lower scan (STL, PLY or OBJ), or open a saved case.</p>
    ${JAWS.map((j) => `<div class="slot" data-jaw="${j}"><b>${j === 'upper' ? 'Upper' : 'Lower'}</b><span class="fn">not loaded</span><button class="btn" data-act="pick" type="button" title="Choose the scan file for this arch">Choose…</button><button class="btn" data-act="clear" type="button" hidden title="Remove this scan">✕</button></div>`).join('')}
    <input type="file" data-ss="file" accept=".stl,.ply,.obj,.zip" multiple hidden>
    <div class="btns"><button class="btn" data-ss="swap" type="button" title="The scans are in the wrong slots">Swap upper ↔ lower</button>${demos.map((d, i) => `<button class="btn" data-ss="demo" data-i="${i}" type="button" title="${esc(d.title || 'Load made-up demo scans to try the app')}">${esc(d.label)}</button>`).join('')}</div>
    <div class="btns"><button class="btn" data-ss="open" type="button" title="Open a case file (.zip) saved by any app of the suite">Open case…</button><button class="btn" data-ss="resume" type="button" hidden title="Carry on with the case kept in this browser">Resume last case</button><button class="btn" data-ss="forget" type="button" hidden title="Delete the copy of the last case kept in this browser">Forget it</button></div>
    <div data-ss="info"></div>
    <p class="tip">Export both arches from the scanner in one go and they keep their bite. Scans stay on this device — nothing is uploaded. A “case” is one .zip holding the scans and whatever you design, and opens in the other apps of the suite. The last case is also kept in this browser so you can resume it; “Forget it” deletes that copy.</p>`);
  const q = (sel) => loadEl.querySelector(sel), fileInp = q('[data-ss=file]'); let pickFor = null;
  loadEl.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const slot = b.closest('.slot');
    if (slot && b.dataset.act === 'pick') { pickFor = slot.dataset.jaw; fileInp.click(); }
    else if (slot && b.dataset.act === 'clear') S.clear(slot.dataset.jaw);
    else if (b.dataset.ss === 'swap') S.swap();
    else if (b.dataset.ss === 'demo') S.loadDemo(demos[+b.dataset.i].opts);
    else if (b.dataset.ss === 'open') { pickFor = null; fileInp.click(); }
    else if (b.dataset.ss === 'resume') S.resume();
    else if (b.dataset.ss === 'forget') { stashDel('case'); S._stash = null; q('[data-ss=resume]').hidden = true; b.hidden = true; shell.status('Saved copy deleted from this browser'); }
  });
  fileInp.addEventListener('change', () => { const fs = [...fileInp.files]; fileInp.value = ''; if (fs.length) S.loadFiles(fs, pickFor); pickFor = null; });
  if (!EMBED) {
    shell.topButton('Open case', 'Open a saved case (.zip) or a scan', () => { pickFor = null; fileInp.click(); });
    shell.topButton('Save case', 'Save the scans and your work as one .zip that the other apps can open', () => S.saveCase());
  }
  S.panel = shell.panel(`<button class="ph" type="button" title="Show or hide this list">Show</button>${JAWS.map((j) => `<div class="row" data-vis="${j}" hidden><label><input type="checkbox" checked> ${j === 'upper' ? 'Upper' : 'Lower'} scan</label></div>`).join('')}`);
  S.panel.hidden = true;
  if (window.innerWidth < 560) S.panel.classList.add('collapsed');            // on a phone the list starts folded away so it does not cover the model
  S.panel.querySelector('.ph').addEventListener('click', () => { S.panel.classList.toggle('collapsed'); });
  S.panel.addEventListener('change', (e) => { const r = e.target.closest('[data-vis]'); if (r) S.setVisible(r.dataset.vis, e.target.checked); });
  unstashCase().then((st) => { if (st && !S.upper && !S.lower) { const b = q('[data-ss=resume]'); b.hidden = false; b.textContent = `Resume last case${st.app ? ' (' + st.app + ')' : ''}`; q('[data-ss=forget]').hidden = false; S._stash = st; } });

  function refreshUI() {
    for (const j of JAWS) {
      const sl = q(`.slot[data-jaw=${j}]`), sc = S[j]; sl.classList.toggle('ok', !!sc); sl.querySelector('.fn').textContent = sc ? sc.name : 'not loaded'; sl.querySelector('[data-act=clear]').hidden = !sc; sl.querySelector('[data-act=pick]').textContent = sc ? 'Replace…' : 'Choose…';
      S.panel.querySelector(`[data-vis=${j}]`).hidden = !sc; if (sc) S.panel.querySelector(`[data-vis=${j}] input`).checked = sc.object.visible;
    }
    S.panel.hidden = !(S.upper || S.lower); shell.setEmpty(!(S.upper || S.lower)); if (S.upper || S.lower) { q('[data-ss=resume]').hidden = true; q('[data-ss=forget]').hidden = true; }
    const info = []; for (const j of JAWS) { const sc = S[j]; if (!sc) continue; const r = sc.report || {}, bits = [`${(sc.raw.indices.length / 3).toLocaleString('en-GB')} triangles`]; if (r.islandsRemoved) bits.push(`${r.islandsRemoved} floating bit${r.islandsRemoved > 1 ? 's' : ''} removed`); if (r.flipped) bits.push(`${r.flipped} flipped triangles fixed`); if (r.nonManifold) bits.push(`${r.nonManifold} bad triangles removed`); if (sc.scaled) bits.push(`scaled ×${sc.scaled} to mm`); info.push(`<div><b>${j === 'upper' ? 'Upper' : 'Lower'}:</b> ${bits.join(' · ')}</div>`); }
    if (S.upper && S.lower && !S.inBite) info.push('<div class="note warn">These two scans do not look like they were exported in the same bite, so each is positioned on its own. Anything that depends on the bite will not be meaningful.</div>');
    q('[data-ss=info]').innerHTML = info.length ? `<div class="note">${info.join('')}</div>` : '';
    if (orientEl) orientEl.querySelector('[data-so=which]').hidden = S.inBite || !(S.upper && S.lower);
    viewer.invalidate();
  }
  function makeObject(jaw, raw) {
    const mat = materials.scan(raw.colors ? { color: 0xffffff, vertexColors: true } : { color: TINT[jaw] });
    const ob = new THREE.Mesh(toGeometry(raw), mat); ob.matrixAutoUpdate = false; ob.name = jaw + '-scan'; ob.userData.jaw = jaw; return ob;
  }
  function put(jaw, raw, name, matrix, extra = {}) {
    if (S[jaw]) { viewer.remove(S[jaw].object); }
    const ob = makeObject(jaw, raw); ob.matrix.copy(matrix); ob.updateMatrixWorld(true); viewer.add(ob);
    S[jaw] = { name, raw, matrix: matrix.clone(), object: ob, report: extra.report || null, scaled: extra.scaled || 0, id: extra.id || null }; cache[jaw] = null;
  }
  function setMatrix(jaw, m) { const sc = S[jaw]; if (!sc) return; sc.matrix.copy(m); sc.object.matrix.copy(m); sc.object.updateMatrixWorld(true); cache[jaw] = null; }
  const occlusalZ = (jaw) => { const sc = S[jaw]; if (!sc) return 0; const N = vertexNormals(sc.raw), e = sc.matrix.elements; let z = 0; const st = Math.max(3, Math.floor(N.length / 30000) * 3); for (let i = 0; i < N.length; i += st) z += e[2] * N[i] + e[6] * N[i + 1] + e[10] * N[i + 2]; return z; };
  function orientAll() {                                      // one shared matrix when the pair is in its bite
    S.inBite = true;
    const ref = S.lower ? 'lower' : S.upper ? 'upper' : null; if (!ref) return;
    const r = autoOrient(S[ref].raw, ref); setMatrix(ref, r.matrix); const other = ref === 'lower' ? 'upper' : 'lower';
    if (S[other]) {
      setMatrix(other, r.matrix);
      const b = meshBounds(S.framed(other)), faces = occlusalZ(other);       // an upper in the same bite faces down and sits around z ≈ 0
      const plausible = (other === 'upper' ? faces < 0 : faces > 0) && b.min[2] < 12 && b.max[2] > -12 && Math.abs(b.center[0]) < 25 && Math.abs(b.center[1]) < 30;
      if (!plausible) { S.inBite = false; setMatrix(other, autoOrient(S[other].raw, other).matrix); }
    }
    if (!r.ok) shell.status(r.note, true);
  }
  S.touch = stashSoon;                                           // call after your own state changes so “Resume last case” keeps it
  S.on = (fn) => { subs.push(fn); };                             // further listeners: fn(what, detail), called after onChange
  S.has = (j) => !!S[j];
  S.framed = (j) => { if (!S[j]) return null; if (!cache[j]) cache[j] = transformMesh(S[j].raw, S[j].matrix); return cache[j]; };
  S.objects = () => JAWS.map((j) => S[j] && S[j].object).filter((ob) => ob && ob.visible);
  S.setVisible = (j, v) => { if (S[j]) { S[j].object.visible = !!v; refreshUI(); if (o.onChange) o.onChange('visibility'); } };
  S.setScan = (jaw, mesh, name, opt = {}) => {
    let raw = mesh, scaled = 0; const k = unitScaleGuess(raw);
    if (k !== 1) { raw = { ...raw, positions: raw.positions.map((v) => v * k) }; scaled = k; }
    const cl = opt.clean === false ? { mesh: raw, report: null } : cleanMesh(raw);
    put(jaw, cl.mesh, name || mesh.name || jaw, opt.matrix || new THREE.Matrix4(), { report: cl.report, scaled, id: opt.id });
    if (!opt.matrix) { const other = jaw === 'upper' ? 'lower' : 'upper'; if (S[other] && opt.reorient !== true && S.inBite) { setMatrix(jaw, S[other].matrix); const b = meshBounds(S.framed(jaw)), f = occlusalZ(jaw); if (!((jaw === 'upper' ? f < 0 : f > 0) && b.min[2] < 12 && b.max[2] > -12 && Math.abs(b.center[0]) < 25 && Math.abs(b.center[1]) < 30)) orientAll(); } else orientAll(); }
    S.demoTruth = opt.truth || null; refreshUI(); viewer.fit(null, { dir: [0.45, -0.85, 0.45] }); if (!opt.silent) fire('loaded', { jaw, reason: 'file' });
  };
  S.replaceRaw = (jaw, mesh) => { const sc = S[jaw]; if (!sc) return; const vis = sc.object.visible; put(jaw, mesh, sc.name, sc.matrix, { report: sc.report, scaled: sc.scaled, id: sc.id }); S[jaw].object.visible = vis; refreshUI(); fire('loaded', { jaw, reason: 'replace' }); };
  S.clear = (jaw) => { if (!S[jaw]) return; viewer.remove(S[jaw].object); S[jaw] = null; cache[jaw] = null; S.inBite = true; refreshUI(); fire('cleared', { jaw }); };
  S.swap = () => { const u = S.upper, l = S.lower; if (!u && !l) return; for (const j of JAWS) if (S[j]) viewer.remove(S[j].object); S.upper = S.lower = null; cache.upper = cache.lower = null; if (l) put('upper', l.raw, l.name, l.matrix, l); if (u) put('lower', u.raw, u.name, u.matrix, u); orientAll(); refreshUI(); viewer.fit(); fire('loaded', { reason: 'swap' }); };
  S.applyTransform = (M, jaw = null) => { for (const j of JAWS) { if (!S[j] || (jaw && j !== jaw)) continue; setMatrix(j, M.clone().multiply(S[j].matrix)); } viewer.invalidate(); };
  S.autoOrient = () => { orientAll(); resetSliders(); refreshUI(); viewer.fit(); fire('oriented'); };
  S.loadDemo = (opts = {}) => shell.busy('Making demo scans…', async () => { const d = makeDemoPair({ res: 0.3, ...opts }); for (const j of JAWS) if (S[j]) { viewer.remove(S[j].object); S[j] = null; } S.inBite = true; const M = new THREE.Matrix4(); put('lower', d.lower, 'demo-lower', M); put('upper', d.upper, 'demo-upper', M); cache.upper = cache.lower = null; S.demoTruth = d.truth; S.dcase = null; refreshUI(); viewer.fit(null, { dir: [0.45, -0.85, 0.45] }); fire('loaded', { reason: 'demo' }); });
  S.loadFiles = async (files, forJaw = null) => {
    if (EMBED) return HUB.loadFiles(files);                      // inside Scan Card the scans are loaded on its Scans tab
    for (const f of files) {
      if (looksLikeCase(f)) { await S.openCase(f); continue; }
      try {
        await shell.busy(`Reading ${f.name}…`, async () => {
          const mesh = await readMeshFile(f); let jaw = forJaw;
          if (!jaw) { const n = f.name.toLowerCase(); jaw = /upper|maxil|_max|max_|sup|oberkiefer|\bok\b/.test(n) ? 'upper' : /lower|mandib|_mand|mand_|inf|unterkiefer|\buk\b/.test(n) ? 'lower' : !S.upper && S.lower ? 'upper' : !S.lower && S.upper ? 'lower' : !S.upper && !S.lower ? guessJaw(mesh) : 'lower'; }
          S.setScan(jaw, mesh, f.name); forJaw = null;
        });
      } catch (e) { /* busy already showed the message */ }
    }
  };
  S.toCase = () => {
    const c = S.dcase || new DentalCase(); S.dcase = c;
    for (const j of JAWS) { const role = j + '-scan'; c.remove(role); if (S[j]) S[j].id = c.add({ role, name: S[j].name, mesh: S[j].raw, matrix: S[j].matrix, id: S[j].id || undefined, meta: { inBite: S.inBite } }).id; }
    if (o.extendCase) o.extendCase(c); return c;
  };
  S.saveCase = async () => { if (EMBED) return HUB.saveCase(); if (!S.upper && !S.lower) return shell.status('Load a scan first', true); const r = await shell.busy('Packing the case…', async () => saveFile(`case-${new Date().toISOString().slice(0, 10)}.zip`, await S.toCase().toBlob(appName))); shell.status(r.message, !r.ok && r.code !== 'declined'); };
  S.useCase = (c) => {
    for (const j of JAWS) { if (S[j]) { viewer.remove(S[j].object); S[j] = null; cache[j] = null; } const it = c.get(j + '-scan'); if (it) put(j, it.mesh, it.name, it.matrix, { id: it.id }); }
    const u = c.get('upper-scan'), l = c.get('lower-scan'); S.inBite = !(u && l) || (u.meta.inBite !== false && u.matrix.equals(l.matrix));
    S.dcase = c; S.demoTruth = null; refreshUI(); viewer.fit(null, { dir: [0.45, -0.85, 0.45] }); if (o.readCase) o.readCase(c); fire('case');
  };
  S.openCase = async (file) => { try { await shell.busy('Opening the case…', async () => S.useCase(await DentalCase.fromBlob(file))); shell.status('Case opened'); } catch (e) { /* shown */ } };
  S.resume = () => { if (S._stash) { S.useCase(S._stash.dcase); shell.status('Picked up where you left off'); } };

  // ---- orientation step ----
  let base = { upper: null, lower: null }, which = 'both', guides = null, planeTool = null;
  const resetSliders = () => { if (!orientEl) return; for (const k of ['pitch', 'roll', 'yaw']) { const r = orientEl.querySelector(`[data-so=${k}]`); r.value = 0; r.parentElement.querySelector('.val').textContent = '0°'; } for (const j of JAWS) base[j] = S[j] ? S[j].matrix.clone() : null; };
  const targets = () => JAWS.filter((j) => S[j] && (S.inBite || which === 'both' || which === j));
  const discrete = (M) => { for (const j of targets()) setMatrix(j, M.clone().multiply(S[j].matrix)); resetSliders(); viewer.invalidate(); fire('oriented'); };
  if (orientEl) {
    orientEl.insertAdjacentHTML('afterbegin', `
      <p class="lead">Check the scans sit the right way round: biting surfaces level with the grid, front teeth towards “Front”.</p>
      <div class="row" data-so="which" hidden><label>Adjust</label><div class="seg"><button data-v="both" class="on" type="button" title="Move both scans together">Both</button><button data-v="upper" type="button" title="Move only the upper scan">Upper</button><button data-v="lower" type="button" title="Move only the lower scan">Lower</button></div></div>
      <div class="btns"><button class="btn" data-so="auto" type="button" title="Work out the biting plane and the front of the arch again">Auto-orient</button><button class="btn" data-so="flip" type="button" title="Teeth are pointing the wrong way up">Flip upside down</button><button class="btn" data-so="turn" type="button" title="Front and back are swapped">Turn front ↔ back</button></div>
      <div class="row"><label>Tilt forward / back</label><input type="range" data-so="pitch" min="-25" max="25" step="0.5" value="0"><span class="val">0°</span></div>
      <div class="row"><label>Tilt left / right</label><input type="range" data-so="roll" min="-25" max="25" step="0.5" value="0"><span class="val">0°</span></div>
      <div class="row"><label>Turn</label><input type="range" data-so="yaw" min="-45" max="45" step="0.5" value="0"><span class="val">0°</span></div>
      <div class="btns"><button class="btn" data-so="plane" type="button" title="Click three well-spread cusp tips; they are laid flat">Set biting plane with 3 clicks</button><button class="btn" data-so="centre" type="button" title="Click between the central incisors to put the midline there">Set midline with 1 click</button><button class="btn" data-so="raw" type="button" title="Leave the scans exactly as the scanner exported them">Use scanner position</button></div>
      <p class="tip">Auto-orient lays the cusp tips flat and finds the front from the shape of the arch. It can be fooled by part-arch scans — use “3 clicks” on three well-spread cusp tips, then the sliders. Upper and lower move together so their bite is kept.</p>`);
    const oq = (k) => orientEl.querySelector(`[data-so=${k}]`);
    segBind(oq('which').querySelector('.seg'), (v) => { which = v; resetSliders(); });
    const slide = () => { const pv = +oq('pitch').value, rv = +oq('roll').value, yv = +oq('yaw').value; const M = rotationAbout('z', yv).multiply(rotationAbout('y', rv)).multiply(rotationAbout('x', pv)); for (const j of targets()) { if (!base[j]) base[j] = S[j].matrix.clone(); setMatrix(j, M.clone().multiply(base[j])); } viewer.invalidate(); };
    for (const k of ['pitch', 'roll', 'yaw']) { oq(k).addEventListener('input', () => { oq(k).parentElement.querySelector('.val').textContent = (+oq(k).value).toFixed(1).replace('.0', '') + '°'; slide(); }); oq(k).addEventListener('change', () => fire('oriented')); }
    const stopTool = () => { if (planeTool) { planeTool.dispose(); planeTool = null; viewer.setTool(null); shell.hint(''); oq('plane').classList.remove('on'); oq('centre').classList.remove('on'); } };
    orientEl.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-so]'); if (!b) return; const k = b.dataset.so;
      if (!S.upper && !S.lower) return shell.status('Load a scan first', true);
      if (k === 'auto') { stopTool(); S.autoOrient(); }
      else if (k === 'flip') discrete(rotationAbout('y', 180));
      else if (k === 'turn') discrete(rotationAbout('z', 180));
      else if (k === 'raw') { for (const j of targets()) setMatrix(j, new THREE.Matrix4()); resetSliders(); viewer.fit(); fire('oriented'); }
      else if (k === 'plane' || k === 'centre') {
        const was = b.classList.contains('on'); stopTool(); if (was) return;
        const need = k === 'plane' ? 3 : 1; b.classList.add('on');
        shell.hint(k === 'plane' ? 'Click three well-spread cusp tips (e.g. a back tooth each side and a front tooth).' : 'Click the midline between the two central incisors.');
        planeTool = new PointTool(viewer, { targets: S.objects, max: need, color: COLORS.warn, onChange: (what) => {
          if (what !== 'add' || planeTool.points.length < need) return;
          const P = planeTool.points.map((x) => x.p.clone()); stopTool();
          discrete(k === 'plane' ? alignPlaneToZ0(P[0], P[1], P[2]) : new THREE.Matrix4().makeTranslation(-P[0].x, 0, 0));
          shell.status(k === 'plane' ? 'Biting plane set' : 'Midline set');
        } });
        viewer.setTool(planeTool.tool);
      }
    });
    const oi = typeof o.orientStep === 'number' ? o.orientStep : shell.steps.findIndex((s) => s.id === o.orientStep);
    shell.onStepChange((i, prev) => {
      if (i === oi) {
        resetSliders();
        if (!guides) { guides = new THREE.Group(); guides.userData.noFit = true; const g = new THREE.GridHelper(110, 11, 0x5eead4, 0x3b5a7a); g.rotation.x = Math.PI / 2; g.material.transparent = true; g.material.opacity = 0.55; g.userData.noFit = true; guides.add(g); viewer.scene.add(guides); guides.userData.labels = [['FRONT', [0, -58, 0]], ['BACK', [0, 58, 0]], ["PATIENT'S LEFT", [60, 0, 0]], ["PATIENT'S RIGHT", [-60, 0, 0]]].map(([t, p]) => viewer.label(t, new THREE.Vector3(...p), { color: 'rgba(13,148,136,.9)' })); }
        guides.visible = true; guides.userData.labels.forEach((l) => { l.hidden = false; }); viewer.invalidate();
      } else if (prev === oi) { stopTool(); if (guides) { guides.visible = false; guides.userData.labels.forEach((l) => { l.hidden = true; }); viewer.invalidate(); } }
    });
  }
  refreshUI();
  if (EMBED) {
    shell.hideStep(o.loadStep); if (o.orientStep != null) shell.hideStep(o.orientStep);
    // what the hub can ask of this tool (registered once the page's own script has finished setting itself up)
    const api = {
      app: appName,
      /** take the hub's scans — and this tool's own saved work when the hub passes it along */
      importCase: async (blob) => { await shell.busy('Loading the scans…', async () => { S.useCase(await DentalCase.fromBlob(blob)); }); shell.goto(shell.current); },   // …and enter the current step again, now with scans
      /** this tool's own work only (its data section and the meshes it made), without the scans */
      exportPart: async () => { const c = S.toCase(), p = new DentalCase(); p.meta = { ...c.meta }; p.data = c.data; p.items = c.items.filter((it) => !/-scan$/.test(it.role)); return p.toBlob(appName, { compress: false }); },
      clear: () => { for (const j of JAWS) if (S[j]) { viewer.remove(S[j].object); S[j] = null; cache[j] = null; } S.dcase = null; S.inBite = true; S.demoTruth = null; refreshUI(); fire('cleared', {}); },
      hasScans: () => !!(S.upper || S.lower),
      step: () => (shell.current >= 0 ? shell.steps[shell.current].id : null),
      goto: (id) => { if (shell.steps.some((st) => st.id === id)) shell.goto(id); },
    };
    setTimeout(() => { try { HUB.register(window, api); } catch (e) { console.error(e); } }, 0);
  }
  return S;
}

// ───────────────────────────── lining up two scans of the same arch ─────────────────────────────
/** eigenvector of the largest eigenvalue of a symmetric 4×4 matrix (Jacobi) */
function eigMax4(A) {
  const a = A.map((r) => r.slice()), V = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0; for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) off += a[i][j] * a[i][j]; if (off < 1e-22) break;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
      if (Math.abs(a[p][q]) < 1e-30) continue; const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 4; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 4; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 4; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  let b = 0; for (let i = 1; i < 4; i++) if (a[i][i] > a[b][b]) b = i; return [V[0][b], V[1][b], V[2][b], V[3][b]];
}
/** The rigid motion (Matrix4) that best moves points src onto dst, least squares (Horn's quaternion method). src, dst: flat [x,y,z,…] */
export function rigidFit(src, dst) {
  const n = src.length / 3, cs = [0, 0, 0], cd = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { cs[k] += src[3 * i + k] / n; cd[k] += dst[3 * i + k] / n; }
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) S[a][b] += (src[3 * i + a] - cs[a]) * (dst[3 * i + b] - cd[b]);
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const q = eigMax4([[xx + yy + zz, yz - zy, zx - xz, xy - yx], [yz - zy, xx - yy - zz, xy + yx, zx + xz], [zx - xz, xy + yx, -xx + yy - zz, yz + zy], [xy - yx, zx + xz, yz + zy, -xx - yy + zz]]);
  const R = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(q[1], q[2], q[3], q[0]).normalize()), c = new THREE.Vector3(...cs).applyMatrix4(R);
  return R.setPosition(cd[0] - c.x, cd[1] - c.y, cd[2] - c.z);
}
/**
 * Line up `moving` (a mesh; `start` = its first guess, a Matrix4 into the reference's frame) with `reference` by trimmed
 * iterative closest points: every round, only the closest `keep` share of the pairs is used, so a part that really changed
 * (wear, a new restoration, gum that was scanned further) does not pull the fit. Several start turns about the vertical are tried.
 * → { matrix (moving → reference frame), rms (mm, over the pairs kept), kept (share), iterations }
 */
export function alignScans(moving, reference, o = {}) {
  const keep = o.keep ?? 0.8, refG = new THREE.BufferGeometry(); refG.setAttribute('position', new THREE.BufferAttribute(reference.positions, 3)); refG.setIndex(new THREE.BufferAttribute(Uint32Array.from(reference.indices), 1));   // a copy: the BVH reorders it
  const bvh = o.bvh || new MeshBVH(refG), P = moving.positions, nV = P.length / 3, hit = {}, q = new THREE.Vector3();
  const sample = (n) => { const st = Math.max(1, Math.floor(nV / n)), out = []; for (let v = 0; v < nV; v += st) out.push(P[3 * v], P[3 * v + 1], P[3 * v + 2]); return out; };
  const run = (M0, pts, iters, kp) => {
    let M = M0.clone(), rms = Infinity, it = 0; const n = pts.length / 3, src = new Float64Array(n * 3), dst = new Float64Array(n * 3), d = new Float64Array(n), e = M.elements;
    for (; it < iters; it++) {
      const E = M.elements;
      for (let i = 0; i < n; i++) { const x = pts[3 * i], y = pts[3 * i + 1], z = pts[3 * i + 2]; q.set(E[0] * x + E[4] * y + E[8] * z + E[12], E[1] * x + E[5] * y + E[9] * z + E[13], E[2] * x + E[6] * y + E[10] * z + E[14]); bvh.closestPointToPoint(q, hit); src[3 * i] = x; src[3 * i + 1] = y; src[3 * i + 2] = z; dst[3 * i] = hit.point.x; dst[3 * i + 1] = hit.point.y; dst[3 * i + 2] = hit.point.z; d[i] = hit.distance; }
      const lim = Float64Array.from(d).sort()[Math.min(n - 1, Math.floor(n * kp))], s2 = [], d2 = []; let ss = 0, m = 0;
      for (let i = 0; i < n; i++) if (d[i] <= lim) { s2.push(src[3 * i], src[3 * i + 1], src[3 * i + 2]); d2.push(dst[3 * i], dst[3 * i + 1], dst[3 * i + 2]); ss += d[i] * d[i]; m++; }
      const nr = Math.sqrt(ss / Math.max(1, m)), Mn = rigidFit(s2, d2), mv = Math.abs(Mn.elements[12] - M.elements[12]) + Math.abs(Mn.elements[13] - M.elements[13]) + Math.abs(Mn.elements[14] - M.elements[14]);
      M = Mn; if (Math.abs(rms - nr) < 1e-5 && mv < 1e-4) { rms = nr; break; } rms = nr;
    }
    return { M, rms, it };
  };
  const coarse = sample(1500), starts = o.turns || [0, -10, 10, -20, 20], c = new THREE.Vector3(...meshBounds(moving).center).applyMatrix4(o.start); let best = null;
  for (const deg of starts) {                                     // turns about the vertical of the reference frame, through the moving scan's centre
    const T = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(deg))).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z)).multiply(o.start);
    const r = run(T, coarse, 30, 0.7); if (!best || r.rms < best.rms) best = r;
  }
  const fine = run(best.M, sample(o.points || 8000), 60, keep);
  return { matrix: fine.M, rms: fine.rms, kept: keep, iterations: fine.it };
}

// ───────────────────────────── tidy and trim (shared step) ─────────────────────────────
/** Keep the part of a mesh where d ≥ 0 (d: one signed distance per vertex). New vertices are shared so the cut stays a clean edge. */
export function clipMesh(mesh, d) {
  const Q = mesh.positions, I = mesh.indices, C = mesh.colors, nV = Q.length / 3, map = new Int32Array(nV).fill(-1), NP = [], NC = C ? [] : null, NI = [], edge = new Map();
  const vert = (i) => { if (map[i] < 0) { map[i] = NP.length / 3; NP.push(Q[3 * i], Q[3 * i + 1], Q[3 * i + 2]); if (NC) NC.push(C[3 * i], C[3 * i + 1], C[3 * i + 2]); } return map[i]; };
  const cut = (a, b) => { const key = a < b ? a * nV + b : b * nV + a; let v = edge.get(key); if (v === undefined) { const t = d[a] / (d[a] - d[b]); v = NP.length / 3; for (let k = 0; k < 3; k++) NP.push(Q[3 * a + k] + (Q[3 * b + k] - Q[3 * a + k]) * t); if (NC) for (let k = 0; k < 3; k++) NC.push(C[3 * a + k] + (C[3 * b + k] - C[3 * a + k]) * t); edge.set(key, v); } return v; };
  for (let f = 0; f < I.length; f += 3) {
    const a = I[f], b = I[f + 1], c = I[f + 2], ia = d[a] >= 0, ib = d[b] >= 0, ic = d[c] >= 0, n = ia + ib + ic;
    if (n === 3) NI.push(vert(a), vert(b), vert(c));
    else if (n === 1) { const [p, q, r] = ia ? [a, b, c] : ib ? [b, c, a] : [c, a, b]; NI.push(vert(p), cut(p, q), cut(p, r)); }
    else if (n === 2) { const [p, q, r] = !ia ? [a, b, c] : !ib ? [b, c, a] : [c, a, b]; const u = cut(q, p), v = cut(r, p); NI.push(u, vert(q), vert(r), u, vert(r), v); }
  }
  return { positions: Float32Array.from(NP), indices: Uint32Array.from(NI), colors: NC ? Float32Array.from(NC) : null, name: mesh.name };
}
/**
 * The shared “Tidy and trim” step: cut away excess gum with a plane, erase by painting, undo.
 *   const trim = createTrimStep({ shell, viewer, scans, step: 'trim' });
 * It changes the scan itself (scans.replaceRaw → onChange 'loaded', reason 'replace'), so whatever is built afterwards starts from the tidied scan.
 *   trim.jaw · trim.setJaw(j) · trim.doTrim() · trim.setPaint(bool) · trim.paintAt(hit) · trim.showPaint() · trim.clearPaint()
 *   trim.painted → Set of triangle indices | null · trim.canUndo(j) · trim.undo() · trim.sync()
 */
export function createTrimStep(o) {
  const { shell, viewer, scans } = o, JAWS = ['upper', 'lower'], NAME = { upper: 'Upper', lower: 'Lower' };
  const si = typeof o.step === 'number' ? o.step : shell.steps.findIndex((s) => s.id === (o.step || 'trim')), body = shell.stepEl(si).querySelector('.body');
  body.insertAdjacentHTML('afterbegin', `
      <p class="lead">Remove anything you do not want in the scan. Skip this if the scan is already tidy.</p>
      <div class="row" id="trJawRow"><label>Work on</label><div class="seg" id="trJaw"><button data-v="upper" type="button" title="Tidy the upper scan">Upper</button><button data-v="lower" type="button" title="Tidy the lower scan">Lower</button></div></div>
      <div class="h4">Cut away excess gum</div>
      <div class="row"><label>Keep this far past the biting plane</label><input type="range" id="trDepth" min="4" max="30" step="0.5" value="30"><span class="val"></span></div>
      <div class="btns"><button class="btn pri" id="trApply" type="button" title="Remove everything beyond the teal plane">Cut here</button></div>
      <div class="h4">Erase by painting</div>
      <div class="row"><label>Brush size</label><input type="range" id="trBrush" min="1" max="8" step="0.5" value="3"><span class="val"></span></div>
      <div class="btns"><button class="btn" id="trPaint" type="button" title="Drag over the scan to mark what to remove">Paint to erase</button><button class="btn" id="trDelete" type="button" disabled title="Remove the painted area">Delete painted</button><button class="btn" id="trClear" type="button" disabled title="Unmark everything">Clear paint</button></div>
      <hr><div class="btns"><button class="btn" id="trUndo" type="button" disabled title="Undo the last cut or erase on this arch">Undo</button></div>
      <p class="tip">Floating bits are removed automatically when a scan is loaded, and small holes are closed when a model is built. Use the plane to cut off excess cheek or sulcus, and the brush for stray flaps. While painting, rotate with the right mouse button or two fingers.</p>`);
  const q = (id) => body.querySelector('#' + id), undo = { upper: [], lower: [] };
  let jaw = 'lower', plane = null, paintOn = false, painted = null, paintMesh = null, ring = null;
  const depth = rangeBind(q('trDepth'), () => update(), { fmt: (v) => v.toFixed(1) + ' mm' }), brush = rangeBind(q('trBrush'), () => {}, { fmt: (v) => v.toFixed(1) + ' mm' });
  // an undo step only counts while the scan is still the one that cut or erase produced (a new file, a case or a swap ends the history)
  const canUndo = (j) => { const st = undo[j]; if (st.length && (!scans[j] || scans[j].raw !== st[st.length - 1].after)) st.length = 0; return st.length > 0; };
  function update() {
    if (!plane) { plane = new THREE.Mesh(new THREE.PlaneGeometry(110, 95), new THREE.MeshBasicMaterial({ color: 0x14b8a6, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })); plane.userData.noFit = true; plane.renderOrder = 5; viewer.scene.add(plane); }
    const on = shell.current === si && scans.has(jaw); plane.visible = on;
    if (on) { const b = meshBounds(scans.framed(jaw)); plane.position.set(b.center[0], b.center[1], jaw === 'lower' ? -depth.get() : depth.get()); }
    viewer.invalidate();
  }
  function sync() {
    const both = scans.has('upper') && scans.has('lower'); q('trJawRow').hidden = !both;
    if (!scans.has(jaw)) { const other = JAWS.find((j) => scans.has(j)); if (other) { jaw = other; setSeg(other); } }
    for (const j of JAWS) canUndo(j);
    q('trUndo').disabled = !canUndo(jaw);
  }
  function applyRaw(j, mesh) { const before = scans[j].raw, cl = cleanMesh(mesh); canUndo(j); undo[j].push({ before, after: cl.mesh }); if (undo[j].length > 4) undo[j].shift(); scans.replaceRaw(j, cl.mesh); clearPaint(); update(); sync(); return cl.report; }
  function doTrim() {
    const j = jaw; if (!scans.has(j)) return shell.status('Load a scan first', true);
    const sc = scans[j], e = sc.matrix.elements, Q = sc.raw.positions, d = new Float32Array(Q.length / 3), X = depth.get(), sg = j === 'lower' ? 1 : -1; let out = 0;
    for (let i = 0; i < d.length; i++) { const z = e[2] * Q[3 * i] + e[6] * Q[3 * i + 1] + e[10] * Q[3 * i + 2] + e[14]; d[i] = sg * z + X; if (d[i] < 0) out++; }
    if (!out) return shell.status('Nothing lies beyond the plane — move it closer to the teeth');
    if (out > d.length * 0.9) return shell.status('That would remove almost everything — move the plane away from the teeth', true);
    const rep = applyRaw(j, clipMesh(sc.raw, d)); shell.status(`${NAME[j]} trimmed${rep.islandsRemoved ? ` · ${rep.islandsRemoved} cut-off bit${rep.islandsRemoved > 1 ? 's' : ''} removed` : ''}`);
  }
  function clearPaint() { painted = null; if (paintMesh) { viewer.remove(paintMesh); paintMesh = null; } q('trDelete').disabled = q('trClear').disabled = true; viewer.invalidate(); }
  function showPaint() {
    const sc = scans[jaw]; if (!sc || !painted) return; const I = sc.raw.indices, idx = []; for (const f of painted) idx.push(I[3 * f], I[3 * f + 1], I[3 * f + 2]);
    if (paintMesh) viewer.remove(paintMesh);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', sc.object.geometry.attributes.position); g.setIndex(idx);
    paintMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, transparent: true, opacity: 0.85 }));
    paintMesh.matrixAutoUpdate = false; paintMesh.matrix.copy(sc.matrix); paintMesh.userData.noFit = true; viewer.scene.add(paintMesh); paintMesh.geometry.dispose = () => {}; viewer.invalidate();
    q('trDelete').disabled = q('trClear').disabled = painted.size === 0;
  }
  function paintAt(hit) {
    const sc = scans[jaw], r = brush.get(), c = hit.point.clone().applyMatrix4(sc.matrix.clone().invert()), sph = new THREE.Sphere(c, r), tmp = new THREE.Vector3();
    if (!painted) painted = new Set();
    sc.object.geometry.boundsTree.shapecast({ intersectsBounds: (box) => sph.intersectsBox(box), intersectsTriangle: (tri, ti) => { tri.closestPointToPoint(c, tmp); if (tmp.distanceToSquared(c) <= r * r) painted.add(ti); return false; } });
  }
  const paintTool = { cursor: 'crosshair',
    onDown: (i) => { if (i.button !== 0) return false; const h = i.pick(scans[jaw] ? [scans[jaw].object] : []); if (!h) return false; paintAt(h); showPaint(); return true; },
    onMove: (i) => { const sc = scans[jaw]; if (!sc) return; const h = i.pick([sc.object]); if (ring) { ring.visible = !!h; if (h) { ring.position.copy(h.point).addScaledVector(h.normal, 0.15); ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), h.normal); ring.scale.setScalar(brush.get()); } viewer.invalidate(); } if (i.dragging && h) { paintAt(h); showPaint(); } },
    onUp: () => {} };
  function setPaint(on) {
    paintOn = on; q('trPaint').classList.toggle('on', on);
    if (on) { if (!ring) { ring = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide })); ring.renderOrder = 20; ring.userData.noFit = true; ring.visible = false; viewer.scene.add(ring); } viewer.setTool(paintTool); viewer.controls.mouseButtons.LEFT = -1; viewer.controls.touches.ONE = -1; viewer.controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE; shell.hint('Drag over the scan to mark what to erase · right mouse button or two fingers rotate'); }
    else { if (viewer.tool === paintTool) viewer.setTool(null); if (ring) ring.visible = false; viewer.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE; viewer.controls.touches.ONE = THREE.TOUCH.ROTATE; viewer.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN; shell.hint(''); viewer.invalidate(); }
  }
  function undoLast() { const j = jaw; if (!canUndo(j)) return sync(); const e = undo[j].pop(); scans.replaceRaw(j, e.before); clearPaint(); update(); sync(); shell.status('Undone'); }
  q('trApply').addEventListener('click', doTrim);
  q('trPaint').addEventListener('click', () => { if (!scans.has(jaw)) return shell.status('Load a scan first', true); setPaint(!paintOn); });
  q('trClear').addEventListener('click', clearPaint);
  q('trDelete').addEventListener('click', () => {
    const j = jaw, sc = scans[j]; if (!sc || !painted || !painted.size) return; const I = sc.raw.indices, nF = I.length / 3;
    if (painted.size > nF * 0.9) return shell.status('That would remove almost everything', true);
    const out = new Uint32Array((nF - painted.size) * 3); let t = 0; for (let f = 0; f < nF; f++) { if (painted.has(f)) continue; out[t++] = I[3 * f]; out[t++] = I[3 * f + 1]; out[t++] = I[3 * f + 2]; }
    const n = painted.size; applyRaw(j, { ...sc.raw, indices: out }); shell.status(`${n.toLocaleString('en-GB')} triangles erased from the ${j} scan`);
  });
  q('trUndo').addEventListener('click', undoLast);
  const setSeg = segBind(q('trJaw'), (v) => { clearPaint(); jaw = v; update(); sync(); }, jaw);
  scans.on((what) => { if (what !== 'visibility') { if (what !== 'oriented' && painted) clearPaint(); update(); sync(); } });
  shell.onStepChange((i) => { if (i !== si) { if (paintOn) setPaint(false); clearPaint(); } update(); sync(); });
  sync();
  return { get jaw() { return jaw; }, setJaw: (j) => { clearPaint(); jaw = j; setSeg(j); update(); sync(); }, doTrim, setPaint, paintAt, showPaint, clearPaint, get painted() { return painted; }, get painting() { return paintOn; }, canUndo, undo: undoLast, sync, update };
}
