/* DentalAudit — report engine
 *
 * Deterministic, data-driven report building. Nothing here is AI: every figure comes
 * from the audit's case records via the same calculation the analytics engine uses,
 * and every sentence is generated from recorded audit data.
 *
 * Report (stored in state.reports)
 * {
 *   id, auditId, cycleId, title, reportType, length: 'comprehensive' | 'summary',
 *   meta: { auditTitle, department, institution, specialty, auditLead, collaborators[], cycleLabel,
 *           periodFrom, periodTo, reportDate },
 *   sectionOrder: [key], sections: { [key]: { key, title, included, html, status, aiDraft, updatedAt } },
 *   actionPlan: [{ id, issue, criterionId, intervention, responsible, targetDate, successMeasure,
 *                  reviewDate, status, source: 'suggested' | 'manual', approved }],
 *   references: [{ id, text, source: 'criteria' | 'manual' }],
 *   analyticsSnapshot: { … see buildSnapshot() … }, snapshotAt, datasetFingerprint,
 *   status: 'draft' | 'in_review' | 'approved' | 'archived', revision, revisions: [ … ],
 *   review: { author, reviewer, reviewerComments, reviewDate, approvalDate, approvedBy },
 *   createdAt, updatedAt, approvedAt
 * }
 *
 * Section HTML may contain data blocks — <div class="rb" data-block="results-table"></div> —
 * which are rendered from the report's frozen analytics snapshot, never from live data.
 */
DA.reportEngine = (function () {
  const U = DA.utils, C = DA.collection;

  const TYPES = {
    clinical: 'Clinical Audit Report',
    qi: 'Quality Improvement Report',
    service: 'Service Evaluation Report',
    reaudit: 'Re-audit / Comparison Report',
    summary: 'Short Audit Summary'
  };

  const SECTIONS = [
    { key: 'title', title: 'Title Page', required: true },
    { key: 'executive', title: 'Executive Summary' },
    { key: 'background', title: 'Background and Rationale' },
    { key: 'aims', title: 'Aim and Objectives' },
    { key: 'standards', title: 'Standards and Criteria' },
    { key: 'methodology', title: 'Methodology' },
    { key: 'results', title: 'Results' },
    { key: 'discussion', title: 'Discussion' },
    { key: 'recommendations', title: 'Recommendations' },
    { key: 'actionplan', title: 'Action Plan' },
    { key: 'limitations', title: 'Limitations' },
    { key: 'conclusion', title: 'Conclusion' },
    { key: 'reaudit', title: 'Re-audit Plan' },
    { key: 'references', title: 'References' },
    { key: 'appendices', title: 'Appendices' }
  ];
  // Quality improvement / re-audit sections (js/core/qi-report.js) are slotted in after their anchor.
  if (DA.qiReport) DA.qiReport.SECTIONS.forEach(function (q) {
    const i = SECTIONS.findIndex(function (x) { return x.key === q.after; });
    SECTIONS.splice(i + 1, 0, { key: q.key, title: q.title, qi: true });
  });
  const SUMMARY_SET = ['title', 'executive', 'results', 'recommendations', 'actionplan', 'conclusion', 'references'];
  const ACTION_STATUSES = ['Not Started', 'In Progress', 'Completed', 'Overdue'];

  function sectionDef(key) { return SECTIONS.find(function (s) { return s.key === key; }); }

  function isQiType(type) { return type === 'qi' || type === 'reaudit'; }
  function defaultSelection(type, length) {
    const qi = isQiType(type) && DA.qiReport ? DA.qiReport.DEFAULTS[type] : [];
    if (type === 'summary' || length === 'summary') return SUMMARY_SET.concat(isQiType(type) ? ['comparison', 'compliancechange'] : []);
    return SECTIONS.filter(function (s) { return !s.qi || qi.indexOf(s.key) !== -1; }).map(function (s) { return s.key; });
  }

  /* =========================================================
   * Small helpers
   * ========================================================= */
  const esc = U.esc;
  function pct(v) { return v === null || v === undefined || isNaN(v) ? 'not calculable' : (Math.round(v * 10) / 10) + '%'; }
  function pctShort(v) { return v === null || v === undefined || isNaN(v) ? '—' : Math.round(v) + '%'; }
  function block(key, extra) { return '<div class="rb" data-block="' + key + '"' + (extra ? ' data-arg="' + esc(extra) + '"' : '') + ' contenteditable="false"></div>'; }
  function ph(text) { return '<p class="ph">[' + esc(text) + ']</p>'; }
  function lower(s) { return String(s || '').charAt(0).toLowerCase() + String(s || '').slice(1); }
  function joinList(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function stripPunct(s) { return String(s || '').trim().replace(/[.?!]+$/, ''); }
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /* =========================================================
   * Analytics snapshot — the frozen figures a report is built on
   * ========================================================= */
  function cycleOf(audit, cycleId) {
    return (cycleId && C.cycleById(audit, cycleId)) || C.currentCycle(audit);
  }

  /** Changes whenever anything that could alter the report's figures changes. */
  function fingerprint(audit, cycleId) {
    const cyc = cycleOf(audit, cycleId);
    if (!cyc) return 'none';
    return hash(JSON.stringify({
      crit: audit.criteria.map(function (c) { return [c.id, c.name, c.target]; }),
      form: cyc.form ? cyc.form.version : 0,
      recs: cyc.records.map(function (r) { return [r.id, r.status, r.updatedAt, r.results]; }),
      target: audit.targetSampleSize
    }));
  }

  /** Criterion results for one cycle — identical formula to DA.metrics.criterionResults. */
  function criterionResults(audit, cyc) {
    const done = cyc.records.filter(function (r) { return r.status === 'completed'; });
    return audit.criteria.map(function (c) {
      let met = 0, notMet = 0, na = 0;
      done.forEach(function (r) {
        const v = r.results ? r.results[c.id] : null;
        if (v === 'met') met++; else if (v === 'not_met') notMet++; else if (v === 'na') na++;
      });
      const den = met + notMet;
      const linked = !!(cyc.form && cyc.form.fields.some(function (f) { return f.linkedCriterionId === c.id; }));
      const compliance = den ? (met / den) * 100 : null;
      const target = Number(c.target) || 0;
      return {
        id: c.id, name: c.name, description: c.description || '', reference: c.reference || '',
        measurementMethod: c.measurementMethod || '', numeratorDef: c.numerator || '', denominatorDef: c.denominator || '',
        target: target, numerator: met, denominator: den, notMet: notMet, na: na,
        notEvidenced: Math.max(0, done.length - met - notMet - na), linked: linked,
        compliance: compliance, achieved: compliance === null ? null : compliance >= target,
        parentCriterionId: c.parentCriterionId || null
      };
    });
  }

  function numericSummary(form, records) {
    if (!form) return [];
    return form.fields.filter(function (f) { return f.type === 'number' || f.type === 'rating'; }).map(function (f) {
      const vals = [];
      let na = 0;
      records.forEach(function (r) {
        const v = r.responses[f.id];
        if (v === C.NA) { na++; return; }
        if (v === '' || v === null || v === undefined) return;
        const n = Number(v);
        if (!isNaN(n)) vals.push(n);
      });
      vals.sort(function (a, b) { return a - b; });
      const n = vals.length;
      const mean = n ? vals.reduce(function (s, x) { return s + x; }, 0) / n : null;
      const sd = n > 1 ? Math.sqrt(vals.reduce(function (s, x) { return s + Math.pow(x - mean, 2); }, 0) / (n - 1)) : null;
      const median = n ? (n % 2 ? vals[(n - 1) / 2] : (vals[n / 2 - 1] + vals[n / 2]) / 2) : null;
      return {
        fieldId: f.id, label: f.label, type: f.type, n: n, na: na, missing: records.length - n - na,
        mean: mean, sd: sd, median: median, min: n ? vals[0] : null, max: n ? vals[n - 1] : null,
        scale: f.type === 'rating' ? f.ratingMin + '–' + f.ratingMax : null
      };
    });
  }

  function categoricalSummary(form, records) {
    if (!form) return [];
    return form.fields.filter(function (f) {
      return ['select', 'radio', 'multiselect', 'yesno', 'checkbox'].indexOf(f.type) !== -1 && !f.linkedCriterionId;
    }).map(function (f) {
      const opts = C.choiceOptions(f);
      const counts = {};
      opts.forEach(function (o) { counts[o.id] = 0; });
      let answered = 0, other = 0;
      records.forEach(function (r) {
        let v = r.responses[f.id];
        if (f.type === 'checkbox') v = v === true ? 'checked' : v === false ? 'unchecked' : undefined;
        if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) return;
        answered++;
        (Array.isArray(v) ? v : [v]).forEach(function (x) { if (counts[x] !== undefined) counts[x]++; else other++; });
      });
      const rows = opts.map(function (o) { return { label: o.label, n: counts[o.id], pct: answered ? counts[o.id] / answered * 100 : null }; });
      if (other) rows.push({ label: '(option since removed)', n: other, pct: answered ? other / answered * 100 : null });
      return { fieldId: f.id, label: f.label, type: f.type, multi: f.type === 'multiselect', n: answered, missing: records.length - answered, rows: rows };
    });
  }

  function previousCycle(audit, cyc) {
    let prevAudit = null, prevCyc = null;
    const idx = audit.cycles.indexOf(cyc);
    if (idx > 0) { prevAudit = audit; prevCyc = audit.cycles[idx - 1]; }
    else if (audit.parentId) { prevAudit = DA.store.getAudit(audit.parentId); prevCyc = prevAudit ? C.currentCycle(prevAudit) : null; }
    if (!prevAudit || !prevCyc) return null;
    const prev = criterionResults(prevAudit, prevCyc);
    return {
      auditId: prevAudit.id, cycleId: prevCyc.id, cycleLabel: prevCyc.label,
      completed: prevCyc.records.filter(function (r) { return r.status === 'completed'; }).length,
      criteria: audit.criteria.map(function (c) {
        const p = prev.find(function (x) { return x.id === (prevAudit === audit ? c.id : c.parentCriterionId); });
        return { id: c.id, name: c.name, compliance: p ? p.compliance : null, numerator: p ? p.numerator : null, denominator: p ? p.denominator : null };
      })
    };
  }

  /**
   * Freeze every figure the report needs. The report renders only from this object,
   * so adding or editing cases later never silently changes a generated report.
   */
  function buildSnapshot(audit, cycleId, qiOpts) {
    const cyc = cycleOf(audit, cycleId);
    const recs = cyc ? cyc.records : [];
    const done = recs.filter(function (r) { return r.status === 'completed'; });
    const crit = cyc ? criterionResults(audit, cyc) : [];
    let met = 0, app = 0;
    crit.forEach(function (c) { met += c.numerator; app += c.denominator; });
    const dates = done.map(function (r) { return r.collectionDate; }).filter(Boolean).sort();
    const versions = [];
    done.forEach(function (r) { if (versions.indexOf(r.formVersion) === -1) versions.push(r.formVersion); });
    const target = Number(audit.targetSampleSize) || 0;
    const form = cyc && cyc.form;
    return {
      schema: 1,
      generatedAt: new Date().toISOString(),
      auditId: audit.id, cycleId: cyc ? cyc.id : null, cycleLabel: cyc ? cyc.label : '', cycleNumber: cyc ? cyc.number : 1,
      fingerprint: fingerprint(audit, cyc && cyc.id),
      totals: {
        records: recs.length, completed: done.length, drafts: recs.length - done.length,
        completeness: recs.length ? done.length / recs.length * 100 : null,
        targetSample: target, sampleAchieved: target ? done.length / target * 100 : null,
        collectedFrom: dates[0] || null, collectedTo: dates[dates.length - 1] || null
      },
      criteria: crit,
      overall: {
        met: met, applicable: app, compliance: app ? met / app * 100 : null,
        achieved: crit.filter(function (c) { return c.achieved === true; }).length,
        notAchieved: crit.filter(function (c) { return c.achieved === false; }).length,
        noData: crit.filter(function (c) { return c.achieved === null; }).length,
        total: crit.length
      },
      numeric: numericSummary(form, done),
      categorical: categoricalSummary(form, done),
      previous: cyc ? previousCycle(audit, cyc) : null,
      // Frozen quality improvement / re-audit data (interventions, PDSA, cycle comparison).
      qi: qiOpts && DA.qiReport && cyc ? DA.qiReport.buildQi(audit, cyc, qiOpts) : null,
      form: form ? {
        version: form.version, fieldCount: form.fields.length,
        linkedCount: form.fields.filter(function (f) { return f.linkedCriterionId; }).length,
        versionsUsed: versions.sort(),
        fields: form.fields.map(function (f) {
          return { label: f.label, type: C.TYPES[f.type].label, required: !!f.required, linkedCriterionId: f.linkedCriterionId || null, rule: complianceRule(f) };
        })
      } : null,
      method: {
        compliance: 'Compliance = compliant cases ÷ eligible cases (compliant + non-compliant) × 100. Cases recorded as not applicable are excluded from the denominator. Incomplete (draft) records are excluded.',
        source: 'DentalAudit analytics engine — completed case records in ' + (cyc ? cyc.label : 'the selected cycle') + ', scored against the linked data collection form fields.'
      }
    };
  }

  function complianceRule(f) {
    if (!f.linkedCriterionId) return '';
    if (C.TYPES[f.type].choice) {
      const lab = f.compliantValues.map(function (v) { return C.optionLabel(f, v); }).filter(Boolean);
      return (lab.length ? lab.join(' / ') : '—') + ' = compliant';
    }
    if (f.type === 'number' || f.type === 'rating') return 'Compliant range ' + (f.compliantMin !== '' ? f.compliantMin : '−∞') + ' to ' + (f.compliantMax !== '' ? f.compliantMax : '∞');
    return 'Any recorded answer = compliant';
  }

  /** Every number that legitimately appears in the snapshot (used to check AI drafts). */
  function snapshotNumbers(s, audit) {
    const set = new Set();
    const add = function (v) {
      if (v === null || v === undefined || isNaN(v)) return;
      set.add(String(Math.round(v)));
      set.add(String(Math.round(v * 10) / 10));
    };
    const t = s.totals;
    [t.records, t.completed, t.drafts, t.completeness, t.targetSample, t.sampleAchieved, s.overall.met, s.overall.applicable, s.overall.compliance,
      s.overall.achieved, s.overall.notAchieved, s.overall.total, s.cycleNumber].forEach(add);
    s.criteria.forEach(function (c, i) {
      [c.target, c.numerator, c.denominator, c.na, c.notMet, c.notEvidenced, c.compliance, i + 1].forEach(add);
      if (c.compliance !== null) add(c.compliance - c.target);
    });
    s.numeric.forEach(function (n) { [n.n, n.mean, n.sd, n.median, n.min, n.max, n.missing].forEach(add); });
    s.categorical.forEach(function (c) { add(c.n); c.rows.forEach(function (r) { add(r.n); add(r.pct); }); });
    if (s.previous) s.previous.criteria.forEach(function (p) {
      [p.compliance, p.numerator, p.denominator].forEach(add);
      const cur = s.criteria.find(function (c) { return c.id === p.id; });
      if (cur && cur.compliance !== null && p.compliance !== null) add(cur.compliance - p.compliance);
    });
    if (audit) add(audit.reauditMonths);
    if (s.qi && DA.qiReport) DA.qiReport.numbers(s.qi, add);
    return set;
  }

  /* =========================================================
   * Findings used by several sections
   * ========================================================= */
  function findings(s) {
    const below = s.criteria.filter(function (c) { return c.achieved === false; })
      .sort(function (a, b) { return (a.compliance - a.target) - (b.compliance - b.target); });
    const met = s.criteria.filter(function (c) { return c.achieved === true; });
    const noData = s.criteria.filter(function (c) { return c.achieved === null; });
    const highNA = s.criteria.filter(function (c) { return s.totals.completed && c.na / s.totals.completed >= 0.2; });
    const unscored = s.criteria.filter(function (c) { return c.notEvidenced > 0; });
    return { below: below, met: met, noData: noData, highNA: highNA, unscored: unscored };
  }

  function critFigure(c) {
    return pct(c.compliance) + ' (' + c.numerator + '/' + c.denominator + ')';
  }

  /** Recommendations tied to specific findings — never generic. */
  function recommendationItems(s, audit) {
    const f = findings(s);
    const out = [];
    f.below.forEach(function (c) {
      out.push({
        criterionId: c.id,
        title: c.name,
        html: '<strong>' + esc(c.name) + '</strong> — compliance was ' + critFigure(c) + ' against a target of ' + c.target + '%. ' +
          'Review how this standard' + (c.reference ? ' (' + esc(c.reference) + ')' : '') + ' is currently ' + (/record|documentation|correspondence/i.test(c.measurementMethod) ? 'documented' : 'delivered') + ' with the clinical team, agree a targeted intervention' +
          (/record|documentation/i.test(c.measurementMethod) ? ' (for example a structured prompt in the clinical notes template, supported by team teaching)' : '') +
          ', and re-measure at re-audit with the aim of reaching at least ' + c.target + '%.'
      });
    });
    if (f.noData.length) {
      out.push({ html: '<strong>Unscored criteria</strong> — ' + joinList(f.noData.map(function (c) { return '“' + esc(c.name) + '”'; })) + ' had no eligible cases' +
        (f.noData.some(function (c) { return !c.linked; }) ? ', partly because no data collection field is linked to ' + (f.noData.length === 1 ? 'it' : 'them') : '') +
        '. Link a field to each criterion in the data collection form so that it can be measured at re-audit.' });
    }
    if (s.totals.drafts > 0 || f.unscored.length) {
      out.push({ html: '<strong>Data completeness</strong> — ' + (s.totals.drafts ? plural(s.totals.drafts, 'incomplete record') + ' were excluded' : '') +
        (s.totals.drafts && f.unscored.length ? ' and ' : '') +
        (f.unscored.length ? f.unscored.reduce(function (n, c) { return n + c.notEvidenced; }, 0) + ' criterion assessments could not be scored' : '') +
        '. Complete or remove incomplete records before re-audit and make linked questions mandatory.' });
    }
    if (s.totals.targetSample && s.totals.completed < s.totals.targetSample) {
      out.push({ html: '<strong>Sample size</strong> — ' + s.totals.completed + ' of the planned ' + s.totals.targetSample + ' cases were completed. Reach the planned sample before drawing firm conclusions or at the next cycle.' });
    }
    if (f.met.length) {
      out.push({ html: '<strong>Sustain good practice</strong> — maintain current practice for the ' + plural(f.met.length, 'criterion', 'criteria') + ' that met ' + (f.met.length === 1 ? 'its' : 'their') + ' target and include ' + (f.met.length === 1 ? 'it' : 'them') + ' in the re-audit to confirm compliance is sustained.' });
    }
    return out;
  }

  /** Suggested actions for every criterion below target. Users must approve each one. */
  function suggestActions(s, audit, report) {
    const due = U.isoDay(U.addDays(new Date(), 90));
    const review = U.isoDay(U.addDays(new Date(), 120));
    return findings(s).below.map(function (c) {
      return {
        id: DA.model.newId('act'),
        issue: '“' + c.name + '” compliance ' + pctShort(c.compliance) + ' (' + c.numerator + '/' + c.denominator + ') against a ' + c.target + '% target',
        criterionId: c.id,
        intervention: /record|documentation/i.test(c.measurementMethod)
          ? 'Add a structured prompt for this item to the clinical notes template and brief the team on the standard'
          : 'Review the local protocol for this standard with the team and agree a practical change to support it',
        responsible: (report && report.meta.auditLead) || audit.auditLead || '',
        targetDate: due,
        successMeasure: 'Compliance ≥ ' + c.target + '% for this criterion at re-audit',
        reviewDate: review,
        status: 'Not Started',
        source: 'suggested',
        approved: false
      };
    });
  }

  function actionStatus(a) {
    if (a.status !== 'Completed' && a.targetDate && a.targetDate < U.isoDay(new Date())) return 'Overdue';
    return a.status;
  }

  function criteriaReferences(audit) {
    const out = [];
    audit.criteria.forEach(function (c) {
      const r = (c.reference || '').trim();
      if (r && !out.some(function (x) { return x.text === r; })) out.push({ id: 'ref_c_' + hash(r), text: r, source: 'criteria' });
    });
    return out;
  }

  /* =========================================================
   * Section generators (deterministic, from recorded data)
   * ========================================================= */
  function gen(key, ctx) {
    const a = ctx.audit, s = ctx.snap, r = ctx.report;
    const f = findings(s);
    const t = s.totals;
    const objectives = DA.model.filled(a.objectives);
    if (DA.qiReport && DA.qiReport.KEYS.indexOf(key) !== -1) return DA.qiReport.gen(key, ctx);
    switch (key) {
      case 'title':
        return '<p class="rp-note">The title page is generated from the report settings. Edit them under Report information.</p>';

      case 'executive': {
        const bg = (a.background || '').split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
        const recs = recommendationItems(s, a).slice(0, 3);
        return '<h4>Background</h4>' + (bg ? '<p>' + esc(bg) + '</p>' : ph('Add a brief background — none was recorded in the audit protocol')) +
          '<h4>Aim</h4>' + (a.aim ? '<p>' + esc(a.aim) + '</p>' : ph('Add the audit aim')) +
          '<h4>Method</h4><p>' + esc(a.projectType || 'Clinical audit') + ' of ' + plural(t.completed, 'completed case') +
            (t.collectedFrom ? ' collected between ' + U.fmtDate(t.collectedFrom) + ' and ' + U.fmtDate(t.collectedTo) : '') +
            (a.samplingMethod ? ' using ' + esc(lower(DA.model.samplingText(a))) : '') + ', measured against ' + plural(s.criteria.length, 'criterion', 'criteria') + '.</p>' +
          '<h4>Main findings</h4>' +
          (t.completed
            ? '<ul><li>' + s.overall.achieved + ' of ' + s.overall.total + ' criteria met their target' + (s.overall.noData ? ' (' + s.overall.noData + ' could not be scored)' : '') + '.</li>' +
              '<li>Overall compliance across all criterion assessments was ' + pct(s.overall.compliance) + ' (' + s.overall.met + '/' + s.overall.applicable + ').</li>' +
              f.below.map(function (c) { return '<li>' + esc(c.name) + ': ' + critFigure(c) + ' against a ' + c.target + '% target.</li>'; }).join('') +
              (s.previous ? '<li>Compared with ' + esc(s.previous.cycleLabel) + ', see the cycle comparison in Results.</li>' : '') + '</ul>'
            : '<p>No completed cases have been recorded in ' + esc(s.cycleLabel) + ', so compliance cannot yet be reported.</p>') +
          '<h4>Key recommendations</h4>' + (recs.length ? '<ul>' + recs.map(function (x) { return '<li>' + x.html + '</li>'; }).join('') + '</ul>' : ph('Add key recommendations'));
      }

      case 'background':
        return (a.background ? a.background.split(/\n{2,}/).map(function (p) { return '<p>' + esc(p.trim()) + '</p>'; }).join('') : ph('Background and rationale were not recorded in the audit protocol — add them here')) +
          (a.auditQuestion ? '<p><strong>Audit question:</strong> ' + esc(a.auditQuestion) + '</p>' : '') +
          (a.description ? '<p>' + esc(a.description) + '</p>' : '');

      case 'aims':
        return '<p><strong>Aim:</strong> ' + (a.aim ? esc(a.aim) : '<span class="ph">[Add the aim]</span>') + '</p>' +
          (objectives.length ? '<p><strong>Objectives</strong></p><ol>' + objectives.map(function (o) { return '<li>' + esc(o.text) + '</li>'; }).join('') + '</ol>' : ph('Add specific objectives'));

      case 'standards': {
        const refs = criteriaReferences(a).map(function (x) { return x.text; });
        return '<p>Practice was measured against ' + plural(s.criteria.length, 'criterion', 'criteria') + (refs.length ? ' derived from ' + esc(joinList(refs)) : '') +
          '. Target compliance levels were set in the audit protocol before data collection began.</p>' + block('criteria-table');
      }

      case 'methodology': {
        const inc = DA.model.filled(a.inclusionCriteria), exc = DA.model.filled(a.exclusionCriteria);
        const methods = DA.model.collectionMethodsText(a);
        const cyc = cycleOf(a, r.cycleId);
        return '<p>This ' + esc(lower(a.projectType || 'clinical audit')) + ' was conducted in ' + esc(a.department || 'the department') +
          (r.meta.institution ? ', ' + esc(r.meta.institution) : '') + '. ' +
          (a.methodology ? esc(stripPunct(a.methodology)) + '. ' : '') +
          (a.samplingMethod ? 'Cases were identified using ' + esc(lower(DA.model.samplingText(a))) : 'Cases were identified') +
          (t.targetSample ? ', with a target sample of ' + t.targetSample + ' cases' : '') + '. ' +
          'Data were collected ' + (cyc && cyc.collectionStartDate ? 'between ' + U.fmtDate(cyc.collectionStartDate) + ' and ' + U.fmtDate(cyc.collectionEndDate) : 'during the audit period') +
          (methods.length ? ' from ' + esc(lower(joinList(methods))) : '') + '.</p>' +
          '<p>' + plural(t.completed, 'completed case') + ' were included in the analysis' + (t.targetSample ? ' (' + pct(t.sampleAchieved) + ' of the target sample)' : '') + '.' +
          (t.drafts ? ' A further ' + plural(t.drafts, 'incomplete record') + ' ' + (t.drafts === 1 ? 'was' : 'were') + ' excluded.' : '') +
          (s.form ? ' Each case was assessed using a structured data collection form (version ' + s.form.version + ') containing ' + plural(s.form.fieldCount, 'field') + ', of which ' + s.form.linkedCount + ' ' + (s.form.linkedCount === 1 ? 'was' : 'were') + ' linked to audit criteria.' : '') +
          ' Compliance for each criterion was calculated as the number of compliant cases divided by the number of eligible cases; responses recorded as not applicable were excluded from the denominator.</p>' +
          (inc.length ? '<p><strong>Inclusion criteria</strong></p><ul>' + inc.map(function (x) { return '<li>' + esc(x.text) + '</li>'; }).join('') + '</ul>' : '') +
          (exc.length ? '<p><strong>Exclusion criteria</strong></p><ul>' + exc.map(function (x) { return '<li>' + esc(x.text) + '</li>'; }).join('') + '</ul>' : '');
      }

      case 'results': {
        if (!t.records) return '<p>No case records have been collected in ' + esc(s.cycleLabel) + '. Results will appear here once data collection has started and the data are refreshed.</p>';
        return block('results-summary') +
          '<p>Of ' + plural(t.records, 'record') + ' in ' + esc(s.cycleLabel) + ', ' + t.completed + ' ' + (t.completed === 1 ? 'was' : 'were') + ' complete (' + pct(t.completeness) + ' data completeness)' +
            (t.collectedFrom ? ', collected between ' + U.fmtDate(t.collectedFrom) + ' and ' + U.fmtDate(t.collectedTo) : '') + '. ' +
            s.overall.achieved + ' of ' + s.overall.total + ' criteria met their target.</p>' +
          '<h4>Compliance by criterion</h4>' + block('results-table') + block('chart-compliance') +
          (s.numeric.length ? '<h4>Numerical variables</h4>' + block('numeric-summary') : '') +
          (s.categorical.length ? '<h4>Categorical variables</h4>' + block('categorical') : '') +
          (s.previous ? '<h4>Comparison with ' + esc(s.previous.cycleLabel) + '</h4>' + block('cycle-table') + block('chart-cycle') : '');
      }

      case 'discussion': {
        if (!t.completed) return '<p>No completed cases are available, so findings cannot yet be discussed.</p>';
        const lines = [];
        if (f.met.length) lines.push('<p>' + plural(f.met.length, 'criterion', 'criteria') + ' met ' + (f.met.length === 1 ? 'its' : 'their') + ' target: ' + joinList(f.met.map(function (c) { return esc(c.name) + ' (' + pctShort(c.compliance) + ')'; })) + '.</p>');
        if (f.below.length) lines.push('<p>' + plural(f.below.length, 'criterion', 'criteria') + ' did not meet ' + (f.below.length === 1 ? 'its' : 'their') + ' target. The largest shortfall was for ' + esc(f.below[0].name) + ' (' + critFigure(f.below[0]) + ' against ' + f.below[0].target + '%, a gap of ' + Math.round(f.below[0].target - f.below[0].compliance) + ' percentage points).</p>');
        else lines.push('<p>All scored criteria met their target.</p>');
        f.highNA.forEach(function (c) { lines.push('<p>For ' + esc(c.name) + ', ' + c.na + ' of ' + t.completed + ' cases were recorded as not applicable and excluded from the denominator, so the result is based on ' + c.denominator + ' eligible cases.</p>'); });
        if (s.previous) {
          const ch = s.criteria.map(function (c) { const p = s.previous.criteria.find(function (x) { return x.id === c.id; }); return p && p.compliance !== null && c.compliance !== null ? { c: c, d: c.compliance - p.compliance, p: p } : null; }).filter(Boolean);
          const up = ch.filter(function (x) { return x.d > 0; }), down = ch.filter(function (x) { return x.d < 0; });
          if (ch.length) lines.push('<p>Compared with ' + esc(s.previous.cycleLabel) + ', compliance improved for ' + up.length + ' and fell for ' + down.length + ' of ' + ch.length + ' comparable criteria. Change between cycles shows association with the actions taken, not proof that they caused it.</p>');
        }
        return '<h4>Observed findings</h4>' + lines.join('') +
          (f.below.length ? '<h4>Possible explanations</h4><p class="rp-note">The following are hypotheses for the audit team to explore. They were not tested by this audit and should not be reported as findings.</p><ul>' +
            f.below.map(function (c) {
              return '<li>' + esc(c.name) + ': ' + (/record|documentation|correspondence/i.test(c.measurementMethod)
                ? 'the item may be carried out but not recorded, or the current record template may not prompt it.'
                : 'variation in local process or awareness of the standard may contribute.') + '</li>';
            }).join('') + '</ul>' : '') +
          '<h4>Implications for practice</h4>' + (f.below.length
            ? '<p>Shortfalls against agreed standards indicate where a targeted change is most likely to improve the consistency of care and documentation. Priorities are set out in the recommendations and action plan.</p>'
            : '<p>Current practice meets the agreed standards; the priority is to sustain this and confirm it at re-audit.</p>') +
          '<h4>Areas for further investigation</h4><ul>' +
            (f.below.length ? '<li>Discuss the shortfalls with the clinical team to establish the actual reasons before finalising interventions.</li>' : '') +
            (f.unscored.length || t.drafts ? '<li>Review incomplete or unscorable records to understand whether missing data affected the results.</li>' : '') +
            '<li>Consider whether results differ between clinicians, clinics or time periods (not analysed in this report).</li></ul>';
      }

      case 'recommendations': {
        const items = recommendationItems(s, a);
        return items.length ? '<p>The following recommendations relate directly to the findings above.</p><ol>' + items.map(function (x) { return '<li>' + x.html + '</li>'; }).join('') + '</ol>'
          : ph('No findings require recommendations yet — add recommendations once data are available');
      }

      case 'actionplan':
        return '<p>The actions below were agreed to address the standards that were not met. Each action has an owner, a target date and a measure of success.</p>' + block('action-plan');

      case 'limitations': {
        const items = [];
        const meth = [a.methodology, a.samplingMethod, a.samplingOther].join(' ').toLowerCase();
        if (!t.completed) items.push('No completed cases were available, so results cannot be interpreted.');
        if (t.targetSample && t.completed < t.targetSample) items.push('The analysed sample (' + t.completed + ' cases) is below the planned target of ' + t.targetSample + ', which reduces the precision of compliance estimates.');
        else if (t.completed && t.completed < 30) items.push('The sample of ' + t.completed + ' cases is small, so a change of one or two cases noticeably alters percentages.');
        if (/retrospective/.test(meth)) items.push('Data were collected retrospectively, so results reflect what was documented rather than necessarily what was done.');
        else if (a.collectionMethods.some(function (m) { return /records/i.test(m); })) items.push('Data were taken from clinical records, so results reflect the quality of documentation as well as clinical practice.');
        if (a.samplingMethod && a.samplingMethod !== 'Random sampling') items.push('Cases were selected by ' + lower(DA.model.samplingText(a)) + ' rather than random sampling, so the sample may not represent all time periods, clinicians or patient groups (potential selection bias).');
        items.push('The audit was conducted in a single setting (' + (a.department || 'one department') + '), so findings may not apply to other services.');
        if (t.drafts || f.unscored.length) items.push('Some data were missing: ' + [t.drafts ? plural(t.drafts, 'incomplete record') + ' excluded' : '', f.unscored.length ? f.unscored.reduce(function (n, c) { return n + c.notEvidenced; }, 0) + ' criterion assessments not scorable' : ''].filter(Boolean).join('; ') + '.');
        if (f.noData.length) items.push(plural(f.noData.length, 'criterion', 'criteria') + ' could not be measured because no eligible cases were recorded.');
        if (s.form && s.form.versionsUsed.length > 1) items.push('The data collection form changed during the cycle (versions ' + s.form.versionsUsed.join(', ') + ' were used), which may affect consistency between cases.');
        return '<p>The following limitations are based on the recorded methodology and the characteristics of the dataset.</p><ul>' + items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
      }

      case 'conclusion':
        return t.completed
          ? '<p>This audit of ' + plural(t.completed, 'case') + ' found that ' + s.overall.achieved + ' of ' + s.overall.total + ' predefined standards ' + (s.overall.achieved === 1 ? 'was' : 'were') + ' met' +
            (f.below.length ? ', while ' + joinList(f.below.map(function (c) { return esc(c.name) + ' (' + pctShort(c.compliance) + ' vs ' + c.target + '%)'; })) + ' fell below target' : '') + '. ' +
            (f.below.length ? 'The action plan sets out targeted changes, and a re-audit will assess their effect.' : 'Current practice should be sustained and confirmed at re-audit.') + '</p>'
          : '<p>Data collection has not yet produced completed cases, so conclusions cannot be drawn.</p>';

      case 'reaudit': {
        const when = a.reauditDate ? 'by ' + U.fmtDate(a.reauditDate) : 'within ' + (a.reauditMonths || DA.store.getSettings().reauditMonths || 12) + ' months of completing the action plan';
        return '<p>A re-audit (cycle ' + (s.cycleNumber + 1) + ') is planned ' + when + ', using the same criteria, targets and data collection form, to assess whether the actions in this report have improved compliance. Results will be compared criterion by criterion with ' + esc(s.cycleLabel) + '.</p>';
      }

      case 'references':
        return '<p>Standards and guidance cited in this report.</p>' + block('references');

      case 'appendices':
        return '<h4>Appendix A: Data collection form</h4>' + (s.form ? block('form-fields') : ph('No data collection form has been saved')) +
          '<h4>Appendix B: Calculation method</h4><p>' + esc(s.method.compliance) + '</p><p>' + esc(s.method.source) + '</p>';
    }
    return '';
  }

  /* =========================================================
   * Building and refreshing reports
   * ========================================================= */
  function newReport(audit, opts) {
    opts = Object.assign({ reportType: 'clinical', length: 'comprehensive' }, opts || {});
    if (!opts.title) opts.title = audit.title + ' — ' + (TYPES[opts.reportType] || 'Audit Report');
    if (!opts.sections) opts.sections = defaultSelection(opts.reportType, opts.length);
    const s = DA.store.getSettings();
    const cyc = cycleOf(audit, opts.cycleId);
    const qiOpts = isQiType(opts.reportType) || opts.qiProjectId ? { projectId: opts.qiProjectId || null, compareFrom: opts.compareFrom || null } : null;
    const snap = buildSnapshot(audit, cyc && cyc.id, qiOpts);
    const now = new Date().toISOString();
    const report = {
      id: DA.model.newId('rpt'),
      auditId: audit.id, cycleId: cyc ? cyc.id : null,
      qiProjectId: opts.qiProjectId || null, compareFrom: opts.compareFrom || (snap.qi && snap.qi.comparison ? snap.qi.comparison.fromKey : null),
      title: opts.title, reportType: opts.reportType, length: opts.length,
      meta: Object.assign({
        auditTitle: audit.title, department: audit.department, institution: s.organisation, specialty: audit.specialty,
        auditLead: audit.auditLead, collaborators: DA.model.filled(audit.collaborators, 'name').map(function (c) { return c.name; }),
        cycleLabel: cyc ? cyc.label : '', periodFrom: snap.totals.collectedFrom || (cyc && cyc.collectionStartDate) || '', periodTo: snap.totals.collectedTo || (cyc && cyc.collectionEndDate) || '',
        reportDate: U.isoDay(new Date())
      }, opts.meta || {}),
      sectionOrder: SECTIONS.map(function (x) { return x.key; }),
      sections: {},
      actionPlan: [],
      references: criteriaReferences(audit),
      analyticsSnapshot: snap, snapshotAt: snap.generatedAt, datasetFingerprint: snap.fingerprint,
      status: 'draft', revision: 1, revisions: [],
      review: { author: s.userName, reviewer: '', reviewerComments: '', reviewDate: '', approvalDate: '', approvedBy: '' },
      createdAt: now, updatedAt: now, approvedAt: ''
    };
    const ctx = { audit: audit, snap: snap, report: report };
    SECTIONS.forEach(function (d) {
      report.sections[d.key] = {
        key: d.key, title: d.title, included: opts.sections.indexOf(d.key) !== -1,
        html: gen(d.key, ctx), status: 'generated', aiDraft: false, updatedAt: now
      };
    });
    report.actionPlan = suggestActions(snap, audit, report);
    return report;
  }

  /**
   * New snapshot from live data. Sections never edited by the user are regenerated;
   * edited sections keep their text (data blocks inside them update automatically)
   * and are flagged for review if they contain figures.
   */
  function qiOptsOf(report) {
    return isQiType(report.reportType) || report.qiProjectId ? { projectId: report.qiProjectId || null, compareFrom: report.compareFrom || null } : null;
  }

  function refreshReport(report, audit) {
    const snap = buildSnapshot(audit, report.cycleId, qiOptsOf(report));
    // Reports created before QI sections existed gain them (excluded) so they can be switched on.
    SECTIONS.forEach(function (d, i) {
      if (report.sections[d.key]) return;
      report.sections[d.key] = { key: d.key, title: d.title, included: false, html: '', status: 'generated', aiDraft: false, updatedAt: new Date().toISOString() };
      const prev = SECTIONS.slice(0, i).reverse().find(function (x) { return report.sectionOrder.indexOf(x.key) !== -1; });
      report.sectionOrder.splice(prev ? report.sectionOrder.indexOf(prev.key) + 1 : report.sectionOrder.length, 0, d.key);
    });
    const ctx = { audit: audit, snap: snap, report: report };
    const flagged = [];
    SECTIONS.forEach(function (d) {
      const sec = report.sections[d.key];
      if (!sec) return;
      if (sec.status === 'generated') sec.html = gen(d.key, ctx);
      else if (/\d/.test(sec.html.replace(/<div class="rb"[^>]*><\/div>/g, '').replace(/<[^>]+>/g, ''))) { sec.status = 'needs_review'; flagged.push(d.title); }
      sec.updatedAt = new Date().toISOString();
    });
    // New suggestions for criteria now below target that have no action yet.
    const existing = report.actionPlan.map(function (x) { return x.criterionId; });
    suggestActions(snap, audit, report).forEach(function (x) { if (existing.indexOf(x.criterionId) === -1) report.actionPlan.push(x); });
    criteriaReferences(audit).forEach(function (x) { if (!report.references.some(function (y) { return y.text === x.text; })) report.references.push(x); });
    report.analyticsSnapshot = snap;
    report.snapshotAt = snap.generatedAt;
    report.datasetFingerprint = snap.fingerprint;
    return { flagged: flagged };
  }

  function regenerateSection(report, audit, key) {
    return gen(key, { audit: audit, snap: report.analyticsSnapshot, report: report });
  }

  function datasetChanged(report) {
    const a = DA.store.getAudit(report.auditId);
    if (!a) return false;
    return fingerprint(a, report.cycleId) !== report.datasetFingerprint || (DA.qiReport ? DA.qiReport.changed(report) : false);
  }

  /** Completion state of a section for the editor's navigation. */
  function sectionState(sec) {
    if (!sec.included) return 'excluded';
    if (sec.aiDraft) return 'ai_draft';
    if (sec.status === 'needs_review') return 'needs_review';
    if (/class="ph"/.test(sec.html)) return 'incomplete';
    if (sec.status === 'reviewed') return 'reviewed';
    return sec.status; // generated | edited
  }

  return {
    TYPES, SECTIONS, SUMMARY_SET, isQiType, qiOptsOf, ACTION_STATUSES, sectionDef, defaultSelection,
    buildSnapshot, fingerprint, snapshotNumbers, findings, recommendationItems, suggestActions, actionStatus,
    criteriaReferences, newReport, refreshReport, regenerateSection, datasetChanged, sectionState, complianceRule,
    pct: pct, pctShort: pctShort
  };
})();
