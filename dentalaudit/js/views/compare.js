/* DentalAudit — cycle comparison (#/compare/:auditId?a=&b=) and new re-audit cycle creation */
DA.views.compare = (function () {
  const U = DA.utils, ui = DA.ui, store = DA.store, Q = DA.qi;

  /* =========================================================
   * New audit cycle (Cycle 1 baseline → Cycle 2 re-audit …)
   * ========================================================= */
  function canCreateCycle(audit) {
    const cur = DA.collection.currentCycle(audit);
    if (!cur) return { ok: false, why: 'This audit has no cycle yet.' };
    if (audit.status === 'draft') return { ok: false, why: 'Create the audit first.' };
    const done = cur.records.filter(function (r) { return r.status === 'completed'; }).length;
    if (!done) return { ok: false, why: cur.label + ' has no completed cases yet — collect baseline data before opening a re-audit cycle.' };
    return { ok: true, current: cur, done: done };
  }

  function createCycleModal(audit, onDone) {
    const chk = canCreateCycle(audit);
    if (!chk.ok) { ui.toast(chk.why, 'error'); return; }
    const cur = chk.current;
    const n = cur.number + 1;
    const drafts = cur.records.length - chk.done;
    ui.modal({
      title: 'Create Cycle ' + n, size: 'wide', confirmLabel: 'Create Cycle ' + n,
      subtitle: 'Re-audit “' + audit.title + '” after the improvement work. ' + cur.label + ' is closed and kept exactly as it is.',
      body:
        '<div class="nc-keep">' + ui.icon('lockSm', 15) + '<div><strong>' + U.esc(cur.label) + ' is preserved</strong><span>' + chk.done + ' completed case' + (chk.done === 1 ? '' : 's') + (drafts ? ' and ' + drafts + ' draft' + (drafts === 1 ? '' : 's') : '') + ', form v' + (cur.form ? cur.form.version : '—') + ' and the current criteria definitions are frozen with it. New cases are stored only in Cycle ' + n + '.</span></div></div>' +
        '<fieldset class="nc-opts"><legend class="field__label">Data collection form</legend>' +
          '<label class="nc-opt is-checked"><input type="radio" name="formMode" value="duplicate" checked><span><strong>Duplicate previous cycle form</strong><span>Copies every question with its criterion link and scoring rule, so results stay comparable. You can edit the copy before collecting — ' + U.esc(cur.label) + '’s form is never changed.</span></span><span class="badge badge--blue">Recommended</span></label>' +
          '<label class="nc-opt"><input type="radio" name="formMode" value="new"><span><strong>Create new form</strong><span>Start with a blank form. Link each question to a criterion again; comparisons will flag any scoring differences.</span></span></label>' +
        '</fieldset>' +
        '<div class="grid-2"><label class="field" data-f="startDate"><span class="field__label">Cycle ' + n + ' start date</span><input class="input" type="date" name="startDate" value="' + U.isoDay(new Date()) + '"><span class="field__error">Required.</span></label>' +
          '<label class="field" data-f="endDate"><span class="field__label">Planned end date</span><input class="input" type="date" name="endDate" value="' + U.isoDay(U.addDays(new Date(), 42)) + '"><span class="field__error">The end date must be after the start date.</span></label></div>' +
        '<label class="field"><span class="field__label">Reason / context for the re-audit <span class="muted">(optional)</span></span><textarea class="textarea" name="note" rows="2" placeholder="e.g. Re-audit following introduction of the implant restoration documentation template"></textarea></label>',
      onOpen: function (form) {
        form.querySelectorAll('input[name=formMode]').forEach(function (r) {
          r.addEventListener('change', function () { form.querySelectorAll('.nc-opt').forEach(function (l) { l.classList.toggle('is-checked', l.querySelector('input').checked); }); });
        });
      },
      onConfirm: function (form) {
        const f = form.elements;
        form.querySelectorAll('.field').forEach(function (x) { x.classList.remove('has-error'); });
        if (!f.startDate.value) { form.querySelector('[data-f=startDate]').classList.add('has-error'); return false; }
        if (f.endDate.value && f.endDate.value < f.startDate.value) { form.querySelector('[data-f=endDate]').classList.add('has-error'); return false; }
        const cyc = store.createCycle(audit.id, { formMode: f.formMode.value, startDate: f.startDate.value, endDate: f.endDate.value, note: f.note.value.trim() });
        ui.toast(cyc.label + ' created — ' + (f.formMode.value === 'duplicate' ? 'review the copied form, then start collecting' : 'design the new form'), 'success');
        if (onDone) onDone(cyc); else location.hash = '#/collect/' + audit.id + '/form';
      }
    });
  }

  /* =========================================================
   * Charts
   * ========================================================= */
  function short(l) { return l.length > 24 ? l.slice(0, 23) + '…' : l; }

  function barChart(canvas, labels, sets, opts) {
    const c = ui.chartColors();
    const o = opts || {};
    return ui.makeChart(canvas, {
      type: 'bar',
      data: { labels: labels, datasets: sets.map(function (s) { return Object.assign({ borderRadius: 4, borderSkipped: false, maxBarThickness: 26 }, s); }) },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: o.horizontal ? 'y' : 'x',
        datasets: { bar: { categoryPercentage: 0.72, barPercentage: 0.9 } },
        scales: (function () {
          const val = Object.assign({ grid: { color: c.grid }, border: { display: false }, ticks: { color: c.muted, callback: function (v) { return v + (o.unit || ''); } } }, o.scale || {});
          const cat = { grid: { display: false }, ticks: { color: c.text, autoSkip: false, callback: function (v, i) { return short(labels[i] || ''); } } };
          return o.horizontal ? { x: val, y: cat } : { y: val, x: cat };
        })(),
        plugins: {
          legend: { display: sets.length > 1, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, color: c.text } },
          tooltip: Object.assign(ui.tooltipStyle(), { displayColors: true, callbacks: { title: function (x) { return labels[x[0].dataIndex]; }, label: o.label || function (ctx) { return ctx.dataset.label + ': ' + ctx.formattedValue + (o.unit || ''); } } })
        }
      }
    });
  }

  function drawCharts(el, cmp, ser) {
    const c = ui.chartColors();
    const rows = cmp.rows.filter(function (r) { return !r.excluded; });
    const labels = rows.map(function (r) { return r.name; });
    const A = cmp.a.label, B = cmp.b.label;
    const q = function (id) { return el.querySelector(id); };
    if (!rows.length) return;
    barChart(q('#cc-a'), labels, [
      { label: A, data: rows.map(function (r) { return Q.round(r.a.compliance, 1); }), backgroundColor: c.series1 },
      { label: B, data: rows.map(function (r) { return Q.round(r.b.compliance, 1); }), backgroundColor: c.series2 },
      { type: 'line', label: 'Target', data: rows.map(function (r) { return r.target; }), borderColor: c.navy, backgroundColor: c.navy, borderDash: [4, 3], pointRadius: 3, pointStyle: 'line', showLine: false, borderWidth: 2 }
    ], { unit: '%', scale: { min: 0, max: 100 } });
    barChart(q('#cc-b'), labels, [{
      label: 'Change (percentage points)', data: rows.map(function (r) { return Q.round(r.pp, 1); }),
      backgroundColor: rows.map(function (r) { return r.pp === null ? c.muted : r.pp >= 0 ? c.good : c.critical; })
    }], { unit: ' pp', horizontal: true, label: function (ctx) { return Q.fmtPP(ctx.parsed.x); } });
    barChart(q('#cc-c'), labels, [
      { label: 'Compliant · ' + A, data: rows.map(function (r) { return r.a.met; }), backgroundColor: c.series1 },
      { label: 'Compliant · ' + B, data: rows.map(function (r) { return r.b.met; }), backgroundColor: c.series2 },
      { label: 'Non-compliant · ' + A, data: rows.map(function (r) { return r.a.notMet; }), backgroundColor: 'rgba(42,120,214,.35)' },
      { label: 'Non-compliant · ' + B, data: rows.map(function (r) { return r.b.notMet; }), backgroundColor: 'rgba(235,104,52,.35)' }
    ], { label: function (ctx) { return ctx.dataset.label + ': ' + ctx.parsed.y + ' cases'; } });
    const sl = ser.map(function (s) { return s.label; });
    barChart(q('#cc-d'), sl, [
      { label: 'Completed cases', data: ser.map(function (s) { return s.completed; }), backgroundColor: ser.map(function (s) { return s.key === cmp.keyA ? c.series1 : s.key === cmp.keyB ? c.series2 : '#c3cad8'; }) },
      { label: 'Target sample', type: 'line', data: ser.map(function (s) { return s.targetSample || null; }), borderColor: c.navy, backgroundColor: c.navy, borderDash: [4, 3], pointRadius: 3, borderWidth: 1.5 }
    ], { label: function (ctx) { return ctx.dataset.label + ': ' + ctx.parsed.y; } });
    barChart(q('#cc-e'), sl, [
      { label: 'Data completeness', data: ser.map(function (s) { return Q.round(s.completeness, 1); }), backgroundColor: ser.map(function (s) { return s.key === cmp.keyA ? c.series1 : s.key === cmp.keyB ? c.series2 : '#c3cad8'; }) }
    ], { unit: '%', scale: { min: 0, max: 100 } });
  }

  /* =========================================================
   * Page
   * ========================================================= */
  function levelBadge(r) {
    if (r.level === 'none') return '<span class="badge">' + ui.icon('x', 11) + 'Not comparable</span>';
    if (r.level === 'warn') return '<span class="badge badge--amber">' + ui.icon('alert', 11) + 'Check definition</span>';
    return '<span class="badge badge--green">' + ui.icon('check', 11) + 'Comparable</span>';
  }
  function cell(x) { return x ? '<strong>' + Q.fmtPct(x.compliance) + '</strong><span>' + x.met + '/' + x.denominator + '</span>' : '<span class="muted">—</span>'; }
  function delta(v, good) {
    if (v === null || v === undefined) return '<span class="muted">—</span>';
    const cls = v === 0 ? '' : (v > 0) === good ? ' cmp-up' : ' cmp-down';
    return '<span class="cmp-delta' + cls + '">' + Q.fmtDelta(v) + '</span>';
  }

  function render(el, params) {
    const audit = store.getAudit(params.id);
    if (!audit) { DA.views.notFound.render(el); return; }
    const ser = Q.series(audit);
    const q = params.query || {};
    const back = '<a class="back-link" href="#/audits/' + audit.id + '?tab=qi">' + ui.icon('chevronLeft', 15) + U.esc(audit.title) + '</a>';
    if (ser.length < 2) {
      const chk = canCreateCycle(audit);
      el.innerHTML = back + '<div class="page-head"><div><h2 class="page-head__title">Cycle comparison</h2></div></div><div class="card">' + ui.emptyState({
        icon: 'repeat', title: 'Only one audit cycle so far',
        text: 'Comparison needs a baseline and at least one re-audit cycle. ' + (chk.ok ? 'Create the next cycle after the improvement work and collect new cases.' : chk.why)
      }) + (chk.ok ? '<div class="center-actions"><button class="btn btn--primary" id="cc-new">' + ui.icon('repeat', 16) + 'Create Cycle ' + (chk.current.number + 1) + '</button></div>' : '') + '</div>';
      const b = el.querySelector('#cc-new');
      if (b) b.addEventListener('click', function () { createCycleModal(audit); });
      return;
    }
    const def = Q.defaultPair(audit);
    let ka = q.a && Q.ref(q.a) ? q.a : def.a, kb = q.b && Q.ref(q.b) ? q.b : def.b;
    const ia = ser.findIndex(function (s) { return s.key === ka; }), ib = ser.findIndex(function (s) { return s.key === kb; });
    if (ia > ib) { const t = ka; ka = kb; kb = t; }
    const cmp = Q.compare(ka, kb);
    const results = ser.map(function (s) { return Q.cycleResults(s); });
    const opt = function (sel) { return ser.map(function (s) { return '<option value="' + s.key + '"' + (s.key === sel ? ' selected' : '') + '>' + U.esc(s.label) + (s.sameAudit ? '' : ' · ' + U.esc(s.audit.title)) + '</option>'; }).join(''); };
    const A = cmp.a, B = cmp.b, O = cmp.overall;
    const warnHtml = cmp.warnings.length ? '<div class="cmp-warn' + (cmp.warnings.some(function (w) { return w.level === 'warn'; }) ? ' is-strong' : '') + '" role="alert">' + ui.icon('alert', 18) + '<div><strong>Comparability</strong><ul>' + cmp.warnings.map(function (w) { return '<li>' + U.esc(w.text) + '</li>'; }).join('') + '</ul></div></div>' : '<div class="cmp-ok">' + ui.icon('check', 16) + 'Criteria, scoring rules and sample sizes are consistent between the two cycles.</div>';

    el.innerHTML = back +
      '<div class="page-head"><div><h2 class="page-head__title">Cycle comparison</h2><p class="page-head__sub">' + U.esc(audit.title) + ' · results from the analytics engine (completed cases only; N/A excluded)</p></div>' +
        '<div class="page-head__actions"><a class="btn btn--ghost" href="#/reports/new?audit=' + (Q.ref(kb).audit.id) + '&type=reaudit&cycle=' + Q.ref(kb).cycle.id + '&from=' + encodeURIComponent(ka) + '">' + ui.icon('reports', 15) + 'Generate re-audit report</a></div></div>' +
      '<section class="card cmp-pick"><label class="field"><span class="field__label">Baseline / earlier cycle</span><select class="select" id="cc-ka">' + opt(ka) + '</select></label>' +
        '<span class="cmp-pick__arrow">' + ui.icon('arrowRight', 18) + '</span>' +
        '<label class="field"><span class="field__label">Comparison / later cycle</span><select class="select" id="cc-kb">' + opt(kb) + '</select></label></section>' +
      warnHtml +
      '<section class="cmp-kpis">' +
        kpi('Sample size', A.completed + ' → ' + B.completed, 'completed cases' + (A.completed !== B.completed ? ' · <b>sizes differ</b>' : ''), A.completed !== B.completed ? 'warn' : '') +
        kpi(A.label + ' compliance', Q.fmtPct(O.a.compliance), O.a.met + '/' + O.a.applicable + ' criterion assessments') +
        kpi(B.label + ' compliance', Q.fmtPct(O.b.compliance), O.b.met + '/' + O.b.applicable + ' criterion assessments') +
        kpi('Absolute change', Q.fmtPP(O.pp), 'percentage points', O.pp === null ? '' : O.pp >= 0 ? 'up' : 'down') +
        kpi('Relative change', Q.fmtRel(O.rel), 'of ' + A.label + ' compliance') +
        kpi('Data completeness', Q.fmtPct(A.completeness, 0) + ' → ' + Q.fmtPct(B.completeness, 0), (A.records - A.completed) + ' → ' + (B.records - B.completed) + ' incomplete records') +
      '</section>' +
      '<p class="cmp-foot">' + ui.icon('fHash', 13) + 'Pooled across the ' + cmp.included + ' included criteri' + (cmp.included === 1 ? 'on' : 'a') + '. Example: 75% → 95% is an <strong>absolute</strong> change of +20 percentage points and a <strong>relative</strong> change of +26.67% (20 ÷ 75).</p>' +

      '<section class="card"><div class="card__head"><div><h3 class="card__title">Criterion-level comparison</h3><p class="card__sub">Absolute change in percentage points; relative change as a proportion of ' + U.esc(A.label) + ' compliance.</p></div></div>' +
        '<div class="card__body card__body--flush"><div class="table-wrap"><table class="table table--compact cmp-table"><thead><tr><th>Criterion</th><th class="cell-num">' + U.esc(A.label) + '</th><th class="cell-num">' + U.esc(B.label) + '</th><th class="cell-num">Absolute change</th><th class="cell-num">Relative change</th><th class="cell-num">Δ compliant</th><th class="cell-num">Δ non-compliant</th><th class="cell-num">Δ missing</th><th>Comparability</th><th class="cell-num">Include</th></tr></thead><tbody>' +
          cmp.rows.map(function (r) {
            return '<tr class="' + (r.excluded ? 'is-excluded' : '') + '" data-key="' + U.esc(r.key) + '"><td><div class="cell-title">' + U.esc(r.name) + '</div><div class="cell-sub">Target ' + r.target + '%' + (r.b && r.a ? ' · eligible ' + r.a.denominator + ' → ' + r.b.denominator : '') + '</div></td>' +
              '<td class="cell-num cmp-val">' + cell(r.a) + '</td><td class="cell-num cmp-val">' + cell(r.b) + '</td>' +
              '<td class="cell-num"><span class="cmp-pp' + (r.pp === null ? '' : r.pp >= 0 ? ' cmp-up' : ' cmp-down') + '">' + Q.fmtPP(r.pp) + '</span></td>' +
              '<td class="cell-num" title="' + U.esc(r.relNote) + '">' + (r.relNote ? '<span class="muted small">n/a</span>' : Q.fmtRel(r.rel)) + '</td>' +
              '<td class="cell-num">' + delta(r.dMet, true) + '</td><td class="cell-num">' + delta(r.dNotMet, false) + '</td><td class="cell-num">' + delta(r.dMissing, false) + '</td>' +
              '<td>' + levelBadge(r) + (r.reasons.length ? '<details class="cmp-why"><summary>' + r.reasons.length + ' note' + (r.reasons.length === 1 ? '' : 's') + '</summary><ul>' + r.reasons.map(function (x) { return '<li>' + U.esc(x) + '</li>'; }).join('') + '</ul></details>' : '') + '</td>' +
              '<td class="cell-num">' + (r.comparable ? '<label class="switch switch--sm" title="Include in comparison"><input type="checkbox" data-include="' + U.esc(r.key) + '"' + (r.userExcluded ? '' : ' checked') + '><span class="switch__track"><span class="switch__thumb"></span></span></label>' : '<span class="muted small">Excluded</span>') + '</td></tr>';
          }).join('') + '</tbody></table></div></div></section>' +

      '<div class="cmp-grid">' +
        chartCard('cc-a', 'A. Baseline versus re-audit compliance', 'By criterion; dashed marks the target') +
        chartCard('cc-b', 'B. Percentage-point change', 'Absolute change for each included criterion') +
        chartCard('cc-c', 'C. Compliant and non-compliant cases', 'Case counts in each cycle') +
        chartCard('cc-d', 'D. Sample size across cycles', 'Completed cases; dashed line is the target sample') +
        chartCard('cc-e', 'E. Data completeness across cycles', 'Completed ÷ all records in the cycle') +
        '<section class="card cmp-notes"><div class="card__head"><div><h3 class="card__title">Interpreting this comparison</h3></div></div><div class="card__body"><ul>' + cmp.notes.map(function (n) { return '<li>' + U.esc(n) + '</li>'; }).join('') + '</ul>' + changeLog(audit) + '</div></section>' +
      '</div>';

    drawCharts(el, cmp, results);
    const go = function () { location.hash = '#/compare/' + audit.id + '?a=' + encodeURIComponent(el.querySelector('#cc-ka').value) + '&b=' + encodeURIComponent(el.querySelector('#cc-kb').value); };
    el.querySelector('#cc-ka').addEventListener('change', go);
    el.querySelector('#cc-kb').addEventListener('change', go);
    el.querySelectorAll('[data-include]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        store.setCompareExclusion(cmp.pairKey, cb.dataset.include, !cb.checked);
        ui.toast(cb.checked ? 'Criterion included in the comparison' : 'Criterion excluded from the comparison', 'success');
      });
    });
    el.querySelectorAll('[data-reason]').forEach(function (b) {
      b.addEventListener('click', function () { reasonModal(audit, b.dataset.reason); });
    });
  }

  function changeLog(audit) {
    const all = [];
    Q.lineage(audit).forEach(function (a) { (a.criteriaChanges || []).forEach(function (c) { all.push({ a: a, c: c }); }); });
    if (!all.length) return '<p class="muted small">No changes to criterion definitions have been recorded since data collection began.</p>';
    return '<h4 class="cmp-log__h">Recorded criterion changes</h4><ul class="cmp-log">' + all.slice().reverse().map(function (x) {
      const c = x.c;
      return '<li><span class="muted small">' + U.fmtDate(c.at) + ' · ' + U.esc(c.cycleLabel || '') + (c.by ? ' · ' + U.esc(c.by) : '') + '</span><span><strong>' + U.esc(c.criterionName || '') + '</strong> — ' + U.esc(c.field) + (c.field === 'added' || c.field === 'removed' ? '' : ': “' + U.esc(c.from) + '” → “' + U.esc(c.to) + '”') + '</span>' +
        '<span class="cmp-log__reason">' + (c.reason ? 'Reason: ' + U.esc(c.reason) : '<span class="muted">No reason recorded</span>') + ' <button class="link-btn small" data-reason="' + x.a.id + '|' + c.id + '">' + (c.reason ? 'Edit' : 'Record reason') + '</button></span></li>';
    }).join('') + '</ul>';
  }

  function reasonModal(audit, key) {
    const parts = key.split('|');
    const a = store.getAudit(parts[0]);
    const c = a && a.criteriaChanges.find(function (x) { return x.id === parts[1]; });
    if (!c) return;
    ui.modal({
      title: 'Why was this criterion changed?', confirmLabel: 'Save reason',
      subtitle: c.criterionName + ' — ' + c.field + ' changed on ' + U.fmtDate(c.at),
      body: '<label class="field"><span class="field__label">Reason</span><textarea class="textarea" name="reason" rows="3">' + U.esc(c.reason || '') + '</textarea></label>',
      onConfirm: function (form) { store.setChangeReason(a.id, c.id, form.elements.reason.value.trim()); ui.toast('Reason recorded', 'success'); }
    });
  }

  function kpi(label, value, sub, tone) {
    return '<div class="card cmp-kpi' + (tone ? ' cmp-kpi--' + tone : '') + '"><span class="cmp-kpi__l">' + U.esc(label) + '</span><strong class="cmp-kpi__v">' + value + '</strong><span class="cmp-kpi__s">' + sub + '</span></div>';
  }
  function chartCard(id, title, sub) {
    return '<section class="card"><div class="card__head"><div><h3 class="card__title">' + title + '</h3><p class="card__sub">' + sub + '</p></div></div><div class="card__body"><div class="chart-box" style="height:260px"><canvas id="' + id + '" role="img" aria-label="' + U.esc(title) + '"></canvas></div></div></section>';
  }

  return {
    nav: 'qi',
    title: function () { return 'Cycle Comparison'; },
    crumbs: function (p) {
      const a = store.getAudit(p.id);
      return [{ label: 'Workspace', href: '#/dashboard' }, { label: 'Quality Improvement', href: '#/qi' }, { label: a ? a.title : 'Audit', href: a ? '#/audits/' + a.id + '?tab=qi' : null }, { label: 'Cycle comparison' }];
    },
    render: render,
    createCycleModal: createCycleModal, canCreateCycle: canCreateCycle, barChart: barChart
  };
})();
