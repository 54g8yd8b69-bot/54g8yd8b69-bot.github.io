// margin dots (drag with the mouse) and the cross-section, on the demo lower guard
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const O = '/home/claude/suite/dev/out/splint-card/';
(async () => {
  const { page, errors, shot, close } = await openApp('splint-card', { width: 1400, height: 900 });
  await page.waitForFunction(() => window.APP, { timeout: 60000 });
  const idle = async () => { await page.waitForTimeout(150); await page.waitForFunction(() => !document.querySelector('#busy.show'), { timeout: 240000 }); await page.waitForTimeout(200); };
  await page.click('[data-ss=demo]'); await page.waitForFunction(() => APP.scans.upper && !document.querySelector('#busy.show'), { timeout: 60000 });
  await page.evaluate(() => { APP.shell.goto('appliance'); }); await page.click('#apJaw [data-v=lower]'); await page.evaluate(() => APP.shell.goto('margin')); await page.waitForTimeout(500);
  await page.evaluate(() => APP.viewer.setView('left')); await page.waitForTimeout(300);
  // pick the buccal dot nearest the middle of the view, drag it 45 px down the screen
  const dot = await page.evaluate(() => { const r = APP.viewer.dom.getBoundingClientRect(); let best = null; for (const d of APP.dots()) { if (d.side !== 'B') continue; const q = APP.viewer.toScreen(d.sprite.position); if (!q.visible) continue; const e = Math.hypot(q.x - r.width / 2, q.y - r.height / 2); if (!best || e < best.e) best = { e, x: q.x + r.left, y: q.y + r.top, k: d.k, z: d.sprite.position.z }; } return best; });
  await shot(O + 'b6-margin-before.png');
  await page.mouse.move(dot.x, dot.y); await page.mouse.down(); await page.mouse.move(dot.x, dot.y + 20, { steps: 4 }); await page.mouse.move(dot.x, dot.y + 45, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(300);
  const after = await page.evaluate((k) => ({ adj: APP.P.adjB[k], all: APP.P.adjB.join(','), z: APP.dots().find((d) => d.side === 'B' && d.k === k).sprite.position.z, dirty: APP.D.dirty }), dot.k);
  console.log('dragged buccal dot', dot.k, 'z', dot.z.toFixed(2), '→', after.z.toFixed(2), 'adj', after.adj, '| adjB', after.all, '| dirty', after.dirty);
  await shot(O + 'b6-margin-after.png');
  await page.evaluate(() => APP.shell.goto('check')); await idle(); await page.waitForFunction(() => APP.D.res && !APP.D.dirty, { timeout: 240000 });
  console.log('built with the local change: thin', await page.evaluate(() => JSON.stringify({ occ: APP.D.thick.occ.min, wall: APP.D.thick.wall.min, wt: APP.D.res.report.watertight, genus: APP.D.res.report.genus })));
  await page.click('#ckSec'); await page.waitForTimeout(600); await shot(O + 'b6-section-25.png');
  await page.evaluate(() => { const r = document.getElementById('ckAt'); r.value = 12; r.dispatchEvent(new Event('input', { bubbles: true })); APP.faceSection(); }); await page.waitForTimeout(600); await shot(O + 'b6-section-12.png', { clip: { x: 340, y: 48, width: 1060, height: 852 } });
  console.log('section objects', await page.evaluate(() => APP.viewer.scene.children.filter((c) => c.isLineSegments || (c.isMesh && c.material.isMeshBasicMaterial)).length));
  console.log('errors', errors); await close();
})();
