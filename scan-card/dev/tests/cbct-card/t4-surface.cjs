// t4-surface: the 3D view on the demo CBCT (MIP and the raymarched threshold surface both draw the jaw), then a surface
// model at the bone threshold: downloaded STL, closed, in the scan's patient coordinates, lying on the phantom's true boundaries.
const { open, ok, OUT } = require('./lib.cjs');
const fs = require('fs');
async function lit(page) {                                     // how much of the 3D view is drawn, and its bounding box (fractions of the view)
  return page.evaluate(async () => {
    const url = APP.viewer.snapshot(), img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1; for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const q = 4 * (y * c.width + x); if (d[q + 3] > 0 && d[q] + d[q + 1] + d[q + 2] > 150) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    return { frac: n / (c.width * c.height), box: [x0 / c.width, y0 / c.height, x1 / c.width, y1 / c.height] };
  });
}
(async () => {
  const a = await open(), { page } = a; await a.demo();
  await page.click('.step[data-id=d3] h3'); await a.idle(); await page.click('.vp.r3 [data-r3=front]'); await page.waitForTimeout(1500);
  const mip = await lit(page); await page.screenshot({ path: OUT + 't4-mip.png' });
  ok(mip.frac > 0.05 && mip.box[2] - mip.box[0] > 0.3, `MIP from the front draws the jaw: ${(mip.frac * 100).toFixed(0)}% of the view, ${mip.box.map((v) => v.toFixed(2)).join(' ')}`);
  await page.click('#tBone'); await page.waitForTimeout(2500);
  const iso = await lit(page); await page.screenshot({ path: OUT + 't4-iso.png' });
  ok(iso.frac > 0.05 && Math.abs((iso.box[2] - iso.box[0]) - (mip.box[2] - mip.box[0])) < 0.1, `raymarched surface at the bone threshold draws the jaw too: ${(iso.frac * 100).toFixed(0)}% of the view, same width as the MIP`);
  // the surface model
  const T = await page.evaluate(() => APP.S.r3.iso); await page.click('#tDetail [data-v="0.5"]');
  const t0 = Date.now(); await page.click('#tMake'); await a.idle(); await page.waitForFunction(() => APP.S.surf.info, null, { timeout: 300000 });
  const info = await page.evaluate(() => APP.S.surf.info);
  ok(info.closed && info.tris > 10000, `surface at ${T} (${info.h} mm grid): ${info.tris.toLocaleString()} triangles, closed ${info.closed}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.waitForTimeout(1500); await page.screenshot({ path: OUT + 't4-surface.png' });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#tStl')]); const file = OUT + 't4-surface.stl'; await dl.saveAs(file);
  const buf = fs.readFileSync(file), n = buf.readUInt32LE(80), head = buf.subarray(0, 80).toString('latin1');
  ok(buf.length === 84 + 50 * n && n === info.tris && /LPS mm/.test(head), `STL ${dl.suggestedFilename()}: ${n.toLocaleString()} triangles, header “${head.replace(/\0+$/, '').trim()}”`);
  const errs = a.errors.filter((e) => !/font/.test(e)); ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await a.close();
  // where it is, against the phantom's exact geometry (node)
  const N = await import('/home/claude/suite/shared/core.js'), D = await import('/home/claude/suite/shared/dicom.js');
  const m = N.cleanMesh(N.parseMesh(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), 'stl'), { keepIslands: true }).mesh, closed = N.isWatertight(m), bb = N.meshBounds(m);
  const { truth } = D.makePhantom({ voxel: 0.6, noise: 0 }), V = truth.values, fields = truth.teeth.map((t) => [D.phantomToothField(t), D.phantomPulpField(t)]), dd = [];
  for (let i = 0; i < m.positions.length; i += 3 * 11) {
    const x = m.positions[i], y = m.positions[i + 1], z = m.positions[i + 2]; let tm = Infinity, pu = Infinity; for (const [f, g] of fields) { const v = f(x, y, z); if (v < tm) { tm = v; pu = g(x, y, z); } }
    const b = truth.boneField(x, y, z); dd.push(Math.min(Math.abs(Math.min(b, tm)), Math.abs(tm), Math.abs(tm - V.pdlWidth), Math.abs(pu)));   // at this threshold: the outside of bone ∪ teeth, each root's surface and its socket's lining (the dark ligament between), the pulp
  }
  dd.sort((p, q) => p - q); const q = (p) => dd[Math.floor(p * dd.length)];
  const topTip = Math.max(...truth.teeth.map((t) => t.base[2] + t.crown));
  ok(closed && q(0.5) < 0.15 && q(0.95) < 0.4 && Math.abs(bb.min[2] - V.boneBottom) < 0.4 && Math.abs(bb.max[0] - 31.6) < 0.5 && bb.max[2] < topTip + 0.6, `the STL read back: closed ${closed}; distance to the true boundaries median ${q(0.5).toFixed(3)}, 95% ${q(0.95).toFixed(3)} mm; spans x ${bb.min[0].toFixed(1)} … ${bb.max[0].toFixed(1)}, z ${bb.min[2].toFixed(1)} … ${bb.max[2].toFixed(1)} (bone bottom ${V.boneBottom}, highest crown tip ${topTip.toFixed(1)})`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
