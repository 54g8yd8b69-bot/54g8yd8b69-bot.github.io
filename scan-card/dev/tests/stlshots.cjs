// node dev/tests/stlshots.cjs name.stl:dirx,diry,dirz[:outname] ...   (files from dev/out, shots to dev/out)
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
(async () => { const { page, errors, shot, close } = await openApp('dev/stlview', { width: 900, height: 640 }); await page.waitForFunction(() => window.READY);
  for (const a of process.argv.slice(2)) { const [f, d, o] = a.split(':'); const dir = (d || '0.5,-0.9,0.5').split(',').map(Number); await page.evaluate(([u, dir]) => window.show(u, dir), ['/dev/out/' + f, dir]); await page.waitForTimeout(250); await shot('/home/claude/suite/dev/out/' + (o || f.replace('.stl', '')) + '.png'); }
  if (errors.length) console.log(errors); await close(); })();
