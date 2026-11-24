// What leaves Scan Card is exactly what the tool made: STL files saved through the hub are compared, byte for byte (CRC), with
// what the tool computes itself; and a colour PLY scan keeps its colours on the way into Wax Card.
const { openHub, ok, OUT, DATA } = require('./lib.cjs');
const fs = require('fs'), zlib = require('zlib');
function unzip(file) {                                            // name → { crc, size } from the zip's central directory, and the bytes
  const b = fs.readFileSync(file), out = {}; let p = b.length - 22; while (p >= 0 && b.readUInt32LE(p) !== 0x06054b50) p--;
  const n = b.readUInt16LE(p + 10); let c = b.readUInt32LE(p + 16);
  for (let i = 0; i < n; i++) { const method = b.readUInt16LE(c + 10), crc = b.readUInt32LE(c + 16), csz = b.readUInt32LE(c + 20), size = b.readUInt32LE(c + 24), nl = b.readUInt16LE(c + 28), xl = b.readUInt16LE(c + 30), cl = b.readUInt16LE(c + 32), lo = b.readUInt32LE(c + 42), name = b.slice(c + 46, c + 46 + nl).toString();
    const ds = lo + 30 + b.readUInt16LE(lo + 26) + b.readUInt16LE(lo + 28), raw = b.slice(ds, ds + csz); out[name] = { crc, size, data: method === 8 ? zlib.inflateRawSync(raw) : raw }; c += 46 + nl + xl + cl; }
  return out;
}
(async () => {
  const a = await openHub(), { page } = a;
  await page.setInputFiles('input[data-ss=file]', [DATA + 'scanner-upper.stl', DATA + 'scanner-lower.stl']);
  await page.waitForFunction(() => APP.scans.has('upper') && APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 });
  // Models: both positions
  const mo = await a.go('model'); await mo.waitForFunction(() => APP.A.lower.model && APP.A.upper.model && !APP.A.lower.dirty && !APP.A.upper.dirty, null, { timeout: 300000 });
  await mo.evaluate(() => APP.shell.goto('export')); await a.idle(mo);
  for (const pos of ['print', 'scan']) {
    await mo.click(`#exPos [data-v=${pos}]`);
    const want = await mo.evaluate(() => Object.fromEntries(['upper', 'lower'].map((j) => { const u = new Uint8Array(APP.N.stlBinary(APP.exportMesh(j), null, `Model Card ${j} model, mm`)); return [`model-${j}.stl`, { crc: APP.N.crc32(u), size: u.length }]; })));
    const [dl] = await Promise.all([page.waitForEvent('download'), mo.click('#exStl')]); const f = OUT + `h8-models-${pos}.zip`; await dl.saveAs(f);
    const got = unzip(f);
    ok(Object.keys(want).every((k) => got[k] && got[k].crc === want[k].crc && got[k].size === want[k].size && got[k].data.length === want[k].size), `Models “${pos}” STL files saved through the hub are byte-identical to the tool's own (${Object.keys(want).map((k) => k + ' ' + want[k].size + ' B').join(', ')})`);
  }
  // as scanned = in the scanner's coordinates: the model must sit on the original scan file
  const onScan = await mo.evaluate(() => { const m = APP.N.transformMesh(APP.A.lower.model, APP.scans.lower.matrix.clone().invert()), b = APP.N.meshBounds(m), s = APP.N.meshBounds(APP.scans.lower.raw); return [0, 1, 2].every((k) => b.min[k] <= s.min[k] + 1e-3 + 6 && b.max[k] >= s.max[k] - 1e-3); });
  ok(onScan, 'the “as scanned” lower model encloses the scan in the scanner’s own coordinates');
  // Splint
  const sp = await a.go('splint'); await sp.evaluate(() => APP.shell.goto('export'));
  await sp.waitForFunction(() => APP.D.res && !APP.D.dirty && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 });
  const btn = await sp.evaluate(() => [...document.querySelectorAll('.step[data-id=export] button')].map((b) => b.id + ':' + b.textContent.trim()).join(' | '));
  const [dls] = await Promise.all([page.waitForEvent('download'), sp.click('#exStl')]); const fs1 = OUT + 'h8-splint' + (dls.suggestedFilename().endsWith('.zip') ? '.zip' : '.stl'); await dls.saveAs(fs1);
  const head = fs.readFileSync(fs1), tri = head.readUInt32LE(80);
  ok(head.length === 84 + tri * 50 && tri === await sp.evaluate(() => APP.D.meshCase.indices.length / 3), `Splint STL saved through the hub: ${dls.suggestedFilename()}, ${tri} triangles, a well-formed binary STL of exactly the built splint (buttons: ${btn.slice(0, 80)})`);
  ok(a.errors.length === 0, 'no page errors ' + a.errors.slice(0, 3).join(' | '));
  await a.close();

  // colour PLY into Wax Card and Tray Card
  const b = await openHub(), p2 = b.page;
  await p2.setInputFiles('input[data-ss=file]', DATA + 'colour-lower.ply');
  await p2.waitForFunction(() => APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 });
  const src = await p2.evaluate(() => ({ col: !!APP.scans.lower.raw.colors, tris: APP.scans.lower.raw.indices.length / 3, c0: APP.scans.lower.raw.colors && Array.from(APP.scans.lower.raw.colors.slice(0, 3)) }));
  ok(src.col, 'hub: the colour PLY scan was read with its colours (' + src.tris + ' triangles, first vertex colour ' + JSON.stringify(src.c0) + ')');
  await p2.click('#tabs [data-tab=wax]'); await b.settle();
  const wh = await p2.$('iframe[data-tool=wax]'), w = await wh.contentFrame();
  await w.waitForFunction(() => window.__wax && !!__wax.S.scans.lower, null, { timeout: 90000 });
  const wi = await w.evaluate(() => ({ name: __wax.S.scans.lower.name, hasColor: __wax.S.scans.lower.hasColor, tris: __wax.S.scans.lower.mesh.geometry.index.count / 3 }));
  ok(wi.name === 'lower.ply' && wi.hasColor && wi.tris === src.tris, 'Wax Card got the scan as PLY with its colours: ' + JSON.stringify(wi));
  await p2.waitForTimeout(800); await b.shot(OUT + 'h8-wax-colour.png');
  await p2.click('#tabs [data-tab=tray]'); await b.settle();
  const th = await p2.$('iframe[data-tool=tray]'), t = await th.contentFrame();
  await t.waitForFunction(() => window.TC && !!TC.S.scanGeo, null, { timeout: 90000 });
  ok(await t.evaluate(() => TC.S.scanSrc.name === 'lower.ply' && (TC.S.scanGeo.index ? TC.S.scanGeo.index.count / 3 : TC.S.scanGeo.attributes.position.count / 3) > 1000), 'Tray Card read the same PLY');
  ok(b.errors.length === 0, 'no page errors ' + b.errors.slice(0, 3).join(' | '));
  await b.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
