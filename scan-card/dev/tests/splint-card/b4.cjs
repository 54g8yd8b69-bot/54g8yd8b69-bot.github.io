const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const D = '/home/claude/suite/dev/data/';
(async () => {
  const { page, errors, close } = await openApp('splint-card', { width: 1400, height: 900 });
  await page.waitForFunction(() => window.APP, { timeout: 60000 });
  await page.setInputFiles('input[data-ss=file]', [D + 'scanner-upper.stl', D + 'scanner-lower.stl']);
  await page.waitForFunction(() => APP.scans.upper && APP.scans.lower && !document.querySelector('#busy.show'), { timeout: 60000 });
  const r = await page.evaluate(async () => {
    const { P, K, N } = APP; P.jaw = 'lower'; P.tiltX = 4; P.buccal = 4.5; P.retention = 0.2; APP.prep(); const D = APP.D;
    const res = await K.build({ scanA: D.scanA, arch: D.arch, cache: {} }, { tiltX: 4, buccal: 4.5, retention: 0.2 }), th = K.thickness(res.mesh, res.triKind);
    const Pm = res.mesh.positions, out = []; for (let i = 0; i < th.t.length && out.length < 8; i++) if (th.t[i] < 1.5 && !th.border[i]) out.push([Pm[3 * i], Pm[3 * i + 1], Pm[3 * i + 2], th.t[i]].map((v) => +v.toFixed(2)));
    const kc = [0, 0, 0]; for (const k of res.triKind) kc[k]++;
    return { genus: res.report.genus, thin: th.min, at: th.minAt, out, kc, archL: D.arch.L, nTri: D.scanA.indices.length / 3, m: APP.scans.lower.matrix.elements.map((v) => +v.toFixed(4)) };
  });
  console.log(JSON.stringify(r)); console.log('errors', errors); await close();
})();
