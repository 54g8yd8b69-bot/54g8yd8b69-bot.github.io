/* DentalAudit — data collection engine
 *
 * Pure functions for dynamic data-collection forms and case records.
 * No DOM, no storage — the store persists what these functions build.
 *
 * Where data lives (schema v3)
 *   audit.cycles[] = {
 *     id, number, label, status, startedAt, completedAt,
 *     collectionStartDate, collectionEndDate,
 *     form:        FormDefinition | null     ← the current, editable form
 *     formHistory: FormDefinition[]          ← immutable snapshots of earlier versions
 *     records:     CaseRecord[]              ← this cycle's cases only
 *     caseCounter: number                    ← last CASE-### issued (never reused)
 *   }
 *
 * FormDefinition
 *   { id, version, fields: Field[], createdAt, updatedAt, savedBy }
 *
 * Field (type-specific keys are ignored by other types)
 *   { id, type, label, helperText, required, placeholder, defaultValue,
 *     options: [{ id, label }],                         select / multiselect / radio / yesno
 *     allowNA, naLabel,                                 optional "Not applicable" response
 *     minLength, maxLength,                             short_text / long_text
 *     min, max, decimals,                               number
 *     minDate, maxDate,                                 date
 *     minSelections, maxSelections,                     multiselect
 *     ratingMin, ratingMax, minLabel, maxLabel,         rating
 *     checkboxLabel,                                    checkbox
 *     linkedCriterionId,                                criterion this field evidences (or null)
 *     compliantValues: [optionId],                      choice fields: responses that are compliant
 *     notApplicableValues: [optionId],                  choice fields: responses excluded from the denominator
 *     compliantMin, compliantMax }                      number / rating: compliant range
 *
 * CaseRecord
 *   { id, caseReference: 'CASE-001', auditId, cycleId, collectionDate,
 *     responses: { [fieldId]: value }, status: 'draft' | 'completed',
 *     formId, formVersion, results: { [criterionId]: 'met' | 'not_met' | 'na' },
 *     createdAt, updatedAt }
 *
 * Responses are keyed by field ID and choice answers store option IDs, so renaming a
 * label or reordering fields never changes the meaning of stored data.
 */
DA.collection = (function () {
  const U = DA.utils;
  const NA = 'na';

  const TYPES = {
    short_text: { label: 'Short text', icon: 'fType', hint: 'One-line answer' },
    long_text:  { label: 'Long text', icon: 'fAlign', hint: 'Paragraph or notes' },
    number:     { label: 'Number', icon: 'fHash', hint: 'Numeric value with range' },
    date:       { label: 'Date', icon: 'calendar', hint: 'Calendar date' },
    yesno:      { label: 'Yes / No', icon: 'fToggle', hint: 'Binary answer, optional N/A', choice: true },
    select:     { label: 'Dropdown', icon: 'fList', hint: 'Single select from a list', choice: true, options: true },
    multiselect:{ label: 'Multiple select', icon: 'fChecks', hint: 'Choose several options', choice: true, options: true },
    radio:      { label: 'Radio buttons', icon: 'fRadio', hint: 'Single choice, all visible', choice: true, options: true },
    checkbox:   { label: 'Checkbox', icon: 'fCheckbox', hint: 'Tick to confirm', choice: true },
    rating:     { label: 'Rating scale', icon: 'fStar', hint: 'Score on a scale' }
  };
  const TYPE_ORDER = Object.keys(TYPES);

  /** Direct patient identifiers must never be collected. */
  const IDENTIFIER_RE = /\b(patient'?s?\s+(full\s+)?name|first\s+name|surname|forename|date\s+of\s+birth|d\.?o\.?b\.?|nhs\s*(no|number|#)|chi\s*(no|number|#)|hospital\s*(no|number)|mrn|postcode|post\s+code|home\s+address|address|telephone|phone\s*(no|number)?|mobile\s*(no|number)?|e-?mail)\b/i;

  function detectIdentifier(text) {
    const m = String(text || '').match(IDENTIFIER_RE);
    return m ? m[0] : null;
  }

  /* =========================================================
   * IDs
   * ========================================================= */
  function id(prefix) { return DA.model.newId(prefix); }

  /* =========================================================
   * Field & form factories
   * ========================================================= */
  function yesnoOptions(yes, no) { return [{ id: 'yes', label: yes || 'Yes' }, { id: 'no', label: no || 'No' }]; }

  /** Type defaults without any IDs (safe to call while normalising stored data). */
  function defaults(type) {
    const t = TYPES[type];
    const f = {
      type: type, label: '', helperText: '', required: false, placeholder: '', defaultValue: null,
      options: [], allowNA: false, naLabel: 'Not applicable',
      minLength: '', maxLength: '', min: '', max: '', decimals: 0, minDate: '', maxDate: '',
      minSelections: '', maxSelections: '', ratingMin: 1, ratingMax: 5, minLabel: '', maxLabel: '', checkboxLabel: '',
      linkedCriterionId: null, compliantValues: [], notApplicableValues: [], compliantMin: '', compliantMax: ''
    };
    switch (type) {
      case 'short_text': f.label = 'Untitled short answer'; f.maxLength = 120; break;
      case 'long_text': f.label = 'Untitled long answer'; f.maxLength = 1000; break;
      case 'number': f.label = 'Untitled number'; break;
      case 'date': f.label = 'Untitled date'; break;
      case 'yesno': f.label = 'Untitled yes / no question'; f.options = yesnoOptions(); break;
      case 'select': case 'radio': case 'multiselect': f.label = 'Untitled ' + t.label.toLowerCase(); break;
      case 'checkbox': f.label = 'Untitled checkbox'; f.checkboxLabel = 'Confirmed'; f.defaultValue = false; break;
      case 'rating': f.label = 'Untitled rating'; f.minLabel = 'Poor'; f.maxLabel = 'Excellent'; break;
    }
    return f;
  }

  function newField(type) {
    const f = Object.assign({ id: id('fld') }, defaults(type));
    if (TYPES[type].options) f.options = [{ id: id('opt'), label: 'Option 1' }, { id: id('opt'), label: 'Option 2' }];
    return f;
  }

  /** Deep copy with fresh IDs for the field and its options (Duplicate). */
  function duplicateField(field) {
    const f = JSON.parse(JSON.stringify(field));
    f.id = id('fld');
    const map = {};
    if (f.type !== 'yesno') {
      f.options = f.options.map(function (o) { const n = id('opt'); map[o.id] = n; return { id: n, label: o.label }; });
    }
    const remap = function (v) { return map[v] || v; };
    f.compliantValues = f.compliantValues.map(remap);
    f.notApplicableValues = f.notApplicableValues.map(remap);
    if (Array.isArray(f.defaultValue)) f.defaultValue = f.defaultValue.map(remap);
    else if (typeof f.defaultValue === 'string') f.defaultValue = remap(f.defaultValue);
    f.label = (f.label || 'Untitled') + ' (copy)';
    return f;
  }

  function newForm() {
    const now = new Date().toISOString();
    return { id: id('form'), version: 0, fields: [], createdAt: now, updatedAt: now };
  }

  function normaliseField(f) {
    const out = Object.assign(defaults(f.type && TYPES[f.type] ? f.type : 'short_text'), f);
    if (!out.id) out.id = id('fld');
    out.options = Array.isArray(out.options) ? out.options : [];
    if (out.type === 'yesno' && out.options.length !== 2) out.options = yesnoOptions();
    out.compliantValues = Array.isArray(out.compliantValues) ? out.compliantValues : [];
    out.notApplicableValues = Array.isArray(out.notApplicableValues) ? out.notApplicableValues : [];
    return out;
  }

  function normaliseForm(form) {
    if (!form) return null;
    return Object.assign({ version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, form, {
      id: form.id || id('form'),
      fields: (form.fields || []).map(normaliseField)
    });
  }

  /* =========================================================
   * Options and responses
   * ========================================================= */
  /** Selectable options including the N/A option when enabled. */
  function choiceOptions(field) {
    let opts;
    if (field.type === 'checkbox') opts = [{ id: 'checked', label: 'Ticked' }, { id: 'unchecked', label: 'Not ticked' }];
    else opts = field.options.slice();
    if (field.allowNA && field.type !== 'checkbox') opts.push({ id: NA, label: field.naLabel || 'Not applicable', isNA: true });
    return opts;
  }

  function optionLabel(field, optionId) {
    const o = choiceOptions(field).find(function (x) { return x.id === optionId; });
    return o ? o.label : null;
  }

  function isEmpty(field, value) {
    if (field.type === 'checkbox') return value === null || value === undefined;
    if (Array.isArray(value)) return value.length === 0;
    return value === null || value === undefined || String(value).trim() === '';
  }

  /** Initial value for a new case, from the field's default. */
  function initialValue(field, collectionDate) {
    const d = field.defaultValue;
    if (field.type === 'checkbox') return d === true;
    if (field.type === 'multiselect') return Array.isArray(d) ? d.slice() : [];
    if (field.type === 'date' && d === 'today') return collectionDate || U.isoDay(new Date());
    return d === null || d === undefined ? '' : d;
  }

  function formatValue(field, value) {
    if (!field) return String(value);
    if (value === NA) return field.naLabel || 'Not applicable';
    if (field.type === 'checkbox') return value === true ? '✓ ' + (field.checkboxLabel || 'Ticked') : 'Not ticked';
    if (isEmpty(field, value)) return '';
    switch (field.type) {
      case 'yesno': case 'select': case 'radio': return optionLabel(field, value) || '(removed option)';
      case 'multiselect': return value.map(function (v) { return optionLabel(field, v) || '(removed option)'; }).join(', ');
      case 'date': return U.fmtDate(value);
      case 'rating': return value + ' / ' + field.ratingMax;
      default: return String(value);
    }
  }

  /* =========================================================
   * Validation of a response (case entry)
   * mode 'complete' enforces required fields; 'draft' only checks what was entered.
   * ========================================================= */
  function validateResponse(field, value, mode) {
    const empty = isEmpty(field, value);
    if (empty) return mode === 'complete' && field.required && field.type !== 'checkbox' ? 'This field is required.' : '';
    if (value === NA) return field.allowNA ? '' : 'Not applicable is not allowed for this field.';
    const num = function (v) { return v === '' || v === null || v === undefined ? null : Number(v); };
    switch (field.type) {
      case 'short_text': case 'long_text': {
        const len = String(value).trim().length;
        if (num(field.minLength) !== null && len < num(field.minLength)) return 'Enter at least ' + field.minLength + ' characters (currently ' + len + ').';
        if (num(field.maxLength) !== null && len > num(field.maxLength)) return 'Use no more than ' + field.maxLength + ' characters (currently ' + len + ').';
        if (detectIdentifier(value) && /\d{6,}/.test(value)) return 'This looks like a patient identifier. Do not record identifiable information.';
        return '';
      }
      case 'number': {
        if (!/^-?\d+(\.\d+)?$/.test(String(value).trim())) return 'Enter a number.';
        const n = Number(value);
        if (num(field.min) !== null && n < num(field.min)) return 'Must be ' + field.min + ' or more.';
        if (num(field.max) !== null && n > num(field.max)) return 'Must be ' + field.max + ' or less.';
        const dp = (String(value).split('.')[1] || '').length;
        const allowed = Number(field.decimals) || 0;
        if (dp > allowed) return allowed ? 'Use up to ' + allowed + ' decimal place' + (allowed === 1 ? '' : 's') + '.' : 'Enter a whole number.';
        return '';
      }
      case 'date': {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || isNaN(new Date(value))) return 'Enter a valid date.';
        if (field.minDate && value < field.minDate) return 'Date must be on or after ' + U.fmtDate(field.minDate) + '.';
        if (field.maxDate && value > field.maxDate) return 'Date must be on or before ' + U.fmtDate(field.maxDate) + '.';
        return '';
      }
      case 'yesno': case 'select': case 'radio':
        return optionLabel(field, value) ? '' : 'Choose one of the listed options (a previously chosen option may have been removed).';
      case 'multiselect': {
        if (!Array.isArray(value)) return 'Choose from the listed options.';
        if (value.some(function (v) { return !optionLabel(field, v); })) return 'One of the selected options is no longer available.';
        if (value.indexOf(NA) !== -1 && value.length > 1) return '“' + (field.naLabel || 'Not applicable') + '” cannot be combined with other options.';
        if (value.indexOf(NA) !== -1) return '';
        if (num(field.minSelections) !== null && value.length < num(field.minSelections)) return 'Select at least ' + field.minSelections + '.';
        if (num(field.maxSelections) !== null && value.length > num(field.maxSelections)) return 'Select no more than ' + field.maxSelections + '.';
        return '';
      }
      case 'rating': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < Number(field.ratingMin) || n > Number(field.ratingMax)) return 'Choose a rating from ' + field.ratingMin + ' to ' + field.ratingMax + '.';
        return '';
      }
      case 'checkbox': return typeof value === 'boolean' ? '' : 'Invalid value.';
    }
    return '';
  }

  /** Validate a whole case. Returns { errors: {fieldId|_date: msg}, count }. */
  function validateRecord(form, data, mode) {
    const errors = {};
    if (!data.collectionDate) errors._date = 'Enter the date of data collection.';
    else if (data.collectionDate > U.isoDay(new Date())) errors._date = 'Collection date cannot be in the future.';
    form.fields.forEach(function (f) {
      const e = validateResponse(f, data.responses[f.id], mode);
      if (e) errors[f.id] = e;
    });
    return { errors: errors, count: Object.keys(errors).length };
  }

  /* =========================================================
   * Validation of a field definition (form builder)
   * ========================================================= */
  function validateFieldDef(f, criteria) {
    const e = {};
    const n = function (v) { return v === '' || v === null || v === undefined ? null : Number(v); };
    if (!String(f.label).trim()) e.label = 'Give the field a label.';
    const ident = detectIdentifier(f.label) || detectIdentifier(f.helperText);
    if (ident) e.label = 'Do not collect direct patient identifiers (“' + ident + '”). Case references are generated automatically.';
    if (f.type === 'short_text' || f.type === 'long_text') {
      if (n(f.minLength) !== null && (n(f.minLength) < 0 || !Number.isInteger(n(f.minLength)))) e.minLength = 'Use a whole number of 0 or more.';
      if (n(f.maxLength) !== null && (n(f.maxLength) < 1 || !Number.isInteger(n(f.maxLength)))) e.maxLength = 'Use a whole number of 1 or more.';
      if (!e.minLength && !e.maxLength && n(f.minLength) !== null && n(f.maxLength) !== null && n(f.minLength) > n(f.maxLength)) e.maxLength = 'Maximum must be at least the minimum.';
    }
    if (f.type === 'number') {
      if (n(f.min) !== null && isNaN(n(f.min))) e.min = 'Enter a number.';
      if (n(f.max) !== null && isNaN(n(f.max))) e.max = 'Enter a number.';
      if (!e.min && !e.max && n(f.min) !== null && n(f.max) !== null && n(f.min) > n(f.max)) e.max = 'Maximum must be at least the minimum.';
      const d = Number(f.decimals);
      if (!Number.isInteger(d) || d < 0 || d > 6) e.decimals = 'Choose 0 to 6 decimal places.';
    }
    if (f.type === 'date' && f.minDate && f.maxDate && f.minDate > f.maxDate) e.maxDate = 'Latest date must be after the earliest date.';
    if (TYPES[f.type].options) {
      const labels = f.options.map(function (o) { return String(o.label).trim().toLowerCase(); });
      if (f.options.length < 2) e.options = 'Add at least two options.';
      else if (labels.some(function (l) { return !l; })) e.options = 'Every option needs a label.';
      else if (labels.some(function (l, i) { return labels.indexOf(l) !== i; })) e.options = 'Option labels must be unique.';
    }
    if (f.type === 'yesno' && f.options.some(function (o) { return !String(o.label).trim(); })) e.options = 'Both responses need a label.';
    if (f.type === 'multiselect') {
      const mn = n(f.minSelections), mx = n(f.maxSelections);
      if (mn !== null && (!Number.isInteger(mn) || mn < 0)) e.minSelections = 'Use a whole number.';
      if (mx !== null && (!Number.isInteger(mx) || mx < 1)) e.maxSelections = 'Use a whole number of 1 or more.';
      if (!e.minSelections && !e.maxSelections) {
        if (mn !== null && mx !== null && mn > mx) e.maxSelections = 'Maximum must be at least the minimum.';
        else if (mx !== null && mx > f.options.length) e.maxSelections = 'Cannot exceed the number of options (' + f.options.length + ').';
      }
    }
    if (f.type === 'rating') {
      const a = Number(f.ratingMin), b = Number(f.ratingMax);
      if (!Number.isInteger(a) || !Number.isInteger(b)) e.ratingMax = 'Use whole numbers.';
      else if (a >= b) e.ratingMax = 'Maximum must be greater than minimum.';
      else if (b - a > 10) e.ratingMax = 'Use a scale of 11 points or fewer.';
    }
    if (f.allowNA && !String(f.naLabel || '').trim()) e.naLabel = 'Label the Not applicable response.';
    if (!isEmpty(f, f.defaultValue) && f.type !== 'checkbox' && !(f.type === 'date' && f.defaultValue === 'today')) {
      const de = validateResponse(f, f.defaultValue, 'draft');
      if (de) e.defaultValue = 'Default value: ' + de.charAt(0).toLowerCase() + de.slice(1);
    }
    if (f.linkedCriterionId) {
      if (criteria && !criteria.some(function (c) { return c.id === f.linkedCriterionId; })) e.linkedCriterionId = 'The linked criterion no longer exists.';
      else if (TYPES[f.type].choice) {
        if (!f.compliantValues.length) e.compliance = 'Choose at least one response that counts as compliant.';
        else if (f.compliantValues.some(function (v) { return f.notApplicableValues.indexOf(v) !== -1; })) e.compliance = 'A response cannot be both compliant and not applicable.';
        else if (choiceOptions(f).every(function (o) { return f.compliantValues.indexOf(o.id) !== -1 || f.notApplicableValues.indexOf(o.id) !== -1; })) e.compliance = 'At least one response must count as non-compliant.';
      } else if (f.type === 'number' || f.type === 'rating') {
        if (n(f.compliantMin) === null && n(f.compliantMax) === null) e.compliance = 'Set the compliant range (minimum and/or maximum).';
        else if (n(f.compliantMin) !== null && n(f.compliantMax) !== null && n(f.compliantMin) > n(f.compliantMax)) e.compliance = 'Compliant minimum must not exceed the maximum.';
      }
    }
    return e;
  }

  function validateForm(form, criteria) {
    const errs = {};
    if (!form.fields.length) errs._form = 'Add at least one field before saving.';
    form.fields.forEach(function (f) {
      const e = validateFieldDef(f, criteria);
      if (Object.keys(e).length) errs[f.id] = e;
    });
    return errs;
  }

  /* =========================================================
   * Compliance scoring — the contract the analytics engine relies on
   * ========================================================= */
  /** 'met' | 'not_met' | 'na' | null (no evidence) for one field's response. */
  function evaluate(field, value) {
    if (!field.linkedCriterionId) return null;
    if (field.type === 'checkbox') value = value === true ? 'checked' : 'unchecked';
    if (value === NA) return 'na';
    if (isEmpty(field, value)) return field.type === 'short_text' || field.type === 'long_text' || field.type === 'date' ? 'not_met' : null;
    if (field.type === 'multiselect') {
      const sel = value;
      if (sel.every(function (v) { return field.notApplicableValues.indexOf(v) !== -1 || v === NA; })) return 'na';
      return sel.some(function (v) { return field.compliantValues.indexOf(v) !== -1; }) ? 'met' : 'not_met';
    }
    if (TYPES[field.type].choice) {
      if (field.notApplicableValues.indexOf(value) !== -1) return 'na';
      return field.compliantValues.indexOf(value) !== -1 ? 'met' : 'not_met';
    }
    if (field.type === 'number' || field.type === 'rating') {
      const v = Number(value);
      const lo = field.compliantMin === '' ? -Infinity : Number(field.compliantMin);
      const hi = field.compliantMax === '' ? Infinity : Number(field.compliantMax);
      return v >= lo && v <= hi ? 'met' : 'not_met';
    }
    return 'met'; // text / date: a recorded answer is compliant
  }

  /**
   * Criterion results for one record. Several fields may evidence the same criterion:
   * any N/A → N/A (excluded from denominator); otherwise all must be met.
   */
  function scoreRecord(form, responses) {
    const by = {};
    form.fields.forEach(function (f) {
      const r = evaluate(f, responses[f.id]);
      if (!r) return;
      const k = f.linkedCriterionId;
      if (by[k] === 'na') return;
      if (r === 'na') by[k] = 'na';
      else if (r === 'not_met') by[k] = 'not_met';
      else if (!by[k]) by[k] = 'met';
    });
    return by;
  }

  function answeredCount(form, responses) {
    let n = 0;
    form.fields.forEach(function (f) { if (!isEmpty(f, responses[f.id])) n++; });
    return n;
  }

  /* =========================================================
   * Cycles, versions and records
   * ========================================================= */
  function currentCycle(audit) {
    return audit && audit.cycles && audit.cycles.length ? audit.cycles[audit.cycles.length - 1] : null;
  }

  function cycleById(audit, cycleId) {
    return (audit.cycles || []).find(function (c) { return c.id === cycleId; }) || null;
  }

  /** The form definition a record was collected with (falls back to the current form). */
  function formForVersion(cycle, version) {
    if (!cycle || !cycle.form) return null;
    if (!version || version === cycle.form.version) return cycle.form;
    return cycle.formHistory.find(function (f) { return f.version === version; }) || cycle.form;
  }

  function records(audit, cycle) {
    const c = cycle || currentCycle(audit);
    return c ? c.records : [];
  }

  function completedRecords(audit) {
    return records(audit).filter(function (r) { return r.status === 'completed'; });
  }

  function hasForm(audit) {
    const c = currentCycle(audit);
    return !!(c && c.form && c.form.fields.length);
  }

  function canCollect(audit) {
    const c = currentCycle(audit);
    return !!c && DA.metrics.isActive(audit) && c.status !== 'completed';
  }

  function nextCaseReference(cycle) {
    const highest = cycle.records.reduce(function (m, r) {
      const k = /^CASE-(\d+)$/.exec(r.caseReference || '');
      return k ? Math.max(m, Number(k[1])) : m;
    }, 0);
    const n = Math.max(cycle.caseCounter || 0, highest) + 1;
    return { number: n, ref: 'CASE-' + String(n).padStart(3, '0') };
  }

  /** Collection status shown in lists and on the audit overview. */
  function statusOf(audit) {
    const c = currentCycle(audit);
    if (!c) return { key: 'none', label: 'Not started', tone: 'neutral' };
    if (audit.status === 'completed' || c.status === 'completed') return { key: 'closed', label: 'Closed', tone: 'green' };
    if (!c.form || !c.form.fields.length) return { key: 'noform', label: 'Form not designed', tone: 'neutral' };
    const done = c.records.filter(function (r) { return r.status === 'completed'; }).length;
    if (!done) return { key: 'ready', label: 'Ready to collect', tone: 'violet' };
    if (done >= Number(audit.targetSampleSize || 0)) return { key: 'target', label: 'Target reached', tone: 'green' };
    return { key: 'collecting', label: 'Collecting', tone: 'blue' };
  }

  /* =========================================================
   * Normalisation & legacy migration (called from DA.model.normaliseAudit)
   * ========================================================= */
  const CLINICIANS = ['Consultant', 'Specialty registrar', 'Specialty dentist', 'DCT', 'Postgraduate student', 'Undergraduate student', 'Hygienist / therapist'];
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }

  /** Form equivalent of the original fixed Met / Not met / N/A data entry. */
  function legacyForm(audit, cycleId) {
    const now = audit.createdAt || new Date().toISOString();
    const fields = [{
      id: 'fld_' + cycleId + '_clin', type: 'select', label: 'Clinician grade', helperText: 'Grade of the treating clinician.',
      options: CLINICIANS.map(function (c) { return { id: 'opt_' + slug(c), label: c }; })
    }];
    audit.criteria.forEach(function (c) {
      fields.push({
        id: 'fld_' + c.id, type: 'yesno', label: c.name + '?', helperText: c.description || '', required: true,
        options: yesnoOptions(), allowNA: true, naLabel: 'Not applicable',
        linkedCriterionId: c.id, compliantValues: ['yes'], notApplicableValues: [NA]
      });
    });
    fields.push({ id: 'fld_' + cycleId + '_notes', type: 'long_text', label: 'Notes', helperText: 'Context for any non-compliance.', maxLength: 1000 });
    return normaliseForm({ id: 'form_' + cycleId, version: 1, fields: fields, createdAt: now, updatedAt: now, generated: 'legacy' });
  }

  function migrateLegacyCases(audit, cycle, cases) {
    cycle.form = legacyForm(audit, cycle.id);
    const map = { met: 'yes', not_met: 'no', na: NA };
    const sorted = cases.slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    cycle.records = sorted.map(function (c, i) {
      const responses = {};
      if (c.clinician) responses['fld_' + cycle.id + '_clin'] = 'opt_' + slug(c.clinician);
      audit.criteria.forEach(function (cr) {
        if (c.results && c.results[cr.id]) responses['fld_' + cr.id] = map[c.results[cr.id]];
      });
      if (c.notes) responses['fld_' + cycle.id + '_notes'] = c.notes;
      const rec = {
        id: c.id, caseReference: 'CASE-' + String(i + 1).padStart(3, '0'), auditId: audit.id, cycleId: cycle.id,
        collectionDate: c.date, responses: responses, status: 'completed', formId: cycle.form.id, formVersion: 1,
        createdAt: c.createdAt || new Date(c.date).toISOString(), updatedAt: c.createdAt || new Date(c.date).toISOString()
      };
      rec.results = scoreRecord(cycle.form, responses);
      return rec;
    });
    cycle.caseCounter = cycle.records.length;
  }

  /** Fill cycle defaults, attach legacy flat `cases` to the current cycle. */
  function normaliseCycles(src, out) {
    if (out.status === 'draft') { out.cycles = []; return; }
    const raw = Array.isArray(src.cycles) && src.cycles.length ? src.cycles : [{ id: 'cyc_' + (out.id || 'x') + '_' + out.cycle, number: out.cycle, label: 'Cycle ' + out.cycle, startedAt: out.createdAt }];
    out.cycles = raw.map(function (c) {
      return {
        id: c.id || id('cyc'), number: c.number || out.cycle, label: c.label || 'Cycle ' + (c.number || out.cycle),
        status: c.status || out.status, startedAt: c.startedAt || out.createdAt, completedAt: c.completedAt || null,
        collectionStartDate: c.collectionStartDate || out.collectionStartDate || '',
        collectionEndDate: c.collectionEndDate || out.collectionEndDate || '',
        form: normaliseForm(c.form),
        formHistory: Array.isArray(c.formHistory) ? c.formHistory.map(normaliseForm) : [],
        records: Array.isArray(c.records) ? c.records : [],
        caseCounter: c.caseCounter || 0,
        // Re-audit cycle metadata: frozen criteria, how the cycle was created and why.
        criteriaSnapshot: Array.isArray(c.criteriaSnapshot) ? c.criteriaSnapshot : null,
        createdFrom: c.createdFrom || null,
        note: c.note || '',
        createdAt: c.createdAt || c.startedAt || out.createdAt,
        updatedAt: c.updatedAt || c.startedAt || out.updatedAt
      };
    });
    // Mirrors of the documented cycle structure (auditId, cycleNumber, title, startDate, endDate, formDefinitionId).
    out.cycles.forEach(function (c) { describeCycle(out, c); });
    const cur = out.cycles[out.cycles.length - 1];
    cur.status = out.status;
    cur.completedAt = out.completedAt;
    if (Array.isArray(src.cases) && src.cases.length && !cur.records.length) migrateLegacyCases(out, cur, src.cases);
  }

  function describeCycle(audit, c) {
    c.auditId = audit.id;
    c.cycleNumber = c.number;
    c.title = c.label;
    c.startDate = c.collectionStartDate || '';
    c.endDate = c.collectionEndDate || '';
    c.formDefinitionId = c.form ? c.form.id : null;
    return c;
  }

  /** Copy a form into a new cycle: new form/field/option IDs, criterion links remapped. */
  function cloneFormForCycle(form, criterionMap) {
    if (!form) return null;
    const now = new Date().toISOString();
    const f = JSON.parse(JSON.stringify(form));
    return {
      id: id('form'), version: 1, createdAt: now, updatedAt: now, copiedFrom: { formId: form.id, version: form.version },
      fields: f.fields.map(function (fld) {
        const copy = duplicateField(fld);
        copy.label = fld.label;
        copy.parentFieldId = fld.id;
        copy.linkedCriterionId = fld.linkedCriterionId ? (criterionMap[fld.linkedCriterionId] || null) : null;
        return copy;
      })
    };
  }

  /* =========================================================
   * CSV export of a cycle's dataset
   * ========================================================= */
  function toCSV(audit, cycle) {
    const c = cycle || currentCycle(audit);
    const form = c.form || { fields: [] };
    const fieldMap = {};
    [form].concat(c.formHistory).forEach(function (f) { (f.fields || []).forEach(function (x) { if (!fieldMap[x.id]) fieldMap[x.id] = x; }); });
    const extra = [];
    c.records.forEach(function (r) { Object.keys(r.responses).forEach(function (k) { if (!form.fields.some(function (x) { return x.id === k; }) && extra.indexOf(k) === -1 && fieldMap[k]) extra.push(k); }); });
    const cols = form.fields.map(function (f) { return f.id; }).concat(extra);
    const head = ['Case reference', 'Collection date', 'Status', 'Form version'].concat(cols.map(function (k) { return fieldMap[k].label; }))
      .concat(audit.criteria.map(function (cr, i) { return 'C' + (i + 1) + ' result: ' + cr.name; }));
    const lab = { met: 'Met', not_met: 'Not met', na: 'N/A' };
    const rows = c.records.map(function (r) {
      const f = formForVersion(c, r.formVersion);
      return [r.caseReference, r.collectionDate, r.status, 'v' + r.formVersion]
        .concat(cols.map(function (k) { const fd = (f.fields.find(function (x) { return x.id === k; })) || fieldMap[k]; return r.responses[k] === undefined ? '' : formatValue(fd, r.responses[k]); }))
        .concat(audit.criteria.map(function (cr) { return r.status === 'completed' ? (lab[(r.results || {})[cr.id]] || '') : ''; }));
    });
    return [head].concat(rows).map(function (row) { return row.map(U.csvCell).join(','); }).join('\n');
  }

  return {
    NA, TYPES, TYPE_ORDER, detectIdentifier, defaults,
    newField, duplicateField, newForm, normaliseForm, normaliseField,
    choiceOptions, optionLabel, isEmpty, initialValue, formatValue,
    validateResponse, validateRecord, validateFieldDef, validateForm,
    evaluate, scoreRecord, answeredCount,
    currentCycle, cycleById, formForVersion, records, completedRecords, hasForm, canCollect, nextCaseReference, statusOf,
    normaliseCycles, legacyForm, cloneFormForCycle, describeCycle, toCSV
  };
})();
