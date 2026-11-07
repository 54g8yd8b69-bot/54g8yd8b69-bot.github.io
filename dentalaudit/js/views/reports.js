/* DentalAudit — Reports: global list and the guided report creation workflow
 *
 * Routes
 *   #/reports                         all reports across audits
 *   #/reports/new?audit=:id[&cycle=]  three-step report creation
 *   (#/reports/:id → report-editor.js, #/reports/:id/preview → report preview)
 */
DA.views.reports = (function () {
  const U = DA.utils, ui = DA.ui, M = DA.metrics, C = DA.collection, E = DA.reportEngine, store = DA.store;
  const STATUS = {
    draft: { label: 'Draft', tone: 'neutral' },
    in_review: { label: 'In review', tone: 'amber' },
    approved: { label: 'Approved', tone: 'green' },
    archived: { label: 'Archived', tone: 'violet' }
  };
  const listState = { status: 'all', q: '' };

  function statusBadge(st) {
    const m = STATUS[st] || STATUS.draft;
    return '<span class="badge badge--' + m.tone + '"><span class="badge__dot"></span>' + m.label + '</span>';
  }

  function cycleLabel(r) {
    const a = store.getAudit(r.auditId);
    const c = a && C.cycleById(a, r.cycleId);
    return c ? c.label : (r.meta.cycleLabel || '—');
  }

  /** Report rows (shared by the global list and the audit overview Reports tab). */
  function tableHtml(list, opts) {
    const o = opts || {};
    if (!list.length) return '';
    return '<div class="table-wrap"><table class="table table--compact rpt-table"><thead><tr><th>Report</th>' + (o.hideAudit ? '' : '<th class="hide-sm">Audit</th>') +
      '<th>Cycle</th><th>Status</th><th class="hide-sm">Revision</th><th class="hide-md">Last modified</th><th class="cell-actions"><span class="sr-only">Actions</span></th></tr></thead><tbody>' +
      list.map(function (r) {
        const a = store.getAudit(r.auditId);
        const changed = E.datasetChanged(r);
        return '<tr class="is-link" tabindex="0" data-href="#/reports/' + r.id + '">' +
          '<td style="min-width:220px"><div class="cell-title">' + U.esc(r.title) + '</div><div class="cell-sub">' + U.esc(E.TYPES[r.reportType] || '') + (r.length === 'summary' ? ' · summary' : '') + '</div></td>' +
          (o.hideAudit ? '' : '<td class="hide-sm"><span class="rpt-audit">' + U.esc(a ? a.title : r.meta.auditTitle) + '</span></td>') +
          '<td class="nowrap">' + U.esc(cycleLabel(r)) + '</td>' +
          '<td><div class="rpt-status">' + statusBadge(r.status) + (changed && r.status !== 'archived' ? '<span class="badge badge--amber" title="New or edited cases since this report was generated">' + ui.icon('refresh', 11) + 'Data changed</span>' : '') + '</div></td>' +
          '<td class="hide-sm num">v' + r.revision + '</td>' +
          '<td class="hide-md muted small nowrap">' + U.relTime(r.updatedAt) + '</td>' +
          '<td class="cell-actions">' +
            '<a class="icon-btn icon-btn--sm" href="#/reports/' + r.id + '" title="Open" aria-label="Open ' + U.esc(r.title) + '">' + ui.icon('collect', 15) + '</a>' +
            '<a class="icon-btn icon-btn--sm" href="#/reports/' + r.id + '/preview" title="Preview" aria-label="Preview ' + U.esc(r.title) + '">' + ui.icon('eye', 15) + '</a>' +
            '<button class="icon-btn icon-btn--sm" data-dup-report="' + r.id + '" title="Duplicate" aria-label="Duplicate ' + U.esc(r.title) + '">' + ui.icon('copy', 15) + '</button>' +
            '<button class="icon-btn icon-btn--sm icon-btn--danger" data-del-report="' + r.id + '" title="Delete" aria-label="Delete ' + U.esc(r.title) + '">' + ui.icon('trash', 15) + '</button>' +
          '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /** Wire row navigation + duplicate/delete (used by list and audit tab). */
  function bindTable(host) {
    host.querySelectorAll('tr[data-href]').forEach(function (tr) {
      tr.addEventListener('click', function (e) { if (!e.target.closest('a, button')) location.hash = tr.dataset.href; });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target === tr) location.hash = tr.dataset.href; });
    });
    host.querySelectorAll('[data-dup-report]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        const c = store.duplicateReport(b.dataset.dupReport);
        ui.toast('Report duplicated as a new draft', 'success');
        location.hash = '#/reports/' + c.id;
      });
    });
    host.querySelectorAll('[data-del-report]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        const r = store.getReport(b.dataset.delReport);
        ui.confirm({
          title: 'Delete report?',
          message: '“' + r.title + '”' + (r.status === 'approved' ? ', an approved report,' : '') + ' and its ' + (r.revisions || []).length + ' saved revisions will be permanently deleted. The audit and its data are not affected.',
          confirmLabel: 'Delete report', danger: true,
          onConfirm: function () { store.deleteReport(r.id); ui.toast('Report deleted', 'success'); }
        });
      });
    });
  }

  /** Choose which audit to report on. */
  function pickAudit() {
    const audits = M.live(store.getAudits());
    if (!audits.length) { ui.toast('Create an audit first', 'error'); return; }
    ui.modal({
      title: 'Generate a new report', subtitle: 'Reports are compiled from the audit’s protocol and collected data.', confirmLabel: 'Continue',
      body: '<label class="field"><span class="field__label">Audit</span><select class="select" name="audit">' + audits.map(function (a) {
        return '<option value="' + a.id + '">' + U.esc(a.title) + (a.cycle > 1 ? ' (cycle ' + a.cycle + ')' : '') + ' — ' + C.completedRecords(a).length + ' completed cases</option>';
      }).join('') + '</select></label>',
      onConfirm: function (form) { location.hash = '#/reports/new?audit=' + form.elements.audit.value; }
    });
  }

  /* =========================================================
   * Global list — #/reports
   * ========================================================= */
  function renderList(el, params) {
    const q = params.query || {};
    if (q.audit && store.getAudit(q.audit)) { location.replace('#/audits/' + q.audit + '?tab=reports'); return; }
    const all = store.getReports().sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });
    const counts = { all: all.length };
    Object.keys(STATUS).forEach(function (k) { counts[k] = all.filter(function (r) { return r.status === k; }).length; });

    el.innerHTML = '<div class="page-head"><div><h2 class="page-head__title">Reports</h2><p class="page-head__sub">Structured audit reports generated from your audit data · ' + all.length + ' report' + (all.length === 1 ? '' : 's') + '</p></div>' +
      '<div class="page-head__actions"><button class="btn btn--primary" id="new-report">' + ui.icon('plus', 16) + 'Generate new report</button></div></div>' +
      (all.length ? '<div class="chips" role="tablist">' + [['all', 'All']].concat(Object.keys(STATUS).map(function (k) { return [k, STATUS[k].label]; })).map(function (x) {
          return '<button class="chip' + (listState.status === x[0] ? ' is-active' : '') + '" data-st="' + x[0] + '" role="tab" aria-selected="' + (listState.status === x[0]) + '">' + x[1] + ' <span class="chip__count">' + counts[x[0]] + '</span></button>';
        }).join('') + '</div>' : '') +
      '<section class="card">' +
        (all.length ? '<div class="toolbar"><div class="toolbar__search"><span class="toolbar__search-icon">' + ui.icon('search', 16) + '</span><input class="input" id="rpt-q" type="search" placeholder="Search reports or audits…" value="' + U.esc(listState.q) + '" aria-label="Search reports"></div></div>' : '') +
        '<div id="rpt-rows"></div>' +
      '</section>';

    const host = el.querySelector('#rpt-rows');
    function draw() {
      const t = listState.q.trim().toLowerCase();
      const list = all.filter(function (r) {
        if (listState.status !== 'all' && r.status !== listState.status) return false;
        return !t || [r.title, r.meta.auditTitle, E.TYPES[r.reportType]].join(' ').toLowerCase().indexOf(t) !== -1;
      });
      host.innerHTML = !all.length
        ? ui.emptyState({ icon: 'reports', title: 'No reports yet', text: 'Generate a report from any audit. Background, standards, methodology and results are imported automatically from the audit and its collected data.' }) +
          '<div style="text-align:center;margin:-18px 0 34px"><button class="btn btn--primary btn--sm" id="new-report-2">' + ui.icon('plus', 15) + 'Generate first report</button></div>'
        : list.length ? tableHtml(list) : ui.emptyState({ icon: 'search', title: 'No reports match', text: 'Try another status or search term.' });
      bindTable(host);
      const n2 = host.querySelector('#new-report-2');
      if (n2) n2.addEventListener('click', pickAudit);
    }
    draw();
    el.querySelector('#new-report').addEventListener('click', pickAudit);
    el.querySelectorAll('[data-st]').forEach(function (b) { b.addEventListener('click', function () { listState.status = b.dataset.st; DA.router.refresh(true); }); });
    const qi = el.querySelector('#rpt-q');
    if (qi) qi.addEventListener('input', U.debounce(function () { listState.q = qi.value; draw(); }, 120));
  }

  /* =========================================================
   * New report workflow — #/reports/new?audit=
   * ========================================================= */
  let wiz = null;

  function startWizard(audit, cycleId, q) {
    q = q || {};
    const s = store.getSettings();
    const cyc = C.cycleById(audit, cycleId) || C.currentCycle(audit);
    const snap = E.buildSnapshot(audit, cyc.id);
    const projects = store.projectsForAudit(audit.id);
    const type = E.TYPES[q.type] ? q.type : audit.parentId || audit.cycles.length > 1 ? 'reaudit' : ({ 'Quality Improvement Project': 'qi', 'Service Evaluation': 'service' }[audit.projectType] || 'clinical');
    return {
      auditId: audit.id, step: 1,
      settings: {
        title: (q.project && store.getQiProject(q.project) && type === 'qi' ? store.getQiProject(q.project).title : audit.title) + ' — ' + (type === 'reaudit' ? 'Re-audit Report' : E.TYPES[type].replace(' Report', '') + ' Report'),
        auditTitle: audit.title, department: audit.department, institution: s.organisation, auditLead: audit.auditLead,
        collaborators: DA.model.filled(audit.collaborators, 'name').map(function (c) { return c.name; }).join(', '),
        cycleId: cyc.id, periodFrom: snap.totals.collectedFrom || cyc.collectionStartDate || '', periodTo: snap.totals.collectedTo || cyc.collectionEndDate || '',
        reportDate: U.isoDay(new Date()), reportType: type, length: 'comprehensive',
        qiProjectId: q.project && store.getQiProject(q.project) ? q.project : (projects[0] ? projects[0].id : ''),
        compareFrom: q.from || ''
      },
      sections: E.defaultSelection(type, 'comprehensive')
    };
  }

  function renderNew(el, params) {
    const q = params.query || {};
    const audit = q.audit && store.getAudit(q.audit);
    if (!audit || audit.status === 'draft') {
      el.innerHTML = '<div class="card">' + ui.emptyState({ icon: 'reports', title: audit ? 'This audit is still a draft' : 'Choose an audit', text: audit ? 'Create the audit before generating a report.' : 'Reports are generated for a specific audit.', action: 'Back to reports', href: '#/reports' }) + '</div>';
      return;
    }
    if (!wiz || wiz.auditId !== audit.id || (q.type && wiz.fromQuery !== JSON.stringify(q))) { wiz = startWizard(audit, q.cycle, q); wiz.fromQuery = JSON.stringify(q); }
    const st = wiz.settings;
    const steps = ['Report settings', 'Content', 'Generate'];

    el.innerHTML = '<a class="back-link" href="#/audits/' + audit.id + '?tab=reports">' + ui.icon('chevronLeft', 15) + U.esc(audit.title) + '</a>' +
      '<div class="page-head"><div><h2 class="page-head__title">Generate new report</h2><p class="page-head__sub">Information is imported from the audit protocol and collected data — nothing needs re-entering.</p></div></div>' +
      '<div class="rw">' +
        '<ol class="rw-steps">' + steps.map(function (t, i) {
          const n = i + 1, state = n < wiz.step ? 'done' : n === wiz.step ? 'current' : 'todo';
          return '<li class="rw-step rw-step--' + state + '"><button type="button" data-step="' + n + '"' + (n > wiz.step ? ' disabled' : '') + '><span class="rw-step__n">' + (state === 'done' ? ui.icon('check', 12) : n) + '</span>' + t + '</button></li>';
        }).join('') + '</ol>' +
        '<section class="card rw-card"><form id="rw-form" novalidate>' + [null, stepSettings, stepContent, stepGenerate][wiz.step](audit) + '</form></section>' +
      '</div>';

    const form = el.querySelector('#rw-form');
    form.addEventListener('input', function (e) { const t = e.target; if (t.name && st.hasOwnProperty(t.name) && t.type !== 'radio') st[t.name] = t.value; });
    form.addEventListener('change', function (e) {
      const t = e.target;
      if (t.name === 'reportType') {
        st.reportType = t.value;
        wiz.sections = E.defaultSelection(t.value, t.value === 'summary' ? 'summary' : st.length);
        if (t.value === 'summary') { st.length = 'summary'; wiz.sections = E.defaultSelection('summary', 'summary'); }
        DA.router.refresh(true);
      } else if (t.name === 'length') {
        st.length = t.value; wiz.sections = E.defaultSelection(st.reportType, t.value); DA.router.refresh(true);
      } else if (t.name === 'cycleId') {
        st.cycleId = t.value;
        const snap = E.buildSnapshot(audit, t.value);
        const cyc = C.cycleById(audit, t.value);
        st.periodFrom = snap.totals.collectedFrom || cyc.collectionStartDate || '';
        st.periodTo = snap.totals.collectedTo || cyc.collectionEndDate || '';
        DA.router.refresh(true);
      } else if (t.dataset.sec) {
        const k = t.dataset.sec;
        wiz.sections = wiz.sections.filter(function (x) { return x !== k; });
        if (t.checked) wiz.sections.push(k);
      } else if (t.name && st.hasOwnProperty(t.name)) st[t.name] = t.value;
    });
    el.querySelectorAll('[data-step]').forEach(function (b) { b.addEventListener('click', function () { wiz.step = Number(b.dataset.step); DA.router.refresh(true); }); });
    el.querySelectorAll('[data-preset]').forEach(function (b) {
      b.addEventListener('click', function () { wiz.sections = b.dataset.preset === 'all' ? E.SECTIONS.filter(function (x) { return !x.qi || E.isQiType(st.reportType); }).map(function (x) { return x.key; }) : E.defaultSelection(st.reportType, 'summary'); DA.router.refresh(true); });
    });
    const next = el.querySelector('[data-next]');
    if (next) next.addEventListener('click', function () {
      if (wiz.step === 1) {
        const errs = [];
        form.querySelectorAll('.field').forEach(function (f) { f.classList.remove('has-error'); });
        ['title', 'auditTitle', 'reportDate'].forEach(function (k) {
          if (!String(st[k] || '').trim()) { errs.push(k); form.querySelector('[name="' + k + '"]').closest('.field').classList.add('has-error'); }
        });
        if (st.periodFrom && st.periodTo && st.periodTo < st.periodFrom) { errs.push('period'); form.querySelector('[name="periodTo"]').closest('.field').classList.add('has-error'); }
        if (errs.length) { ui.toast('Please complete the highlighted fields', 'error'); return; }
      }
      wiz.step++;
      DA.router.refresh(true);
      document.getElementById('main').scrollTop = 0;
    });
    const back = el.querySelector('[data-back]');
    if (back) back.addEventListener('click', function () { wiz.step--; DA.router.refresh(true); });
    const gen = el.querySelector('[data-generate]');
    if (gen) gen.addEventListener('click', function () { generate(el, audit, gen); });
  }

  function field(name, label, control, hint, err) {
    return '<label class="field"><span class="field__label">' + label + '</span>' + control + (hint ? '<span class="field__hint">' + hint + '</span>' : '') + '<span class="field__error">' + (err || 'Required.') + '</span></label>';
  }
  function inp(name, type, extra) { return '<input class="input" name="' + name + '" type="' + (type || 'text') + '" value="' + U.esc(wiz.settings[name] || '') + '"' + (extra || '') + '>'; }

  function stepSettings(audit) {
    const st = wiz.settings;
    const types = Object.keys(E.TYPES).map(function (k) {
      const desc = { clinical: 'Measures practice against agreed standards', qi: 'Reports a change and its effect', service: 'Describes current service delivery', reaudit: 'Compares cycles after change', summary: 'One-page style overview' }[k];
      return '<label class="radio-card' + (st.reportType === k ? ' is-checked' : '') + '"><input type="radio" name="reportType" value="' + k + '"' + (st.reportType === k ? ' checked' : '') + '><span class="radio-card__title">' + E.TYPES[k] + '</span><span class="radio-card__desc">' + desc + '</span></label>';
    }).join('');
    return '<div class="rw-body">' +
      '<div class="intro"><div><h2 class="intro__title">Report settings</h2><p class="intro__text">Pre-filled from the audit. Adjust anything that should read differently on the report.</p></div></div>' +
      '<div class="stack">' +
        field('title', 'Report title *', inp('title')) +
        '<div class="grid-2">' + field('auditTitle', 'Audit title *', inp('auditTitle')) + field('department', 'Department', inp('department')) + '</div>' +
        '<div class="grid-2">' + field('institution', 'Institution', inp('institution')) + field('auditLead', 'Audit lead', inp('auditLead')) + '</div>' +
        field('collaborators', 'Collaborating clinicians', inp('collaborators', 'text', ' placeholder="Separate names with commas"')) +
        '<div class="grid-3">' +
          field('cycleId', 'Audit cycle', '<select class="select" name="cycleId">' + audit.cycles.map(function (c) { return '<option value="' + c.id + '"' + (c.id === st.cycleId ? ' selected' : '') + '>' + U.esc(c.label) + ' · ' + c.records.filter(function (r) { return r.status === 'completed'; }).length + ' completed cases</option>'; }).join('') + '</select>') +
          field('periodFrom', 'Reporting period from', inp('periodFrom', 'date')) +
          field('periodTo', 'to', inp('periodTo', 'date'), null, 'End must be after start.') +
        '</div>' +
        '<div class="grid-2">' + field('reportDate', 'Report date *', inp('reportDate', 'date')) +
          field('length', 'Report length', '<div class="seg rw-seg"><label class="seg__btn' + (st.length === 'comprehensive' ? ' is-active' : '') + '"><input class="sr-only" type="radio" name="length" value="comprehensive"' + (st.length === 'comprehensive' ? ' checked' : '') + '>Comprehensive</label><label class="seg__btn' + (st.length === 'summary' ? ' is-active' : '') + '"><input class="sr-only" type="radio" name="length" value="summary"' + (st.length === 'summary' ? ' checked' : '') + '>Short summary</label></div>') + '</div>' +
        '<div class="field"><span class="field__label">Report type</span><div class="radio-cards radio-cards--5">' + types + '</div></div>' +
        (E.isQiType(st.reportType) ? qiFields(audit, st) : '') +
      '</div></div>' +
      '<div class="wiz__foot"><a class="btn btn--ghost" href="#/audits/' + audit.id + '?tab=reports">Cancel</a><span class="wiz__pos">Step 1 of 3</span><button type="button" class="btn btn--primary" data-next>Continue' + ui.icon('chevronRight', 15) + '</button></div>';
  }

  /** Improvement project and comparison cycle for QI / re-audit reports. */
  function qiFields(audit, st) {
    const projects = store.projectsForAudit(audit.id);
    const ser = DA.qi.series(audit);
    const toKey = audit.id + ':' + st.cycleId;
    const earlier = ser.slice(0, Math.max(0, ser.findIndex(function (r) { return r.key === toKey; })));
    return '<div class="grid-2 rw-qi">' +
      field('qiProjectId', 'Improvement project', '<select class="select" name="qiProjectId"><option value="">None — comparison only</option>' + projects.map(function (p) { return '<option value="' + p.id + '"' + (p.id === st.qiProjectId ? ' selected' : '') + '>' + U.esc(p.title) + '</option>'; }).join('') + '</select>',
        projects.length ? 'Interventions, PDSA cycles and the baseline are imported from this project.' : 'No improvement project is linked to this audit. <a href="#/qi/new?audit=' + audit.id + '">Create one</a> to include interventions and PDSA cycles.') +
      field('compareFrom', 'Compare with (baseline cycle)', earlier.length ? '<select class="select" name="compareFrom"><option value="">Automatic (project baseline or previous cycle)</option>' + earlier.map(function (r) { return '<option value="' + r.key + '"' + (r.key === st.compareFrom ? ' selected' : '') + '>' + U.esc(r.label) + (r.sameAudit ? '' : ' · ' + U.esc(r.audit.title)) + '</option>'; }).join('') + '</select>' : '<p class="muted small">No earlier cycle before the selected cycle. Choose a later cycle above to compare.</p>') +
    '</div>';
  }

  function stepContent(audit) {
    const DESC = {
      title: 'Report title, setting, team, cycle and date', executive: 'Background, aim, method, cases, key findings and recommendations',
      background: 'Imported from the audit protocol', aims: 'Imported aim and objectives', standards: 'Criteria, references, targets and actual compliance',
      methodology: 'Design, sampling, inclusion/exclusion, dates and data sources', results: 'Calculated results, tables and charts',
      discussion: 'Observed findings and clearly labelled possible explanations', recommendations: 'Linked to specific findings',
      actionplan: 'Structured improvement actions', limitations: 'Supported by the recorded design and data', conclusion: 'Whether standards were achieved',
      reaudit: 'Timing and approach of the next cycle', references: 'From audit criteria, plus your own', appendices: 'Data collection form and calculation method'
    };
    Object.assign(DESC, DA.qiReport ? DA.qiReport.DESC : {});
    const showQi = E.isQiType(wiz.settings.reportType);
    const list = E.SECTIONS.filter(function (s) { return showQi || !s.qi; });
    return '<div class="rw-body">' +
      '<div class="intro"><div><h2 class="intro__title">Report content</h2><p class="intro__text">Choose the sections to include. Excluded sections can be switched back on in the editor.</p></div>' +
        '<div class="intro__actions"><button type="button" class="btn btn--ghost btn--sm" data-preset="summary">Summary set</button><button type="button" class="btn btn--ghost btn--sm" data-preset="all">Select all</button></div></div>' +
      '<div class="sec-pick">' + list.map(function (s, i) {
        const on = wiz.sections.indexOf(s.key) !== -1;
        return '<label class="sec-pick__item' + (s.required ? ' is-required' : '') + (s.qi ? ' is-qi' : '') + '"><input type="checkbox" data-sec="' + s.key + '"' + (on ? ' checked' : '') + (s.required ? ' checked disabled' : '') + '>' +
          '<span class="sec-pick__box">' + ui.icon('check', 12) + '</span><span class="sec-pick__n">' + (i + 1) + '</span>' +
          '<span class="sec-pick__text"><strong>' + s.title + (s.qi ? ' <span class="badge badge--violet">QI</span>' : '') + '</strong><span>' + DESC[s.key] + '</span></span></label>';
      }).join('') + '</div></div>' +
      '<div class="wiz__foot"><button type="button" class="btn btn--secondary" data-back>' + ui.icon('chevronLeft', 15) + 'Back</button><span class="wiz__pos">Step 2 of 3</span><button type="button" class="btn btn--primary" data-next>Continue' + ui.icon('chevronRight', 15) + '</button></div>';
  }

  function stepGenerate(audit) {
    const st = wiz.settings;
    const snap = E.buildSnapshot(audit, st.cycleId, E.isQiType(st.reportType) ? { projectId: st.qiProjectId || null, compareFrom: st.compareFrom || null } : null);
    const t = snap.totals;
    const qi = snap.qi;
    const prevNeeded = st.reportType === 'reaudit' && !(qi && qi.comparison);
    const warn = [];
    if (!t.completed) warn.push('There are no completed cases in this cycle yet, so the results sections will state that compliance cannot be reported.');
    if (t.drafts) warn.push(t.drafts + ' incomplete record' + (t.drafts === 1 ? ' is' : 's are') + ' excluded from the results.');
    if (snap.overall.noData) warn.push(snap.overall.noData + ' criteri' + (snap.overall.noData === 1 ? 'on has' : 'a have') + ' no scored cases.');
    if (prevNeeded) warn.push('A re-audit report normally compares cycles, but no previous cycle exists for this audit.');
    if (!audit.background) warn.push('No background was recorded in the audit protocol — the section will contain a placeholder.');
    return '<div class="rw-body">' +
      '<div class="intro"><div><h2 class="intro__title">Generate report</h2><p class="intro__text">The report will be compiled from the audit database and a snapshot of the current results will be frozen with it.</p></div></div>' +
      '<div class="gen-grid">' +
        '<div class="gen-stat"><span>Completed cases</span><strong>' + t.completed + '<small> / ' + t.targetSample + ' target</small></strong></div>' +
        '<div class="gen-stat"><span>Criteria</span><strong>' + snap.criteria.length + '<small> · ' + snap.overall.achieved + ' achieved</small></strong></div>' +
        '<div class="gen-stat"><span>Overall compliance</span><strong>' + E.pctShort(snap.overall.compliance) + '</strong></div>' +
        '<div class="gen-stat"><span>Sections</span><strong>' + wiz.sections.length + '<small> of ' + E.SECTIONS.length + '</small></strong></div>' +
      '</div>' +
      '<ul class="gen-list">' +
        '<li>' + ui.icon('check', 14) + 'Background, aim, objectives and methodology imported from the audit protocol</li>' +
        '<li>' + ui.icon('check', 14) + 'Standards table with ' + snap.criteria.length + ' criteria, references and targets</li>' +
        '<li>' + ui.icon('check', 14) + 'Results from the analytics engine: ' + t.completed + ' completed of ' + t.records + ' records' + (snap.numeric.length ? ', ' + snap.numeric.length + ' numerical' : '') + (snap.categorical.length ? ', ' + snap.categorical.length + ' categorical variable' + (snap.categorical.length === 1 ? '' : 's') : '') + (snap.previous ? ', comparison with ' + U.esc(snap.previous.cycleLabel) : '') + '</li>' +
        (qi ? '<li>' + ui.icon('check', 14) + (qi.comparison ? 'Cycle comparison: ' + U.esc(qi.comparison.aLabel) + ' (' + qi.comparison.a.completed + ' cases) → ' + U.esc(qi.comparison.bLabel) + ' (' + qi.comparison.b.completed + ' cases), ' + DA.qi.fmtPP(qi.comparison.overall.pp) + ' overall' : 'No earlier cycle to compare with') + '</li>' +
          (qi.project ? '<li>' + ui.icon('check', 14) + 'Improvement project “' + U.esc(qi.project.title) + '”: ' + qi.interventions.length + ' intervention' + (qi.interventions.length === 1 ? '' : 's') + ', ' + qi.pdsa.length + ' PDSA cycle' + (qi.pdsa.length === 1 ? '' : 's') + '</li>' : '') +
          (qi.comparison && qi.comparison.warnings.some(function (w) { return w.level === 'warn'; }) ? '<li class="is-warn">' + ui.icon('alert', 14) + 'Comparability flags will be shown in the report</li>' : '') : '') +
        '<li>' + ui.icon('check', 14) + E.findings(snap).below.length + ' suggested action' + (E.findings(snap).below.length === 1 ? '' : 's') + ' for criteria below target (each needs your approval)</li>' +
      '</ul>' +
      (warn.length ? '<div class="alert alert--info">' + ui.icon('alert', 16) + '<div><strong>Before you generate</strong><ul>' + warn.map(function (w) { return '<li>' + U.esc(w) + '</li>'; }).join('') + '</ul></div></div>' : '') +
      '<p class="muted small">Text is drafted from your recorded data using fixed templates — no AI is used, and no figures are estimated. You can edit every section afterwards.</p>' +
      '</div>' +
      '<div class="wiz__foot"><button type="button" class="btn btn--secondary" data-back>' + ui.icon('chevronLeft', 15) + 'Back</button><span class="wiz__pos">Step 3 of 3</span><button type="button" class="btn btn--primary" data-generate>' + ui.icon('reports', 15) + 'Generate report</button></div>';
  }

  function generate(el, audit, btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Compiling report…';
    setTimeout(function () {
      const st = wiz.settings;
      const report = E.newReport(audit, {
        title: st.title.trim(), reportType: st.reportType, length: st.length, cycleId: st.cycleId,
        qiProjectId: E.isQiType(st.reportType) ? st.qiProjectId || null : null, compareFrom: E.isQiType(st.reportType) ? st.compareFrom || null : null,
        sections: wiz.sections.concat(['title']),
        meta: {
          auditTitle: st.auditTitle.trim(), department: st.department.trim(), institution: st.institution.trim(), auditLead: st.auditLead.trim(),
          collaborators: st.collaborators.split(',').map(function (x) { return x.trim(); }).filter(Boolean),
          periodFrom: st.periodFrom, periodTo: st.periodTo, reportDate: st.reportDate
        }
      });
      store.createReport(report);
      wiz = null;
      ui.toast('Report generated — revision 1', 'success');
      location.hash = '#/reports/' + report.id;
    }, 350);
  }

  return {
    nav: 'reports',
    title: function () { return 'Reports'; },
    crumbs: function () { return [{ label: 'Insight' }, { label: 'Reports' }]; },
    render: renderList,
    tableHtml: tableHtml, bindTable: bindTable, statusBadge: statusBadge, STATUS: STATUS, pickAudit: pickAudit,
    create: {
      nav: 'reports',
      keepOnStoreChange: true,
      title: function () { return 'Generate New Report'; },
      crumbs: function (p) {
        const a = p.query && store.getAudit(p.query.audit);
        return [{ label: 'Insight' }, { label: 'Reports', href: '#/reports' }].concat(a ? [{ label: a.title, href: '#/audits/' + a.id + '?tab=reports' }] : []).concat([{ label: 'New report' }]);
      },
      render: renderNew
    }
  };
})();
