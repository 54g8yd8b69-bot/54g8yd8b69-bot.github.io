/* DentalAudit — Quality Improvement: landing (#/qi), new project (#/qi/new), project workspace (#/qi/:id) */
DA.views.qi = (function () {
  const U = DA.utils, ui = DA.ui, store = DA.store, Q = DA.qi, C = DA.collection;
  const esc = U.esc;

  /* ---------- Shared bits ---------- */
  function badge(meta, extra) { return '<span class="badge badge--' + (meta.tone === 'neutral' ? 'x' : meta.tone) + '"' + (extra || '') + '>' + esc(meta.label) + '</span>'; }
  function ivBadge(iv) { const s = Q.ivStatus(iv); return '<span class="badge badge--' + (s.tone === 'neutral' ? 'x' : s.tone) + '">' + (s.key === 'overdue' ? ui.icon('alert', 11) : '') + esc(s.label) + '</span>'; }
  function dateOr(d) { return d ? U.fmtDate(d) : '—'; }
  function auditOf(p) { return p.auditId ? store.getAudit(p.auditId) : null; }
  function critName(p, id) {
    if (!id) return '—';
    const b = p.baseline && p.baseline.rows.find(function (r) { return r.criterionId === id; });
    if (b) return b.name;
    const a = auditOf(p);
    const c = a && a.criteria.find(function (x) { return x.id === id; });
    return c ? c.name : '—';
  }
  function critOptions(p, sel) {
    const a = auditOf(p);
    const list = a ? a.criteria.map(function (c) { return { id: c.id, name: c.name, target: c.target }; }) : [];
    return '<option value="">Not linked to a criterion</option>' + list.map(function (c, i) {
      const b = p.baseline && p.baseline.rows.find(function (r) { return r.criterionId === c.id; });
      return '<option value="' + c.id + '"' + (c.id === sel ? ' selected' : '') + '>' + (i + 1) + '. ' + esc(c.name) + (b ? ' (' + Q.fmtPct(b.compliance, 0) + ' vs ' + c.target + '%)' : '') + '</option>';
    }).join('');
  }

  /* =========================================================
   * Landing page
   * ========================================================= */
  let landingFilter = 'all';

  function renderLanding(el) {
    const projects = store.getQiProjects();
    const ivs = store.getInterventions();
    const awaiting = Q.awaitingIntervention();
    const overdue = ivs.filter(Q.isOverdue);
    const due = Q.reauditsDue();
    const active = projects.filter(function (p) { return p.status === 'active'; });
    const completed = projects.filter(function (p) { return p.status === 'completed'; });
    const inProg = ivs.filter(function (i) { return i.status === 'in_progress'; });
    const filters = { all: projects, active: active, completed: completed, on_hold: projects.filter(function (p) { return p.status === 'on_hold'; }) };
    const shown = filters[landingFilter] || projects;

    const kpi = function (key, label, n, icon, tone, sub) {
      return '<a class="card qi-kpi' + (tone ? ' qi-kpi--' + tone : '') + '" href="#qi-' + key + '" data-jump="' + key + '"><span class="qi-kpi__icon">' + ui.icon(icon, 17) + '</span><span class="qi-kpi__n">' + n + '</span><span class="qi-kpi__l">' + label + '</span>' + (sub ? '<span class="qi-kpi__s">' + sub + '</span>' : '') + '</a>';
    };

    el.innerHTML =
      '<div class="page-head"><div><h2 class="page-head__title">Quality Improvement</h2><p class="page-head__sub">Turn audit findings into interventions, test them with PDSA cycles and re-audit to measure change.</p></div>' +
        '<div class="page-head__actions"><a class="btn btn--primary" href="#/qi/new">' + ui.icon('plus', 16) + 'New improvement project</a></div></div>' +
      '<section class="qi-kpis">' +
        kpi('projects', 'Active projects', active.length, 'target', 'blue') +
        kpi('awaiting', 'Audits awaiting intervention', awaiting.length, 'flag', awaiting.length ? 'amber' : '') +
        kpi('inprogress', 'Interventions in progress', inProg.length, 'activity', '') +
        kpi('overdue', 'Overdue actions', overdue.length, 'alert', overdue.length ? 'red' : '') +
        kpi('due', 'Re-audits due', due.length, 'repeat', due.length ? 'amber' : '', 'next 30 days') +
        kpi('projects', 'Completed projects', completed.length, 'check', 'green') +
      '</section>' +

      '<section class="card" id="qi-projects"><div class="card__head"><div><h3 class="card__title">Improvement projects</h3><p class="card__sub">' + projects.length + ' project' + (projects.length === 1 ? '' : 's') + '</p></div>' +
        (projects.length ? '<div class="chips" role="tablist">' + [['all', 'All'], ['active', 'Active'], ['on_hold', 'On hold'], ['completed', 'Completed']].map(function (x) {
          return '<button class="chip' + (landingFilter === x[0] ? ' is-active' : '') + '" data-filter="' + x[0] + '">' + x[1] + ' <span class="chip__count">' + filters[x[0]].length + '</span></button>';
        }).join('') + '</div>' : '') + '</div>' +
        (projects.length ? (shown.length ? projectTable(shown) : '<div class="card__body"><p class="muted">No projects with this status.</p></div>')
          : ui.emptyState({ icon: 'target', title: 'No improvement projects yet', text: 'Create a project from an audit with criteria below target. Baseline results, targets and report recommendations are imported automatically.', action: 'New improvement project', href: '#/qi/new' })) +
      '</section>' +

      '<div class="qi-cols">' +
        '<section class="card" id="qi-awaiting"><div class="card__head"><div><h3 class="card__title">Audits awaiting intervention</h3><p class="card__sub">Criteria below target and no interventions planned yet</p></div></div>' +
          (awaiting.length ? '<ul class="qi-list">' + awaiting.map(function (a) {
            const s = Q.series(a).filter(function (r) { return r.audit.id === a.id && r.cycle.records.some(function (x) { return x.status === 'completed'; }); });
            const res = Q.cycleResults(s[s.length - 1]);
            const below = res.rows.filter(function (r) { return r.achieved === false; });
            return '<li><div class="qi-list__body"><a class="qi-list__t" href="#/audits/' + a.id + '?tab=qi">' + esc(a.title) + '</a><span class="qi-list__s">' + esc(res.label) + ' · ' + below.length + ' of ' + res.rows.length + ' criteria below target' + (below[0] ? ' · lowest: ' + esc(below.sort(function (x, y) { return y.gap - x.gap; })[0].name) + ' ' + Q.fmtPct(below[0].compliance, 0) : '') + '</span></div>' +
              '<a class="btn btn--secondary btn--sm" href="#/qi/new?audit=' + a.id + '">' + ui.icon('plus', 14) + 'Create project</a></li>';
          }).join('') + '</ul>' : '<div class="card__body"><p class="muted small">No audits are waiting — every audit with a shortfall has interventions planned.</p></div>') +
        '</section>' +
        '<section class="card" id="qi-overdue"><div class="card__head"><div><h3 class="card__title">Overdue actions</h3><p class="card__sub">Interventions past their target date</p></div></div>' +
          (overdue.length ? '<ul class="qi-list">' + overdue.map(function (i) {
            const p = store.getQiProject(i.projectId);
            return '<li class="is-overdue"><div class="qi-list__body"><a class="qi-list__t" href="#/qi/' + i.projectId + '?tab=interventions&iv=' + i.id + '">' + esc(i.title) + '</a><span class="qi-list__s">' + esc(p ? p.title : '') + ' · ' + esc(i.responsiblePerson || 'unassigned') + ' · due ' + U.fmtDate(i.targetDate) + ' (' + Math.abs(U.daysUntil(i.targetDate)) + ' days ago)</span></div>' + ivBadge(i) + '</li>';
          }).join('') + '</ul>' : '<div class="card__body"><p class="muted small">Nothing overdue.</p></div>') +
          '<div class="qi-sub" id="qi-inprogress"><h4>Interventions in progress</h4>' + (inProg.length ? '<ul class="qi-list qi-list--tight">' + inProg.map(function (i) {
            return '<li><div class="qi-list__body"><a class="qi-list__t" href="#/qi/' + i.projectId + '?tab=interventions&iv=' + i.id + '">' + esc(i.title) + '</a><span class="qi-list__s">' + esc(i.responsiblePerson || '—') + ' · target ' + dateOr(i.targetDate) + '</span></div></li>';
          }).join('') + '</ul>' : '<p class="muted small">None in progress.</p>') + '</div>' +
        '</section>' +
        '<section class="card" id="qi-due"><div class="card__head"><div><h3 class="card__title">Re-audits due</h3><p class="card__sub">Completed audits with a re-audit date within 30 days</p></div></div>' +
          (due.length ? '<ul class="qi-list">' + due.map(function (a) {
            return '<li><div class="qi-list__body"><a class="qi-list__t" href="#/audits/' + a.id + '?tab=qi">' + esc(a.title) + '</a><span class="qi-list__s">' + U.dueLabel(a.reauditDate) + ' · ' + U.fmtDate(a.reauditDate) + '</span></div>' +
              '<button class="btn btn--secondary btn--sm" data-new-cycle="' + a.id + '">' + ui.icon('repeat', 14) + 'Create cycle ' + ((C.currentCycle(a) || { number: 1 }).number + 1) + '</button></li>';
          }).join('') + '</ul>' : '<div class="card__body"><p class="muted small">No re-audits due in the next 30 days.</p></div>') +
        '</section>' +
      '</div>';

    el.querySelectorAll('[data-filter]').forEach(function (b) { b.addEventListener('click', function () { landingFilter = b.dataset.filter; DA.router.refresh(true); }); });
    el.querySelectorAll('[data-jump]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); const t = el.querySelector('#qi-' + a.dataset.jump); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    });
    el.querySelectorAll('[data-new-cycle]').forEach(function (b) { b.addEventListener('click', function () { DA.views.compare.createCycleModal(store.getAudit(b.dataset.newCycle)); }); });
    bindRows(el);
  }

  function projectTable(list, opts) {
    const o = opts || {};
    return '<div class="table-wrap"><table class="table table--compact qi-table"><thead><tr><th>Project</th>' + (o.hideAudit ? '' : '<th class="hide-sm">Associated audit</th>') + '<th>Current cycle</th><th class="cell-num">Interventions</th><th>Status</th><th class="hide-sm">Next review</th><th class="hide-md">Last updated</th></tr></thead><tbody>' +
      list.map(function (p) {
        const a = auditOf(p);
        const ivs = Q.interventionsFor(p.id);
        const od = ivs.filter(Q.isOverdue).length;
        const cur = a ? C.currentCycle(a) : null;
        const nr = Q.nextReview(p);
        return '<tr class="is-link" tabindex="0" data-href="#/qi/' + p.id + '"><td style="min-width:220px"><div class="cell-title">' + esc(p.title) + '</div><div class="cell-sub">' + badge(Q.PRIORITY[p.priority] || Q.PRIORITY.medium) + ' ' + esc(p.projectLead || '') + '</div></td>' +
          (o.hideAudit ? '' : '<td class="hide-sm"><span class="rpt-audit">' + (a ? esc(a.title) : '<span class="muted">' + (p.unlinkedAuditTitle ? esc(p.unlinkedAuditTitle) + ' (deleted)' : 'Independent project') + '</span>') + '</span></td>') +
          '<td class="nowrap">' + (cur ? esc(cur.label) + (cur.status === 'completed' ? '' : ' · <span class="muted small">' + esc(DA.metrics.statusMeta(a.status).label) + '</span>') : '—') + '</td>' +
          '<td class="cell-num">' + ivs.length + (od ? ' <span class="badge badge--red">' + od + ' overdue</span>' : '') + '</td>' +
          '<td>' + badge(Q.projectStatusMeta(p)) + '</td>' +
          '<td class="hide-sm nowrap">' + (nr ? U.fmtDate(nr) + (nr < U.isoDay(new Date()) ? ' <span class="badge badge--red">past</span>' : '') : '—') + '</td>' +
          '<td class="hide-md muted small nowrap">' + U.relTime(Q.projectUpdatedAt(p)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function bindRows(host) {
    host.querySelectorAll('tr[data-href]').forEach(function (tr) {
      tr.addEventListener('click', function (e) { if (!e.target.closest('a, button, input, select, label')) location.hash = tr.dataset.href; });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target === tr) location.hash = tr.dataset.href; });
    });
  }

  /* =========================================================
   * New project
   * ========================================================= */
  let draft = null;

  function cyclesWithData(audit) {
    return Q.series(audit).filter(function (r) { return r.cycle.records.some(function (x) { return x.status === 'completed'; }); });
  }

  function renderNew(el, params) {
    const q = params.query || {};
    const audits = store.getAudits().filter(function (a) { return a.status !== 'draft'; });
    if (!draft || (q.audit && draft.auditId !== q.audit && !draft.touched)) {
      const a = q.audit ? store.getAudit(q.audit) : null;
      const cyc = a ? cyclesWithData(a) : [];
      draft = {
        auditId: a ? a.id : '', baselineRefKey: cyc.length ? cyc.filter(function (r) { return r.audit.id === a.id; }).concat(cyc).slice(-1)[0].key : '',
        title: a ? 'Improving ' + a.title.charAt(0).toLowerCase() + a.title.slice(1) : '', description: '', aim: '',
        projectLead: a ? a.auditLead : store.getSettings().userName, collaborators: a ? DA.model.filled(a.collaborators, 'name').map(function (c) { return c.name; }).join(', ') : '',
        startDate: U.isoDay(new Date()), targetCompletionDate: U.isoDay(U.addDays(new Date(), 180)), reviewDate: U.isoDay(U.addDays(new Date(), 60)), priority: 'medium', importActions: {}, touched: false
      };
      if (a) {
        const b = draft.baselineRefKey ? Q.baselineFrom(draft.baselineRefKey) : null;
        const worst = b ? b.rows.filter(function (r) { return r.achieved === false; }).sort(function (x, y) { return y.gap - x.gap; })[0] : null;
        draft.aim = worst ? 'Increase ' + worst.name.charAt(0).toLowerCase() + worst.name.slice(1) + ' from ' + Q.fmtPct(worst.compliance, 0) + ' to ' + worst.target + '% by ' + U.fmtDate(draft.targetCompletionDate) + '.' : '';
      }
    }
    const a = draft.auditId ? store.getAudit(draft.auditId) : null;
    const cyc = a ? cyclesWithData(a) : [];
    const base = a && draft.baselineRefKey ? Q.baselineFrom(draft.baselineRefKey) : null;
    const reports = a ? store.reportsForAudit(a.id) : [];
    const latest = reports[0];
    const recs = latest ? latest.actionPlan.filter(function (x) { return x.approved && !store.linkedIntervention(latest.id, x.id); }) : [];
    const inp = function (name, type, extra) { return '<input class="input" name="' + name + '" type="' + (type || 'text') + '" value="' + esc(draft[name] || '') + '"' + (extra || '') + '>'; };
    const field = function (name, label, control, hint, req) { return '<label class="field" data-f="' + name + '"><span class="field__label">' + label + (req ? ' <span class="req">*</span>' : '') + '</span>' + control + (hint ? '<span class="field__hint">' + hint + '</span>' : '') + '<span class="field__error">Required.</span></label>'; };

    el.innerHTML = '<a class="back-link" href="' + (a ? '#/audits/' + a.id + '?tab=qi' : '#/qi') + '">' + ui.icon('chevronLeft', 15) + (a ? esc(a.title) : 'Quality Improvement') + '</a>' +
      '<div class="page-head"><div><h2 class="page-head__title">New improvement project</h2><p class="page-head__sub">Link an audit to import its baseline results, targets, findings and report recommendations automatically.</p></div></div>' +
      '<form id="qn" class="qn" novalidate><div class="qn-grid">' +
        '<section class="card qn-card"><div class="card__head"><div><h3 class="card__title">1. Associated audit</h3><p class="card__sub">Optional — projects can also be created independently</p></div></div><div class="card__body stack">' +
          field('auditId', 'Audit', '<select class="select" name="auditId"><option value="">Independent project (no linked audit)</option>' + audits.map(function (x) { return '<option value="' + x.id + '"' + (x.id === draft.auditId ? ' selected' : '') + '>' + esc(x.title) + (x.cycle > 1 ? ' (cycle ' + x.cycle + ')' : '') + '</option>'; }).join('') + '</select>') +
          (a ? field('baselineRefKey', 'Baseline audit cycle', cyc.length ? '<select class="select" name="baselineRefKey">' + cyc.map(function (r) { return '<option value="' + r.key + '"' + (r.key === draft.baselineRefKey ? ' selected' : '') + '>' + esc(r.label) + ' · ' + r.cycle.records.filter(function (x) { return x.status === 'completed'; }).length + ' completed cases' + (r.audit.id !== a.id ? ' · ' + esc(r.audit.title) : '') + '</option>'; }).join('') + '</select>' : '<p class="muted small">This audit has no completed cases yet, so there is no baseline to import. You can still create the project and import the baseline later.</p>') : '') +
          (a ? importedHtml(a, base, latest, recs) : '<p class="muted small qn-indep">' + ui.icon('fAlign', 14) + 'An independent project has no baseline results. You can link an audit later from the project’s settings.</p>') +
        '</div></section>' +
        '<section class="card qn-card"><div class="card__head"><div><h3 class="card__title">2. Project details</h3></div></div><div class="card__body stack">' +
          field('title', 'Project title', inp('title'), '', true) +
          field('description', 'Project description', '<textarea class="textarea" name="description" rows="2">' + esc(draft.description) + '</textarea>') +
          field('aim', 'Improvement aim', '<textarea class="textarea" name="aim" rows="2" placeholder="What will improve, by how much, by when?">' + esc(draft.aim) + '</textarea>', 'A SMART aim, e.g. “Increase documented implant crown torque from 75% to 100% by March”.', true) +
          '<div class="grid-2">' + field('projectLead', 'Project lead', inp('projectLead'), '', true) + field('priority', 'Project priority', '<select class="select" name="priority">' + Object.keys(Q.PRIORITY).map(function (k) { return '<option value="' + k + '"' + (k === draft.priority ? ' selected' : '') + '>' + Q.PRIORITY[k].label + '</option>'; }).join('') + '</select>', 'Your judgement — not set automatically.') + '</div>' +
          field('collaborators', 'Collaborating clinicians', inp('collaborators'), 'Separate names with commas.') +
          '<div class="grid-3">' + field('startDate', 'Start date', inp('startDate', 'date'), '', true) + field('targetCompletionDate', 'Target completion', inp('targetCompletionDate', 'date')) + field('reviewDate', 'Review date', inp('reviewDate', 'date')) + '</div>' +
        '</div></section>' +
      '</div>' +
      '<div class="wiz__foot"><a class="btn btn--ghost" href="#/qi">Cancel</a><span class="wiz__pos"></span><button class="btn btn--primary" type="submit">' + ui.icon('check', 15) + 'Create project</button></div></form>';

    const form = el.querySelector('#qn');
    form.addEventListener('input', function (e) { const t = e.target; if (t.name && t.name in draft && t.type !== 'checkbox') { draft[t.name] = t.value; draft.touched = true; } });
    form.addEventListener('change', function (e) {
      const t = e.target;
      if (t.name === 'auditId') {
        const na = t.value ? store.getAudit(t.value) : null;
        const nc = na ? cyclesWithData(na) : [];
        draft.auditId = t.value; draft.baselineRefKey = nc.length ? nc[nc.length - 1].key : ''; draft.importActions = {};
        if (na && !draft.touchedTitle) draft.title = 'Improving ' + na.title.charAt(0).toLowerCase() + na.title.slice(1);
        if (na) { draft.projectLead = draft.projectLead || na.auditLead; }
        draft.touched = true;
        DA.router.refresh(true);
      } else if (t.name === 'baselineRefKey') { draft.baselineRefKey = t.value; DA.router.refresh(true); }
      else if (t.dataset.importAct) { draft.importActions[t.dataset.importAct] = t.checked; }
      if (t.name === 'title') draft.touchedTitle = true;
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      form.querySelectorAll('.field').forEach(function (f) { f.classList.remove('has-error'); });
      const bad = ['title', 'aim', 'projectLead', 'startDate'].filter(function (k) { return !String(draft[k] || '').trim(); });
      if (draft.targetCompletionDate && draft.startDate && draft.targetCompletionDate < draft.startDate) bad.push('targetCompletionDate');
      bad.forEach(function (k) { const f = form.querySelector('[data-f="' + k + '"]'); if (f) { f.classList.add('has-error'); if (k === 'targetCompletionDate') f.querySelector('.field__error').textContent = 'Must be after the start date.'; } });
      if (bad.length) { ui.toast('Please complete the highlighted fields', 'error'); return; }
      const imports = Object.keys(draft.importActions).filter(function (k) { return draft.importActions[k]; }).map(function (k) { const p = k.split('|'); return { reportId: p[0], actionId: p[1] }; });
      const p = store.createQiProject(Object.assign({}, draft, { importActions: imports }));
      draft = null;
      ui.toast('Improvement project created' + (imports.length ? ' with ' + imports.length + ' intervention' + (imports.length === 1 ? '' : 's') + ' from the report action plan' : ''), 'success');
      location.hash = '#/qi/' + p.id + (p.baseline ? '?tab=baseline' : '');
    });
  }

  function importedHtml(a, base, latest, recs) {
    return '<div class="qn-import"><h4>' + ui.icon('download', 14) + 'Imported from the audit</h4>' +
      '<dl class="qn-dl"><div><dt>Audit</dt><dd>' + esc(a.title) + '</dd></div><div><dt>Specialty</dt><dd>' + esc(a.specialty || '—') + '</dd></div><div><dt>Department</dt><dd>' + esc(a.department || '—') + '</dd></div><div><dt>Audit lead</dt><dd>' + esc(a.auditLead || '—') + '</dd></div>' +
      '<div><dt>Sample size</dt><dd>' + (base ? base.completed + ' completed of ' + (a.targetSampleSize || '—') + ' target' : '—') + '</dd></div><div><dt>Baseline compliance</dt><dd>' + (base ? Q.fmtPct(base.overall.compliance) + ' (' + base.overall.met + '/' + base.overall.applicable + ')' : '—') + '</dd></div></dl>' +
      (base ? '<table class="qn-crit"><thead><tr><th>Criterion</th><th>Target</th><th>Baseline</th></tr></thead><tbody>' + base.rows.map(function (r) {
        return '<tr class="' + (r.achieved === false ? 'is-below' : '') + '"><td>' + esc(r.name) + '</td><td>' + r.target + '%</td><td><strong>' + Q.fmtPct(r.compliance, 0) + '</strong> <span class="muted small">' + r.met + '/' + r.denominator + '</span></td></tr>';
      }).join('') + '</tbody></table>' : '') +
      (base ? '<p class="qn-find"><strong>Key findings:</strong> ' + (base.rows.some(function (r) { return r.achieved === false; }) ? base.rows.filter(function (r) { return r.achieved === false; }).map(function (r) { return esc(r.name) + ' ' + Q.fmtPct(r.compliance, 0) + ' vs ' + r.target + '%'; }).join('; ') : 'all criteria met their target') + '.</p>' : '') +
      (latest ? '<div class="qn-recs"><p><strong>Report recommendations</strong> from “' + esc(latest.title) + '” — tick to convert into interventions:</p>' +
        (recs.length ? recs.map(function (x) {
          const k = latest.id + '|' + x.id;
          return '<label class="qn-rec"><input type="checkbox" data-import-act="' + k + '"' + (draft.importActions[k] ? ' checked' : '') + '><span><strong>' + esc(x.intervention) + '</strong><span class="muted small">' + esc(x.issue) + ' · ' + esc(x.successMeasure || '') + '</span></span></label>';
        }).join('') : '<p class="muted small">No approved actions left to convert (already linked or none approved).</p>') + '</div>' : '<p class="muted small">No report has been generated for this audit yet.</p>') +
    '</div>';
  }

  /* =========================================================
   * Project workspace
   * ========================================================= */
  const TABS = [['overview', 'Dashboard', 'dashboard'], ['baseline', 'Baseline results', 'analytics'], ['interventions', 'Interventions', 'flag'], ['suggestions', 'Suggestions', 'fStar'], ['pdsa', 'PDSA cycles', 'repeat'], ['cycles', 'Re-audit & comparison', 'activity'], ['timeline', 'Timeline', 'calendar']];

  function renderProject(el, params) {
    const p = store.getQiProject(params.id);
    if (!p) { DA.views.notFound.render(el); return; }
    const q = params.query || {};
    const tab = TABS.some(function (t) { return t[0] === q.tab; }) ? q.tab : 'overview';
    const a = auditOf(p);
    const ivs = Q.interventionsFor(p.id);
    const sugs = Q.suggestionsFor(p).filter(function (s) { return !s.decision; });
    el.innerHTML =
      '<a class="back-link" href="#/qi">' + ui.icon('chevronLeft', 15) + 'Quality Improvement</a>' +
      '<div class="page-head page-head--detail"><div style="min-width:0"><div class="detail-badges">' + badge(Q.projectStatusMeta(p)) + badge(Q.PRIORITY[p.priority] || Q.PRIORITY.medium, ' title="Priority set by the project team"') + (a ? '<a class="badge" href="#/audits/' + a.id + '?tab=qi">' + ui.icon('audits', 11) + esc(a.title) + '</a>' : '<span class="badge">Independent project</span>') + '</div>' +
        '<h2 class="page-head__title">' + esc(p.title) + '</h2>' +
        '<p class="page-head__sub">Lead: ' + esc(p.projectLead || '—') + (p.collaborators.length ? ' · with ' + esc(p.collaborators.join(', ')) : '') + ' · started ' + dateOr(p.startDate) + '</p>' +
        (p.aim ? '<p class="qi-aim">' + ui.icon('target', 14) + '<span><strong>Aim:</strong> ' + esc(p.aim) + '</span></p>' : '') + '</div>' +
        '<div class="page-head__actions"><button class="btn btn--ghost" data-act="edit-project">' + ui.icon('collect', 15) + 'Edit project</button>' +
          (a ? '<a class="btn btn--secondary" href="#/reports/new?audit=' + a.id + '&type=qi&project=' + p.id + '">' + ui.icon('reports', 15) + 'QI report</a>' : '') +
          '<button class="btn btn--primary" data-act="add-iv">' + ui.icon('plus', 15) + 'Add intervention</button>' +
          '<button class="icon-btn icon-btn--danger" data-act="delete-project" aria-label="Delete project" title="Delete project">' + ui.icon('trash', 17) + '</button></div></div>' +
      '<nav class="detail-tabs qi-tabs" role="tablist">' + TABS.map(function (t) {
        const n = t[0] === 'interventions' ? ivs.length : t[0] === 'pdsa' ? Q.pdsaFor(p.id).length : t[0] === 'suggestions' ? sugs.length : null;
        return '<a role="tab" class="detail-tab' + (tab === t[0] ? ' is-active' : '') + '" aria-selected="' + (tab === t[0]) + '" href="#/qi/' + p.id + (t[0] === 'overview' ? '' : '?tab=' + t[0]) + '">' + ui.icon(t[2], 15) + t[1] + (n !== null ? ' <span class="detail-tab__n">' + n + '</span>' : '') + '</a>';
      }).join('') + '</nav>' +
      '<div id="qi-tab"></div>';
    const host = el.querySelector('#qi-tab');
    ({ overview: tabOverview, baseline: tabBaseline, interventions: tabInterventions, suggestions: tabSuggestions, pdsa: tabPdsa, cycles: tabCycles, timeline: tabTimeline })[tab](host, p, q);
    el.querySelector('[data-act=add-iv]').addEventListener('click', function () { editIntervention(p, null); });
    el.querySelector('[data-act=edit-project]').addEventListener('click', function () { editProject(p); });
    el.querySelector('[data-act=delete-project]').addEventListener('click', function () {
      ui.confirm({
        title: 'Delete improvement project?', danger: true, confirmLabel: 'Delete project',
        message: '“' + p.title + '”, its ' + ivs.length + ' intervention' + (ivs.length === 1 ? '' : 's') + ' and ' + Q.pdsaFor(p.id).length + ' PDSA cycle' + (Q.pdsaFor(p.id).length === 1 ? '' : 's') + ' will be permanently deleted. The audit, its cycles, case records and reports are not affected.',
        onConfirm: function () { store.deleteQiProject(p.id); ui.toast('Project deleted', 'success'); location.hash = '#/qi'; }
      });
    });
    bindRows(el);
  }

  /* ---------- Dashboard tab ---------- */
  function tabOverview(host, p) {
    const d = Q.dashboard(p);
    const ivs = Q.interventionsFor(p.id);
    const ms = Q.milestones(p).filter(function (m) { return !m.done && m.date >= U.isoDay(U.addDays(new Date(), -1)) || m.kind === 'overdue'; }).slice(0, 8);
    const k = function (label, value, sub, tone) { return '<div class="card cmp-kpi' + (tone ? ' cmp-kpi--' + tone : '') + '"><span class="cmp-kpi__l">' + label + '</span><strong class="cmp-kpi__v">' + value + '</strong><span class="cmp-kpi__s">' + (sub || '') + '</span></div>'; };
    host.innerHTML =
      '<section class="cmp-kpis qi-dash-kpis">' +
        k('Project status', esc(Q.projectStatusMeta(p).label), 'priority ' + esc((Q.PRIORITY[p.priority] || {}).label || '')) +
        k('Baseline compliance', Q.fmtPct(d.baseline), p.baseline ? esc(p.baseline.cycleLabel) + ' · ' + p.baseline.completed + ' cases' : 'no baseline imported') +
        k('Latest compliance', Q.fmtPct(d.latest), d.latestLabel ? esc(d.latestLabel) : 'no re-audit data yet') +
        k('Overall change', Q.fmtPP(d.pp), d.comparison ? 'percentage points · ' + d.comparison.included + ' criteria' : 'needs re-audit data', d.pp === null ? '' : d.pp >= 0 ? 'up' : 'down') +
        k('Active interventions', String(d.active), d.overdue ? '<b class="txt-red">' + d.overdue + ' overdue</b>' : 'none overdue', d.overdue ? 'warn' : '') +
        k('Completed interventions', String(d.completed), 'of ' + d.total) +
        k('Next re-audit', d.nextReaudit ? U.fmtDate(d.nextReaudit) : '—', d.nextReaudit ? U.dueLabel(d.nextReaudit) : 'not scheduled') +
      '</section>' +
      (d.comparison && d.comparison.warnings.some(function (w) { return w.level === 'warn'; }) ? '<div class="cmp-warn is-strong">' + ui.icon('alert', 18) + '<div><strong>Comparability</strong><ul>' + d.comparison.warnings.filter(function (w) { return w.level === 'warn'; }).map(function (w) { return '<li>' + esc(w.text) + '</li>'; }).join('') + '</ul><a class="link-btn" href="#/compare/' + p.auditId + '?a=' + encodeURIComponent(d.comparison.keyA) + '&b=' + encodeURIComponent(d.comparison.keyB) + '">Review in the cycle comparison</a></div></div>' : '') +
      '<div class="qi-dash">' +
        '<section class="card qi-span2"><div class="card__head"><div><h3 class="card__title">A. Improvement progress</h3><p class="card__sub">Overall compliance per cycle (all criteria) and each targeted criterion; dashed line is the mean target</p></div>' + (p.auditId && d.series.length > 1 ? '<a class="card__link" href="#/compare/' + p.auditId + '">Compare cycles' + ui.icon('chevronRight', 14) + '</a>' : '') + '</div>' +
          '<div class="card__body">' + (d.series.some(function (s) { return s.completed; }) ? '<div class="chart-box" style="height:270px"><canvas id="qi-prog" role="img" aria-label="Improvement progress"></canvas></div>' : '<p class="muted">No cycle results yet.</p>') + '</div></section>' +
        '<section class="card"><div class="card__head"><div><h3 class="card__title">E. Key findings</h3><p class="card__sub">' + (d.belowLabel ? 'Criteria still below target in ' + esc(d.belowLabel) : 'Criteria below target') + '</p></div></div><div class="card__body">' +
          (d.belowTarget.length ? '<ul class="qi-find">' + d.belowTarget.map(function (r) { return '<li><span class="qi-find__n">' + esc(r.name) + '</span><span class="qi-find__v"><strong>' + Q.fmtPct(r.compliance, 0) + '</strong> vs ' + r.target + '%</span><span class="muted small">' + r.met + '/' + r.denominator + ' compliant · gap ' + Q.round(r.target - r.compliance, 1) + ' pp</span></li>'; }).join('') + '</ul>'
            : (p.baseline ? '<p class="qi-allmet">' + ui.icon('check', 15) + 'All criteria with data are at or above target.</p>' : '<p class="muted small">Link an audit and import a baseline to see findings.</p>')) +
        '</div></section>' +
        '<section class="card qi-span2"><div class="card__head"><div><h3 class="card__title">B. Intervention tracker</h3><p class="card__sub">' + ivs.length + ' intervention' + (ivs.length === 1 ? '' : 's') + '</p></div><a class="card__link" href="#/qi/' + p.id + '?tab=interventions">Manage' + ui.icon('chevronRight', 14) + '</a></div>' +
          (ivs.length ? '<div class="card__body"><div class="qi-track">' + Object.keys(Q.IV_STATUS).concat(['overdue']).map(function (s) {
              const n = s === 'overdue' ? d.overdue : ivs.filter(function (i) { return i.status === s && !(Q.isOverdue(i)); }).length;
              const m = s === 'overdue' ? { label: 'Overdue', tone: 'red' } : Q.IV_STATUS[s];
              return n ? '<span class="qi-track__seg qi-track__seg--' + m.tone + '" style="flex:' + n + '" title="' + m.label + ': ' + n + '">' + n + '</span>' : '';
            }).join('') + '</div><ul class="qi-ivmini">' + ivs.map(function (i) {
              return '<li><a href="#/qi/' + p.id + '?tab=interventions&iv=' + i.id + '">' + esc(i.title) + '</a><span class="muted small">' + esc(i.responsiblePerson || 'unassigned') + ' · ' + (i.status === 'completed' ? 'completed ' + dateOr(i.completedAt) : 'due ' + dateOr(i.targetDate)) + '</span>' + ivBadge(i) + '</li>';
            }).join('') + '</ul></div>' : ui.emptyState({ icon: 'flag', title: 'No interventions yet', text: 'Add an intervention, or approve one of the suggestions generated from the baseline findings.' })) +
        '</section>' +
        '<section class="card"><div class="card__head"><div><h3 class="card__title">D. Upcoming milestones</h3><p class="card__sub">Deadlines and review dates</p></div></div><div class="card__body">' +
          (ms.length ? '<ul class="qi-ms">' + ms.map(function (m) { return '<li class="qi-ms--' + m.kind + '"><a href="' + m.href + '"><span class="qi-ms__d">' + U.fmtDate(m.date) + '</span><span class="qi-ms__t">' + esc(m.title) + '</span><span class="qi-ms__s">' + U.dueLabel(m.date) + '</span></a></li>'; }).join('') + '</ul>' : '<p class="muted small">No upcoming deadlines.</p>') +
        '</div></section>' +
        '<section class="card qi-span3"><div class="card__head"><div><h3 class="card__title">C. PDSA cycle history</h3><p class="card__sub">' + d.pdsa.length + ' cycle' + (d.pdsa.length === 1 ? '' : 's') + '</p></div><a class="card__link" href="#/qi/' + p.id + '?tab=pdsa">Open PDSA' + ui.icon('chevronRight', 14) + '</a></div><div class="card__body">' + pdsaRail(p, d.pdsa) + '</div></section>' +
      '</div>';
    if (host.querySelector('#qi-prog')) progressChart(host.querySelector('#qi-prog'), p, d);
  }

  function progressChart(canvas, p, d) {
    const c = ui.chartColors();
    const ser = d.series;
    const labels = ser.map(function (s) { return s.label + (p.baseline && s.cycleId === p.baseline.cycleId ? ' (baseline)' : ''); });
    const palette = [c.series2, c.series3, '#8b5cf6', '#0ea5e9', '#f59e0b'];
    const keyOf = p.auditId ? Q.criterionKeyer(store.getAudit(p.auditId)) : function (x) { return x; };
    const targeted = (p.targetCriteria || []).slice(0, 5);
    const sets = [{ label: 'Overall (all criteria)', data: ser.map(function (s) { return Q.round(s.overall.compliance, 1); }), borderColor: c.series1, backgroundColor: c.series1, borderWidth: 3, pointRadius: 5, tension: 0.2, spanGaps: true }];
    targeted.forEach(function (id, i) {
      const k = keyOf(id);
      sets.push({ label: critName(p, id), data: ser.map(function (s) { const r = s.rows.find(function (x) { return x.key === k; }); return r ? Q.round(r.compliance, 1) : null; }), borderColor: palette[i], backgroundColor: palette[i], borderWidth: 2, pointRadius: 4, tension: 0.2, spanGaps: true });
    });
    const tgt = ser.length ? ser[ser.length - 1].rows.reduce(function (s, r) { return s + r.target; }, 0) / Math.max(1, ser[ser.length - 1].rows.length) : null;
    if (tgt) sets.push({ label: 'Mean target', data: ser.map(function () { return Q.round(tgt, 1); }), borderColor: c.navy, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 });
    ui.makeChart(canvas, {
      type: 'line', data: { labels: labels, datasets: sets },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { min: 0, max: 100, grid: { color: c.grid }, border: { display: false }, ticks: { color: c.muted, callback: function (v) { return v + '%'; } } }, x: { grid: { display: false }, ticks: { color: c.text } } },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, color: c.text } }, tooltip: Object.assign(ui.tooltipStyle(), { displayColors: true, callbacks: { label: function (ctx) { return ctx.dataset.label + ': ' + (ctx.parsed.y === null ? '—' : ctx.parsed.y + '%'); } } }) }
      }
    });
  }

  function pdsaRail(p, list) {
    if (!list.length) return '<div class="qi-empty-inline">' + ui.icon('repeat', 18) + '<div><strong>No PDSA cycles yet</strong><span>Test a change on a small scale before rolling it out.</span></div><a class="btn btn--secondary btn--sm" href="#/qi/' + p.id + '/pdsa/new">' + ui.icon('plus', 14) + 'Start PDSA cycle 1</a></div>';
    return '<ol class="pdsa-rail">' + list.map(function (x) {
      const st = Q.pdsaStatus(x);
      const order = Q.PDSA_STAGES;
      const cur = { planning: 0, doing: 1, studying: 2, acting: 3, completed: 4 }[st];
      return '<li class="pdsa-rail__item' + (st === 'completed' ? ' is-done' : '') + '"><a href="#/qi/' + p.id + '/pdsa/' + x.id + '"><span class="pdsa-rail__n">PDSA ' + x.cycleNumber + '</span>' +
        '<span class="pdsa-ring">' + order.map(function (s, i) { return '<span class="pdsa-ring__q pdsa-ring__q--' + s + (i < cur ? ' is-done' : i === cur ? ' is-cur' : '') + '">' + s.charAt(0).toUpperCase() + '</span>'; }).join('') + '</span>' +
        '<span class="pdsa-rail__t">' + esc(x.plan.change || 'Change not yet described') + '</span>' +
        '<span class="pdsa-rail__s">' + esc(Q.PDSA_STATUS[st].label) + (x.act.decision ? ' · ' + esc(Q.ACT_DECISIONS[x.act.decision].label) : '') + ' · ' + dateOr(x.plan.startDate) + '</span></a></li>';
    }).join('') + '</ol>';
  }

  /* ---------- Baseline tab ---------- */
  function tabBaseline(host, p) {
    const a = auditOf(p);
    if (!p.baseline) {
      const cyc = a ? cyclesWithData(a) : [];
      host.innerHTML = '<div class="card">' + ui.emptyState({ icon: 'analytics', title: 'No baseline imported', text: a ? (cyc.length ? 'Import the results of a completed audit cycle to review baseline compliance.' : 'The linked audit has no completed cases yet.') : 'This is an independent project. Link an audit in the project settings to import baseline results.' }) +
        (a && cyc.length ? '<div class="center-actions"><button class="btn btn--primary" data-act="import-base">' + ui.icon('download', 15) + 'Import baseline from ' + esc(cyc[cyc.length - 1].label) + '</button></div>' : '') + '</div>';
      const b = host.querySelector('[data-act=import-base]');
      if (b) b.addEventListener('click', function () { store.refreshBaseline(p.id, cyc[cyc.length - 1].key); ui.toast('Baseline imported', 'success'); });
      return;
    }
    const b = p.baseline;
    const pri = Q.prioritySummary(p);
    const live = Q.ref(b.refKey) ? Q.cycleResults(Q.ref(b.refKey)) : null;
    const drift = live && (live.completed !== b.completed || live.overall.met !== b.overall.met);
    host.innerHTML =
      '<section class="card"><div class="card__head"><div><h3 class="card__title">Baseline results · ' + esc(b.cycleLabel) + '</h3><p class="card__sub">' + b.completed + ' completed cases' + (b.collectedFrom ? ' collected ' + U.fmtDate(b.collectedFrom) + ' – ' + U.fmtDate(b.collectedTo) : '') + ' · imported ' + U.fmtDate(b.capturedAt) + ' from the analytics engine</p></div>' +
        '<button class="btn btn--ghost btn--sm" data-act="reimport">' + ui.icon('refresh', 14) + 'Re-import</button></div>' +
        (drift ? '<div class="alert alert--info alert--sm qi-drift">' + ui.icon('alert', 14) + '<div>The baseline cycle’s data has changed since it was imported (' + b.completed + ' → ' + live.completed + ' completed cases). The figures below are the imported copy; re-import to update them.</div></div>' : '') +
        '<div class="card__body card__body--flush"><div class="table-wrap"><table class="table table--compact qi-base"><thead><tr><th>Criterion</th><th class="cell-num">Target</th><th class="cell-num">Baseline</th><th class="cell-num">Compliant</th><th class="cell-num">Non-compliant</th><th class="cell-num">Eligible (denominator)</th><th class="cell-num">Missing</th><th>Target achieved</th><th class="cell-num">Target for improvement</th></tr></thead><tbody>' +
          b.rows.map(function (r) {
            const on = (p.targetCriteria || []).indexOf(r.criterionId) !== -1;
            return '<tr class="' + (r.achieved === false ? 'is-below' : '') + '"><td><div class="cell-title">' + esc(r.name) + '</div>' + (r.description ? '<div class="cell-sub">' + esc(r.description) + '</div>' : '') + '</td>' +
              '<td class="cell-num">' + r.target + '%</td><td class="cell-num"><strong>' + Q.fmtPct(r.compliance) + '</strong></td><td class="cell-num">' + r.met + '</td><td class="cell-num">' + r.notMet + '</td><td class="cell-num">' + r.denominator + (r.na ? '<span class="muted small"> (' + r.na + ' N/A)</span>' : '') + '</td><td class="cell-num">' + r.missing + '</td>' +
              '<td>' + (r.achieved === null ? '<span class="badge">No data</span>' : r.achieved ? '<span class="badge badge--green">' + ui.icon('check', 11) + 'Achieved</span>' : '<span class="badge badge--red">Not achieved</span>') + '</td>' +
              '<td class="cell-num"><label class="switch switch--sm"><input type="checkbox" data-target-crit="' + r.criterionId + '"' + (on ? ' checked' : '') + '><span class="switch__track"><span class="switch__thumb"></span></span></label></td></tr>';
          }).join('') + '</tbody></table></div></div></section>' +

      '<section class="card"><div class="card__head"><div><h3 class="card__title">Improvement priority summary</h3><p class="card__sub">Ordered by the gap to target, then the number of non-compliant cases. Clinical importance is your judgement — DentalAudit does not rank findings by seriousness.</p></div></div>' +
        '<div class="card__body card__body--flush"><div class="table-wrap"><table class="table table--compact qi-pri"><thead><tr><th>#</th><th>Criterion</th><th class="cell-num">Gap to target</th><th class="cell-num">Non-compliant cases</th><th>Clinical importance (your notes)</th><th>Improvement priority</th></tr></thead><tbody>' +
          pri.map(function (r, i) {
            return '<tr class="' + (r.targeted ? '' : 'is-muted') + '"><td class="muted">' + (i + 1) + '</td><td><div class="cell-title">' + esc(r.name) + '</div><div class="cell-sub">' + (r.targeted ? 'Targeted for improvement' : 'Not targeted') + '</div></td>' +
              '<td class="cell-num">' + (r.gap === null ? '—' : r.gap > 0 ? '<strong class="txt-red">' + Q.round(r.gap, 1) + ' pp</strong>' : '<span class="txt-green">met</span>') + '</td><td class="cell-num">' + r.notMet + '</td>' +
              '<td><input class="input input--sm" data-clin="' + r.criterionId + '" value="' + esc(r.clinicalNote) + '" placeholder="e.g. affects screw loosening follow-up" aria-label="Clinical importance"></td>' +
              '<td><select class="select input--sm qi-pri-sel' + (r.userPriority ? ' qi-pri--' + r.userPriority : '') + '" data-pri="' + r.criterionId + '" aria-label="Priority"><option value="">Not set</option>' + Object.keys(Q.PRIORITY).map(function (k) { return '<option value="' + k + '"' + (k === r.userPriority ? ' selected' : '') + '>' + Q.PRIORITY[k].label + '</option>'; }).join('') + '</select></td></tr>';
          }).join('') + '</tbody></table></div></div></section>';

    host.querySelectorAll('[data-target-crit]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        const set = (p.targetCriteria || []).filter(function (x) { return x !== cb.dataset.targetCrit; });
        if (cb.checked) set.push(cb.dataset.targetCrit);
        store.updateQiProject(p.id, { targetCriteria: set });
      });
    });
    host.querySelectorAll('[data-pri]').forEach(function (s) {
      s.addEventListener('change', function () { const m = Object.assign({}, p.criteriaPriority); m[s.dataset.pri] = s.value; store.updateQiProject(p.id, { criteriaPriority: m }); ui.toast('Priority saved', 'success'); });
    });
    host.querySelectorAll('[data-clin]').forEach(function (i) {
      i.addEventListener('change', function () { const m = Object.assign({}, p.clinicalImportance); m[i.dataset.clin] = i.value.trim(); store.updateQiProject(p.id, { clinicalImportance: m }); });
    });
    host.querySelector('[data-act=reimport]').addEventListener('click', function () {
      const cyc = a ? cyclesWithData(a) : [];
      if (!cyc.length) { ui.toast('No cycle with completed cases to import from', 'error'); return; }
      ui.modal({
        title: 'Re-import baseline', confirmLabel: 'Re-import',
        subtitle: 'The current baseline copy is kept in the project history.',
        body: '<label class="field"><span class="field__label">Baseline cycle</span><select class="select" name="key">' + cyc.map(function (r) { return '<option value="' + r.key + '"' + (r.key === b.refKey ? ' selected' : '') + '>' + esc(r.label) + '</option>'; }).join('') + '</select></label>',
        onConfirm: function (form) { store.refreshBaseline(p.id, form.elements.key.value); ui.toast('Baseline re-imported', 'success'); }
      });
    });
  }

  /* ---------- Interventions tab ---------- */
  function tabInterventions(host, p, q) {
    const ivs = Q.interventionsFor(p.id).slice().sort(function (x, y) { return String(x.targetDate || '9').localeCompare(String(y.targetDate || '9')); });
    if (!ivs.length) {
      host.innerHTML = '<div class="card">' + ui.emptyState({ icon: 'flag', title: 'No interventions yet', text: 'Interventions describe the change you will make, who owns it, when it is due and how success will be measured.' }) +
        '<div class="center-actions"><button class="btn btn--primary" data-act="add-iv2">' + ui.icon('plus', 15) + 'Add intervention</button>' + (Q.suggestionsFor(p).length ? '<a class="btn btn--secondary" href="#/qi/' + p.id + '?tab=suggestions">' + ui.icon('fStar', 15) + 'Review suggestions</a>' : '') + '</div></div>';
      host.querySelector('[data-act=add-iv2]').addEventListener('click', function () { editIntervention(p, null); });
      return;
    }
    const od = ivs.filter(Q.isOverdue);
    host.innerHTML =
      (od.length ? '<div class="cmp-warn is-strong qi-od">' + ui.icon('alert', 18) + '<div><strong>' + od.length + ' overdue intervention' + (od.length === 1 ? '' : 's') + '</strong><ul>' + od.map(function (i) { return '<li>' + esc(i.title) + ' — ' + esc(i.responsiblePerson || 'unassigned') + ', due ' + U.fmtDate(i.targetDate) + ' (' + Math.abs(U.daysUntil(i.targetDate)) + ' days ago)</li>'; }).join('') + '</ul></div></div>' : '') +
      '<section class="card"><div class="card__head"><div><h3 class="card__title">Intervention timeline</h3><p class="card__sub">Start to target completion; the marker shows the review date and the vertical line is today</p></div></div><div class="card__body">' + gantt(ivs) + '</div></section>' +
      '<section class="card"><div class="card__head"><div><h3 class="card__title">Intervention plan</h3><p class="card__sub">Select a row to see progress notes, completion and effectiveness review</p></div></div>' +
        '<div class="card__body card__body--flush"><div class="table-wrap"><table class="table table--compact qi-iv"><thead><tr><th>Identified issue</th><th>Intervention</th><th>Criterion</th><th>Responsible</th><th class="nowrap">Target date</th><th>Success measure</th><th>Status</th><th class="cell-actions"><span class="sr-only">Actions</span></th></tr></thead><tbody>' +
          ivs.map(function (i) {
            return '<tr class="is-link' + (Q.isOverdue(i) ? ' is-overdue' : '') + (q.iv === i.id ? ' is-open' : '') + '" data-iv="' + i.id + '" tabindex="0"><td>' + esc(i.identifiedProblem || '—') + '</td><td><div class="cell-title">' + esc(i.title) + '</div>' + (i.proposedSolution ? '<div class="cell-sub">' + esc(i.proposedSolution) + '</div>' : '') + (i.source && i.source.type === 'report_action' ? '<div class="cell-sub">' + ui.icon('link', 11) + ' From report action plan</div>' : i.source && i.source.type === 'suggestion' ? '<div class="cell-sub">' + ui.icon('fStar', 11) + ' From approved suggestion</div>' : '') + '</td>' +
              '<td>' + esc(critName(p, i.criterionId)) + '</td><td>' + esc(i.responsiblePerson || '—') + (i.supportingTeam.length ? '<div class="cell-sub">+ ' + esc(i.supportingTeam.join(', ')) + '</div>' : '') + '</td>' +
              '<td class="nowrap">' + dateOr(i.targetDate) + '</td><td>' + esc(i.successMeasure || '—') + '</td>' +
              '<td><select class="select input--sm qi-st-sel" data-iv-status="' + i.id + '" aria-label="Status">' + Object.keys(Q.IV_STATUS).map(function (k) { return '<option value="' + k + '"' + (k === i.status ? ' selected' : '') + '>' + Q.IV_STATUS[k].label + '</option>'; }).join('') + '</select>' + (Q.isOverdue(i) ? '<span class="badge badge--red qi-od-b">Overdue</span>' : '') + '</td>' +
              '<td class="cell-actions nowrap"><button class="icon-btn icon-btn--sm" data-iv-edit="' + i.id + '" aria-label="Edit intervention">' + ui.icon('collect', 14) + '</button><button class="icon-btn icon-btn--sm icon-btn--danger" data-iv-del="' + i.id + '" aria-label="Delete intervention">' + ui.icon('trash', 14) + '</button></td></tr>' +
              (q.iv === i.id ? '<tr class="qi-iv-detail"><td colspan="8">' + ivDetail(p, i) + '</td></tr>' : '');
          }).join('') + '</tbody></table></div></div></section>';

    host.querySelectorAll('tr[data-iv]').forEach(function (tr) {
      const open = function () { location.hash = '#/qi/' + p.id + '?tab=interventions' + (q.iv === tr.dataset.iv ? '' : '&iv=' + tr.dataset.iv); };
      tr.addEventListener('click', function (e) { if (!e.target.closest('a, button, select, input, label')) open(); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target === tr) open(); });
    });
    host.querySelectorAll('[data-iv-status]').forEach(function (s) {
      s.addEventListener('change', function () {
        const iv = store.getIntervention(s.dataset.ivStatus);
        if (s.value === 'completed') { completeModal(p, iv); s.value = iv.status; return; }
        store.saveIntervention({ id: iv.id, status: s.value });
        ui.toast('Status changed to ' + Q.IV_STATUS[s.value].label, 'success');
      });
    });
    host.querySelectorAll('[data-iv-edit]').forEach(function (b) { b.addEventListener('click', function () { editIntervention(p, store.getIntervention(b.dataset.ivEdit)); }); });
    host.querySelectorAll('[data-iv-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        const iv = store.getIntervention(b.dataset.ivDel);
        ui.confirm({ title: 'Delete intervention?', danger: true, confirmLabel: 'Delete intervention',
          message: '“' + iv.title + '” and its ' + iv.progressNotes.length + ' progress note' + (iv.progressNotes.length === 1 ? '' : 's') + ' will be deleted.' + (iv.source && iv.source.type === 'report_action' ? ' The original report action is kept.' : ''),
          onConfirm: function () { store.deleteIntervention(iv.id); ui.toast('Intervention deleted', 'success'); } });
      });
    });
    const det = host.querySelector('.qi-iv-detail');
    if (det) bindDetail(det, p, store.getIntervention(q.iv));
    if (q.iv && det) setTimeout(function () { det.scrollIntoView({ block: 'nearest' }); }, 50);
  }

  function gantt(ivs) {
    const t = U.isoDay(new Date());
    const dates = [t];
    ivs.forEach(function (i) { [i.startDate, i.targetDate, i.reviewDate, i.completedAt, U.isoDay(new Date(i.createdAt))].forEach(function (d) { if (d) dates.push(d); }); });
    dates.sort();
    const min = U.toDate(dates[0]).getTime() - 864e5 * 3, max = U.toDate(dates[dates.length - 1]).getTime() + 864e5 * 7;
    const pos = function (d) { return Math.max(0, Math.min(100, (U.toDate(d).getTime() - min) / (max - min) * 100)); };
    const months = [];
    const m0 = new Date(min); m0.setDate(1); m0.setMonth(m0.getMonth() + 1);
    for (let d = m0; d.getTime() < max; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push({ p: pos(U.isoDay(d)), l: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) });
    return '<div class="gantt"><div class="gantt__scale">' + months.map(function (m) { return '<span style="left:' + m.p + '%">' + m.l + '</span>'; }).join('') + '</div>' +
      ivs.map(function (i) {
        const s = i.startDate || U.isoDay(new Date(i.createdAt));
        const e = i.status === 'completed' && i.completedAt ? i.completedAt : (i.targetDate || s);
        const st = Q.ivStatus(i);
        const l = pos(s), w = Math.max(1.5, pos(e) - l);
        return '<div class="gantt__row"><a class="gantt__label" href="#/qi/' + i.projectId + '?tab=interventions&iv=' + i.id + '">' + esc(i.title) + '<span>' + esc(i.responsiblePerson || '—') + '</span></a><div class="gantt__track">' +
          '<span class="gantt__bar gantt__bar--' + st.key + '" style="left:' + l + '%;width:' + w + '%" title="' + esc(st.label) + ': ' + U.fmtDate(s) + ' – ' + U.fmtDate(e) + '"></span>' +
          (i.status !== 'completed' && i.targetDate && i.targetDate < t ? '<span class="gantt__late" style="left:' + pos(i.targetDate) + '%;width:' + (pos(t) - pos(i.targetDate)) + '%"></span>' : '') +
          (i.reviewDate ? '<span class="gantt__review" style="left:' + pos(i.reviewDate) + '%" title="Review ' + U.fmtDate(i.reviewDate) + '"></span>' : '') +
        '</div></div>';
      }).join('') + '<span class="gantt__today" style="left:calc(var(--gl) + (100% - var(--gl)) * ' + (pos(t) / 100) + ')"><span>Today</span></span></div>' +
      '<div class="gantt__legend">' + ['planned', 'in_progress', 'completed', 'overdue'].map(function (k) { return '<span><i class="gantt__bar--' + k + '"></i>' + (k === 'overdue' ? 'Overdue' : Q.IV_STATUS[k].label) + '</span>'; }).join('') + '<span><i class="gantt__review-k"></i>Review date</span></div>';
  }

  function ivDetail(p, i) {
    const a = auditOf(p);
    let observed = '';
    if (a && i.criterionId && p.baseline) {
      const latest = Q.latestRef(p);
      const keyOf = Q.criterionKeyer(a);
      const b = p.baseline.rows.find(function (r) { return r.criterionId === i.criterionId; });
      const lr = latest ? Q.cycleResults(latest).rows.find(function (r) { return r.key === keyOf(i.criterionId); }) : null;
      observed = '<div class="iv-obs"><h5>' + ui.icon('analytics', 13) + 'Observed audit results for this criterion</h5>' +
        '<p>' + esc(p.baseline.cycleLabel) + ': <strong>' + (b ? Q.fmtPct(b.compliance) + '</strong> (' + b.met + '/' + b.denominator + ')' : '—</strong>') +
        (lr ? ' → ' + esc(latest.label) + ': <strong>' + Q.fmtPct(lr.compliance) + '</strong> (' + lr.met + '/' + lr.denominator + ') · ' + Q.fmtPP(b && lr.compliance !== null && b.compliance !== null ? lr.compliance - b.compliance : null) : ' · no re-audit data yet') + '</p>' +
        '<p class="muted small">An observed change shows association only. Judge effectiveness using the re-audit data together with implementation evidence and team feedback.</p></div>';
    }
    const eff = i.effectiveness || {};
    return '<div class="iv-det">' +
      '<div class="iv-det__col"><dl class="qn-dl">' +
        '<div><dt>Description</dt><dd>' + esc(i.description || '—') + '</dd></div><div><dt>Expected outcome</dt><dd>' + esc(i.expectedOutcome || '—') + '</dd></div>' +
        '<div><dt>Start date</dt><dd>' + dateOr(i.startDate) + '</dd></div><div><dt>Review date</dt><dd>' + dateOr(i.reviewDate) + '</dd></div>' +
        '<div><dt>Implemented</dt><dd>' + dateOr(i.startedAt) + '</dd></div><div><dt>Completed</dt><dd>' + (i.completedAt ? U.fmtDate(i.completedAt) : '—') + '</dd></div>' +
      '</dl>' + sourceHtml(i) + observed +
      '<div class="iv-eff"><h5>' + ui.icon('target', 13) + 'Effectiveness review</h5>' +
        '<div class="grid-2"><label class="field"><span class="field__label">Assessment</span><select class="select input--sm" name="effRating"><option value="">Not yet reviewed</option>' + Object.keys(Q.EFFECTIVENESS).map(function (k) { return '<option value="' + k + '"' + (eff.rating === k ? ' selected' : '') + '>' + Q.EFFECTIVENESS[k] + '</option>'; }).join('') + '</select></label>' +
        '<label class="field"><span class="field__label">Reviewed</span><input class="input input--sm" value="' + (eff.reviewedAt ? U.fmtDate(eff.reviewedAt) + ' · ' + esc(eff.reviewedBy || '') : '—') + '" disabled></label></div>' +
        '<label class="field"><span class="field__label">Evidence and notes</span><textarea class="textarea input--sm" name="effNotes" rows="2" placeholder="What evidence supports this judgement?">' + esc(eff.notes || '') + '</textarea></label>' +
        '<button class="btn btn--secondary btn--sm" data-act="save-eff">Save review</button></div></div>' +
      '<div class="iv-det__col"><h5>' + ui.icon('fAlign', 13) + 'Progress notes</h5>' +
        (i.progressNotes.length ? '<ol class="iv-notes">' + i.progressNotes.slice().reverse().map(function (n) { return '<li class="' + (n.system ? 'is-sys' : '') + '"><span class="iv-notes__m">' + U.fmtDate(n.at, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + (n.by ? ' · ' + esc(n.by) : '') + '</span><span>' + esc(n.text) + '</span>' + (n.system ? '' : '<button class="link-btn small" data-note-del="' + n.id + '">Delete</button>') + '</li>'; }).join('') + '</ol>' : '<p class="muted small">No progress notes yet.</p>') +
        '<div class="iv-addnote"><textarea class="textarea input--sm" name="note" rows="2" placeholder="Add a progress note…"></textarea><button class="btn btn--primary btn--sm" data-act="add-note">Add note</button></div>' +
        '<h5 class="iv-hist-h">Status history</h5><ul class="iv-hist">' + i.statusHistory.slice().reverse().map(function (h) { return '<li>' + U.fmtDate(h.at) + ' · ' + esc(h.from ? Q.IV_STATUS[h.from].label + ' → ' : '') + esc(Q.IV_STATUS[h.to].label) + (h.by ? ' · ' + esc(h.by) : '') + '</li>'; }).join('') + '</ul>' +
      '</div></div>';
  }

  function sourceHtml(i) {
    if (!i.source || i.source.type !== 'report_action') return '';
    const r = store.getReport(i.source.reportId);
    const a = r && r.actionPlan.find(function (x) { return x.id === i.source.actionId; });
    const st = i.source.syncState;
    return '<div class="iv-src">' + ui.icon('link', 13) + '<div><strong>Linked report action</strong>' + (r ? '<a href="#/reports/' + r.id + '">' + esc(r.title) + '</a>' : '<span class="muted">Report deleted</span>') +
      (a ? '<span class="muted small">Report action status: ' + esc(DA.reportEngine.actionStatus(a)) + (st === 'report_locked' ? ' — the report is ' + esc(r.status === 'in_review' ? 'in review' : r.status) + ', so it keeps its recorded status until a new revision is started.' : st === 'in_sync' ? ' · in sync' : '') + '</span>' : (r ? '<span class="muted small">The original action is no longer in the report.</span>' : '')) + '</div></div>';
  }

  function bindDetail(det, p, iv) {
    det.querySelector('[data-act=add-note]').addEventListener('click', function () {
      const t = det.querySelector('[name=note]').value.trim();
      if (!t) { det.querySelector('[name=note]').focus(); return; }
      store.addProgressNote(iv.id, t); ui.toast('Progress note added', 'success');
    });
    det.querySelectorAll('[data-note-del]').forEach(function (b) {
      b.addEventListener('click', function () { ui.confirm({ title: 'Delete progress note?', danger: true, confirmLabel: 'Delete', message: 'This note will be removed from the intervention record.', onConfirm: function () { store.deleteProgressNote(iv.id, b.dataset.noteDel); } }); });
    });
    det.querySelector('[data-act=save-eff]').addEventListener('click', function () {
      const r = det.querySelector('[name=effRating]').value;
      store.saveIntervention({ id: iv.id, effectiveness: { rating: r, notes: det.querySelector('[name=effNotes]').value.trim(), reviewedAt: new Date().toISOString(), reviewedBy: store.getSettings().userName } });
      ui.toast('Effectiveness review saved', 'success');
    });
  }

  function completeModal(p, iv) {
    ui.modal({
      title: 'Mark intervention completed', confirmLabel: 'Mark completed',
      subtitle: iv.title,
      body: '<label class="field"><span class="field__label">Completion date</span><input class="input" type="date" name="completedAt" value="' + U.isoDay(new Date()) + '"></label>' +
        '<label class="field"><span class="field__label">Completion note <span class="muted">(optional)</span></span><textarea class="textarea" name="note" rows="2" placeholder="What was implemented?"></textarea></label>' +
        '<p class="muted small">' + ui.icon('alert', 12) + ' Completing an intervention records that it was implemented. Whether it was effective is reviewed separately, using re-audit data.</p>',
      onConfirm: function (form) {
        const d = form.elements.completedAt.value || U.isoDay(new Date());
        store.saveIntervention({ id: iv.id, status: 'completed', completedAt: d }, { silent: false });
        if (form.elements.note.value.trim()) store.addProgressNote(iv.id, 'Completed: ' + form.elements.note.value.trim());
        ui.toast('Intervention completed' + (iv.source && iv.source.type === 'report_action' ? ' — linked report action updated' : ''), 'success');
      }
    });
  }

  /** Add / edit an intervention. prefill: values from a suggestion or report action. */
  function editIntervention(p, iv, prefill, onSaved) {
    const x = iv ? Object.assign({}, iv) : Object.assign({
      title: '', criterionId: '', identifiedProblem: '', description: '', proposedSolution: '', expectedOutcome: '', responsiblePerson: p.projectLead || '',
      supportingTeam: [], startDate: U.isoDay(new Date()), targetDate: U.isoDay(U.addDays(new Date(), 60)), reviewDate: U.isoDay(U.addDays(new Date(), 90)), successMeasure: '', status: 'planned'
    }, prefill || {});
    const f = function (name, label, control, req, hint) { return '<label class="field" data-f="' + name + '"><span class="field__label">' + label + (req ? ' <span class="req">*</span>' : '') + '</span>' + control + (hint ? '<span class="field__hint">' + hint + '</span>' : '') + '<span class="field__error">Required.</span></label>'; };
    const inp = function (name, type, ph) { return '<input class="input" name="' + name + '" type="' + (type || 'text') + '" value="' + esc(Array.isArray(x[name]) ? x[name].join(', ') : x[name] || '') + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>'; };
    const ta = function (name, ph) { return '<textarea class="textarea" name="' + name + '" rows="2"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>' + esc(x[name] || '') + '</textarea>'; };
    ui.modal({
      title: iv ? 'Edit intervention' : prefill ? 'Review and approve intervention' : 'Add intervention', size: 'wide',
      subtitle: prefill && prefill._from ? prefill._from : 'Structured improvement intervention',
      confirmLabel: iv ? 'Save intervention' : prefill ? 'Approve intervention' : 'Add intervention',
      body:
        f('title', 'Intervention title', inp('title', 'text', 'e.g. Mandatory implant restoration documentation template'), true) +
        '<div class="grid-2">' + f('criterionId', 'Associated audit criterion', '<select class="select" name="criterionId">' + critOptions(p, x.criterionId) + '</select>') + f('status', 'Current status', '<select class="select" name="status">' + Object.keys(Q.IV_STATUS).map(function (k) { return '<option value="' + k + '"' + (k === x.status ? ' selected' : '') + '>' + Q.IV_STATUS[k].label + '</option>'; }).join('') + '</select>') + '</div>' +
        f('identifiedProblem', 'Identified problem', ta('identifiedProblem', 'e.g. Inconsistent documentation of implant crown torque'), true) +
        f('description', 'Description', ta('description')) +
        '<div class="grid-2">' + f('proposedSolution', 'Proposed solution', ta('proposedSolution', 'What will change?'), true) + f('expectedOutcome', 'Expected outcome', ta('expectedOutcome', 'What do you expect to happen?')) + '</div>' +
        '<div class="grid-2">' + f('responsiblePerson', 'Responsible person', inp('responsiblePerson', 'text', 'e.g. Restorative department audit lead'), true) + f('supportingTeam', 'Supporting team members', inp('supportingTeam'), false, 'Separate names with commas.') + '</div>' +
        '<div class="grid-3">' + f('startDate', 'Start date', inp('startDate', 'date')) + f('targetDate', 'Target completion date', inp('targetDate', 'date'), true) + f('reviewDate', 'Review date', inp('reviewDate', 'date')) + '</div>' +
        f('successMeasure', 'Success measure', inp('successMeasure', 'text', 'e.g. Increase documented implant crown torque to 100%'), true),
      onConfirm: function (form) {
        const v = {};
        ['title', 'criterionId', 'status', 'identifiedProblem', 'description', 'proposedSolution', 'expectedOutcome', 'responsiblePerson', 'supportingTeam', 'startDate', 'targetDate', 'reviewDate', 'successMeasure'].forEach(function (k) { v[k] = form.elements[k].value.trim(); });
        let bad = false;
        form.querySelectorAll('.field').forEach(function (w) { w.classList.remove('has-error'); });
        ['title', 'identifiedProblem', 'proposedSolution', 'responsiblePerson', 'targetDate', 'successMeasure'].forEach(function (k) { if (!v[k]) { form.querySelector('[data-f="' + k + '"]').classList.add('has-error'); bad = true; } });
        if (v.startDate && v.targetDate && v.targetDate < v.startDate) { const w = form.querySelector('[data-f=targetDate]'); w.classList.add('has-error'); w.querySelector('.field__error').textContent = 'Must be on or after the start date.'; bad = true; }
        if (v.reviewDate && v.startDate && v.reviewDate < v.startDate) { const w = form.querySelector('[data-f=reviewDate]'); w.classList.add('has-error'); w.querySelector('.field__error').textContent = 'Must be on or after the start date.'; bad = true; }
        if (bad) return false;
        if (v.status === 'completed' && !(iv && iv.completedAt)) v.completedAt = U.isoDay(new Date());
        const saved = store.saveIntervention(Object.assign({ id: iv ? iv.id : undefined, projectId: p.id, source: prefill && prefill._source ? prefill._source : undefined }, v));
        ui.toast(iv ? 'Intervention saved' : 'Intervention added', 'success');
        if (onSaved) onSaved(saved);
      }
    });
  }

  /* ---------- Suggestions tab ---------- */
  function tabSuggestions(host, p) {
    const all = Q.suggestionsFor(p);
    const ivs = Q.interventionsFor(p.id);
    const pending = all.filter(function (s) { return !s.decision; });
    const rejected = all.filter(function (s) { return s.decision === 'rejected'; });
    const approved = ivs.filter(function (i) { return i.source && i.source.type === 'suggestion'; });
    const aiOn = DA.ai.isConfigured();
    if (!p.baseline) {
      host.innerHTML = '<div class="card">' + ui.emptyState({ icon: 'fStar', title: 'No baseline to work from', text: 'Suggestions are generated from criteria that did not meet their target in the baseline cycle. Import a baseline first.' }) + '</div>';
      return;
    }
    const byCrit = {};
    pending.forEach(function (s) { (byCrit[s.criterionId] = byCrit[s.criterionId] || []).push(s); });
    host.innerHTML =
      '<div class="qi-legend"><span class="qi-legend__i qi-legend--obs">' + ui.icon('analytics', 13) + 'Observed audit finding</span><span class="qi-legend__i qi-legend--sug">' + ui.icon('fStar', 13) + 'Suggested intervention — not yet approved</span><span class="qi-legend__i qi-legend--ok">' + ui.icon('check', 13) + 'Approved intervention</span></div>' +
      '<p class="qi-disclaimer">' + ui.icon('shield', 14) + 'Suggestions are generated from predefined templates and the baseline figures. They are prompts for the clinical team, not clinical recommendations. Approve, edit or reject each one; nothing is added to the plan until you approve it. No references or guidance are generated.</p>' +
      (Object.keys(byCrit).length ? Object.keys(byCrit).map(function (cid) {
        const list = byCrit[cid];
        return '<section class="card sug-group"><div class="sug-obs">' + ui.icon('analytics', 15) + '<div><span class="sug-k">Observed finding</span><p>' + esc(list[0].finding) + '</p></div></div>' +
          list.map(function (s) {
            return '<div class="sug"><div class="sug__body"><span class="sug-k">' + ui.icon('fStar', 12) + 'Suggested intervention</span><strong>' + esc(s.title) + '</strong><p>' + esc(s.intervention) + '</p><p class="sug__m"><span>Suggested success measure:</span> ' + esc(s.successMeasure) + '</p></div>' +
              '<div class="sug__btns"><button class="btn btn--ghost btn--sm" data-sug-reject="' + s.id + '">Reject</button><button class="btn btn--secondary btn--sm" data-sug-edit="' + s.id + '">Edit & approve</button><button class="btn btn--primary btn--sm" data-sug-approve="' + s.id + '">' + ui.icon('check', 13) + 'Approve</button></div></div>';
          }).join('') + '</section>';
      }).join('') : '<div class="card"><div class="card__body"><p class="muted">' + (all.length ? 'Every suggestion has been approved or rejected.' : 'All baseline criteria met their target, so there are no deficiencies to suggest interventions for.') + '</p></div></div>') +
      (approved.length ? '<section class="card"><div class="card__head"><div><h3 class="card__title">' + ui.icon('check', 15) + ' Approved from suggestions</h3></div></div><ul class="qi-list">' + approved.map(function (i) { return '<li><div class="qi-list__body"><a class="qi-list__t" href="#/qi/' + p.id + '?tab=interventions&iv=' + i.id + '">' + esc(i.title) + '</a><span class="qi-list__s">' + esc(i.responsiblePerson) + ' · due ' + dateOr(i.targetDate) + '</span></div>' + ivBadge(i) + '</li>'; }).join('') + '</ul></section>' : '') +
      (rejected.length ? '<details class="card sug-rej"><summary>' + rejected.length + ' rejected suggestion' + (rejected.length === 1 ? '' : 's') + '</summary><ul class="qi-list">' + rejected.map(function (s) { return '<li><div class="qi-list__body"><span class="qi-list__t">' + esc(s.title) + '</span><span class="qi-list__s">' + esc(s.criterionName) + '</span></div><button class="link-btn small" data-sug-restore="' + s.id + '">Restore</button></li>'; }).join('') + '</ul></details>' : '') +
      '<section class="card as-card--ai sug-ai"><div class="card__body"><h5>' + ui.icon('fStar', 13) + 'AI-assisted suggestions</h5>' +
        (aiOn ? '<p>Send the aggregate baseline (criterion names, targets and compliance only) to your secure AI backend for additional ideas. Results appear as unapproved drafts.</p><button class="btn btn--secondary btn--sm" data-act="ai-sug">' + ui.icon('fStar', 14) + 'Ask the AI assistant</button><div id="sug-ai-out"></div>'
          : '<p><strong>AI backend not configured.</strong> The suggestions above come from built-in templates. To add AI-assisted ideas, connect a secure backend in Settings — no audit data is sent until you do.</p><a class="btn btn--ghost btn--sm" href="#/settings">' + ui.icon('settings', 14) + 'AI settings</a>') +
      '</div></section>';

    const decide = function (id, d) { const m = Object.assign({}, p.suggestionDecisions); if (d) m[id] = d; else delete m[id]; store.updateQiProject(p.id, { suggestionDecisions: m }); };
    const sugOf = function (id) { return all.find(function (s) { return s.id === id; }); };
    const prefillOf = function (s) {
      const b = p.baseline.rows.find(function (r) { return r.criterionId === s.criterionId; });
      return { title: s.title, criterionId: s.criterionId, identifiedProblem: s.finding, proposedSolution: s.intervention, successMeasure: s.successMeasure, expectedOutcome: b ? 'Compliance moves from ' + Q.fmtPct(b.compliance, 0) + ' towards the ' + b.target + '% target' : '', _from: 'From suggestion — edit as needed, then approve.', _source: { type: 'suggestion', suggestionId: s.id } };
    };
    host.querySelectorAll('[data-sug-approve]').forEach(function (b) {
      b.addEventListener('click', function () {
        const s = sugOf(b.dataset.sugApprove);
        const pf = prefillOf(s);
        // Approval without edits still needs an owner and a date: open the form pre-filled.
        editIntervention(p, null, pf, function () { decide(s.id, 'approved'); });
      });
    });
    host.querySelectorAll('[data-sug-edit]').forEach(function (b) {
      b.addEventListener('click', function () { const s = sugOf(b.dataset.sugEdit); editIntervention(p, null, prefillOf(s), function () { decide(s.id, 'approved'); }); });
    });
    host.querySelectorAll('[data-sug-reject]').forEach(function (b) { b.addEventListener('click', function () { decide(b.dataset.sugReject, 'rejected'); ui.toast('Suggestion rejected', 'success'); }); });
    host.querySelectorAll('[data-sug-restore]').forEach(function (b) { b.addEventListener('click', function () { decide(b.dataset.sugRestore, null); }); });
    const aiBtn = host.querySelector('[data-act=ai-sug]');
    if (aiBtn) aiBtn.addEventListener('click', async function () {
      aiBtn.disabled = true; aiBtn.innerHTML = '<span class="spinner"></span>Waiting for response…';
      const res = await DA.ai.post(Q.aiRequest(p));
      const out = host.querySelector('#sug-ai-out');
      aiBtn.disabled = false; aiBtn.innerHTML = ui.icon('fStar', 14) + 'Ask the AI assistant';
      out.innerHTML = res.ok && res.body && res.body.text ? '<div class="as-result"><div class="as-result__head"><span class="badge badge--amber">AI draft — not approved</span></div><div class="as-result__text doc">' + DA.ai.textToHtml(res.body.text) + '</div><p class="muted small">Use these ideas to create interventions manually. Check every statement; nothing has been added to the plan.</p></div>'
        : '<div class="as-result as-result--err">' + ui.icon('alert', 14) + '<div><strong>No AI response</strong><p>' + esc(res.message || 'The backend returned no text.') + '</p></div></div>';
    });
  }

  /* ---------- PDSA tab ---------- */
  function tabPdsa(host, p) {
    const list = Q.pdsaFor(p.id);
    host.innerHTML =
      '<section class="card"><div class="card__head"><div><h3 class="card__title">PDSA timeline</h3><p class="card__sub">Plan → Do → Study → Act, in chronological order. Each cycle builds on the previous decision.</p></div><a class="btn btn--primary btn--sm" href="#/qi/' + p.id + '/pdsa/new">' + ui.icon('plus', 14) + 'New PDSA cycle</a></div><div class="card__body">' + pdsaRail(p, list) + '</div></section>' +
      (list.length ? '<section class="card"><div class="card__body card__body--flush"><div class="table-wrap"><table class="table table--compact"><thead><tr><th>Cycle</th><th>Change tested</th><th>Linked intervention</th><th>Dates</th><th>Stage</th><th>Act decision</th><th class="cell-actions"></th></tr></thead><tbody>' +
        list.map(function (x) {
          const iv = x.interventionId && store.getIntervention(x.interventionId);
          const st = Q.pdsaStatus(x);
          return '<tr class="is-link" data-href="#/qi/' + p.id + '/pdsa/' + x.id + '" tabindex="0"><td class="nowrap"><strong>PDSA ' + x.cycleNumber + '</strong></td><td>' + esc(x.plan.change || '—') + '</td><td>' + (iv ? esc(iv.title) : '—') + '</td><td class="nowrap">' + dateOr(x.plan.startDate) + ' – ' + dateOr(x.plan.endDate) + '</td>' +
            '<td>' + badge(Q.PDSA_STATUS[st]) + '</td><td>' + (x.act.decision ? '<span class="pdsa-dec pdsa-dec--' + x.act.decision + '">' + esc(Q.ACT_DECISIONS[x.act.decision].label) + '</span>' : '—') + '</td>' +
            '<td class="cell-actions"><button class="icon-btn icon-btn--sm icon-btn--danger" data-pdsa-del="' + x.id + '" aria-label="Delete PDSA cycle ' + x.cycleNumber + '">' + ui.icon('trash', 14) + '</button></td></tr>';
        }).join('') + '</tbody></table></div></div></section>' : '');
    host.querySelectorAll('[data-pdsa-del]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        const x = store.getPdsaCycle(b.dataset.pdsaDel);
        ui.confirm({ title: 'Delete PDSA cycle ' + x.cycleNumber + '?', danger: true, confirmLabel: 'Delete PDSA cycle', message: 'The Plan, Do, Study and Act records of this cycle will be permanently deleted. Interventions and audit data are not affected.', onConfirm: function () { store.deletePdsa(x.id); ui.toast('PDSA cycle deleted', 'success'); } });
      });
    });
    bindRows(host);
  }

  /* ---------- Re-audit & comparison tab ---------- */
  function tabCycles(host, p) {
    const a = auditOf(p);
    if (!a) { host.innerHTML = '<div class="card">' + ui.emptyState({ icon: 'repeat', title: 'No linked audit', text: 'Link an audit to this project to create re-audit cycles and compare results.' }) + '</div>'; return; }
    host.innerHTML = cyclesCard(a, p);
    bindCycles(host, a);
  }

  /** Cycle list used by the project and the audit overview QI tab. */
  function cyclesCard(a, p) {
    const ser = Q.series(a);
    const chk = DA.views.compare.canCreateCycle(a);
    const def = Q.defaultPair(a);
    return '<section class="card"><div class="card__head"><div><h3 class="card__title">Audit cycles</h3><p class="card__sub">Each cycle keeps its own form, case records and frozen criteria</p></div>' +
      '<div class="card__actions">' + (def ? '<a class="btn btn--secondary btn--sm" href="#/compare/' + a.id + '">' + ui.icon('analytics', 14) + 'Compare cycles</a>' : '') +
      (a.status !== 'draft' ? '<button class="btn btn--primary btn--sm" data-act="new-cycle"' + (chk.ok ? '' : ' disabled title="' + esc(chk.why) + '"') + '>' + ui.icon('repeat', 14) + 'Create Cycle ' + ((C.currentCycle(a) || { number: 0 }).number + 1) + '</button>' : '') + '</div></div>' +
      '<div class="card__body card__body--flush"><div class="table-wrap"><table class="table table--compact"><thead><tr><th>Cycle</th><th>Role</th><th>Dates</th><th class="cell-num">Completed cases</th><th class="cell-num">Compliance</th><th>Form</th><th>Status</th></tr></thead><tbody>' +
        ser.map(function (r) {
          const res = Q.cycleResults(r);
          const isBase = p && p.baseline && p.baseline.cycleId === r.cycle.id;
          return '<tr><td><strong>' + esc(r.label) + '</strong>' + (r.audit.id !== a.id ? '<div class="cell-sub"><a href="#/audits/' + r.audit.id + '">' + esc(r.audit.title) + '</a></div>' : '') + '</td>' +
            '<td>' + (isBase ? '<span class="badge badge--blue">Baseline</span>' : r.number === ser[0].number ? 'Baseline audit' : 'Re-audit') + '</td>' +
            '<td class="nowrap">' + dateOr(r.cycle.collectionStartDate || r.cycle.startedAt) + ' – ' + (r.cycle.completedAt ? U.fmtDate(r.cycle.completedAt) : r.cycle.collectionEndDate ? U.fmtDate(r.cycle.collectionEndDate) + ' (planned)' : 'ongoing') + '</td>' +
            '<td class="cell-num">' + res.completed + (res.drafts ? ' <span class="muted small">+' + res.drafts + ' draft</span>' : '') + '</td><td class="cell-num"><strong>' + Q.fmtPct(res.overall.compliance) + '</strong></td>' +
            '<td>' + (r.cycle.form ? 'v' + r.cycle.form.version + (r.cycle.createdFrom ? ' · ' + (r.cycle.createdFrom.formMode === 'duplicate' ? 'copied' : 'new') : '') : '<span class="muted">Not designed</span>') + '</td>' +
            '<td>' + (r.cycle.status === 'completed' ? '<span class="badge badge--green">Closed</span>' : '<span class="badge badge--blue">Active</span>') + (r.cycle === C.currentCycle(r.audit) && r.cycle.status !== 'completed' ? ' <a class="link-btn small" href="#/collect/' + r.audit.id + '">Collect</a>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>' +
      (!chk.ok && a.status !== 'draft' ? '<p class="card__foot muted small">' + esc(chk.why) + '</p>' : '') + '</section>';
  }

  function bindCycles(host, a) {
    const b = host.querySelector('[data-act=new-cycle]');
    if (b) b.addEventListener('click', function () { DA.views.compare.createCycleModal(a); });
  }

  /* ---------- Timeline tab ---------- */
  let tlFilter = 'all';
  function tabTimeline(host, p) {
    const ev = Q.timeline(p);
    const types = { audit: 'Audit', collection: 'Data collection', report: 'Reports', project: 'Project', intervention: 'Interventions', pdsa: 'PDSA', reaudit: 'Re-audit', milestone: 'Milestones' };
    const shown = ev.filter(function (e) { return tlFilter === 'all' || e.type === tlFilter; });
    const t = U.isoDay(new Date());
    let todayShown = false;
    host.innerHTML =
      '<div class="qi-tl-wrap"><section class="card"><div class="card__head"><div><h3 class="card__title">Audit and improvement journey</h3><p class="card__sub">Dated from the stored records — select an event to open it</p></div></div>' +
        '<div class="card__body"><div class="chips tl-chips">' + [['all', 'All']].concat(Object.keys(types).filter(function (k) { return ev.some(function (e) { return e.type === k; }); }).map(function (k) { return [k, types[k]]; })).map(function (x) {
          return '<button class="chip' + (tlFilter === x[0] ? ' is-active' : '') + '" data-tl="' + x[0] + '">' + x[1] + '</button>';
        }).join('') + '</div>' +
        (shown.length ? '<ol class="tl">' + shown.map(function (e) {
          let pre = '';
          if (!todayShown && e.date.slice(0, 10) > t) { todayShown = true; pre = '<li class="tl__today"><span>Today · ' + U.fmtDate(t) + '</span></li>'; }
          return pre + '<li class="tl__ev tl__ev--' + e.type + (e.date.slice(0, 10) > t ? ' is-future' : '') + '"><a href="' + e.href + '"><span class="tl__dot">' + ui.icon({ audit: 'audits', collection: 'collect', report: 'reports', project: 'target', intervention: 'flag', pdsa: 'repeat', reaudit: 'repeat', milestone: 'calendar' }[e.type] || 'calendar', 13) + '</span>' +
            '<span class="tl__d">' + U.fmtDate(e.date) + '</span><span class="tl__t">' + esc(e.title) + '</span>' + (e.detail ? '<span class="tl__s">' + esc(e.detail) + '</span>' : '') + '</a></li>';
        }).join('') + (todayShown ? '' : '<li class="tl__today"><span>Today · ' + U.fmtDate(t) + '</span></li>') + '</ol>' : '<p class="muted">No events of this type.</p>') +
      '</div></section>' +
      '<section class="card"><div class="card__head"><div><h3 class="card__title">Project milestones</h3><p class="card__sub">Add your own milestones to the timeline</p></div></div><div class="card__body">' +
        '<form class="ms-form" id="ms-form" novalidate><input class="input input--sm" name="title" placeholder="Milestone, e.g. Template approved by governance" aria-label="Milestone title"><input class="input input--sm" type="date" name="date" value="' + t + '" aria-label="Date"><button class="btn btn--primary btn--sm" type="submit">' + ui.icon('plus', 14) + 'Add</button></form>' +
        ((p.milestones || []).length ? '<ul class="ms-list">' + p.milestones.slice().sort(function (a, b) { return a.date.localeCompare(b.date); }).map(function (m) {
          return '<li class="' + (m.done ? 'is-done' : '') + '"><label class="check"><input type="checkbox" data-ms-done="' + m.id + '"' + (m.done ? ' checked' : '') + '><span class="check__box">' + ui.icon('check', 12) + '</span></label><span class="ms-list__t">' + esc(m.title) + '<span class="muted small">' + U.fmtDate(m.date) + '</span></span><button class="icon-btn icon-btn--sm icon-btn--danger" data-ms-del="' + m.id + '" aria-label="Delete milestone">' + ui.icon('trash', 13) + '</button></li>';
        }).join('') + '</ul>' : '<p class="muted small">No manual milestones yet.</p>') +
      '</div></section></div>';
    host.querySelectorAll('[data-tl]').forEach(function (b) { b.addEventListener('click', function () { tlFilter = b.dataset.tl; DA.router.refresh(true); }); });
    host.querySelector('#ms-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const f = e.target.elements;
      if (!f.title.value.trim() || !f.date.value) { (f.title.value.trim() ? f.date : f.title).focus(); return; }
      store.saveMilestone(p.id, { title: f.title.value, date: f.date.value });
      ui.toast('Milestone added', 'success');
    });
    host.querySelectorAll('[data-ms-done]').forEach(function (cb) { cb.addEventListener('change', function () { const m = p.milestones.find(function (x) { return x.id === cb.dataset.msDone; }); store.saveMilestone(p.id, Object.assign({}, m, { done: cb.checked })); }); });
    host.querySelectorAll('[data-ms-del]').forEach(function (b) { b.addEventListener('click', function () { ui.confirm({ title: 'Delete milestone?', danger: true, confirmLabel: 'Delete', message: 'This milestone will be removed from the timeline.', onConfirm: function () { store.deleteMilestone(p.id, b.dataset.msDel); } }); }); });
  }

  /* ---------- Project settings ---------- */
  function editProject(p) {
    const audits = store.getAudits().filter(function (a) { return a.status !== 'draft'; });
    const inp = function (name, val, type) { return '<input class="input" name="' + name + '" type="' + (type || 'text') + '" value="' + esc(val || '') + '">'; };
    ui.modal({
      title: 'Project settings', size: 'wide', confirmLabel: 'Save',
      body: '<label class="field"><span class="field__label">Project title</span>' + inp('title', p.title) + '<span class="field__error">Required.</span></label>' +
        '<label class="field"><span class="field__label">Description</span><textarea class="textarea" name="description" rows="2">' + esc(p.description) + '</textarea></label>' +
        '<label class="field"><span class="field__label">Improvement aim</span><textarea class="textarea" name="aim" rows="2">' + esc(p.aim) + '</textarea></label>' +
        '<div class="grid-2"><label class="field"><span class="field__label">Project lead</span>' + inp('projectLead', p.projectLead) + '</label><label class="field"><span class="field__label">Collaborators</span>' + inp('collaborators', p.collaborators.join(', ')) + '</label></div>' +
        '<div class="grid-3"><label class="field"><span class="field__label">Start date</span>' + inp('startDate', p.startDate, 'date') + '</label><label class="field"><span class="field__label">Target completion</span>' + inp('targetCompletionDate', p.targetCompletionDate, 'date') + '</label><label class="field"><span class="field__label">Review date</span>' + inp('reviewDate', p.reviewDate, 'date') + '</label></div>' +
        '<div class="grid-3"><label class="field"><span class="field__label">Status</span><select class="select" name="status">' + Object.keys(Q.PROJECT_STATUS).map(function (k) { return '<option value="' + k + '"' + (k === p.status ? ' selected' : '') + '>' + Q.PROJECT_STATUS[k].label + '</option>'; }).join('') + '</select></label>' +
          '<label class="field"><span class="field__label">Priority</span><select class="select" name="priority">' + Object.keys(Q.PRIORITY).map(function (k) { return '<option value="' + k + '"' + (k === p.priority ? ' selected' : '') + '>' + Q.PRIORITY[k].label + '</option>'; }).join('') + '</select></label>' +
          '<label class="field"><span class="field__label">Associated audit</span><select class="select" name="auditId"><option value="">Independent project</option>' + audits.map(function (a) { return '<option value="' + a.id + '"' + (a.id === p.auditId ? ' selected' : '') + '>' + esc(a.title) + '</option>'; }).join('') + '</select></label></div>',
      onConfirm: function (form) {
        const f = form.elements;
        if (!f.title.value.trim()) { f.title.closest('.field').classList.add('has-error'); return false; }
        const patch = {};
        ['title', 'description', 'aim', 'projectLead', 'collaborators', 'startDate', 'targetCompletionDate', 'reviewDate', 'status', 'priority'].forEach(function (k) { patch[k] = f[k].value.trim(); });
        const relink = f.auditId.value !== (p.auditId || '');
        patch.auditId = f.auditId.value || null;
        store.updateQiProject(p.id, patch, 'Updated improvement project “' + patch.title + '”');
        if (relink && patch.auditId) {
          const cyc = cyclesWithData(store.getAudit(patch.auditId));
          if (cyc.length) store.refreshBaseline(p.id, cyc[cyc.length - 1].key);
        }
        ui.toast('Project saved', 'success');
      }
    });
  }

  /* ---------- Audit overview: Quality Improvement tab ---------- */
  function auditTab(a) {
    const projects = store.projectsForAudit(a.id);
    const changes = a.criteriaChanges || [];
    return '<section class="card" id="audit-qi"><div class="card__head"><div><h3 class="card__title">Improvement projects</h3><p class="card__sub">Interventions and PDSA cycles that act on this audit’s findings</p></div>' +
        '<a class="btn btn--primary" href="#/qi/new?audit=' + a.id + '">' + ui.icon('plus', 16) + 'Create improvement project</a></div>' +
        (projects.length ? projectTable(projects, { hideAudit: true }) : ui.emptyState({ icon: 'target', title: 'No improvement project yet', text: 'Create a project to import this audit’s baseline results and plan interventions for criteria below target.', action: 'Create improvement project', href: '#/qi/new?audit=' + a.id })) +
      '</section>' + cyclesCard(a, projects[0]) +
      (changes.length ? '<section class="card"><div class="card__head"><div><h3 class="card__title">Criterion definition changes</h3><p class="card__sub">Recorded automatically once data collection began — shown as comparability flags</p></div><a class="card__link" href="#/compare/' + a.id + '">Review' + ui.icon('chevronRight', 14) + '</a></div><ul class="qi-list">' +
        changes.slice().reverse().slice(0, 6).map(function (c) { return '<li><div class="qi-list__body"><span class="qi-list__t">' + esc(c.criterionName) + ' — ' + esc(c.field) + '</span><span class="qi-list__s">' + U.fmtDate(c.at) + ' · ' + esc(c.cycleLabel) + (c.field !== 'added' && c.field !== 'removed' ? ' · “' + esc(c.from) + '” → “' + esc(c.to) + '”' : '') + (c.reason ? ' · ' + esc(c.reason) : ' · no reason recorded') + '</span></div></li>'; }).join('') + '</ul></section>' : '');
  }

  return {
    landing: { nav: 'qi', title: function () { return 'Quality Improvement'; }, crumbs: function () { return [{ label: 'Workspace', href: '#/dashboard' }, { label: 'Quality Improvement' }]; }, render: renderLanding },
    create: { nav: 'qi', title: function () { return 'New Improvement Project'; }, crumbs: function () { return [{ label: 'Workspace', href: '#/dashboard' }, { label: 'Quality Improvement', href: '#/qi' }, { label: 'New project' }]; }, render: renderNew, keepOnStoreChange: true },
    project: {
      nav: 'qi', title: function () { return 'Improvement Project'; },
      crumbs: function (p) { const x = store.getQiProject(p.id); return [{ label: 'Workspace', href: '#/dashboard' }, { label: 'Quality Improvement', href: '#/qi' }, { label: x ? x.title : 'Not found' }]; },
      render: renderProject
    },
    auditTab: auditTab, bindCycles: bindCycles, bindRows: bindRows, projectTable: projectTable, editIntervention: editIntervention, pdsaRail: pdsaRail, ivBadge: ivBadge, critName: critName
  };
})();
