/* DentalAudit — report rendering
 * - Data blocks (tables and charts) rendered from a report's frozen analytics snapshot
 * - Sanitising of user-edited section HTML
 * - The complete document layout shared by preview, print and HTML export
 */
DA.reportRender = (function () {
  const U = DA.utils, E = DA.reportEngine;
  const esc = U.esc;

  /* =========================================================
   * Sanitiser — edited HTML only keeps document formatting
   * ========================================================= */
  const ALLOWED = { P: 1, H3: 1, H4: 1, STRONG: 1, B: 1, EM: 1, I: 1, U: 1, UL: 1, OL: 1, LI: 1, BR: 1, TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TH: 1, TD: 1, BLOCKQUOTE: 1, SPAN: 1, DIV: 1 };
  const RENAME = { B: 'strong', I: 'em', H1: 'h3', H2: 'h3', H5: 'h4', H6: 'h4' };

  function sanitize(html) {
    const doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
    function clean(node, out) {
      node.childNodes.forEach(function (n) {
        if (n.nodeType === 3) { out.appendChild(document.createTextNode(n.textContent)); return; }
        if (n.nodeType !== 1) return;
        let tag = n.tagName;
        if (RENAME[tag]) tag = RENAME[tag].toUpperCase();
        if (tag === 'DIV' && n.classList.contains('rb') && n.getAttribute('data-block')) {
          const d = document.createElement('div');
          d.className = 'rb';
          d.setAttribute('data-block', n.getAttribute('data-block'));
          if (n.getAttribute('data-arg')) d.setAttribute('data-arg', n.getAttribute('data-arg'));
          d.setAttribute('contenteditable', 'false');
          out.appendChild(d);
          return;
        }
        if (!ALLOWED[tag] || tag === 'DIV') {
          // Unwrap unknown wrappers (and plain divs from the editor) into paragraphs.
          if (tag === 'DIV' && n.textContent.trim() && !n.querySelector('p, ul, ol, table, h3, h4, div')) {
            const p = document.createElement('p'); clean(n, p); out.appendChild(p);
          } else clean(n, out);
          return;
        }
        const el = document.createElement(tag.toLowerCase());
        if (tag === 'SPAN' || tag === 'P') { if (n.classList.contains('ph')) el.className = 'ph'; else if (n.classList.contains('rp-note')) el.className = 'rp-note'; }
        if ((tag === 'TD' || tag === 'TH') && n.getAttribute('colspan')) el.setAttribute('colspan', String(parseInt(n.getAttribute('colspan'), 10) || 1));
        clean(n, el);
        if (tag === 'SPAN' && !el.className) { while (el.firstChild) out.appendChild(el.firstChild); return; }
        out.appendChild(el);
      });
    }
    const wrap = document.createElement('div');
    clean(doc.body, wrap);
    return wrap.innerHTML.replace(/<p><\/p>/g, '');
  }

  /** Strip hydrated block content back to placeholders before saving. */
  function dehydrate(container) {
    container.querySelectorAll('.rb').forEach(function (b) { b.innerHTML = ''; });
    return sanitize(container.innerHTML);
  }

  /* =========================================================
   * Charts → PNG data URLs (cached per snapshot)
   * ========================================================= */
  const cache = {};
  const COL = { s1: '#2a78d6', s2: '#eb6834', ink: '#0f1b3d', grid: '#e6e9ef', text: '#3d4660', muted: '#7a8399', good: '#12703a', bad: '#b02828' };

  function wrapLabel(s, max) {
    const words = String(s).split(' ');
    const lines = [''];
    words.forEach(function (w) {
      const cur = lines[lines.length - 1];
      if ((cur + ' ' + w).trim().length > max && cur) lines.push(w); else lines[lines.length - 1] = (cur + ' ' + w).trim();
    });
    return lines.slice(0, 2).map(function (l, i) { return i === 1 && lines.length > 2 ? l + '…' : l; });
  }

  function draw(width, height, config) {
    if (typeof Chart === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.style.cssText = 'position:fixed;left:-99999px;top:0;width:' + width + 'px;height:' + height + 'px';
    document.body.appendChild(canvas);
    config.options = Object.assign({ responsive: false, animation: false, devicePixelRatio: 1, maintainAspectRatio: false }, config.options);
    config.plugins = (config.plugins || []).concat([{ id: 'bg', beforeDraw: function (c) { const x = c.ctx; x.save(); x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); x.restore(); } }]);
    let url = null;
    try {
      const ch = new Chart(canvas, config);
      url = canvas.toDataURL('image/png');
      ch.destroy();
    } catch (e) { console.error(e); }
    canvas.remove();
    return url;
  }

  function font(size, weight) { return { family: 'Inter, "Segoe UI", Helvetica, Arial, sans-serif', size: size, weight: weight || '400' }; }

  function complianceChart(snap) {
    const items = snap.criteria.filter(function (c) { return c.compliance !== null; });
    if (!items.length) return null;
    const h = 90 + items.length * 74;
    const targets = {
      id: 'targets',
      afterDatasetsDraw: function (c) {
        const m = c.getDatasetMeta(0), x = c.scales.x, ctx = c.ctx;
        ctx.save();
        m.data.forEach(function (bar, i) {
          const it = items[i];
          const px = x.getPixelForValue(it.target);
          ctx.strokeStyle = COL.ink; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(px, bar.y - 22); ctx.lineTo(px, bar.y + 22); ctx.stroke();
          ctx.fillStyle = it.achieved ? COL.good : COL.bad;
          ctx.font = '600 22px Inter, Helvetica, Arial, sans-serif';
          ctx.textBaseline = 'middle';
          const label = Math.round(it.compliance) + '% (' + it.numerator + '/' + it.denominator + ')';
          const end = x.getPixelForValue(it.compliance);
          const w = ctx.measureText(label).width;
          ctx.fillText(label, end + w + 16 > x.right ? end - w - 12 : end + 12, bar.y);
          if (end + w + 16 > x.right) { ctx.fillStyle = '#fff'; ctx.fillText(label, end - w - 12, bar.y); }
        });
        ctx.restore();
      }
    };
    return draw(1600, h, {
      type: 'bar',
      data: { labels: items.map(function (c, i) { return wrapLabel((i + 1) + '. ' + c.name, 36); }), datasets: [{ data: items.map(function (c) { return c.compliance; }), backgroundColor: COL.s1, borderRadius: 6, barThickness: 34 }] },
      options: {
        indexAxis: 'y', layout: { padding: { top: 20, right: 30, bottom: 10, left: 10 } },
        scales: {
          x: { min: 0, max: 100, grid: { color: COL.grid }, border: { display: false }, ticks: { stepSize: 25, color: COL.muted, font: font(20), callback: function (v) { return v + '%'; } } },
          y: { grid: { display: false }, border: { color: COL.grid }, ticks: { color: COL.text, font: font(21), autoSkip: false } }
        },
        plugins: { legend: { display: false }, tooltip: { enabled: false } }
      },
      plugins: [targets]
    });
  }

  function cycleChart(snap) {
    if (!snap.previous) return null;
    const rows = snap.criteria.map(function (c) {
      const p = snap.previous.criteria.find(function (x) { return x.id === c.id; });
      return { name: c.name, prev: p ? p.compliance : null, cur: c.compliance };
    }).filter(function (r) { return r.prev !== null || r.cur !== null; });
    if (!rows.length) return null;
    return draw(1600, 120 + rows.length * 90, {
      type: 'bar',
      data: {
        labels: rows.map(function (r, i) { return wrapLabel((i + 1) + '. ' + r.name, 36); }),
        datasets: [
          { label: snap.previous.cycleLabel, data: rows.map(function (r) { return r.prev; }), backgroundColor: COL.s2, borderRadius: 5, barThickness: 26 },
          { label: snap.cycleLabel, data: rows.map(function (r) { return r.cur; }), backgroundColor: COL.s1, borderRadius: 5, barThickness: 26 }
        ]
      },
      options: {
        indexAxis: 'y', layout: { padding: { top: 10, right: 30, bottom: 10, left: 10 } },
        scales: {
          x: { min: 0, max: 100, grid: { color: COL.grid }, border: { display: false }, ticks: { stepSize: 25, color: COL.muted, font: font(20), callback: function (v) { return v + '%'; } } },
          y: { grid: { display: false }, ticks: { color: COL.text, font: font(21), autoSkip: false } }
        },
        plugins: { legend: { position: 'top', align: 'end', labels: { color: COL.text, font: font(20), boxWidth: 22, boxHeight: 22 } }, tooltip: { enabled: false } }
      }
    });
  }

  function categoricalChart(cat) {
    if (!cat || !cat.n) return null;
    const rows = cat.rows;
    return draw(1600, 90 + rows.length * 60, {
      type: 'bar',
      data: { labels: rows.map(function (r) { return wrapLabel(r.label, 40); }), datasets: [{ data: rows.map(function (r) { return r.n; }), backgroundColor: COL.s1, borderRadius: 5, barThickness: 28 }] },
      options: {
        indexAxis: 'y', layout: { padding: { top: 16, right: 30, bottom: 10, left: 10 } },
        scales: {
          x: { beginAtZero: true, grid: { color: COL.grid }, border: { display: false }, ticks: { precision: 0, color: COL.muted, font: font(20) }, title: { display: true, text: 'Cases', color: COL.muted, font: font(20) } },
          y: { grid: { display: false }, ticks: { color: COL.text, font: font(21), autoSkip: false } }
        },
        plugins: { legend: { display: false }, tooltip: { enabled: false } }
      }
    });
  }

  function chartImage(kind, snap, arg) {
    const key = snap.generatedAt + '|' + kind + '|' + (arg || '');
    if (cache[key] !== undefined) return cache[key];
    let url = null;
    if (kind === 'chart-compliance') url = complianceChart(snap);
    else if (kind === 'chart-cycle') url = cycleChart(snap);
    else if (kind === 'chart-cat') url = categoricalChart(snap.categorical.find(function (c) { return c.fieldId === arg; }));
    else if (DA.qiReport) {
      const q = DA.qiReport.chartConfigs(kind, snap.qi, COL, font, wrapLabel);
      if (q) url = draw(1600, q.h, q.cfg);
    }
    cache[key] = url;
    return url;
  }

  /* =========================================================
   * Data blocks
   * ========================================================= */
  const BLOCKS = {
    'criteria-table': { kind: 'table', label: 'Standards and criteria table' },
    'results-summary': { kind: 'summary', label: 'Key figures' },
    'results-table': { kind: 'table', label: 'Compliance by criterion table' },
    'chart-compliance': { kind: 'figure', label: 'Compliance by criterion chart' },
    'numeric-summary': { kind: 'table', label: 'Numerical variable summary' },
    'categorical': { kind: 'table', label: 'Categorical distributions' },
    'chart-cat': { kind: 'figure', label: 'Distribution chart' },
    'cycle-table': { kind: 'table', label: 'Cycle comparison table' },
    'chart-cycle': { kind: 'figure', label: 'Cycle comparison chart' },
    'action-plan': { kind: 'table', label: 'Action plan table' },
    'references': { kind: 'list', label: 'Reference list' },
    'form-fields': { kind: 'table', label: 'Data collection form' }
  };
  if (DA.qiReport) Object.assign(BLOCKS, DA.qiReport.BLOCKS);

  /** Blocks a user can insert from the editor toolbar for this report. */
  function insertableBlocks(report) {
    const s = report.analyticsSnapshot;
    const list = [
      { key: 'results-summary', label: 'Key figures' },
      { key: 'criteria-table', label: 'Standards and criteria table' },
      { key: 'results-table', label: 'Compliance by criterion table' },
      { key: 'chart-compliance', label: 'Compliance by criterion chart', chart: true }
    ];
    if (s.numeric.length) list.push({ key: 'numeric-summary', label: 'Numerical variable summary' });
    if (s.categorical.length) list.push({ key: 'categorical', label: 'Categorical distributions table' });
    s.categorical.forEach(function (c) { list.push({ key: 'chart-cat', arg: c.fieldId, label: 'Chart: ' + c.label, chart: true }); });
    if (s.previous) { list.push({ key: 'cycle-table', label: 'Cycle comparison table' }); list.push({ key: 'chart-cycle', label: 'Cycle comparison chart', chart: true }); }
    if (DA.qiReport) DA.qiReport.insertable(report).forEach(function (b) { list.push(b); });
    list.push({ key: 'action-plan', label: 'Action plan table' });
    list.push({ key: 'references', label: 'Reference list' });
    return list;
  }

  function source(snap) {
    return '<p class="doc-source">Source: DentalAudit analytics snapshot, ' + U.fmtDate(snap.generatedAt, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) +
      ' · ' + esc(snap.cycleLabel) + ' · ' + snap.totals.completed + ' completed record' + (snap.totals.completed === 1 ? '' : 's') + (snap.form ? ' · form v' + snap.form.version : '') + '</p>';
  }

  function caption(ctr, kind, title) {
    if (kind === 'figure') { ctr.fig++; return '<p class="doc-caption">Figure ' + ctr.fig + '. ' + esc(title) + '</p>'; }
    ctr.tab++;
    return '<p class="doc-caption">Table ' + ctr.tab + '. ' + esc(title) + '</p>';
  }

  function achievedCell(v) {
    if (v === null) return '<td class="doc-c doc-na">No data</td>';
    return v ? '<td class="doc-c doc-yes">✓ Achieved</td>' : '<td class="doc-c doc-no">✗ Not achieved</td>';
  }

  function num(v, dp) { return v === null || v === undefined ? '—' : (dp ? (Math.round(v * Math.pow(10, dp)) / Math.pow(10, dp)).toFixed(dp) : String(v)); }

  function blockHtml(key, arg, report, ctr) {
    const s = report.analyticsSnapshot;
    const P = E.pct;
    ctr = ctr || { tab: 0, fig: 0 };
    if (DA.qiReport && DA.qiReport.has(key)) return DA.qiReport.toHtml(DA.qiReport.parts(key, report), ctr, s);
    switch (key) {
      case 'criteria-table':
        return caption(ctr, 'table', 'Audit standards, targets and results') +
          '<table class="doc-table"><thead><tr><th>#</th><th>Criterion</th><th>Clinical standard</th><th>Reference source</th><th class="doc-c">Target</th><th class="doc-c">Actual</th><th class="doc-c">Eligible cases</th><th class="doc-c">Target achieved</th></tr></thead><tbody>' +
          s.criteria.map(function (c, i) {
            return '<tr><td>' + (i + 1) + '</td><td><strong>' + esc(c.name) + '</strong></td><td>' + esc(c.description || c.numeratorDef || '—') + '</td><td>' + esc(c.reference || '—') + '</td>' +
              '<td class="doc-c">' + c.target + '%</td><td class="doc-c">' + E.pctShort(c.compliance) + '</td><td class="doc-c">' + c.denominator + '</td>' + achievedCell(c.achieved) + '</tr>';
          }).join('') + '</tbody></table>' + source(s);
      case 'results-summary': {
        const t = s.totals;
        const kv = [['Total records', t.records], ['Completed records', t.completed], ['Data completeness', E.pctShort(t.completeness)],
          ['Target sample', t.targetSample ? t.completed + ' / ' + t.targetSample + ' (' + E.pctShort(t.sampleAchieved) + ')' : '—'],
          ['Overall compliance', E.pctShort(s.overall.compliance) + (s.overall.applicable ? ' (' + s.overall.met + '/' + s.overall.applicable + ')' : '')],
          ['Criteria achieved', s.overall.achieved + ' / ' + s.overall.total]];
        return '<div class="doc-kpis">' + kv.map(function (x) { return '<div class="doc-kpi"><span>' + x[0] + '</span><strong>' + x[1] + '</strong></div>'; }).join('') + '</div>' + source(s);
      }
      case 'results-table':
        return caption(ctr, 'table', 'Compliance by criterion') +
          '<table class="doc-table"><thead><tr><th>#</th><th>Criterion</th><th class="doc-c">Numerator<br><span>compliant</span></th><th class="doc-c">Denominator<br><span>eligible</span></th><th class="doc-c">N/A<br><span>excluded</span></th><th class="doc-c">Not<br><span>evidenced</span></th><th class="doc-c">Compliance</th><th class="doc-c">Target</th><th class="doc-c">Achieved</th></tr></thead><tbody>' +
          s.criteria.map(function (c, i) {
            return '<tr><td>' + (i + 1) + '</td><td>' + esc(c.name) + '</td><td class="doc-c">' + c.numerator + '</td><td class="doc-c">' + c.denominator + '</td><td class="doc-c">' + c.na + '</td><td class="doc-c">' + c.notEvidenced + '</td>' +
              '<td class="doc-c"><strong>' + P(c.compliance) + '</strong></td><td class="doc-c">' + c.target + '%</td>' + achievedCell(c.achieved) + '</tr>';
          }).join('') +
          '<tr class="doc-total"><td></td><td>All criterion assessments</td><td class="doc-c">' + s.overall.met + '</td><td class="doc-c">' + s.overall.applicable + '</td><td></td><td></td><td class="doc-c"><strong>' + P(s.overall.compliance) + '</strong></td><td></td><td class="doc-c">' + s.overall.achieved + '/' + s.overall.total + '</td></tr>' +
          '</tbody></table>' + source(s) + '<p class="doc-source">' + esc(s.method.compliance) + '</p>';
      case 'chart-compliance': case 'chart-cycle': case 'chart-cat': {
        const url = chartImage(key, s, arg);
        const title = key === 'chart-compliance' ? 'Compliance by criterion against target (navy line marks the target)'
          : key === 'chart-cycle' ? 'Compliance by criterion: ' + (s.previous ? s.previous.cycleLabel : '') + ' compared with ' + s.cycleLabel
          : 'Distribution of responses: ' + ((s.categorical.find(function (c) { return c.fieldId === arg; }) || {}).label || '');
        if (!url) return '<p class="doc-empty">Chart not available — no scored data in this snapshot.</p>';
        return '<figure class="doc-figure"><img src="' + url + '" alt="' + esc(title) + '"></figure>' + caption(ctr, 'figure', title) + source(s);
      }
      case 'numeric-summary':
        if (!s.numeric.length) return '<p class="doc-empty">No numerical fields in the data collection form.</p>';
        return caption(ctr, 'table', 'Summary of numerical variables (completed records)') +
          '<table class="doc-table"><thead><tr><th>Variable</th><th class="doc-c">n</th><th class="doc-c">Mean</th><th class="doc-c">SD</th><th class="doc-c">Median</th><th class="doc-c">Min</th><th class="doc-c">Max</th><th class="doc-c">Missing / N/A</th></tr></thead><tbody>' +
          s.numeric.map(function (n) {
            return '<tr><td>' + esc(n.label) + (n.scale ? ' <span class="doc-muted">(scale ' + n.scale + ')</span>' : '') + '</td><td class="doc-c">' + n.n + '</td><td class="doc-c">' + num(n.mean, 2) + '</td><td class="doc-c">' + num(n.sd, 2) + '</td><td class="doc-c">' + num(n.median, 1) + '</td><td class="doc-c">' + num(n.min) + '</td><td class="doc-c">' + num(n.max) + '</td><td class="doc-c">' + n.missing + ' / ' + n.na + '</td></tr>';
          }).join('') + '</tbody></table>' + source(s);
      case 'categorical':
        if (!s.categorical.length) return '<p class="doc-empty">No categorical fields (other than criterion questions) in the data collection form.</p>';
        return s.categorical.map(function (c) {
          return caption(ctr, 'table', c.label + ' (n = ' + c.n + (c.multi ? '; more than one option could be selected' : '') + ')') +
            '<table class="doc-table doc-table--narrow"><thead><tr><th>Response</th><th class="doc-c">n</th><th class="doc-c">%</th></tr></thead><tbody>' +
            c.rows.map(function (r) { return '<tr><td>' + esc(r.label) + '</td><td class="doc-c">' + r.n + '</td><td class="doc-c">' + E.pctShort(r.pct) + '</td></tr>'; }).join('') +
            (c.missing ? '<tr><td class="doc-muted">Not answered</td><td class="doc-c doc-muted">' + c.missing + '</td><td></td></tr>' : '') + '</tbody></table>';
        }).join('') + source(s);
      case 'cycle-table':
        if (!s.previous) return '<p class="doc-empty">No previous cycle to compare with.</p>';
        return caption(ctr, 'table', 'Comparison with ' + s.previous.cycleLabel) +
          '<table class="doc-table"><thead><tr><th>Criterion</th><th class="doc-c">' + esc(s.previous.cycleLabel) + '</th><th class="doc-c">' + esc(s.cycleLabel) + '</th><th class="doc-c">Change</th><th class="doc-c">Target</th></tr></thead><tbody>' +
          s.criteria.map(function (c) {
            const p = s.previous.criteria.find(function (x) { return x.id === c.id; }) || {};
            const d = p.compliance !== null && p.compliance !== undefined && c.compliance !== null ? c.compliance - p.compliance : null;
            return '<tr><td>' + esc(c.name) + '</td><td class="doc-c">' + E.pctShort(p.compliance) + (p.denominator ? ' <span class="doc-muted">(' + p.numerator + '/' + p.denominator + ')</span>' : '') + '</td>' +
              '<td class="doc-c">' + E.pctShort(c.compliance) + (c.denominator ? ' <span class="doc-muted">(' + c.numerator + '/' + c.denominator + ')</span>' : '') + '</td>' +
              '<td class="doc-c">' + (d === null ? '—' : (d > 0 ? '+' : '') + Math.round(d) + ' pts') + '</td><td class="doc-c">' + c.target + '%</td></tr>';
          }).join('') + '</tbody></table>' + '<p class="doc-source">Previous cycle: ' + s.previous.completed + ' completed records. ' + source(s).replace(/^<p class="doc-source">|<\/p>$/g, '') + '</p>';
      case 'action-plan': {
        const acts = report.actionPlan.filter(function (a) { return a.approved; });
        if (!acts.length) return '<p class="doc-empty">No actions have been approved yet.</p>';
        return caption(ctr, 'table', 'Action plan') +
          '<table class="doc-table doc-table--actions"><thead><tr><th>#</th><th>Issue identified</th><th>Criterion</th><th>Intervention</th><th>Responsible</th><th>Target date</th><th>Success measure</th><th>Review date</th><th>Status</th></tr></thead><tbody>' +
          acts.map(function (a, i) {
            const c = s.criteria.find(function (x) { return x.id === a.criterionId; });
            return '<tr><td>' + (i + 1) + '</td><td>' + esc(a.issue) + '</td><td>' + esc(c ? c.name : '—') + '</td><td>' + esc(a.intervention) + '</td><td>' + esc(a.responsible || '—') + '</td>' +
              '<td class="doc-nw">' + (a.targetDate ? U.fmtDate(a.targetDate) : '—') + '</td><td>' + esc(a.successMeasure || '—') + '</td><td class="doc-nw">' + (a.reviewDate ? U.fmtDate(a.reviewDate) : '—') + '</td><td class="doc-nw">' + esc(E.actionStatus(a)) + '</td></tr>';
          }).join('') + '</tbody></table>';
      }
      case 'references':
        return report.references.length
          ? '<ol class="doc-refs">' + report.references.map(function (r) { return '<li>' + esc(r.text) + '</li>'; }).join('') + '</ol>'
          : '<p class="doc-empty">No references recorded.</p>';
      case 'form-fields':
        if (!s.form) return '<p class="doc-empty">No data collection form.</p>';
        return caption(ctr, 'table', 'Data collection form, version ' + s.form.version) +
          '<table class="doc-table"><thead><tr><th>#</th><th>Question</th><th>Type</th><th class="doc-c">Required</th><th>Linked criterion</th><th>Scoring rule</th></tr></thead><tbody>' +
          s.form.fields.map(function (f, i) {
            const c = s.criteria.find(function (x) { return x.id === f.linkedCriterionId; });
            return '<tr><td>' + (i + 1) + '</td><td>' + esc(f.label) + '</td><td>' + esc(f.type) + '</td><td class="doc-c">' + (f.required ? 'Yes' : 'No') + '</td><td>' + esc(c ? c.name : '—') + '</td><td>' + esc(f.rule || '—') + '</td></tr>';
          }).join('') + '</tbody></table>';
    }
    return '';
  }

  /** Fill every data block in a DOM container (editor / preview). */
  function hydrate(container, report, ctr) {
    ctr = ctr || { tab: 0, fig: 0 };
    container.querySelectorAll('.rb').forEach(function (b) {
      b.setAttribute('contenteditable', 'false');
      b.innerHTML = blockHtml(b.getAttribute('data-block'), b.getAttribute('data-arg'), report, ctr);
    });
    return ctr;
  }

  /** Section HTML with blocks rendered inline (string version for export). */
  function sectionHtml(sec, report, ctr) {
    return sec.html.replace(/<div class="rb" data-block="([^"]+)"(?: data-arg="([^"]*)")?[^>]*><\/div>/g, function (m, key, arg) {
      return '<div class="rb">' + blockHtml(key, arg ? arg.replace(/&quot;/g, '"') : null, report, ctr) + '</div>';
    });
  }

  /* =========================================================
   * Full document (preview, print, HTML export)
   * ========================================================= */
  function includedSections(report) {
    return report.sectionOrder.map(function (k) { return report.sections[k]; }).filter(function (s) { return s && s.included; });
  }

  function titlePage(report) {
    const m = report.meta;
    const statusLabel = { draft: 'Draft', in_review: 'In review', approved: 'Approved', archived: 'Archived' }[report.status];
    return '<section class="doc-title">' +
      '<div class="doc-title__brand"><span class="doc-title__mark"></span>' + esc(m.institution || '') + '</div>' +
      '<div class="doc-title__type">' + esc(E.TYPES[report.reportType] || 'Audit Report') + '</div>' +
      '<h1 class="doc-title__h">' + esc(report.title) + '</h1>' +
      (m.auditTitle && m.auditTitle !== report.title ? '<p class="doc-title__sub">' + esc(m.auditTitle) + '</p>' : '') +
      '<dl class="doc-title__meta">' +
        '<div><dt>Department</dt><dd>' + esc(m.department || '—') + '</dd></div>' +
        '<div><dt>Specialty</dt><dd>' + esc(m.specialty || '—') + '</dd></div>' +
        '<div><dt>Audit lead</dt><dd>' + esc(m.auditLead || '—') + '</dd></div>' +
        '<div><dt>Collaborators</dt><dd>' + esc((m.collaborators || []).join(', ') || '—') + '</dd></div>' +
        '<div><dt>Audit cycle</dt><dd>' + esc(m.cycleLabel || '—') + '</dd></div>' +
        '<div><dt>Reporting period</dt><dd>' + (m.periodFrom ? U.fmtDate(m.periodFrom) + ' – ' + U.fmtDate(m.periodTo) : '—') + '</dd></div>' +
        '<div><dt>Report date</dt><dd>' + U.fmtDate(m.reportDate) + '</dd></div>' +
        '<div><dt>Status</dt><dd>' + statusLabel + ' · revision ' + report.revision + '</dd></div>' +
      '</dl>' +
      (report.status === 'approved' ? '<p class="doc-title__approved">Approved by ' + esc(report.review.approvedBy || report.meta.auditLead) + ' on ' + U.fmtDate(report.review.approvalDate || report.approvedAt) + '</p>' : '') +
      (hasAiDraft(report) ? '<p class="doc-title__draft">Contains AI-assisted text awaiting review by the audit lead</p>' : '') +
    '</section>';
  }

  function hasAiDraft(report) {
    return includedSections(report).some(function (s) { return s.aiDraft; });
  }

  function toc(report) {
    let n = 0;
    return '<section class="doc-toc"><h2>Contents</h2><ol>' + includedSections(report).filter(function (s) { return s.key !== 'title'; }).map(function (s) {
      n++;
      return '<li><a href="#sec-' + s.key + '"><span>' + n + '. ' + esc(s.title) + '</span></a></li>';
    }).join('') + '</ol></section>';
  }

  function documentHtml(report, opts) {
    const o = opts || {};
    const ctr = { tab: 0, fig: 0 };
    let n = 0;
    const secs = includedSections(report);
    return '<article class="doc' + (o.className ? ' ' + o.className : '') + '">' +
      (secs.some(function (s) { return s.key === 'title'; }) ? titlePage(report) : '') +
      (o.toc !== false ? toc(report) : '') +
      secs.filter(function (s) { return s.key !== 'title'; }).map(function (s) {
        n++;
        return '<section class="doc-sec" id="sec-' + s.key + '">' +
          '<h2>' + n + '. ' + esc(s.title) + '</h2>' +
          (s.aiDraft ? '<p class="doc-aiflag">AI-assisted draft — not yet reviewed by the audit lead</p>' : '') +
          sectionHtml(s, report, ctr) + '</section>';
      }).join('') +
    '</article>';
  }

  /* Document styles — injected once into the app and embedded in HTML exports. */
  const DOC_CSS = [
    '.doc{font-family:"Source Serif 4",Georgia,"Times New Roman",serif;color:#1b2335;font-size:11.5pt;line-height:1.6;}',
    '.doc h1,.doc h2,.doc h3,.doc h4,.doc .doc-kpi,.doc-table,.doc-caption,.doc-source,.doc-title__meta,.doc-title__type,.doc-title__brand,.doc-toc{font-family:Inter,"Segoe UI",Helvetica,Arial,sans-serif;}',
    '.doc p{margin:0 0 .75em}.doc ul,.doc ol{margin:0 0 .9em;padding-left:1.4em}.doc li{margin-bottom:.3em}',
    '.doc h2{font-size:16pt;color:#0f1b3d;margin:0 0 .7em;padding-bottom:.35em;border-bottom:2px solid #0f1b3d;letter-spacing:-.01em}',
    '.doc h3{font-size:13pt;color:#0f1b3d;margin:1.2em 0 .5em}.doc h4{font-size:11.5pt;color:#24305a;margin:1.1em 0 .4em;text-transform:none}',
    '.doc .ph{color:#9a6b00;background:#fff6e0;border-radius:3px;padding:0 3px}.doc .rp-note{font-size:10pt;color:#5b6478;font-style:italic}',
    '.doc-sec{margin:0 0 2.2em}.doc-sec table:not(.doc-table){border-collapse:collapse;width:100%;margin:.6em 0 1em;font-size:10pt}.doc-sec table:not(.doc-table) td,.doc-sec table:not(.doc-table) th{border:1px solid #c9cfda;padding:6px 8px;vertical-align:top}',
    '.doc-table{border-collapse:collapse;width:100%;font-size:9.5pt;margin:.3em 0 .4em;line-height:1.4}.doc-table th{background:#0f1b3d;color:#fff;text-align:left;font-weight:600;padding:7px 8px;vertical-align:bottom}.doc-table th span{font-weight:400;opacity:.8;font-size:8.5pt}',
    '.doc-table td{border-bottom:1px solid #dde2ea;padding:6px 8px;vertical-align:top}.doc-table tbody tr:nth-child(even) td{background:#f6f8fb}.doc-table .doc-c{text-align:center}.doc-total td{font-weight:600;border-top:2px solid #0f1b3d;background:#eef2f9!important}',
    '.doc-table--narrow{width:auto;min-width:50%}.doc-table--actions{font-size:8.5pt}.doc-nw{white-space:nowrap}.doc-yes{color:#12703a;font-weight:600}.doc-no{color:#b02828;font-weight:600}.doc-na,.doc-muted{color:#7a8399}',
    '.doc-caption{font-size:9.5pt;font-weight:600;color:#0f1b3d;margin:1em 0 .3em}.doc-source{font-size:8.5pt;color:#6b7489;margin:.2em 0 1em}.doc-empty{font-size:10pt;color:#7a8399;font-style:italic}',
    '.doc-figure{margin:.6em 0 .2em;text-align:center}.doc-figure img{max-width:100%;height:auto;border:1px solid #e3e7ee;border-radius:4px}',
    '.doc-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:.4em 0 .3em}.doc-kpi{border:1px solid #dde2ea;border-radius:6px;padding:8px 10px;background:#f8f9fc}.doc-kpi span{display:block;font-size:8.5pt;color:#5b6478}.doc-kpi strong{font-size:13pt;color:#0f1b3d}',
    '.doc-refs li{margin-bottom:.5em}.doc-aiflag{display:inline-block;font-family:Inter,Helvetica,Arial,sans-serif;font-size:9pt;font-weight:600;color:#7a4a00;background:#fff3d6;border:1px solid #f0d08a;border-radius:4px;padding:2px 8px}',
    '.doc-title{min-height:880px;display:flex;flex-direction:column;justify-content:center;padding:40px 10px;border-bottom:1px solid #dde2ea;margin-bottom:2em}',
    '.doc-title__brand{display:flex;align-items:center;gap:10px;font-size:10pt;font-weight:600;color:#2456d6;text-transform:uppercase;letter-spacing:.08em}.doc-title__mark{width:28px;height:4px;background:#2456d6;border-radius:2px}',
    '.doc-title__type{font-size:11pt;color:#5b6478;margin-top:60px}.doc-title__h{font-family:Inter,Helvetica,Arial,sans-serif;font-size:28pt;line-height:1.15;color:#0f1b3d;margin:.25em 0 .3em;letter-spacing:-.02em}.doc-title__sub{font-size:13pt;color:#3d4660}',
    '.doc-title__meta{display:grid;grid-template-columns:1fr 1fr;gap:14px 28px;margin:48px 0 0;padding-top:24px;border-top:3px solid #0f1b3d}.doc-title__meta dt{font-size:8.5pt;text-transform:uppercase;letter-spacing:.06em;color:#6b7489}.doc-title__meta dd{margin:2px 0 0;font-size:11pt;font-weight:600;color:#0f1b3d}',
    '.doc-title__approved{margin-top:28px;font-family:Inter,Helvetica,Arial,sans-serif;font-weight:600;color:#12703a}.doc-title__draft{margin-top:20px;font-family:Inter,Helvetica,Arial,sans-serif;font-size:10pt;color:#7a4a00}',
    '.doc-toc{margin-bottom:2.4em;padding-bottom:1.6em;border-bottom:1px solid #dde2ea}.doc-toc h2{border:0;padding:0}.doc-toc ol{list-style:none;padding:0;columns:2;column-gap:32px}.doc-toc li{margin:0 0 .45em;font-size:10.5pt}.doc-toc a{color:#24305a;text-decoration:none}'
  ].join('\n');

  function ensureDocCss() {
    if (document.getElementById('doc-css')) return;
    const st = document.createElement('style');
    st.id = 'doc-css';
    st.textContent = DOC_CSS;
    document.head.appendChild(st);
  }

  function standaloneHtml(report) {
    return '<!doctype html>\n<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + esc(report.title) + '</title>' +
      '<meta name="generator" content="DentalAudit"><style>' +
      'body{margin:0;background:#eef1f5}.page{max-width:820px;margin:32px auto;background:#fff;padding:64px 72px;box-shadow:0 2px 18px rgba(15,27,61,.1)}' +
      '.foot{max-width:820px;margin:0 auto 40px;font:12px Inter,Helvetica,Arial,sans-serif;color:#6b7489;text-align:center}' +
      '@media print{body{background:#fff}.page{box-shadow:none;margin:0;padding:0;max-width:none}.foot{display:none}.doc-sec{break-before:page}.doc-table tr,.doc-figure{break-inside:avoid}.doc-title{break-after:page;min-height:auto}}' +
      '@media(max-width:700px){.page{padding:28px 20px;margin:0}.doc-kpis{grid-template-columns:1fr 1fr}.doc-toc ol{columns:1}.doc-table{font-size:8pt}}' +
      DOC_CSS + '</style></head><body><div class="page">' + documentHtml(report) + '</div>' +
      '<p class="foot">Generated by DentalAudit on ' + U.fmtDate(new Date()) + ' · revision ' + report.revision + ' · figures from the analytics snapshot of ' + U.fmtDate(report.snapshotAt) + '</p></body></html>';
  }

  return {
    sanitize, dehydrate, hydrate, blockHtml, sectionHtml, chartImage, insertableBlocks, BLOCKS,
    documentHtml, standaloneHtml, includedSections, ensureDocCss, DOC_CSS, hasAiDraft, titlePage
  };
})();
