/* DentalAudit — My Audits (list, filter, sort, delete) */
DA.views.audits = (function () {
  const U = DA.utils, ui = DA.ui, M = DA.metrics, store = DA.store;

  const state = { status: 'all', dept: 'all', q: '', sort: 'updated', mine: false };
  let lastQueryKey = null;

  const FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'active-stage', label: 'Not started' },
    { key: 'draft', label: 'Drafts' },
    { key: 'collecting', label: 'Data collection' },
    { key: 'analysis', label: 'Analysis' },
    { key: 'action', label: 'Action planning' },
    { key: 'completed', label: 'Completed' },
    { key: 'reaudit', label: 'Re-audit due' }
  ];

  function matchesStatus(a, key) {
    if (key === 'all') return true;
    if (key === 'active') return M.isActive(a);
    if (key === 'reaudit') return M.isReauditDue(a, 30);
    if (key === 'active-stage') return a.status === 'active';
    return a.status === key;
  }

  function filtered() {
    const me = store.getSettings().userName;
    const q = state.q.trim().toLowerCase();
    const list = store.getAudits().filter(function (a) {
      if (!matchesStatus(a, state.status)) return false;
      if (state.dept !== 'all' && a.department !== state.dept) return false;
      if (state.mine && a.auditLead !== me) return false;
      if (q && [a.title, a.description, a.department, a.specialty, a.projectType, a.auditLead, DA.model.references(a).join(' ')].join(' ').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    const by = {
      updated: function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); },
      name: function (a, b) { return a.title.localeCompare(b.title); },
      compliance: function (a, b) { return (M.compliance(b) ?? -1) - (M.compliance(a) ?? -1); },
      due: function (a, b) {
        const da = M.dueDateFor(a);
        const db = M.dueDateFor(b);
        return new Date(da || '2999-01-01') - new Date(db || '2999-01-01');
      }
    };
    return list.sort(by[state.sort] || by.updated);
  }

  function dueCell(a) {
    if (M.isDraft(a)) return '<span class="muted">Not scheduled</span>';
    const date = M.dueDateFor(a);
    if (!date) return '<span class="muted">—</span>';
    const n = U.daysUntil(date);
    const tone = n < 0 ? 'overdue' : n <= 7 ? 'soon' : 'later';
    return '<div class="nowrap">' + U.fmtDate(date) + '</div><div class="dl__due dl__due--' + tone + '">' +
      (M.isActive(a) ? '' : 'Re-audit · ') + U.dueLabel(date) + '</div>';
  }

  function rowsHtml(list) {
    if (!list.length) {
      const any = store.getAudits().length > 0;
      return '<div>' + (any
        ? ui.emptyState({ icon: 'search', title: 'No audits match these filters', text: 'Try a different status, department or search term.' }) +
          '<div style="text-align:center;margin:-16px 0 32px"><button class="btn btn--secondary btn--sm" data-clear>Clear filters</button></div>'
        : ui.emptyState({ icon: 'audits', title: 'You have no audits', text: 'Create an audit from a template, or reload the example data from Settings.', action: 'Create audit', href: '#/create', actionIcon: 'plus' })) + '</div>';
    }
    return '<div class="table-wrap"><table class="table">' +
      '<thead><tr><th>Audit</th><th class="hide-md">Department</th><th>Status</th><th class="hide-sm">Data collected</th><th>Compliance</th><th class="hide-md">Due</th><th class="cell-actions"><span class="sr-only">Actions</span></th></tr></thead><tbody>' +
      list.map(function (a) {
        const comp = M.compliance(a);
        const draft = M.isDraft(a);
        return '<tr class="is-link' + (draft ? ' is-draft' : '') + '" tabindex="0" data-href="' + (draft ? '#/create/' : '#/audits/') + a.id + '">' +
          '<td style="min-width:240px"><div class="cell-title">' + U.esc(a.title || 'Untitled draft') + '</div>' +
            '<div class="cell-sub">' + (draft ? 'Draft · ' : 'Cycle ' + a.cycle + ' · ') + (a.specialty ? U.esc(a.specialty) + ' · ' : '') + 'Lead: ' + U.esc(a.auditLead || '—') + ' · Updated ' + U.relTime(a.updatedAt) + '</div></td>' +
          '<td class="hide-md">' + U.esc(a.department || '—') + '</td>' +
          '<td>' + ui.statusBadge(a.status) + '</td>' +
          (draft
            ? '<td class="hide-sm"><span class="small muted">' + a.criteria.length + ' criteria defined</span></td><td><span class="pill pill--none">—</span></td>'
            : '<td class="hide-sm" style="min-width:140px"><div class="progress-row">' + ui.progressBar(M.progress(a)) +
              '<span class="small muted num">' + DA.collection.completedRecords(a).length + '/' + a.targetSampleSize + '</span></div></td>' +
              '<td>' + ui.compliancePill(comp, M.target(a)) + '</td>') +
          '<td class="hide-md small">' + dueCell(a) + '</td>' +
          '<td class="cell-actions">' +
            '<a class="icon-btn icon-btn--sm" href="#/create/' + a.id + '" data-stop aria-label="' + (draft ? 'Resume' : 'Edit') + ' ' + U.esc(a.title) + '" title="' + (draft ? 'Resume draft' : 'Edit audit') + '">' + ui.icon('collect', 15) + '</a>' +
            '<button class="icon-btn icon-btn--sm icon-btn--danger" data-delete="' + a.id + '" aria-label="Delete ' + U.esc(a.title) + '" title="Delete audit">' + ui.icon('trash', 16) + '</button>' +
          '</td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function counts() {
    const all = store.getAudits();
    const c = {};
    FILTERS.forEach(function (f) { c[f.key] = all.filter(function (a) { return matchesStatus(a, f.key); }).length; });
    return c;
  }

  function confirmDelete(audit, after) {
    ui.confirm({
      title: audit.status === 'draft' ? 'Delete draft?' : 'Delete audit?',
      message: audit.status === 'draft'
        ? '“' + (audit.title || 'Untitled draft') + '” will be permanently removed. This can’t be undone.'
        : '“' + audit.title + '” and its ' + DA.collection.records(audit).length + ' recorded cases will be permanently removed from this browser. This can’t be undone.',
      confirmLabel: audit.status === 'draft' ? 'Delete draft' : 'Delete audit',
      danger: true,
      onConfirm: function () {
        store.deleteAudit(audit.id);
        ui.toast(audit.status === 'draft' ? 'Draft deleted' : 'Audit deleted', 'success');
        if (after) after();
      }
    });
  }

  function render(el, params) {
    const q = params.query || {};
    const qKey = JSON.stringify(q);
    if (qKey !== lastQueryKey) {
      // Arriving from a link (dashboard card, search, profile menu) resets filters to that link.
      lastQueryKey = qKey;
      state.status = q.status || 'all';
      state.q = q.q || '';
      state.mine = q.lead === 'me';
      state.dept = 'all';
    }

    const depts = Array.from(new Set(store.getAudits().map(function (a) { return a.department; }).filter(Boolean))).sort();
    if (state.dept !== 'all' && depts.indexOf(state.dept) === -1) state.dept = 'all';
    const c = counts();

    el.innerHTML =
      '<div class="page-head">' +
        '<div><h2 class="page-head__title">My Audits</h2><p class="page-head__sub">' + (c.all - c.draft) + ' audits · ' + c.active + ' active' + (c.draft ? ' · ' + c.draft + ' draft' + (c.draft === 1 ? '' : 's') : '') + '</p></div>' +
        '<div class="page-head__actions"><a class="btn btn--primary" href="#/create">' + ui.icon('plus', 16) + 'New audit</a></div>' +
      '</div>' +
      '<div class="chips" role="tablist" aria-label="Filter by status">' + FILTERS.map(function (f) {
        return '<button class="chip' + (state.status === f.key ? ' is-active' : '') + '" role="tab" aria-selected="' + (state.status === f.key) + '" data-status="' + f.key + '">' + f.label + ' <span class="chip__count">' + c[f.key] + '</span></button>';
      }).join('') + '</div>' +
      '<section class="card">' +
        '<div class="toolbar">' +
          '<div class="toolbar__search"><span class="toolbar__search-icon">' + ui.icon('search', 16) + '</span>' +
            '<input class="input" id="list-q" type="search" placeholder="Filter by title, standard or lead…" value="' + U.esc(state.q) + '" aria-label="Filter audits"></div>' +
          '<select class="select" id="list-dept" aria-label="Department"><option value="all">All departments</option>' +
            depts.map(function (d) { return '<option' + (d === state.dept ? ' selected' : '') + '>' + U.esc(d) + '</option>'; }).join('') + '</select>' +
          '<select class="select" id="list-sort" aria-label="Sort by">' +
            [['updated', 'Last updated'], ['name', 'Name (A–Z)'], ['compliance', 'Compliance (high–low)'], ['due', 'Next due date']].map(function (o) {
              return '<option value="' + o[0] + '"' + (state.sort === o[0] ? ' selected' : '') + '>Sort: ' + o[1] + '</option>';
            }).join('') + '</select>' +
          (state.mine ? '<button class="chip is-active" id="list-mine">Led by me ' + ui.icon('x', 12) + '</button>' : '') +
        '</div>' +
        '<div id="list-rows">' + rowsHtml(filtered()) + '</div>' +
      '</section>';

    function bindRows() {
      const host = el.querySelector('#list-rows');
      host.querySelectorAll('tr[data-href]').forEach(function (tr) {
        tr.addEventListener('click', function () { location.hash = tr.dataset.href; });
        tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target === tr) location.hash = tr.dataset.href; });
      });
      host.querySelectorAll('[data-stop]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); }); });
      host.querySelectorAll('[data-delete]').forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          confirmDelete(store.getAudit(b.dataset.delete));
        });
      });
      const clear = host.querySelector('[data-clear]');
      if (clear) clear.addEventListener('click', function () {
        state.status = 'all'; state.dept = 'all'; state.q = ''; state.mine = false;
        DA.router.refresh();
      });
    }

    function redrawRows() {
      el.querySelector('#list-rows').innerHTML = rowsHtml(filtered());
      bindRows();
    }

    el.querySelectorAll('[data-status]').forEach(function (b) {
      b.addEventListener('click', function () { state.status = b.dataset.status; DA.router.refresh(); });
    });
    el.querySelector('#list-q').addEventListener('input', U.debounce(function (e) { state.q = e.target.value; redrawRows(); }, 120));
    el.querySelector('#list-dept').addEventListener('change', function (e) { state.dept = e.target.value; redrawRows(); });
    el.querySelector('#list-sort').addEventListener('change', function (e) { state.sort = e.target.value; redrawRows(); });
    const mine = el.querySelector('#list-mine');
    if (mine) mine.addEventListener('click', function () { state.mine = false; DA.router.refresh(); });
    bindRows();
  }

  return {
    nav: 'audits',
    title: function () { return 'My Audits'; },
    crumbs: function () { return [{ label: 'Workspace', href: '#/dashboard' }, { label: 'My Audits' }]; },
    render: render,
    confirmDelete: confirmDelete
  };
})();
