const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const O = '/home/claude/suite/dev/out/model-card/', D = '/home/claude/suite/dev/data/';
const idle = (page) => page.waitForFunction(() => !document.querySelector('#busy.show'), { timeout: 120000 });
(async () => {
  const { page, errors, shot, close } = await openApp('model-card', { width: 1400, height: 900 });
  await page.waitForFunction(() => window.APP);
  // real file input with scanner-frame STLs
  await page.setInputFiles('input[data-ss=file]', [D + 'scanner-upper.stl', D + 'scanner-lower.stl']);
  await page.waitForFunction(() => APP.scans.upper && APP.scans.lower && !document.querySelector('#busy.show'), { timeout: 60000 });
  await page.evaluate(() => APP.shell.goto('trim')); await page.waitForTimeout(200);
  // plane trim on the lower at 9 mm
  await page.click('#trJaw [data-v=lower]');
  await page.evaluate(() => { const r = document.querySelector('#trDepth'); r.value = 9; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); APP.scans.setVisible('upper', false); APP.viewer.fit(null, { dir: [0.5, -0.8, 0.3] }); });
  await page.waitForTimeout(200); await shot(O + '20-trim-plane.png');
  const b0 = await page.evaluate(() => ({ z: APP.N.meshBounds(APP.scans.framed('lower')).min[2], t: APP.scans.lower.raw.indices.length / 3 }));
  await page.click('#trApply'); await idle(page);
  const b1 = await page.evaluate(() => ({ z: APP.N.meshBounds(APP.scans.framed('lower')).min[2], t: APP.scans.lower.raw.indices.length / 3, loops: APP.N.boundaryLoops(APP.scans.lower.raw).map(l => l.verts.length + '/' + l.length.toFixed(0) + 'mm').join(' '), undo: !document.querySelector('#trUndo').disabled }));
  console.log('plane trim: lowest z', b0.z.toFixed(2), '→', b1.z.toFixed(3), '(target -9) tris', b0.t, '→', b1.t, 'border loops', b1.loops, 'undo enabled', b1.undo);
  await page.waitForTimeout(200); await shot(O + '21-trimmed.png');
  // paint erase: drag across the last molar region
  await page.click('#trPaint'); await page.evaluate(() => APP.viewer.setView('top')); await page.waitForTimeout(200);
  const path = await page.evaluate(() => { const b = APP.N.meshBounds(APP.scans.framed('lower')), rc = APP.viewer.dom.getBoundingClientRect(); const P = [[b.max[0] - 8, b.max[1] - 4], [b.max[0] - 6, b.max[1] - 4], [b.max[0] - 4, b.max[1] - 5]].map(([x, y]) => { const s = APP.viewer.toScreen(new APP.N.THREE.Vector3(x, y, -3)); return [s.x + rc.left, s.y + rc.top]; }); return P; });
  await page.mouse.move(path[0][0], path[0][1]); await page.mouse.down(); for (const p of path) await page.mouse.move(p[0], p[1], { steps: 6 }); await page.mouse.up();
  const painted = await page.evaluate(() => APP.painted ? APP.painted.size : 0); console.log('painted triangles:', painted);
  if (!painted) { console.log('DEBUG', JSON.stringify(await page.evaluate((p) => { const hit = APP.viewer.pick(p[0], p[1], [APP.scans.lower.object]); return { p, hit: hit && hit.point.toArray(), tool: !!APP.viewer.tool, vis: APP.scans.lower.object.visible, b: APP.N.meshBounds(APP.scans.framed('lower')) }; }, path[0]))); await shot(O + '22-debug.png'); await close(); return; }
  // painted triangles really lie within the brush radius of the stroke (checks the face-index mapping)
  const chk = await page.evaluate(() => { const sc = APP.scans.lower, I = sc.raw.indices, Q = sc.raw.positions, M = sc.matrix; let maxY = -1e9, minY = 1e9, n = 0; const v = new APP.N.THREE.Vector3(); for (const f of APP.painted) { v.set((Q[3 * I[3 * f]] + Q[3 * I[3 * f + 1]] + Q[3 * I[3 * f + 2]]) / 3, (Q[3 * I[3 * f] + 1] + Q[3 * I[3 * f + 1] + 1] + Q[3 * I[3 * f + 2] + 1]) / 3, (Q[3 * I[3 * f] + 2] + Q[3 * I[3 * f + 1] + 2] + Q[3 * I[3 * f + 2] + 2]) / 3).applyMatrix4(M); maxY = Math.max(maxY, v.y); minY = Math.min(minY, v.y); n++; } const b = APP.N.meshBounds(APP.scans.framed('lower')); return { minY: minY - b.max[1], maxY: maxY - b.max[1] }; });
  console.log('painted centroids span y (relative to the back edge):', chk.minY.toFixed(1), '…', chk.maxY.toFixed(1), '(stroke at -4…-5, brush 3 mm)');
  await page.waitForTimeout(200); await shot(O + '22-painted.png');
  const t2 = await page.evaluate(() => APP.scans.lower.raw.indices.length / 3);
  await page.click('#trDelete'); await idle(page);
  const t3 = await page.evaluate(() => ({ t: APP.scans.lower.raw.indices.length / 3, clean: APP.N.buildTwins(APP.scans.lower.raw.indices).nonManifold }));
  console.log('delete painted: tris', t2, '→', t3.t, 'non-manifold edges', t3.clean);
  await page.click('#trUndo'); await idle(page); const t4 = await page.evaluate(() => APP.scans.lower.raw.indices.length / 3); console.log('undo → tris', t4, '(back to', t2 + ')');
  await page.click('#trPaint');
  // build after trimming: still watertight; base sits 5 mm under the cut
  await page.evaluate(() => { APP.scans.setVisible('upper', true); APP.shell.goto('base'); }); await page.waitForFunction(() => APP.A.upper.info && APP.A.lower.info && !document.querySelector('#busy.show'), { timeout: 120000 });
  console.log('built after trim:', JSON.stringify(await page.evaluate(() => ['upper', 'lower'].map(j => ({ j, wt: APP.A[j].info.watertight, v: +(APP.A[j].info.volume / 1000).toFixed(1), h: +APP.A[j].info.size[2].toFixed(1), notes: APP.A[j].info.notes })))));
  await page.waitForTimeout(300); await shot(O + '23-built-after-trim.png');
  // awkward files: dirty, quadrant
  for (const f of ['dirty-lower.stl', 'quadrant-lower.stl', 'hypodontia-upper.stl']) {
    await page.evaluate(() => { APP.shell.goto('load'); APP.scans.clear('upper'); APP.scans.clear('lower'); });
    await page.setInputFiles('input[data-ss=file]', [D + f]); await page.waitForFunction(() => (APP.scans.upper || APP.scans.lower) && !document.querySelector('#busy.show'), { timeout: 60000 });
    await page.evaluate(() => APP.shell.goto('base')); await page.waitForFunction(() => { const j = APP.scans.upper ? 'upper' : 'lower'; return (APP.A[j].info || APP.A[j].error) && !document.querySelector('#busy.show'); }, { timeout: 120000 });
    console.log(f, JSON.stringify(await page.evaluate(() => { const j = APP.scans.upper ? 'upper' : 'lower', a = APP.A[j]; return a.error ? { error: a.error } : { jaw: j, wt: a.info.watertight, v: +(a.info.volume / 1000).toFixed(1), notes: a.info.notes, info: document.querySelector('[data-ss=info]').innerText.replace(/\n/g, ' ') }; })));
    await page.waitForTimeout(250); await shot(O + '24-' + f.replace('.stl', '') + '.png');
  }
  console.log('errors:', errors); await close();
})();
