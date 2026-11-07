/* DentalAudit — UI helpers
 * Icons, badges, toasts, modal dialogs, empty states and Chart.js lifecycle.
 */
DA.ui = (function () {
  const U = DA.utils;

  /* ---------- Icons (inline SVG, 24×24, stroke-based) ---------- */
  const PATHS = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    audits: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01"/>',
    create: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/>',
    collect: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    analytics: '<path d="M3 3v18h18"/><path d="M7 16v-5M12 16V8M17 16v-8"/>',
    reports: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronUp: '<path d="m18 15-6-6-6 6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4M12 17h.01"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M8 16H3v5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
    printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    tooth: '<path d="M12 5.5C10.5 4 8.6 3 6.8 3.4 4.2 4 3 6.6 3.6 9.6c.4 2 1.3 3.1 1.8 5.4.5 2.3.7 5.9 2.4 6 1.6.1 2-2.6 2.4-4.3.3-1.2.9-1.8 1.8-1.8s1.5.6 1.8 1.8c.4 1.7.8 4.4 2.4 4.3 1.7-.1 1.9-3.7 2.4-6 .5-2.3 1.4-3.4 1.8-5.4.6-3-.6-5.6-3.2-6.2C15.4 3 13.5 4 12 5.5Z"/>',
    qi: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    arrowRight: '<path d="M5 12h14M13 5l7 7-7 7"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    fType: '<path d="M4 7V5h16v2"/><path d="M9 19h6"/><path d="M12 5v14"/>',
    fAlign: '<path d="M4 6h16M4 10h16M4 14h16M4 18h10"/>',
    fHash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
    fToggle: '<rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="16" cy="12" r="2.5"/>',
    fList: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m9 11 3 3 3-3"/>',
    fChecks: '<path d="m3 7 2 2 4-4M3 17l2 2 4-4M13 6h8M13 12h8M13 18h8"/>',
    fRadio: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
    fCheckbox: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/>',
    fStar: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    grip: '<circle cx="9" cy="6" r="1" fill="currentColor"/><circle cx="15" cy="6" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="18" r="1" fill="currentColor"/><circle cx="15" cy="18" r="1" fill="currentColor"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    lockSm: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>'
  };

  function icon(name, size, cls) {
    const s = size || 18;
    return '<svg class="icon ' + (cls || '') + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (PATHS[name] || '') + '</svg>';
  }

  /* ---------- Badges ---------- */
  function statusBadge(status) {
    const m = DA.metrics.statusMeta(status);
    return '<span class="badge badge--' + m.tone + '"><span class="badge__dot"></span>' + U.esc(m.label) + '</span>';
  }

  /** Compliance pill: icon + value + text so the state never relies on colour alone. */
  function compliancePill(value, target) {
    const r = DA.metrics.rag(value, target);
    if (r === 'none') return '<span class="pill pill--none">No data</span>';
    const ic = r === 'good' ? 'check' : 'alert';
    return '<span class="pill pill--' + r + '" title="' + DA.metrics.ragLabel(r) + ' (target ' + Math.round(target) + '%)">' + icon(ic, 13) + U.pct(value) + '</span>';
  }

  function progressBar(value, label) {
    return '<div class="progress" role="progressbar" aria-valuenow="' + Math.round(value) + '" aria-valuemin="0" aria-valuemax="100"' + (label ? ' aria-label="' + U.esc(label) + '"' : '') + '><span style="width:' + Math.max(0, Math.min(100, value)) + '%"></span></div>';
  }

  function emptyState(opts) {
    return '<div class="empty">' +
      '<div class="empty__icon">' + icon(opts.icon || 'audits', 22) + '</div>' +
      '<h3 class="empty__title">' + U.esc(opts.title) + '</h3>' +
      (opts.text ? '<p class="empty__text">' + U.esc(opts.text) + '</p>' : '') +
      (opts.action ? '<a class="btn btn--primary btn--sm" href="' + opts.href + '">' + (opts.actionIcon ? icon(opts.actionIcon, 16) : '') + U.esc(opts.action) + '</a>' : '') +
      '</div>';
  }

  /* ---------- Toasts ---------- */
  function toast(message, type) {
    const host = document.getElementById('toasts');
    if (!host) return;
    const t = document.createElement('div');
    t.className = 'toast toast--' + (type || 'info');
    t.setAttribute('role', 'status');
    t.innerHTML = icon(type === 'error' ? 'alert' : 'check', 16) + '<span>' + U.esc(message) + '</span>';
    host.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('is-in'); });
    setTimeout(function () {
      t.classList.remove('is-in');
      setTimeout(function () { t.remove(); }, 250);
    }, 3200);
  }

  /* ---------- Modal ---------- */
  let lastFocus = null;

  /**
   * open a modal. opts: { title, body (html), confirmLabel, cancelLabel, danger, onConfirm(form) -> false to keep open }
   */
  function modal(opts) {
    closeModal();
    lastFocus = document.activeElement;
    const root = document.getElementById('modal-root');
    root.innerHTML =
      '<div class="modal-backdrop" data-close></div>' +
      '<div class="modal' + (opts.size ? ' modal--' + opts.size : '') + '" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
        '<form class="modal__form" novalidate>' +
          '<div class="modal__head"><div><h2 id="modal-title">' + U.esc(opts.title) + '</h2>' + (opts.subtitle ? '<p class="modal__sub">' + U.esc(opts.subtitle) + '</p>' : '') + '</div>' +
          '<button type="button" class="icon-btn" data-close aria-label="Close">' + icon('x', 18) + '</button></div>' +
          '<div class="modal__body">' + (opts.body || '') + '</div>' +
          '<div class="modal__foot">' +
            '<button type="button" class="btn btn--ghost" data-close>' + U.esc(opts.cancelLabel || 'Cancel') + '</button>' +
            '<button type="submit" class="btn ' + (opts.danger ? 'btn--danger' : 'btn--primary') + '">' + U.esc(opts.confirmLabel || 'Confirm') + '</button>' +
          '</div>' +
        '</form>' +
      '</div>';
    root.classList.add('is-open');
    const form = root.querySelector('form');
    root.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', closeModal); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const keep = opts.onConfirm ? opts.onConfirm(form) : undefined;
      if (keep !== false) closeModal();
    });
    if (opts.onOpen) opts.onOpen(form);
    const first = form.querySelector('input:not([type=radio]), select, textarea') || form.querySelector('button[type=submit]');
    if (first) setTimeout(function () { first.focus(); }, 30);
  }

  function confirm(opts) {
    modal({
      title: opts.title,
      body: '<p class="modal__text">' + U.esc(opts.message) + '</p>',
      confirmLabel: opts.confirmLabel || 'Confirm',
      danger: opts.danger,
      onConfirm: function () { opts.onConfirm(); }
    });
  }

  function closeModal() {
    const root = document.getElementById('modal-root');
    if (!root || !root.classList.contains('is-open')) return;
    root.classList.remove('is-open');
    root.innerHTML = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
  });

  /* ---------- Charts ---------- */
  const charts = [];

  function chartColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = function (n) { return cs.getPropertyValue(n).trim(); };
    return {
      series1: v('--series-1'), series2: v('--series-2'), series3: v('--series-3'),
      text: v('--text-2'), muted: v('--text-3'), grid: v('--grid'), surface: v('--surface'),
      good: v('--good'), warning: v('--warning'), critical: v('--critical'), navy: v('--text-1')
    };
  }

  function makeChart(canvas, config) {
    if (typeof Chart === 'undefined') {
      canvas.parentElement.innerHTML = '<p class="muted small">Charts unavailable (Chart.js failed to load).</p>';
      return null;
    }
    const c = chartColors();
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = c.text;
    const chart = new Chart(canvas, config);
    charts.push(chart);
    return chart;
  }

  function destroyCharts() {
    while (charts.length) {
      const ch = charts.pop();
      try { ch.destroy(); } catch (e) { /* already gone */ }
    }
  }

  /** Shared tooltip styling. */
  function tooltipStyle() {
    const c = chartColors();
    return {
      backgroundColor: c.navy,
      titleColor: '#fff',
      bodyColor: '#e6e9f2',
      padding: 10,
      cornerRadius: 8,
      displayColors: false,
      titleFont: { weight: '600' }
    };
  }

  return {
    icon, statusBadge, compliancePill, progressBar, emptyState,
    toast, modal, confirm, closeModal,
    makeChart, destroyCharts, chartColors, tooltipStyle
  };
})();
