const { openApp } = require('/home/claude/suite/dev/pw.cjs');
(async () => {
  const { page, errors, close } = await openApp('model-card', { width: 1400, height: 900 });
  await page.waitForFunction(() => window.APP); await page.evaluate(() => APP.scans.loadDemo({ res: 0.2 })); await page.waitForFunction(() => APP.scans.upper && APP.scans.lower && !document.querySelector('#busy.show'), { timeout: 120000 });
  const r = await page.evaluate(async () => { const { N, S } = APP, T = {}, t = (k, f) => { const a = performance.now(); const v = f(); T[k] = Math.round(performance.now() - a); return v; };
    await S.ready(); const scan = t('framed', () => APP.scans.framed('upper')); const w = t('flip', () => N.transformMesh(scan, N.rotationAbout('y', 180))); const b = N.meshBounds(w);
    const r = t('scanToSolid', () => S.scanToSolid(w, { baseZ: b.min[2] - 5, smooth: 2 })); const man = t('toManifold', () => S.toManifold(r.mesh));
    const h = t('hollow', () => S.hollow(man, { wall: 2.5, openBelow: b.min[2] - 5 })); const out = t('fromManifold', () => S.fromManifold(h.solid)); t('watertight', () => N.isWatertight(out));
    const g1 = t('geomCrease+bvh', () => N.toGeometry(out, { crease: 38 })); const g2 = t('geomSmooth+bvh', () => N.toGeometry({ positions: out.positions.slice(), indices: out.indices.slice() })); const g3 = t('geomSmooth noBVH', () => N.toGeometry({ positions: out.positions.slice(), indices: out.indices.slice() }, { bvh: false }));
    t('distanceField', () => S.distanceField(man, { cell: 0.4, openBelow: b.min[2] - 5 }));
    return T; });
  console.log(JSON.stringify(r)); console.log(errors); await close();
})();
