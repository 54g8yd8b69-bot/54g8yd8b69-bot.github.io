/* DentalAudit — quality improvement & re-audit report content
 *
 * Adds QI / re-audit sections to the report generator. All figures are frozen into
 * report.analyticsSnapshot.qi when the report is generated or refreshed, so later
 * changes to interventions, PDSA records or case data never silently alter a report.
 * Sections are deterministic text built from stored records; nothing is invented.
 */
DA.qiReport = (function () {
  const U = DA.utils, Q = DA.qi;
  const esc = U.esc;

  const SECTIONS = [
    { key: 'reauditmethod', title: 'Re-audit Methodology', after: 'methodology' },
    { key: 'qibaseline', title: 'Baseline Findings', after: 'reauditmethod' },
    { key: 'opportunities', title: 'Identified Improvement Opportunities', after: 'qibaseline' },
    { key: 'interventions', title: 'Intervention Descriptions', after: 'opportunities' },
    { key: 'pdsamethod', title: 'PDSA Methodology', after: 'interventions' },
    { key: 'implementation', title: 'Intervention Implementation', after: 'pdsamethod' },
    { key: 'comparison', title: 'Cycle Comparison', after: 'results' },
    { key: 'compliancechange', title: 'Changes in Compliance', after: 'comparison' },
    { key: 'lessons', title: 'Lessons Learned', after: 'discussion' },
    { key: 'sustainability', title: 'Sustainability Plan', after: 'actionplan' },
    { key: 'future', title: 'Future Recommendations', after: 'conclusion' }
  ];
  const KEYS = SECTIONS.map(function (s) { return s.key; });
  const DESC = {
    reauditmethod: 'How the re-audit cycle repeated the baseline method',
    qibaseline: 'Baseline cycle results that started the project',
    opportunities: 'Criteria below target, gaps and priorities',
    interventions: 'What was changed, why, who owned it',
    pdsamethod: 'How changes were tested in PDSA cycles',
    implementation: 'What was implemented, deviations and problems',
    comparison: 'Baseline vs re-audit table and charts',
    compliancechange: 'Absolute and relative change per criterion',
    lessons: 'What the team learned from PDSA cycles',
    sustainability: 'How improvements will be maintained',
    future: 'Next steps tied to remaining findings'
  };
  const DEFAULTS = {
    qi: KEYS.slice(),
    reaudit: ['reauditmethod', 'qibaseline', 'interventions', 'implementation', 'comparison', 'compliancechange', 'lessons', 'sustainability', 'future']
  };

  function block(key) { return '<div class="rb" data-block="' + key + '" contenteditable="false"></div>'; }
  function ph(t) { return '<p class="ph">[' + esc(t) + ']</p>'; }
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : (b || a + 's')); }
  function joinList(items) { return items.length <= 1 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]; }
  function lower(s) { s = String(s || ''); return s.charAt(0).toLowerCase() + s.slice(1); }

  /* =========================================================
   * Snapshot
   * ========================================================= */
  function compareFromKey(audit, cyc, opts) {
    const toKey = Q.refKey(audit, cyc);
    const p = opts.projectId && DA.store.getQiProject(opts.projectId);
    const cands = [opts.compareFrom, p && p.baseline && p.baseline.refKey];
    const ser = Q.series(audit);
    const i = ser.findIndex(function (r) { return r.key === toKey; });
    if (i > 0) cands.push(ser[i - 1].key);
    return cands.find(function (k) { return k && k !== toKey && Q.ref(k); }) || null;
  }

  function buildQi(audit, cyc, opts) {
    const o = opts || {};
    const p = o.projectId ? DA.store.getQiProject(o.projectId) : null;
    if (!cyc) return null;
    const toKey = Q.refKey(audit, cyc);
    const fromKey = compareFromKey(audit, cyc, o);
    const cmp = fromKey ? Q.compare(fromKey, toKey) : null;
    const keyOf = Q.criterionKeyer(audit);
    const critName = function (id) {
      const b = p && p.baseline && p.baseline.rows.find(function (r) { return r.criterionId === id; });
      const c = audit.criteria.find(function (x) { return x.id === id; });
      return (b || c || {}).name || '';
    };
    const ivs = p ? Q.interventionsFor(p.id) : [];
    const pdsa = p ? Q.pdsaFor(p.id) : [];
    const ser = Q.series(audit).map(function (r) { const x = Q.cycleResults(r); return { key: r.key, label: x.label, completed: x.completed, records: x.records, completeness: x.completeness, compliance: x.overall.compliance }; });
    const base = p && p.baseline ? p.baseline : null;
    return {
      schema: 1,
      project: p ? { id: p.id, title: p.title, aim: p.aim, description: p.description, projectLead: p.projectLead, collaborators: p.collaborators.slice(), startDate: p.startDate, targetCompletionDate: p.targetCompletionDate, status: Q.projectStatusMeta(p).label, priority: (Q.PRIORITY[p.priority] || {}).label } : null,
      baseline: base ? {
        cycleLabel: base.cycleLabel, completed: base.completed, records: base.records, capturedAt: base.capturedAt, overall: base.overall,
        collectedFrom: base.collectedFrom, collectedTo: base.collectedTo,
        rows: base.rows.map(function (r) { return Object.assign({}, r, { userPriority: (Q.PRIORITY[(p.criteriaPriority || {})[r.criterionId]] || {}).label || '', targeted: (p.targetCriteria || []).indexOf(r.criterionId) !== -1, clinicalNote: (p.clinicalImportance || {})[r.criterionId] || '' }); })
      } : (cmp ? { cycleLabel: cmp.a.label, completed: cmp.a.completed, records: cmp.a.records, capturedAt: new Date().toISOString(), overall: cmp.a.overall, collectedFrom: cmp.a.collectedFrom, collectedTo: cmp.a.collectedTo, fromComparison: true,
        rows: cmp.a.rows.map(function (r) { return { criterionId: r.id, key: r.key, name: r.name, target: r.target, compliance: r.compliance, met: r.met, notMet: r.notMet, na: r.na, missing: r.missing, denominator: r.denominator, achieved: r.achieved, gap: r.gap, userPriority: '', targeted: r.achieved === false, clinicalNote: '' }; }) } : null),
      interventions: ivs.map(function (i) {
        const last = i.progressNotes.filter(function (n) { return !n.system; }).slice(-1)[0];
        return {
          title: i.title, criterion: critName(i.criterionId), criterionKey: i.criterionId ? keyOf(i.criterionId) : null, identifiedProblem: i.identifiedProblem, description: i.description, proposedSolution: i.proposedSolution,
          expectedOutcome: i.expectedOutcome, responsiblePerson: i.responsiblePerson, supportingTeam: i.supportingTeam.slice(), startDate: i.startDate, targetDate: i.targetDate, reviewDate: i.reviewDate,
          startedAt: i.startedAt, completedAt: i.completedAt, status: Q.ivStatus(i).label, statusKey: Q.ivStatus(i).key, successMeasure: i.successMeasure,
          effectiveness: i.effectiveness && i.effectiveness.rating ? { rating: Q.EFFECTIVENESS[i.effectiveness.rating], notes: i.effectiveness.notes } : null,
          notes: i.progressNotes.filter(function (n) { return !n.system; }).length, lastNote: last ? { at: last.at, text: last.text } : null,
          fromReport: !!(i.source && i.source.type === 'report_action')
        };
      }),
      pdsa: pdsa.map(function (x) {
        return { n: x.cycleNumber, status: Q.PDSA_STATUS[Q.pdsaStatus(x)].label, intervention: x.interventionId && DA.store.getIntervention(x.interventionId) ? DA.store.getIntervention(x.interventionId).title : '',
          plan: Object.assign({}, x.plan), do: Object.assign({}, x.do), study: Object.assign({}, x.study, { linkedAnalytics: x.study.linkedAnalytics ? JSON.parse(JSON.stringify(x.study.linkedAnalytics)) : null }),
          act: Object.assign({}, x.act, { decisionLabel: x.act.decision ? Q.ACT_DECISIONS[x.act.decision].label : '' }) };
      }),
      comparison: cmp ? {
        fromKey: fromKey, toKey: toKey, aLabel: cmp.a.label, bLabel: cmp.b.label, a: { completed: cmp.a.completed, records: cmp.a.records, completeness: cmp.a.completeness, collectedFrom: cmp.a.collectedFrom, collectedTo: cmp.a.collectedTo, formVersion: cmp.a.formVersion },
        b: { completed: cmp.b.completed, records: cmp.b.records, completeness: cmp.b.completeness, collectedFrom: cmp.b.collectedFrom, collectedTo: cmp.b.collectedTo, formVersion: cmp.b.formVersion },
        overall: cmp.overall, included: cmp.included, warnings: cmp.warnings, notes: cmp.notes,
        rows: cmp.rows.map(function (r) { return { key: r.key, name: r.name, target: r.target, a: r.a ? { compliance: r.a.compliance, met: r.a.met, notMet: r.a.notMet, missing: r.a.missing, denominator: r.a.denominator } : null, b: r.b ? { compliance: r.b.compliance, met: r.b.met, notMet: r.b.notMet, missing: r.b.missing, denominator: r.b.denominator } : null, pp: r.pp, rel: r.rel, relNote: r.relNote, level: r.level, reasons: r.reasons.slice(), excluded: r.excluded, dMet: r.dMet, dNotMet: r.dNotMet, dMissing: r.dMissing }; })
      } : null,
      series: ser,
      cycle: { label: cyc.label, number: cyc.number, startedAt: cyc.startedAt, collectionStartDate: cyc.collectionStartDate, collectionEndDate: cyc.collectionEndDate, createdFrom: cyc.createdFrom ? Object.assign({}, cyc.createdFrom) : null, note: cyc.note || '', formVersion: cyc.form ? cyc.form.version : null },
      fingerprint: fingerprint(audit, cyc, o)
    };
  }

  /** Changes when anything a QI report depends on changes (interventions, PDSA, comparison cycle data). */
  function fingerprint(audit, cyc, opts) {
    const o = opts || {};
    const p = o.projectId && DA.store.getQiProject(o.projectId);
    const parts = [];
    if (p) {
      parts.push(p.updatedAt);
      Q.interventionsFor(p.id).forEach(function (i) { parts.push(i.id + i.updatedAt); });
      Q.pdsaFor(p.id).forEach(function (x) { parts.push(x.id + x.updatedAt); });
    }
    const from = cyc ? compareFromKey(audit, cyc, o) : null;
    const r = from && Q.ref(from);
    if (r) r.cycle.records.forEach(function (x) { parts.push(x.id + x.status + x.updatedAt); });
    return DA.utils.slug(String(parts.length)) + '_' + hash(parts.join('|'));
  }
  function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

  function changed(report) {
    if (!report.analyticsSnapshot || !report.analyticsSnapshot.qi) return false;
    const a = DA.store.getAudit(report.auditId);
    const cyc = a && DA.collection.cycleById(a, report.cycleId);
    if (!a || !cyc) return false;
    return fingerprint(a, cyc, { projectId: report.qiProjectId, compareFrom: report.compareFrom }) !== report.analyticsSnapshot.qi.fingerprint;
  }

  /** Numbers that legitimately appear in QI content (for checking AI drafts). */
  function numbers(qi, add) {
    if (!qi) return;
    if (qi.baseline) { [qi.baseline.completed, qi.baseline.overall.compliance, qi.baseline.overall.met, qi.baseline.overall.applicable].forEach(add); qi.baseline.rows.forEach(function (r) { [r.compliance, r.met, r.notMet, r.denominator, r.missing, r.target, r.gap].forEach(add); }); }
    if (qi.comparison) {
      const c = qi.comparison;
      [c.a.completed, c.b.completed, c.a.completeness, c.b.completeness, c.overall.pp, c.overall.rel, c.overall.a.compliance, c.overall.b.compliance].forEach(add);
      c.rows.forEach(function (r) { [r.pp, r.rel, r.dMet, r.dNotMet, r.dMissing, r.a && r.a.compliance, r.b && r.b.compliance, r.a && r.a.met, r.b && r.b.met, r.a && r.a.denominator, r.b && r.b.denominator].forEach(add); });
    }
    qi.series.forEach(function (s) { [s.completed, s.compliance].forEach(add); });
    qi.pdsa.forEach(function (x) { add(x.n); });
  }

  /* =========================================================
   * Data blocks — one table spec rendered to HTML, PDF and Word
   * ========================================================= */
  const BLOCKS = {
    'qi-baseline': { kind: 'table', label: 'Baseline results table' },
    'qi-interventions': { kind: 'table', label: 'Intervention table' },
    'qi-pdsa': { kind: 'table', label: 'PDSA cycle summary' },
    'cmp-summary': { kind: 'summary', label: 'Cycle comparison key figures' },
    'cmp-table': { kind: 'table', label: 'Cycle comparison table (pp and relative change)' },
    'chart-cmp': { kind: 'figure', label: 'Baseline vs re-audit chart' },
    'chart-cmp-pp': { kind: 'figure', label: 'Percentage-point change chart' }
  };
  function has(key) { return !!BLOCKS[key]; }

  function insertable(report) {
    const qi = report.analyticsSnapshot && report.analyticsSnapshot.qi;
    if (!qi) return [];
    const out = [];
    if (qi.baseline) out.push({ key: 'qi-baseline', label: 'Baseline results table' });
    if (qi.interventions.length) out.push({ key: 'qi-interventions', label: 'Intervention table' });
    if (qi.pdsa.length) out.push({ key: 'qi-pdsa', label: 'PDSA cycle summary' });
    if (qi.comparison) out.push({ key: 'cmp-summary', label: 'Cycle comparison key figures' }, { key: 'cmp-table', label: 'Cycle comparison table' }, { key: 'chart-cmp', label: 'Baseline vs re-audit chart', chart: true }, { key: 'chart-cmp-pp', label: 'Percentage-point change chart', chart: true });
    return out;
  }

  function src(qi, extra) {
    return { type: 'source', text: 'Source: DentalAudit analytics engine and improvement records, frozen ' + U.fmtDate(new Date(), { day: 'numeric', month: 'short', year: 'numeric' }) + (extra ? ' · ' + extra : '') };
  }

  /** Parts: {type:'table'|'kpis'|'chart'|'note'|'source'|'caption', …}. */
  function parts(key, report) {
    const qi = report.analyticsSnapshot && report.analyticsSnapshot.qi;
    if (!qi) return [{ type: 'note', text: 'Quality improvement data were not captured in this snapshot. Refresh the report data.' }];
    const P = function (v) { return Q.fmtPct(v); };
    const snapDate = U.fmtDate(report.snapshotAt, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const source = { type: 'source', text: 'Source: DentalAudit analytics snapshot, ' + snapDate + ' · completed cases only; N/A excluded from denominators.' };
    switch (key) {
      case 'qi-baseline': {
        const b = qi.baseline;
        if (!b) return [{ type: 'note', text: 'No baseline cycle recorded.' }];
        return [{ type: 'caption', kind: 'table', text: 'Baseline results — ' + b.cycleLabel + ' (' + b.completed + ' completed cases)' },
          { type: 'table', head: ['Criterion', 'Target', 'Baseline', 'Compliant', 'Non-compliant', 'Eligible', 'Missing', 'Target achieved'], center: [1, 2, 3, 4, 5, 6, 7], widths: [30, 8, 10, 10, 11, 9, 9, 13],
            body: b.rows.map(function (r) { return [r.name, r.target + '%', P(r.compliance), String(r.met), String(r.notMet), String(r.denominator), String(r.missing), r.achieved === null ? 'No data' : r.achieved ? 'Achieved' : 'Not achieved']; }) },
          { type: 'source', text: (b.fromComparison ? 'Baseline taken from ' + b.cycleLabel + ' results. ' : 'Baseline imported into the improvement project on ' + U.fmtDate(b.capturedAt) + '. ') + source.text.replace('Source: ', 'Source: ') }];
      }
      case 'qi-interventions':
        if (!qi.interventions.length) return [{ type: 'note', text: 'No interventions recorded.' }];
        return [{ type: 'caption', kind: 'table', text: 'Improvement interventions' },
          { type: 'table', small: true, head: ['#', 'Identified issue', 'Intervention', 'Criterion', 'Responsible', 'Target date', 'Completed', 'Success measure', 'Status'], widths: [4, 17, 18, 13, 11, 9, 9, 12, 8],
            body: qi.interventions.map(function (i, n) { return [String(n + 1), i.identifiedProblem || '—', i.title, i.criterion || '—', i.responsiblePerson || '—', i.targetDate ? U.fmtDate(i.targetDate) : '—', i.completedAt ? U.fmtDate(i.completedAt) : '—', i.successMeasure || '—', i.status]; }) },
          { type: 'source', text: 'Source: improvement project “' + (qi.project ? qi.project.title : '') + '”, status as at ' + snapDate + '.' }];
      case 'qi-pdsa':
        if (!qi.pdsa.length) return [{ type: 'note', text: 'No PDSA cycles recorded.' }];
        return [{ type: 'caption', kind: 'table', text: 'PDSA cycles' },
          { type: 'table', small: true, head: ['Cycle', 'Change tested', 'Dates', 'Prediction', 'What happened (Study)', 'Decision'], widths: [7, 20, 13, 20, 26, 14],
            body: qi.pdsa.map(function (x) { return ['PDSA ' + x.n, x.plan.change || '—', (x.plan.startDate ? U.fmtDate(x.plan.startDate) : '—') + ' – ' + (x.plan.endDate ? U.fmtDate(x.plan.endDate) : '—'), x.plan.prediction || '—', x.study.results || '—', x.act.decisionLabel ? x.act.decisionLabel + (x.act.rationale ? ': ' + x.act.rationale : '') : x.status]; }) }];
      case 'cmp-summary': {
        const c = qi.comparison;
        if (!c) return [{ type: 'note', text: 'No earlier cycle to compare with.' }];
        return [{ type: 'kpis', pairs: [
          ['Sample size', c.a.completed + ' → ' + c.b.completed + ' cases'],
          [c.aLabel + ' compliance', P(c.overall.a.compliance) + ' (' + c.overall.a.met + '/' + c.overall.a.applicable + ')'],
          [c.bLabel + ' compliance', P(c.overall.b.compliance) + ' (' + c.overall.b.met + '/' + c.overall.b.applicable + ')'],
          ['Absolute change', Q.fmtPP(c.overall.pp)],
          ['Relative change', Q.fmtRel(c.overall.rel)],
          ['Data completeness', Q.fmtPct(c.a.completeness, 0) + ' → ' + Q.fmtPct(c.b.completeness, 0)]] },
          { type: 'source', text: 'Pooled across ' + c.included + ' comparable criteri' + (c.included === 1 ? 'on' : 'a') + '. Absolute change = difference in percentage points (pp); relative change = absolute change ÷ ' + c.aLabel + ' compliance.' }];
      }
      case 'cmp-table': {
        const c = qi.comparison;
        if (!c) return [{ type: 'note', text: 'No earlier cycle to compare with.' }];
        const out = [{ type: 'caption', kind: 'table', text: 'Comparison of ' + c.aLabel + ' and ' + c.bLabel + ' by criterion' },
          { type: 'table', small: true, head: ['Criterion', c.aLabel, c.bLabel, 'Absolute change', 'Relative change', 'Δ compliant', 'Δ non-compliant', 'Δ missing', 'Comparability'], center: [1, 2, 3, 4, 5, 6, 7], widths: [22, 11, 11, 10, 10, 8, 9, 8, 11],
            body: c.rows.map(function (r) {
              return [r.name, r.a ? P(r.a.compliance) + ' (' + r.a.met + '/' + r.a.denominator + ')' : '—', r.b ? P(r.b.compliance) + ' (' + r.b.met + '/' + r.b.denominator + ')' : '—',
                Q.fmtPP(r.pp), r.relNote ? 'n/a' : Q.fmtRel(r.rel), Q.fmtDelta(r.dMet), Q.fmtDelta(r.dNotMet), Q.fmtDelta(r.dMissing),
                r.level === 'none' ? 'Not comparable' : r.excluded ? 'Excluded by user' : r.level === 'warn' ? 'Definition changed' : 'Comparable'];
            }) },
          { type: 'source', text: c.aLabel + ': ' + c.a.completed + ' completed cases' + (c.a.collectedFrom ? ' (' + U.fmtDate(c.a.collectedFrom) + ' – ' + U.fmtDate(c.a.collectedTo) + ')' : '') + '; ' + c.bLabel + ': ' + c.b.completed + ' completed cases' + (c.b.collectedFrom ? ' (' + U.fmtDate(c.b.collectedFrom) + ' – ' + U.fmtDate(c.b.collectedTo) + ')' : '') + '. No statistical significance test applied.' }];
        const flagged = c.rows.filter(function (r) { return r.reasons.length && r.level !== 'ok'; });
        if (flagged.length) out.push({ type: 'note', text: 'Comparability: ' + flagged.map(function (r) { return r.name + ' — ' + r.reasons.join(' '); }).join(' ') });
        return out;
      }
      case 'chart-cmp':
        return qi.comparison ? [{ type: 'chart', kind: 'chart-cmp', caption: 'Compliance by criterion: ' + qi.comparison.aLabel + ' (baseline) and ' + qi.comparison.bLabel + ' (re-audit); navy line marks the target' }, source] : [{ type: 'note', text: 'No earlier cycle to compare with.' }];
      case 'chart-cmp-pp':
        return qi.comparison ? [{ type: 'chart', kind: 'chart-cmp-pp', caption: 'Absolute change in compliance (percentage points), ' + qi.comparison.aLabel + ' to ' + qi.comparison.bLabel }, source] : [{ type: 'note', text: 'No earlier cycle to compare with.' }];
    }
    return [];
  }

  /** HTML for a part list (used by report-render). */
  function toHtml(list, ctr, snap) {
    return list.map(function (x) {
      if (x.type === 'caption') { if (x.kind === 'figure') ctr.fig++; else ctr.tab++; return '<p class="doc-caption">' + (x.kind === 'figure' ? 'Figure ' + ctr.fig : 'Table ' + ctr.tab) + '. ' + esc(x.text) + '</p>'; }
      if (x.type === 'source') return '<p class="doc-source">' + esc(x.text) + '</p>';
      if (x.type === 'note') return '<p class="doc-empty">' + esc(x.text) + '</p>';
      if (x.type === 'kpis') return '<div class="doc-kpis">' + x.pairs.map(function (p) { return '<div class="doc-kpi"><span>' + esc(p[0]) + '</span><strong>' + esc(p[1]) + '</strong></div>'; }).join('') + '</div>';
      if (x.type === 'table') {
        const c = x.center || [];
        return '<table class="doc-table' + (x.small ? ' doc-table--actions' : '') + '"><thead><tr>' + x.head.map(function (h, i) { return '<th' + (c.indexOf(i) !== -1 ? ' class="doc-c"' : '') + '>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          x.body.map(function (r) { return '<tr>' + r.map(function (v, i) { const cls = [c.indexOf(i) !== -1 ? 'doc-c' : '', v === 'Achieved' ? 'doc-yes' : v === 'Not achieved' ? 'doc-no' : ''].filter(Boolean).join(' '); return '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
      }
      if (x.type === 'chart') {
        const url = DA.reportRender.chartImage(x.kind, snap);
        ctr.fig++;
        return (url ? '<figure class="doc-figure"><img src="' + url + '" alt="' + esc(x.caption) + '"></figure>' : '<p class="doc-empty">Chart not available.</p>') + '<p class="doc-caption">Figure ' + ctr.fig + '. ' + esc(x.caption) + '</p>';
      }
      return '';
    }).join('');
  }

  /* =========================================================
   * Section text (deterministic)
   * ========================================================= */
  function gen(key, ctx) {
    const qi = ctx.snap.qi;
    const a = ctx.audit;
    if (!qi) return ph('Quality improvement information is not available for this report — link an improvement project in the report settings and refresh the data');
    const c = qi.comparison, b = qi.baseline, ivs = qi.interventions, pd = qi.pdsa;
    switch (key) {
      case 'reauditmethod': {
        const cy = qi.cycle;
        if (!c) return '<p>This report covers ' + esc(cy.label) + '. There is no earlier cycle to compare with, so a re-audit methodology does not apply yet.</p>';
        const same = c.rows.filter(function (r) { return r.level === 'ok'; }).length;
        const changedRows = c.rows.filter(function (r) { return r.level !== 'ok'; });
        return '<p>' + esc(cy.label) + ' re-audited the same standards as ' + esc(c.aLabel) + ' to measure change after the improvement work. ' +
          'Data were collected ' + (c.b.collectedFrom ? 'between ' + U.fmtDate(c.b.collectedFrom) + ' and ' + U.fmtDate(c.b.collectedTo) : (cy.collectionStartDate ? 'from ' + U.fmtDate(cy.collectionStartDate) : 'during the re-audit period')) +
          ' using ' + (cy.createdFrom ? (cy.createdFrom.formMode === 'duplicate' ? 'a copy of the ' + esc(c.aLabel) + ' data collection form' + (cy.createdFrom.formVersion ? ' (version ' + cy.createdFrom.formVersion + ')' : '') + ', with criterion links and scoring rules preserved' : 'a newly designed data collection form') : 'the audit’s data collection form') +
          (cy.formVersion ? ' (' + esc(cy.label) + ' form version ' + cy.formVersion + ')' : '') + '. ' + c.b.completed + ' completed cases were analysed, compared with ' + c.a.completed + ' in ' + esc(c.aLabel) + '.' + (cy.note ? ' Context recorded when the cycle was opened: “' + esc(cy.note) + '”.' : '') + '</p>' +
          '<p>Compliance was calculated with the same formula in both cycles (compliant ÷ eligible cases, N/A excluded). ' + same + ' of ' + c.rows.length + ' criteria had unchanged definitions and scoring rules.' +
          (changedRows.length ? ' Changes affecting comparability: ' + changedRows.map(function (r) { return esc(r.name) + ' (' + esc(r.reasons.join(' ')) + ')'; }).join('; ') + '.' : '') + ' Case records from the two cycles are stored separately and the earlier cycle’s data were not altered.</p>';
      }
      case 'qibaseline': {
        if (!b) return ph('No baseline results are recorded for this project');
        const below = b.rows.filter(function (r) { return r.achieved === false; });
        return '<p>The baseline audit (' + esc(b.cycleLabel) + ') included ' + plural(b.completed, 'completed case') + (b.collectedFrom ? ' collected between ' + U.fmtDate(b.collectedFrom) + ' and ' + U.fmtDate(b.collectedTo) : '') + '. Overall compliance across all criterion assessments was ' + Q.fmtPct(b.overall.compliance) + ' (' + b.overall.met + '/' + b.overall.applicable + '), and ' + (b.rows.length - below.length) + ' of ' + b.rows.length + ' criteria met their target.</p>' +
          (below.length ? '<ul>' + below.map(function (r) { return '<li>' + esc(r.name) + ': ' + Q.fmtPct(r.compliance) + ' (' + r.met + '/' + r.denominator + ') against a target of ' + r.target + '%.</li>'; }).join('') + '</ul>' : '') + block('qi-baseline');
      }
      case 'opportunities': {
        if (!b) return ph('No baseline results are recorded for this project');
        const below = b.rows.filter(function (r) { return r.achieved === false; }).sort(function (x, y) { return y.gap - x.gap || y.notMet - x.notMet; });
        if (!below.length) return '<p>All baseline criteria met their target. The improvement focus is on sustaining current performance.</p>';
        return '<p>' + plural(below.length, 'criterion', 'criteria') + ' fell below target at baseline. They are listed below by the size of the gap to target and the number of non-compliant cases; this ordering is descriptive only. ' +
          (below.some(function (r) { return r.userPriority; }) ? 'Improvement priorities were assigned by the project team.' : 'Clinical priority was not recorded by the project team.') + '</p><ol>' +
          below.map(function (r) { return '<li><strong>' + esc(r.name) + '</strong> — gap of ' + Q.round(r.gap, 1) + ' percentage points (' + r.notMet + ' non-compliant case' + (r.notMet === 1 ? '' : 's') + ')' + (r.userPriority ? '; priority: ' + esc(r.userPriority) : '') + (r.clinicalNote ? '; team note: ' + esc(r.clinicalNote) : '') + (r.targeted ? '' : '; not targeted in this project') + '.</li>'; }).join('') + '</ol>';
      }
      case 'interventions':
        if (!ivs.length) return ph('No interventions have been recorded in the improvement project');
        return '<p>' + plural(ivs.length, 'intervention was', 'interventions were') + ' agreed' + (qi.project ? ' as part of “' + esc(qi.project.title) + '”' + (qi.project.aim ? ', whose aim was: ' + esc(lower(qi.project.aim).replace(/\.$/, '')) : '') : '') + '.</p>' +
          ivs.map(function (i, n) {
            return '<h4>' + (n + 1) + '. ' + esc(i.title) + '</h4>' +
              (i.identifiedProblem ? '<p><strong>Identified problem:</strong> ' + esc(i.identifiedProblem) + '</p>' : '') +
              (i.proposedSolution ? '<p><strong>Change:</strong> ' + esc(i.proposedSolution) + (i.description ? ' ' + esc(i.description) : '') + '</p>' : '') +
              '<p><strong>Owner:</strong> ' + esc(i.responsiblePerson || 'not assigned') + (i.supportingTeam.length ? ', supported by ' + esc(joinList(i.supportingTeam)) : '') + '. <strong>Target date:</strong> ' + (i.targetDate ? U.fmtDate(i.targetDate) : 'not set') + '. <strong>Success measure:</strong> ' + esc(i.successMeasure || 'not set') + '.' +
              (i.expectedOutcome ? ' <strong>Expected outcome:</strong> ' + esc(i.expectedOutcome) + '.' : '') + '</p>';
          }).join('') + block('qi-interventions');
      case 'pdsamethod':
        if (!pd.length) return '<p>No Plan-Do-Study-Act (PDSA) cycles were recorded for this project.</p>';
        return '<p>Changes were tested using ' + plural(pd.length, 'Plan-Do-Study-Act (PDSA) cycle') + '. In each cycle the team planned the change with a prediction and a measure of success, carried it out, studied the results against the prediction and then decided whether to adopt, adapt or abandon the change.</p>' +
          pd.map(function (x) {
            return '<p><strong>PDSA ' + x.n + (x.intervention ? ' (' + esc(x.intervention) + ')' : '') + ':</strong> ' + esc(x.plan.change || 'change not described') + '. ' +
              (x.plan.prediction ? 'Prediction: ' + esc(x.plan.prediction).replace(/\.$/, '') + '. ' : '') + (x.plan.measure ? 'Measure: ' + esc(x.plan.measure).replace(/\.$/, '') + '. ' : '') +
              (x.act.decisionLabel ? 'Decision: <strong>' + esc(x.act.decisionLabel) + '</strong>' + (x.act.rationale ? ' — ' + esc(x.act.rationale) : '') + '.' : 'Status: ' + esc(x.status) + '.') + '</p>';
          }).join('') + block('qi-pdsa');
      case 'implementation': {
        if (!ivs.length) return ph('No interventions have been recorded');
        const done = ivs.filter(function (i) { return i.statusKey === 'completed'; });
        const od = ivs.filter(function (i) { return i.statusKey === 'overdue'; });
        return '<p>At the time of this report, ' + done.length + ' of ' + ivs.length + ' interventions had been completed' + (od.length ? ' and ' + od.length + ' ' + (od.length === 1 ? 'was' : 'were') + ' overdue' : '') + '.</p><ul>' +
          ivs.map(function (i) {
            return '<li><strong>' + esc(i.title) + '</strong> — ' + esc(i.status) + (i.startedAt ? '; implemented from ' + U.fmtDate(i.startedAt) : '') + (i.completedAt ? '; completed ' + U.fmtDate(i.completedAt) : i.targetDate ? '; target ' + U.fmtDate(i.targetDate) : '') + '.' + (i.lastNote ? ' Latest progress note (' + U.fmtDate(i.lastNote.at) + '): “' + esc(i.lastNote.text) + '”.' : '') + '</li>';
          }).join('') + '</ul>' +
          pd.filter(function (x) { return x.do.implemented || x.do.deviations || x.do.problems; }).map(function (x) {
            return '<p><strong>PDSA ' + x.n + ' — Do:</strong> ' + esc(x.do.implemented || '') + (x.do.when ? ' (' + U.fmtDate(x.do.when) + ')' : '') + '.' + (x.do.deviations ? ' Deviations from plan: ' + esc(x.do.deviations) + '.' : '') + (x.do.problems ? ' Problems: ' + esc(x.do.problems) + '.' : '') + '</p>';
          }).join('');
      }
      case 'comparison':
        if (!c) return '<p>There is no earlier cycle to compare with.</p>';
        return block('cmp-summary') + '<p>' + esc(c.aLabel) + ' (' + c.a.completed + ' cases) is compared with ' + esc(c.bLabel) + ' (' + c.b.completed + ' cases)' + (c.a.completed !== c.b.completed ? '; the sample sizes differ, so percentages from the smaller sample change more with each case' : '') + '.</p>' +
          (c.warnings.length ? '<p class="rp-note">' + esc(c.warnings.map(function (w) { return w.text; }).join(' ')) + '</p>' : '') +
          block('cmp-table') + block('chart-cmp') + block('chart-cmp-pp') +
          '<p class="rp-note">' + esc(c.notes.join(' ')) + '</p>';
      case 'compliancechange': {
        if (!c) return '<p>There is no earlier cycle to compare with.</p>';
        const inc = c.rows.filter(function (r) { return !r.excluded && r.pp !== null; });
        const up = inc.filter(function (r) { return r.pp > 0; }), down = inc.filter(function (r) { return r.pp < 0; });
        const nowMet = inc.filter(function (r) { return r.a.compliance < r.target && r.b.compliance >= r.target; });
        return '<p>Overall compliance across the ' + plural(c.included, 'comparable criterion', 'comparable criteria') + ' changed from ' + Q.fmtPct(c.overall.a.compliance) + ' to ' + Q.fmtPct(c.overall.b.compliance) + ', an absolute change of ' + Q.fmtPP(c.overall.pp).replace(' pp', ' percentage points') + (c.overall.rel !== null ? ' (relative change ' + Q.fmtRel(c.overall.rel) + ')' : '') + '. Compliance rose for ' + up.length + ', fell for ' + down.length + ' and was unchanged for ' + (inc.length - up.length - down.length) + ' criteri' + (inc.length === 1 ? 'on' : 'a') + '.' +
          (nowMet.length ? ' ' + joinList(nowMet.map(function (r) { return esc(r.name); })) + ' reached ' + (nowMet.length === 1 ? 'its' : 'their') + ' target after being below it at baseline.' : '') + '</p><ul>' +
          inc.map(function (r) { return '<li><strong>' + esc(r.name) + ':</strong> ' + Q.fmtPct(r.a.compliance) + ' (' + r.a.met + '/' + r.a.denominator + ') → ' + Q.fmtPct(r.b.compliance) + ' (' + r.b.met + '/' + r.b.denominator + '); absolute change ' + Q.fmtPP(r.pp).replace(' pp', ' percentage points') + (r.relNote ? '' : ', relative change ' + Q.fmtRel(r.rel)) + '; non-compliant cases ' + r.a.notMet + ' → ' + r.b.notMet + '.</li>'; }).join('') + '</ul>' +
          (c.rows.some(function (r) { return r.excluded; }) ? '<p>Excluded from the comparison: ' + c.rows.filter(function (r) { return r.excluded; }).map(function (r) { return esc(r.name) + (r.reasons.length ? ' (' + esc(r.reasons[0]) + ')' : ' (excluded by the audit team)'); }).join('; ') + '.</p>' : '') +
          '<p class="rp-note">These are observed differences between two audit cycles. No statistical test was applied, and the change is associated with — but not proven to be caused by — the improvement work; other factors such as staff changes, case mix or awareness of the audit may contribute.</p>';
      }
      case 'lessons': {
        const items = [];
        pd.forEach(function (x) {
          if (x.study.learned) items.push('<li><strong>PDSA ' + x.n + ':</strong> ' + esc(x.study.learned) + '</li>');
          if (x.study.workedWell) items.push('<li><strong>Worked well (PDSA ' + x.n + '):</strong> ' + esc(x.study.workedWell) + '</li>');
          if (x.study.notWell) items.push('<li><strong>Did not work well (PDSA ' + x.n + '):</strong> ' + esc(x.study.notWell) + '</li>');
          if (x.study.unexpected) items.push('<li><strong>Unexpected finding (PDSA ' + x.n + '):</strong> ' + esc(x.study.unexpected) + '</li>');
        });
        ivs.forEach(function (i) { if (i.effectiveness) items.push('<li><strong>' + esc(i.title) + ':</strong> judged “' + esc(i.effectiveness.rating) + '” by the team' + (i.effectiveness.notes ? ' — ' + esc(i.effectiveness.notes) : '') + '.</li>'); });
        return items.length ? '<p>Lessons recorded by the project team during the PDSA cycles and intervention reviews:</p><ul>' + items.join('') + '</ul>' : ph('Record what the team learned — no Study-stage learning or effectiveness reviews have been recorded yet');
      }
      case 'sustainability': {
        const adopted = pd.filter(function (x) { return x.act.decision === 'adopt'; });
        const met = c ? c.rows.filter(function (r) { return !r.excluded && r.b && r.b.compliance !== null && r.b.compliance >= r.target; }) : [];
        return (adopted.length ? '<p>The following changes were adopted and should be embedded as standard practice:</p><ul>' + adopted.map(function (x) { return '<li>' + esc(x.plan.change || 'PDSA ' + x.n) + (x.act.nextSteps ? ' — next steps: ' + esc(x.act.nextSteps) : '') + (x.act.responsible ? ' (owner: ' + esc(x.act.responsible) + ')' : '') + (x.act.reviewDate ? ', review ' + U.fmtDate(x.act.reviewDate) : '') + '</li>'; }).join('') + '</ul>' : '<p>No PDSA cycle has yet recorded a decision to adopt a change.</p>') +
          (met.length ? '<p>To sustain the ' + plural(met.length, 'criterion', 'criteria') + ' now at or above target (' + joinList(met.map(function (r) { return esc(r.name); })) + '), continue monitoring at the next audit cycle.</p>' : '') +
          ph('Describe how the changes will be maintained: ownership, induction or training, template or protocol updates, and how often compliance will be checked');
      }
      case 'future': {
        const still = c ? c.rows.filter(function (r) { return !r.excluded && r.b && r.b.achieved === false || (!r.excluded && r.b && r.b.compliance !== null && r.b.compliance < r.target); }) : (b ? b.rows.filter(function (r) { return r.achieved === false; }) : []);
        const adapt = pd.filter(function (x) { return x.act.decision === 'adapt'; });
        const open = ivs.filter(function (i) { return i.statusKey !== 'completed' && i.statusKey !== 'cancelled'; });
        const items = [];
        still.forEach(function (r) { const v = r.b || r; items.push('<li><strong>' + esc(r.name) + '</strong> remains below target (' + Q.fmtPct(v.compliance) + ' against ' + r.target + '%). Review why the change has not yet reached the standard and consider a further PDSA cycle before the next re-audit.</li>'); });
        adapt.forEach(function (x) { items.push('<li>PDSA ' + x.n + ' recommended adapting the change' + (x.act.changes ? ': ' + esc(x.act.changes) : '') + '. Plan the next cycle' + (x.act.responsible ? ' (owner: ' + esc(x.act.responsible) + ')' : '') + '.</li>'); });
        open.forEach(function (i) { items.push('<li>Complete “' + esc(i.title) + '”' + (i.targetDate ? ' (target ' + U.fmtDate(i.targetDate) + ')' : '') + (i.statusKey === 'overdue' ? ' — currently overdue' : '') + '.</li>'); });
        if (c && c.a.completed !== c.b.completed) items.push('<li>Collect the full planned sample in the next cycle so that results are based on comparable sample sizes.</li>');
        items.push('<li>Re-audit ' + (a.reauditMonths ? 'within ' + a.reauditMonths + ' months' : 'at an agreed interval') + ' using the same criteria and data collection form to confirm whether improvements are sustained.</li>');
        return '<p>Recommendations for the next phase, based on the findings in this report:</p><ol>' + items.join('') + '</ol>';
      }
    }
    return '';
  }

  /* =========================================================
   * Charts (drawn by report-render's offscreen renderer)
   * ========================================================= */
  function chartConfigs(kind, qi, COL, font, wrapLabel) {
    const c = qi && qi.comparison;
    if (!c) return null;
    const rows = c.rows.filter(function (r) { return !r.excluded && r.a && r.b; });
    if (!rows.length) return null;
    if (kind === 'chart-cmp') {
      const targets = { id: 'targets', afterDatasetsDraw: function (ch) {
        const x = ch.scales.x, y = ch.scales.y, ctx = ch.ctx;
        ctx.save(); ctx.strokeStyle = COL.ink; ctx.lineWidth = 3;
        rows.forEach(function (r, i) { const px = x.getPixelForValue(r.target); const py = y.getPixelForValue(i); ctx.beginPath(); ctx.moveTo(px, py - 36); ctx.lineTo(px, py + 36); ctx.stroke(); });
        ctx.restore();
      } };
      return { h: 140 + rows.length * 110, cfg: {
        type: 'bar',
        data: { labels: rows.map(function (r, i) { return wrapLabel((i + 1) + '. ' + r.name, 34); }), datasets: [
          { label: c.aLabel + ' (baseline)', data: rows.map(function (r) { return r.a.compliance; }), backgroundColor: COL.s2, borderRadius: 5, barThickness: 30 },
          { label: c.bLabel + ' (re-audit)', data: rows.map(function (r) { return r.b.compliance; }), backgroundColor: COL.s1, borderRadius: 5, barThickness: 30 }] },
        options: { indexAxis: 'y', layout: { padding: { top: 10, right: 30, bottom: 10, left: 10 } },
          scales: { x: { min: 0, max: 100, grid: { color: COL.grid }, border: { display: false }, ticks: { stepSize: 25, color: COL.muted, font: font(20), callback: function (v) { return v + '%'; } } }, y: { grid: { display: false }, ticks: { color: COL.text, font: font(21), autoSkip: false } } },
          plugins: { legend: { position: 'top', align: 'end', labels: { color: COL.text, font: font(20), boxWidth: 22, boxHeight: 22 } }, tooltip: { enabled: false } } },
        plugins: [targets] } };
    }
    if (kind === 'chart-cmp-pp') {
      const vals = rows.map(function (r) { return r.pp; });
      const lim = Math.max(10, Math.ceil(Math.max.apply(null, vals.map(Math.abs)) / 10) * 10);
      const labelsPlugin = { id: 'pplabels', afterDatasetsDraw: function (ch) {
        const m = ch.getDatasetMeta(0), ctx = ch.ctx;
        ctx.save(); ctx.font = '700 22px Inter, Helvetica, Arial, sans-serif'; ctx.textBaseline = 'middle';
        m.data.forEach(function (bar, i) { const v = vals[i]; const t = Q.fmtPP(v).replace('−', '-'); ctx.fillStyle = v >= 0 ? COL.good : COL.bad; const w = ctx.measureText(t).width; ctx.fillText(t, v >= 0 ? bar.x + 10 : bar.x - w - 10, bar.y); });
        ctx.restore();
      } };
      return { h: 120 + rows.length * 80, cfg: {
        type: 'bar',
        data: { labels: rows.map(function (r, i) { return wrapLabel((i + 1) + '. ' + r.name, 34); }), datasets: [{ data: vals, backgroundColor: vals.map(function (v) { return v >= 0 ? '#1baf7a' : '#d03b3b'; }), borderRadius: 5, barThickness: 34 }] },
        options: { indexAxis: 'y', layout: { padding: { top: 16, right: 120, bottom: 10, left: 10 } },
          scales: { x: { min: -lim, max: lim, grid: { color: function (g) { return g.tick.value === 0 ? COL.ink : COL.grid; }, lineWidth: function (g) { return g.tick.value === 0 ? 2 : 1; } }, border: { display: false }, ticks: { color: COL.muted, font: font(20), callback: function (v) { return (v > 0 ? '+' : '') + v + ' pp'; } } }, y: { grid: { display: false }, ticks: { color: COL.text, font: font(21), autoSkip: false } } },
          plugins: { legend: { display: false }, tooltip: { enabled: false } } },
        plugins: [labelsPlugin] } };
    }
    return null;
  }

  return { SECTIONS: SECTIONS, KEYS: KEYS, DESC: DESC, DEFAULTS: DEFAULTS, BLOCKS: BLOCKS, buildQi: buildQi, fingerprint: fingerprint, changed: changed, numbers: numbers, has: has, insertable: insertable, parts: parts, toHtml: toHtml, gen: gen, chartConfigs: chartConfigs };
})();
