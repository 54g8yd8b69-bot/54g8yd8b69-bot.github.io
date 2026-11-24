const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const O = '/home/claude/suite/dev/out/model-card/', D = '/home/claude/suite/dev/data/';
(async () => {
  const { page, errors, shot, close } = await openApp('model-card', { width: 1400, height: 900 });
  await page.waitForFunction(() => window.APP);
  for (const f of ['colour-lower.ply', 'plain-lower.obj', 'metres-lower.stl', 'ascii-part.stl']) {
    await page.evaluate(() => { APP.shell.goto('load'); APP.scans.clear('upper'); APP.scans.clear('lower'); });
    await page.setInputFiles('input[data-ss=file]', [D + f]); await page.waitForFunction(() => (APP.scans.upper || APP.scans.lower) && !document.querySelector('#busy.show'), { timeout: 90000 });
    const a = await page.evaluate(() => { const j = APP.scans.upper ? 'upper' : 'lower', sc = APP.scans[j]; return { slot: j, tris: sc.raw.indices.length / 3, colours: !!sc.raw.colors, vertexColors: sc.object.material.vertexColors, size: APP.N.meshBounds(APP.scans.framed(j)).size.map(v => +v.toFixed(1)), info: document.querySelector('[data-ss=info]').innerText.replace(/\n/g, ' ') }; });
    if (f.startsWith('colour')) { await page.waitForTimeout(300); await shot(O + '40-colour-ply.png'); }
    await page.evaluate(() => APP.shell.goto('base')); await page.waitForFunction(() => { const j = APP.scans.upper ? 'upper' : 'lower'; return (APP.A[j].info || APP.A[j].error) && !document.querySelector('#busy.show'); }, { timeout: 120000 });
    const b = await page.evaluate(() => { const j = APP.scans.upper ? 'upper' : 'lower', x = APP.A[j]; return x.error ? { error: x.error } : { wt: x.info.watertight, mL: +(x.info.volume / 1000).toFixed(1) }; });
    console.log(f, JSON.stringify(a), '→ model', JSON.stringify(b));
  }
  // a file that is not a mesh, and a zip that is not a case
  require('fs').writeFileSync(D + 'not-a-mesh.stl', 'hello this is not an stl'); require('fs').writeFileSync(D + 'not-a-case.zip', Buffer.from([0x50, 0x4b, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  for (const f of ['not-a-mesh.stl', 'not-a-case.zip']) { await page.evaluate(() => APP.shell.goto('load')); await page.setInputFiles('input[data-ss=file]', [D + f]); await page.waitForTimeout(1200); console.log(f, '→ message:', JSON.stringify(await page.evaluate(() => document.querySelector('#status').textContent)), 'app still alive:', await page.evaluate(() => !!APP.scans.lower || !!APP.scans.upper)); }
  console.log('errors (console errors from the two bad files are expected):', errors.length, errors.map(e => e.slice(0, 90)));
  await close();
})();
