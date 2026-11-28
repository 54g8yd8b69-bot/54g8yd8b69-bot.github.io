// t11-image: brightness, contrast and sharpness of the slices, within reach on every step (“Image” in the bar above the
// slices). The row opens and closes and the slices keep their room; Brightness and Contrast are the window's level and width
// under plain names and stay in step with the Level and Width sliders, the presets and the Window tool; Sharpness sharpens
// the picture of every slice (steeper edges, flat parts and the scan's own values untouched), smooths it below 0, is the
// same slider as the one on the Slices step, is kept on the device and in a saved case; Reset; the same on a turned slice
// and on the Root canals step; and nothing that is measured or found changes with it.
const { open, ok, OUT } = require('./lib.cjs');
(async () => {
  const a = await open(), { page } = a; await a.demo();
  const set = (id, v) => page.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  const state = () => page.evaluate(() => ({ l: APP.S.win.l, w: APP.S.win.w, sharp: APP.S.sharp, preset: APP.S.preset, iB: +document.getElementById('iB').value, iC: +document.getElementById('iC').value, iS: +document.getElementById('iS').value, vS: +document.getElementById('vSharp').value, vL: +document.getElementById('vLevel').value, vW: +document.getElementById('vWidth').value, open: !document.getElementById('cbImg').hidden, exp: document.getElementById('cbImage').getAttribute('aria-expanded'), on: document.getElementById('cbImage').classList.contains('on'), span: Math.max(200, APP.S.vol.max - APP.S.vol.min), mid: (APP.S.vol.max + APP.S.vol.min) / 2, vals: [...document.querySelectorAll('#cbImg .val')].map((e) => e.textContent), stored: localStorage.getItem('notile.cbct.sharp') }));
  // the picture of a slice as drawn: how steep its edges are (mean step between neighbours) and a sum to tell two pictures apart
  const pic = (k = 'ax') => page.evaluate((k) => { const v = APP.views[k], g = APP.geom(v), d = v.off.getContext('2d').getImageData(0, 0, g.cols, g.rows).data; let grad = 0, sum = 0, n = 0; for (let r = 0; r < g.rows; r++) for (let c = 0; c + 1 < g.cols; c++) { const i = 4 * (r * g.cols + c); grad += Math.abs(d[i + 4] - d[i]); sum = (sum * 31 + d[i]) % 1000003; n++; } return { grad: grad / n, sum, cols: g.cols, rows: g.rows, h: v.h, w: v.w }; }, k);
  const settle = async () => { await page.waitForTimeout(350); };

  // ── the row ──
  await page.evaluate(() => APP.shell.goto('view')); await a.idle(); await settle();
  const s0 = await state(), p0 = await pic();
  ok(!s0.open && s0.exp === 'false' && s0.sharp === 0 && s0.iS === 0 && s0.vS === 0 && s0.preset === 'bone', `to begin with the row is closed, the bone window is on and nothing is sharpened (level ${s0.l}, width ${s0.w})`);
  await page.click('#cbImage'); await settle(); const s1 = await state(), p1 = await pic();
  ok(s1.open && s1.exp === 'true' && s1.on && p1.h > 100 && p1.h < p0.h && p0.h - p1.h < 60 && p1.sum === p0.sum, `“Image” opens a row of three sliders and Reset under the bar; the slices give up ${p0.h - p1.h} px of height and show the same picture`);
  ok(s1.iB === Math.round((s1.mid - s1.l) / (s1.span / 2) * 100) && s1.iC === Math.round(100 * Math.sqrt(1 - s1.w / s1.span)) && s1.iC > 25 && s1.iC < 75 && s1.vals.length === 3, `they show the window as it is: brightness ${s1.vals[0]}, contrast ${s1.vals[1]} (the bone window, near the middle), sharpness ${s1.vals[2]}`);

  // ── brightness and contrast are the window ──
  await set('iB', 40); await settle(); const b = await state(), pb = await pic();
  ok(Math.abs(b.l - (b.mid - 0.4 * b.span / 2)) <= 1 && b.w === s1.w && b.vL === b.l && b.iB === 40 && !b.preset && pb.sum !== p1.sum, `Brightness +40: the level goes to ${b.l} (the Level slider with it), the width stays ${b.w}; no preset is lit`);
  const mean = (k) => page.evaluate((k) => { const v = APP.views[k], g = APP.geom(v), d = v.off.getContext('2d').getImageData(0, 0, g.cols, g.rows).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i]; return s / (d.length / 4); }, k);
  const m40 = await mean('ax'); await set('iB', -40); await settle(); const mN = await mean('ax');
  ok(m40 > mN + 10, `the picture is brighter at +40 than at −40 (mean grey ${m40.toFixed(0)} against ${mN.toFixed(0)})`);
  await set('iB', 0); await set('iC', 80); await settle(); const c = await state();
  ok(Math.abs(c.w - c.span * (1 - 0.64)) <= 1 && c.vW === c.w && c.iC === 80 && Math.abs(c.l - c.mid) <= 1, `Contrast 80: the width goes to ${c.w} (the Width slider with it), the level stays ${c.l}`);
  await set('iC', 100); await settle(); const c100 = await state(); await set('iC', 0); await settle(); const c0 = await state();
  ok(c100.w === Math.round(c100.span / 50) && c0.w === c0.span, `Contrast 100 is a window a fiftieth of the scan’s values wide (${c100.w}), 0 every value (${c0.w})`);
  await page.click('#vPreset [data-v=teeth]'); await settle(); const t = await state();
  ok(t.preset === 'teeth' && t.iB === Math.round((t.mid - t.l) / (t.span / 2) * 100) && t.iC === Math.round(100 * Math.sqrt(1 - t.w / t.span)) && t.iC > s1.iC, `the Teeth preset moves the two sliders (brightness ${t.iB}, contrast ${t.iC}: more than bone’s ${s1.iC})`);
  await set('vWidth', 1500); await settle(); const vw = await state();
  ok(vw.w === 1500 && vw.iC === Math.round(100 * Math.sqrt(1 - 1500 / vw.span)), `the Width slider on the Slices step moves Contrast to ${vw.iC}`);
  await page.click('#vPreset [data-v=bone]'); await settle();

  // ── sharpness ──
  const raw = () => page.evaluate(() => { const V = APP.S.vol, k = Math.round(APP.S.cur[2]), n = V.dims[0] * V.dims[1]; let s = 0; for (let q = 0; q < n; q += 7) s = (s * 31 + V.data[k * n + q] + 5000) % 1000003; return s; });
  const r0 = await raw(), q0 = await pic(), co0 = await pic('co'), sa0 = await pic('sa');
  await set('iS', 100); await settle(); const sh = await state(), q1 = await pic(), co1 = await pic('co'), sa1 = await pic('sa');
  ok(sh.sharp === 100 && sh.vS === 100 && sh.vals[2] === '+100' && sh.stored === '100' && q1.grad > 1.25 * q0.grad && co1.grad > 1.25 * co0.grad && sa1.grad > 1.25 * sa0.grad && (await raw()) === r0, `Sharpness +100: edges in all three slices are steeper (mean step ${q0.grad.toFixed(2)} → ${q1.grad.toFixed(2)} axial, ${co0.grad.toFixed(2)} → ${co1.grad.toFixed(2)} coronal, ${sa0.grad.toFixed(2)} → ${sa1.grad.toFixed(2)} sagittal); the Slices step’s slider follows, the setting is kept on the device, and the scan’s own values are untouched`);
  await page.screenshot({ path: OUT + 't11-sharp-100.png' });
  await set('iS', -100); await settle(); const sm = await state(), q2 = await pic();
  ok(sm.sharp === -100 && sm.vals[2] === '-100' && q2.grad < 0.8 * q0.grad, `Sharpness −100 smooths instead (mean step ${q2.grad.toFixed(2)})`);
  await set('vSharp', 0); await settle(); const z = await state(), q3 = await pic();
  ok(z.sharp === 0 && z.iS === 0 && q3.sum === q0.sum, 'at 0 — set on the Slices step — the picture is the scan’s own again');
  // the sharpening itself, on a made-up picture: an edge overshoots on both sides, a flat part stays, values keep within the scan's
  const un = await page.evaluate(() => { const S = APP.S, lo = S.vol.min, hi = S.vol.max, cols = 24, rows = 8, src = new Int16Array(cols * rows); for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) src[r * cols + c] = c < 12 ? 500 : 1500;
    const keep = S.sharp; S.sharp = 100; const o = Array.from(APP.sharpen(src, cols, rows, 'test').subarray(3 * cols, 4 * cols)); S.sharp = -100; const b = Array.from(APP.sharpen(src, cols, rows, 'test').subarray(3 * cols, 4 * cols));
    src.fill(hi - 10); src[3 * cols + 12] = hi; S.sharp = 100; const top = Math.max(...APP.sharpen(src, cols, rows, 'test')); S.sharp = keep; return { o, b, top, hi, lo }; });
  ok(un.o[2] === 500 && un.o[21] === 1500 && Math.min(...un.o) < 450 && Math.max(...un.o) > 1550 && un.o[11] < 500 && un.o[12] > 1500 && un.b[11] > 500 && un.b[12] < 1500 && un.b[2] === 500 && un.top <= un.hi, `a step from 500 to 1500: sharpened it overshoots to ${Math.min(...un.o)} and ${Math.max(...un.o)} beside the edge and is flat away from it; smoothed it is ${un.b[11]} and ${un.b[12]} there; nothing leaves the scan’s range`);

  // ── on a turned slice, and on the Root canals step ──
  await page.evaluate(() => { APP.turnIn('ax', 20 * Math.PI / 180); }); await settle(); const o0 = await pic('co');
  await set('iS', 80); await settle(); const o1 = await pic('co'), lab = await page.evaluate(() => APP.views.co.lab.textContent);
  ok(/oblique/.test(lab) && o1.grad > 1.2 * o0.grad, `a turned slice (“${lab}”) is sharpened as well (mean step ${o0.grad.toFixed(2)} → ${o1.grad.toFixed(2)})`);
  await page.click('#cbStraight'); await settle(); await set('iS', 0);
  await page.click('#cbImage'); await settle(); const cl = await state(); ok(!cl.open && cl.exp === 'false' && !cl.on, '“Image” again closes the row');
  await page.evaluate(() => APP.shell.goto('canal')); await a.idle(); await settle();
  const vis = await page.evaluate(() => { const b = document.getElementById('cbImage'), r = b.getBoundingClientRect(); return r.width > 20 && getComputedStyle(b).display !== 'none' && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b; });
  await page.click('#cbImage'); await settle(); const k0 = await pic(); await set('iS', 60); await set('iC', 70); await settle(); const k1 = await pic(), ks = await state();
  ok(vis && ks.open && ks.sharp === 60 && ks.iC === 70 && k1.sum !== k0.sum, 'on the Root canals step “Image” is there in the bar and its sliders work without leaving the step');

  // ── kept in a saved case; Reset ──
  const saved = await page.evaluate(() => { const cc = new APP.N.DentalCase(); APP.extendCase(cc); window.__c = cc; return { sharp: cc.data.cbct.sharp, w: cc.data.cbct.window.w }; });
  await page.click('#iReset'); await settle(); const rs = await state();
  ok(rs.sharp === 0 && rs.preset === 'bone' && rs.l === s0.l && rs.w === s0.w && rs.iS === 0 && rs.stored === '0', `Reset: the bone window (level ${rs.l}, width ${rs.w}) and no sharpening`);
  await page.evaluate(() => APP.readCase(window.__c)); await a.idle(); await settle(); const rd = await state();
  ok(saved.sharp === 60 && rd.sharp === 60 && rd.w === saved.w && rd.iS === 60, `a saved case keeps the sharpness (${saved.sharp}) with the window, and puts both back`);
  await page.click('#iReset'); await settle();

  // ── nothing found or measured changes with it: the same tooth, to the voxel, with the picture sharpened ──
  const tooth = async () => { await page.evaluate(() => APP.shell.goto('tooth')); await a.idle(); return page.evaluate(async () => { const t = APP.D.phantomTeeth().find((x) => String(x.name) === '45'), p = [0, 1, 2].map((k) => t.base[k] + t.w[k] * t.crown * 0.4), T = APP.S.tooth; T.seeds = [p]; T.not = []; T.erase = []; T.fitted = false; T.roi = { shape: 'cyl', c: [p[0], p[1]], r: 7, z0: p[2] - 20, z1: p[2] + 20 }; APP.MODEL.by = 'rules'; await APP.segment(); const s = APP.S.tooth.seg; return s.error ? { error: s.error } : { volume: s.volume, n: s.count ?? s.lab.reduce((x, y) => x + y, 0) }; }); };
  const ta = await tooth(); await set('iS', 100); await settle(); const tb = await tooth();
  ok(!ta.error && !tb.error && ta.volume === tb.volume && ta.n === tb.n, `a tooth picked with the picture sharpened is the same tooth (${ta.error || ta.volume.toFixed(1)} mm³ both times): sharpening is for the eye only`);
  await set('iS', 0);
  const errs = a.errors.filter((e) => !/font/.test(e)); ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await a.close();
})().catch((e) => { console.error(e); process.exit(1); });
