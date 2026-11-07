/* DentalAudit — application shell
 * Wires routes, the persistent sidebar/top bar, global search,
 * notifications and the profile menu.
 */
(function () {
  const U = DA.utils, ui = DA.ui, M = DA.metrics, store = DA.store, router = DA.router;

  /* ---------- Not found ---------- */
  DA.views.notFound = {
    nav: null,
    title: function () { return 'Not found'; },
    crumbs: function () { return [{ label: 'Workspace', href: '#/dashboard' }, { label: 'Not found' }]; },
    render: function (el) {
      el.innerHTML = '<div class="card">' + ui.emptyState({
        icon: 'alert', title: 'Page not found', text: 'That page doesn’t exist or the audit has been deleted.',
        action: 'Back to dashboard', href: '#/dashboard'
      }) + '</div>';
    }
  };

  /* ---------- Routes ---------- */
  router.add('dashboard', DA.views.dashboard);
  router.add('audits', DA.views.audits);
  router.add('audits/:id', DA.views.auditDetail);
  router.add('create', DA.views.createAudit);
  router.add('create/:id', DA.views.createAudit);
  router.add('collect', DA.views.dataCollection);
  router.add('collect/:id', DA.views.dataCollection.cases);
  router.add('collect/:id/form', DA.views.formBuilder);
  router.add('collect/:id/new', DA.views.caseEntry);
  router.add('collect/:id/case/:caseId', DA.views.dataCollection.caseView);
  router.add('collect/:id/case/:caseId/edit', DA.views.caseEntry);
  router.add('qi', DA.views.qi.landing);
  router.add('qi/new', DA.views.qi.create);
  router.add('qi/:id', DA.views.qi.project);
  router.add('qi/:id/pdsa/:pid', DA.views.pdsa);
  router.add('compare/:id', DA.views.compare);
  router.add('analytics', DA.views.analytics);
  router.add('reports', DA.views.reports);
  router.add('reports/new', DA.views.reports.create);
  router.add('reports/:id', DA.views.reportEditor);
  router.add('reports/:id/preview', DA.views.reportEditor.preview);
  router.add('settings', DA.views.settings);

  /* ---------- Static icons in the shell ---------- */
  function paintIcons(root) {
    (root || document).querySelectorAll('[data-icon]').forEach(function (n) {
      if (n.dataset.painted) return;
      n.innerHTML = ui.icon(n.dataset.icon, n.dataset.size ? Number(n.dataset.size) : 18);
      n.dataset.painted = '1';
    });
  }

  /* ---------- Header: title, breadcrumbs, active nav ---------- */
  router.onAfter(function (view, params) {
    const title = view.title(params);
    document.getElementById('page-title').textContent = title;
    document.title = title + ' · DentalAudit';
    const crumbs = view.crumbs(params);
    document.getElementById('crumbs').innerHTML = crumbs.map(function (c, i) {
      const sep = i ? ui.icon('chevronRight', 12) : '';
      return sep + (c.href ? '<a href="' + c.href + '">' + U.esc(c.label) + '</a>' : '<span>' + U.esc(c.label) + '</span>');
    }).join('');
    const navKey = view.navFor ? view.navFor(params) : view.nav;
    document.querySelectorAll('.nav__item').forEach(function (a) {
      const on = a.dataset.nav === navKey;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    closeNav();
    closePopovers();
  });

  /* ---------- Shell state (counts, profile, notifications) ---------- */
  function updateShell() {
    const s = store.getSettings();
    const audits = store.getAudits();
    const active = audits.filter(M.isActive).length;
    document.getElementById('nav-count-audits').textContent = audits.length ? String(active) : '';
    document.getElementById('nav-count-audits').title = active + ' active';
    const overdueIv = store.getInterventions().filter(DA.qi.isOverdue).length;
    const qiCount = document.getElementById('nav-count-qi');
    qiCount.textContent = overdueIv ? String(overdueIv) : '';
    qiCount.title = overdueIv ? overdueIv + ' overdue intervention' + (overdueIv === 1 ? '' : 's') : '';
    document.getElementById('avatar').textContent = U.initials(s.userName);
    document.getElementById('profile-name').textContent = s.userName || 'Your name';
    document.getElementById('profile-role').textContent = s.userRole || '';
    const note = document.getElementById('storage-note');
    note.classList.toggle('is-off', !store.isPersistent());
    note.lastElementChild.textContent = store.isPersistent() ? 'Saved in this browser' : 'Storage unavailable — changes won’t persist';
    const unread = notifications().filter(function (n) { return n.unread; }).length;
    document.getElementById('notif-dot').hidden = unread === 0;
    document.getElementById('notif-btn').setAttribute('aria-label', 'Notifications' + (unread ? ' (' + unread + ' unread)' : ''));
    if (!document.getElementById('notif-panel').hidden) renderNotifications();
  }

  store.subscribe(function (reason) {
    updateShell();
    if (reason !== 'notifications') router.refresh(reason === 'reset' || reason === 'clear' || reason === 'import');
  });

  /* ---------- Mobile navigation ---------- */
  const app = document.getElementById('app');
  const scrim = document.getElementById('scrim');
  const menuBtn = document.getElementById('menu-btn');
  function openNav() { app.classList.add('nav-open'); scrim.hidden = false; menuBtn.setAttribute('aria-expanded', 'true'); }
  function closeNav() { app.classList.remove('nav-open'); scrim.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); }
  menuBtn.addEventListener('click', function () { app.classList.contains('nav-open') ? closeNav() : openNav(); });
  scrim.addEventListener('click', closeNav);

  /* ---------- Popovers ---------- */
  const popovers = [
    { btn: document.getElementById('notif-btn'), panel: document.getElementById('notif-panel'), onOpen: renderNotifications },
    { btn: document.getElementById('profile-btn'), panel: document.getElementById('profile-menu'), onOpen: renderProfileMenu }
  ];
  function closePopovers(except) {
    popovers.forEach(function (p) {
      if (p === except) return;
      p.panel.hidden = true;
      p.btn.setAttribute('aria-expanded', 'false');
    });
    if (except !== 'search') hideResults();
  }
  popovers.forEach(function (p) {
    p.btn.addEventListener('click', function (e) {
      e.stopPropagation();
      const open = p.panel.hidden;
      closePopovers(p);
      if (open) { p.onOpen(); p.panel.hidden = false; p.btn.setAttribute('aria-expanded', 'true'); }
      else { p.panel.hidden = true; p.btn.setAttribute('aria-expanded', 'false'); }
    });
    p.panel.addEventListener('click', function (e) { e.stopPropagation(); });
  });
  document.addEventListener('click', function () { closePopovers(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePopovers(); });

  /* ---------- Notifications ---------- */
  function notifications() {
    const seen = store.getNotificationsSeen();
    const list = M.deadlines(store.getAudits(), 14).map(function (d) {
      const key = d.audit.id + '|' + d.kind.split(' (')[0] + '|' + d.date;
      const tone = d.days < 0 ? 'critical' : d.days <= 7 ? 'warning' : 'info';
      return { key: key, d: d, tone: tone, unread: seen.indexOf(key) === -1, href: '#/audits/' + d.audit.id };
    });
    // Interventions that are overdue or due within 7 days.
    store.getInterventions().forEach(function (iv) {
      if (DA.qi.OPEN.indexOf(iv.status) === -1 || !iv.targetDate) return;
      const days = U.daysUntil(iv.targetDate);
      if (days === null || days > 7) return;
      const p = store.getQiProject(iv.projectId);
      const key = 'iv|' + iv.id + '|' + iv.targetDate;
      list.push({ key: key, tone: days < 0 ? 'critical' : 'warning', unread: seen.indexOf(key) === -1, href: '#/qi/' + iv.projectId + '?tab=interventions&iv=' + iv.id,
        d: { kind: 'Intervention “' + iv.title + '”', days: days, date: iv.targetDate, audit: { title: p ? p.title : 'Improvement project' } } });
    });
    return list.sort(function (x, y) { return x.d.days - y.d.days; });
  }

  function renderNotifications() {
    const panel = document.getElementById('notif-panel');
    const list = notifications();
    const unread = list.filter(function (n) { return n.unread; }).length;
    panel.innerHTML =
      '<div class="popover__head"><span class="popover__title">Notifications</span>' +
      (unread ? '<button class="btn btn--ghost btn--sm" id="notif-read">Mark all as read</button>' : '<span class="muted small">All caught up</span>') + '</div>' +
      (list.length
        ? '<div class="notif__list">' + list.map(function (n) {
            const verb = n.d.days < 0 ? 'is overdue' : 'is due ' + U.dueLabel(n.d.date).toLowerCase().replace('due ', '');
            return '<a class="popover__item notif__item" href="' + n.href + '">' +
              '<span class="notif__icon notif__icon--' + n.tone + '">' + ui.icon(n.tone === 'info' ? 'calendar' : 'alert', 15) + '</span>' +
              '<span class="result__body"><span class="result__title" style="display:block">' + U.esc(n.d.kind) + ' ' + verb + '</span>' +
              '<span class="result__meta" style="display:block">' + U.esc(n.d.audit.title) + ' · ' + U.fmtDate(n.d.date) + '</span></span>' +
              (n.unread ? '<span class="notif__unread" aria-label="Unread"></span>' : '') +
            '</a>';
          }).join('') + '</div>'
        : '<div class="popover__empty">' + ui.icon('check', 18, 'center') + '<p style="margin-top:8px">No deadlines in the next 14 days.</p></div>');
    const btn = panel.querySelector('#notif-read');
    if (btn) btn.addEventListener('click', function () {
      store.markNotificationsRead(list.map(function (n) { return n.key; }));
      renderNotifications();
    });
    panel.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', function () { closePopovers(); }); });
  }

  /* ---------- Profile menu ---------- */
  function renderProfileMenu() {
    const s = store.getSettings();
    const panel = document.getElementById('profile-menu');
    panel.innerHTML =
      '<div class="profile-menu__head"><span class="avatar avatar--lg">' + U.esc(U.initials(s.userName)) + '</span>' +
      '<div style="min-width:0"><div style="font-weight:600">' + U.esc(s.userName) + '</div>' +
      '<div class="muted small">' + U.esc(s.userRole) + '</div><div class="muted small">' + U.esc(s.organisation) + '</div></div></div>' +
      '<div class="popover__sep"></div>' +
      '<a class="popover__item" role="menuitem" href="#/settings">' + ui.icon('user', 16) + 'Profile &amp; settings</a>' +
      '<a class="popover__item" role="menuitem" href="#/audits?lead=me">' + ui.icon('audits', 16) + 'Audits I lead</a>' +
      '<button class="popover__item" role="menuitem" type="button" data-act="export">' + ui.icon('download', 16) + 'Export all data (JSON)</button>' +
      '<div class="popover__sep"></div>' +
      '<button class="popover__item popover__item--danger" role="menuitem" type="button" data-act="reset">' + ui.icon('refresh', 16) + 'Reset demo data</button>';
    panel.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', function () { closePopovers(); }); });
    panel.querySelector('[data-act=export]').addEventListener('click', function () {
      U.download('dentalaudit-export-' + U.isoDay(new Date()) + '.json', store.exportJSON(), 'application/json');
      closePopovers();
      ui.toast('Data exported', 'success');
    });
    panel.querySelector('[data-act=reset]').addEventListener('click', function () {
      closePopovers();
      DA.views.settings.confirmReset();
    });
  }

  /* ---------- Global search ---------- */
  const searchWrap = document.getElementById('search');
  const searchInput = document.getElementById('search-input');
  const results = document.getElementById('search-results');
  let focusIdx = -1;

  function highlight(text, q) {
    const safe = U.esc(text);
    if (!q) return safe;
    const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
    return safe.replace(re, '<mark>$1</mark>');
  }

  function searchAudits(q) {
    const t = q.toLowerCase();
    return store.getAudits().filter(function (a) {
      return [a.title, a.description, a.department, a.specialty, a.projectType, a.auditLead, DA.model.references(a).join(' ')].join(' ').toLowerCase().indexOf(t) !== -1;
    });
  }

  function renderResults() {
    const q = searchInput.value.trim();
    focusIdx = -1;
    if (!q) { hideResults(); return; }
    const found = searchAudits(q).slice(0, 7);
    results.innerHTML = found.length
      ? found.map(function (a, i) {
          return '<a class="popover__item" role="option" data-idx="' + i + '" href="' + (a.status === 'draft' ? '#/create/' : '#/audits/') + a.id + '">' + ui.icon('file', 16) +
            '<span class="result__body"><span class="result__title" style="display:block">' + highlight(a.title, q) + '</span>' +
            '<span class="result__meta" style="display:block">' + highlight(a.department || '', q) + ' · ' + M.statusMeta(a.status).label + '</span></span></a>';
        }).join('') +
        '<div class="popover__sep"></div><a class="popover__item" href="#/audits?q=' + encodeURIComponent(q) + '">' + ui.icon('search', 16) + 'See all results for “' + U.esc(q) + '”</a>'
      : '<div class="popover__empty">No audits match “' + U.esc(q) + '”</div>';
    results.hidden = false;
    results.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('mousedown', function (e) { e.preventDefault(); });
      a.addEventListener('click', function () { clearSearch(); });
    });
  }

  function hideResults() { results.hidden = true; }
  function clearSearch() { searchInput.value = ''; hideResults(); searchWrap.classList.remove('is-open'); searchInput.blur(); }

  searchInput.addEventListener('input', U.debounce(renderResults, 80));
  searchInput.addEventListener('focus', function () { searchWrap.classList.add('is-open'); closePopovers('search'); if (searchInput.value) renderResults(); });
  searchInput.addEventListener('blur', function () { setTimeout(function () { hideResults(); if (!searchInput.value) searchWrap.classList.remove('is-open'); }, 120); });
  searchInput.addEventListener('click', function (e) { e.stopPropagation(); });
  searchInput.addEventListener('keydown', function (e) {
    const items = results.querySelectorAll('a.popover__item');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault();
      focusIdx = (focusIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach(function (it, i) { it.classList.toggle('is-focused', i === focusIdx); });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const q = searchInput.value.trim();
      if (focusIdx >= 0 && items[focusIdx]) location.hash = items[focusIdx].getAttribute('href');
      else if (q) location.hash = '#/audits?q=' + encodeURIComponent(q);
      clearSearch();
    } else if (e.key === 'Escape') {
      clearSearch();
    }
  });

  document.addEventListener('keydown', function (e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (e.key === '/' && tag !== 'input' && tag !== 'textarea' && tag !== 'select' && !e.target.isContentEditable) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  /* ---------- Boot ---------- */
  store.load();
  paintIcons();
  updateShell();
  router.start();
})();
