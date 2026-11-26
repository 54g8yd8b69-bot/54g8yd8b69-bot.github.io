// t1-load: every test scan through the page's own file inputs (folder, files, one multi-frame file, a zip, several series at
// once): size, voxel size, position and voxel values against the truth; series told apart (the largest opened, another chosen);
// an unreadable series named; nothing identifying in the page.
const { open, ok, OUT, DATA, truth, fakeStrings } = require('./lib.cjs');
const fs = require('fs'), path = require('path');
(async () => {
  const T = truth(), a = await open(), { page } = a;
  const check = async (name) => {
    const r = await page.evaluate((t) => { const v = APP.S.vol; let bad = 0; for (const [i, j, k, val] of t.samples) if (Math.abs(v.data[i + v.dims[0] * (j + v.dims[1] * k)] + v.shift - val) > (t.tol || 0)) bad++; return { dims: v.dims, spacing: v.spacing, origin: v.origin, bad, warn: v.warnings }; }, T.variants[name]);
    const t = T.variants[name], near = (x, y, e) => x.every((v, i) => Math.abs(v - y[i]) < e);
    ok(near(r.dims, t.dims, 0.5) && near(r.spacing, t.spacing, 1e-4) && near(r.origin, t.origin, 1e-3) && r.bad === 0, `${name}: ${r.dims.join('×')}, ${r.spacing.join(' × ')} mm, origin ${r.origin.map((x) => x.toFixed(1)).join(', ')}, ${r.bad} of ${t.samples.length} voxels wrong${t.tol ? ` (lossy: within ±${t.tol})` : ''}${r.warn.length ? ' · ' + r.warn.join(' | ') : ''}`);
  };
  const dir = (n) => fs.readdirSync(DATA + n).map((f) => path.join(DATA, n, f));
  // a folder (webkitdirectory), with a DICOMDIR and a text file in it
  let t0 = Date.now(); await page.setInputFiles('#lFolderIn', DATA + 'a-explicit'); await page.waitForFunction(() => APP.S.vol, null, { timeout: 120000 }); await a.idle();
  await check('a-explicit'); ok((await page.evaluate(() => APP.S.skipped)) === 2, `folder: 111 slices read in ${((Date.now() - t0) / 1000).toFixed(1)} s, the DICOMDIR and the text file passed over`);
  await page.screenshot({ path: OUT + 't1-folder.png' });
  for (const n of ['b-implicit-flip', 'c-rle', 'd-jpegll', 'g-bigendian', 'h-deflated', 'i-jpegll57', 'j-coronal', 'm-u16', 'n-jpeg8']) {
    const L = await page.evaluate(() => APP.S.loads); await page.setInputFiles('#lFilesIn', dir(n)); await page.waitForFunction((L) => APP.S.loads > L, L, { timeout: 120000 }); await a.idle(); await check(n);
  }
  for (const [n, f] of [['e-enhanced', 'e-enhanced.dcm'], ['k-legacymf', 'k-legacymf.dcm'], ['f-zip', 'f-zip.zip']]) {
    const L = await page.evaluate(() => APP.S.loads); await page.setInputFiles('#lFilesIn', DATA + f); await page.waitForFunction((L) => APP.S.loads > L, L, { timeout: 120000 }); await a.idle(); await check(n);
  }
  // several series at once: RLE (largest), the implicit flipped one, and one in JPEG 2000
  const L0 = await page.evaluate(() => APP.S.loads);
  await page.setInputFiles('#lFilesIn', [...dir('b-implicit-flip'), ...dir('l-j2k'), ...dir('c-rle')]); await page.waitForFunction((L) => APP.S.loads > L, L0, { timeout: 120000 }); await a.idle();
  const ser = await page.evaluate(() => [...document.querySelectorAll('#lSeries .series')].map((b) => ({ text: b.textContent, dis: b.disabled, on: b.classList.contains('on') })));
  ok(ser.length === 3 && ser[0].on && /111 slices/.test(ser[0].text) && ser[2].dis && /JPEG 2000/.test(ser[2].text), `three series listed, the largest opened, JPEG 2000 named and greyed: ${ser.map((s) => s.text.replace(/\s+/g, ' ')).join(' | ')}`);
  await check('c-rle');
  await page.screenshot({ path: OUT + 't1-series.png' });
  await page.click('#lSeries .series:nth-of-type(2)'); await page.waitForFunction(() => APP.S.vol && APP.S.vol.dims[0] === 121, null, { timeout: 120000 }); await a.idle();
  await check('b-implicit-flip');
  // privacy: not one of the fake details (or the zip's folder name) anywhere in the page
  const html = await page.evaluate(() => document.documentElement.outerHTML + document.body.innerText), state = await page.evaluate(() => JSON.stringify({ series: APP.S.series.map((s) => ({ ...s, items: s.items.map((it) => it.h) })), info: document.querySelector('#lInfo').innerText }, (k, v) => (ArrayBuffer.isView(v) ? undefined : v)));
  const leaks = fakeStrings().filter((s) => html.includes(s) || state.includes(s));
  ok(leaks.length === 0, `no fake identifier in the page or in what the reader kept (${fakeStrings().length} strings looked for): ${leaks.join(', ') || 'none'}`);
  ok(/15 Mar 2024/.test(html), 'the scan date is shown (15 Mar 2024)');
  const errs = a.errors.filter((e) => !/font/.test(e)); ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await a.close();
})().catch((e) => { console.error(e); process.exitCode = 1; });
