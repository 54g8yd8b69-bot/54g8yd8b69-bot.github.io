/* DentalAudit — persistence layer (localStorage)
 * Single source of truth for audits, activity log and settings.
 * Views read through DA.store and re-render on 'change' events.
 */
DA.store = (function () {
  const KEY = 'dentalaudit.v1';
  const U = DA.utils;
  const listeners = [];
  let state = null;
  let storageOk = true;

  const DEFAULT_SETTINGS = {
    userName: 'Callum Edward',
    userRole: 'Dental Core Trainee (CT3)',
    organisation: 'Glasgow Dental Hospital',
    department: 'Restorative Dentistry',
    defaultTarget: 90,
    amberMargin: 10,
    reauditMonths: 12,
    deadlineWindow: 45,
    // AI assistant: only a backend URL is ever stored here — never an API key.
    // Local development default; the assistant stays OFF until the user switches it on.
    ai: { enabled: false, endpoint: 'http://localhost:8787/api/dentalaudit-ai', provider: 'anthropic', model: '', includeNarrative: true, timeoutMs: 60000, lastCheck: null }
  };

  function emptyState() {
    return {
      version: DA.model.SCHEMA_VERSION,
      audits: [],
      reports: [],
      // Quality improvement module (see js/core/qi-store.js)
      qiProjects: [],
      interventions: [],
      pdsa: [],
      compareExclusions: {},
      activity: [],
      settings: Object.assign({}, DEFAULT_SETTINGS),
      notificationsSeen: [],
      seeded: false
    };
  }

  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch (e) {
      storageOk = false;
    }
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        state = Object.assign(emptyState(), parsed);
        state.settings = Object.assign({}, DEFAULT_SETTINGS, parsed.settings || {});
        state.settings.ai = Object.assign({}, DEFAULT_SETTINGS.ai, (parsed.settings || {}).ai || {});
        state.reports = Array.isArray(parsed.reports) ? parsed.reports : [];
        ensureQi();
        migrate(parsed.version || 1);
        return;
      } catch (e) {
        console.warn('DentalAudit: stored data was unreadable, starting fresh.', e);
      }
    }
    state = DA.seed.build(emptyState());
    persist();
  }

  function ensureQi() {
    ['qiProjects', 'interventions', 'pdsa'].forEach(function (k) { if (!Array.isArray(state[k])) state[k] = []; });
    if (!state.compareExclusions || typeof state.compareExclusions !== 'object') state.compareExclusions = {};
  }

  /** Upgrade stored data in place (same storage key) and fill any new defaults. */
  function migrate(fromVersion) {
    state.audits = (state.audits || []).map(DA.model.normaliseAudit);
    if (fromVersion < DA.model.SCHEMA_VERSION) {
      state.version = DA.model.SCHEMA_VERSION;
      persist();
      console.info('DentalAudit: migrated stored data from v' + fromVersion + ' to v' + state.version + '.');
    }
  }

  function persist() {
    if (!storageOk) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      storageOk = false;
      console.warn('DentalAudit: could not save to localStorage.', e);
    }
  }

  function emit(reason) {
    listeners.forEach(function (fn) {
      try { fn(reason); } catch (e) { console.error(e); }
    });
  }

  function commit(reason) {
    // Top-level author / reviewer mirror review.author / review.reviewer (spec data model).
    (state.reports || []).forEach(function (r) {
      if (!r.review) return;
      r.author = r.review.author || '';
      r.reviewer = r.review.reviewer || '';
    });
    persist();
    emit(reason);
  }

  function logActivity(type, auditId, text) {
    state.activity.unshift({ id: U.uid('act'), ts: new Date().toISOString(), type: type, auditId: auditId || null, text: text });
    state.activity = state.activity.slice(0, 200);
  }

  function touch(audit) {
    audit.updatedAt = new Date().toISOString();
  }

  /* ---------- Reads ---------- */
  function getAudits() { return state.audits.slice(); }
  function getAudit(id) { return state.audits.find(function (a) { return a.id === id; }) || null; }
  function getActivity() { return state.activity.slice(); }
  function getSettings() { return Object.assign({}, state.settings, { ai: Object.assign({}, DEFAULT_SETTINGS.ai, state.settings.ai || {}) }); }
  function isPersistent() { return storageOk; }

  /* ---------- Audit writes ---------- */
  /** Low-level insert of a fully formed v2 audit. IDs are collision-checked. */
  function insert(audit) {
    if (!audit.id || getAudit(audit.id)) audit.id = DA.model.newId('aud');
    state.audits.unshift(audit);
    return audit;
  }

  /** Fields owned by the Create/Edit Audit wizard (the audit's protocol). */
  const DEFINITION_FIELDS = ['title', 'description', 'projectType', 'specialty', 'department', 'auditLead', 'collaborators',
    'startDate', 'targetCompletionDate', 'background', 'auditQuestion', 'aim', 'objectives', 'criteria', 'methodology',
    'inclusionCriteria', 'exclusionCriteria', 'targetSampleSize', 'samplingMethod', 'samplingOther',
    'collectionStartDate', 'collectionEndDate', 'collectionMethods', 'collectionOther', 'reauditMonths'];

  function pickDefinition(data) {
    const out = {};
    DEFINITION_FIELDS.forEach(function (k) { if (data[k] !== undefined) out[k] = JSON.parse(JSON.stringify(data[k])); });
    return out;
  }

  /** Strip empty list rows (blank objectives etc.) before saving. */
  function tidy(def) {
    ['objectives', 'inclusionCriteria', 'exclusionCriteria'].forEach(function (k) {
      if (def[k]) def[k] = def[k].filter(function (x) { return String(x.text || '').trim(); });
    });
    if (def.collaborators) def.collaborators = def.collaborators.filter(function (x) { return String(x.name || '').trim(); });
    if (def.collectionMethods && def.collectionMethods.indexOf('Other') === -1) def.collectionOther = '';
    if (def.samplingMethod !== 'Other') def.samplingOther = '';
    return def;
  }

  /**
   * Save wizard work as a draft. Creates the record on first save, updates it after.
   * Returns the saved audit (with its permanent id).
   */
  function saveDraft(data) {
    const existing = data.id ? getAudit(data.id) : null;
    if (existing && existing.status !== 'draft') return saveDefinition(existing.id, data);
    const now = new Date().toISOString();
    let audit;
    if (existing) {
      Object.assign(existing, pickDefinition(data));
      touch(existing);
      audit = existing;
    } else {
      audit = DA.model.normaliseAudit(Object.assign(pickDefinition(data), { id: data.id || null, status: 'draft', createdAt: now, updatedAt: now }));
      insert(audit);
    }
    logActivity('draft', audit.id, 'Saved draft “' + (audit.title || 'Untitled audit') + '”');
    commit('audit:draft');
    return audit;
  }

  /**
   * Turn a wizard draft into a live audit: status Active, Cycle 1.
   * Idempotent per id — a second call for an already-created audit never duplicates it.
   */
  function publish(data) {
    const existing = data.id ? getAudit(data.id) : null;
    if (existing && existing.status !== 'draft') return { audit: existing, duplicate: true };
    const now = new Date().toISOString();
    const def = tidy(pickDefinition(data));
    let audit;
    if (existing) {
      Object.assign(existing, def, { status: 'active', cycle: 1, cycles: [], createdAt: now });
      audit = existing;
    } else {
      audit = Object.assign(def, { id: data.id || null, status: 'active', cycle: 1, cycles: [], parentId: null, createdAt: now });
      insert(audit);
    }
    audit.cycles = [{ id: DA.model.newId('cyc'), number: 1, label: 'Cycle 1', status: 'active', startedAt: now, completedAt: null }];
    const normal = DA.model.normaliseAudit(audit);
    Object.keys(normal).forEach(function (k) { audit[k] = normal[k]; });
    audit.updatedAt = now;
    logActivity('created', audit.id, 'Created audit “' + audit.title + '” (Cycle 1)');
    commit('audit:create');
    return { audit: audit, duplicate: false };
  }

  const CRITERION_KEYS = ['name', 'description', 'reference', 'target', 'measurementMethod', 'numerator', 'denominator'];
  function snapshotCriteria(list) {
    return (list || []).map(function (c) {
      const o = { id: c.id, parentCriterionId: c.parentCriterionId || null };
      CRITERION_KEYS.forEach(function (k) { o[k] = c[k]; });
      return o;
    });
  }

  /**
   * Once any data has been collected, criterion edits are recorded (never silent):
   * who, when, which cycle, field, old and new value, and an optional reason.
   */
  function logCriteriaChanges(audit, before, after, reason) {
    const hasData = (audit.cycles || []).some(function (c) { return c.records && c.records.length; }) || (audit.cycles || []).length > 1;
    if (!hasData) return;
    const cyc = DA.collection.currentCycle(audit);
    const at = new Date().toISOString();
    const by = state.settings.userName || '';
    const push = function (criterionId, name, field, from, to) {
      audit.criteriaChanges = audit.criteriaChanges || [];
      audit.criteriaChanges.push({ id: U.uid('chg'), at: at, by: by, cycleId: cyc ? cyc.id : null, cycleLabel: cyc ? cyc.label : '', criterionId: criterionId, criterionName: name, field: field, from: from, to: to, reason: reason || '' });
    };
    after.forEach(function (c) {
      const old = before.find(function (b) { return b.id === c.id; });
      if (!old) { push(c.id, c.name, 'added', '', c.name); return; }
      CRITERION_KEYS.forEach(function (k) {
        if (String(old[k] == null ? '' : old[k]) !== String(c[k] == null ? '' : c[k])) push(c.id, c.name, k, old[k], c[k]);
      });
    });
    before.forEach(function (b) { if (!after.some(function (c) { return c.id === b.id; })) push(b.id, b.name, 'removed', b.name, ''); });
  }

  function setChangeReason(auditId, changeId, reason) {
    const a = getAudit(auditId);
    const c = a && (a.criteriaChanges || []).find(function (x) { return x.id === changeId; });
    if (!c) return null;
    c.reason = reason;
    touch(a);
    commit('audit:change-reason');
    return c;
  }

  /** Update the protocol of an existing (non-draft) audit from the wizard's edit mode. */
  function saveDefinition(id, data) {
    const audit = getAudit(id);
    if (!audit) return null;
    const def = tidy(pickDefinition(data));
    const before = JSON.parse(JSON.stringify(audit.criteria || []));
    Object.assign(audit, def);
    logCriteriaChanges(audit, before, audit.criteria, data.changeReason || '');
    // Fields linked to a criterion that was deleted are unlinked in a new form version.
    // Existing records and their stored results are left untouched.
    const ids = audit.criteria.map(function (c) { return c.id; });
    const cyc = DA.collection.currentCycle(audit);
    if (cyc && cyc.form && cyc.form.fields.some(function (f) { return f.linkedCriterionId && ids.indexOf(f.linkedCriterionId) === -1; })) {
      const fields = JSON.parse(JSON.stringify(cyc.form.fields));
      fields.forEach(function (f) { if (f.linkedCriterionId && ids.indexOf(f.linkedCriterionId) === -1) { f.linkedCriterionId = null; f.compliantValues = []; f.notApplicableValues = []; } });
      writeFormVersion(cyc, fields);
    }
    if (cyc && cyc.status !== 'completed') {
      cyc.collectionStartDate = audit.collectionStartDate;
      cyc.collectionEndDate = audit.collectionEndDate;
    }
    const normal = DA.model.normaliseAudit(audit);
    Object.keys(normal).forEach(function (k) { audit[k] = normal[k]; });
    touch(audit);
    logActivity('updated', id, 'Edited audit “' + audit.title + '”');
    commit('audit:update');
    return audit;
  }

  function updateAudit(id, patch, activityText) {
    const audit = getAudit(id);
    if (!audit) return null;
    Object.assign(audit, patch);
    touch(audit);
    if (activityText) logActivity('updated', id, activityText);
    commit('audit:update');
    return audit;
  }

  function setStatus(id, status) {
    const audit = getAudit(id);
    if (!audit || audit.status === status) return audit;
    const label = DA.metrics.statusMeta(status).label;
    const patch = { status: status };
    if (status === 'completed') {
      patch.completedAt = new Date().toISOString();
      if (!audit.reauditDate) {
        const d = new Date();
        d.setMonth(d.getMonth() + Number(audit.reauditMonths || state.settings.reauditMonths || 12));
        patch.reauditDate = U.isoDay(d);
      }
    }
    const out = updateAudit(id, patch, 'Moved “' + audit.title + '” to ' + label);
    if (out && out.cycles && out.cycles.length) {
      const cur = out.cycles[out.cycles.length - 1];
      cur.status = out.status;
      cur.completedAt = out.completedAt || null;
      persist();
    }
    return out;
  }

  function deleteAudit(id) {
    const audit = getAudit(id);
    if (!audit) return false;
    state.audits = state.audits.filter(function (a) { return a.id !== id; });
    state.reports = state.reports.filter(function (r) { return r.auditId !== id; });
    // Improvement projects survive (they hold a frozen baseline) but are unlinked from the deleted audit.
    (state.qiProjects || []).forEach(function (p) { if (p.auditId === id) { p.auditId = null; p.unlinkedAuditTitle = audit.title; } });
    // Keep the activity history readable but unlink it from the deleted audit.
    state.activity.forEach(function (a) { if (a.auditId === id) a.auditId = null; });
    logActivity('deleted', null, 'Deleted audit “' + audit.title + '”');
    commit('audit:delete');
    return true;
  }

  function critMap(oldCrit, newCrit) {
    const m = {};
    newCrit.forEach(function (c) { if (c.parentCriterionId) m[c.parentCriterionId] = c.id; });
    return m;
  }

  function startReaudit(id) {
    const src = getAudit(id);
    if (!src) return null;
    const now = new Date().toISOString();
    const def = pickDefinition(src);
    const taken = new Set();
    state.audits.forEach(function (a) { taken.add(a.id); (a.criteria || []).forEach(function (c) { taken.add(c.id); }); });
    // New IDs for the new cycle's criteria, linked back to the previous cycle for comparison.
    def.criteria = src.criteria.map(function (c) {
      return Object.assign({}, c, { id: DA.model.newId('crit', taken), parentCriterionId: c.id });
    });
    const cycle = (src.cycle || 1) + 1;
    def.startDate = U.isoDay(new Date());
    def.collectionStartDate = U.isoDay(new Date());
    def.collectionEndDate = U.isoDay(U.addDays(new Date(), 42));
    def.targetCompletionDate = U.isoDay(U.addDays(new Date(), 90));
    const audit = insert(DA.model.normaliseAudit(Object.assign(def, {
      id: DA.model.newId('aud', taken), status: 'active', cycle: cycle, parentId: src.id, createdAt: now, updatedAt: now,
      cycles: [{
        id: DA.model.newId('cyc', taken), number: cycle, label: 'Cycle ' + cycle, status: 'active', startedAt: now, completedAt: null,
        collectionStartDate: def.collectionStartDate, collectionEndDate: def.collectionEndDate,
        // The previous cycle's form is copied (links remapped to the new criteria); its records stay with the previous cycle.
        form: DA.collection.cloneFormForCycle((DA.collection.currentCycle(src) || {}).form, critMap(src.criteria, def.criteria)),
        formHistory: [], records: [], caseCounter: 0
      }]
    })));
    logActivity('reaudit', audit.id, 'Started cycle ' + audit.cycle + ' re-audit of “' + src.title + '”');
    commit('audit:reaudit');
    return audit;
  }

  /* ---------- Data collection: forms ---------- */
  /** Snapshot the current form into history and install the next version. */
  function writeFormVersion(cycle, fields) {
    const now = new Date().toISOString();
    const prev = cycle.form;
    if (prev && prev.version > 0) cycle.formHistory.push(JSON.parse(JSON.stringify(prev)));
    cycle.form = {
      id: prev ? prev.id : DA.model.newId('form'),
      version: prev ? prev.version + 1 : 1,
      fields: JSON.parse(JSON.stringify(fields)),
      createdAt: prev ? prev.createdAt : now,
      updatedAt: now
    };
    return cycle.form;
  }

  /**
   * Save the form for the audit's current cycle. Every save that changes the definition
   * creates a new version; earlier versions are kept so existing records still resolve.
   */
  function saveForm(auditId, fields) {
    const audit = getAudit(auditId);
    const cycle = DA.collection.currentCycle(audit);
    if (!audit || !cycle) return null;
    const normal = fields.map(DA.collection.normaliseField);
    if (cycle.form && JSON.stringify(cycle.form.fields) === JSON.stringify(normal)) return { form: cycle.form, changed: false };
    const form = writeFormVersion(cycle, normal);
    DA.collection.describeCycle(audit, cycle);
    cycle.updatedAt = form.updatedAt;
    touch(audit);
    logActivity('form', auditId, 'Saved data collection form v' + form.version + ' for “' + audit.title + '” (' + form.fields.length + ' fields)');
    commit('form:save');
    return { form: form, changed: true };
  }

  /* ---------- Data collection: case records ---------- */
  /**
   * Create or update a case record in the current cycle.
   * data: { id?, collectionDate, responses, status: 'draft' | 'completed' }
   */
  function saveRecord(auditId, data) {
    const audit = getAudit(auditId);
    const cycle = DA.collection.currentCycle(audit);
    if (!audit || !cycle || !cycle.form) return null;
    const now = new Date().toISOString();
    const form = cycle.form;
    let rec = data.id ? cycle.records.find(function (r) { return r.id === data.id; }) : null;
    const wasCompleted = rec && rec.status === 'completed';
    if (rec) {
      // Keep answers to fields removed in later versions; overwrite the rest.
      rec.responses = Object.assign({}, rec.responses, data.responses);
      rec.collectionDate = data.collectionDate;
      rec.status = data.status;
      rec.updatedAt = now;
    } else {
      const next = DA.collection.nextCaseReference(cycle);
      cycle.caseCounter = next.number;
      rec = {
        id: DA.model.newId('rec'), caseReference: next.ref, auditId: audit.id, cycleId: cycle.id,
        collectionDate: data.collectionDate, responses: Object.assign({}, data.responses), status: data.status,
        createdAt: now, updatedAt: now
      };
      cycle.records.push(rec);
    }
    rec.formId = form.id;
    rec.formVersion = form.version;
    rec.scoredWithVersion = form.version;
    rec.results = rec.status === 'completed' ? DA.collection.scoreRecord(form, rec.responses) : {};
    if (rec.status === 'completed' && audit.status === 'active') {
      audit.status = 'collecting';
      cycle.status = 'collecting';
    }
    touch(audit);
    const done = cycle.records.filter(function (r) { return r.status === 'completed'; }).length;
    logActivity('case', auditId, (data.id ? 'Updated ' : 'Added ') + rec.caseReference + (rec.status === 'draft' ? ' (draft)' : '') +
      ' in “' + audit.title + '” (' + done + '/' + audit.targetSampleSize + ')' + (wasCompleted && rec.status === 'draft' ? ' — returned to draft' : ''));
    commit('record:save');
    return rec;
  }

  function deleteRecord(auditId, recordId) {
    const audit = getAudit(auditId);
    const cycle = DA.collection.currentCycle(audit);
    if (!audit || !cycle) return false;
    const rec = cycle.records.find(function (r) { return r.id === recordId; });
    if (!rec) return false;
    cycle.records = cycle.records.filter(function (r) { return r.id !== recordId; });
    touch(audit);
    logActivity('case', auditId, 'Deleted ' + rec.caseReference + ' from “' + audit.title + '”');
    commit('record:delete');
    return true;
  }

  /** Recalculate criterion results for completed records using the current form's rules. */
  function rescoreRecords(auditId) {
    const audit = getAudit(auditId);
    const cycle = DA.collection.currentCycle(audit);
    if (!audit || !cycle || !cycle.form) return 0;
    let n = 0;
    cycle.records.forEach(function (r) {
      if (r.status !== 'completed') return;
      r.results = DA.collection.scoreRecord(cycle.form, r.responses);
      r.scoredWithVersion = cycle.form.version;
      n++;
    });
    touch(audit);
    logActivity('form', auditId, 'Re-scored ' + n + ' cases in “' + audit.title + '” with form v' + cycle.form.version);
    commit('record:rescore');
    return n;
  }

  /**
   * Groundwork for in-audit re-audits: close the current cycle and open the next one
   * with a copy of its form. Earlier cycles keep their form history and records.
   */
  /**
   * Open the next audit cycle inside the same audit (Cycle 1 baseline → Cycle 2 re-audit …).
   * opts: { formMode: 'duplicate' | 'new', startDate, endDate, note }
   * Previous cycles keep their records, forms and a frozen copy of the criteria.
   */
  function createCycle(auditId, opts) {
    const o = opts || {};
    const audit = getAudit(auditId);
    const prev = DA.collection.currentCycle(audit);
    if (!audit || !prev) return null;
    const now = new Date().toISOString();
    prev.status = 'completed';
    prev.completedAt = prev.completedAt || now;
    prev.updatedAt = now;
    if (!prev.criteriaSnapshot) prev.criteriaSnapshot = snapshotCriteria(audit.criteria);
    const identity = {};
    audit.criteria.forEach(function (c) { identity[c.id] = c.id; });
    const number = prev.number + 1;
    const mode = o.formMode === 'new' ? 'new' : 'duplicate';
    const start = o.startDate || U.isoDay(new Date());
    const cyc = {
      id: DA.model.newId('cyc'), number: number, label: 'Cycle ' + number, status: 'active', startedAt: now, completedAt: null,
      collectionStartDate: start, collectionEndDate: o.endDate || '',
      // Criterion IDs are unchanged within an audit, so copied field → criterion links stay valid.
      form: mode === 'duplicate' ? DA.collection.cloneFormForCycle(prev.form, identity) : null,
      formHistory: [], records: [], caseCounter: 0,
      criteriaSnapshot: snapshotCriteria(audit.criteria),
      createdFrom: { cycleId: prev.id, formMode: mode, formId: prev.form ? prev.form.id : null, formVersion: prev.form ? prev.form.version : null },
      note: o.note || '', createdAt: now, updatedAt: now
    };
    audit.cycles.push(cyc);
    DA.collection.describeCycle(audit, cyc);
    audit.cycle = number;
    audit.status = 'active';
    audit.completedAt = null;
    audit.collectionStartDate = start;
    audit.collectionEndDate = o.endDate || audit.collectionEndDate;
    touch(audit);
    logActivity('reaudit', auditId, 'Opened cycle ' + number + ' of “' + audit.title + '” (' + (mode === 'duplicate' ? 'form copied from ' + prev.label : 'new form') + ')');
    commit('cycle:create');
    return cyc;
  }

  /* ---------- Action plan ---------- */
  function addAction(auditId, text, owner, due) {
    const audit = getAudit(auditId);
    if (!audit) return;
    audit.actions = audit.actions || [];
    audit.actions.push({ id: U.uid('act'), text: text, owner: owner || '', due: due || '', done: false });
    touch(audit);
    logActivity('action', auditId, 'Added action to “' + audit.title + '”: ' + text);
    commit('action:add');
  }

  function toggleAction(auditId, actionId) {
    const audit = getAudit(auditId);
    if (!audit) return;
    const a = (audit.actions || []).find(function (x) { return x.id === actionId; });
    if (!a) return;
    a.done = !a.done;
    touch(audit);
    if (a.done) logActivity('action', auditId, 'Completed action on “' + audit.title + '”: ' + a.text);
    commit('action:toggle');
  }

  function deleteAction(auditId, actionId) {
    const audit = getAudit(auditId);
    if (!audit) return;
    audit.actions = (audit.actions || []).filter(function (x) { return x.id !== actionId; });
    touch(audit);
    commit('action:delete');
  }

  /* ---------- Reports ---------- */
  const MAX_REVISIONS = 20;
  function getReports() { return state.reports.slice(); }
  function getReport(id) { return state.reports.find(function (r) { return r.id === id; }) || null; }
  function reportsForAudit(auditId) { return state.reports.filter(function (r) { return r.auditId === auditId; }); }
  function isLocked(r) { return r.status === 'approved' || r.status === 'archived'; }

  function contentCopy(r) {
    return JSON.parse(JSON.stringify({
      title: r.title, meta: r.meta, sectionOrder: r.sectionOrder, sections: r.sections, actionPlan: r.actionPlan,
      references: r.references, analyticsSnapshot: r.analyticsSnapshot, snapshotAt: r.snapshotAt, datasetFingerprint: r.datasetFingerprint
    }));
  }

  /** Record the report as it stands now in its revision history. */
  function recordRevision(r, note) {
    r.revisions = r.revisions || [];
    r.revisions.push({
      revision: r.revision, status: r.status, savedAt: new Date().toISOString(), by: state.settings.userName,
      note: note, snapshotAt: r.snapshotAt, content: contentCopy(r)
    });
    // Keep every approved revision; trim the oldest unapproved copies beyond the limit.
    while (r.revisions.length > MAX_REVISIONS) {
      const i = r.revisions.findIndex(function (x) { return x.status !== 'approved'; });
      if (i < 0) break;
      r.revisions.splice(i, 1);
    }
  }

  function createReport(report) {
    report.id = getReport(report.id) ? DA.model.newId('rpt') : report.id;
    recordRevision(report, 'Report generated from the audit database');
    state.reports.unshift(report);
    logActivity('report', report.auditId, 'Generated report “' + report.title + '”');
    commit('report:create');
    return report;
  }

  /**
   * Save edits. Approved or archived reports are never silently overwritten:
   * the call is refused unless the caller has first opened a new revision.
   */
  function saveReport(id, patch, activity) {
    const r = getReport(id);
    if (!r) return null;
    if (isLocked(r)) throw new Error('This report is ' + r.status + ' and cannot be edited. Start a new revision first.');
    Object.assign(r, patch);
    r.updatedAt = new Date().toISOString();
    if (activity) logActivity('report', r.auditId, activity);
    commit('report:save');
    return r;
  }

  /** Approved/archived → new draft revision (previous revision kept in history). */
  function newRevision(id, note) {
    const r = getReport(id);
    if (!r) return null;
    if (!r.revisions.some(function (x) { return x.revision === r.revision; })) recordRevision(r, 'Revision ' + r.revision + ' (' + r.status + ')');
    r.revision += 1;
    r.status = 'draft';
    r.approvedAt = '';
    r.review = Object.assign({}, r.review, { reviewDate: '', approvalDate: '', approvedBy: '' });
    r.updatedAt = new Date().toISOString();
    logActivity('report', r.auditId, 'Started revision ' + r.revision + ' of “' + r.title + '”' + (note ? ' — ' + note : ''));
    commit('report:revision');
    return r;
  }

  /** New analytics snapshot from live data → new revision. */
  function refreshReportData(id) {
    const r = getReport(id);
    const audit = r && getAudit(r.auditId);
    if (!r || !audit) return null;
    recordRevision(r, 'Revision ' + r.revision + ' before data refresh');
    const res = DA.reportEngine.refreshReport(r, audit);
    r.revision += 1;
    if (r.status !== 'draft') { r.status = 'draft'; r.approvedAt = ''; r.review = Object.assign({}, r.review, { reviewDate: '', approvalDate: '', approvedBy: '' }); }
    r.updatedAt = new Date().toISOString();
    recordRevision(r, 'Results regenerated from current data');
    logActivity('report', r.auditId, 'Regenerated results for “' + r.title + '” (revision ' + r.revision + ')');
    commit('report:refresh');
    return Object.assign({ report: r }, res);
  }

  /** Review workflow: draft → in_review → approved → archived (or back to draft). */
  function setReportStatus(id, status, fields) {
    const r = getReport(id);
    if (!r) return null;
    const now = new Date().toISOString();
    const f = fields || {};
    r.review = Object.assign({}, r.review, f.review || {});
    if (status === 'in_review') { r.review.reviewDate = r.review.reviewDate || U.isoDay(new Date()); }
    if (status === 'approved') {
      r.approvedAt = now;
      r.review.approvalDate = U.isoDay(new Date());
      r.review.approvedBy = state.settings.userName;
      Object.keys(r.sections).forEach(function (k) { if (r.sections[k].aiDraft) r.sections[k].aiDraft = false; });
    }
    if (status === 'draft') r.approvedAt = '';
    r.status = status;
    r.updatedAt = now;
    if (status === 'approved' || status === 'in_review') recordRevision(r, status === 'approved' ? 'Approved by ' + state.settings.userName : 'Submitted for review');
    const labels = { draft: 'returned to draft', in_review: 'submitted for review', approved: 'approved', archived: 'archived' };
    logActivity(status === 'approved' ? 'completed' : 'report', r.auditId, 'Report “' + r.title + '” ' + labels[status]);
    commit('report:status');
    return r;
  }

  /** Reviewer details can be recorded while a report is in review (content stays locked). */
  function saveReviewDetails(id, review) {
    const r = getReport(id);
    if (!r) return null;
    if (r.status === 'approved' || r.status === 'archived') throw new Error('Review details of an ' + r.status + ' report cannot be changed.');
    r.review = Object.assign({}, r.review, review);
    r.updatedAt = new Date().toISOString();
    commit('report:review');
    return r;
  }

  function duplicateReport(id) {
    const src = getReport(id);
    if (!src) return null;
    const now = new Date().toISOString();
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = DA.model.newId('rpt');
    copy.title = src.title + ' (copy)';
    copy.status = 'draft';
    copy.revision = 1;
    copy.revisions = [];
    copy.approvedAt = '';
    copy.review = { author: state.settings.userName, reviewer: '', reviewerComments: '', reviewDate: '', approvalDate: '', approvedBy: '' };
    copy.createdAt = now;
    copy.updatedAt = now;
    copy.actionPlan.forEach(function (a) { a.id = DA.model.newId('act'); });
    recordRevision(copy, 'Duplicated from “' + src.title + '” revision ' + src.revision);
    state.reports.unshift(copy);
    logActivity('report', copy.auditId, 'Duplicated report “' + src.title + '”');
    commit('report:duplicate');
    return copy;
  }

  function deleteReport(id) {
    const r = getReport(id);
    if (!r) return false;
    state.reports = state.reports.filter(function (x) { return x.id !== id; });
    logActivity('deleted', r.auditId, 'Deleted report “' + r.title + '”');
    commit('report:delete');
    return true;
  }

  /* ---------- Settings & data management ---------- */
  function updateSettings(patch) {
    state.settings = Object.assign({}, state.settings, patch);
    if (patch.ai) state.settings.ai = Object.assign({}, DEFAULT_SETTINGS.ai, patch.ai);
    logActivity('settings', null, 'Updated settings');
    commit('settings');
  }

  /** Notifications are derived from deadlines; we remember which keys have been seen. */
  function markNotificationsRead(keys) {
    state.notificationsSeen = (keys || []).slice();
    commit('notifications');
  }
  function getNotificationsSeen() { return state.notificationsSeen || []; }

  function resetDemo() {
    const settings = state.settings;
    state = DA.seed.build(emptyState());
    state.settings = settings;
    commit('reset');
  }

  function clearAll() {
    const settings = state.settings;
    state = emptyState();
    state.settings = settings;
    state.seeded = true; // stay empty on reload rather than re-seeding
    logActivity('cleared', null, 'Cleared all audit data');
    commit('clear');
  }

  function exportJSON() {
    return JSON.stringify(state, null, 2);
  }

  function importJSON(text) {
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.audits)) throw new Error('This file does not look like a DentalAudit export.');
    state = Object.assign(emptyState(), parsed);
    state.settings = Object.assign({}, DEFAULT_SETTINGS, parsed.settings || {});
    state.audits = state.audits.map(DA.model.normaliseAudit);
    state.reports = Array.isArray(parsed.reports) ? parsed.reports : [];
    ensureQi();
    state.version = DA.model.SCHEMA_VERSION;
    logActivity('import', null, 'Imported ' + state.audits.length + ' audits from file');
    commit('import');
  }

  /** Internal hooks for modules that extend the store (qi-store.js). */
  const internal = {
    state: function () { return state; }, commit: commit, log: logActivity, touch: touch, snapshotCriteria: snapshotCriteria
  };

  function subscribe(fn) {
    listeners.push(fn);
    return function () {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  return {
    KEY, load, subscribe, isPersistent,
    getAudits, getAudit, getActivity, getSettings,
    saveDraft, publish, saveDefinition, updateAudit, setStatus, deleteAudit, startReaudit, DEFINITION_FIELDS,
    saveForm, saveRecord, deleteRecord, rescoreRecords, createCycle, addAction,
    getReports, getReport, reportsForAudit, isLocked, createReport, saveReport, newRevision, refreshReportData, setReportStatus, saveReviewDetails, duplicateReport, deleteReport, toggleAction, deleteAction,
    updateSettings, markNotificationsRead, getNotificationsSeen,
    resetDemo, clearAll, exportJSON, importJSON, setChangeReason, snapshotCriteria, _internal: internal
  };
})();
