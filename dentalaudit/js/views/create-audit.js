/* DentalAudit — Create / Edit Audit wizard
 *
 * Routes
 *   #/create        new audit (unsaved work is kept in memory and in sessionStorage)
 *   #/create/:id    resume a draft, or edit an existing live audit
 *   #/create?template=bpe   new audit started from a template (used by links from Guide Card)
 *
 * The wizard edits a deep copy of the audit (session.data). Nothing reaches
 * localStorage until the user presses Save as Draft, Create Audit or Save changes.
 */
DA.views.createAudit = (function () {
  const U = DA.utils, ui = DA.ui, store = DA.store, Mo = DA.model, M = DA.metrics;
  const AUTOSAVE_KEY = 'dentalaudit.v1.wizard';

  const STEPS = [
    { n: 1, label: 'Audit overview', hint: 'Title, type, team and timeline' },
    { n: 2, label: 'Aims & objectives', hint: 'Question, rationale and aims' },
    { n: 3, label: 'Standards & criteria', hint: 'What you will measure' },
    { n: 4, label: 'Methodology', hint: 'Sample and data collection' },
    { n: 5, label: 'Review & create', hint: 'Check and confirm' }
  ];

  let session = null;
  let el = null;

  /* =========================================================
   * Session management
   * ========================================================= */
  function newSession() {
    const data = Mo.blankAudit(store.getSettings());
    data.id = Mo.newId('aud'); // fixed for this wizard run → creating twice can never duplicate
    return { mode: 'new', data: data, step: 1, maxStep: 1, touched: {}, attempted: {}, dirty: false, saving: false, savedAt: null };
  }

  function sessionFor(params) {
    const id = params.id;
    if (id) {
      if (session && session.data.id === id) return session;
      const audit = store.getAudit(id);
      if (!audit) return null;
      const data = Mo.normaliseAudit(Mo.clone(audit));
      ['objectives', 'inclusionCriteria', 'exclusionCriteria'].forEach(function (k) {
        if (!data[k].length) data[k].push(Mo.item('', k.slice(0, 3)));
      });
      session = {
        mode: audit.status === 'draft' ? 'draft' : 'edit', data: data,
        step: Number(params.query && params.query.step) || 1, maxStep: 5,
        touched: {}, attempted: {}, dirty: false, saving: false, savedAt: audit.updatedAt
      };
      return session;
    }
    if (session && session.mode === 'new') return session;
    session = restoreAutosave() || newSession();
    return session;
  }

  function autosave() {
    if (!session || session.mode !== 'new') return;
    try { sessionStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ data: session.data, step: session.step, maxStep: session.maxStep })); } catch (e) { /* private mode */ }
  }
  const autosaveSoon = U.debounce(autosave, 300);

  function restoreAutosave() {
    try {
      const raw = sessionStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved.data || store.getAudit(saved.data.id)) { clearAutosave(); return null; }
      return { mode: 'new', data: Mo.normaliseAudit(saved.data), step: saved.step || 1, maxStep: saved.maxStep || 1, touched: {}, attempted: {}, dirty: true, saving: false, savedAt: null, restored: true };
    } catch (e) { return null; }
  }

  function clearAutosave() { try { sessionStorage.removeItem(AUTOSAVE_KEY); } catch (e) { /* ignore */ } }

  function endSession() { session = null; clearAutosave(); }

  function markDirty() {
    session.dirty = true;
    autosaveSoon();
    paintSaveState();
  }

  window.addEventListener('beforeunload', function (e) {
    // New audits survive a refresh via sessionStorage; drafts/edits would lose unsaved changes.
    if (session && session.dirty && session.mode !== 'new' && /^#\/create/.test(location.hash)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* =========================================================
   * Validation helpers
   * ========================================================= */
  function errors() { return Mo.validate(session.data); }

  function visibleError(step, field) {
    const e = errors()[step][field];
    if (!e) return '';
    return session.touched[field] || session.attempted[step] ? e : '';
  }

  function stepHasErrors(step, errs) {
    return Object.keys((errs || errors())[step] || {}).length > 0;
  }

  /* =========================================================
   * Small render helpers
   * ========================================================= */
  const d = function () { return session.data; };

  function field(opts) {
    const err = visibleError(opts.step, opts.name);
    return '<div class="field' + (err ? ' has-error' : '') + (opts.cls ? ' ' + opts.cls : '') + '" data-field="' + opts.name + '" data-step="' + opts.step + '">' +
      '<label class="field__label" for="f-' + opts.name + '">' + opts.label + (opts.required ? ' <span class="req" aria-hidden="true">*</span>' : '') + '</label>' +
      opts.control +
      (opts.hint ? '<span class="field__hint">' + opts.hint + '</span>' : '') +
      '<span class="field__error" role="alert">' + U.esc(err) + '</span>' +
    '</div>';
  }

  function input(name, attrs) {
    const a = attrs || {};
    return '<input class="input" id="f-' + name + '" data-bind="' + name + '" type="' + (a.type || 'text') + '"' +
      ' value="' + U.esc(d()[name]) + '"' + (a.placeholder ? ' placeholder="' + U.esc(a.placeholder) + '"' : '') +
      (a.min !== undefined ? ' min="' + a.min + '"' : '') + (a.max !== undefined ? ' max="' + a.max + '"' : '') +
      (a.required ? ' aria-required="true"' : '') + (a.list ? ' list="' + a.list + '"' : '') + ' autocomplete="off">';
  }

  function textarea(name, placeholder, rows) {
    return '<textarea class="textarea" id="f-' + name + '" data-bind="' + name + '" rows="' + (rows || 3) + '" placeholder="' + U.esc(placeholder || '') + '">' + U.esc(d()[name]) + '</textarea>';
  }

  function select(name, options, placeholder) {
    return '<select class="select" id="f-' + name + '" data-bind="' + name + '">' +
      '<option value="">' + U.esc(placeholder || 'Select…') + '</option>' +
      options.map(function (o) { return '<option' + (d()[name] === o ? ' selected' : '') + '>' + U.esc(o) + '</option>'; }).join('') +
    '</select>';
  }

  /** Repeating text rows with stable IDs: objectives, inclusion/exclusion criteria, collaborators. */
  function listEditor(key, prop, placeholder, addLabel, numbered) {
    const rows = d()[key];
    return '<div class="list-editor" data-list="' + key + '">' +
      (rows.length ? rows.map(function (r, i) {
        return '<div class="list-editor__row">' +
          (numbered ? '<span class="list-editor__num">' + (i + 1) + '</span>' : '<span class="list-editor__bullet" aria-hidden="true"></span>') +
          '<input class="input" data-list-key="' + key + '" data-list-id="' + r.id + '" data-list-prop="' + prop + '" value="' + U.esc(r[prop]) + '" placeholder="' + U.esc(placeholder) + '" aria-label="' + U.esc(addLabel.replace('Add ', '')) + ' ' + (i + 1) + '">' +
          '<button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-list-remove="' + key + '" data-id="' + r.id + '" aria-label="Remove ' + (i + 1) + '">' + ui.icon('x', 15) + '</button>' +
        '</div>';
      }).join('') : '<p class="list-editor__empty">None added yet.</p>') +
      '<button type="button" class="btn btn--ghost btn--sm list-editor__add" data-list-add="' + key + '" data-prop="' + prop + '">' + ui.icon('plus', 15) + U.esc(addLabel) + '</button>' +
    '</div>';
  }

  function group(title, sub, body) {
    return '<section class="fgroup"><header class="fgroup__head"><h3>' + title + '</h3>' + (sub ? '<p>' + sub + '</p>' : '') + '</header><div class="fgroup__body">' + body + '</div></section>';
  }

  /* =========================================================
   * Step 1 — Audit overview
   * ========================================================= */
  function step1() {
    const types = Mo.PROJECT_TYPES.map(function (t) {
      const desc = {
        'Clinical Audit': 'Measures practice against an agreed standard',
        'Quality Improvement Project': 'Tests changes to improve a process or outcome',
        'Service Evaluation': 'Describes current service without a standard'
      }[t];
      return '<label class="radio-card' + (d().projectType === t ? ' is-checked' : '') + '">' +
        '<input type="radio" name="projectType" value="' + t + '" data-bind="projectType"' + (d().projectType === t ? ' checked' : '') + '>' +
        '<span class="radio-card__title">' + t + '</span><span class="radio-card__desc">' + desc + '</span></label>';
    }).join('');

    return intro('Audit overview', 'Start with the essentials. Fields marked * are required to create the audit.',
        session.mode !== 'edit' ? '<button type="button" class="btn btn--secondary btn--sm" data-action="template">' + ui.icon('file', 15) + 'Start from a template</button>' : '') +
      group('Project', 'What is being audited?',
        field({ step: 1, name: 'title', label: 'Audit title', required: true, control: input('title', { placeholder: 'e.g. Documentation of implant crown screw torque', required: true }) }) +
        field({ step: 1, name: 'description', label: 'Description', hint: 'A one or two sentence summary shown on the audit overview.', control: textarea('description', 'Briefly describe the scope of this audit…', 2) }) +
        field({ step: 1, name: 'projectType', label: 'Project type', required: true, control: '<div class="radio-cards" role="radiogroup" aria-label="Project type">' + types + '</div>' }) +
        '<div class="grid-2">' +
          field({ step: 1, name: 'specialty', label: 'Dental specialty', required: true, control: select('specialty', Mo.SPECIALTIES, 'Select a specialty…') }) +
          field({ step: 1, name: 'department', label: 'Department / hospital / practice', required: true, control: input('department', { placeholder: 'e.g. Restorative Dentistry, Glasgow Dental Hospital', required: true }) }) +
        '</div>') +
      group('Team', 'Who is leading and contributing?',
        field({ step: 1, name: 'auditLead', label: 'Audit lead', required: true, control: input('auditLead', { placeholder: 'Full name', required: true }) }) +
        field({ step: 1, name: 'collaborators', label: 'Collaborating clinicians', hint: 'Optional — include grade or role if helpful.', control: listEditor('collaborators', 'name', 'e.g. Dr A. Smith, Specialty Registrar', 'Add collaborator') })) +
      group('Timeline', 'Overall project dates. Data collection dates are set in Methodology.',
        '<div class="grid-2">' +
          field({ step: 1, name: 'startDate', label: 'Audit start date', required: true, control: input('startDate', { type: 'date' }) }) +
          field({ step: 1, name: 'targetCompletionDate', label: 'Target completion date', required: true, control: input('targetCompletionDate', { type: 'date' }) }) +
        '</div>');
  }

  /* =========================================================
   * Step 2 — Aims and objectives
   * ========================================================= */
  function step2() {
    return intro('Aims and objectives', 'Explain why the audit matters and what it sets out to achieve.') +
      '<section class="question-card">' +
        '<div class="question-card__icon">' + ui.icon('search', 18) + '</div>' +
        '<div class="question-card__body">' +
          field({ step: 2, name: 'auditQuestion', label: 'Audit question / clinical problem', hint: 'A single, answerable question focuses the whole audit.',
            control: textarea('auditQuestion', 'e.g. Is the tightening torque recorded when implant crowns are fitted?', 2) }) +
        '</div>' +
      '</section>' +
      group('Rationale', null,
        field({ step: 2, name: 'background', label: 'Background / rationale', hint: 'Why now? Include incidents, complaints, guidance changes or previous findings.',
          control: textarea('background', 'e.g. Screw loosening was reported in several recent implant reviews, and torque values were often missing from the notes…', 4) })) +
      group('Aims', null,
        field({ step: 2, name: 'aim', label: 'Overall aim', required: true, control: textarea('aim', 'e.g. To ensure implant crown torque is documented at every fit appointment.', 2) }) +
        field({ step: 2, name: 'objectives', label: 'Specific objectives', hint: 'Short, measurable statements. Add as many as you need.',
          control: listEditor('objectives', 'text', 'e.g. Measure current documentation rates against the local protocol', 'Add objective', true) }));
  }

  /* =========================================================
   * Step 3 — Standards and criteria
   * ========================================================= */
  function criteriaTable(editable) {
    const list = d().criteria;
    if (!list.length) {
      return '<div class="crit-empty">' +
        '<div class="empty__icon">' + ui.icon('target', 22) + '</div>' +
        '<h4>No criteria yet</h4>' +
        '<p class="muted small">Criteria are the measurable standards each case is checked against — e.g. “Implant crown torque documented”, target 100%.</p>' +
        (editable ? '<div class="crit-empty__actions"><button type="button" class="btn btn--primary btn--sm" data-action="add-criterion">' + ui.icon('plus', 15) + 'Add first criterion</button>' +
          '<button type="button" class="btn btn--secondary btn--sm" data-action="import-criteria">' + ui.icon('file', 15) + 'Import from template</button></div>' : '') +
      '</div>';
    }
    return '<div class="crit-table" role="table" aria-label="Audit criteria">' +
      '<div class="crit-table__head" role="row"><span role="columnheader">#</span><span role="columnheader">Criterion</span><span role="columnheader">Reference</span><span role="columnheader">Target</span><span role="columnheader">Measurement</span>' + (editable ? '<span role="columnheader"><span class="sr-only">Actions</span></span>' : '') + '</div>' +
      list.map(function (c, i) {
        const incomplete = Object.keys(Mo.criterionErrors(c)).length > 0;
        return '<div class="crit-table__row' + (incomplete ? ' is-incomplete' : '') + '" role="row" data-crit-row="' + c.id + '">' +
          '<span class="crit-table__order" role="cell">' +
            (editable ? '<button type="button" class="icon-btn icon-btn--xs" data-move="up" data-id="' + c.id + '" aria-label="Move criterion ' + (i + 1) + ' up"' + (i === 0 ? ' disabled' : '') + '>' + ui.icon('chevronUp', 14) + '</button>' : '') +
            '<span class="crit-table__num">' + (i + 1) + '</span>' +
            (editable ? '<button type="button" class="icon-btn icon-btn--xs" data-move="down" data-id="' + c.id + '" aria-label="Move criterion ' + (i + 1) + ' down"' + (i === list.length - 1 ? ' disabled' : '') + '>' + ui.icon('chevronDown', 14) + '</button>' : '') +
          '</span>' +
          '<span class="crit-table__main" role="cell"><span class="crit-table__name">' + U.esc(c.name || 'Untitled criterion') + '</span>' +
            (c.description ? '<span class="crit-table__desc">' + U.esc(c.description) + '</span>' : '') +
            (incomplete ? '<span class="badge badge--red crit-table__flag">' + ui.icon('alert', 12) + 'Incomplete</span>' : '') + '</span>' +
          '<span class="crit-table__ref" role="cell" data-label="Reference">' + (c.reference ? U.esc(c.reference) : '<span class="muted">—</span>') + '</span>' +
          '<span class="crit-table__target" role="cell" data-label="Target"><span class="badge badge--blue">' + (c.target === '' ? '—' : Number(c.target) + '%') + '</span></span>' +
          '<span class="crit-table__measure" role="cell" data-label="Measurement"><span>' + U.esc(c.measurementMethod || '—') + '</span>' +
            (c.numerator || c.denominator ? '<span class="frac"><span title="Numerator">' + U.esc(c.numerator || '—') + '</span><span title="Denominator">' + U.esc(c.denominator || '—') + '</span></span>' : '') + '</span>' +
          (editable ? '<span class="crit-table__actions" role="cell">' +
            '<button type="button" class="icon-btn icon-btn--sm" data-edit-crit="' + c.id + '" aria-label="Edit criterion ' + (i + 1) + '" title="Edit">' + ui.icon('collect', 15) + '</button>' +
            '<button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-del-crit="' + c.id + '" aria-label="Delete criterion ' + (i + 1) + '" title="Delete">' + ui.icon('trash', 15) + '</button>' +
          '</span>' : '') +
        '</div>';
      }).join('') +
    '</div>';
  }

  function step3() {
    const errs = errors()[3];
    const show = session.attempted[3];
    const msgs = show ? Object.keys(errs).map(function (k) { return errs[k]; }) : [];
    const n = d().criteria.length;
    return intro('Standards and criteria', 'Each criterion is a measurable standard. During data collection every case is marked Met, Not met or N/A against it.',
        n ? '<div class="intro__actions"><button type="button" class="btn btn--secondary btn--sm" data-action="import-criteria">' + ui.icon('file', 15) + 'Import from template</button>' +
          '<button type="button" class="btn btn--primary btn--sm" data-action="add-criterion">' + ui.icon('plus', 15) + 'Add criterion</button></div>' : '') +
      (msgs.length ? '<div class="alert alert--error" role="alert">' + ui.icon('alert', 16) + '<div><strong>Criteria need attention</strong><ul>' + msgs.map(function (m) { return '<li>' + U.esc(m) + '</li>'; }).join('') + '</ul></div></div>' : '') +
      (n ? '<p class="crit-count">' + n + ' criteri' + (n === 1 ? 'on' : 'a') + ' · use the arrows to reorder</p>' : '') +
      criteriaTable(true);
  }

  /** Add / edit one criterion in a modal. */
  function editCriterion(id) {
    const existing = id ? d().criteria.find(function (c) { return c.id === id; }) : null;
    const c = existing ? Mo.clone(existing) : Mo.blankCriterion(store.getSettings().defaultTarget);
    const refs = [];
    d().criteria.forEach(function (x) { if (x.reference && refs.indexOf(x.reference) === -1) refs.push(x.reference); });
    DA.templates.forEach(function (t) { t.criteria.forEach(function (x) { if (refs.indexOf(x.reference) === -1) refs.push(x.reference); }); });

    function f(name, label, control, required, hint) {
      return '<div class="field" data-cfield="' + name + '"><label class="field__label" for="c-' + name + '">' + label + (required ? ' <span class="req">*</span>' : '') + '</label>' + control +
        (hint ? '<span class="field__hint">' + hint + '</span>' : '') + '<span class="field__error"></span></div>';
    }
    function inp(name, ph, extra) {
      return '<input class="input" id="c-' + name + '" name="' + name + '" value="' + U.esc(c[name]) + '" placeholder="' + U.esc(ph) + '"' + (extra || '') + ' autocomplete="off">';
    }

    ui.modal({
      title: existing ? 'Edit criterion' : 'Add criterion',
      subtitle: 'A measurable standard each case will be checked against.',
      size: 'wide',
      confirmLabel: existing ? 'Save criterion' : 'Add criterion',
      body:
        f('name', 'Criterion name', inp('name', 'e.g. Appropriate documentation of implant crown torque'), true) +
        f('description', 'Detailed description', '<textarea class="textarea" id="c-description" name="description" rows="2" placeholder="e.g. Implant crown tightening torque should be documented in the clinical record.">' + U.esc(c.description) + '</textarea>') +
        '<div class="grid-crit">' +
          f('reference', 'Reference source / guideline', inp('reference', 'e.g. Local implant restorative protocol', ' list="ref-list"'), true) +
          f('target', 'Target compliance', '<div class="input-suffix"><input class="input" id="c-target" name="target" type="number" min="0" max="100" step="1" value="' + U.esc(c.target) + '"><span>%</span></div>', true) +
        '</div>' +
        '<datalist id="ref-list">' + refs.map(function (r) { return '<option value="' + U.esc(r) + '">'; }).join('') + '</datalist>' +
        f('measurementMethod', 'Measurement method', inp('measurementMethod', 'e.g. Clinical record review', ' list="mm-list"'), true, 'How each case will be assessed.') +
        '<datalist id="mm-list">' + Mo.MEASUREMENT_METHODS.map(function (m) { return '<option value="' + m + '">'; }).join('') + '</datalist>' +
        '<div class="frac-fields">' +
          f('numerator', 'Numerator definition', inp('numerator', 'e.g. Implant crown fits with torque value recorded'), true, 'Cases that meet the criterion.') +
          f('denominator', 'Denominator definition', inp('denominator', 'e.g. All implant crown fit appointments'), true, 'All eligible cases (N/A excluded).') +
        '</div>' +
        '<p class="formula">' + ui.icon('target', 14) + '<span>Compliance = <strong>numerator</strong> ÷ <strong>denominator</strong> × 100</span></p>',
      onConfirm: function (form) {
        const draft = Object.assign({}, c);
        ['name', 'description', 'reference', 'measurementMethod', 'numerator', 'denominator'].forEach(function (k) { draft[k] = form.elements[k].value.trim(); });
        draft.target = form.elements.target.value === '' ? '' : Number(form.elements.target.value);
        const errs = Mo.criterionErrors(draft);
        form.querySelectorAll('[data-cfield]').forEach(function (w) {
          const e = errs[w.dataset.cfield];
          w.classList.toggle('has-error', !!e);
          w.querySelector('.field__error').textContent = e || '';
        });
        if (Object.keys(errs).length) {
          const first = form.querySelector('.has-error input, .has-error textarea');
          if (first) first.focus();
          return false;
        }
        if (existing) Object.assign(existing, draft);
        else d().criteria.push(draft);
        markDirty();
        renderStep();
        ui.toast(existing ? 'Criterion updated' : 'Criterion added', 'success');
      },
      onOpen: function (form) {
        form.addEventListener('input', function (e) {
          const w = e.target.closest('[data-cfield]');
          if (w && w.classList.contains('has-error')) { w.classList.remove('has-error'); w.querySelector('.field__error').textContent = ''; }
        });
      }
    });
  }

  function deleteCriterion(id) {
    const c = d().criteria.find(function (x) { return x.id === id; });
    if (!c) return;
    const live = session.mode === 'edit' ? store.getAudit(d().id) : null;
    const recorded = live ? DA.collection.completedRecords(live).filter(function (cs) { return cs.results && cs.results[id]; }).length : 0;
    ui.confirm({
      title: 'Delete criterion?',
      message: recorded
        ? '“' + c.name + '” has results recorded for ' + recorded + ' cases. Those cases are kept, but this criterion will no longer be analysed and any form fields linked to it will be unlinked.'
        : '“' + (c.name || 'Untitled criterion') + '” will be removed from this audit.',
      confirmLabel: 'Delete criterion', danger: true,
      onConfirm: function () {
        d().criteria = d().criteria.filter(function (x) { return x.id !== id; });
        markDirty();
        renderStep();
      }
    });
  }

  function moveCriterion(id, dir) {
    const list = d().criteria;
    const i = list.findIndex(function (c) { return c.id === id; });
    const j = dir === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= list.length) return;
    const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    markDirty();
    renderStep();
    const btn = el.querySelector('[data-move="' + dir + '"][data-id="' + id + '"]');
    (btn && !btn.disabled ? btn : el.querySelector('[data-edit-crit="' + id + '"]')).focus();
  }

  /** Template picker. criteriaOnly → only appends criteria. */
  function pickTemplate(criteriaOnly) {
    ui.modal({
      title: criteriaOnly ? 'Import criteria from a template' : 'Start from a template',
      subtitle: criteriaOnly ? 'Template criteria are added to your list; nothing is replaced.' : 'Fills empty fields and adds the template’s criteria. Anything you have typed is kept.',
      size: 'wide',
      confirmLabel: criteriaOnly ? 'Import criteria' : 'Use template',
      body: '<div class="tpl-list" role="radiogroup">' + DA.templates.map(function (t, i) {
        return '<label class="tpl-option"><input type="radio" name="tpl" value="' + t.key + '"' + (i === 0 ? ' checked' : '') + '>' +
          '<span class="tpl-option__body"><span class="tpl-option__title">' + U.esc(t.title) + '</span>' +
          '<span class="tpl-option__meta">' + U.esc(t.specialty) + ' · ' + t.criteria.length + ' criteria · ' + U.esc(t.criteria[0].reference) + '</span></span></label>';
      }).join('') + '</div>',
      onConfirm: function (form) {
        const key = form.querySelector('input[name=tpl]:checked').value;
        applyTemplate(DA.templates.find(function (t) { return t.key === key; }), criteriaOnly);
      }
    });
  }

  function applyTemplate(t, criteriaOnly) {
    const a = d();
    if (!criteriaOnly) {
      ['title', 'specialty', 'projectType', 'background', 'auditQuestion', 'aim'].forEach(function (k) {
        if (!String(a[k] || '').trim() && t[k]) a[k] = t[k];
      });
      if (!a.department.trim()) a.department = t.department;
    }
    const taken = new Set(a.criteria.map(function (c) { return c.id; }));
    const existingNames = a.criteria.map(function (c) { return c.name.trim().toLowerCase(); });
    let added = 0;
    t.criteria.forEach(function (c) {
      if (existingNames.indexOf(c.name.trim().toLowerCase()) !== -1) return; // don't import the same criterion twice
      a.criteria.push(Object.assign(Mo.blankCriterion(), c, { id: Mo.newId('crit', taken) }));
      added++;
    });
    markDirty();
    renderStep();
    ui.toast(added ? 'Added ' + added + ' criteria from template' : 'Template applied — criteria were already present', 'success');
  }

  /* =========================================================
   * Step 4 — Methodology
   * ========================================================= */
  function step4() {
    const methods = Mo.COLLECTION_METHODS.map(function (m) {
      const on = d().collectionMethods.indexOf(m) !== -1;
      return '<label class="check-chip' + (on ? ' is-checked' : '') + '"><input type="checkbox" value="' + m + '" data-bind-multi="collectionMethods"' + (on ? ' checked' : '') + '>' +
        '<span class="check-chip__box">' + ui.icon('check', 11) + '</span>' + m + '</label>';
    }).join('');
    const showOtherSampling = d().samplingMethod === 'Other';
    const showOtherCollection = d().collectionMethods.indexOf('Other') !== -1;
    return intro('Methodology', 'Define who is included and how the data will be gathered.') +
      group('Study design', null,
        field({ step: 4, name: 'methodology', label: 'Study design / methodology', hint: 'e.g. retrospective record review, prospective data collection, mixed methods.',
          control: textarea('methodology', 'e.g. Retrospective review of consecutive clinical records against pre-defined criteria using a standard proforma.', 3) })) +
      group('Population', 'Who is eligible for the sample?',
        '<div class="grid-2 grid-2--top">' +
          field({ step: 4, name: 'inclusionCriteria', label: 'Inclusion criteria', control: listEditor('inclusionCriteria', 'text', 'e.g. Single implant crowns fitted Jan–Mar', 'Add inclusion criterion') }) +
          field({ step: 4, name: 'exclusionCriteria', label: 'Exclusion criteria', control: listEditor('exclusionCriteria', 'text', 'e.g. Cement-retained restorations', 'Add exclusion criterion') }) +
        '</div>') +
      group('Sample', null,
        '<div class="grid-2 grid-2--top">' +
          field({ step: 4, name: 'targetSampleSize', label: 'Target sample size', required: true, hint: 'Number of cases. 30–50 is typical for a record audit.', control: '<div class="input-suffix">' + input('targetSampleSize', { type: 'number', min: 1, max: 10000, placeholder: 'e.g. 40' }) + '<span>cases</span></div>' }) +
          field({ step: 4, name: 'samplingMethod', label: 'Sampling method', required: true, control: select('samplingMethod', Mo.SAMPLING_METHODS, 'Select a method…') }) +
        '</div>' +
        (showOtherSampling ? field({ step: 4, name: 'samplingOther', label: 'Describe sampling method', required: true, control: input('samplingOther', { placeholder: 'e.g. Every third patient on the clinic list' }) }) : '')) +
      group('Data collection', null,
        '<div class="grid-2">' +
          field({ step: 4, name: 'collectionStartDate', label: 'Data collection start', required: true, control: input('collectionStartDate', { type: 'date' }) }) +
          field({ step: 4, name: 'collectionEndDate', label: 'Data collection end', required: true, control: input('collectionEndDate', { type: 'date' }) }) +
        '</div>' +
        field({ step: 4, name: 'collectionMethods', label: 'Data collection method', required: true, hint: 'Select all that apply.', control: '<div class="check-chips" role="group" aria-label="Data collection methods">' + methods + '</div>' }) +
        (showOtherCollection ? field({ step: 4, name: 'collectionOther', label: 'Other data source', required: true, control: input('collectionOther', { placeholder: 'e.g. Laboratory prescription forms' }) }) : ''));
  }

  /* =========================================================
   * Step 5 — Review and create
   * ========================================================= */
  function rv(label, value) {
    const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length);
    let html;
    if (empty) html = '<span class="muted">Not provided</span>';
    else if (Array.isArray(value)) html = '<ul class="rv-list">' + value.map(function (v) { return '<li>' + U.esc(v) + '</li>'; }).join('') + '</ul>';
    else html = U.esc(value);
    return '<dt>' + label + '</dt><dd>' + html + '</dd>';
  }

  function reviewSection(step, title, body, errs) {
    const n = Object.keys(errs[step] || {}).length;
    return '<section class="rv">' +
      '<header class="rv__head"><div class="rv__title"><span class="rv__num">' + step + '</span><h3>' + title + '</h3>' +
        (n ? '<span class="badge badge--red">' + ui.icon('alert', 12) + n + ' to fix</span>' : '<span class="badge badge--green">' + ui.icon('check', 12) + 'Complete</span>') + '</div>' +
      '<button type="button" class="btn btn--ghost btn--sm" data-goto="' + step + '">' + ui.icon('collect', 14) + 'Edit</button></header>' +
      '<div class="rv__body">' + body + '</div></section>';
  }

  function step5() {
    const a = d();
    const errs = errors();
    const total = Mo.errorCount(errs);
    const texts = function (list, k) { return Mo.filled(list, k || 'text').map(function (x) { return x[k || 'text']; }); };
    const issues = [];
    [1, 2, 3, 4].forEach(function (s) {
      Object.keys(errs[s]).forEach(function (k) { issues.push({ step: s, msg: errs[s][k] }); });
    });

    return intro(session.mode === 'edit' ? 'Review changes' : 'Review and create', session.mode === 'edit'
        ? 'Check your changes, then save. Recorded cases and action plans are kept.'
        : 'Check everything below. Creating the audit sets it to Active, Cycle 1, ready for data collection.') +
      (total
        ? '<div class="alert alert--error" role="alert">' + ui.icon('alert', 16) + '<div><strong>' + total + ' item' + (total === 1 ? '' : 's') + ' need' + (total === 1 ? 's' : '') + ' attention before you can ' + (session.mode === 'edit' ? 'save' : 'create this audit') + '.</strong>' +
            '<ul>' + issues.slice(0, 6).map(function (i) { return '<li><button type="button" class="link-btn" data-goto="' + i.step + '">Step ' + i.step + '</button> — ' + U.esc(i.msg) + '</li>'; }).join('') +
            (issues.length > 6 ? '<li>…and ' + (issues.length - 6) + ' more</li>' : '') + '</ul>' +
            '<p class="small">You can still save your progress as a draft.</p></div></div>'
        : '<div class="alert alert--good">' + ui.icon('check', 16) + '<div><strong>Everything required is complete.</strong> ' + (session.mode === 'edit' ? 'Save your changes when ready.' : 'Your audit is ready to create.') + '</div></div>') +

      reviewSection(1, 'Audit overview', '<dl class="rv-grid">' +
        rv('Title', a.title) + rv('Project type', a.projectType) + rv('Specialty', a.specialty) +
        rv('Department / setting', a.department) + rv('Audit lead', a.auditLead) +
        rv('Collaborators', texts(a.collaborators, 'name')) +
        rv('Timeline', a.startDate || a.targetCompletionDate ? U.fmtDate(a.startDate) + ' → ' + U.fmtDate(a.targetCompletionDate) : '') +
        '</dl>' + (a.description ? '<p class="rv__para">' + U.esc(a.description) + '</p>' : ''), errs) +

      reviewSection(2, 'Aims and objectives', '<dl class="rv-grid rv-grid--wide">' +
        rv('Audit question', a.auditQuestion) + rv('Background', a.background) + rv('Overall aim', a.aim) + rv('Objectives', texts(a.objectives)) +
        '</dl>', errs) +

      reviewSection(3, 'Standards and criteria · ' + a.criteria.length, criteriaTable(false), errs) +

      reviewSection(4, 'Methodology', '<dl class="rv-grid">' +
        rv('Study design', a.methodology) +
        rv('Sample', a.targetSampleSize ? a.targetSampleSize + ' cases' : '') +
        rv('Sampling method', Mo.samplingText(a)) +
        rv('Data collection', a.collectionStartDate || a.collectionEndDate ? U.fmtDate(a.collectionStartDate) + ' → ' + U.fmtDate(a.collectionEndDate) : '') +
        rv('Collection methods', Mo.collectionMethodsText(a)) +
        rv('Inclusion criteria', texts(a.inclusionCriteria)) +
        rv('Exclusion criteria', texts(a.exclusionCriteria)) +
        '</dl>', errs);
  }

  /* =========================================================
   * Page frame
   * ========================================================= */
  function intro(title, text, actions) {
    return '<div class="intro"><div><h2 class="intro__title">' + title + '</h2><p class="intro__text">' + text + '</p></div>' + (actions || '') + '</div>';
  }

  function saveStateText() {
    if (session.saving) return 'Saving…';
    if (session.dirty) return session.mode === 'new' ? 'Not saved yet' : 'Unsaved changes';
    if (session.savedAt) return (session.mode === 'edit' ? 'Last saved ' : 'Draft saved ') + U.relTime(session.savedAt);
    return 'Not saved yet';
  }

  function paintSaveState() {
    const n = el && el.querySelector('#wiz-save-state');
    if (!n) return;
    n.textContent = saveStateText();
    n.parentElement.classList.toggle('is-dirty', !!session.dirty);
  }

  function heading() {
    if (session.mode === 'edit') return 'Edit Audit';
    return 'Create New Audit';
  }

  function stepsNav() {
    const errs = errors();
    return '<ol class="wsteps" aria-label="Wizard progress">' + STEPS.map(function (s) {
      const reachable = session.mode !== 'new' || s.n <= session.maxStep;
      const isCur = s.n === session.step;
      const bad = s.n < 5 && session.attempted[s.n] && stepHasErrors(s.n, errs);
      const done = !isCur && !bad && s.n < 5 && (s.n < session.maxStep || session.mode !== 'new') && !stepHasErrors(s.n, errs);
      const state = isCur ? 'current' : bad ? 'error' : done ? 'done' : 'todo';
      return '<li class="wstep wstep--' + state + '">' +
        '<button type="button" data-goto="' + s.n + '"' + (reachable ? '' : ' disabled') + (isCur ? ' aria-current="step"' : '') + '>' +
          '<span class="wstep__dot">' + (state === 'done' ? ui.icon('check', 12) : state === 'error' ? '!' : s.n) + '</span>' +
          '<span class="wstep__text"><span class="wstep__label">' + s.label + '</span><span class="wstep__hint">' + s.hint + '</span></span>' +
        '</button></li>';
    }).join('') + '</ol>';
  }

  function footer() {
    const last = session.step === 5;
    const back = '<button type="button" class="btn btn--secondary" data-action="back"' + (session.step === 1 ? ' disabled' : '') + '>' + ui.icon('chevronLeft', 15) + 'Back</button>';
    if (!last) {
      return '<div class="wiz__foot">' + back +
        '<span class="wiz__pos">Step ' + session.step + ' of 5</span>' +
        '<button type="button" class="btn btn--primary" data-action="next">Continue' + ui.icon('chevronRight', 15) + '</button></div>';
    }
    const primary = session.mode === 'edit'
      ? '<button type="button" class="btn btn--primary" data-action="save-edit"' + (session.saving ? ' disabled' : '') + '>' + ui.icon('check', 15) + 'Save changes</button>'
      : '<button type="button" class="btn btn--primary" data-action="create"' + (session.saving ? ' disabled' : '') + '>' + ui.icon('check', 15) + (session.saving ? 'Creating…' : 'Create Audit') + '</button>';
    return '<div class="wiz__foot wiz__foot--final">' + back +
      '<div class="wiz__final-actions">' +
        '<button type="button" class="btn btn--ghost" data-action="cancel">Cancel</button>' +
        (session.mode !== 'edit' ? '<button type="button" class="btn btn--secondary" data-action="draft">' + ui.icon('file', 15) + 'Save as Draft</button>' : '') +
        primary +
      '</div></div>';
  }

  function render(target, params) {
    if (!sessionFor(params)) { DA.views.notFound.render(target); return; }
    // Listeners are bound to a fresh wrapper each render so they never leak into other views.
    target.innerHTML = '<div class="wiz-root"></div>';
    el = target.firstChild;

    const sub = session.mode === 'edit'
      ? 'Editing “' + U.esc(store.getAudit(d().id) ? store.getAudit(d().id).title : d().title) + '” · ' + M.statusMeta(d().status).label + ' · Cycle ' + d().cycle
      : session.mode === 'draft' ? 'Resuming draft — continue where you left off' : 'Plan your audit in five steps. Save a draft at any time.';

    el.innerHTML =
      '<div class="page-head wiz-head">' +
        '<div><h2 class="page-head__title">' + heading() + '</h2><p class="page-head__sub">' + sub + '</p></div>' +
        '<div class="page-head__actions">' +
          '<span class="save-state' + (session.dirty ? ' is-dirty' : '') + '"><span class="save-state__dot"></span><span id="wiz-save-state">' + saveStateText() + '</span></span>' +
          '<button type="button" class="btn btn--ghost" data-action="cancel">Cancel</button>' +
          (session.mode === 'edit'
            ? '<button type="button" class="btn btn--primary" data-action="save-edit">' + ui.icon('check', 15) + 'Save changes</button>'
            : '<button type="button" class="btn btn--secondary" data-action="draft">' + ui.icon('file', 15) + 'Save as Draft</button>') +
        '</div>' +
      '</div>' +
      (session.restored ? '<div class="alert alert--info" id="restored-note">' + ui.icon('refresh', 16) + '<div>We restored your unsaved audit from this browser tab. <button type="button" class="link-btn" data-action="discard-restored">Start over instead</button></div></div>' : '') +
      '<div class="wiz2">' +
        '<nav class="wiz2__nav" id="wiz-nav">' + stepsNav() + '</nav>' +
        '<section class="card wiz2__card">' +
          '<div class="wiz2__progress" aria-hidden="true"><span style="width:' + (session.step / 5 * 100) + '%"></span></div>' +
          '<div class="wiz2__body" id="wiz-body"></div>' +
          '<div id="wiz-foot"></div>' +
        '</section>' +
      '</div>';

    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    el.addEventListener('change', onChange);
    el.addEventListener('focusout', onBlur);
    renderStep();
    // #/create?template=<key> (e.g. a link from Guide Card) starts a new audit from that template, once per wizard run
    const tk = params.query && params.query.template;
    if (tk && session.mode === 'new' && session.fromLink !== tk) {
      const t = DA.templates.find(function (x) { return x.key === tk; });
      if (t) { session.fromLink = tk; applyTemplate(t, false); }
    }
  }

  function renderStep() {
    const body = el.querySelector('#wiz-body');
    if (!body) return;
    body.innerHTML = [null, step1, step2, step3, step4, step5][session.step]();
    el.querySelector('#wiz-foot').innerHTML = footer();
    el.querySelector('#wiz-nav').innerHTML = stepsNav();
    el.querySelector('.wiz2__progress span').style.width = (session.step / 5 * 100) + '%';
    paintSaveState();
  }

  /** Update a single field's error in place (keeps focus while typing). */
  function refreshFieldError(name) {
    const w = el.querySelector('[data-field="' + name + '"]');
    if (!w) return;
    const msg = visibleError(Number(w.dataset.step), name);
    w.classList.toggle('has-error', !!msg);
    w.querySelector('.field__error').textContent = msg;
  }

  /* =========================================================
   * Events
   * ========================================================= */
  function onInput(e) {
    const t = e.target;
    if (t.dataset.bind && t.type !== 'radio') {
      d()[t.dataset.bind] = t.value;
      markDirty();
      if (el.querySelector('[data-field="' + t.dataset.bind + '"].has-error')) refreshFieldError(t.dataset.bind);
    } else if (t.dataset.listKey) {
      const row = d()[t.dataset.listKey].find(function (r) { return r.id === t.dataset.listId; });
      if (row) { row[t.dataset.listProp] = t.value; markDirty(); }
    }
  }

  function onChange(e) {
    const t = e.target;
    if (t.type === 'radio' && t.dataset.bind) {
      d()[t.dataset.bind] = t.value;
      session.touched[t.dataset.bind] = true;
      el.querySelectorAll('input[name="' + t.name + '"]').forEach(function (r) { r.closest('.radio-card').classList.toggle('is-checked', r.checked); });
      markDirty();
      refreshFieldError(t.dataset.bind);
    } else if (t.dataset.bindMulti) {
      const k = t.dataset.bindMulti;
      const set = d()[k].filter(function (v) { return v !== t.value; });
      if (t.checked) set.push(t.value);
      d()[k] = Mo.COLLECTION_METHODS.filter(function (m) { return set.indexOf(m) !== -1; });
      session.touched[k] = true;
      markDirty();
      if (t.value === 'Other') renderStep();
      else { t.closest('.check-chip').classList.toggle('is-checked', t.checked); refreshFieldError(k); }
    } else if (t.tagName === 'SELECT' && t.dataset.bind) {
      d()[t.dataset.bind] = t.value;
      session.touched[t.dataset.bind] = true;
      markDirty();
      if (t.dataset.bind === 'samplingMethod') renderStep();
      else refreshFieldError(t.dataset.bind);
    } else if (t.type === 'date' && t.dataset.bind) {
      session.touched[t.dataset.bind] = true;
      refreshFieldError(t.dataset.bind);
      // Date pairs validate against each other.
      ({ startDate: 'targetCompletionDate', targetCompletionDate: 'startDate', collectionStartDate: 'collectionEndDate', collectionEndDate: 'collectionStartDate' }[t.dataset.bind] || '').split(',').forEach(function (n) { if (n && session.touched[n]) refreshFieldError(n); });
    }
  }

  function onBlur(e) {
    const t = e.target;
    if (t.dataset && t.dataset.bind && t.type !== 'radio') {
      session.touched[t.dataset.bind] = true;
      refreshFieldError(t.dataset.bind);
    }
  }

  function onClick(e) {
    const b = e.target.closest('button');
    if (!b || b.disabled || !el.contains(b)) return;

    if (b.dataset.goto) { goTo(Number(b.dataset.goto)); return; }
    if (b.dataset.listAdd) {
      const key = b.dataset.listAdd, prop = b.dataset.prop;
      const row = { id: Mo.newId(key.slice(0, 3)) };
      row[prop] = '';
      d()[key].push(row);
      markDirty();
      renderStep();
      const inp = el.querySelector('[data-list-id="' + row.id + '"]');
      if (inp) inp.focus();
      return;
    }
    if (b.dataset.listRemove) {
      const key = b.dataset.listRemove;
      d()[key] = d()[key].filter(function (r) { return r.id !== b.dataset.id; });
      markDirty();
      renderStep();
      const add = el.querySelector('[data-list-add="' + key + '"]');
      if (add) add.focus();
      return;
    }
    if (b.dataset.editCrit) { editCriterion(b.dataset.editCrit); return; }
    if (b.dataset.delCrit) { deleteCriterion(b.dataset.delCrit); return; }
    if (b.dataset.move) { moveCriterion(b.dataset.id, b.dataset.move); return; }

    switch (b.dataset.action) {
      case 'next': next(); break;
      case 'back': goTo(session.step - 1); break;
      case 'draft': saveDraft(); break;
      case 'create': create(); break;
      case 'save-edit': saveEdit(); break;
      case 'cancel': cancel(); break;
      case 'add-criterion': editCriterion(null); break;
      case 'import-criteria': pickTemplate(true); break;
      case 'template': pickTemplate(false); break;
      case 'discard-restored':
        endSession(); session = newSession(); DA.router.refresh(true); break;
    }
  }

  /* =========================================================
   * Navigation & actions
   * ========================================================= */
  function goTo(n) {
    if (n < 1 || n > 5) return;
    if (session.mode === 'new' && n > session.maxStep) return;
    session.step = n;
    if (session.mode === 'new') autosaveSoon();
    renderStep();
    scrollTop();
  }

  function scrollTop() {
    const main = document.getElementById('main');
    if (main) main.scrollTop = 0;
    const h = el.querySelector('.intro__title');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  function next() {
    const s = session.step;
    session.attempted[s] = true;
    if (s < 5 && stepHasErrors(s)) {
      renderStep();
      const first = el.querySelector('#wiz-body .has-error input, #wiz-body .has-error select, #wiz-body .has-error textarea, #wiz-body .alert--error');
      if (first) { first.focus(); first.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      ui.toast('Please complete the highlighted fields', 'error');
      return;
    }
    session.maxStep = Math.max(session.maxStep, s + 1);
    goTo(s + 1);
  }

  function firstInvalidStep(errs) {
    for (let s = 1; s <= 4; s++) if (stepHasErrors(s, errs)) return s;
    return 0;
  }

  function saveDraft() {
    if (!d().title.trim()) {
      session.attempted[1] = true;
      session.touched.title = true;
      session.step = 1;
      renderStep();
      const t = el.querySelector('#f-title');
      if (t) t.focus();
      ui.toast('Add a title so you can find this draft later', 'error');
      return;
    }
    const wasNew = session.mode === 'new';
    const saved = store.saveDraft(d());
    session.data.id = saved.id;
    session.mode = 'draft';
    session.dirty = false;
    session.savedAt = saved.updatedAt;
    session.restored = false;
    clearAutosave();
    ui.toast('Draft saved', 'success');
    if (wasNew) location.hash = '#/create/' + saved.id; // same session continues under its permanent URL
    else renderStep();
  }

  function create() {
    if (session.saving) return; // guard against double clicks
    const errs = errors();
    if (Mo.errorCount(errs)) {
      [1, 2, 3, 4].forEach(function (s) { session.attempted[s] = true; });
      session.maxStep = 5;
      renderStep();
      ui.toast(Mo.errorCount(errs) + ' required item' + (Mo.errorCount(errs) === 1 ? '' : 's') + ' still to complete', 'error');
      return;
    }
    const title = d().title.trim().toLowerCase();
    const clash = store.getAudits().find(function (a) {
      return a.id !== d().id && a.status !== 'draft' && a.cycle === 1 && a.title.trim().toLowerCase() === title;
    });
    if (clash) {
      ui.confirm({
        title: 'An audit with this title already exists',
        message: '“' + clash.title + '” (' + M.statusMeta(clash.status).label + ', created ' + U.fmtDate(clash.createdAt) + ') already exists. Create a separate audit with the same title anyway? To audit the same standard again, use “Start re-audit” on the existing audit instead.',
        confirmLabel: 'Create anyway',
        onConfirm: doCreate
      });
      return;
    }
    doCreate();
  }

  function doCreate() {
    if (session.saving) return;
    session.saving = true;
    renderStep();
    const res = store.publish(d());
    const id = res.audit.id;
    endSession();
    if (res.duplicate) ui.toast('This audit was already created — opening it', 'info');
    else ui.toast('Audit created · Active · Cycle 1', 'success');
    location.hash = '#/audits/' + id + (res.duplicate ? '' : '?created=1');
  }

  function saveEdit() {
    const errs = errors();
    if (Mo.errorCount(errs)) {
      [1, 2, 3, 4].forEach(function (s) { session.attempted[s] = true; });
      session.step = session.step === 5 ? 5 : firstInvalidStep(errs);
      renderStep();
      ui.toast('Please fix the highlighted items before saving', 'error');
      return;
    }
    const saved = store.saveDefinition(d().id, d());
    endSession();
    ui.toast('Audit updated', 'success');
    location.hash = '#/audits/' + saved.id;
  }

  function cancel() {
    const dest = session.mode === 'edit' ? '#/audits/' + d().id : session.mode === 'draft' ? '#/audits?status=draft' : '#/dashboard';
    if (!session.dirty) { endSession(); location.hash = dest; return; }
    ui.confirm({
      title: session.mode === 'new' ? 'Discard this audit?' : 'Discard unsaved changes?',
      message: session.mode === 'new'
        ? 'Everything you have entered will be lost. Save as Draft instead if you want to come back to it.'
        : 'Changes since you last saved will be lost.' + (session.mode === 'draft' ? ' The previously saved draft is kept.' : ''),
      confirmLabel: 'Discard', danger: true,
      onConfirm: function () { endSession(); location.hash = dest; }
    });
  }

  return {
    nav: 'create',
    keepOnStoreChange: true,
    title: function (p) {
      const a = p && p.id ? store.getAudit(p.id) : null;
      return a && a.status !== 'draft' ? 'Edit Audit' : 'Create New Audit';
    },
    crumbs: function (p) {
      const a = p && p.id ? store.getAudit(p.id) : null;
      if (a && a.status !== 'draft') return [{ label: 'Workspace', href: '#/dashboard' }, { label: 'My Audits', href: '#/audits' }, { label: a.title, href: '#/audits/' + a.id }, { label: 'Edit' }];
      if (a) return [{ label: 'Workspace', href: '#/dashboard' }, { label: 'Drafts', href: '#/audits?status=draft' }, { label: a.title || 'Untitled draft' }];
      return [{ label: 'Workspace', href: '#/dashboard' }, { label: 'Create New Audit' }];
    },
    navFor: function (p) {
      const a = p && p.id ? store.getAudit(p.id) : null;
      return a && a.status !== 'draft' ? 'audits' : 'create';
    },
    render: render,
    hasUnsaved: function () { return !!(session && session.dirty); }
  };
})();
