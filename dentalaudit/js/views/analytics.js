/* DentalAudit — Analytics */
DA.views.analytics = (function () {
  const U = DA.utils, ui = DA.ui, M = DA.metrics, store = DA.store;

  function trendChart(canvas, points, target) {
    const c = ui.chartColors();
    return ui.makeChart(canvas, {
      type: 'line',
      data: {
        labels: points.map(function (p) { return p.label; }),
        datasets: [
          {
            label: 'Compliance', data: points.map(function (p) { return p.value === null ? null : Math.round(p.value * 10) / 10; }),
            borderColor: c.series1, backgroundColor: c.series1, borderWidth: 2, tension: 0.25,
            pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: c.series1, pointBorderColor: c.surface, pointBorderWidth: 2, spanGaps: true
          },
          {
            label: 'Target', data: points.map(function () { return target; }),
            borderColor: c.navy, borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, pointHoverRadius: 0, fill: false
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: { min: 0, max: 100, grid: { color: c.grid }, border: { display: false }, ticks: { stepSize: 25, color: c.muted, callback: function (v) { return v + '%'; } } },
          x: { grid: { display: false }, border: { color: c.grid }, ticks: { color: c.muted } }
        },
        plugins: {
          legend: { display: false },
          tooltip: Object.assign(ui.tooltipStyle(), {
            callbacks: {
              label: function (ctx) {
                if (ctx.datasetIndex === 1) return 'Target: ' + target + '%';
                return 'Compliance: ' + U.pct(ctx.parsed.y) + ' (' + points[ctx.dataIndex].n + ' cases)';
              }
            }
          })
        }
      }
    });
  }

  function cycleChart(canvas, labels, before, after, names) {
    const c = ui.chartColors();
    return ui.makeChart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: names[0], data: before, backgroundColor: c.series1, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 22 },
          { label: names[1], data: after, backgroundColor: c.series2, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 22 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        datasets: { bar: { categoryPercentage: 0.7, barPercentage: 0.9 } },
        scales: {
          y: { min: 0, max: 100, grid: { color: c.grid }, border: { display: false }, ticks: { stepSize: 25, color: c.muted, callback: function (v) { return v + '%'; } } },
          x: { grid: { display: false }, ticks: { color: c.text, callback: function (v, i) { const l = labels[i]; return l.length > 22 ? l.slice(0, 21) + '…' : l; } } }
        },
        plugins: {
          legend: { display: false },
          tooltip: Object.assign(ui.tooltipStyle(), { displayColors: true, callbacks: { title: function (x) { return labels[x[0].dataIndex]; }, label: function (ctx) { return ctx.dataset.label + ': ' + U.pct(ctx.parsed.y); } } })
        }
      }
    });
  }

  function stackedChart(canvas, results) {
    const c = ui.chartColors();
    const labels = results.map(function (r, i) { return (i + 1) + '. ' + r.criterion.name; });
    const ds = [
      { label: 'Met', key: 'met', color: c.series1 },
      { label: 'Not met', key: 'notMet', color: c.series2 },
      { label: 'N/A', key: 'na', color: '#c5cbd6' }
    ].map(function (d) {
      return { label: d.label, data: results.map(function (r) { return r[d.key]; }), backgroundColor: d.color, borderColor: c.surface, borderWidth: { right: 2 }, borderSkipped: false, barThickness: 16 };
    });
    return ui.makeChart(canvas, {
      type: 'bar',
      data: { labels: labels, datasets: ds },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        scales: {
          x: { stacked: true, grid: { color: c.grid }, border: { display: false }, ticks: { color: c.muted, precision: 0 }, title: { display: true, text: 'Cases', color: c.muted } },
          y: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { color: c.text, callback: function (v, i) { const l = labels[i]; return l.length > 34 ? l.slice(0, 33) + '…' : l; } } }
        },
        plugins: {
          legend: { display: false },
          tooltip: Object.assign(ui.tooltipStyle(), { displayColors: true, callbacks: { title: function (x) { return labels[x[0].dataIndex]; } } })
        }
      }
    });
  }

  function legend(items) {
    return '<div class="legend">' + items.map(function (i) {
      return '<span class="legend__item">' + (i.tick ? '<span class="legend__tick' + (i.dash ? ' legend__tick--dash' : '') + '"></span>' : '<span class="legend__swatch" style="background:' + i.color + '"></span>') + U.esc(i.label) + '</span>';
    }).join('') + '</div>';
  }

  function kpi(label, value, foot) {
    return '<div class="card metric"><div class="metric__top"><span class="metric__label">' + label + '</span></div><div class="metric__value">' + value + '</div><div class="metric__foot">' + foot + '</div></div>';
  }

  function render(el, params) {
    const audits = M.live(store.getAudits());
    const s = store.getSettings();
    const selId = params.query && params.query.audit;
    const found = selId ? store.getAudit(selId) : null;
    const sel = found && !M.isDraft(found) ? found : null;
    const withData = audits.filter(function (a) { return M.compliance(a) !== null; });

    const picker = '<label class="field field--inline"><span class="field__label">Scope</span><select class="select" id="scope">' +
      '<option value="">All audits</option>' + audits.map(function (a) {
        return '<option value="' + a.id + '"' + (sel && sel.id === a.id ? ' selected' : '') + '>' + U.esc(a.title) + (a.cycle > 1 ? ' (cycle ' + a.cycle + ')' : '') + '</option>';
      }).join('') + '</select></label>';

    const head = '<div class="page-head"><div><h2 class="page-head__title">Analytics</h2><p class="page-head__sub">' +
      (sel ? U.esc(sel.title) : 'Compliance across ' + withData.length + ' audits with data') + '</p></div><div class="page-head__actions">' + picker + '</div></div>';

    if (!withData.length && !sel) {
      el.innerHTML = head + '<div class="card">' + ui.emptyState({ icon: 'analytics', title: 'Nothing to analyse yet', text: 'Analytics appear once cases have been recorded against an audit.', action: 'Go to data collection', href: '#/collect', actionIcon: 'collect' }) + '</div>';
      bindScope(el);
      return;
    }

    if (sel) renderAudit(el, head, sel);
    else renderAll(el, head, audits, withData, s);
    bindScope(el);
  }

  function bindScope(el) {
    el.querySelector('#scope').addEventListener('change', function (e) {
      location.hash = '#/analytics' + (e.target.value ? '?audit=' + e.target.value : '');
    });
  }

  function renderAll(el, head, audits, withData, s) {
    const sum = M.summary(audits);
    const meeting = withData.filter(function (a) { return M.compliance(a) >= M.target(a); }).length;
    let assessed = 0;
    audits.forEach(function (a) { M.criterionResults(a).forEach(function (r) { assessed += r.applicable; }); });

    const bars = withData.slice().sort(function (a, b) { return M.compliance(b) - M.compliance(a); }).map(function (a) {
      return { id: a.id, label: (a.cycle > 1 ? 'C' + a.cycle + ' · ' : '') + a.title, fullLabel: a.title, value: M.compliance(a), target: M.target(a) };
    });

    const depts = {};
    withData.forEach(function (a) {
      const d = depts[a.department] || (depts[a.department] = { met: 0, app: 0, targets: [] });
      M.criterionResults(a).forEach(function (r) { d.met += r.met; d.app += r.applicable; });
      d.targets.push(M.target(a));
    });
    const deptItems = Object.keys(depts).map(function (k) {
      const d = depts[k];
      return { id: k, label: k, value: d.app ? d.met / d.app * 100 : null, target: d.targets.reduce(function (x, y) { return x + y; }, 0) / d.targets.length };
    }).sort(function (a, b) { return b.value - a.value; });

    const trend = M.monthlyTrend(withData);

    el.innerHTML = head +
      '<section class="metrics">' +
        kpi('Average compliance', sum.avgCompliance === null ? '—' : Math.round(sum.avgCompliance) + '<small>%</small>', 'Mean of audit-level compliance') +
        kpi('Audits meeting target', meeting + '<small>/' + withData.length + '</small>', withData.length - meeting + ' below target') +
        kpi('Cases audited', sum.totalCases, 'Across ' + audits.length + ' audits') +
        kpi('Criteria assessed', assessed.toLocaleString('en-GB'), 'Applicable criterion checks') +
      '</section>' +
      '<div class="analytics-grid">' +
        '<section class="card span-2"><div class="card__head"><div><h3 class="card__title">Compliance by audit</h3><p class="card__sub">Click a bar to open the audit</p></div>' + legend([{ label: 'Compliance', color: 'var(--series-1)' }, { label: 'Target', tick: true }]) + '</div>' +
          '<div class="card__body"><div class="chart-box" style="height:' + Math.max(200, bars.length * 36 + 40) + 'px"><canvas id="ch-audits" role="img" aria-label="Compliance by audit"></canvas></div>' +
          '<details class="data-table"><summary>View as table</summary><table class="table table--compact"><thead><tr><th>Audit</th><th>Compliance</th><th>Target</th></tr></thead><tbody>' +
            bars.map(function (b) { return '<tr><td>' + U.esc(b.fullLabel) + '</td><td class="cell-num">' + U.pct(b.value) + '</td><td class="cell-num">' + U.pct(b.target) + '</td></tr>'; }).join('') +
          '</tbody></table></details></div></section>' +
        '<section class="card"><div class="card__head"><div><h3 class="card__title">Monthly compliance trend</h3><p class="card__sub">Pooled across all audits, by date of care</p></div>' + legend([{ label: 'Compliance', color: 'var(--series-1)' }, { label: s.defaultTarget + '% target', tick: true, dash: true }]) + '</div>' +
          '<div class="card__body"><div class="chart-box" style="height:260px"><canvas id="ch-trend" role="img" aria-label="Monthly compliance trend"></canvas></div></div></section>' +
        '<section class="card"><div class="card__head"><div><h3 class="card__title">Compliance by department</h3><p class="card__sub">Pooled criterion checks per department</p></div>' + legend([{ label: 'Compliance', color: 'var(--series-1)' }, { label: 'Target', tick: true }]) + '</div>' +
          '<div class="card__body"><div class="chart-box" style="height:' + Math.max(200, deptItems.length * 40 + 40) + 'px"><canvas id="ch-dept" role="img" aria-label="Compliance by department"></canvas></div></div></section>' +
      '</div>';

    DA.charts.complianceBars(el.querySelector('#ch-audits'), bars, { labelChars: 44, onClick: function (it) { location.hash = '#/analytics?audit=' + it.id; } });
    trendChart(el.querySelector('#ch-trend'), trend, s.defaultTarget);
    DA.charts.complianceBars(el.querySelector('#ch-dept'), deptItems, { labelChars: 26 });
  }

  function renderAudit(el, head, a) {
    const results = M.criterionResults(a);
    const comp = M.compliance(a);
    const prev = a.parentId ? store.getAudit(a.parentId) : null;
    const next = store.getAudits().find(function (x) { return x.parentId === a.id; });
    const pair = prev ? [prev, a] : next ? [a, next] : null;
    const trend = M.monthlyTrend([a]);

    if (comp === null) {
      el.innerHTML = head + '<div class="card">' + ui.emptyState({ icon: 'analytics', title: 'No data for this audit yet', text: 'Record cases to see criterion-level analytics.', action: 'Record cases', href: '#/collect/' + a.id, actionIcon: 'collect' }) + '</div>';
      return;
    }

    const items = results.map(function (r, i) { return { id: r.criterion.id, label: (i + 1) + '. ' + r.criterion.name, fullLabel: r.criterion.name, value: r.compliance, target: r.target }; });
    const worst = results.filter(function (r) { return r.compliance !== null; }).sort(function (x, y) { return (x.compliance - x.target) - (y.compliance - y.target); })[0];

    el.innerHTML = head +
      '<section class="metrics">' +
        kpi('Overall compliance', Math.round(comp) + '<small>%</small>', ui.compliancePill(comp, M.target(a)) + ' target ' + Math.round(M.target(a)) + '%') +
        kpi('Cases', DA.collection.completedRecords(a).length + '<small>/' + a.targetSampleSize + '</small>', M.statusMeta(a.status).label) +
        kpi('Criteria meeting target', results.filter(function (r) { return r.compliance !== null && r.compliance >= r.target; }).length + '<small>/' + results.length + '</small>', 'Per-criterion targets') +
        kpi('Largest gap', worst ? Math.round(worst.compliance - worst.target) + '<small> pts</small>' : '—', worst ? U.esc(worst.criterion.name.slice(0, 40)) + (worst.criterion.name.length > 40 ? '…' : '') : '') +
      '</section>' +
      '<div class="analytics-grid">' +
        '<section class="card span-2"><div class="card__head"><div><h3 class="card__title">Compliance by criterion</h3><p class="card__sub">Met ÷ (met + not met)</p></div>' + legend([{ label: 'Compliance', color: 'var(--series-1)' }, { label: 'Target', tick: true }]) + '</div>' +
          '<div class="card__body"><div class="chart-box" style="height:' + Math.max(180, items.length * 40 + 40) + 'px"><canvas id="ch-crit" role="img" aria-label="Compliance by criterion"></canvas></div></div></section>' +
        '<section class="card"><div class="card__head"><div><h3 class="card__title">Result distribution</h3><p class="card__sub">Cases by outcome per criterion</p></div>' + legend([{ label: 'Met', color: 'var(--series-1)' }, { label: 'Not met', color: 'var(--series-2)' }, { label: 'N/A', color: '#c5cbd6' }]) + '</div>' +
          '<div class="card__body"><div class="chart-box" style="height:' + Math.max(200, items.length * 40 + 60) + 'px"><canvas id="ch-stack" role="img" aria-label="Result distribution"></canvas></div></div></section>' +
        (pair
          ? '<section class="card"><div class="card__head"><div><h3 class="card__title">Cycle comparison</h3><p class="card__sub">Has the change worked?</p></div>' + legend([{ label: 'Cycle ' + pair[0].cycle, color: 'var(--series-1)' }, { label: 'Cycle ' + pair[1].cycle, color: 'var(--series-2)' }]) + '</div>' +
            '<div class="card__body"><div class="chart-box" style="height:280px"><canvas id="ch-cycle" role="img" aria-label="Cycle comparison"></canvas></div></div></section>'
          : '<section class="card"><div class="card__head"><div><h3 class="card__title">Compliance over time</h3><p class="card__sub">By month of care</p></div>' + legend([{ label: 'Compliance', color: 'var(--series-1)' }, { label: 'Target', tick: true, dash: true }]) + '</div>' +
            '<div class="card__body"><div class="chart-box" style="height:280px"><canvas id="ch-trend" role="img" aria-label="Compliance over time"></canvas></div></div></section>') +
      '</div>';

    DA.charts.complianceBars(el.querySelector('#ch-crit'), items, { labelChars: 48 });
    stackedChart(el.querySelector('#ch-stack'), results);
    if (pair) {
      const r0 = M.criterionResults(pair[0]), r1 = M.criterionResults(pair[1]);
      cycleChart(el.querySelector('#ch-cycle'),
        r1.map(function (r, i) { return (i + 1) + '. ' + r.criterion.name; }),
        r1.map(function (r, i) { const p = M.previousResult(r0, r.criterion, i); return p && p.compliance !== null ? Math.round(p.compliance) : null; }),
        r1.map(function (r) { return r.compliance === null ? null : Math.round(r.compliance); }),
        ['Cycle ' + pair[0].cycle, 'Cycle ' + pair[1].cycle]);
    } else {
      trendChart(el.querySelector('#ch-trend'), trend, Math.round(M.target(a)));
    }
  }

  return {
    nav: 'analytics',
    title: function () { return 'Analytics'; },
    crumbs: function () { return [{ label: 'Insight' }, { label: 'Analytics' }]; },
    render: render
  };
})();
