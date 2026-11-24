// Scan Card with large scans (about 450k + 350k triangles): how long each tab takes to open, and how much memory the page holds.
const { openHub, ok, OUT } = require('./lib.cjs');
(async () => {
  const a = await openHub(), { page } = a;
  const cdp = await page.context().newCDPSession(page);
  const mem = async () => { await cdp.send('HeapProfiler.collectGarbage').catch(() => {}); const m = await cdp.send('Performance.getMetrics').catch(() => null); const js = m && m.metrics.find((x) => x.name === 'JSHeapUsedSize'); return js ? Math.round(js.value / 1048576) : null; };
  await cdp.send('Performance.enable').catch(() => {});
  let t = Date.now();
  await page.evaluate(() => APP.scans.loadDemo({ res: 0.2 }));
  await page.waitForFunction(() => APP.scans.has('upper') && APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 180000 });
  const tris = await page.evaluate(() => ['upper', 'lower'].map((j) => APP.scans[j].raw.indices.length / 3));
  console.log(`scans: upper ${tris[0].toLocaleString()} + lower ${tris[1].toLocaleString()} triangles (made in ${Date.now() - t} ms); hub heap ${await mem()} MB`);
  t = Date.now(); const s0 = await page.evaluate(() => { const a = performance.now(); APP.H.dirty = true; APP.refreshSig(); return Math.round(performance.now() - a); }); console.log('signature of the scans (first time, CRC of every vertex and triangle):', s0, 'ms');
  for (const id of ['analysis', 'model', 'splint']) {
    t = Date.now(); await page.click(`#tabs [data-tab=${id}]`); await a.settle(); const fr = a.tool(id);
    await fr.waitForFunction(() => window.APP && APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 180000 });
    const t1 = Date.now() - t;
    if (id === 'model') { await fr.waitForFunction(() => APP.A.lower.model && APP.A.upper.model && !APP.A.lower.dirty && !APP.A.upper.dirty && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 }); }
    console.log(`${id}: tab open with scans in ${t1} ms${id === 'model' ? `, both models built after ${Date.now() - t} ms` : ''}; page heap ${await mem()} MB`);
  }
  // leaving Models hands its two models to the hub: how long does the tab switch take?
  await page.click('#tabs [data-tab=model]'); await a.settle();
  t = Date.now(); await page.click('#tabs [data-tab=analysis]'); await a.settle(); console.log('Models → Analysis (models handed to the hub, nothing to load):', Date.now() - t, 'ms');
  t = Date.now(); await page.click('#tabs [data-tab=scans]'); await a.settle(); console.log('Analysis → Scans:', Date.now() - t, 'ms');
  t = Date.now(); const blobSize = await page.evaluate(async () => (await APP.buildCase().toBlob('Scan Card')).size); console.log(`case file packed in ${Date.now() - t} ms (${(blobSize / 1e6).toFixed(1)} MB)`);
  for (const id of ['tray', 'wax']) { t = Date.now(); await page.click(`#tabs [data-tab=${id}]`); await a.settle(); console.log(`${id}: open and loaded in ${Date.now() - t} ms; page heap ${await mem()} MB`); }
  ok(a.errors.length === 0, 'no page errors ' + a.errors.slice(0, 3).join(' | '));
  await a.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
