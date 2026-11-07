/* DentalAudit — quality improvement engine
 *
 * Pure calculations over stored data (no DOM, no writes):
 *  - the cycle series of an audit (cycles inside one audit, plus re-audits created as linked audits)
 *  - per-cycle criterion results using the same formula as the analytics engine
 *  - comparability checks and cycle-to-cycle comparison (percentage points vs relative change)
 *  - baseline review, deterministic improvement suggestions, timelines and dashboard figures
 *
 * Compliance = compliant ÷ (compliant + non-compliant). N/A excluded. Completed records only.
 * Nothing here judges clinical importance or claims causation or statistical significance.
 */
DA.qi = (function () {
  const U = DA.utils, C = DA.collection;

  const PROJECT_STATUS = {
    active: { label: 'Active', tone: 'blue' },
    on_hold: { label: 'On hold', tone: 'amber' },
    completed: { label: 'Completed', tone: 'green' },
    cancelled: { label: 'Cancelled', tone: 'neutral' }
  };
  const PRIORITY = {
    low: { label: 'Low', tone: 'neutral' },
    medium: { label: 'Medium', tone: 'blue' },
    high: { label: 'High', tone: 'amber' },
    critical: { label: 'Critical', tone: 'red' }
  };
  const IV_STATUS = {
    planned: { label: 'Planned', tone: 'violet' },
    not_started: { label: 'Not Started', tone: 'neutral' },
    in_progress: { label: 'In Progress', tone: 'blue' },
    completed: { label: 'Completed', tone: 'green' },
    on_hold: { label: 'On Hold', tone: 'amber' },
    cancelled: { label: 'Cancelled', tone: 'neutral' }
  };
  const OPEN = ['planned', 'not_started', 'in_progress'];
  const EFFECTIVENESS = {
    effective: 'Effective', partial: 'Partly effective', not_effective: 'Not effective', too_early: 'Too early to judge'
  };
  const PDSA_STAGES = ['plan', 'do', 'study', 'act'];
  const PDSA_STATUS = {
    planning: { label: 'Planning', tone: 'violet' }, doing: { label: 'Doing', tone: 'blue' },
    studying: { label: 'Studying', tone: 'amber' }, acting: { label: 'Acting', tone: 'amber' }, completed: { label: 'Completed', tone: 'green' }
  };
  const ACT_DECISIONS = {
    adopt: { label: 'Adopt', text: 'The change was successful and should become standard practice.' },
    adapt: { label: 'Adapt', text: 'Modify the change and run another PDSA cycle.' },
    abandon: { label: 'Abandon', text: 'The change was unsuccessful or unsuitable.' }
  };

  function today() { return U.isoDay(new Date()); }
  function round(v, dp) { if (v === null || v === undefined || isNaN(v)) return null; const f = Math.pow(10, dp || 0); return Math.round(v * f) / f; }

  /* =========================================================
   * Formatting — percentage points are never confused with relative change
   * ========================================================= */
  function fmtPct(v, dp) { return v === null || v === undefined || isNaN(v) ? '—' : round(v, dp === undefined ? 1 : dp) + '%'; }
  function fmtPP(v) { if (v === null || v === undefined || isNaN(v)) return '—'; const r = round(v, 1); return (r > 0 ? '+' : r < 0 ? '−' : '±') + Math.abs(r) + ' pp'; }
  function fmtRel(v) { if (v === null || v === undefined || isNaN(v)) return '—'; const r = round(v, 2); return (r > 0 ? '+' : r < 0 ? '−' : '±') + Math.abs(r).toFixed(2) + '%'; }
  function fmtDelta(v) { if (v === null || v === undefined || isNaN(v)) return '—'; return (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v); }

  /* =========================================================
   * Cycle series
   * ========================================================= */
  function lineage(audit) {
    if (!audit) return [];
    const all = DA.store.getAudits();
    let root = audit;
    const guard = new Set();
    while (root.parentId && !guard.has(root.id)) {
      guard.add(root.id);
      const p = all.find(function (a) { return a.id === root.parentId; });
      if (!p) break;
      root = p;
    }
    const out = [];
    (function walk(a) {
      if (out.indexOf(a) !== -1) return;
      out.push(a);
      all.filter(function (x) { return x.parentId === a.id && x.status !== 'draft'; })
        .sort(function (x, y) { return String(x.createdAt).localeCompare(String(y.createdAt)); }).forEach(walk);
    })(root);
    return out;
  }

  function refKey(audit, cycle) { return audit.id + ':' + cycle.id; }

  /** Every cycle connected to this audit, oldest first. */
  function series(audit) {
    const refs = [];
    lineage(audit).forEach(function (a) {
      (a.cycles || []).forEach(function (c) {
        refs.push({ key: refKey(a, c), audit: a, cycle: c, number: c.number, label: c.label, sameAudit: a.id === audit.id });
      });
    });
    refs.sort(function (x, y) { return x.number - y.number || String(x.cycle.startedAt).localeCompare(String(y.cycle.startedAt)); });
    return refs;
  }

  function ref(key) {
    if (!key) return null;
    const i = key.indexOf(':');
    const a = DA.store.getAudit(key.slice(0, i));
    const c = a && C.cycleById(a, key.slice(i + 1));
    return a && c ? { key: key, audit: a, cycle: c, number: c.number, label: c.label } : null;
  }

  function isCurrent(r) { return C.currentCycle(r.audit) === r.cycle; }

  /** Criteria in force for a cycle: past cycles use the frozen copy taken when they closed. */
  function cycleCriteria(r) {
    if (!isCurrent(r) && Array.isArray(r.cycle.criteriaSnapshot) && r.cycle.criteriaSnapshot.length) return r.cycle.criteriaSnapshot;
    return r.audit.criteria || [];
  }

  /** Stable key linking "the same" criterion across cycles and linked re-audit audits. */
  function criterionKeyer(audit) {
    const map = {};
    lineage(audit).forEach(function (a) {
      (a.criteria || []).forEach(function (c) { map[c.id] = c; });
      (a.cycles || []).forEach(function (cy) { (cy.criteriaSnapshot || []).forEach(function (c) { if (!map[c.id]) map[c.id] = c; }); });
    });
    return function key(id) {
      const seen = new Set();
      let cur = id;
      while (map[cur] && map[cur].parentCriterionId && map[map[cur].parentCriterionId] && !seen.has(cur)) { seen.add(cur); cur = map[cur].parentCriterionId; }
      return cur;
    };
  }

  /** How the linked form field turns an answer into compliant / N/A — used to detect scoring changes. */
  function ruleOf(form, criterionId) {
    const f = form && form.fields.find(function (x) { return x.linkedCriterionId === criterionId; });
    if (!f) return null;
    const lab = function (ids) { return (ids || []).map(function (v) { return C.optionLabel(f, v) || v; }).sort().join(' / '); };
    let rule = f.type;
    if (C.TYPES[f.type] && C.TYPES[f.type].choice) rule += ': compliant = ' + (lab(f.compliantValues) || 'none') + (f.notApplicableValues && f.notApplicableValues.length ? '; N/A = ' + lab(f.notApplicableValues) : '');
    else if (f.type === 'number' || f.type === 'rating') rule += ': compliant ' + (f.compliantMin !== '' ? f.compliantMin : '−∞') + '–' + (f.compliantMax !== '' ? f.compliantMax : '∞');
    else rule += ': any answer = compliant';
    if (f.allowNA) rule += ' (N/A allowed)';
    return { label: f.label, rule: rule };
  }

  /** Per-criterion results for one cycle. */
  function cycleResults(r) {
    const recs = r.cycle.records || [];
    const done = recs.filter(function (x) { return x.status === 'completed'; });
    const keyOf = criterionKeyer(r.audit);
    let met = 0, app = 0;
    const rows = cycleCriteria(r).map(function (c) {
      let m = 0, nm = 0, na = 0;
      done.forEach(function (rec) {
        const v = rec.results ? rec.results[c.id] : null;
        if (v === 'met') m++; else if (v === 'not_met') nm++; else if (v === 'na') na++;
      });
      const den = m + nm;
      met += m; app += den;
      const comp = den ? m / den * 100 : null;
      const target = Number(c.target) || 0;
      return {
        id: c.id, key: keyOf(c.id), name: c.name, description: c.description || '', target: target,
        numeratorDef: c.numerator || '', denominatorDef: c.denominator || '', measurementMethod: c.measurementMethod || '',
        met: m, notMet: nm, na: na, missing: Math.max(0, done.length - m - nm - na), denominator: den,
        compliance: comp, achieved: comp === null ? null : comp >= target, gap: comp === null ? null : target - comp,
        rule: ruleOf(r.cycle.form, c.id)
      };
    });
    const dates = done.map(function (x) { return x.collectionDate; }).filter(Boolean).sort();
    return {
      key: r.key, auditId: r.audit.id, cycleId: r.cycle.id, label: r.cycle.label, number: r.cycle.number, auditTitle: r.audit.title,
      status: r.cycle.status, startedAt: r.cycle.startedAt, completedAt: r.cycle.completedAt,
      records: recs.length, completed: done.length, drafts: recs.length - done.length,
      completeness: recs.length ? done.length / recs.length * 100 : null,
      targetSample: Number(r.audit.targetSampleSize) || 0,
      collectedFrom: dates[0] || null, collectedTo: dates[dates.length - 1] || null,
      formVersion: r.cycle.form ? r.cycle.form.version : null,
      overall: { met: met, applicable: app, compliance: app ? met / app * 100 : null },
      rows: rows
    };
  }

  /* =========================================================
   * Comparison
   * ========================================================= */
  const DEF_FIELDS = { name: 'Criterion wording', description: 'Clinical standard', target: 'Target', numeratorDef: 'Numerator definition', denominatorDef: 'Denominator definition', measurementMethod: 'Measurement method' };
  const SCORING_FIELDS = ['numeratorDef', 'denominatorDef', 'measurementMethod'];

  function pairKey(a, b) { return a + '|' + b; }

  function changesFor(audits, key, keyOf, fromIso, toIso) {
    const out = [];
    audits.forEach(function (a) {
      (a.criteriaChanges || []).forEach(function (ch) {
        if (keyOf(ch.criterionId) !== key) return;
        if (fromIso && ch.at < fromIso) return;
        if (toIso && ch.at > toIso) return;
        out.push(ch);
      });
    });
    return out;
  }

  /**
   * Compare cycle A (earlier) with cycle B (later).
   * excluded: criterion keys the user removed from the comparison.
   */
  function compare(keyA, keyB, excluded) {
    const ra = ref(keyA), rb = ref(keyB);
    if (!ra || !rb) return null;
    const A = cycleResults(ra), B = cycleResults(rb);
    const ex = excluded || DA.store.getCompareExclusions(pairKey(keyA, keyB));
    const keyOf = criterionKeyer(rb.audit);
    const audits = lineage(rb.audit);
    const keys = [];
    B.rows.forEach(function (x) { if (keys.indexOf(x.key) === -1) keys.push(x.key); });
    A.rows.forEach(function (x) { if (keys.indexOf(x.key) === -1) keys.push(x.key); });
    const rows = keys.map(function (k) {
      const a = A.rows.find(function (x) { return x.key === k; }) || null;
      const b = B.rows.find(function (x) { return x.key === k; }) || null;
      const reasons = [];
      let level = 'ok';
      if (!a || !b) {
        level = 'none';
        reasons.push(!a ? 'Not measured in ' + A.label + ' (criterion added later).' : 'Not measured in ' + B.label + ' (criterion removed or not carried forward).');
      } else {
        Object.keys(DEF_FIELDS).forEach(function (f) {
          if (String(a[f] || '') !== String(b[f] || '')) {
            reasons.push(DEF_FIELDS[f] + ' changed: “' + (a[f] === '' ? '—' : a[f]) + (f === 'target' ? '%' : '') + '” → “' + (b[f] === '' ? '—' : b[f]) + (f === 'target' ? '%' : '') + '”.');
            if (SCORING_FIELDS.indexOf(f) !== -1 || f === 'name' || f === 'description') level = 'warn';
          }
        });
        if (a.rule && b.rule && a.rule.rule !== b.rule.rule) { reasons.push('Scoring rule of the linked form question changed: ' + a.rule.rule + ' → ' + b.rule.rule + '.'); level = 'warn'; }
        if (!a.rule && b.rule || a.rule && !b.rule) { reasons.push('Only one cycle has a form question linked to this criterion.'); level = 'warn'; }
        if (a.denominator === 0 || b.denominator === 0) { reasons.push('No eligible cases in ' + (a.denominator === 0 ? A.label : B.label) + ', so compliance cannot be compared.'); level = 'none'; }
        changesFor(audits, k, keyOf, ra.cycle.startedAt, null).forEach(function (ch) {
          const msg = 'Edited ' + U.fmtDate(ch.at) + (ch.by ? ' by ' + ch.by : '') + ': ' + (DEF_FIELDS[ch.field === 'numerator' ? 'numeratorDef' : ch.field === 'denominator' ? 'denominatorDef' : ch.field] || ch.field) + (ch.reason ? ' — reason: ' + ch.reason : ' — no reason recorded');
          if (reasons.indexOf(msg) === -1) reasons.push(msg);
        });
      }
      const usable = level !== 'none';
      const isEx = !usable || ex.indexOf(k) !== -1;
      const pp = usable && a.compliance !== null && b.compliance !== null ? b.compliance - a.compliance : null;
      const rel = pp !== null && a.compliance > 0 ? pp / a.compliance * 100 : null;
      return {
        key: k, name: (b || a).name, target: (b || a).target, a: a, b: b, level: level, reasons: reasons,
        excluded: isEx, userExcluded: usable && ex.indexOf(k) !== -1, comparable: usable,
        pp: pp, rel: rel, relNote: pp !== null && a.compliance === 0 ? 'Not meaningful — baseline compliance was 0%.' : '',
        dMet: a && b ? b.met - a.met : null, dNotMet: a && b ? b.notMet - a.notMet : null,
        dMissing: a && b ? b.missing - a.missing : null, dDen: a && b ? b.denominator - a.denominator : null
      };
    });
    const inc = rows.filter(function (r) { return !r.excluded; });
    const pool = function (side) {
      let m = 0, d = 0;
      inc.forEach(function (r) { m += r[side].met; d += r[side].denominator; });
      return { met: m, applicable: d, compliance: d ? m / d * 100 : null };
    };
    const pa = pool('a'), pb = pool('b');
    const ppAll = pa.compliance !== null && pb.compliance !== null ? pb.compliance - pa.compliance : null;
    const warnings = [];
    if (A.completed !== B.completed) {
      const ratio = Math.min(A.completed, B.completed) / Math.max(1, Math.max(A.completed, B.completed));
      warnings.push({ level: ratio < 0.8 ? 'warn' : 'info', text: 'Sample sizes differ: ' + A.label + ' has ' + A.completed + ' completed cases and ' + B.label + ' has ' + B.completed + '. Percentages from smaller samples change more with each case.' });
    }
    const flagged = rows.filter(function (r) { return r.level === 'warn'; });
    if (flagged.length) warnings.push({ level: 'warn', text: flagged.length + ' criteri' + (flagged.length === 1 ? 'on has' : 'a have') + ' a changed definition or scoring rule between cycles. Results may not be directly comparable — review each flag and exclude any criterion that cannot be compared reliably.' });
    const none = rows.filter(function (r) { return r.level === 'none'; });
    if (none.length) warnings.push({ level: 'warn', text: none.length + ' criteri' + (none.length === 1 ? 'on cannot' : 'a cannot') + ' be compared and ' + (none.length === 1 ? 'is' : 'are') + ' excluded automatically.' });
    if (!A.completed || !B.completed) warnings.push({ level: 'warn', text: 'One of the cycles has no completed cases yet, so compliance cannot be compared.' });
    if (A.completeness !== null && B.completeness !== null && Math.abs(B.completeness - A.completeness) >= 10) warnings.push({ level: 'info', text: 'Data completeness changed from ' + fmtPct(A.completeness, 0) + ' to ' + fmtPct(B.completeness, 0) + '.' });
    return {
      a: A, b: B, keyA: keyA, keyB: keyB, pairKey: pairKey(keyA, keyB), rows: rows, included: inc.length,
      overall: { a: pa, b: pb, pp: ppAll, rel: ppAll !== null && pa.compliance > 0 ? ppAll / pa.compliance * 100 : null },
      warnings: warnings,
      notes: [
        'Absolute change is the difference in percentage points (pp) between the two cycles. Relative change expresses that difference as a proportion of baseline compliance.',
        'No statistical significance test has been applied. Differences may reflect chance variation, particularly with small samples.',
        'An observed change shows association with the improvement work, not proof that the intervention caused it.'
      ]
    };
  }

  /** Default pair for an audit: the previous cycle with data vs the latest. */
  function defaultPair(audit) {
    const s = series(audit);
    if (s.length < 2) return null;
    return { a: s[s.length - 2].key, b: s[s.length - 1].key };
  }

  /* =========================================================
   * Improvement projects
   * ========================================================= */
  function baselineFrom(key) {
    const r = ref(key);
    if (!r) return null;
    const res = cycleResults(r);
    return {
      refKey: key, auditId: r.audit.id, cycleId: r.cycle.id, cycleLabel: res.label, capturedAt: new Date().toISOString(),
      records: res.records, completed: res.completed, completeness: res.completeness, targetSample: res.targetSample,
      collectedFrom: res.collectedFrom, collectedTo: res.collectedTo, overall: res.overall,
      rows: res.rows.map(function (x) {
        return { criterionId: x.id, key: x.key, name: x.name, target: x.target, compliance: x.compliance, met: x.met, notMet: x.notMet, na: x.na, missing: x.missing, denominator: x.denominator, achieved: x.achieved, gap: x.gap, measurementMethod: x.measurementMethod, description: x.description };
      })
    };
  }

  /** Improvement priority summary: data-driven ordering only. Clinical importance comes from the user. */
  function prioritySummary(project) {
    const b = project.baseline;
    if (!b) return [];
    return b.rows.map(function (r) {
      return Object.assign({}, r, {
        userPriority: (project.criteriaPriority || {})[r.criterionId] || '',
        targeted: (project.targetCriteria || []).indexOf(r.criterionId) !== -1,
        clinicalNote: (project.clinicalImportance || {})[r.criterionId] || ''
      });
    }).sort(function (x, y) {
      const gx = x.gap === null ? -999 : x.gap, gy = y.gap === null ? -999 : y.gap;
      return gy - gx || y.notMet - x.notMet;
    });
  }

  function interventionsFor(projectId) { return DA.store.getInterventions().filter(function (i) { return i.projectId === projectId; }); }
  function pdsaFor(projectId) {
    return DA.store.getPdsa().filter(function (p) { return p.projectId === projectId; }).sort(function (a, b) { return a.cycleNumber - b.cycleNumber; });
  }

  function isOverdue(iv) { return OPEN.indexOf(iv.status) !== -1 && !!iv.targetDate && iv.targetDate < today(); }
  function ivStatus(iv) { return isOverdue(iv) ? { key: 'overdue', label: 'Overdue', tone: 'red' } : Object.assign({ key: iv.status }, IV_STATUS[iv.status] || IV_STATUS.planned); }

  function pdsaStatus(p) {
    if (p.status === 'completed' || (p.act && p.act.decision && p.act.completedAt)) return 'completed';
    return p.status || 'planning';
  }

  /** The cycles that follow the baseline. */
  function projectSeries(project) {
    const a = project.auditId && DA.store.getAudit(project.auditId);
    if (!a) return [];
    return series(a);
  }

  function latestRef(project) {
    const s = projectSeries(project);
    const bi = s.findIndex(function (x) { return x.key === (project.baseline && project.baseline.refKey); });
    const after = s.slice(bi + 1).filter(function (x) { return x.cycle.records.some(function (r) { return r.status === 'completed'; }); });
    return after.length ? after[after.length - 1] : null;
  }

  function nextReauditDate(project) {
    const a = project.auditId && DA.store.getAudit(project.auditId);
    const cands = [];
    if (a && a.reauditDate && a.status === 'completed') cands.push(a.reauditDate);
    if (a) {
      const cur = C.currentCycle(a);
      if (cur && cur.status !== 'completed' && cur.number > (project.baseline ? ref(project.baseline.refKey) ? ref(project.baseline.refKey).number : 1 : 1) && cur.collectionEndDate) cands.push(cur.collectionEndDate);
    }
    if (project.reauditDate) cands.push(project.reauditDate);
    return cands.sort()[0] || null;
  }

  function dashboard(project) {
    const ivs = interventionsFor(project.id);
    const latest = latestRef(project);
    const cmp = latest && project.baseline ? compare(project.baseline.refKey, latest.key) : null;
    const series_ = projectSeries(project).map(function (r) { return cycleResults(r); });
    const lastRes = latest ? cycleResults(latest) : null;
    const below = (lastRes || (project.baseline ? { rows: project.baseline.rows.map(function (r) { return { id: r.criterionId, name: r.name, compliance: r.compliance, target: r.target, achieved: r.achieved, met: r.met, denominator: r.denominator }; }), label: project.baseline.cycleLabel } : { rows: [] }));
    return {
      baseline: project.baseline ? project.baseline.overall.compliance : null,
      latest: lastRes ? lastRes.overall.compliance : null,
      latestLabel: lastRes ? lastRes.label : null,
      pp: cmp ? cmp.overall.pp : null,
      comparison: cmp,
      active: ivs.filter(function (i) { return OPEN.indexOf(i.status) !== -1; }).length,
      completed: ivs.filter(function (i) { return i.status === 'completed'; }).length,
      overdue: ivs.filter(isOverdue).length,
      total: ivs.length,
      nextReaudit: nextReauditDate(project),
      series: series_,
      belowTarget: below.rows.filter(function (r) { return r.achieved === false; }),
      belowLabel: below.label,
      pdsa: pdsaFor(project.id)
    };
  }

  function projectStatusMeta(p) { return PROJECT_STATUS[p.status] || PROJECT_STATUS.active; }

  function nextReview(project) {
    const dates = [project.reviewDate];
    interventionsFor(project.id).forEach(function (i) { if (OPEN.indexOf(i.status) !== -1) dates.push(i.reviewDate, i.targetDate); });
    pdsaFor(project.id).forEach(function (p) { if (pdsaStatus(p) !== 'completed') dates.push(p.act && p.act.reviewDate, p.plan && p.plan.endDate); });
    const t = today();
    const fut = dates.filter(function (d) { return d && d >= t; }).sort();
    return fut[0] || dates.filter(Boolean).sort().slice(-1)[0] || null;
  }

  function projectUpdatedAt(p) {
    let t = p.updatedAt || p.createdAt;
    interventionsFor(p.id).concat(pdsaFor(p.id)).forEach(function (x) { if (x.updatedAt > t) t = x.updatedAt; });
    return t;
  }

  /* =========================================================
   * Upcoming milestones and the improvement journey timeline
   * ========================================================= */
  function milestones(project) {
    const out = [];
    const add = function (date, title, kind, href, done) { if (date) out.push({ date: date, title: title, kind: kind, href: href, done: !!done }); };
    const base = '#/qi/' + project.id;
    add(project.reviewDate, 'Project review', 'review', base);
    add(project.targetCompletionDate, 'Target completion', 'deadline', base);
    interventionsFor(project.id).forEach(function (i) {
      const open = OPEN.indexOf(i.status) !== -1;
      if (open) add(i.targetDate, 'Due: ' + i.title, isOverdue(i) ? 'overdue' : 'deadline', base + '?tab=interventions&iv=' + i.id);
      if (open || i.status === 'completed') add(i.reviewDate, 'Review: ' + i.title, 'review', base + '?tab=interventions&iv=' + i.id);
    });
    pdsaFor(project.id).forEach(function (p) {
      if (pdsaStatus(p) !== 'completed') add(p.plan && p.plan.endDate, 'PDSA ' + p.cycleNumber + ' planned end', 'pdsa', base + '/pdsa/' + p.id);
      add(p.act && p.act.reviewDate, 'PDSA ' + p.cycleNumber + ' review', 'pdsa', base + '/pdsa/' + p.id);
    });
    add(nextReauditDate(project), 'Re-audit due', 'reaudit', project.auditId ? '#/audits/' + project.auditId : base);
    (project.milestones || []).forEach(function (m) { add(m.date, m.title, 'manual', base + '?tab=timeline', m.done); });
    return out.sort(function (a, b) { return a.date.localeCompare(b.date); });
  }

  /** Every event in the audit → improvement journey, dated from the stored records. */
  function timeline(project) {
    const ev = [];
    const add = function (date, type, title, detail, href, id) { if (date) ev.push({ date: String(date), type: type, title: title, detail: detail || '', href: href || '', id: id || type + '_' + ev.length }); };
    const a = project.auditId && DA.store.getAudit(project.auditId);
    const base = '#/qi/' + project.id;
    if (a) {
      lineage(a).forEach(function (au) {
        if (au === lineage(a)[0]) add(au.createdAt, 'audit', 'Audit created', au.title, '#/audits/' + au.id);
        (au.cycles || []).forEach(function (c) {
          const done = c.records.filter(function (r) { return r.status === 'completed'; }).map(function (r) { return r.collectionDate; }).filter(Boolean).sort();
          const isBase = project.baseline && project.baseline.cycleId === c.id;
          const tag = isBase ? 'Baseline' : c.number > (project.baseline ? (ref(project.baseline.refKey) || { number: 1 }).number : 1) ? 'Re-audit' : c.label;
          const start = done[0] || c.collectionStartDate || null;
          if (start) add(start, 'collection', tag + ' data collection started', c.label + (c.records.length ? ' · first completed case' : ''), '#/collect/' + au.id, 'col_s_' + c.id);
          if (c.status === 'completed' && (c.completedAt || done.length)) add(c.completedAt || done[done.length - 1], 'collection', tag + ' data collection completed', c.label + ' · ' + done.length + ' completed cases', '#/collect/' + au.id, 'col_e_' + c.id);
          if (c.number > 1 && c.createdFrom) add(c.startedAt, 'reaudit', 'Re-audit cycle opened', c.label + ' · form ' + (c.createdFrom.formMode === 'duplicate' ? 'copied from previous cycle' : 'newly designed') + (c.note ? ' · ' + c.note : ''), '#/audits/' + au.id, 'cyc_' + c.id);
        });
        DA.store.reportsForAudit(au.id).slice().reverse().forEach(function (r, i, arr) {
          add(r.createdAt, 'report', (i === 0 ? 'Initial report generated' : i === arr.length - 1 && arr.length > 1 ? 'Latest report generated' : 'Report generated'), r.title + ' · ' + (DA.reportEngine.TYPES[r.reportType] || ''), '#/reports/' + r.id, 'rep_' + r.id);
        });
      });
    }
    add(project.createdAt, 'project', 'Improvement project created', project.title, base, 'proj');
    interventionsFor(project.id).forEach(function (i) {
      add(i.createdAt, 'intervention', 'Intervention planned', i.title, base + '?tab=interventions&iv=' + i.id, 'iv_p_' + i.id);
      if (i.startedAt) add(i.startedAt, 'intervention', 'Intervention implemented', i.title, base + '?tab=interventions&iv=' + i.id, 'iv_s_' + i.id);
      if (i.completedAt) add(i.completedAt, 'intervention', 'Intervention completed', i.title, base + '?tab=interventions&iv=' + i.id, 'iv_c_' + i.id);
    });
    pdsaFor(project.id).forEach(function (p) {
      add(p.createdAt, 'pdsa', 'PDSA cycle ' + p.cycleNumber + ' started', (p.plan && p.plan.change) || '', base + '/pdsa/' + p.id, 'pd_s_' + p.id);
      if (p.act && p.act.completedAt) add(p.act.completedAt, 'pdsa', 'PDSA cycle ' + p.cycleNumber + ' completed', 'Decision: ' + ((ACT_DECISIONS[p.act.decision] || {}).label || '—'), base + '/pdsa/' + p.id, 'pd_c_' + p.id);
    });
    (project.milestones || []).forEach(function (m) { add(m.date, 'milestone', m.title, m.note || 'Manual milestone', base + '?tab=timeline', 'ms_' + m.id); });
    return ev.sort(function (x, y) { return x.date.localeCompare(y.date); });
  }

  /* =========================================================
   * Improvement suggestions — deterministic templates, never autonomous
   * ========================================================= */
  const TEMPLATES = [
    { key: 'template', test: /record|document|note|torque|chart|recorded/i,
      title: function (n) { return 'Standardised record template for “' + n + '”'; },
      text: function (n) { return 'Introduce a standardised clinical record template with a mandatory field for ' + lower(n) + ', and brief the team on its use.'; } },
    { key: 'radiograph', test: /radiograph|x-ray|opt|imaging/i,
      title: function (n) { return 'Reporting prompt for “' + n + '”'; },
      text: function (n) { return 'Add a radiograph reporting checklist or prompt so that ' + lower(n) + ' is completed and recorded at the time of exposure.'; } },
    { key: 'tracking', test: /letter|correspondence|referral|within \d+|weeks?|days?/i,
      title: function (n) { return 'Tracking log for “' + n + '”'; },
      text: function (n) { return 'Set up a tracking log with a reminder flag so that ' + lower(n) + ' can be monitored and followed up before the deadline.'; } },
    { key: 'consent', test: /consent|risk|alternative/i,
      title: function (n) { return 'Structured consent prompt for “' + n + '”'; },
      text: function (n) { return 'Introduce a procedure-specific consent form or notes prompt covering ' + lower(n) + '.'; } }
  ];
  function lower(s) { s = String(s || ''); return s.charAt(0).toLowerCase() + s.slice(1); }

  function suggestionsFor(project) {
    const b = project.baseline;
    if (!b) return [];
    const decisions = project.suggestionDecisions || {};
    const out = [];
    b.rows.filter(function (r) { return r.achieved === false; }).forEach(function (r) {
      const hay = [r.name, r.measurementMethod, r.description].join(' ');
      const t = TEMPLATES.find(function (x) { return x.test.test(hay); });
      const measure = 'Achieve at least ' + (r.target >= 100 ? 95 : r.target) + '% compliance for this criterion in the next audit cycle (target ' + r.target + '%)';
      const finding = '“' + r.name + '” compliance was ' + fmtPct(r.compliance) + ' (' + r.met + '/' + r.denominator + ') in ' + b.cycleLabel + ', below the target of ' + r.target + '%.';
      const mk = function (key, title, text) {
        const id = 'sug_' + r.criterionId + '_' + key;
        out.push({ id: id, criterionId: r.criterionId, criterionName: r.name, finding: finding, title: title, intervention: text, successMeasure: measure, decision: decisions[id] || null });
      };
      if (t) mk(t.key, t.title(r.name), t.text(r.name));
      else mk('protocol', 'Protocol review for “' + r.name + '”', 'Review the local protocol for ' + lower(r.name) + ' with the team and agree one practical change to support it.');
      mk('education', 'Team briefing on the “' + r.name + '” standard', 'Share the baseline result at a team meeting and deliver a short teaching session on the standard and how compliance is measured.');
    });
    return out;
  }

  /** Aggregate-only context for a future AI suggestion request (sent only to a configured secure backend). */
  function aiRequest(project) {
    const b = project.baseline || { rows: [] };
    return {
      schema: DA.ai.SCHEMA, task: 'qi_suggestions', section: null,
      prompt: {
        system: 'You are helping a UK dental clinician plan quality improvement interventions. Follow these rules strictly:\n' + DA.ai.RULES.map(function (r, i) { return (i + 1) + '. ' + r; }).join('\n'),
        user: 'Suggest practical, measurable interventions for each criterion below target. These are suggestions for the clinical team to consider, not recommendations. Context JSON:\n' + JSON.stringify({
          aim: project.aim || null,
          baseline: { cycle: b.cycleLabel, completed: b.completed, criteria: b.rows.map(function (r, i) { return { ref: 'C' + (i + 1), name: r.name, target: r.target, compliancePct: round(r.compliance, 1), compliant: r.met, eligible: r.denominator, achieved: r.achieved }; }) }
        })
      },
      rules: DA.ai.RULES, context: { baselineOnly: true }, constraints: { maxWords: 400, format: 'plain text bullets' }
    };
  }

  /* =========================================================
   * Landing page lists
   * ========================================================= */
  function awaitingIntervention() {
    const projects = DA.store.getQiProjects();
    return DA.store.getAudits().filter(function (a) {
      if (a.status === 'draft') return false;
      const cyc = C.currentCycle(a);
      const s = series(a);
      // Use the most recent cycle with completed data.
      const withData = s.filter(function (r) { return r.audit.id === a.id && r.cycle.records.some(function (x) { return x.status === 'completed'; }); });
      if (!withData.length || !cyc) return false;
      if (cyc.status !== 'completed' && ['analysis', 'action', 'completed'].indexOf(a.status) === -1) return false;
      const res = cycleResults(withData[withData.length - 1]);
      const below = res.rows.some(function (r) { return r.achieved === false; });
      const linked = projects.some(function (p) { return p.auditId === a.id && p.status !== 'cancelled' && interventionsFor(p.id).length; });
      return below && !linked;
    });
  }

  function reauditsDue() {
    return DA.store.getAudits().filter(function (a) { return DA.metrics.isReauditDue(a, 30); });
  }

  return {
    PROJECT_STATUS, PRIORITY, IV_STATUS, OPEN, EFFECTIVENESS, PDSA_STAGES, PDSA_STATUS, ACT_DECISIONS,
    fmtPct, fmtPP, fmtRel, fmtDelta, round,
    lineage, series, ref, refKey, cycleCriteria, cycleResults, criterionKeyer, ruleOf,
    compare, defaultPair, pairKey,
    baselineFrom, prioritySummary, interventionsFor, pdsaFor, isOverdue, ivStatus, pdsaStatus,
    projectSeries, latestRef, nextReauditDate, dashboard, projectStatusMeta, nextReview, projectUpdatedAt,
    milestones, timeline, suggestionsFor, aiRequest, awaitingIntervention, reauditsDue
  };
})();
