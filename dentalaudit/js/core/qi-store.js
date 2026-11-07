/* DentalAudit — quality improvement persistence
 * Extends DA.store with improvement projects, interventions, PDSA cycles and comparison settings.
 * Same localStorage document (dentalaudit.v1): state.qiProjects, state.interventions, state.pdsa,
 * state.compareExclusions.
 *
 * Project      { id, auditId, title, description, aim, projectLead, collaborators[], status, priority,
 *                baselineCycleId, baseline{frozen results}, imported{…}, targetCriteria[], criteriaPriority{},
 *                clinicalImportance{}, suggestionDecisions{}, startDate, targetCompletionDate, reviewDate,
 *                interventionIds[], pdsaCycleIds[], milestones[], createdAt, updatedAt }
 * Intervention { id, projectId, criterionId, title, description, identifiedProblem, proposedSolution, expectedOutcome,
 *                responsiblePerson, supportingTeam[], status, successMeasure, startDate, targetDate, reviewDate,
 *                startedAt, completedAt, progressNotes[], statusHistory[], effectiveness{}, source{}, createdAt, updatedAt }
 * PDSA         { id, projectId, interventionId, cycleNumber, plan{}, do{}, study{}, act{}, status, createdAt, updatedAt }
 */
(function () {
  const store = DA.store, U = DA.utils;
  const I = store._internal;
  const st = function () { return I.state(); };
  const now = function () { return new Date().toISOString(); };
  const user = function () { return store.getSettings().userName || ''; };
  const clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  const list = function (v) { return Array.isArray(v) ? v.map(function (x) { return String(x).trim(); }).filter(Boolean) : String(v || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); };

  /* ---------- Projects ---------- */
  function getQiProjects() { return st().qiProjects; }
  function getQiProject(id) { return st().qiProjects.find(function (p) { return p.id === id; }) || null; }
  function projectsForAudit(auditId) { return st().qiProjects.filter(function (p) { return p.auditId === auditId; }); }

  /** Information imported from the audit when a project is linked to one. */
  function importFromAudit(audit, baseline) {
    if (!audit) return null;
    const reports = store.reportsForAudit(audit.id);
    const latest = reports[0] || null;
    return {
      auditTitle: audit.title, specialty: audit.specialty, department: audit.department, auditLead: audit.auditLead,
      criteria: audit.criteria.map(function (c) { return { id: c.id, name: c.name, target: c.target, reference: c.reference || '' }; }),
      baselineCompliance: baseline ? baseline.overall.compliance : null,
      targetCompliance: DA.metrics.target(audit),
      sampleSize: { target: Number(audit.targetSampleSize) || 0, completed: baseline ? baseline.completed : 0 },
      keyFindings: baseline ? baseline.rows.filter(function (r) { return r.achieved === false; }).map(function (r) {
        return '“' + r.name + '” ' + DA.qi.fmtPct(r.compliance) + ' (' + r.met + '/' + r.denominator + ') against a ' + r.target + '% target';
      }) : [],
      recommendations: latest ? latest.actionPlan.filter(function (a) { return a.approved; }).map(function (a) {
        return { reportId: latest.id, actionId: a.id, issue: a.issue, intervention: a.intervention, criterionId: a.criterionId, successMeasure: a.successMeasure, responsible: a.responsible, targetDate: a.targetDate };
      }) : [],
      reportTitle: latest ? latest.title : null,
      importedAt: now()
    };
  }

  function createQiProject(data) {
    const audit = data.auditId ? store.getAudit(data.auditId) : null;
    const baseline = audit && data.baselineRefKey ? DA.qi.baselineFrom(data.baselineRefKey) : null;
    const t = now();
    const p = {
      id: DA.model.newId('qip'), auditId: audit ? audit.id : null,
      title: String(data.title || '').trim(), description: String(data.description || '').trim(), aim: String(data.aim || '').trim(),
      projectLead: String(data.projectLead || '').trim(), collaborators: list(data.collaborators),
      status: 'active', priority: data.priority || 'medium',
      baselineCycleId: baseline ? baseline.cycleId : null, baseline: baseline,
      imported: importFromAudit(audit, baseline),
      targetCriteria: baseline ? baseline.rows.filter(function (r) { return r.achieved === false; }).map(function (r) { return r.criterionId; }) : [],
      criteriaPriority: {}, clinicalImportance: {}, suggestionDecisions: {},
      startDate: data.startDate || U.isoDay(new Date()), targetCompletionDate: data.targetCompletionDate || '', reviewDate: data.reviewDate || '',
      interventionIds: [], pdsaCycleIds: [], milestones: [],
      createdAt: t, updatedAt: t
    };
    st().qiProjects.unshift(p);
    I.log('qi', p.auditId, 'Created improvement project “' + p.title + '”');
    I.commit('qi:create');
    // Optional: convert selected report actions into interventions straight away.
    (data.importActions || []).forEach(function (x) { convertAction(x.reportId, x.actionId, p.id, {}, true); });
    if ((data.importActions || []).length) I.commit('qi:import-actions');
    return p;
  }

  function updateQiProject(id, patch, activity) {
    const p = getQiProject(id);
    if (!p) return null;
    Object.assign(p, patch);
    if (patch.collaborators !== undefined) p.collaborators = list(patch.collaborators);
    p.updatedAt = now();
    if (activity) I.log('qi', p.auditId, activity);
    I.commit('qi:update');
    return p;
  }

  /** Re-import baseline figures (e.g. after more baseline cases were added). The old copy is kept in history. */
  function refreshBaseline(id, refKey) {
    const p = getQiProject(id);
    if (!p) return null;
    p.baselineHistory = p.baselineHistory || [];
    if (p.baseline) p.baselineHistory.push(p.baseline);
    p.baseline = DA.qi.baselineFrom(refKey || (p.baseline && p.baseline.refKey));
    p.baselineCycleId = p.baseline ? p.baseline.cycleId : null;
    if (p.baseline && p.auditId) p.imported = Object.assign(importFromAudit(store.getAudit(p.auditId), p.baseline), { recommendations: (p.imported || {}).recommendations || [] });
    p.updatedAt = now();
    I.log('qi', p.auditId, 'Re-imported baseline results for “' + p.title + '” (' + (p.baseline ? p.baseline.cycleLabel : '—') + ')');
    I.commit('qi:baseline');
    return p;
  }

  function deleteQiProject(id) {
    const p = getQiProject(id);
    if (!p) return false;
    const s = st();
    s.qiProjects = s.qiProjects.filter(function (x) { return x.id !== id; });
    s.interventions = s.interventions.filter(function (x) { return x.projectId !== id; });
    s.pdsa = s.pdsa.filter(function (x) { return x.projectId !== id; });
    I.log('deleted', p.auditId, 'Deleted improvement project “' + p.title + '”');
    I.commit('qi:delete');
    return true;
  }

  function touchProject(projectId) { const p = getQiProject(projectId); if (p) p.updatedAt = now(); return p; }

  /* ---------- Interventions ---------- */
  function getInterventions() { return st().interventions; }
  function getIntervention(id) { return st().interventions.find(function (x) { return x.id === id; }) || null; }

  const IV_FIELDS = ['criterionId', 'title', 'description', 'identifiedProblem', 'proposedSolution', 'expectedOutcome', 'responsiblePerson', 'successMeasure', 'startDate', 'targetDate', 'reviewDate', 'status'];

  /** Create or update an intervention. Status changes are time-stamped; completion dates are recorded. */
  function saveIntervention(data, opts) {
    const o = opts || {};
    const t = now();
    let iv = data.id ? getIntervention(data.id) : null;
    const isNew = !iv;
    const prevStatus = iv ? iv.status : null;
    if (!iv) {
      iv = {
        id: DA.model.newId('int'), projectId: data.projectId, criterionId: '', title: '', description: '', identifiedProblem: '', proposedSolution: '',
        expectedOutcome: '', responsiblePerson: '', supportingTeam: [], status: 'planned', successMeasure: '', startDate: '', targetDate: '', reviewDate: '',
        startedAt: '', completedAt: '', progressNotes: [], statusHistory: [], effectiveness: null, source: data.source || { type: 'manual' }, createdAt: t, updatedAt: t
      };
      st().interventions.push(iv);
      const p = getQiProject(iv.projectId);
      if (p && p.interventionIds.indexOf(iv.id) === -1) p.interventionIds.push(iv.id);
    }
    IV_FIELDS.forEach(function (k) { if (data[k] !== undefined) iv[k] = typeof data[k] === 'string' ? data[k].trim() : data[k]; });
    if (data.supportingTeam !== undefined) iv.supportingTeam = list(data.supportingTeam);
    if (data.completedAt !== undefined) iv.completedAt = data.completedAt;
    if (data.effectiveness !== undefined) iv.effectiveness = data.effectiveness;
    if (iv.status !== prevStatus) {
      iv.statusHistory.push({ at: t, by: user(), from: prevStatus, to: iv.status });
      if (iv.status === 'in_progress' && !iv.startedAt) iv.startedAt = iv.startDate && iv.startDate <= U.isoDay(new Date()) ? iv.startDate : U.isoDay(new Date());
      if (iv.status === 'completed' && !iv.completedAt) iv.completedAt = U.isoDay(new Date());
      if (iv.status !== 'completed' && prevStatus === 'completed' && data.completedAt === undefined) {
        iv.progressNotes.push({ id: U.uid('note'), at: t, by: user(), text: 'Re-opened (previously completed on ' + U.fmtDate(iv.completedAt) + ').', system: true });
        iv.completedAt = '';
      }
    }
    iv.updatedAt = t;
    touchProject(iv.projectId);
    syncLinkedAction(iv);
    if (!o.silent) {
      I.log('qi', (getQiProject(iv.projectId) || {}).auditId, (isNew ? 'Added intervention “' : (iv.status !== prevStatus ? 'Moved intervention “' : 'Updated intervention “')) + iv.title + '”' + (iv.status !== prevStatus && !isNew ? ' to ' + DA.qi.IV_STATUS[iv.status].label : ''));
      I.commit('qi:intervention');
    }
    return iv;
  }

  function deleteIntervention(id) {
    const iv = getIntervention(id);
    if (!iv) return false;
    const s = st();
    s.interventions = s.interventions.filter(function (x) { return x.id !== id; });
    const p = getQiProject(iv.projectId);
    if (p) { p.interventionIds = p.interventionIds.filter(function (x) { return x !== id; }); p.updatedAt = now(); }
    s.pdsa.forEach(function (x) { if (x.interventionId === id) x.interventionId = null; });
    I.log('deleted', p && p.auditId, 'Deleted intervention “' + iv.title + '”');
    I.commit('qi:intervention-delete');
    return true;
  }

  function addProgressNote(id, text) {
    const iv = getIntervention(id);
    if (!iv || !String(text || '').trim()) return null;
    iv.progressNotes.push({ id: U.uid('note'), at: now(), by: user(), text: String(text).trim() });
    iv.updatedAt = now();
    touchProject(iv.projectId);
    I.commit('qi:note');
    return iv;
  }

  function deleteProgressNote(id, noteId) {
    const iv = getIntervention(id);
    if (!iv) return null;
    iv.progressNotes = iv.progressNotes.filter(function (n) { return n.id !== noteId; });
    iv.updatedAt = now();
    I.commit('qi:note');
    return iv;
  }

  /* ---------- Report action plan ↔ interventions ---------- */
  const TO_ACTION = { planned: 'Not Started', not_started: 'Not Started', in_progress: 'In Progress', completed: 'Completed', on_hold: 'In Progress', cancelled: null };

  function linkedIntervention(reportId, actionId) {
    return st().interventions.find(function (x) { return x.source && x.source.reportId === reportId && x.source.actionId === actionId; }) || null;
  }

  /**
   * Keep the report action plan item in step with its intervention.
   * Approved or archived reports are never changed silently: the intervention records that the
   * report still shows the older status, and the report editor says so.
   */
  function syncLinkedAction(iv) {
    if (!iv.source || iv.source.type !== 'report_action') return;
    const r = store.getReport(iv.source.reportId);
    const a = r && r.actionPlan.find(function (x) { return x.id === iv.source.actionId; });
    if (!a) { iv.source.syncState = 'missing'; return; }
    const want = TO_ACTION[iv.status];
    if (!want) { iv.source.syncState = 'not_synced'; return; }
    if (store.isLocked(r) || r.status === 'in_review') {
      iv.source.syncState = a.status === want ? 'in_sync' : 'report_locked';
      return;
    }
    if (a.status !== want) {
      a.status = want;
      if (want === 'Completed') a.completedAt = iv.completedAt;
      a.interventionId = iv.id;
      r.updatedAt = now();
    }
    iv.source.syncState = 'in_sync';
  }

  /** Convert an approved report action into an intervention. Each action converts once. */
  function convertAction(reportId, actionId, projectId, overrides, quiet) {
    const r = store.getReport(reportId);
    const a = r && r.actionPlan.find(function (x) { return x.id === actionId; });
    if (!a) throw new Error('Action not found.');
    const existing = linkedIntervention(reportId, actionId);
    if (existing) return existing;
    const o = overrides || {};
    const iv = saveIntervention({
      projectId: projectId,
      criterionId: a.criterionId || '',
      title: o.title || (a.intervention || a.issue).slice(0, 90),
      identifiedProblem: a.issue,
      proposedSolution: a.intervention,
      description: o.description || '',
      expectedOutcome: o.expectedOutcome || '',
      successMeasure: o.successMeasure !== undefined ? o.successMeasure : a.successMeasure,
      responsiblePerson: o.responsiblePerson !== undefined ? o.responsiblePerson : a.responsible,
      targetDate: o.targetDate !== undefined ? o.targetDate : a.targetDate,
      reviewDate: o.reviewDate !== undefined ? o.reviewDate : a.reviewDate,
      startDate: o.startDate || '',
      status: a.status === 'Completed' ? 'completed' : a.status === 'In Progress' ? 'in_progress' : 'planned',
      source: { type: 'report_action', reportId: reportId, actionId: actionId, reportTitle: r.title, revision: r.revision }
    }, { silent: true });
    I.log('qi', r.auditId, 'Converted action “' + (a.intervention || a.issue) + '” into an intervention');
    if (!quiet) I.commit('qi:convert');
    return iv;
  }

  /** Called after a report is saved so a stale editor draft cannot undo a completed intervention. */
  function reapplyLinks(reportId) {
    st().interventions.forEach(function (iv) { if (iv.source && iv.source.reportId === reportId) syncLinkedAction(iv); });
  }

  /* ---------- PDSA ---------- */
  function getPdsa() { return st().pdsa; }
  function getPdsaCycle(id) { return st().pdsa.find(function (x) { return x.id === id; }) || null; }

  function createPdsa(projectId, data) {
    const p = getQiProject(projectId);
    if (!p) return null;
    const existing = st().pdsa.filter(function (x) { return x.projectId === projectId; });
    const n = existing.reduce(function (m, x) { return Math.max(m, x.cycleNumber); }, 0) + 1;
    const t = now();
    const prev = existing.sort(function (a, b) { return b.cycleNumber - a.cycleNumber; })[0];
    const d = data || {};
    const pd = {
      id: DA.model.newId('pdsa'), projectId: projectId, interventionId: d.interventionId || (prev ? prev.interventionId : null) || null, cycleNumber: n,
      previousPdsaId: prev ? prev.id : null,
      plan: { change: d.change || '', aim: d.aim || '', prediction: '', who: '', where: '', data: '', measure: '', startDate: d.startDate || U.isoDay(new Date()), endDate: d.endDate || '' },
      do: { implemented: '', when: '', participants: '', deviations: '', problems: '', notes: '' },
      study: { results: '', expected: '', data: '', unexpected: '', learned: '', workedWell: '', notWell: '', linkedAnalytics: null },
      act: { decision: '', rationale: '', changes: '', nextSteps: '', responsible: '', reviewDate: '', completedAt: '' },
      status: 'planning', createdAt: t, updatedAt: t
    };
    st().pdsa.push(pd);
    p.pdsaCycleIds.push(pd.id);
    p.updatedAt = t;
    I.log('qi', p.auditId, 'Started PDSA cycle ' + n + ' in “' + p.title + '”');
    I.commit('qi:pdsa');
    return pd;
  }

  const STAGE_STATUS = { plan: 'planning', do: 'doing', study: 'studying', act: 'acting' };

  /** Save one stage. complete=true moves the cycle on to the next stage (Act completes the cycle). */
  function savePdsaStage(id, stage, values, complete) {
    const pd = getPdsaCycle(id);
    if (!pd) return null;
    pd[stage] = Object.assign({}, pd[stage], values);
    const order = DA.qi.PDSA_STAGES;
    if (complete) {
      pd[stage].completedAt = pd[stage].completedAt || U.isoDay(new Date());
      if (stage === 'act') pd.status = 'completed';
      else {
        const next = order[order.indexOf(stage) + 1];
        if (order.indexOf(STAGE_REV[pd.status] || 'plan') <= order.indexOf(stage)) pd.status = STAGE_STATUS[next];
      }
    }
    pd.updatedAt = now();
    const p = touchProject(pd.projectId);
    if (complete) I.log('qi', p && p.auditId, 'Completed the ' + stage.charAt(0).toUpperCase() + stage.slice(1) + ' stage of PDSA cycle ' + pd.cycleNumber);
    I.commit('qi:pdsa');
    return pd;
  }
  const STAGE_REV = { planning: 'plan', doing: 'do', studying: 'study', acting: 'act', completed: 'act' };

  function reopenPdsa(id) {
    const pd = getPdsaCycle(id);
    if (!pd) return null;
    pd.status = 'acting';
    pd.act.completedAt = '';
    pd.updatedAt = now();
    I.commit('qi:pdsa');
    return pd;
  }

  function updatePdsa(id, patch) {
    const pd = getPdsaCycle(id);
    if (!pd) return null;
    Object.assign(pd, patch);
    pd.updatedAt = now();
    I.commit('qi:pdsa');
    return pd;
  }

  function deletePdsa(id) {
    const pd = getPdsaCycle(id);
    if (!pd) return false;
    const s = st();
    s.pdsa = s.pdsa.filter(function (x) { return x.id !== id; });
    s.pdsa.forEach(function (x) { if (x.previousPdsaId === id) x.previousPdsaId = pd.previousPdsaId; });
    const p = getQiProject(pd.projectId);
    if (p) { p.pdsaCycleIds = p.pdsaCycleIds.filter(function (x) { return x !== id; }); p.updatedAt = now(); }
    I.log('deleted', p && p.auditId, 'Deleted PDSA cycle ' + pd.cycleNumber + (p ? ' from “' + p.title + '”' : ''));
    I.commit('qi:pdsa-delete');
    return true;
  }

  /* ---------- Milestones ---------- */
  function saveMilestone(projectId, m) {
    const p = getQiProject(projectId);
    if (!p) return null;
    p.milestones = p.milestones || [];
    let x = m.id ? p.milestones.find(function (y) { return y.id === m.id; }) : null;
    if (!x) { x = { id: U.uid('ms'), createdAt: now() }; p.milestones.push(x); }
    Object.assign(x, { title: String(m.title || '').trim(), date: m.date, note: String(m.note || '').trim(), done: !!m.done });
    p.updatedAt = now();
    I.commit('qi:milestone');
    return x;
  }
  function deleteMilestone(projectId, id) {
    const p = getQiProject(projectId);
    if (!p) return;
    p.milestones = (p.milestones || []).filter(function (x) { return x.id !== id; });
    p.updatedAt = now();
    I.commit('qi:milestone');
  }

  /* ---------- Cycle comparison exclusions ---------- */
  function getCompareExclusions(pairKey) { return (st().compareExclusions || {})[pairKey] || []; }
  function setCompareExclusion(pairKey, key, excluded) {
    const s = st();
    s.compareExclusions = s.compareExclusions || {};
    const cur = s.compareExclusions[pairKey] || [];
    s.compareExclusions[pairKey] = excluded ? cur.concat(cur.indexOf(key) === -1 ? [key] : []) : cur.filter(function (x) { return x !== key; });
    I.commit('compare:exclude');
  }

  /* ---------- Synthetic test data ---------- */
  function addSyntheticAudit() {
    const existing = store.getAudit('aud_torque_test');
    if (existing) return existing;
    const a = DA.seed.torqueAudit();
    st().audits.unshift(a);
    I.log('created', a.id, 'Added synthetic test audit “' + a.title + '”');
    I.commit('audit:synthetic');
    return a;
  }

  Object.assign(store, {
    getQiProjects, getQiProject, projectsForAudit, createQiProject, updateQiProject, refreshBaseline, deleteQiProject,
    getInterventions, getIntervention, saveIntervention, deleteIntervention, addProgressNote, deleteProgressNote,
    linkedIntervention, convertAction, reapplyLinks, actionStatusFor: function (iv) { return TO_ACTION[iv.status] || null; },
    getPdsa, getPdsaCycle, createPdsa, savePdsaStage, reopenPdsa, updatePdsa, deletePdsa,
    saveMilestone, deleteMilestone, getCompareExclusions, setCompareExclusion, addSyntheticAudit
  });

  // Report saves re-apply intervention links so a stale editor draft never reverts a synchronised status.
  const saveReport = store.saveReport;
  store.saveReport = function (id, patch, activity) {
    const r = saveReport(id, patch, activity);
    if (r) { reapplyLinks(id); I.commit('report:sync'); }
    return r;
  };
})();
