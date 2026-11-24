// House rules from dev/README.md checked mechanically: tooltips, no free text, no dialogs, no network, downloads only through the core.
const L = require('./lib.cjs'); const fs = require('fs');
(async () => {
  const src = fs.readFileSync('/home/claude/suite/analysis-card/index.html', 'utf8'); let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? '  ok  ' : '  FAIL', m); };
  const banned = ['alert(', 'confirm(', 'window.open', '.print(', 'fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'navigator.sendBeacon', 'WebSocket', 'createObjectURL', 'type="text"', '<textarea', 'contenteditable'];
  const found = banned.filter((b) => src.includes(b)); ok(!found.length, 'source has none of: ' + banned.join(', ') + (found.length ? ' → FOUND ' + found.join(', ') : ''));
  ok(!/[^.\w]prompt\(/.test(src), 'no prompt() dialog');
  ok((src.match(/https?:\/\/[^"'\s)]+/g) || []).every((u) => u.startsWith('https://cdn.jsdelivr.net/npm/three')), 'the only URLs are the three import-map entries: ' + [...new Set(src.match(/https?:\/\/[^"'\s)]+/g))].length + ' distinct');
  const { page, errors, close } = await L.open();
  await L.loadDemo(page, 1);
  const truth = await page.evaluate(() => APP.scans.demoTruth);
  await page.evaluate(() => APP.shell.goto('widths')); for (const f of [12, 22]) { await page.click(`#chart [data-f="${f}"]`); await page.click('#wMiss'); } await page.click('#chart [data-f="16"]');
  await L.clickAllWidths(page, L.truthPoint(truth));
  const audit = { noTitle: [], inputs: [] };
  for (const id of ['load', 'orient', 'widths', 'bolton', 'space', 'arch', 'resto', 'measure', 'report']) {
    await page.evaluate((s) => APP.shell.goto(s), id); await page.waitForTimeout(120);
    const r = await page.evaluate((id) => ({ noTitle: [...document.querySelectorAll('#app button')].filter((b) => !b.title && !b.closest('#nav') && !b.classList.contains('qb') && b.offsetParent).map((b) => id + ':' + (b.textContent.trim() || b.className)), inputs: [...document.querySelectorAll('#app input')].filter((i) => i.offsetParent || i.type === 'file').map((i) => i.type) }), id);
    audit.noTitle.push(...r.noTitle); audit.inputs.push(...r.inputs);
  }
  const mine = audit.noTitle.filter((t) => !/^(load|orient):/.test(t) && !/Upper scan|Lower scan/.test(t));
  ok(!mine.length, 'every button in this app’s steps has a tooltip' + (mine.length ? ' → missing: ' + [...new Set(mine)].join(' | ') : '') + ` (core buttons without one: ${[...new Set(audit.noTitle.filter((t) => !mine.includes(t)))].join(' | ') || 'none'})`);
  ok([...new Set(audit.inputs)].every((t) => ['number', 'checkbox', 'file', 'range'].includes(t)), 'input types present: ' + [...new Set(audit.inputs)].join(', ') + ' (no free-text box)');
  const text = await page.evaluate(() => APP.reportText()), csv = await page.evaluate(() => APP.reportCsv());
  ok(!/name|DOB|CHI|hospital|NHS/i.test(text.replace(/Analysis Card/g, '')) && /not a certified medical device/.test(text), 'report text carries the disclaimer and no identifier fields');
  ok(csv.split('\r\n').every((l) => !l || l.split(',').length >= 8), 'CSV rows all have 8 columns (' + (csv.split('\r\n').length - 1) + ' rows)');
  console.log(fails ? `${fails} FAILED` : 'all passed', '| errors', errors);
  await close();
})();
