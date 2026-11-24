// Drive Splint Card through its real controls, save the case, and hand the files to check-splint.mjs.
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs');
const O = '/home/claude/suite/dev/out/suite/';
const built = (page) => page.waitForFunction(() => !document.querySelector('#busy.show') && APP.D && APP.D.meshCase && !APP.D.dirty, { timeout: 240000 });
async function saveCase(page, file) { const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.evaluate(() => APP.scans.saveCase())]); await dl.saveAs(file); }
(async () => {
  const errs = [];
  for (const sc of [{ name: 'lower-guard', jaw: 'lower', type: 'guard' }, { name: 'upper-flat', jaw: 'upper', type: 'flat', opp: true }, { name: 'upper-guard-tilted', jaw: 'upper', type: 'guard', tilt: true }]) {
    const { page, errors, shot, close } = await openApp('splint-card', { width: 1400, height: 900 });
    await page.waitForFunction(() => window.APP && APP.scans); await page.click('[data-ss=demo]'); await page.waitForFunction(() => APP.scans.upper && APP.scans.lower && !document.querySelector('#busy.show'), { timeout: 90000 });
    await page.evaluate(() => APP.shell.goto('appliance')); await page.click(`#apJaw [data-v=${sc.jaw}]`);
    const types = await page.evaluate(() => [...document.querySelectorAll('#apType button')].map((b) => b.dataset.v)); await page.click(`#apType [data-v=${sc.type}]`);
    if (sc.tilt) { await page.evaluate(() => { APP.shell.goto('path'); }); await page.evaluate(() => { for (const [id, v] of [['paX', 6], ['paY', -4]]) { const e = document.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); } } }); }
    await page.evaluate(() => APP.shell.goto('shell')); await page.waitForTimeout(300);
    if (sc.opp) { const use = await page.evaluate(() => { const e = document.getElementById('shUse'); if (e && !e.checked) e.click(); return !!e; }); await page.waitForTimeout(300); await built(page); await page.click('#shAuto'); await page.waitForTimeout(500); }
    await built(page); await page.evaluate(() => APP.shell.goto('check')); await page.waitForTimeout(400); await built(page);
    const t0 = Date.now(); const P = await page.evaluate(() => ({ ...APP.P })); const info = await page.evaluate(() => document.querySelector('#chInfo, #shInfo, .sum') ? (document.querySelector('#chInfo') || document.querySelector('#shInfo')).innerText.replace(/\n+/g, ' | ').slice(0, 420) : '');
    await shot(O + `splint-${sc.name}.png`);
    await saveCase(page, O + `splint-${sc.name}.zip`);
    let oppFile = '';
    if (sc.opp) { const b64 = await page.evaluate(() => { const o = APP.opposing(); if (!o) return ''; const other = APP.D.jaw === 'upper' ? 'lower' : 'upper', m = APP.N.transformMesh(APP.scans.framed(other), o.Om), u = new Uint8Array(APP.N.stlBinary(m)); let s = ''; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); }); if (b64) { oppFile = O + `splint-${sc.name}-opposing.stl`; fs.writeFileSync(oppFile, Buffer.from(b64, 'base64')); } }
    console.log(sc.name, '| presets', types.join(','), '| tilt', P.tiltX, P.tiltY, '| open', P.open, P.openMode, 'useOpp', P.useOpp, '|', info);
    fs.writeFileSync(O + `splint-${sc.name}.json`, JSON.stringify({ oppFile })); errs.push(...errors); await close();
  }
  console.log('browser errors:', errs);
})();
