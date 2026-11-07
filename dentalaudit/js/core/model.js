/* DentalAudit — audit data model (schema v2)
 *
 * One canonical shape for every audit, whether it is a draft, live or completed.
 * normaliseAudit() is idempotent: it fills defaults, upgrades legacy v1 records
 * (lead / rationale / standard / sampleSize / dueDate / criterion.text / 'planning')
 * and is used by the store on load, import, seeding and every save.
 *
 * Audit
 * {
 *   id, schemaVersion,
 *   // Step 1 — overview
 *   title, description, projectType, specialty, department, auditLead,
 *   collaborators: [{ id, name }], startDate, targetCompletionDate,
 *   // Step 2 — aims
 *   background, auditQuestion, aim, objectives: [{ id, text }],
 *   // Step 3 — standards
 *   criteria: [{ id, name, description, reference, target, measurementMethod,
 *                numerator, denominator, parentCriterionId }],
 *   // Step 4 — methodology
 *   methodology, inclusionCriteria: [{ id, text }], exclusionCriteria: [{ id, text }],
 *   targetSampleSize, samplingMethod, samplingOther,
 *   collectionStartDate, collectionEndDate, collectionMethods: [string], collectionOther,
 *   // Lifecycle
 *   status: 'draft' | 'active' | 'collecting' | 'analysis' | 'action' | 'completed',
 *   cycle: 1,
 *   cycles: [{ id, number, label, status, startedAt, completedAt, collectionStartDate, collectionEndDate,
 *              form, formHistory, records, caseCounter }],   // see collection.js
 *   parentId,                          // previous cycle's audit id (re-audits)
 *   // Data
 *   (case records live in cycles[].records — legacy v1/v2 `cases` are migrated on load)
 *   actions: [{ id, text, owner, due, done }],
 *   reauditMonths, reauditDate, completedAt, createdAt, updatedAt
 * }
 */
DA.model = (function () {
  const U = DA.utils;
  const SCHEMA_VERSION = 3;

  const PROJECT_TYPES = ['Clinical Audit', 'Quality Improvement Project', 'Service Evaluation'];
  const SPECIALTIES = ['Restorative Dentistry', 'Endodontics', 'Prosthodontics', 'Periodontics', 'Oral Surgery',
    'Orthodontics', 'Paediatric Dentistry', 'Special Care Dentistry', 'Oral Medicine', 'General Dentistry', 'Other'];
  const SAMPLING_METHODS = ['Consecutive sampling', 'Random sampling', 'Retrospective case selection', 'Prospective case selection', 'Other'];
  const COLLECTION_METHODS = ['Electronic patient records', 'Paper records', 'Clinical examination', 'Radiographic assessment', 'Laboratory records', 'Other'];
  const MEASUREMENT_METHODS = ['Clinical record review', 'Radiograph review', 'Clinical examination', 'Direct observation',
    'Patient questionnaire', 'Laboratory records review', 'Correspondence review'];

  /* ---------- IDs ---------- */
  function allIds() {
    const set = new Set();
    let audits = [];
    try { audits = DA.store && DA.store.getAudits ? DA.store.getAudits() : []; } catch (e) { audits = []; } // store not loaded yet
    audits.forEach(function (a) {
      set.add(a.id);
      (a.criteria || []).forEach(function (c) { set.add(c.id); });
      (a.cycles || []).forEach(function (cy) {
        set.add(cy.id);
        if (cy.form) cy.form.fields.forEach(function (f) { set.add(f.id); });
        (cy.records || []).forEach(function (r) { set.add(r.id); });
      });
    });
    return set;
  }

  /** Collision-checked ID: timestamp + randomness, re-rolled if it ever clashes. */
  function newId(prefix, taken) {
    const used = taken || allIds();
    let id;
    do { id = U.uid(prefix); } while (used.has(id));
    used.add(id);
    return id;
  }

  /* ---------- Factories ---------- */
  function item(text, prefix) { return { id: newId(prefix || 'itm'), text: text || '' }; }

  function blankCriterion(defaultTarget) {
    return {
      id: newId('crit'), name: '', description: '', reference: '',
      target: defaultTarget === undefined ? 100 : defaultTarget,
      measurementMethod: 'Clinical record review', numerator: '', denominator: '', parentCriterionId: null
    };
  }

  function blankAudit(settings) {
    const s = settings || {};
    const now = new Date().toISOString();
    return normaliseAudit({
      id: null, // assigned on first save so an untouched form never creates a record
      status: 'draft',
      department: s.department || '',
      auditLead: s.userName || '',
      startDate: U.isoDay(new Date()),
      targetCompletionDate: U.isoDay(U.addDays(new Date(), 90)),
      collectionStartDate: U.isoDay(new Date()),
      collectionEndDate: U.isoDay(U.addDays(new Date(), 42)),
      reauditMonths: s.reauditMonths || 12,
      objectives: [item('', 'obj')],
      inclusionCriteria: [item('', 'inc')],
      exclusionCriteria: [item('', 'exc')],
      collaborators: [],
      createdAt: now, updatedAt: now
    });
  }

  /* ---------- Normalisation / migration ---------- */
  function str(v) { return v === null || v === undefined ? '' : String(v); }

  function list(v, prefix, key) {
    if (!Array.isArray(v)) return [];
    return v.map(function (x) {
      if (typeof x === 'string') { const o = { id: U.uid(prefix) }; o[key] = x; return o; }
      const o = { id: x.id || U.uid(prefix) };
      o[key] = str(x[key] !== undefined ? x[key] : x.text !== undefined ? x.text : x.name);
      return o;
    });
  }

  function normaliseCriterion(c, legacyStandard) {
    // v1 criteria only had { id, text, target }: derive sensible definitions so they validate.
    if (c.name === undefined && c.text !== undefined) {
      c = Object.assign({}, c, {
        name: c.text,
        numerator: c.numerator || 'Cases in which: ' + String(c.text).charAt(0).toLowerCase() + String(c.text).slice(1),
        denominator: c.denominator || 'All audited cases where the criterion applies (N/A excluded)'
      });
    }
    return {
      id: c.id || U.uid('crit'),
      name: str(c.name !== undefined ? c.name : c.text),
      description: str(c.description),
      reference: str(c.reference !== undefined ? c.reference : legacyStandard),
      target: c.target === '' || c.target === undefined || c.target === null ? '' : Number(c.target),
      measurementMethod: str(c.measurementMethod || (c.name !== undefined || c.text !== undefined ? 'Clinical record review' : '')),
      numerator: str(c.numerator),
      denominator: str(c.denominator),
      parentCriterionId: c.parentCriterionId || null
    };
  }

  function normaliseAudit(raw) {
    const a = raw || {};
    const status = a.status === 'planning' ? 'active' : (a.status || 'draft');
    const cycle = Number(a.cycle) || 1;
    const out = {
      id: a.id || null,
      schemaVersion: SCHEMA_VERSION,

      title: str(a.title),
      description: str(a.description),
      projectType: str(a.projectType || (a.id ? 'Clinical Audit' : '')),
      specialty: str(a.specialty),
      department: str(a.department),
      auditLead: str(a.auditLead !== undefined ? a.auditLead : a.lead),
      collaborators: list(a.collaborators, 'col', 'name'),
      startDate: str(a.startDate),
      targetCompletionDate: str(a.targetCompletionDate !== undefined ? a.targetCompletionDate : a.dueDate),

      background: str(a.background !== undefined ? a.background : a.rationale),
      auditQuestion: str(a.auditQuestion),
      aim: str(a.aim),
      objectives: list(a.objectives, 'obj', 'text'),

      criteria: (a.criteria || []).map(function (c) { return normaliseCriterion(c, a.standard); }),

      methodology: str(a.methodology),
      inclusionCriteria: list(a.inclusionCriteria, 'inc', 'text'),
      exclusionCriteria: list(a.exclusionCriteria, 'exc', 'text'),
      targetSampleSize: a.targetSampleSize !== undefined ? a.targetSampleSize : (a.sampleSize !== undefined ? a.sampleSize : 30),
      samplingMethod: str(a.samplingMethod),
      samplingOther: str(a.samplingOther),
      collectionStartDate: str(a.collectionStartDate !== undefined ? a.collectionStartDate : a.startDate),
      collectionEndDate: str(a.collectionEndDate !== undefined ? a.collectionEndDate : (a.dueDate !== undefined ? a.dueDate : a.targetCompletionDate)),
      collectionMethods: Array.isArray(a.collectionMethods) ? a.collectionMethods.slice() : [],
      collectionOther: str(a.collectionOther),

      status: status,
      cycle: cycle,
      cycles: [],
      parentId: a.parentId || null,

      actions: Array.isArray(a.actions) ? a.actions : [],
      // Changes to criterion definitions after data collection has started (see DA.store.saveDefinition).
      criteriaChanges: Array.isArray(a.criteriaChanges) ? a.criteriaChanges : [],

      reauditMonths: a.reauditMonths || null,
      reauditDate: a.reauditDate || null,
      completedAt: a.completedAt || null,
      createdAt: a.createdAt || new Date().toISOString(),
      updatedAt: a.updatedAt || a.createdAt || new Date().toISOString()
    };
    if (out.targetSampleSize !== '') out.targetSampleSize = Number(out.targetSampleSize) || '';
    // Cycles hold each cycle's form definition and case records (see collection.js).
    DA.collection.normaliseCycles(a, out);
    return out;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------- Derived helpers ---------- */
  /** Unique list of reference sources across criteria — the audit's "standards". */
  function references(audit) {
    const seen = [];
    (audit.criteria || []).forEach(function (c) {
      const r = (c.reference || '').trim();
      if (r && seen.indexOf(r) === -1) seen.push(r);
    });
    return seen;
  }

  function collectionMethodsText(audit) {
    return (audit.collectionMethods || []).map(function (m) {
      return m === 'Other' && audit.collectionOther ? 'Other: ' + audit.collectionOther : m;
    });
  }

  function samplingText(audit) {
    if (audit.samplingMethod === 'Other' && audit.samplingOther) return 'Other: ' + audit.samplingOther;
    return audit.samplingMethod;
  }

  function filled(items, key) {
    return (items || []).filter(function (x) { return str(x[key || 'text']).trim(); });
  }

  /* ---------- Validation ----------
   * Returns { step: { field: message } } for steps 1–4. Empty object = valid.
   */
  function validate(a) {
    const e = { 1: {}, 2: {}, 3: {}, 4: {} };
    if (!a.title.trim()) e[1].title = 'Enter an audit title.';
    else if (a.title.trim().length < 5) e[1].title = 'Use a more descriptive title (at least 5 characters).';
    if (!a.projectType) e[1].projectType = 'Choose a project type.';
    if (!a.specialty) e[1].specialty = 'Choose the dental specialty.';
    if (!a.department.trim()) e[1].department = 'Enter the department, hospital or practice.';
    if (!a.auditLead.trim()) e[1].auditLead = 'Name the audit lead.';
    if (!a.startDate) e[1].startDate = 'Set the audit start date.';
    if (!a.targetCompletionDate) e[1].targetCompletionDate = 'Set a target completion date.';
    else if (a.startDate && a.targetCompletionDate < a.startDate) e[1].targetCompletionDate = 'Completion must be on or after the start date.';

    if (!a.aim.trim()) e[2].aim = 'State the overall aim of the audit.';

    if (!a.criteria.length) e[3].criteria = 'Add at least one audit criterion.';
    a.criteria.forEach(function (c, i) {
      const ce = criterionErrors(c);
      if (Object.keys(ce).length) e[3]['criterion_' + c.id] = 'Criterion ' + (i + 1) + ' is incomplete: ' + Object.values(ce)[0];
    });

    const n = Number(a.targetSampleSize);
    if (a.targetSampleSize === '' || !Number.isInteger(n) || n < 1 || n > 10000) e[4].targetSampleSize = 'Enter a whole number between 1 and 10,000.';
    if (!a.samplingMethod) e[4].samplingMethod = 'Choose a sampling method.';
    else if (a.samplingMethod === 'Other' && !a.samplingOther.trim()) e[4].samplingOther = 'Describe the sampling method.';
    if (!a.collectionStartDate) e[4].collectionStartDate = 'Set when data collection starts.';
    if (!a.collectionEndDate) e[4].collectionEndDate = 'Set when data collection ends.';
    else if (a.collectionStartDate && a.collectionEndDate < a.collectionStartDate) e[4].collectionEndDate = 'End date must be on or after the start date.';
    if (!a.collectionMethods.length) e[4].collectionMethods = 'Select at least one data collection method.';
    else if (a.collectionMethods.indexOf('Other') !== -1 && !a.collectionOther.trim()) e[4].collectionOther = 'Describe the other data source.';
    return e;
  }

  function criterionErrors(c) {
    const e = {};
    if (!c.name.trim()) e.name = 'Give the criterion a name.';
    if (!c.reference.trim()) e.reference = 'Cite the guideline or protocol this standard comes from.';
    if (!c.measurementMethod.trim()) e.measurementMethod = 'Say how compliance will be measured.';
    const t = Number(c.target);
    if (c.target === '' || isNaN(t) || t < 0 || t > 100) e.target = 'Target must be between 0 and 100%.';
    if (!c.numerator.trim()) e.numerator = 'Define the numerator (cases meeting the criterion).';
    if (!c.denominator.trim()) e.denominator = 'Define the denominator (eligible cases).';
    return e;
  }

  function errorCount(errs) {
    return [1, 2, 3, 4].reduce(function (n, s) { return n + Object.keys(errs[s]).length; }, 0);
  }

  return {
    SCHEMA_VERSION, PROJECT_TYPES, SPECIALTIES, SAMPLING_METHODS, COLLECTION_METHODS, MEASUREMENT_METHODS,
    newId, item, blankCriterion, blankAudit, normaliseAudit, normaliseCriterion, clone,
    references, collectionMethodsText, samplingText, filled,
    validate, criterionErrors, errorCount
  };
})();
