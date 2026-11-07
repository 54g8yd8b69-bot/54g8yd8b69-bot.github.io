/* DentalAudit — Dashboard view */
DA.views = DA.views || {};

DA.charts = DA.charts || {};

/**
 * Horizontal compliance bar chart with per-bar target markers.
 * Shared by Dashboard and Analytics.
 * items: [{ id, label, value, target }]
 */
DA.charts.complianceBars = function (canvas, items, opts) {
  const ui = DA.ui, U = DA.utils;
  const c = ui.chartColors();
  opts = opts || {};

  const targetPlugin = {
    id: 'targetMarkers',
    afterDatasetsDraw: function (chart) {
      const meta = chart.getDatasetMeta(0);
      const x = chart.scales.x;
      const ctx = chart.ctx;
      ctx.save();
      meta.data.forEach(function (bar, i) {
        const t = items[i] && items[i].target;
        if (t === undefined || t === null) return;
        const px = x.getPixelForValue(t);
        const h = bar.height || 14;
        ctx.strokeStyle = c.navy;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(px, bar.y - h / 2 - 3);
        ctx.lineTo(px, bar.y + h / 2 + 3);
        ctx.stroke();
      });
      ctx.restore();
    }
  };

  return ui.makeChart(canvas, {
    type: 'bar',
    data: {
      labels: items.map(function (i) { return i.label; }),
      datasets: [{
        label: 'Compliance',
        data: items.map(function (i) { return i.value === null ? 0 : Math.round(i.value * 10) / 10; }),
        backgroundColor: c.series1,
        hoverBackgroundColor: '#1f63b8',
        borderRadius: 4,
        borderSkipped: 'start',
        barThickness: opts.barThickness || 14,
        maxBarThickness: 18
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500 },
      layout: { padding: { right: 8 } },
      onHover: function (e, els) { e.native.target.style.cursor = els.length && opts.onClick ? 'pointer' : 'default'; },
      onClick: function (e, els) {
        if (els.length && opts.onClick) opts.onClick(items[els[0].index]);
      },
      scales: {
        x: {
          min: 0, max: 100,
          grid: { color: c.grid, drawTicks: false },
          border: { display: false },
          ticks: { stepSize: 25, padding: 6, callback: function (v) { return v + '%'; }, color: c.muted }
        },
        y: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: c.text, padding: 8, autoSkip: false,
            callback: function (v, i) {
              const l = items[i].label;
              const max = opts.labelChars || 34;
              return l.length > max ? l.slice(0, max - 1) + '…' : l;
            }
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: Object.assign(ui.tooltipStyle(), {
          callbacks: {
            title: function (ctx) { return items[ctx[0].dataIndex].fullLabel || items[ctx[0].dataIndex].label; },
            label: function (ctx) {
              const it = items[ctx.dataIndex];
              const r = DA.metrics.rag(it.value, it.target);
              return [
                'Compliance: ' + U.pct(it.value),
                'Target: ' + U.pct(it.target),
                (r === 'good' ? '✓ ' : '! ') + DA.metrics.ragLabel(r)
              ];
            }
          }
        })
      }
    },
    plugins: [targetPlugin]
  });
};

DA.views.dashboard = (function () {
  const U = DA.utils, ui = DA.ui, M = DA.metrics;

  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }

  function metricCard(o) {
    return '<a class="card metric" href="' + o.href + '">' +
      '<div class="metric__top"><span class="metric__label">' + o.label + '</span>' +
      '<span class="metric__icon" style="' + (o.iconStyle || '') + '">' + ui.icon(o.icon, 17) + '</span></div>' +
      '<div class="metric__value">' + o.value + '</div>' +
      '<div class="metric__foot">' + o.foot + '</div>' +
    '</a>';
  }

  function recentTable(audits) {
    if (!audits.length) {
      return ui.emptyState({
        icon: 'audits', title: 'No audits yet',
        text: 'Create your first audit to start tracking compliance against a standard.',
        action: 'Create audit', href: '#/create', actionIcon: 'plus'
      });
    }
    const rows = audits.map(function (a) {
      return '<tr class="is-link" tabindex="0" data-href="#/audits/' + a.id + '">' +
        '<td><div class="cell-title">' + U.esc(a.title) + (a.cycle > 1 ? ' <span class="muted small">· Cycle ' + a.cycle + '</span>' : '') + '</div>' +
          '<div class="cell-sub">Lead: ' + U.esc(a.auditLead || '—') + '</div></td>' +
        '<td class="hide-sm"><div class="truncate" title="' + U.esc(a.department || '') + '">' + U.esc(a.department || '—') + '</div></td>' +
        '<td>' + ui.statusBadge(a.status) + '</td>' +
        '<td class="cell-num nowrap">' + DA.collection.completedRecords(a).length + '<span class="muted"> / ' + a.targetSampleSize + '</span></td>' +
        '<td class="muted hide-sm nowrap">' + U.relTime(a.updatedAt) + '</td>' +
      '</tr>';
    }).join('');
    return '<div class="table-wrap"><table class="table table--compact table--recent">' +
      '<thead><tr><th>Audit</th><th class="hide-sm">Department</th><th>Status</th><th>Cases</th><th class="hide-sm">Last updated</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  function feedIcon(type) {
    const map = { case: 'collect', created: 'plus', completed: 'check', deleted: 'trash', action: 'flag', updated: 'refresh', reaudit: 'repeat', settings: 'settings', import: 'upload', cleared: 'trash' };
    return map[type] || 'activity';
  }

  function activityFeed(items) {
    if (!items.length) {
      return ui.emptyState({ icon: 'activity', title: 'No activity yet', text: 'Changes to your audits will appear here.' });
    }
    return '<ul class="feed">' + items.map(function (a) {
      const audit = a.auditId ? DA.store.getAudit(a.auditId) : null;
      const text = audit
        ? '<a href="#/audits/' + audit.id + '">' + U.esc(a.text) + '</a>'
        : U.esc(a.text);
      return '<li class="feed__item">' +
        '<span class="feed__icon feed__icon--' + a.type + '">' + ui.icon(feedIcon(a.type), 14) + '</span>' +
        '<div><div class="feed__text">' + text + '</div><div class="feed__time">' + U.relTime(a.ts) + '</div></div>' +
      '</li>';
    }).join('') + '</ul>';
  }

  /** Shared with Notifications. */
  function deadlineList(items) {
    if (!items.length) {
      return ui.emptyState({ icon: 'calendar', title: 'Nothing due', text: 'No audits need action in the coming weeks.' });
    }
    return '<ul class="dl">' + items.map(function (d) {
      const date = U.toDate(d.date);
      const tone = d.days < 0 ? 'overdue' : d.days <= 7 ? 'soon' : 'later';
      return '<li class="dl__item"><a href="#/audits/' + d.audit.id + '">' +
        '<span class="dl__date dl__date--' + tone + '"><span class="dl__day">' + date.getDate() + '</span><span class="dl__mon">' + date.toLocaleDateString('en-GB', { month: 'short' }) + '</span></span>' +
        '<span class="dl__body"><span class="dl__title" style="display:block">' + U.esc(d.audit.title) + '</span>' +
        '<span class="dl__meta" style="display:block">' + U.esc(d.kind) + '</span></span>' +
        '<span class="dl__due dl__due--' + tone + '">' + (tone === 'overdue' ? ui.icon('alert', 13) : '') + U.dueLabel(d.date) + '</span>' +
      '</a></li>';
    }).join('') + '</ul>';
  }

  function render(el) {
    const allAudits = DA.store.getAudits();
    const audits = M.live(allAudits);
    const s = DA.store.getSettings();
    const sum = M.summary(allAudits);
    const recent = audits.slice().sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); }).slice(0, 6);
    const deadlines = M.deadlines(audits, s.deadlineWindow).slice(0, 6);
    const drafts = allAudits.filter(M.isDraft).sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });
    const chartItems = audits
      .filter(function (a) { return M.compliance(a) !== null; })
      .sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); })
      .slice(0, 8)
      .map(function (a) {
        return { id: a.id, label: (a.cycle > 1 ? 'C' + a.cycle + ' · ' : '') + a.title, fullLabel: a.title + (a.cycle > 1 ? ' — cycle ' + a.cycle : ''), value: M.compliance(a), target: M.target(a) };
      });
    const firstName = (s.userName || '').split(' ')[0];
    const avgRag = M.rag(sum.avgCompliance, s.defaultTarget);
    const collecting = audits.filter(function (a) { return a.status === 'collecting'; }).length;
    const overdue = deadlines.filter(function (d) { return d.days < 0; }).length;

    el.innerHTML =
      '<div class="page-head">' +
        '<div><h2 class="page-head__title">' + greeting() + (firstName ? ', ' + U.esc(firstName) : '') + '</h2>' +
        '<p class="page-head__sub">' + U.fmtDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ' · ' + U.esc(s.organisation || '') + '</p></div>' +
        '<div class="page-head__actions">' +
          '<a class="btn btn--secondary" href="#/collect">' + ui.icon('collect', 16) + 'Add data</a>' +
          '<a class="btn btn--primary" href="#/create">' + ui.icon('plus', 16) + 'New audit</a>' +
        '</div>' +
      '</div>' +

      '<section class="metrics" aria-label="Key metrics">' +
        metricCard({ label: 'Active Audits', icon: 'audits', value: sum.active, href: '#/audits?status=active',
          foot: collecting + ' collecting data' }) +
        metricCard({ label: 'Completed Audits', icon: 'check', value: sum.completed, href: '#/audits?status=completed',
          iconStyle: 'background:var(--good-soft);color:var(--good-text)', foot: sum.totalCases + ' cases audited in total' }) +
        metricCard({ label: 'Average Compliance', icon: 'target', href: '#/analytics',
          value: sum.avgCompliance === null ? '—' : Math.round(sum.avgCompliance) + '<small>%</small>',
          foot: sum.avgCompliance === null ? 'No case data yet' : '<span class="pill pill--' + avgRag + '">' + ui.icon(avgRag === 'good' ? 'check' : 'alert', 13) + M.ragLabel(avgRag) + '</span><span>vs ' + s.defaultTarget + '% target</span>' }) +
        metricCard({ label: 'Re-audits Due', icon: 'repeat', value: sum.reauditsDue, href: '#/audits?status=reaudit',
          iconStyle: sum.reauditsDue ? 'background:var(--warning-soft);color:var(--warning-text)' : '',
          foot: sum.reauditsDue ? 'Within 30 days or overdue' : 'Nothing due in 30 days' }) +
      '</section>' +

      (drafts.length ? '<a class="draft-banner" href="' + (drafts.length === 1 ? '#/create/' + drafts[0].id : '#/audits?status=draft') + '">' +
        '<span class="draft-banner__icon">' + ui.icon('file', 16) + '</span>' +
        '<span class="draft-banner__text"><strong>' + drafts.length + ' draft audit' + (drafts.length === 1 ? '' : 's') + ' in progress</strong>' +
        '<span>' + (drafts.length === 1 ? U.esc(drafts[0].title || 'Untitled draft') + ' · saved ' + U.relTime(drafts[0].updatedAt) : 'Pick up where you left off') + '</span></span>' +
        '<span class="draft-banner__cta">' + (drafts.length === 1 ? 'Resume' : 'View drafts') + ui.icon('chevronRight', 14) + '</span></a>' : '') +

      '<div class="dash-grid">' +
        '<section class="card dash-recent">' +
          '<div class="card__head"><div><h3 class="card__title">Recent Audits</h3><p class="card__sub">Most recently updated</p></div>' +
          '<a class="card__link" href="#/audits">View all' + ui.icon('chevronRight', 14) + '</a></div>' +
          '<div class="card__body card__body--flush">' + recentTable(recent) + '</div>' +
        '</section>' +

        '<section class="card dash-deadlines">' +
          '<div class="card__head"><div><h3 class="card__title">Upcoming Deadlines</h3><p class="card__sub">' + (overdue ? overdue + ' overdue · ' : '') + 'Next ' + s.deadlineWindow + ' days</p></div></div>' +
          '<div class="card__body card__body--flush">' + deadlineList(deadlines) + '</div>' +
        '</section>' +

        '<section class="card dash-chart">' +
          '<div class="card__head"><div><h3 class="card__title">Compliance Overview</h3><p class="card__sub">Overall compliance per audit against its target</p></div>' +
          (chartItems.length ? '<div class="legend"><span class="legend__item"><span class="legend__swatch"></span>Compliance</span><span class="legend__item"><span class="legend__tick"></span>Target</span></div>' : '') +
          '</div>' +
          '<div class="card__body">' +
            (chartItems.length
              ? '<div class="chart-box" style="height:' + Math.max(220, chartItems.length * 44 + 40) + 'px"><canvas id="dash-compliance" role="img" aria-label="Bar chart of compliance by audit"></canvas></div>'
              : ui.emptyState({ icon: 'analytics', title: 'No compliance data', text: 'Add cases to an audit to see compliance here.', action: 'Add data', href: '#/collect', actionIcon: 'collect' })) +
          '</div>' +
        '</section>' +

        '<section class="card dash-activity">' +
          '<div class="card__head"><div><h3 class="card__title">Audit Activity</h3><p class="card__sub">Recent actions and updates</p></div></div>' +
          '<div class="card__body card__body--flush">' + activityFeed(DA.store.getActivity().slice(0, 6)) + '</div>' +
        '</section>' +
      '</div>';

    // Row navigation
    el.querySelectorAll('tr[data-href]').forEach(function (tr) {
      tr.addEventListener('click', function () { location.hash = tr.dataset.href; });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') location.hash = tr.dataset.href; });
    });

    const canvas = el.querySelector('#dash-compliance');
    if (canvas) {
      DA.charts.complianceBars(canvas, chartItems, {
        onClick: function (it) { location.hash = '#/audits/' + it.id; }
      });
    }
  }

  return {
    nav: 'dashboard',
    title: function () { return 'Dashboard'; },
    crumbs: function () { return [{ label: 'Workspace' }, { label: 'Dashboard' }]; },
    render: render,
    deadlineList: deadlineList,
    activityFeed: activityFeed
  };
})();
