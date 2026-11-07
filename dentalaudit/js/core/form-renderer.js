/* DentalAudit — dynamic form renderer
 * Turns a form definition into inputs, reads responses back and shows errors.
 * Shared by the form builder's Preview and the Add / Edit Case screens, so the
 * preview is exactly what data collectors see.
 */
DA.formRenderer = (function () {
  const U = DA.utils, ui = DA.ui, C = DA.collection;

  function constraintHint(f) {
    const has = function (v) { return v !== '' && v !== null && v !== undefined; };
    switch (f.type) {
      case 'short_text': case 'long_text':
        if (has(f.minLength) && has(f.maxLength)) return Number(f.minLength) === Number(f.maxLength) ? 'Exactly ' + f.minLength + ' characters' : f.minLength + '–' + f.maxLength + ' characters';
        if (has(f.maxLength)) return 'Up to ' + f.maxLength + ' characters';
        if (has(f.minLength)) return 'At least ' + f.minLength + ' characters';
        return '';
      case 'number': {
        const dp = Number(f.decimals) || 0;
        const range = has(f.min) && has(f.max) ? f.min + ' to ' + f.max : has(f.min) ? f.min + ' or more' : has(f.max) ? 'Up to ' + f.max : '';
        return [range, dp ? 'up to ' + dp + ' decimal place' + (dp === 1 ? '' : 's') : 'whole number'].filter(Boolean).join(' · ');
      }
      case 'date':
        if (f.minDate && f.maxDate) return U.fmtDate(f.minDate) + ' to ' + U.fmtDate(f.maxDate);
        if (f.minDate) return 'On or after ' + U.fmtDate(f.minDate);
        if (f.maxDate) return 'On or before ' + U.fmtDate(f.maxDate);
        return '';
      case 'multiselect':
        if (has(f.minSelections) && has(f.maxSelections)) return 'Select ' + f.minSelections + '–' + f.maxSelections;
        if (has(f.maxSelections)) return 'Select up to ' + f.maxSelections;
        if (has(f.minSelections)) return 'Select at least ' + f.minSelections;
        return 'Select all that apply';
    }
    return '';
  }

  function naToggle(f, value, name) {
    if (!f.allowNA) return '';
    return '<label class="cf-na"><input type="checkbox" data-na="' + f.id + '"' + (value === C.NA ? ' checked' : '') + ' name="' + name + '_na">' +
      '<span>' + U.esc(f.naLabel || 'Not applicable') + '</span></label>';
  }

  function control(f, value) {
    const name = 'f_' + f.id;
    const isNA = value === C.NA;
    const v = isNA ? '' : value;
    const ph = f.placeholder ? ' placeholder="' + U.esc(f.placeholder) + '"' : '';
    const inputId = 'cf-' + f.id;
    switch (f.type) {
      case 'short_text':
        return '<div class="cf-row"><input class="input" id="' + inputId + '" name="' + name + '" type="text" value="' + U.esc(v) + '"' + ph + (isNA ? ' disabled' : '') + ' autocomplete="off" data-count></div>' + naToggle(f, value, name);
      case 'long_text':
        return '<textarea class="textarea" id="' + inputId + '" name="' + name + '" rows="3"' + ph + (isNA ? ' disabled' : '') + ' data-count>' + U.esc(v) + '</textarea>' + naToggle(f, value, name);
      case 'number':
        return '<div class="cf-row"><input class="input cf-num" id="' + inputId + '" name="' + name + '" type="text" inputmode="decimal" value="' + U.esc(v) + '"' + ph + (isNA ? ' disabled' : '') + ' autocomplete="off"></div>' + naToggle(f, value, name);
      case 'date':
        return '<div class="cf-row"><input class="input cf-date" id="' + inputId + '" name="' + name + '" type="date" value="' + U.esc(v) + '"' + (f.minDate ? ' min="' + f.minDate + '"' : '') + (f.maxDate ? ' max="' + f.maxDate + '"' : '') + (isNA ? ' disabled' : '') + '></div>' + naToggle(f, value, name);
      case 'yesno':
        return '<div class="seg cf-seg" role="radiogroup" aria-labelledby="lbl-' + f.id + '">' + C.choiceOptions(f).map(function (o) {
          const on = value === o.id;
          return '<label class="seg__btn' + (on ? ' is-active' : '') + (o.id === 'yes' ? ' is-met' : o.id === 'no' ? ' is-notmet' : '') + '"><input class="sr-only" type="radio" name="' + name + '" value="' + o.id + '"' + (on ? ' checked' : '') + '>' +
            (o.id === 'yes' ? ui.icon('check', 13) : o.id === 'no' ? ui.icon('x', 13) : '') + U.esc(o.label) + '</label>';
        }).join('') + '</div>';
      case 'radio':
        return '<div class="cf-choices" role="radiogroup" aria-labelledby="lbl-' + f.id + '">' + C.choiceOptions(f).map(function (o) {
          return '<label class="cf-choice' + (o.isNA ? ' cf-choice--na' : '') + '"><input type="radio" name="' + name + '" value="' + o.id + '"' + (value === o.id ? ' checked' : '') + '><span>' + U.esc(o.label) + '</span></label>';
        }).join('') + '</div>';
      case 'select':
        return '<select class="select" id="' + inputId + '" name="' + name + '"><option value="">' + U.esc(f.placeholder || 'Select…') + '</option>' +
          C.choiceOptions(f).map(function (o) { return '<option value="' + o.id + '"' + (value === o.id ? ' selected' : '') + '>' + U.esc(o.label) + '</option>'; }).join('') +
          (value && !C.optionLabel(f, value) ? '<option value="' + U.esc(value) + '" selected>(removed option)</option>' : '') +
        '</select>';
      case 'multiselect': {
        const arr = Array.isArray(value) ? value : [];
        return '<div class="cf-choices cf-choices--multi" role="group" aria-labelledby="lbl-' + f.id + '">' + C.choiceOptions(f).map(function (o) {
          return '<label class="cf-choice' + (o.isNA ? ' cf-choice--na' : '') + '"><input type="checkbox" name="' + name + '" value="' + o.id + '"' + (arr.indexOf(o.id) !== -1 ? ' checked' : '') + (o.isNA ? ' data-exclusive' : '') + '><span>' + U.esc(o.label) + '</span></label>';
        }).join('') + '</div>';
      }
      case 'checkbox':
        return '<label class="cf-check"><input type="checkbox" name="' + name + '"' + (value === true ? ' checked' : '') + '><span class="cf-check__box">' + ui.icon('check', 12) + '</span><span>' + U.esc(f.checkboxLabel || 'Confirmed') + '</span></label>';
      case 'rating': {
        const pts = [];
        for (let i = Number(f.ratingMin); i <= Number(f.ratingMax); i++) pts.push(i);
        return '<div class="cf-rating" role="radiogroup" aria-labelledby="lbl-' + f.id + '">' +
          '<div class="cf-rating__scale">' + pts.map(function (n) {
            const on = String(value) === String(n);
            return '<label class="cf-rating__pt' + (on ? ' is-active' : '') + '"><input class="sr-only" type="radio" name="' + name + '" value="' + n + '"' + (on ? ' checked' : '') + '>' + n + '</label>';
          }).join('') +
          (f.allowNA ? '<label class="cf-rating__pt cf-rating__pt--na' + (isNA ? ' is-active' : '') + '"><input class="sr-only" type="radio" name="' + name + '" value="' + C.NA + '"' + (isNA ? ' checked' : '') + '>' + U.esc(f.naLabel || 'N/A') + '</label>' : '') +
          '</div>' +
          (f.minLabel || f.maxLabel ? '<div class="cf-rating__labels" style="--pts:' + pts.length + '"><span>' + U.esc(f.minLabel) + '</span><span>' + U.esc(f.maxLabel) + '</span></div>' : '') +
        '</div>';
      }
    }
    return '';
  }

  function counter(f, value) {
    if ((f.type !== 'short_text' && f.type !== 'long_text') || f.maxLength === '' || f.maxLength === null) return '';
    const n = value && value !== C.NA ? String(value).length : 0;
    return '<span class="cf-counter" data-counter="' + f.id + '">' + n + ' / ' + f.maxLength + '</span>';
  }

  function fieldHtml(f, value, err, opts, index, criteria) {
    const crit = f.linkedCriterionId && criteria ? criteria.find(function (c) { return c.id === f.linkedCriterionId; }) : null;
    const hint = constraintHint(f);
    return '<div class="cf' + (err ? ' has-error' : '') + '" data-cf="' + f.id + '">' +
      '<div class="cf__head">' +
        '<span class="cf__label" id="lbl-' + f.id + '"><span class="cf__num">' + (index + 1) + '</span>' +
        (['short_text', 'long_text', 'number', 'date', 'select'].indexOf(f.type) !== -1 ? '<label for="cf-' + f.id + '">' + U.esc(f.label) + '</label>' : U.esc(f.label)) +
        (f.required && f.type !== 'checkbox' ? ' <span class="req" aria-label="required">*</span>' : '') + '</span>' +
        (crit && opts.showLinks ? '<span class="cf__link" title="Evidence for criterion: ' + U.esc(crit.name) + '">' + ui.icon('target', 12) + U.esc(crit.name) + '</span>' : '') +
      '</div>' +
      (f.helperText ? '<p class="cf__help">' + U.esc(f.helperText) + '</p>' : '') +
      control(f, value) +
      '<div class="cf__foot"><span class="cf__error" role="alert">' + U.esc(err || '') + '</span>' +
        '<span class="cf__meta">' + (hint ? '<span class="cf__hint">' + U.esc(hint) + '</span>' : '') + counter(f, value) + '</span></div>' +
    '</div>';
  }

  /**
   * state: { caseReference, collectionDate, responses }
   * opts:  { errors, criteria, showLinks, readOnlyRef }
   */
  function render(form, state, opts) {
    const o = opts || {};
    const errs = o.errors || {};
    return '<div class="cf-form">' +
      '<div class="cf-system">' +
        '<div class="cf-system__item"><span class="cf-system__label">' + ui.icon('lockSm', 12) + 'Case reference</span><span class="cf-system__value mono">' + U.esc(state.caseReference || 'Assigned on save') + '</span></div>' +
        '<div class="cf' + (errs._date ? ' has-error' : '') + ' cf-system__item" data-cf="_date"><label class="cf-system__label" for="cf-date">' + ui.icon('calendar', 12) + 'Date of data collection <span class="req">*</span></label>' +
          '<input class="input" id="cf-date" name="_date" type="date" value="' + U.esc(state.collectionDate || '') + '" max="' + U.isoDay(new Date()) + '">' +
          '<span class="cf__error" role="alert">' + U.esc(errs._date || '') + '</span></div>' +
      '</div>' +
      form.fields.map(function (f, i) { return fieldHtml(f, state.responses[f.id], errs[f.id], o, i, o.criteria); }).join('') +
    '</div>';
  }

  /** Read current values from the DOM. */
  function read(root, form) {
    const out = { collectionDate: (root.querySelector('[name="_date"]') || {}).value || '', responses: {} };
    form.fields.forEach(function (f) {
      const name = 'f_' + f.id;
      const na = root.querySelector('[data-na="' + f.id + '"]');
      if (na && na.checked) { out.responses[f.id] = C.NA; return; }
      switch (f.type) {
        case 'yesno': case 'radio': case 'rating': {
          const c = root.querySelector('input[name="' + name + '"]:checked');
          out.responses[f.id] = c ? (f.type === 'rating' && c.value !== C.NA ? Number(c.value) : c.value) : '';
          break;
        }
        case 'multiselect':
          out.responses[f.id] = Array.prototype.map.call(root.querySelectorAll('input[name="' + name + '"]:checked'), function (c) { return c.value; });
          break;
        case 'checkbox': {
          const c = root.querySelector('input[name="' + name + '"]');
          out.responses[f.id] = !!(c && c.checked);
          break;
        }
        default: {
          const el = root.querySelector('[name="' + name + '"]');
          out.responses[f.id] = el ? el.value.trim() : '';
        }
      }
    });
    return out;
  }

  function showErrors(root, errors) {
    root.querySelectorAll('.cf').forEach(function (w) {
      const e = errors[w.dataset.cf] || '';
      w.classList.toggle('has-error', !!e);
      const n = w.querySelector('.cf__error');
      if (n) n.textContent = e;
    });
  }

  /** Interactive behaviour: segmented states, counters, N/A toggles, exclusive N/A options. */
  function bind(root, form, onChange) {
    root.addEventListener('change', function (e) {
      const t = e.target;
      if (t.dataset.na) {
        const w = t.closest('.cf');
        w.querySelectorAll('input:not([data-na]), textarea').forEach(function (i) { i.disabled = t.checked; });
      }
      if (t.type === 'radio') {
        const grp = t.closest('.seg, .cf-rating');
        if (grp) grp.querySelectorAll('label').forEach(function (l) { const i = l.querySelector('input'); l.classList.toggle('is-active', !!(i && i.checked)); });
      }
      if (t.type === 'checkbox' && t.closest('.cf-choices--multi') && t.checked) {
        const grp = t.closest('.cf-choices--multi');
        if (t.hasAttribute('data-exclusive')) grp.querySelectorAll('input').forEach(function (i) { if (i !== t) i.checked = false; });
        else grp.querySelectorAll('input[data-exclusive]').forEach(function (i) { i.checked = false; });
      }
      clearError(t);
      if (onChange) onChange();
    });
    root.addEventListener('input', function (e) {
      const t = e.target;
      if (t.hasAttribute('data-count')) {
        const id = t.name.slice(2);
        const c = root.querySelector('[data-counter="' + id + '"]');
        const f = form.fields.find(function (x) { return x.id === id; });
        if (c && f) {
          c.textContent = t.value.length + ' / ' + f.maxLength;
          c.classList.toggle('is-over', t.value.trim().length > Number(f.maxLength));
        }
      }
      clearError(t);
      if (onChange) onChange();
    });
    function clearError(t) {
      const w = t.closest('.cf');
      if (w && w.classList.contains('has-error')) { w.classList.remove('has-error'); w.querySelector('.cf__error').textContent = ''; }
    }
  }

  return { render: render, read: read, bind: bind, showErrors: showErrors, constraintHint: constraintHint };
})();
