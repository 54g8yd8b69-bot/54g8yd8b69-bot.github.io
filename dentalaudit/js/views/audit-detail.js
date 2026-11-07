/* DentalAudit — single audit: results, stage, action plan, cases */
DA.views.auditDetail = (function () {
  const U = DA.utils, ui = DA.ui, M = DA.metrics, store = DA.store;
  let showAllCases = false;
  let lastId = null;

  /** CSS bar with target marker — used for criterion results. */
  function criterionBar(r) {
    const v = r.compliance === null ? 0 : r.compliance;
    const rag = M.rag(r.compliance, r.target);
    return '<div class="crit">' +
      '<div class="crit__head"><span class="crit__text">' + U.esc(r.criterion.name) +
        (r.criterion.reference ? '<span class="crit__ref">' + U.esc(r.criterion.reference) + '</span>' : '') + '</span>' + ui.compliancePill(r.compliance, r.target) + '</div>' +
      '<div class="crit__track" aria-hidden="true"><span class="crit__fill crit__fill--' + rag + '" style="width:' + v + '%"></span>' +
        '<span class="crit__target" style="left:' + r.target + '%"></span></div>' +
      '<div class="crit__meta"><span>' + r.met + ' met · ' + r.notMet + ' not met' + (r.na ? ' · ' + r.na + ' N/A' : '') + '</span><span>Target ' + r.target + '%</span></div>' +
    '</div>';
  }

  function stepper(audit) {
    const cur = M.statusMeta(audit.status).order;
    return '<ol class="stepper" aria-label="Audit stage">' + M.STATUS_KEYS.map(function (k) {
      const m = M.STATUS[k];
      const st = m.order < cur ? 'done' : m.order === cur ? 'current' : 'todo';
      return '<li class="stepper__item stepper__item--' + st + '"><button type="button" data-stage="' + k + '" ' + (st === 'current' ? 'aria-current="step"' : '') + ' title="Move to ' + m.label + '">' +
        '<span class="stepper__dot">' + (st === 'done' ? ui.icon('check', 12) : m.order) + '</span><span class="stepper__label">' + m.label + '</span></button></li>';
    }).join('') + '</ol>';
  }

  function cycleCompare(audit) {
    const pair = DA.qi.defaultPair(audit);
    if (!pair) return '';
    const cmp = DA.qi.compare(pair.a, pair.b);
    if (!cmp) return '';
    const rows = cmp.rows.map(function (r) {
      const d = r.pp;
      return '<tr class="' + (r.excluded ? 'is-excluded' : '') + '"><td>' + U.esc(r.name) + (r.level === 'warn' ? ' <span class="badge badge--amber" title="Definition or scoring changed between cycles">' + ui.icon('alert', 10) + 'check</span>' : '') + '</td><td class="cell-num">' + DA.qi.fmtPct(r.a ? r.a.compliance : null, 0) + '</td><td class="cell-num">' + DA.qi.fmtPct(r.b ? r.b.compliance : null, 0) + '</td>' +
        '<td class="cell-num">' + (d === null ? '—' : '<span class="delta ' + (d >= 0 ? 'delta--up' : 'delta--down') + '">' + (d >= 0 ? '▲ ' : '▼ ') + DA.qi.fmtPP(d) + '</span>') + '</td></tr>';
    }).join('');
    return '<section class="card">' +
      '<div class="card__head"><div><h3 class="card__title">Audit cycle comparison</h3><p class="card__sub">' + U.esc(cmp.a.label) + ' (' + cmp.a.completed + ' cases) vs ' + U.esc(cmp.b.label) + ' (' + cmp.b.completed + ' cases) — absolute change in percentage points</p></div>' +
      '<a class="card__link" href="#/compare/' + audit.id + '">Full comparison' + ui.icon('chevronRight', 14) + '</a></div>' +
      (cmp.warnings.some(function (w) { return w.level === 'warn'; }) ? '<p class="cmp-mini-warn">' + ui.icon('alert', 13) + 'Comparability flags — review before drawing conclusions.</p>' : '') +
      '<div class="card__body card__body--flush"><div class="table-wrap"><table class="table table--compact"><thead><tr><th>Criterion</th><th class="cell-num">' + U.esc(cmp.a.label) + '</th><th class="cell-num">' + U.esc(cmp.b.label) + '</th><th class="cell-num">Change</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>' +
    '</section>';
  }

  function actionsCard(audit) {
    const acts = audit.actions || [];
    const done = acts.filter(function (a) { return a.done; }).length;
    return '<section class="card">' +
      '<div class="card__head"><div><h3 class="card__title">Action plan</h3><p class="card__sub">' + (acts.length ? done + ' of ' + acts.length + ' complete' : 'Changes agreed to improve compliance') + '</p></div></div>' +
      '<div class="card__body">' +
        (acts.length ? '<ul class="actions">' + acts.map(function (a) {
          const overdue = !a.done && a.due && U.daysUntil(a.due) < 0;
          return '<li class="actions__item' + (a.done ? ' is-done' : '') + '">' +
            '<label class="check"><input type="checkbox" data-toggle="' + a.id + '"' + (a.done ? ' checked' : '') + '><span class="check__box">' + ui.icon('check', 12) + '</span></label>' +
            '<div class="actions__body"><div class="actions__text">' + U.esc(a.text) + '</div>' +
            '<div class="actions__meta">' + (a.owner ? U.esc(a.owner) : 'Unassigned') + (a.due ? ' · <span class="' + (overdue ? 'text-critical' : '') + '">' + (overdue ? 'Overdue — ' : 'Due ') + U.fmtDate(a.due) + '</span>' : '') + '</div></div>' +
            '<button class="icon-btn icon-btn--sm icon-btn--danger" data-del-action="' + a.id + '" aria-label="Delete action">' + ui.icon('trash', 15) + '</button>' +
          '</li>';
        }).join('') + '</ul>' : '<p class="muted small" style="margin-bottom:12px">No actions yet. Add the changes you will make before re-auditing.</p>') +
        '<form class="action-form" id="action-form">' +
          '<input class="input" name="text" placeholder="New action, e.g. update notes template" required aria-label="Action">' +
          '<input class="input" name="owner" placeholder="Owner" aria-label="Owner">' +
          '<input class="input" name="due" type="date" aria-label="Due date">' +
          '<button class="btn btn--secondary" type="submit">' + ui.icon('plus', 15) + 'Add</button>' +
        '</form>' +
      '</div></section>';
  }

  /** Data collection section: form status, progress, entry points and recent cases. */
  function dataCollectionCard(audit) {
    const C = DA.collection;
    const cyc = C.currentCycle(audit);
    const form = cyc && cyc.form;
    const recs = cyc ? cyc.records : [];
    const done = recs.filter(function (r) { return r.status === 'completed'; }).length;
    const linked = form ? form.fields.filter(function (f) { return f.linkedCriterionId; }).map(function (f) { return f.linkedCriterionId; }) : [];
    const critCovered = audit.criteria.filter(function (c) { return linked.indexOf(c.id) !== -1; }).length;
    const can = C.canCollect(audit);
    const hasForm = C.hasForm(audit);
    const recent = recs.slice().sort(function (x, y) { return new Date(y.updatedAt) - new Date(x.updatedAt); }).slice(0, 5);
    return '<section class="card dcard">' +
      '<div class="card__head"><div><h3 class="card__title">Data collection</h3><p class="card__sub">' + U.esc(cyc ? cyc.label : '') + ' · ' + (form ? 'form v' + form.version : 'no form yet') + '</p></div>' +
        DA.views.dataCollection.collectionBadge(audit) + '</div>' +
      '<div class="card__body">' +
        '<div class="dcard__stats">' +
          '<div><span class="dcard__num num">' + (form ? form.fields.length : 0) + '</span><span class="dcard__lab">form fields</span></div>' +
          '<div><span class="dcard__num num">' + critCovered + '<small>/' + audit.criteria.length + '</small></span><span class="dcard__lab">criteria linked</span></div>' +
          '<div><span class="dcard__num num">' + done + '<small>/' + audit.targetSampleSize + '</small></span><span class="dcard__lab">cases completed</span></div>' +
          '<div><span class="dcard__num num">' + (recs.length - done) + '</span><span class="dcard__lab">incomplete</span></div>' +
        '</div>' +
        ui.progressBar(M.progress(audit), 'Completed cases against target sample') +
        (form && critCovered < audit.criteria.length ? '<p class="dcard__warn">' + ui.icon('alert', 13) + (audit.criteria.length - critCovered) + ' criteri' + (audit.criteria.length - critCovered === 1 ? 'on has' : 'a have') + ' no linked field, so ' + (audit.criteria.length - critCovered === 1 ? 'it' : 'they') + ' can’t be scored.</p>' : '') +
        '<div class="dcard__actions">' +
          (can || form ? '<a class="btn btn--secondary btn--sm" href="#/collect/' + audit.id + '/form">' + ui.icon('fChecks', 15) + (can ? 'Design collection form' : 'View form') + '</a>' : '') +
          (can ? (hasForm ? '<a class="btn btn--primary btn--sm" href="#/collect/' + audit.id + '/new">' + ui.icon('plus', 15) + 'Add new case</a>'
                          : '<span class="btn btn--primary btn--sm" aria-disabled="true" title="Design the form first">' + ui.icon('plus', 15) + 'Add new case</span>') : '') +
          '<a class="btn btn--ghost btn--sm" href="#/collect/' + audit.id + '">' + ui.icon('fList', 15) + 'View collected data</a>' +
        '</div>' +
        (recent.length ? '<ul class="mini-list dcard__recent">' + recent.map(function (r) {
          return '<li><a class="mono cell-title" href="#/collect/' + audit.id + '/case/' + r.id + '">' + U.esc(r.caseReference) + '</a><span class="muted small">' + U.fmtDate(r.collectionDate) + '</span>' +
            '<span class="small" style="margin-left:auto">' + (r.status === 'completed' ? '<span class="badge badge--green">Completed</span>' : '<span class="badge badge--amber">Incomplete</span>') + '</span></li>';
        }).join('') + '</ul>' : '') +
      '</div></section>';
  }

  /** Protocol summary: everything captured by the Create/Edit Audit wizard. */
  function protocolCard(audit) {
    const Mo = DA.model;
    const list = function (items, key) {
      const f = Mo.filled(items, key || 'text');
      return f.length ? '<ul class="plain-list">' + f.map(function (x) { return '<li>' + U.esc(x[key || 'text']) + '</li>'; }).join('') + '</ul>' : '<span class="muted">—</span>';
    };
    const row = function (label, html) { return '<dt>' + label + '</dt><dd>' + html + '</dd>'; };
    const txt = function (v) { return v ? U.esc(v) : '<span class="muted">—</span>'; };
    const refs = Mo.references(audit);
    return '<section class="card"><div class="card__head"><h3 class="card__title">Audit protocol</h3>' +
        '<a class="card__link" href="#/create/' + audit.id + '">Edit' + ui.icon('chevronRight', 14) + '</a></div>' +
      '<div class="card__body">' +
        '<div class="proto-tags"><span class="badge">' + U.esc(audit.projectType || 'Clinical Audit') + '</span>' + (audit.specialty ? '<span class="badge badge--blue">' + U.esc(audit.specialty) + '</span>' : '') + '</div>' +
        '<dl class="facts">' +
          row('Lead', txt(audit.auditLead)) +
          (Mo.filled(audit.collaborators, 'name').length ? row('Collaborators', list(audit.collaborators, 'name')) : '') +
          row('Timeline', U.fmtDate(audit.startDate) + ' → ' + U.fmtDate(audit.targetCompletionDate)) +
          (audit.completedAt ? row('Completed', U.fmtDate(audit.completedAt)) : '') +
          (audit.parentId && store.getAudit(audit.parentId) ? row('Previous cycle', '<a href="#/audits/' + audit.parentId + '">Cycle ' + (audit.cycle - 1) + '</a>') : '') +
        '</dl>' +
        '<details class="proto" open><summary>Aims</summary><dl class="facts">' +
          (audit.auditQuestion ? row('Question', txt(audit.auditQuestion)) : '') +
          row('Background', txt(audit.background)) +
          row('Aim', txt(audit.aim)) +
          row('Objectives', list(audit.objectives)) +
        '</dl></details>' +
        '<details class="proto"><summary>Standards</summary><dl class="facts">' +
          row('Sources', refs.length ? '<ul class="plain-list">' + refs.map(function (r) { return '<li>' + U.esc(r) + '</li>'; }).join('') + '</ul>' : '<span class="muted">—</span>') +
          row('Criteria', audit.criteria.length + ' (see results)') +
        '</dl></details>' +
        '<details class="proto"><summary>Methodology</summary><dl class="facts">' +
          row('Design', txt(audit.methodology)) +
          row('Sample', audit.targetSampleSize + ' cases · ' + U.esc(Mo.samplingText(audit) || 'method not set')) +
          row('Collection', U.fmtDate(audit.collectionStartDate) + ' → ' + U.fmtDate(audit.collectionEndDate)) +
          row('Sources', txt(Mo.collectionMethodsText(audit).join(', '))) +
          row('Inclusion', list(audit.inclusionCriteria)) +
          row('Exclusion', list(audit.exclusionCriteria)) +
        '</dl></details>' +
      '</div></section>';
  }

  function draftView(el, audit) {
    const Mo = DA.model;
    const errs = Mo.validate(audit);
    const missing = Mo.errorCount(errs);
    el.innerHTML =
      '<a class="back-link" href="#/audits?status=draft">' + ui.icon('chevronLeft', 15) + 'Drafts</a>' +
      '<div class="page-head page-head--detail"><div><div class="detail-badges">' + ui.statusBadge('draft') + '</div>' +
        '<h2 class="page-head__title">' + U.esc(audit.title || 'Untitled draft') + '</h2>' +
        '<p class="page-head__sub">Draft saved ' + U.relTime(audit.updatedAt) + '</p></div>' +
        '<div class="page-head__actions"><button class="icon-btn icon-btn--danger" id="btn-delete" aria-label="Delete draft" title="Delete draft">' + ui.icon('trash', 17) + '</button>' +
        '<a class="btn btn--primary" href="#/create/' + audit.id + '">' + ui.icon('collect', 16) + 'Resume draft</a></div></div>' +
      '<div class="card">' + ui.emptyState({ icon: 'file', title: 'This audit hasn’t been created yet',
        text: missing ? missing + ' required item' + (missing === 1 ? '' : 's') + ' still to complete. Resume the draft to finish planning, then create the audit to start collecting data.' : 'Everything required is complete — resume the draft and press Create Audit.',
        action: 'Resume draft', href: '#/create/' + audit.id }) + '</div>';
    el.querySelector('#btn-delete').addEventListener('click', function () {
      DA.views.audits.confirmDelete(audit, function () { location.hash = '#/audits?status=draft'; });
    });
  }

  function reportsTab(audit, reports) {
    return '<section class="card" id="audit-reports">' +
      '<div class="card__head"><div><h3 class="card__title">Reports</h3>' +
        '<p class="card__sub">Each report is built from a frozen snapshot of this audit’s analytics. Later data changes never alter a saved report until you refresh it.</p></div>' +
        '<a class="btn btn--primary" href="#/reports/new?audit=' + audit.id + '">' + ui.icon('plus', 16) + 'Generate New Report</a></div>' +
      (reports.length
        ? '<div class="card__body card__body--flush">' + DA.views.reports.tableHtml(reports, { hideAudit: true }) + '</div>'
        : ui.emptyState({ icon: 'reports', title: 'No reports yet', text: 'Generate a clinical audit report, QI report, service evaluation, re-audit comparison or short summary from the data already collected — nothing needs to be re-entered.', action: 'Generate New Report', href: '#/reports/new?audit=' + audit.id })) +
      '</section>';
  }

  function render(el, params) {
    const audit = store.getAudit(params.id);
    if (!audit) { DA.views.notFound.render(el); return; }
    if (audit.status === 'draft') { draftView(el, audit); return; }
    const justCreated = params.query && params.query.created === '1';
    if (lastId !== audit.id) { showAllCases = false; lastId = audit.id; }

    const results = M.criterionResults(audit);
    const comp = M.compliance(audit);
    const tgt = M.target(audit);
    const metCount = results.filter(function (r) { return r.compliance !== null && r.compliance >= r.target; }).length;
    const withData = results.filter(function (r) { return r.compliance !== null; }).length;
    const dateLabel = audit.status === 'completed' ? 'Re-audit date' : (audit.status === 'active' || audit.status === 'collecting') ? 'Collection ends' : 'Target completion';
    const date = M.dueDateFor(audit);
    const child = store.getAudits().find(function (a) { return a.parentId === audit.id; });
    const tab = params.query && (params.query.tab === 'reports' || params.query.tab === 'qi') ? params.query.tab : 'overview';
    const reports = store.reportsForAudit(audit.id);

    el.innerHTML =
      '<a class="back-link" href="#/audits">' + ui.icon('chevronLeft', 15) + 'All audits</a>' +
      (justCreated ? '<div class="alert alert--good created-banner" role="status">' + ui.icon('check', 16) +
        '<div><strong>Audit created.</strong> It is now Active as Cycle 1 with ' + audit.criteria.length + ' criteri' + (audit.criteria.length === 1 ? 'on' : 'a') + ' and a target sample of ' + audit.targetSampleSize + ' cases. ' +
        '<a href="#/collect/' + audit.id + '/form">Design the data collection form →</a></div></div>' : '') +
      '<div class="page-head page-head--detail">' +
        '<div style="min-width:0"><div class="detail-badges">' + ui.statusBadge(audit.status) +
          '<span class="badge">Cycle ' + audit.cycle + '</span>' + (M.isReauditDue(audit, 30) ? '<span class="badge badge--amber">' + ui.icon('repeat', 12) + 'Re-audit due</span>' : '') + '</div>' +
          '<h2 class="page-head__title">' + U.esc(audit.title) + '</h2>' +
          '<p class="page-head__sub">' + U.esc(audit.department || '—') + ' · Lead: ' + U.esc(audit.auditLead || '—') + ' · Created ' + U.fmtDate(audit.createdAt) + '</p>' +
          (audit.description ? '<p class="detail-desc">' + U.esc(audit.description) + '</p>' : '') + '</div>' +
        '<div class="page-head__actions">' +
          '<a class="btn btn--ghost" href="#/create/' + audit.id + '">' + ui.icon('collect', 15) + 'Edit audit</a>' +
          (audit.status === 'action' || audit.status === 'analysis' ? '<button class="btn btn--ghost" id="btn-reaudit">' + ui.icon('repeat', 15) + 'Create Cycle ' + ((DA.collection.currentCycle(audit) || { number: 1 }).number + 1) + '</button>' : '') +
          '<a class="btn btn--secondary" href="#/reports/new?audit=' + audit.id + '">' + ui.icon('reports', 16) + 'New report</a>' +
          (audit.status === 'completed'
            ? (child ? '<a class="btn btn--primary" href="#/audits/' + child.id + '">' + ui.icon('repeat', 16) + 'Open cycle ' + child.cycle + '</a>'
                     : '<button class="btn btn--primary" id="btn-reaudit">' + ui.icon('repeat', 16) + 'Create Cycle ' + ((DA.collection.currentCycle(audit) || { number: 1 }).number + 1) + '</button>')
            : '<a class="btn btn--primary" href="#/collect/' + audit.id + (DA.collection.hasForm(audit) ? '/new' : '/form') + '">' + ui.icon('collect', 16) + (DA.collection.hasForm(audit) ? 'Add case' : 'Design form') + '</a>') +
          '<button class="icon-btn icon-btn--danger" id="btn-delete" aria-label="Delete audit" title="Delete audit">' + ui.icon('trash', 17) + '</button>' +
        '</div>' +
      '</div>' +

      '<section class="card stepper-card">' + stepper(audit) + '</section>' +

      '<nav class="detail-tabs" role="tablist" aria-label="Audit sections">' +
        '<a role="tab" class="detail-tab' + (tab === 'overview' ? ' is-active' : '') + '" aria-selected="' + (tab === 'overview') + '" href="#/audits/' + audit.id + '">' + ui.icon('dashboard', 15) + 'Overview</a>' +
        '<a role="tab" class="detail-tab' + (tab === 'qi' ? ' is-active' : '') + '" aria-selected="' + (tab === 'qi') + '" href="#/audits/' + audit.id + '?tab=qi" data-tab="qi">' + ui.icon('qi', 15) + 'Quality Improvement <span class="detail-tab__n">' + store.projectsForAudit(audit.id).length + '</span></a>' +
        '<a role="tab" class="detail-tab' + (tab === 'reports' ? ' is-active' : '') + '" aria-selected="' + (tab === 'reports') + '" href="#/audits/' + audit.id + '?tab=reports" data-tab="reports">' + ui.icon('reports', 15) + 'Reports <span class="detail-tab__n">' + reports.length + '</span></a>' +
      '</nav>' +
      (tab === 'reports' ? reportsTab(audit, reports) : tab === 'qi' ? DA.views.qi.auditTab(audit) : overviewHtml());
    function overviewHtml() { return '' +
      '<section class="metrics metrics--detail">' +
        '<div class="card metric"><div class="metric__top"><span class="metric__label">Overall compliance</span></div>' +
          '<div class="metric__value">' + (comp === null ? '—' : Math.round(comp) + '<small>%</small>') + '</div>' +
          '<div class="metric__foot">' + (comp === null ? 'No data yet' : ui.compliancePill(comp, tgt) + ' target ' + Math.round(tgt) + '%') + '</div></div>' +
        '<div class="card metric"><div class="metric__top"><span class="metric__label">Cases collected</span></div>' +
          '<div class="metric__value">' + DA.collection.completedRecords(audit).length + '<small>/' + audit.targetSampleSize + '</small></div>' +
          '<div class="metric__foot" style="width:100%">' + ui.progressBar(M.progress(audit), 'Sample progress') + '</div></div>' +
        '<div class="card metric"><div class="metric__top"><span class="metric__label">Criteria meeting target</span></div>' +
          '<div class="metric__value">' + metCount + '<small>/' + results.length + '</small></div>' +
          '<div class="metric__foot">' + (withData ? (results.length - metCount) + ' need improvement' : 'Awaiting data') + '</div></div>' +
        '<div class="card metric"><div class="metric__top"><span class="metric__label">' + dateLabel + '</span></div>' +
          '<div class="metric__value metric__value--sm">' + (date ? U.fmtDate(date) : '—') + '</div>' +
          '<div class="metric__foot">' + (date ? U.dueLabel(date) : 'Not set') + '</div></div>' +
      '</section>' +

      '<div class="detail-grid">' +
        '<div class="stack">' +
          '<section class="card"><div class="card__head"><div><h3 class="card__title">Results by criterion</h3><p class="card__sub">Compliance = met ÷ (met + not met). N/A excluded. Navy line marks the target.</p></div></div>' +
            '<div class="card__body">' + (results.length ? results.map(criterionBar).join('') : '<p class="muted">No criteria defined.</p>') + '</div></section>' +
          cycleCompare(audit) +
          dataCollectionCard(audit) +
        '</div>' +
        '<div class="stack">' +
          protocolCard(audit) +
          actionsCard(audit) +
        '</div>' +
      '</div>';
    }

    if (tab === 'reports') DA.views.reports.bindTable(el.querySelector('#audit-reports'));
    if (tab === 'qi') { DA.views.qi.bindRows(el); DA.views.qi.bindCycles(el, audit); }

    // --- events
    el.querySelectorAll('[data-stage]').forEach(function (b) {
      b.addEventListener('click', function () {
        const k = b.dataset.stage;
        if (k === audit.status) return;
        store.setStatus(audit.id, k);
        ui.toast('Moved to ' + M.statusMeta(k).label, 'success');
      });
    });
    el.querySelector('#btn-delete').addEventListener('click', function () {
      DA.views.audits.confirmDelete(audit, function () { location.hash = '#/audits'; });
    });
    const re = el.querySelector('#btn-reaudit');
    if (re) re.addEventListener('click', function () { DA.views.compare.createCycleModal(audit); });
    el.querySelectorAll('[data-toggle]').forEach(function (cb) {
      cb.addEventListener('change', function () { store.toggleAction(audit.id, cb.dataset.toggle); });
    });
    el.querySelectorAll('[data-del-action]').forEach(function (b) {
      b.addEventListener('click', function () { store.deleteAction(audit.id, b.dataset.delAction); ui.toast('Action removed', 'success'); });
    });
    const af = el.querySelector('#action-form');
    if (af) af.addEventListener('submit', function (e) {
      e.preventDefault();
      const f = e.target.elements;
      const text = f.text.value.trim();
      if (!text) { f.text.focus(); return; }
      store.addAction(audit.id, text, f.owner.value.trim(), f.due.value);
      ui.toast('Action added', 'success');
    });
  }

  return {
    nav: 'audits',
    title: function (p) { const a = store.getAudit(p.id); return a ? 'Audit overview' : 'Audit not found'; },
    crumbs: function (p) {
      const a = store.getAudit(p.id);
      return [{ label: 'Workspace', href: '#/dashboard' }, { label: 'My Audits', href: '#/audits' }, { label: a ? a.title : 'Not found' }];
    },
    render: render
  };
})();
