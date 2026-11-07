/* DentalAudit — Data Collection Form Builder
 * Route: #/collect/:id/form
 *
 * Works on an in-memory copy of the current cycle's form. The selected field is
 * edited as a draft in the settings panel (changes preview live on the canvas) and
 * applied with "Save field". "Save form" writes a new form version to the store.
 */
DA.views.formBuilder = (function () {
  const U = DA.utils, ui = DA.ui, C = DA.collection, store = DA.store;
  const sessions = {};
  let s = null;     // active session
  let el = null;    // wrapper element
  let audit = null;

  /* =========================================================
   * Session
   * ========================================================= */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function savedFields(a) {
    const c = C.currentCycle(a);
    return c && c.form ? clone(c.form.fields) : [];
  }

  function sessionFor(a) {
    const saved = savedFields(a);
    let x = sessions[a.id];
    if (!x || (!isDirty(x) && x.base !== JSON.stringify(saved))) {
      x = sessions[a.id] = { auditId: a.id, fields: saved, base: JSON.stringify(saved), selectedId: null, draft: null, draftDirty: false, errors: {}, formErrors: {}, mode: 'build', preview: null };
    }
    return x;
  }

  function isDirty(x) { return !!x && (x.draftDirty || JSON.stringify(x.fields) !== x.base); }

  function fieldIndex(id) { return s.fields.findIndex(function (f) { return f.id === id; }); }
  function shown(f) { return s.draft && s.draft.id === f.id ? s.draft : f; }
  function criteria() { return audit.criteria; }
  function critName(id) { const c = criteria().find(function (x) { return x.id === id; }); return c ? c.name : null; }

  window.addEventListener('beforeunload', function (e) {
    if (s && isDirty(s) && /^#\/collect\/[^/]+\/form/.test(location.hash)) { e.preventDefault(); e.returnValue = ''; }
  });

  /* =========================================================
   * Rendering — frame
   * ========================================================= */
  function render(target, params) {
    audit = store.getAudit(params.id);
    if (!audit) { DA.views.notFound.render(target); return; }
    const dc = DA.views.dataCollection;
    if (audit.status === 'draft') { dc.draftNotice(target, audit); return; }
    s = sessionFor(audit);
    const readOnly = !C.canCollect(audit);

    target.innerHTML = '<div class="fb-root"></div>';
    el = target.firstChild;
    el.innerHTML = dc.header(audit, 'form', { builderDirty: isDirty(s) }) + '<div id="fb-main"></div>';
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    el.addEventListener('change', onChange);
    bindDrag();
    paint(readOnly);
  }

  function paint(readOnly) {
    const main = el.querySelector('#fb-main');
    const cyc = C.currentCycle(audit);
    const form = cyc.form;
    const recCount = cyc.records.length;
    const dirty = isDirty(s);
    const ro = readOnly === undefined ? !C.canCollect(audit) : readOnly;

    const status = dirty ? '<span class="save-state is-dirty"><span class="save-state__dot"></span>Unsaved changes</span>'
      : form ? '<span class="save-state"><span class="save-state__dot"></span>Version ' + form.version + ' · saved ' + U.relTime(form.updatedAt) + '</span>'
      : '<span class="save-state is-dirty"><span class="save-state__dot"></span>Not saved yet</span>';

    main.innerHTML =
      '<div class="fb-bar">' +
        '<div class="fb-bar__title"><h3>' + (s.mode === 'preview' ? 'Form preview' : 'Collection form') + '</h3>' + status + '</div>' +
        '<div class="fb-bar__actions">' +
          (s.mode === 'preview'
            ? '<button class="btn btn--secondary" data-act="build">' + ui.icon('chevronLeft', 15) + 'Back to builder</button>'
            : '<button class="btn btn--secondary" data-act="preview"' + (s.fields.length ? '' : ' disabled') + '>' + ui.icon('eye', 15) + 'Preview form</button>') +
          (!ro && dirty ? '<button class="btn btn--ghost" data-act="discard">Discard changes</button>' : '') +
          (!ro ? '<button class="btn btn--primary" data-act="save-form">' + ui.icon('save', 15) + 'Save form</button>' : '') +
        '</div>' +
      '</div>' +
      (ro ? '<div class="alert alert--info">' + ui.icon('lockSm', 16) + '<div>This cycle is closed, so its form is read-only. Start a re-audit to collect a new cycle with a copy of this form.</div></div>' : '') +
      (!ro && recCount && form ? '<div class="alert alert--info fb-version-note">' + ui.icon('shield', 16) + '<div><strong>' + recCount + ' case' + (recCount === 1 ? '' : 's') + ' already collected with this form.</strong> Saving creates version ' + (form.version + 1) + '. Existing cases keep their answers and scores; answers to removed fields are retained in each record.</div></div>' : '') +
      (s.formErrors._form ? '<div class="alert alert--error">' + ui.icon('alert', 16) + '<div>' + U.esc(s.formErrors._form) + '</div></div>' : '') +
      (s.mode === 'preview' ? previewHtml() :
        '<div class="fb' + (s.draft ? ' has-selection' : '') + (ro ? ' fb--readonly' : '') + '">' +
          (ro ? '' : '<aside class="fb__lib" aria-label="Field library">' + libraryHtml() + '</aside>') +
          '<section class="fb__canvas" aria-label="Form canvas">' + canvasHtml(ro) + '</section>' +
          (ro ? '' : '<aside class="fb__settings" aria-label="Field settings">' + settingsHtml() + '</aside>') +
        '</div>');

    if (s.mode === 'preview') bindPreview();
    const tabDot = el.querySelector('.dc-tabs [data-tab="form"] .dc-tabs__dot');
    if (tabDot) tabDot.hidden = !dirty;
  }

  /* =========================================================
   * Left — field library
   * ========================================================= */
  function libraryHtml() {
    const unlinked = criteria().filter(function (c) { return !s.fields.some(function (f) { return f.linkedCriterionId === c.id; }); }).length;
    return '<div class="fb-panel__head"><h4>Field library</h4><p>Click to add to the form</p></div>' +
      '<div class="lib">' + C.TYPE_ORDER.map(function (k) {
        const t = C.TYPES[k];
        return '<button type="button" class="lib__item" data-add="' + k + '" title="Add ' + t.label + ' field">' +
          '<span class="lib__icon">' + ui.icon(t.icon, 16) + '</span><span class="lib__text"><span class="lib__label">' + t.label + '</span><span class="lib__hint">' + t.hint + '</span></span>' +
          '<span class="lib__plus">' + ui.icon('plus', 14) + '</span></button>';
      }).join('') + '</div>' +
      (criteria().length ? '<div class="lib__quick"><p>' + ui.icon('target', 13) + (unlinked ? unlinked + ' of ' + criteria().length + ' criteria have no linked field.' : 'Every criterion has a linked field.') + '</p>' +
        (unlinked ? '<button class="btn btn--secondary btn--sm" data-act="from-criteria">Add a Yes / No field for each</button>' : '') + '</div>' : '');
  }

  /* =========================================================
   * Centre — canvas
   * ========================================================= */
  function miniPreview(f) {
    const opts = C.choiceOptions(f);
    switch (f.type) {
      case 'short_text': case 'number': case 'date':
        return '<div class="mini-input">' + U.esc(f.placeholder || (f.type === 'date' ? 'dd/mm/yyyy' : f.type === 'number' ? '0' : 'Short answer')) + (f.type === 'date' ? ui.icon('calendar', 12) : '') + '</div>';
      case 'long_text': return '<div class="mini-input mini-input--tall">' + U.esc(f.placeholder || 'Long answer') + '</div>';
      case 'select': return '<div class="mini-input">' + U.esc(f.placeholder || 'Select…') + ui.icon('chevronDown', 12) + '</div>';
      case 'checkbox': return '<div class="mini-check"><span></span>' + U.esc(f.checkboxLabel || 'Confirmed') + '</div>';
      case 'rating': {
        const pts = [];
        for (let i = Number(f.ratingMin); i <= Number(f.ratingMax) && pts.length < 11; i++) pts.push('<span>' + i + '</span>');
        return '<div class="mini-rating">' + pts.join('') + (f.allowNA ? '<span class="na">N/A</span>' : '') + '</div>';
      }
      default:
        return '<div class="mini-opts mini-opts--' + f.type + '">' + opts.slice(0, 6).map(function (o) {
          let mark = '';
          if (f.linkedCriterionId) {
            if (f.compliantValues.indexOf(o.id) !== -1) mark = ' is-c';
            else if (f.notApplicableValues.indexOf(o.id) !== -1 || o.isNA) mark = ' is-na';
            else mark = ' is-nc';
          }
          return '<span class="mini-opt' + mark + '">' + U.esc(o.label) + '</span>';
        }).join('') + (opts.length > 6 ? '<span class="mini-opt">+' + (opts.length - 6) + '</span>' : '') + '</div>';
    }
  }

  function complianceSummary(f) {
    if (!f.linkedCriterionId) return '';
    if (C.TYPES[f.type].choice) {
      const lab = function (ids) { return ids.map(function (v) { return C.optionLabel(f, v); }).filter(Boolean).join(' / '); };
      const c = lab(f.compliantValues);
      return c ? c + ' = compliant' : 'Compliance not set';
    }
    if (f.type === 'number' || f.type === 'rating') {
      if (f.compliantMin === '' && f.compliantMax === '') return 'Compliant range not set';
      return 'Compliant: ' + (f.compliantMin !== '' ? f.compliantMin : '−∞') + ' to ' + (f.compliantMax !== '' ? f.compliantMax : '∞');
    }
    return 'Any answer = compliant';
  }

  function cardHtml(f, i, ro) {
    const v = shown(f);
    const sel = s.draft && s.draft.id === f.id;
    const err = s.formErrors[f.id];
    const t = C.TYPES[v.type];
    const crit = v.linkedCriterionId ? critName(v.linkedCriterionId) : null;
    return '<div class="fcard' + (sel ? ' is-selected' : '') + (err ? ' has-error' : '') + '" data-fid="' + f.id + '"' + (ro ? '' : ' draggable="true"') + '>' +
      (ro ? '' : '<span class="fcard__grip" title="Drag to reorder" aria-hidden="true">' + ui.icon('grip', 16) + '</span>') +
      '<div class="fcard__body" data-select="' + f.id + '" tabindex="0" role="button" aria-pressed="' + sel + '" aria-label="Edit field ' + (i + 1) + ': ' + U.esc(v.label) + '">' +
        '<div class="fcard__top">' +
          '<span class="fcard__num">' + (i + 1) + '</span>' +
          '<span class="fcard__type">' + ui.icon(t.icon, 12) + t.label + '</span>' +
          (v.required && v.type !== 'checkbox' ? '<span class="fcard__tag">Required</span>' : '') +
          (v.allowNA ? '<span class="fcard__tag">N/A allowed</span>' : '') +
          (sel && s.draftDirty ? '<span class="fcard__tag fcard__tag--dirty">Unsaved</span>' : '') +
          (err ? '<span class="fcard__tag fcard__tag--err">' + ui.icon('alert', 11) + 'Needs attention</span>' : '') +
        '</div>' +
        '<div class="fcard__label">' + U.esc(v.label || 'Untitled field') + '</div>' +
        (v.helperText ? '<div class="fcard__help">' + U.esc(v.helperText) + '</div>' : '') +
        miniPreview(v) +
        (crit ? '<div class="fcard__link">' + ui.icon('target', 12) + '<span><strong>' + U.esc(crit) + '</strong> · ' + U.esc(complianceSummary(v)) + '</span></div>' : '') +
      '</div>' +
      (ro ? '' : '<div class="fcard__actions">' +
        '<button type="button" class="icon-btn icon-btn--sm" data-move="up" data-id="' + f.id + '" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + ' title="Move up">' + ui.icon('chevronUp', 15) + '</button>' +
        '<button type="button" class="icon-btn icon-btn--sm" data-move="down" data-id="' + f.id + '" aria-label="Move down"' + (i === s.fields.length - 1 ? ' disabled' : '') + ' title="Move down">' + ui.icon('chevronDown', 15) + '</button>' +
        '<button type="button" class="icon-btn icon-btn--sm" data-dup="' + f.id + '" aria-label="Duplicate" title="Duplicate">' + ui.icon('copy', 15) + '</button>' +
        '<button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-del="' + f.id + '" aria-label="Delete" title="Delete">' + ui.icon('trash', 15) + '</button>' +
      '</div>') +
    '</div>';
  }

  function canvasHtml(ro) {
    const linked = s.fields.filter(function (f) { return shown(f).linkedCriterionId; }).length;
    return '<div class="canvas-head"><div><h4>' + U.esc(audit.title) + '</h4><p>' + s.fields.length + ' field' + (s.fields.length === 1 ? '' : 's') + ' · ' + linked + ' linked to criteria</p></div></div>' +
      '<div class="sysfields">' +
        '<div class="sysfield">' + ui.icon('lockSm', 13) + '<span><strong>Case reference</strong> · generated automatically (CASE-001, CASE-002…)</span></div>' +
        '<div class="sysfield">' + ui.icon('lockSm', 13) + '<span><strong>Date of data collection</strong> · always recorded</span></div>' +
        '<div class="sysfield sysfield--privacy">' + ui.icon('shield', 13) + '<span>Do not add fields for patient names, dates of birth, CHI/NHS or hospital numbers.</span></div>' +
      '</div>' +
      (s.fields.length
        ? '<div class="fcards" id="fcards">' + s.fields.map(function (f, i) { return cardHtml(f, i, ro); }).join('') + '</div>'
        : '<div class="canvas-empty">' +
            '<div class="empty__icon">' + ui.icon('fList', 22) + '</div>' +
            '<h4>Your form has no fields yet</h4>' +
            '<p>Choose a field type from the library to start building, or create a Yes / No question for each audit criterion — already linked for compliance scoring.</p>' +
            (ro ? '' : '<div class="canvas-empty__actions">' +
              (criteria().length ? '<button class="btn btn--primary btn--sm" data-act="from-criteria">' + ui.icon('target', 14) + 'Generate from ' + criteria().length + ' criteria</button>' : '') +
              '<button class="btn btn--secondary btn--sm" data-add="short_text">' + ui.icon('plus', 14) + 'Add a short text field</button></div>') +
          '</div>');
  }

  /* =========================================================
   * Right — field settings
   * ========================================================= */
  function sField(key, label, control, opts) {
    const o = opts || {};
    const err = s.errors[key];
    return '<div class="sfield' + (err ? ' has-error' : '') + (o.cls ? ' ' + o.cls : '') + '" data-skey="' + key + '">' +
      (label ? '<label class="sfield__label"' + (o.forId ? ' for="' + o.forId + '"' : '') + '>' + label + (o.req ? ' <span class="req">*</span>' : '') + '</label>' : '') +
      control + (o.hint ? '<span class="sfield__hint">' + o.hint + '</span>' : '') +
      '<span class="sfield__error" role="alert">' + U.esc(err || '') + '</span></div>';
  }
  function sInput(key, type, attrs) {
    const v = s.draft[key];
    return '<input class="input input--sm" id="s-' + key + '" data-s="' + key + '" type="' + (type || 'text') + '" value="' + U.esc(v === null || v === undefined ? '' : v) + '"' + (attrs || '') + ' autocomplete="off">';
  }
  function sToggle(key, label, disabled, hint) {
    return '<label class="switch' + (disabled ? ' is-disabled' : '') + '"><input type="checkbox" data-s-bool="' + key + '"' + (s.draft[key] ? ' checked' : '') + (disabled ? ' disabled' : '') + '><span class="switch__track"><span class="switch__thumb"></span></span><span class="switch__label">' + label + (hint ? '<span class="switch__hint">' + hint + '</span>' : '') + '</span></label>';
  }
  function section(title, body, icon) {
    return '<section class="ssec"><h5 class="ssec__title">' + (icon ? ui.icon(icon, 13) : '') + title + '</h5>' + body + '</section>';
  }

  function defaultControl(f) {
    const opts = C.choiceOptions(f);
    switch (f.type) {
      case 'short_text': return sInput('defaultValue', 'text', ' placeholder="None"');
      case 'long_text': return '<textarea class="textarea input--sm" data-s="defaultValue" rows="2" placeholder="None">' + U.esc(f.defaultValue || '') + '</textarea>';
      case 'number': return sInput('defaultValue', 'text', ' inputmode="decimal" placeholder="None"');
      case 'date':
        return '<div class="sdate"><input class="input input--sm" type="date" data-s="defaultValue" value="' + (f.defaultValue && f.defaultValue !== 'today' ? f.defaultValue : '') + '"' + (f.defaultValue === 'today' ? ' disabled' : '') + '>' +
          '<label class="mini-toggle"><input type="checkbox" data-default-today' + (f.defaultValue === 'today' ? ' checked' : '') + '> Collection date</label></div>';
      case 'yesno': case 'select': case 'radio': case 'rating': {
        const list = f.type === 'rating' ? (function () { const a = []; for (let i = Number(f.ratingMin); i <= Number(f.ratingMax); i++) a.push({ id: i, label: String(i) }); return a; })() : opts;
        return '<select class="select input--sm" data-s="defaultValue"><option value="">None</option>' + list.map(function (o) {
          return '<option value="' + o.id + '"' + (String(f.defaultValue) === String(o.id) ? ' selected' : '') + '>' + U.esc(o.label) + '</option>';
        }).join('') + '</select>';
      }
      case 'multiselect':
        return '<div class="schecks">' + f.options.map(function (o) {
          return '<label><input type="checkbox" data-default-multi="' + o.id + '"' + (Array.isArray(f.defaultValue) && f.defaultValue.indexOf(o.id) !== -1 ? ' checked' : '') + '> ' + U.esc(o.label) + '</label>';
        }).join('') + '</div>';
      case 'checkbox': return sToggle('defaultValue', 'Ticked by default');
    }
    return '';
  }

  function optionsEditor(f) {
    if (f.type === 'yesno') {
      return '<div class="opt-list">' + f.options.map(function (o) {
        return '<div class="opt-row"><span class="opt-row__key">' + (o.id === 'yes' ? 'Positive' : 'Negative') + '</span><input class="input input--sm" data-opt="' + o.id + '" value="' + U.esc(o.label) + '" aria-label="' + o.id + ' label"></div>';
      }).join('') + '</div>';
    }
    return '<div class="opt-list">' + f.options.map(function (o, i) {
      return '<div class="opt-row">' +
        '<span class="opt-row__dot opt-row__dot--' + f.type + '"></span>' +
        '<input class="input input--sm" data-opt="' + o.id + '" value="' + U.esc(o.label) + '" aria-label="Option ' + (i + 1) + '">' +
        '<button type="button" class="icon-btn icon-btn--xs" data-opt-move="up" data-id="' + o.id + '" aria-label="Move option up"' + (i === 0 ? ' disabled' : '') + '>' + ui.icon('chevronUp', 13) + '</button>' +
        '<button type="button" class="icon-btn icon-btn--xs" data-opt-move="down" data-id="' + o.id + '" aria-label="Move option down"' + (i === f.options.length - 1 ? ' disabled' : '') + '>' + ui.icon('chevronDown', 13) + '</button>' +
        '<button type="button" class="icon-btn icon-btn--xs icon-btn--danger" data-opt-del="' + o.id + '" aria-label="Delete option ' + (i + 1) + '"' + (f.options.length <= 1 ? ' disabled' : '') + '>' + ui.icon('x', 13) + '</button>' +
      '</div>';
    }).join('') + '</div>' +
    '<button type="button" class="btn btn--ghost btn--sm" data-act="add-option">' + ui.icon('plus', 14) + 'Add option</button>';
  }

  function typeSettings(f) {
    const pair = function (a, b) { return '<div class="sgrid">' + a + b + '</div>'; };
    switch (f.type) {
      case 'short_text': case 'long_text':
        return section('Character limits', pair(
          sField('minLength', 'Minimum', sInput('minLength', 'number', ' min="0" placeholder="None"')),
          sField('maxLength', 'Maximum', sInput('maxLength', 'number', ' min="1" placeholder="None"'))), 'fType');
      case 'number':
        return section('Number rules', pair(
          sField('min', 'Minimum value', sInput('min', 'text', ' inputmode="decimal" placeholder="None"')),
          sField('max', 'Maximum value', sInput('max', 'text', ' inputmode="decimal" placeholder="None"'))) +
          sField('decimals', 'Decimal places', '<select class="select input--sm" data-s="decimals">' + [0, 1, 2, 3, 4].map(function (d) { return '<option value="' + d + '"' + (Number(f.decimals) === d ? ' selected' : '') + '>' + (d ? d + ' (e.g. ' + (1).toFixed(d) + ')' : 'Whole numbers only') + '</option>'; }).join('') + '</select>'), 'fHash');
      case 'date':
        return section('Permitted dates', pair(
          sField('minDate', 'Earliest', sInput('minDate', 'date')),
          sField('maxDate', 'Latest', sInput('maxDate', 'date'))), 'calendar');
      case 'yesno':
        return section('Responses', sField('options', null, optionsEditor(f), { hint: 'Rename the two responses if needed, e.g. Present / Absent.' }), 'fToggle');
      case 'select': case 'radio':
        return section('Options', sField('options', null, optionsEditor(f)), 'fList');
      case 'multiselect':
        return section('Options', sField('options', null, optionsEditor(f)) +
          pair(sField('minSelections', 'Min selections', sInput('minSelections', 'number', ' min="0" placeholder="None"')),
               sField('maxSelections', 'Max selections', sInput('maxSelections', 'number', ' min="1" placeholder="None"'))), 'fChecks');
      case 'checkbox':
        return section('Checkbox', sField('checkboxLabel', 'Text beside the box', sInput('checkboxLabel', 'text', ' placeholder="e.g. Consent form present"')), 'fCheckbox');
      case 'rating':
        return section('Scale', pair(
          sField('ratingMin', 'Minimum', '<select class="select input--sm" data-s="ratingMin">' + [0, 1].map(function (n) { return '<option' + (Number(f.ratingMin) === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select>'),
          sField('ratingMax', 'Maximum', '<select class="select input--sm" data-s="ratingMax">' + [3, 4, 5, 7, 10].map(function (n) { return '<option' + (Number(f.ratingMax) === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select>')) +
          pair(sField('minLabel', 'Low label', sInput('minLabel', 'text', ' placeholder="e.g. Poor"')),
               sField('maxLabel', 'High label', sInput('maxLabel', 'text', ' placeholder="e.g. Excellent"'))), 'fStar');
    }
    return '';
  }

  function complianceSettings(f) {
    if (!f.linkedCriterionId) return '';
    if (C.TYPES[f.type].choice) {
      return '<div class="cmap"><p class="cmap__intro">How should each response be scored for this criterion?</p>' + C.choiceOptions(f).map(function (o) {
        const state = f.compliantValues.indexOf(o.id) !== -1 ? 'c' : (f.notApplicableValues.indexOf(o.id) !== -1 || o.isNA) ? 'na' : 'nc';
        const locked = o.isNA;
        return '<div class="cmap__row"><span class="cmap__opt">' + U.esc(o.label) + '</span><div class="seg seg--xs" role="radiogroup" aria-label="Scoring for ' + U.esc(o.label) + '">' +
          [['c', 'Compliant'], ['nc', 'Non-compliant'], ['na', 'N/A']].map(function (x) {
            return '<button type="button" class="seg__btn' + (state === x[0] ? ' is-active cmap--' + x[0] : '') + '" data-map="' + x[0] + '" data-opt-id="' + o.id + '"' + (locked && x[0] !== 'na' ? ' disabled' : '') + '>' + x[1] + '</button>';
          }).join('') + '</div></div>';
      }).join('') + '<p class="cmap__note">N/A responses are excluded from the criterion denominator.</p></div>';
    }
    if (f.type === 'number' || f.type === 'rating') {
      return '<div class="cmap"><p class="cmap__intro">Values in this range count as compliant:</p><div class="sgrid">' +
        sField('compliantMin', 'From', sInput('compliantMin', 'text', ' inputmode="decimal" placeholder="No minimum"')) +
        sField('compliantMax', 'To', sInput('compliantMax', 'text', ' inputmode="decimal" placeholder="No maximum"')) + '</div>' +
        (f.allowNA ? '<p class="cmap__note">“' + U.esc(f.naLabel) + '” is excluded from the denominator.</p>' : '') + '</div>';
    }
    return '<div class="cmap"><p class="cmap__intro">Any recorded answer counts as compliant; a blank answer is non-compliant.' + (f.allowNA ? ' “' + U.esc(f.naLabel) + '” is excluded from the denominator.' : '') + '</p></div>';
  }

  function settingsHtml() {
    if (!s.draft) {
      return '<div class="settings-empty">' + ui.icon('fList', 20) + '<h4>No field selected</h4><p>Select a field on the canvas to edit its label, validation rules and link to an audit criterion.</p></div>';
    }
    const f = s.draft;
    const t = C.TYPES[f.type];
    const hasPh = ['short_text', 'long_text', 'number', 'select'].indexOf(f.type) !== -1;
    const errCount = Object.keys(s.errors).length;
    return '<div class="sp">' +
      '<div class="sp__head"><span class="sp__icon">' + ui.icon(t.icon, 16) + '</span><div><h4>' + t.label + ' field</h4><p>Field ' + (fieldIndex(f.id) + 1) + ' of ' + s.fields.length + '</p></div>' +
        '<button class="icon-btn icon-btn--sm" data-act="deselect" aria-label="Close field settings">' + ui.icon('x', 16) + '</button></div>' +
      '<div class="sp__body">' +
        (errCount ? '<div class="alert alert--error alert--sm">' + ui.icon('alert', 14) + '<div>' + errCount + ' setting' + (errCount === 1 ? '' : 's') + ' to fix before saving.</div></div>' : '') +
        section('Question',
          sField('label', 'Field label', '<textarea class="textarea input--sm" id="s-label" data-s="label" rows="2" placeholder="e.g. Was the implant crown torque documented?">' + U.esc(f.label) + '</textarea>', { req: true, forId: 's-label' }) +
          sField('helperText', 'Helper text', '<textarea class="textarea input--sm" data-s="helperText" rows="2" placeholder="Guidance shown under the question">' + U.esc(f.helperText) + '</textarea>') +
          (hasPh ? sField('placeholder', 'Placeholder', sInput('placeholder', 'text', ' placeholder="Optional"')) : '') +
          (f.type !== 'checkbox' ? sField('required', null, sToggle('required', 'Required', !!f.linkedCriterionId, f.linkedCriterionId ? 'Fields linked to a criterion are always required' : 'Must be answered before a case can be submitted')) : '') +
          sField('defaultValue', 'Default value', defaultControl(f)), 'fType') +
        typeSettings(f) +
        (f.type !== 'checkbox' ? section('Not applicable',
          sField('allowNA', null, sToggle('allowNA', 'Offer a “Not applicable” response', false, 'Cases answered N/A are excluded from the criterion denominator')) +
          (f.allowNA ? sField('naLabel', 'Label', sInput('naLabel', 'text')) : ''), 'flag') : '') +
        section('Audit criterion',
          sField('linkedCriterionId', 'Linked criterion', '<select class="select input--sm" data-s="linkedCriterionId"><option value="">Not linked</option>' +
            criteria().map(function (c, i) { return '<option value="' + c.id + '"' + (f.linkedCriterionId === c.id ? ' selected' : '') + '>' + (i + 1) + '. ' + U.esc(c.name) + '</option>'; }).join('') + '</select>',
            { hint: criteria().length ? 'Linked fields feed criterion compliance in analytics.' : 'This audit has no criteria. Add them in Edit audit.' }) +
          sField('compliance', null, complianceSettings(f)), 'target') +
      '</div>' +
      '<div class="sp__foot"><button class="btn btn--ghost btn--sm" data-act="discard-field"' + (s.draftDirty ? '' : ' disabled') + '>Discard</button>' +
        '<button class="btn btn--primary btn--sm" data-act="save-field"' + (s.draftDirty ? '' : ' disabled') + '>' + ui.icon('check', 14) + 'Save field</button></div>' +
    '</div>';
  }

  /* =========================================================
   * Preview mode
   * ========================================================= */
  function previewHtml() {
    const form = { fields: s.fields };
    if (!s.preview) {
      const today = U.isoDay(new Date());
      s.preview = { collectionDate: today, responses: {} };
      s.fields.forEach(function (f) { s.preview.responses[f.id] = C.initialValue(f, today); });
    }
    return '<div class="fb-preview">' +
      '<section class="card fb-preview__card">' +
        '<div class="fb-preview__banner">' + ui.icon('eye', 15) + '<span>Preview — exactly what data collectors will see. Responses here are not saved.</span></div>' +
        '<div class="fb-preview__title"><h3>' + U.esc(audit.title) + '</h3><p>' + U.esc(C.currentCycle(audit).label) + ' · New case</p></div>' +
        '<form id="pv-form" novalidate>' + DA.formRenderer.render(form, { caseReference: 'CASE-PREVIEW', collectionDate: s.preview.collectionDate, responses: s.preview.responses }, { criteria: criteria(), showLinks: true }) + '</form>' +
        '<div class="fb-preview__foot"><button class="btn btn--ghost" data-act="pv-reset">Clear responses</button>' +
          '<button class="btn btn--secondary" data-act="pv-validate">' + ui.icon('check', 15) + 'Test submit</button></div>' +
      '</section>' +
      '<aside class="card fb-preview__score"><h4>' + ui.icon('target', 14) + 'Criterion scoring</h4><p class="muted small">How this test response would be scored when submitted.</p><div id="pv-score"></div></aside>' +
    '</div>';
  }

  function scoreHtml() {
    const res = C.scoreRecord({ fields: s.fields }, s.preview.responses);
    const lab = { met: ['Met', 'good', 'check'], not_met: ['Not met', 'critical', 'x'], na: ['N/A — excluded', 'none', 'flag'] };
    if (!criteria().length) return '<p class="muted small">This audit has no criteria.</p>';
    return '<ul class="score-list">' + criteria().map(function (c, i) {
      const linked = s.fields.some(function (f) { return f.linkedCriterionId === c.id; });
      const r = res[c.id];
      return '<li><span class="score-list__name"><span class="muted">' + (i + 1) + '.</span> ' + U.esc(c.name) + '</span>' +
        (!linked ? '<span class="pill pill--none">No linked field</span>' : r ? '<span class="pill pill--' + lab[r][1] + '">' + ui.icon(lab[r][2], 12) + lab[r][0] + '</span>' : '<span class="pill pill--none">Awaiting answer</span>') + '</li>';
    }).join('') + '</ul>';
  }

  function bindPreview() {
    const formEl = el.querySelector('#pv-form');
    const score = el.querySelector('#pv-score');
    const update = function () {
      const v = DA.formRenderer.read(formEl, { fields: s.fields });
      s.preview.collectionDate = v.collectionDate;
      s.preview.responses = v.responses;
      score.innerHTML = scoreHtml();
    };
    DA.formRenderer.bind(formEl, { fields: s.fields }, update);
    score.innerHTML = scoreHtml();
  }

  /* =========================================================
   * Field draft handling
   * ========================================================= */
  function select(id) {
    if (s.draft && s.draft.id === id) return true;
    if (s.draft && s.draftDirty && !applyDraft(true)) return false;
    const f = s.fields.find(function (x) { return x.id === id; });
    s.draft = f ? clone(f) : null;
    s.draftDirty = false;
    s.errors = s.formErrors[id] || {};
    return true;
  }

  /** Validate and write the draft back into the form. */
  function applyDraft(quiet) {
    if (!s.draft) return true;
    const f = s.draft;
    // Keep compliance mapping consistent with options and N/A.
    const ids = C.choiceOptions(f).map(function (o) { return o.id; });
    f.compliantValues = f.compliantValues.filter(function (v) { return ids.indexOf(v) !== -1; });
    f.notApplicableValues = f.notApplicableValues.filter(function (v) { return ids.indexOf(v) !== -1 && v !== C.NA; });
    if (f.allowNA && f.type !== 'checkbox') f.notApplicableValues.push(C.NA);
    if (Array.isArray(f.defaultValue)) f.defaultValue = f.defaultValue.filter(function (v) { return ids.indexOf(v) !== -1; });
    if (f.linkedCriterionId) f.required = true;
    s.errors = C.validateFieldDef(f, criteria());
    if (Object.keys(s.errors).length) {
      if (!quiet) ui.toast('Fix the highlighted settings to save this field', 'error');
      else ui.toast('Finish or discard the changes to “' + (f.label || 'this field') + '” first', 'error');
      repaint();
      const first = el.querySelector('.sfield.has-error input, .sfield.has-error textarea, .sfield.has-error select');
      if (first) first.focus();
      return false;
    }
    const i = fieldIndex(f.id);
    if (i >= 0) s.fields[i] = clone(f);
    delete s.formErrors[f.id];
    s.draftDirty = false;
    return true;
  }

  function markDraft() {
    s.draftDirty = true;
    if (Object.keys(s.errors).length) s.errors = C.validateFieldDef(s.draft, criteria());
  }

  /** Refresh only the canvas card + footer state (keeps focus in the settings panel). */
  function refreshCard() {
    const id = s.draft && s.draft.id;
    const card = id && el.querySelector('.fcard[data-fid="' + id + '"]');
    if (card) {
      const tmp = document.createElement('div');
      tmp.innerHTML = cardHtml(s.fields[fieldIndex(id)], fieldIndex(id), false);
      card.replaceWith(tmp.firstChild);
    }
    el.querySelectorAll('.sp__foot .btn').forEach(function (b) { b.disabled = !s.draftDirty; });
    const st = el.querySelector('.fb-bar .save-state');
    if (st && isDirty(s)) { st.classList.add('is-dirty'); st.lastChild.textContent = 'Unsaved changes'; }
    const dot = el.querySelector('.dc-tabs [data-tab="form"] .dc-tabs__dot');
    if (dot) dot.hidden = !isDirty(s);
    el.querySelectorAll('.sfield').forEach(function (w) {
      const e = s.errors[w.dataset.skey];
      w.classList.toggle('has-error', !!e);
      const n = w.querySelector(':scope > .sfield__error');
      if (n) n.textContent = e || '';
    });
  }

  function repaint() {
    const sp = el.querySelector('.fb__settings');
    const scroll = sp ? sp.scrollTop : 0;
    const canvas = el.querySelector('.fb__canvas');
    const cScroll = canvas ? canvas.scrollTop : 0;
    paint();
    const sp2 = el.querySelector('.fb__settings');
    if (sp2) sp2.scrollTop = scroll;
    const c2 = el.querySelector('.fb__canvas');
    if (c2) c2.scrollTop = cScroll;
  }

  /* =========================================================
   * Events
   * ========================================================= */
  function onInput(e) {
    const t = e.target;
    if (!s.draft) return;
    if (t.dataset.s && t.type !== 'checkbox') {
      if (t.tagName === 'SELECT') return; // handled on change
      s.draft[t.dataset.s] = t.value;
      markDraft();
      refreshCard();
    } else if (t.dataset.opt) {
      const o = s.draft.options.find(function (x) { return x.id === t.dataset.opt; });
      if (o) { o.label = t.value; markDraft(); refreshCard(); }
    }
  }

  function onChange(e) {
    const t = e.target;
    if (!s.draft) return;
    const f = s.draft;
    if (t.dataset.sBool) {
      f[t.dataset.sBool] = t.checked;
      markDraft();
      repaint();
    } else if (t.tagName === 'SELECT' && t.dataset.s) {
      const k = t.dataset.s;
      let v = t.value;
      if (k === 'linkedCriterionId') {
        f.linkedCriterionId = v || null;
        if (v) {
          f.required = true;
          if (f.type === 'yesno' && !f.compliantValues.length) f.compliantValues = ['yes'];
          if (f.type === 'checkbox' && !f.compliantValues.length) f.compliantValues = ['checked'];
        } else { f.compliantValues = []; f.notApplicableValues = []; }
      } else if (k === 'decimals' || k === 'ratingMin' || k === 'ratingMax') {
        f[k] = Number(v);
      } else if (k === 'defaultValue') {
        f.defaultValue = v === '' ? null : (f.type === 'rating' ? Number(v) : v);
      } else {
        f[k] = v;
      }
      markDraft();
      repaint();
    } else if (t.dataset.s === 'defaultValue' && t.type === 'date') {
      f.defaultValue = t.value || null; markDraft(); refreshCard();
    } else if (t.hasAttribute('data-default-today')) {
      f.defaultValue = t.checked ? 'today' : null; markDraft(); repaint();
    } else if (t.dataset.defaultMulti) {
      const arr = Array.isArray(f.defaultValue) ? f.defaultValue.slice() : [];
      const i = arr.indexOf(t.dataset.defaultMulti);
      if (t.checked && i === -1) arr.push(t.dataset.defaultMulti);
      if (!t.checked && i !== -1) arr.splice(i, 1);
      f.defaultValue = arr; markDraft(); refreshCard();
    }
  }

  function onClick(e) {
    const b = e.target.closest('button, [data-select]');
    if (!b || b.disabled || !el.contains(b)) return;

    if (b.dataset.add) { addField(b.dataset.add); return; }
    if (b.dataset.select) {
      if (select(b.dataset.select)) { repaint(); focusSettings(); }
      return;
    }
    if (b.dataset.move) { move(b.dataset.id, b.dataset.move === 'up' ? -1 : 1); return; }
    if (b.dataset.dup) { duplicate(b.dataset.dup); return; }
    if (b.dataset.del) { removeField(b.dataset.del); return; }
    if (b.dataset.map) {
      const f = s.draft, id = b.dataset.optId;
      f.compliantValues = f.compliantValues.filter(function (v) { return v !== id; });
      f.notApplicableValues = f.notApplicableValues.filter(function (v) { return v !== id; });
      if (f.type !== 'multiselect' && f.type !== 'checkbox' && b.dataset.map === 'c' && f.type === 'yesno') { /* allow both yes/no explicitly */ }
      if (b.dataset.map === 'c') f.compliantValues.push(id);
      if (b.dataset.map === 'na') f.notApplicableValues.push(id);
      markDraft(); repaint();
      return;
    }
    if (b.dataset.optDel) {
      s.draft.options = s.draft.options.filter(function (o) { return o.id !== b.dataset.optDel; });
      markDraft(); repaint();
      return;
    }
    if (b.dataset.optMove) {
      const arr = s.draft.options, i = arr.findIndex(function (o) { return o.id === b.dataset.id; });
      const j = i + (b.dataset.optMove === 'up' ? -1 : 1);
      if (j >= 0 && j < arr.length) { const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp; markDraft(); repaint(); }
      return;
    }

    switch (b.dataset.act) {
      case 'add-option': {
        const o = { id: DA.model.newId('opt'), label: 'Option ' + (s.draft.options.length + 1) };
        s.draft.options.push(o);
        markDraft(); repaint();
        const inp = el.querySelector('[data-opt="' + o.id + '"]');
        if (inp) { inp.focus(); inp.select(); }
        break;
      }
      case 'save-field':
        if (applyDraft(false)) { ui.toast('Field saved — remember to save the form', 'success'); repaint(); }
        break;
      case 'discard-field': {
        const orig = s.fields.find(function (x) { return x.id === s.draft.id; });
        s.draft = orig ? clone(orig) : null; s.draftDirty = false; s.errors = {};
        repaint();
        break;
      }
      case 'deselect':
        if (s.draftDirty && !applyDraft(true)) return;
        s.draft = null; s.errors = {}; repaint();
        break;
      case 'from-criteria': generateFromCriteria(); break;
      case 'save-form': saveForm(); break;
      case 'discard': discardAll(); break;
      case 'preview':
        if (s.draftDirty && !applyDraft(true)) return;
        s.mode = 'preview'; s.preview = null; repaint(); document.getElementById('main').scrollTop = 0;
        break;
      case 'build': s.mode = 'build'; repaint(); break;
      case 'pv-reset': s.preview = null; repaint(); break;
      case 'pv-validate': {
        const formEl = el.querySelector('#pv-form');
        const data = DA.formRenderer.read(formEl, { fields: s.fields });
        const v = C.validateRecord({ fields: s.fields }, data, 'complete');
        DA.formRenderer.showErrors(formEl, v.errors);
        if (v.count) {
          ui.toast(v.count + ' response' + (v.count === 1 ? '' : 's') + ' would block submission', 'error');
          const first = formEl.querySelector('.cf.has-error');
          if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } else ui.toast('All responses valid — this case could be submitted', 'success');
        break;
      }
    }
  }

  function focusSettings() {
    const lbl = el.querySelector('#s-label');
    if (lbl && window.innerWidth > 1100) lbl.focus({ preventScroll: true });
    const panel = el.querySelector('.fb__settings');
    if (panel && window.innerWidth <= 1100) panel.scrollTop = 0;
  }

  /* =========================================================
   * Field operations
   * ========================================================= */
  function addField(type) {
    if (s.draft && s.draftDirty && !applyDraft(true)) return;
    const f = C.newField(type);
    const at = s.draft ? fieldIndex(s.draft.id) + 1 : s.fields.length;
    s.fields.splice(at, 0, f);
    s.draft = clone(f); s.draftDirty = false; s.errors = {};
    s.formErrors = {};
    repaint();
    const card = el.querySelector('.fcard[data-fid="' + f.id + '"]');
    if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const lbl = el.querySelector('#s-label');
    if (lbl && window.innerWidth > 1100) { lbl.focus(); lbl.select(); }
    ui.toast(C.TYPES[type].label + ' field added', 'success');
  }

  function move(id, dir) {
    const i = fieldIndex(id), j = i + dir;
    if (i < 0 || j < 0 || j >= s.fields.length) return;
    const tmp = s.fields[i]; s.fields[i] = s.fields[j]; s.fields[j] = tmp;
    repaint();
    const btn = el.querySelector('.fcard[data-fid="' + id + '"] [data-move="' + (dir < 0 ? 'up' : 'down') + '"]');
    (btn && !btn.disabled ? btn : el.querySelector('.fcard[data-fid="' + id + '"] [data-dup]')).focus();
  }

  function duplicate(id) {
    if (s.draft && s.draftDirty && !applyDraft(true)) return;
    const src = s.fields[fieldIndex(id)];
    const copy = C.duplicateField(src);
    s.fields.splice(fieldIndex(id) + 1, 0, copy);
    s.draft = clone(copy); s.draftDirty = false; s.errors = {};
    repaint();
    ui.toast('Field duplicated', 'success');
  }

  function removeField(id) {
    const f = shown(s.fields[fieldIndex(id)]);
    const cyc = C.currentCycle(audit);
    const used = cyc.records.filter(function (r) { return r.responses[id] !== undefined && r.responses[id] !== ''; }).length;
    ui.confirm({
      title: 'Delete field?',
      message: '“' + (f.label || 'Untitled field') + '” will be removed from the form.' +
        (used ? ' ' + used + ' existing case' + (used === 1 ? ' has' : 's have') + ' an answer to it — those answers stay in the records but won’t appear on new cases.' : ''),
      confirmLabel: 'Delete field', danger: true,
      onConfirm: function () {
        s.fields = s.fields.filter(function (x) { return x.id !== id; });
        if (s.draft && s.draft.id === id) { s.draft = null; s.draftDirty = false; s.errors = {}; }
        delete s.formErrors[id];
        repaint();
        ui.toast('Field deleted — save the form to apply', 'success');
      }
    });
  }

  function generateFromCriteria() {
    if (s.draft && s.draftDirty && !applyDraft(true)) return;
    let n = 0;
    criteria().forEach(function (c) {
      if (s.fields.some(function (f) { return f.linkedCriterionId === c.id; })) return;
      const f = C.newField('yesno');
      f.label = c.name.replace(/[.?]$/, '') + '?';
      f.helperText = c.description || '';
      f.required = true;
      f.allowNA = true;
      f.linkedCriterionId = c.id;
      f.compliantValues = ['yes'];
      f.notApplicableValues = [C.NA];
      s.fields.push(f);
      n++;
    });
    s.draft = null; s.errors = {};
    repaint();
    ui.toast(n ? 'Added ' + n + ' linked Yes / No field' + (n === 1 ? '' : 's') : 'Every criterion already has a linked field', 'success');
  }

  function saveForm() {
    if (s.draftDirty && !applyDraft(false)) return;
    const errs = C.validateForm({ fields: s.fields }, criteria());
    s.formErrors = errs;
    if (Object.keys(errs).length) {
      const firstId = Object.keys(errs).find(function (k) { return k !== '_form'; });
      if (firstId) { s.draft = clone(s.fields[fieldIndex(firstId)]); s.draftDirty = false; s.errors = errs[firstId]; }
      repaint();
      ui.toast(errs._form || (Object.keys(errs).length + ' field' + (Object.keys(errs).length === 1 ? ' needs' : 's need') + ' attention before saving'), 'error');
      return;
    }
    const res = store.saveForm(audit.id, s.fields);
    if (!res) return;
    s.fields = clone(res.form.fields);
    s.base = JSON.stringify(s.fields);
    if (s.draft) s.draft = clone(s.fields[fieldIndex(s.draft.id)] || s.draft);
    s.formErrors = {};
    if (!res.changed) ui.toast('No changes to save', 'info');
    else ui.toast('Form saved — version ' + res.form.version, 'success');
    DA.router.refresh(true);
  }

  function discardAll() {
    ui.confirm({
      title: 'Discard unsaved changes?', message: 'The form will return to the last saved version.', confirmLabel: 'Discard', danger: true,
      onConfirm: function () {
        delete sessions[audit.id];
        s = sessionFor(audit);
        DA.router.refresh(true);
        ui.toast('Changes discarded', 'success');
      }
    });
  }

  /* =========================================================
   * Drag and drop reordering
   * ========================================================= */
  function bindDrag() {
    let dragId = null;
    el.addEventListener('dragstart', function (e) {
      const card = e.target.closest && e.target.closest('.fcard');
      if (!card) return;
      dragId = card.dataset.fid;
      card.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragId); } catch (x) { /* IE */ }
    });
    el.addEventListener('dragover', function (e) {
      if (!dragId) return;
      const card = e.target.closest && e.target.closest('.fcard');
      if (!card || card.dataset.fid === dragId) return;
      e.preventDefault();
      const r = card.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      el.querySelectorAll('.fcard').forEach(function (c) { c.classList.remove('drop-before', 'drop-after'); });
      card.classList.add(after ? 'drop-after' : 'drop-before');
    });
    el.addEventListener('drop', function (e) {
      if (!dragId) return;
      const card = e.target.closest && e.target.closest('.fcard');
      e.preventDefault();
      if (card && card.dataset.fid !== dragId) {
        const after = card.classList.contains('drop-after');
        const moving = s.fields.splice(fieldIndex(dragId), 1)[0];
        const to = fieldIndex(card.dataset.fid) + (after ? 1 : 0);
        s.fields.splice(to, 0, moving);
        repaint();
      }
      dragId = null;
    });
    el.addEventListener('dragend', function () {
      dragId = null;
      el.querySelectorAll('.fcard').forEach(function (c) { c.classList.remove('is-dragging', 'drop-before', 'drop-after'); });
    });
  }

  return {
    nav: 'collect',
    keepOnStoreChange: true,
    title: function () { return 'Form Builder'; },
    crumbs: function (p) {
      const a = store.getAudit(p.id);
      return [{ label: 'Workspace', href: '#/dashboard' }, { label: 'Data Collection', href: '#/collect' }, { label: a ? a.title : 'Audit', href: a ? '#/collect/' + a.id : null }, { label: 'Form builder' }];
    },
    render: render,
    hasUnsaved: function (auditId) { return isDirty(sessions[auditId]); }
  };
})();
