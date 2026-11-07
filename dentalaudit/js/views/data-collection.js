/* DentalAudit — Data Collection: hub, case management and case detail
 *
 * Routes
 *   #/collect                       all active audits (choose one)
 *   #/collect/:id                   cases for an audit (metrics, search, filter, actions)
 *   #/collect/:id/case/:caseId      one case, read-only
 *   (#/collect/:id/form → form-builder.js,  #/collect/:id/new and …/edit → case-entry.js)
 */
DA.views.dataCollection = (function () {
  const U = DA.utils, ui = DA.ui, M = DA.metrics, C = DA.collection, store = DA.store;
  const listState = {}; // per audit: { q, status }

  /* =========================================================
   * Shared pieces
   * ========================================================= */
  function collectionBadge(audit) {
    const st = C.statusOf(audit);
    return '<span class="badge badge--' + st.tone + '"><span class="badge__dot"></span>' + st.label + '</span>';
  }

  /** Audit context bar + tabs, so users always know which audit they are working in. */
  function header(audit, tab, opts) {
    const o = opts || {};
    const cyc = C.currentCycle(audit);
    const recs = cyc ? cyc.records : [];
    const form = cyc && cyc.form;
    const canAdd = C.canCollect(audit) && C.hasForm(audit);
    const builderDirty = o.builderDirty !== undefined ? o.builderDirty : (DA.views.formBuilder && DA.views.formBuilder.hasUnsaved(audit.id));
    return '<header class="dc-head">' +
      '<a class="back-link" href="#/audits/' + audit.id + '">' + ui.icon('chevronLeft', 15) + 'Audit overview</a>' +
      '<div class="dc-head__main">' +
        '<div class="dc-head__text">' +
          '<div class="dc-head__eyebrow">' + ui.icon('collect', 13) + 'Data collection · ' + U.esc(cyc ? cyc.label : 'Cycle ' + audit.cycle) + '</div>' +
          '<h2 class="dc-head__title">' + U.esc(audit.title) + '</h2>' +
          '<div class="dc-head__meta">' + (audit.specialty ? '<span>' + U.esc(audit.specialty) + '</span>' : '') + '<span>' + U.esc(audit.department || '') + '</span>' + collectionBadge(audit) + '</div>' +
        '</div>' +
        (canAdd && tab !== 'entry' ? '<a class="btn btn--primary" href="#/collect/' + audit.id + '/new">' + ui.icon('plus', 16) + 'Add new case</a>' : '') +
      '</div>' +
      '<nav class="dc-tabs" aria-label="Data collection sections">' +
        '<a class="dc-tabs__tab' + (tab === 'cases' || tab === 'entry' || tab === 'case' ? ' is-active' : '') + '" data-tab="cases" href="#/collect/' + audit.id + '">' + ui.icon('fList', 15) + 'Collected data <span class="dc-tabs__count">' + recs.length + '</span></a>' +
        '<a class="dc-tabs__tab' + (tab === 'form' ? ' is-active' : '') + '" data-tab="form" href="#/collect/' + audit.id + '/form">' + ui.icon('fChecks', 15) + 'Form builder <span class="dc-tabs__count">' + (form ? 'v' + form.version : 'Not designed') + '</span><span class="dc-tabs__dot" title="Unsaved changes"' + (builderDirty ? '' : ' hidden') + '></span></a>' +
      '</nav>' +
    '</header>';
  }

  function draftNotice(el, audit) {
    el.innerHTML = '<div class="card">' + ui.emptyState({ icon: 'file', title: 'This audit is still a draft', text: 'Finish and create the audit before designing its data collection form or recording cases.', action: 'Resume draft', href: '#/create/' + audit.id }) + '</div>';
  }

  function recordStatusBadge(r) {
    return r.status === 'completed'
      ? '<span class="badge badge--green">' + ui.icon('check', 12) + 'Completed</span>'
      : '<span class="badge badge--amber">' + ui.icon('collect', 12) + 'Incomplete</span>';
  }

  /* =========================================================
   * Hub — #/collect
   * ========================================================= */
  function renderHub(el, params) {
    const q = params.query || {};
    if (q.audit && store.getAudit(q.audit)) { location.replace('#/collect/' + q.audit); return; }
    const audits = store.getAudits().filter(M.isActive).sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });
    const closed = store.getAudits().filter(function (a) { return a.status === 'completed'; }).length;

    el.innerHTML = '<div class="page-head"><div><h2 class="page-head__title">Data Collection</h2><p class="page-head__sub">Choose an active audit to design its form or record cases · ' + audits.length + ' active audit' + (audits.length === 1 ? '' : 's') + '</p></div></div>' +
      (audits.length
        ? '<div class="hub">' + audits.map(function (a) {
            const cyc = C.currentCycle(a);
            const done = C.completedRecords(a).length;
            const drafts = cyc.records.length - done;
            const pct = Math.min(100, done / Math.max(1, Number(a.targetSampleSize)) * 100);
            const has = C.hasForm(a);
            return '<article class="card hub__item">' +
              '<a class="hub__main" href="#/collect/' + a.id + '">' +
                '<div class="hub__top"><span class="hub__cycle">' + U.esc(cyc.label) + '</span>' + collectionBadge(a) + '</div>' +
                '<h3 class="hub__title">' + U.esc(a.title) + '</h3>' +
                '<p class="hub__meta">' + U.esc(a.specialty || '—') + ' · ' + U.esc(a.department || '') + '</p>' +
                '<div class="hub__progress">' + ui.progressBar(pct, 'Cases collected') + '<span class="num"><strong>' + done + '</strong> / ' + a.targetSampleSize + ' cases' + (drafts ? ' · ' + drafts + ' incomplete' : '') + '</span></div>' +
              '</a>' +
              '<div class="hub__actions">' +
                '<a class="btn btn--ghost btn--sm" href="#/collect/' + a.id + '/form">' + ui.icon('fChecks', 14) + (has ? 'Edit form' : 'Design form') + '</a>' +
                (has ? '<a class="btn btn--secondary btn--sm" href="#/collect/' + a.id + '/new">' + ui.icon('plus', 14) + 'Add case</a>' : '') +
              '</div>' +
            '</article>';
          }).join('') + '</div>'
        : '<div class="card">' + ui.emptyState({ icon: 'collect', title: 'No active audits', text: 'Create an audit, or start a re-audit from a completed one, to begin collecting data.' + (closed ? ' Completed audits keep their data — view it from each audit’s overview.' : ''), action: 'Create audit', href: '#/create', actionIcon: 'plus' }) + '</div>');
  }

  /* =========================================================
   * Cases — #/collect/:id
   * ========================================================= */
  function renderCases(el, params) {
    const audit = store.getAudit(params.id);
    if (!audit) { DA.views.notFound.render(el); return; }
    if (audit.status === 'draft') { draftNotice(el, audit); return; }
    const cyc = C.currentCycle(audit);
    const form = cyc.form;
    const st = listState[audit.id] || (listState[audit.id] = { q: '', status: 'all' });
    const all = cyc.records;
    const done = all.filter(function (r) { return r.status === 'completed'; }).length;
    const target = Number(audit.targetSampleSize) || 0;
    const pct = target ? Math.round(done / target * 100) : 0;
    const canAdd = C.canCollect(audit) && C.hasForm(audit);
    const stale = form && all.some(function (r) { return r.status === 'completed' && (r.scoredWithVersion || r.formVersion) < form.version; });

    el.innerHTML = header(audit, 'cases') +
      (!form || !form.fields.length
        ? '<div class="alert alert--info">' + ui.icon('fChecks', 16) + '<div><strong>Design the data collection form first.</strong> Add the questions you will answer for every case and link them to the audit criteria. <a href="#/collect/' + audit.id + '/form">Open the form builder →</a></div></div>' : '') +
      '<section class="dc-metrics">' +
        metric('Total cases', all.length, 'fList') +
        metric('Completed', done, 'check', 'good') +
        metric('Incomplete', all.length - done, 'collect', all.length - done ? 'warn' : '') +
        metric('Target sample', target, 'target') +
        '<div class="card dc-metric dc-metric--progress"><div class="dc-metric__top"><span>Target achieved</span><strong class="num">' + pct + '%</strong></div>' +
          ui.progressBar(Math.min(100, pct), 'Progress towards target sample') +
          '<span class="dc-metric__foot">' + (done >= target && target ? 'Target sample reached' : Math.max(0, target - done) + ' more completed case' + (target - done === 1 ? '' : 's') + ' needed') + '</span></div>' +
      '</section>' +
      (stale ? '<div class="alert alert--info">' + ui.icon('refresh', 16) + '<div>Some completed cases were scored with an earlier form version. Their stored scores are kept unless you choose to <button class="link-btn" id="rescore">re-score all completed cases with the current rules (v' + form.version + ')</button>.</div></div>' : '') +
      '<section class="card">' +
        '<div class="toolbar">' +
          '<div class="toolbar__search"><span class="toolbar__search-icon">' + ui.icon('search', 16) + '</span><input class="input" id="case-q" type="search" placeholder="Search case reference or answers…" value="' + U.esc(st.q) + '" aria-label="Search cases"></div>' +
          '<div class="seg" role="tablist" aria-label="Filter by completion">' + [['all', 'All'], ['completed', 'Completed'], ['draft', 'Incomplete']].map(function (x) {
            const n = x[0] === 'all' ? all.length : all.filter(function (r) { return r.status === x[0]; }).length;
            return '<button class="seg__btn' + (st.status === x[0] ? ' is-active' : '') + '" data-filter="' + x[0] + '" role="tab" aria-selected="' + (st.status === x[0]) + '">' + x[1] + ' <span class="muted">' + n + '</span></button>';
          }).join('') + '</div>' +
          '<div class="toolbar__end">' +
            (all.length ? '<button class="btn btn--ghost btn--sm" id="export">' + ui.icon('download', 15) + 'Export CSV</button>' : '') +
            (canAdd ? '<a class="btn btn--primary btn--sm" href="#/collect/' + audit.id + '/new">' + ui.icon('plus', 15) + 'Add new case</a>' : '') +
          '</div>' +
        '</div>' +
        '<div id="case-rows"></div>' +
      '</section>';

    const rowsHost = el.querySelector('#case-rows');
    function draw() { rowsHost.innerHTML = rowsHtml(audit, cyc, st, canAdd); bindRows(); }
    function bindRows() {
      rowsHost.querySelectorAll('tr[data-href]').forEach(function (tr) {
        tr.addEventListener('click', function (e) { if (!e.target.closest('a, button')) location.hash = tr.dataset.href; });
        tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target === tr) location.hash = tr.dataset.href; });
      });
      rowsHost.querySelectorAll('[data-del-rec]').forEach(function (b) {
        b.addEventListener('click', function (e) { e.stopPropagation(); confirmDelete(audit, b.dataset.delRec); });
      });
      const clear = rowsHost.querySelector('[data-clear]');
      if (clear) clear.addEventListener('click', function () { st.q = ''; st.status = 'all'; DA.router.refresh(true); });
    }
    draw();
    el.querySelector('#case-q').addEventListener('input', U.debounce(function (e) { st.q = e.target.value; draw(); }, 120));
    el.querySelectorAll('[data-filter]').forEach(function (b) {
      b.addEventListener('click', function () {
        st.status = b.dataset.filter;
        el.querySelectorAll('[data-filter]').forEach(function (x) { x.classList.toggle('is-active', x === b); x.setAttribute('aria-selected', x === b); });
        draw();
      });
    });
    const exp = el.querySelector('#export');
    if (exp) exp.addEventListener('click', function () {
      U.download(U.slug(audit.title) + '-' + U.slug(cyc.label) + '.csv', '﻿' + C.toCSV(audit, cyc), 'text/csv');
      ui.toast('CSV downloaded', 'success');
    });
    const rs = el.querySelector('#rescore');
    if (rs) rs.addEventListener('click', function () {
      ui.confirm({
        title: 'Re-score completed cases?',
        message: 'Criterion results for every completed case will be recalculated using the compliance rules in form v' + form.version + '. Answers are not changed.',
        confirmLabel: 'Re-score cases',
        onConfirm: function () { const n = store.rescoreRecords(audit.id); ui.toast(n + ' cases re-scored', 'success'); DA.router.refresh(true); }
      });
    });
  }

  function metric(label, value, icon, tone) {
    return '<div class="card dc-metric' + (tone ? ' dc-metric--' + tone : '') + '"><div class="dc-metric__top"><span>' + label + '</span><span class="dc-metric__icon">' + ui.icon(icon, 14) + '</span></div><strong class="dc-metric__value num">' + value + '</strong></div>';
  }

  function searchText(cyc, r) {
    const f = C.formForVersion(cyc, r.formVersion) || { fields: [] };
    return [r.caseReference, r.collectionDate, U.fmtDate(r.collectionDate)].concat(f.fields.map(function (fd) {
      return r.responses[fd.id] === undefined ? '' : C.formatValue(fd, r.responses[fd.id]);
    })).join(' ').toLowerCase();
  }

  function rowsHtml(audit, cyc, st, canAdd) {
    const q = st.q.trim().toLowerCase();
    const list = cyc.records.filter(function (r) {
      if (st.status !== 'all' && r.status !== st.status) return false;
      return !q || searchText(cyc, r).indexOf(q) !== -1;
    }).sort(function (a, b) { return b.caseReference.localeCompare(a.caseReference); });

    if (!cyc.records.length) {
      const can = C.canCollect(audit);
      return ui.emptyState({ icon: 'fList', title: 'No cases collected yet',
        text: C.hasForm(audit) ? 'Each case you record appears here with its completion status.' : 'Once the form is designed you can start adding cases.',
        action: canAdd ? 'Add first case' : (can ? 'Design the form' : null), href: canAdd ? '#/collect/' + audit.id + '/new' : '#/collect/' + audit.id + '/form', actionIcon: canAdd ? 'plus' : 'fChecks' });
    }
    if (!list.length) {
      return '<div>' + ui.emptyState({ icon: 'search', title: 'No cases match', text: 'Try another search term or completion filter.' }) + '<div style="text-align:center;margin:-16px 0 28px"><button class="btn btn--secondary btn--sm" data-clear>Clear filters</button></div></div>';
    }
    const editable = C.canCollect(audit);
    return '<div class="table-wrap"><table class="table table--compact case-table"><thead><tr>' +
      '<th>Case</th><th>Collection date</th><th>Fields completed</th><th>Status</th><th class="hide-sm">Last updated</th><th class="cell-actions"><span class="sr-only">Actions</span></th></tr></thead><tbody>' +
      list.map(function (r) {
        const f = C.formForVersion(cyc, r.formVersion) || { fields: [] };
        const answered = C.answeredCount(f, r.responses);
        const total = f.fields.length;
        const older = cyc.form && r.formVersion < cyc.form.version;
        return '<tr class="is-link" tabindex="0" data-href="#/collect/' + audit.id + '/case/' + r.id + '">' +
          '<td><span class="cell-title mono">' + U.esc(r.caseReference) + '</span>' + (older ? '<span class="ver-tag" title="Collected with an earlier form version">v' + r.formVersion + '</span>' : '') + '</td>' +
          '<td class="nowrap">' + U.fmtDate(r.collectionDate) + '</td>' +
          '<td><div class="progress-row progress-row--sm">' + ui.progressBar(total ? answered / total * 100 : 0) + '<span class="small muted num">' + answered + ' / ' + total + '</span></div></td>' +
          '<td>' + recordStatusBadge(r) + '</td>' +
          '<td class="hide-sm muted small nowrap">' + U.relTime(r.updatedAt) + '</td>' +
          '<td class="cell-actions">' +
            '<a class="icon-btn icon-btn--sm" href="#/collect/' + audit.id + '/case/' + r.id + '" aria-label="View ' + r.caseReference + '" title="View">' + ui.icon('eye', 15) + '</a>' +
            (editable ? '<a class="icon-btn icon-btn--sm" href="#/collect/' + audit.id + '/case/' + r.id + '/edit" aria-label="Edit ' + r.caseReference + '" title="Edit">' + ui.icon('collect', 15) + '</a>' +
              '<button class="icon-btn icon-btn--sm icon-btn--danger" data-del-rec="' + r.id + '" aria-label="Delete ' + r.caseReference + '" title="Delete">' + ui.icon('trash', 15) + '</button>' : '') +
          '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function confirmDelete(audit, recId, after) {
    const r = C.records(audit).find(function (x) { return x.id === recId; });
    if (!r) return;
    ui.confirm({
      title: 'Delete ' + r.caseReference + '?',
      message: 'This case and all its answers will be permanently removed and compliance recalculated. The reference ' + r.caseReference + ' will not be reused.',
      confirmLabel: 'Delete case', danger: true,
      onConfirm: function () {
        store.deleteRecord(audit.id, recId);
        ui.toast(r.caseReference + ' deleted', 'success');
        if (after) after(); else DA.router.refresh(true);
      }
    });
  }

  /* =========================================================
   * Case detail — #/collect/:id/case/:caseId
   * ========================================================= */
  function renderCase(el, params) {
    const audit = store.getAudit(params.id);
    if (!audit) { DA.views.notFound.render(el); return; }
    const cyc = C.currentCycle(audit);
    const r = cyc && cyc.records.find(function (x) { return x.id === params.caseId; });
    if (!r) { DA.views.notFound.render(el); return; }
    const form = C.formForVersion(cyc, r.formVersion) || { fields: [] };
    const known = {};
    form.fields.forEach(function (f) { known[f.id] = true; });
    // Answers kept from fields that are not part of this record's form version.
    const allFields = {};
    [cyc.form].concat(cyc.formHistory).forEach(function (f) { if (f) f.fields.forEach(function (x) { if (!allFields[x.id]) allFields[x.id] = x; }); });
    const extra = Object.keys(r.responses).filter(function (k) { return !known[k] && allFields[k] && !C.isEmpty(allFields[k], r.responses[k]); });
    const lab = { met: ['Met', 'good', 'check'], not_met: ['Not met', 'critical', 'x'], na: ['N/A', 'none', 'flag'] };
    const editable = C.canCollect(audit);

    el.innerHTML = header(audit, 'case') +
      '<div class="case-view">' +
        '<section class="card case-view__main">' +
          '<div class="case-view__head"><div class="case-view__id"><span class="case-view__ref mono">' + U.esc(r.caseReference) + '</span>' + recordStatusBadge(r) + '</div>' +
            '<div class="case-view__actions"><a class="btn btn--ghost btn--sm" href="#/collect/' + audit.id + '">' + ui.icon('chevronLeft', 14) + 'All cases</a>' +
            (editable ? '<button class="btn btn--danger-ghost btn--sm" id="del">' + ui.icon('trash', 14) + 'Delete</button><a class="btn btn--primary btn--sm" href="#/collect/' + audit.id + '/case/' + r.id + '/edit">' + ui.icon('collect', 14) + 'Edit case</a>' : '') + '</div></div>' +
          '<dl class="case-meta"><div><dt>Collection date</dt><dd>' + U.fmtDate(r.collectionDate) + '</dd></div><div><dt>Form version</dt><dd>v' + r.formVersion + (cyc.form && r.formVersion < cyc.form.version ? ' <span class="muted">(current v' + cyc.form.version + ')</span>' : '') + '</dd></div>' +
            '<div><dt>Created</dt><dd>' + U.fmtDate(r.createdAt) + '</dd></div><div><dt>Last updated</dt><dd>' + U.relTime(r.updatedAt) + '</dd></div></dl>' +
          '<ol class="answers">' + form.fields.map(function (f) {
            const v = r.responses[f.id];
            const shown = v === undefined || C.isEmpty(f, v) ? '' : C.formatValue(f, v);
            const crit = f.linkedCriterionId ? audit.criteria.find(function (c) { return c.id === f.linkedCriterionId; }) : null;
            return '<li class="answer"><div class="answer__q">' + U.esc(f.label) + (crit ? '<span class="cf__link">' + ui.icon('target', 11) + U.esc(crit.name) + '</span>' : '') + '</div>' +
              '<div class="answer__a' + (shown ? '' : ' is-empty') + '">' + (shown ? U.esc(shown) : 'Not answered') + '</div></li>';
          }).join('') + '</ol>' +
          (extra.length ? '<div class="answers-archived"><h4>' + ui.icon('shield', 13) + 'Answers retained from other form versions</h4><ol class="answers">' + extra.map(function (k) {
            return '<li class="answer"><div class="answer__q">' + U.esc(allFields[k].label) + '</div><div class="answer__a">' + U.esc(C.formatValue(allFields[k], r.responses[k])) + '</div></li>';
          }).join('') + '</ol></div>' : '') +
        '</section>' +
        '<aside class="card case-view__side"><h4>' + ui.icon('target', 14) + 'Criterion results</h4>' +
          (r.status !== 'completed' ? '<p class="muted small">Incomplete cases are not scored. Submit the case to include it in compliance.</p>' :
          '<ul class="score-list">' + audit.criteria.map(function (c, i) {
            const x = r.results && r.results[c.id];
            return '<li><span class="score-list__name"><span class="muted">' + (i + 1) + '.</span> ' + U.esc(c.name) + '</span>' +
              (x ? '<span class="pill pill--' + lab[x][1] + '">' + ui.icon(lab[x][2], 12) + lab[x][0] + '</span>' : '<span class="pill pill--none">Not evidenced</span>') + '</li>';
          }).join('') + '</ul>' + (r.scoredWithVersion && r.scoredWithVersion !== r.formVersion ? '<p class="muted small">Scored with form v' + r.scoredWithVersion + ' rules.</p>' : '')) +
        '</aside>' +
      '</div>';

    const del = el.querySelector('#del');
    if (del) del.addEventListener('click', function () { confirmDelete(audit, r.id, function () { location.hash = '#/collect/' + audit.id; }); });
  }

  /* =========================================================
   * View definitions
   * ========================================================= */
  function crumbsFor(p, last) {
    const a = store.getAudit(p.id);
    const out = [{ label: 'Workspace', href: '#/dashboard' }, { label: 'Data Collection', href: '#/collect' }];
    if (a) out.push(last ? { label: a.title, href: '#/collect/' + a.id } : { label: a.title });
    if (last) out.push({ label: last });
    return out;
  }

  return {
    nav: 'collect',
    title: function () { return 'Data Collection'; },
    crumbs: function () { return [{ label: 'Workspace', href: '#/dashboard' }, { label: 'Data Collection' }]; },
    render: renderHub,
    header: header,
    draftNotice: draftNotice,
    confirmDelete: confirmDelete,
    collectionBadge: collectionBadge,
    crumbsFor: crumbsFor,
    cases: {
      nav: 'collect',
      title: function () { return 'Collected Data'; },
      crumbs: function (p) { return crumbsFor(p, null); },
      render: renderCases
    },
    caseView: {
      nav: 'collect',
      title: function (p) {
        const a = store.getAudit(p.id);
        const r = a && C.records(a).find(function (x) { return x.id === p.caseId; });
        return r ? r.caseReference : 'Case';
      },
      crumbs: function (p) {
        const a = store.getAudit(p.id);
        const r = a && C.records(a).find(function (x) { return x.id === p.caseId; });
        return crumbsFor(p, r ? r.caseReference : 'Case');
      },
      render: renderCase
    }
  };
})();
