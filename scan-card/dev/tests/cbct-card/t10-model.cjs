// t10-model: the trained tooth network's path through the page, and a scan with no slice positions.
// The network here is a stand-in (toothseg-test/fake.onnx: "brighter than 350 is tooth, and centre where it is tooth for
// 0.6 mm each way"), which is right on the scan made up for it below: the demo's teeth alone, solid, in air.
// It is run by the real engine (ONNX Runtime's wasm from the page's own pack, in the page's own worker), so the download
// with its question first, the device's store, the worker, the teeth made from the answer, the tooth shown, the replica
// from it, the cuts by hand, the switch back to the rules, a second tooth, two teeth in contact, and the pack found again
// after a reload are all the page's real ones. (What is made of a true answer — and the canals inside it — is u4-model's
// business; the real weights are tried on the private scans only: they are not needed here.)
// First: a multi-frame file without positions opens the right way up, says its slice order was assumed, and can be flipped.
const { open, ok, OUT, DATA, truth, screenOf } = require('./lib.cjs');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const PACK = '/home/claude/suite/dev/data/toothseg-test/', REAL = '/home/claude/suite/cbct-card/toothseg/', URL_PACK = '/dev/data/toothseg-test/';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
function makePack() {
  fs.mkdirSync(PACK, { recursive: true });
  const wasm = fs.readFileSync(REAL + 'ort-wasm-simd-threaded.wasm'), model = fs.readFileSync(path.join(__dirname, 'toothseg-test/fake.onnx'));
  fs.copyFileSync(REAL + 'worker.js', PACK + 'worker.js'); fs.writeFileSync(PACK + 'fake.onnx', model);
  fs.writeFileSync(PACK + 'manifest.json', JSON.stringify({ name: 'stand-in for the tests', version: 'test-1', input: 'x', output: 'y',
    wasm: { file: '/cbct-card/toothseg/ort-wasm-simd-threaded.wasm', bytes: wasm.length, sha256: sha(wasm) }, model: { bytes: model.length, sha256: sha(model), parts: [{ file: 'fake.onnx', bytes: model.length }] } }));
  return wasm.length + model.length;
}
(async () => {
  const D = await import('/home/claude/suite/shared/dicom.js'), teeth = Object.fromEntries(D.phantomTeeth().map((t) => [t.name, t])), T = truth();
  const bytes = makePack(), init = { fn: (b) => { window.TOOTHSEG = { base: b }; }, arg: URL_PACK };
  const a = await open({ init }), { page, errors } = a;

  // ── a file with no slice positions
  await page.setInputFiles('#lFilesIn', DATA + 'p-mfnopos.dcm'); await page.waitForFunction(() => APP.S.vol, null, { timeout: 120000 }); await a.idle();
  const samples = (flip) => page.evaluate(([t, flip]) => { const v = APP.S.vol, nz = v.dims[2]; let bad = 0; for (const [i, j, k, val] of t.samples) if (v.data[i + v.dims[0] * (j + v.dims[1] * (flip ? nz - 1 - k : k))] + v.shift !== val) bad++; return { bad, guessed: !!v.guessed, flipped: !!v.flipped, flipShown: !document.querySelector('#lFlip').hidden, info: document.querySelector('#lInfo').textContent }; }, [T.variants['p-mfnopos'], flip]);
  let s = await samples(false);
  ok(s.bad === 0 && s.guessed && !s.flipped && s.flipShown && /first slice at the top \(assumed\)/.test(s.info) && /Flip top to bottom/.test(s.info), `a multi-frame file with no slice positions (frames stored from the top down) opens the right way up: ${s.bad} sample voxels wrong; the page says the order was assumed and offers “Flip top to bottom”`);
  await page.click('#lFlip'); await a.idle(); s = await samples(true);
  ok(s.bad === 0 && s.flipped && /turned over by you/.test(s.info), `“Flip top to bottom” turns the scan over (${s.bad} wrong against the turned truth) and says so`);
  await page.click('#lFlip'); await a.idle(); s = await samples(false); ok(s.bad === 0 && !s.flipped, 'pressed again, it is back as it was');
  // the stand-in's scan: the demo jaw's teeth alone — solid (1700), in air (−1000), the edge a ramp one voxel wide (half way at 350)
  const solid = (pg) => pg.evaluate(() => { const V = APP.S.vol, D = APP.D, [nx, ny] = V.dims, h = V.spacing[0], o = V.origin, d = V.data, vols = {}; d.fill(-1000);
    for (const t of APP.S.demo.teeth) { let sum = 0; const f = D.phantomToothField(t), R = Math.max(t.md, t.bl) / 2 + 2, lo = [t.base[0] - R, t.base[1] - R, t.base[2] - t.root - 1.5], hi = [t.base[0] + R, t.base[1] + R, t.base[2] + t.crown + 1.5];
      const a0 = lo.map((v, q) => Math.max(0, Math.floor((v - o[q]) / h))), a1 = hi.map((v, q) => Math.min(V.dims[q] - 1, Math.ceil((v - o[q]) / h)));
      for (let k = a0[2]; k <= a1[2]; k++) for (let j = a0[1]; j <= a1[1]; j++) for (let i = a0[0]; i <= a1[0]; i++) { const v = Math.round(-1000 + 2700 * Math.max(0, Math.min(1, 0.5 - f(o[0] + i * h, o[1] + j * h, o[2] + k * h) / h))), q = i + nx * (j + ny * k); sum += (v + 1000) / 2700; if (v > d[q]) d[q] = v; } vols[t.name] = sum * h * h * h; }
    V.min = -1000; V.max = 1700; const demo = APP.S.demo; APP.setVolume(V); APP.S.demo = demo; return vols; });
  await a.demo();
  ok(await page.evaluate(() => document.querySelector('#lFlip').hidden), 'a scan whose files place every slice (and the demo) has no flip button');
  const TV = await solid(page); await a.idle();   // (each tooth's volume as this scan holds it)

  // ── the model
  await page.click('.step[data-id=tooth] h3'); await a.idle();
  const state = () => page.evaluate(() => { const s = APP.S.tooth.seg, M = APP.S.tooth.model, hid = (id) => document.getElementById(id).closest('.row').hidden; return { st: APP.MODEL.state, by: APP.MODEL.by, seq: APP.MODEL.seq, run: !!APP.MODEL.run, info: APP.MODEL.info && { kept: APP.MODEL.info.kept, stored: APP.MODEL.info.stored, version: APP.MODEL.info.version }, seg: s && !s.error ? { model: !!s.model, volume: s.volume, length: s.length, up: s.axis[2] * s.crown > 0 } : s && { error: s.error }, M: M && (M.error ? { error: M.error } : { teeth: M.teeth, parted: M.parted, clipped: M.clipped, pass: M.pass, n: M.cube.n }), rows: ['dShape', 'dR', 'dUp', 'dDown', 'dT'].map(hid), fit: document.getElementById('dFit').hidden, note: document.getElementById('dModel').textContent, out: document.getElementById('dOut').textContent, on: document.querySelector('#dBy .on').dataset.v }; });
  const tap = async (fdi, tool) => { const t = teeth[fdi], p = [0, 1, 2].map((q) => t.base[q] + t.w[q] * t.crown * 0.3);
    await page.evaluate((z) => { APP.S.cur[2] = Math.round(APP.D.voxelOf(APP.S.vol, 0, 0, z)[2]); APP.crossChanged(); }, p[2]); await page.waitForTimeout(250); if (tool) await page.click(`#cbTool [data-v=${tool}]`);
    const [x, y] = await screenOf(page, 'ax', p); await page.mouse.click(x, y); await a.idle(); await page.waitForFunction(() => APP.S.tooth.rules && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 }); await page.waitForTimeout(300); };
  const modelDone = async () => { await page.waitForFunction(() => APP.S.tooth.model && !APP.MODEL.run && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 }); await a.idle(); await page.waitForTimeout(300); };
  await page.waitForFunction(() => APP.MODEL.state === 'ask', null, { timeout: 60000 }); let st = await state();
  ok(st.on === 'model' && st.by === 'model' && st.st === 'ask' && /one-off download of about \d+ MB/.test(st.note) && /not sent anywhere/.test(st.note) && await page.evaluate(() => !!document.querySelector('#dGet') && !APP.MODEL.worker), `“Model” is the outline of choice: opening the step looks for the pack on this device and, not finding it, asks before fetching anything (“${st.note.slice(0, 58)}…”)`);
  await tap(45); st = await state(); const rulesVol = st.seg.volume, hex = () => page.evaluate(() => (APP.r3objs.tooth.userData.solid || APP.r3objs.tooth.material).color.getHex());
  ok(st.st === 'ask' && st.seg && !st.seg.model && /by the rules/.test(st.out) && /outline shown is by the rules/.test(st.note) && await hex() === 0x5eead4, `until it is downloaded a tapped tooth is outlined by the rules, and the page says so (45: ${st.seg.volume.toFixed(0)} mm³)`);
  // the download held up for a moment: meanwhile the rules' outline is marked as a stand-in (amber, "the model is working")
  await page.route('**/fake.onnx', async (r) => { await new Promise((res) => setTimeout(res, 1500)); r.continue(); });
  await page.click('#dGet'); await page.waitForFunction(() => APP.MODEL.state === 'loading', null, { timeout: 30000 }); await page.waitForTimeout(250); const mid = await state(), midHex = await hex();
  ok(/stand-in/.test(mid.out) && midHex === 0xf5b446 && mid.seg && !mid.seg.model, 'while the model is fetched and run, the rules’ outline is marked as a stand-in (amber in 3D and in the slices, “stand-in: the model is working”)');
  await modelDone(); st = await state(); ok(await hex() === 0x5eead4 && !/stand-in/.test(st.out), '… and the model’s outline, when it arrives, is teal again');
  ok(st.st === 'ready' && st.info && st.info.kept === false && st.info.stored === true && st.info.version === 'test-1' && st.seq === 1, `“Download the model” fetched the pack (${(bytes / 1e6).toFixed(1)} MB here: the real engine, a stand-in network), checked it and kept it on the device; the network was run once`);
  if (!(st.rows.every(Boolean) && st.fit)) console.log('    state', JSON.stringify({ rows: st.rows, fit: st.fit, out: st.out, M: st.M }));
  ok(st.seg && st.seg.model && Math.abs(st.seg.volume / TV[45] - 1) < 0.05 && st.seg.up && st.M && st.M.teeth >= 2 && !st.M.clipped && st.rows.every(Boolean) && st.fit && /model/.test(st.out) && /Outline/.test(st.out) && !/Threshold/.test(st.out),
    `45 by the model: ${st.seg.volume && st.seg.volume.toFixed(0)} mm³ (in this scan ${TV[45].toFixed(0)}), ${st.M && st.M.teeth} teeth in its cube of ${st.M && st.M.n.join(' × ')}, crown up; the read-out says “model”, and the region, width and threshold controls are put away`);
  await page.waitForTimeout(500); await page.screenshot({ path: OUT + 't10-model45.png' });
  // the replica from the model's outline
  await page.click('.step[data-id=replica] h3'); await a.idle(); await page.click('#rMake'); await a.idle(); await page.waitForFunction(() => APP.S.rep.info, null, { timeout: 120000 });
  const ri = await page.evaluate(() => APP.S.rep.info);
  ok(ri.closed && ri.parts === 1 && Math.abs(ri.volume / TV[45] - 1) < 0.05, `the replica made from it is closed, in one piece, ${ri.volume.toFixed(0)} mm³ (in this scan ${TV[45].toFixed(0)})`);
  // on the Root canals step, a new outline of the tooth has the canals looked for again by itself (here there are none to find: the teeth are solid)
  await page.click('.step[data-id=canal] h3'); await page.waitForFunction(() => APP.S.canal.seg && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 }); await a.idle();
  const v0 = await page.evaluate(() => APP.S.canal.ver); await page.evaluate(() => APP.segment({ frame: false })); await a.idle(); await page.waitForFunction(() => APP.S.canal.seg && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 });
  ok(await page.evaluate(() => APP.S.canal.ver) >= v0 + 2 && await page.evaluate(() => !!APP.S.canal.seg), 'on the Root canals step, when the tooth’s outline changes the canals are looked for again without being asked');
  // cuts by hand do not run the network again; nor does going to the rules and back
  await page.click('.step[data-id=tooth] h3'); await a.idle();
  const t45 = teeth[45], cut = [0, 1, 2].map((q) => t45.base[q] - t45.w[q] * t45.root * 0.7);
  await page.evaluate((p) => { const t = APP.S.tooth; t.hist.push(JSON.stringify({ seeds: t.seeds, not: t.not, erase: t.erase, roi: t.roi, T: t.T })); t.erase.push({ p, r: 1.5 }); return APP.segment(); }, cut); await a.idle(); await page.waitForTimeout(300); let s2 = await state();
  ok(s2.seg.model && s2.seg.volume < st.seg.volume - 8 && s2.seg.length < st.seg.length - 1 && s2.seq === 1, `an eraser mark across the root cuts the model’s tooth (${st.seg.volume.toFixed(0)} → ${s2.seg.volume.toFixed(0)} mm³) without the network running again`);
  await page.click('#dUndo'); await a.idle(); await page.waitForTimeout(300); s2 = await state(); ok(s2.seg.model && Math.abs(s2.seg.volume - st.seg.volume) < 1e-6 && s2.seq === 1, 'Undo puts it back');
  await page.click('#dBy [data-v=rules]'); await a.idle(); await page.waitForTimeout(300); s2 = await state();
  ok(s2.on === 'rules' && !s2.seg.model && Math.abs(s2.seg.volume - rulesVol) < 1e-6 && s2.rows.every((h) => !h) && !s2.fit && /Threshold/.test(s2.out), 'back to “Rules”: the rules’ outline and its controls return');
  await page.click('#dBy [data-v=model]'); await page.waitForFunction(() => APP.S.tooth.seg && APP.S.tooth.seg.model, null, { timeout: 60000 }); await a.idle(); s2 = await state();
  ok(s2.seg.model && Math.abs(s2.seg.volume - st.seg.volume) < 1e-6 && s2.seq === 1, '… and to “Model” again: its answer for this tap was kept, so it is there at once');
  // another tooth: a new run; a molar with two roots, then 35 in tight contact with 36
  await tap(46, 'tooth'); await modelDone(); s2 = await state();
  ok(s2.seg && s2.seg.model && Math.abs(s2.seg.volume / TV[46] - 1) < 0.05 && s2.seq === 2 && !s2.M.clipped, `a tap on 46 runs it again for that tooth: ${s2.seg.volume && s2.seg.volume.toFixed(0)} mm³ (in this scan ${TV[46].toFixed(0)}), cube ${s2.M && s2.M.n.join(' × ')}`);
  await tap(35, 'tooth'); await modelDone(); s2 = await state();
  ok(s2.seg && s2.seg.model && Math.abs(s2.seg.volume / TV[35] - 1) < 0.06, `35, in tight contact with 36: ${s2.seg.volume && s2.seg.volume.toFixed(0)} mm³ (in this scan ${TV[35].toFixed(0)})${s2.M && s2.M.parted ? `; the stand-in network had joined the two, and they were parted at the bridge (shrunk by ${s2.M.parted.at.toFixed(1)} mm)${/parted at the narrow bridge/.test(s2.out) ? ', which the page says' : ' — BUT THE PAGE DOES NOT SAY SO'}` : ''}`);
  if (s2.M && s2.M.parted) ok(/parted at the narrow bridge/.test(s2.out), 'the page warns that two joined teeth were parted');
  // after a reload: “Model” is remembered, and the pack comes from the device without asking
  await page.reload({ waitUntil: 'load' }); await page.waitForFunction(() => window.APP && APP.S, null, { timeout: 60000 }); await a.demo(); await solid(page); await a.idle(); await page.click('.step[data-id=tooth] h3'); await a.idle();
  st = await state(); ok(st.on === 'model' && st.by === 'model', 'after a reload “Model” is still chosen');
  await tap(45); await modelDone(); st = await state();
  ok(st.seg && st.seg.model && st.info && st.info.kept === true && Math.abs(st.seg.volume / TV[45] - 1) < 0.05, `… and the pack is taken from the device’s store, with no question and no download (45 again: ${st.seg.volume && st.seg.volume.toFixed(0)} mm³)`);
  ok(errors.length === 0, 'no page errors ' + errors.slice(0, 3).join(' | '));
  await a.close();

  // ── where the pack is not there (as in the single-file copy): said plainly, and the rules carry on
  const b = await open({ init: { fn: (x) => { window.TOOTHSEG = { base: x }; }, arg: '/dev/data/no-such-pack/' } }); await b.demo(); await b.page.click('.step[data-id=tooth] h3'); await b.idle();
  await b.page.waitForFunction(() => APP.MODEL.state === 'none', null, { timeout: 60000 });
  { const t = teeth[45], p = [0, 1, 2].map((q) => t.base[q] + t.w[q] * t.crown * 0.3); await b.page.evaluate((z) => { APP.S.cur[2] = Math.round(APP.D.voxelOf(APP.S.vol, 0, 0, z)[2]); APP.crossChanged(); }, p[2]); await b.page.waitForTimeout(250); const [x, y] = await screenOf(b.page, 'ax', p); await b.page.mouse.click(x, y); await b.idle(); await b.page.waitForFunction(() => APP.S.tooth.seg, null, { timeout: 120000 }); await b.page.waitForTimeout(400); }
  const nb = await b.page.evaluate(() => ({ off: document.querySelector('#dBy [data-v=model]').disabled, on: document.querySelector('#dBy .on').dataset.v, note: document.getElementById('dModel').textContent, seg: APP.S.tooth.seg && !APP.S.tooth.seg.error ? { model: !!APP.S.tooth.seg.model, volume: APP.S.tooth.seg.volume } : null, rows: document.getElementById('dR').closest('.row').hidden }));
  const other = b.errors.filter((e) => !/404|Failed to load resource|worker/i.test(e));
  ok(/cannot be loaded in this copy/.test(nb.note) && nb.off && nb.on === 'rules' && nb.seg && !nb.seg.model && Math.abs(nb.seg.volume / 422 - 1) < 0.03 && !nb.rows && other.length === 0, `with no pack beside the page, the step says the model cannot be loaded in this copy, “Model” is out of reach and the rules’ outline is used (45: ${nb.seg && nb.seg.volume.toFixed(0)} mm³) ${other.slice(0, 2).join(' | ')}`);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
