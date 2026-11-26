// Models with a base, loaded into Model Card in random poses: auto-orient stands them on the base without the
// "could not be sure" warning; a raw scan still behaves as before; a base tilted 30° against the teeth still warns.
//   node dev/tests/core-orient/o2-model-card.cjs        (synthetic models, built in the page with mkbased.mjs)
const path = require('path');
const { openApp } = require(path.join(__dirname, '../../pw.cjs'));
const OUT = path.join(__dirname, '../../out/core-orient/');
require('fs').mkdirSync(OUT, { recursive: true });
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) { fails++; process.exitCode = 1; } };
(async () => {
  const { page, errors, shot, close } = await openApp('model-card', { width: 1400, height: 900 });
  await page.waitForFunction(() => window.APP && APP.scans, null, { timeout: 60000 });
  await page.evaluate(async () => {
    window.MB = await import('/dev/tests/core-orient/mkbased.mjs');
    window.MSGS = []; const st = APP.shell.status.bind(APP.shell); APP.shell.status = (t, e) => { MSGS.push({ t, e: !!e }); return st(t, e); };
  });
  const idle = () => page.waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 240000 });
  // build a model in the page, pose it at random, hand it over as a file (the same path as the file picker)
  const load = (cfg, seed, name) => page.evaluate(async ([cfg, seed, name]) => {
    const N = APP.N, m = cfg.raw ? { mesh: N.makeDemoArch({ jaw: cfg.jaw, res: 0.35 }).mesh } : await MB.makeBasedModel(N, APP.S, { res: 0.35, ...cfg });
    const pose = MB.randomPose(N, MB.rng(seed)), file = new File([N.stlBinary(N.transformMesh(m.mesh, pose))], name);
    for (const j of ['upper', 'lower']) APP.scans.clear(j);
    MSGS.length = 0; window.POSE = pose.toArray(); await APP.scans.loadFiles([file]);
  }, [cfg, seed, name]);
  const check = () => page.evaluate(() => {
    const N = APP.N, j = APP.scans.upper ? 'upper' : 'lower', sc = APP.scans[j], e = MB.orientError(N, sc.matrix, new N.THREE.Matrix4().fromArray(POSE));
    const r = N.autoOrient(sc.raw, j), b = N.meshBounds(APP.scans.framed(j));
    return { j, e, warn: MSGS.filter((m) => /orientation/.test(m.t)).map((m) => m.t), base: r.base, z: [b.min[2], b.max[2]] };
  });
  const cases = [
    ['lower model, horseshoe base, hollow with open underside', { jaw: 'lower', style: 'horseshoe', hollow: 'open' }, 11, 'model-lower.stl'],
    ['upper model, full base', { jaw: 'upper', style: 'full' }, 12, 'model-upper.stl'],
    ['lower model, base tilted 12° against the teeth', { jaw: 'lower', style: 'full', tilt: 12, tiltAz: 60 }, 13, 'tilted-lower.stl'],
  ];
  for (const [label, cfg, seed, name] of cases) {
    await load(cfg, seed, name); await idle(); const r = await check();
    const up = r.j === 'upper' ? r.z[1] > 12 : r.z[0] < -12;
    ok(r.warn.length === 0 && r.base && r.base.used !== 'none' && r.e.axis < (cfg.tilt ? 6 : 0.5) && r.e.yaw < 3 && up,
      `${label}: no orientation warning, base found (${r.base && r.base.used}, ${r.base && r.base.tilt.toFixed(1)}° from the cusp tips), occlusal axis off ${r.e.axis.toFixed(2)}°, front off ${r.e.yaw.toFixed(1)}°, base on the far side of the teeth (z ${r.z[0].toFixed(1)} … ${r.z[1].toFixed(1)})`);
  }
  await page.click('#bNext'); await page.waitForTimeout(300); await page.evaluate(() => { MSGS.length = 0; }); await page.click('[data-so=auto]'); await idle(); await page.waitForTimeout(200);
  const again = await check(); ok(again.warn.length === 0 && again.e.axis < 6, `Orient step “Auto-orient” button on the tilted model: no warning, axis off ${again.e.axis.toFixed(2)}°`);
  await shot(OUT + 'o2-orient-tilted.png');
  await load({ jaw: 'upper', raw: true }, 14, 'scan-upper.stl'); await idle(); const raw = await check();
  ok(raw.warn.length === 0 && raw.base === null && raw.e.axis < 6 && raw.e.yaw < 3, `raw upper scan (no base): no base used, no warning, axis off ${raw.e.axis.toFixed(1)}° (the cusp-tip method as before)`);
  await load({ jaw: 'lower', style: 'horseshoe', tilt: 30, tiltAz: 2 }, 15, 'steep-lower.stl'); await idle(); const steep = await check();
  ok(steep.warn.length === 1 && /base/.test(steep.warn[0]) && steep.e.axis < 6 && steep.z[0] < -12, `base tilted 30°: warns (“${steep.warn[0]}”) but still teeth up, axis off ${steep.e.axis.toFixed(1)}°`);
  await shot(OUT + 'o2-steep-warning.png');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await close();
  console.log(fails ? `${fails} FAILED` : 'all passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
