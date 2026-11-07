/* DentalAudit — Add / Edit Case
 * Routes: #/collect/:id/new  and  #/collect/:id/case/:caseId/edit
 * Inputs are generated from the current cycle's saved form definition.
 */
DA.views.caseEntry = (function () {
  const U = DA.utils, ui = DA.ui, C = DA.collection, store = DA.store, R = DA.formRenderer;
  let dirty = false;
  let busy = false;

  window.addEventListener('beforeunload', function (e) {
    if (dirty && /^#\/collect\/[^/]+\/(new|case\/[^/]+\/edit)/.test(location.hash)) { e.preventDefault(); e.returnValue = ''; }
  });

  function render(el, params) {
    const audit = store.getAudit(params.id);
    if (!audit) { DA.views.notFound.render(el); return; }
    const DC = DA.views.dataCollection;
    if (audit.status === 'draft') { DC.draftNotice(el, audit); return; }
    const cyc = C.currentCycle(audit);
    const editing = !!params.caseId;
    const rec = editing ? cyc.records.find(function (r) { return r.id === params.caseId; }) : null;
    if (editing && !rec) { DA.views.notFound.render(el); return; }
    dirty = false;
    busy = false;

    const head = DC.header(audit, 'entry');
    if (!C.canCollect(audit)) {
      el.innerHTML = head + '<div class="card">' + ui.emptyState({ icon: 'lockSm', title: 'Data collection is closed', text: 'This audit cycle is completed, so cases can no longer be added or edited.', action: 'View collected data', href: '#/collect/' + audit.id }) + '</div>';
      return;
    }
    if (!C.hasForm(audit)) {
      el.innerHTML = head + '<div class="card">' + ui.emptyState({ icon: 'fChecks', title: 'No data collection form yet', text: 'Design and save the form for this audit before recording cases.', action: 'Design collection form', href: '#/collect/' + audit.id + '/form', actionIcon: 'fChecks' }) + '</div>';
      return;
    }

    const form = cyc.form;
    const state = editing
      ? { caseReference: rec.caseReference, collectionDate: rec.collectionDate, responses: Object.assign({}, rec.responses) }
      : { caseReference: C.nextCaseReference(cyc).ref + ' (on save)', collectionDate: U.isoDay(new Date()), responses: {} };
    if (!editing) form.fields.forEach(function (f) { state.responses[f.id] = C.initialValue(f, state.collectionDate); });
    else form.fields.forEach(function (f) { if (state.responses[f.id] === undefined) state.responses[f.id] = C.initialValue(f, rec.collectionDate); });

    const builderDirty = DA.views.formBuilder.hasUnsaved(audit.id);
    const olderVersion = editing && rec.formVersion < form.version;
    const done = C.completedRecords(audit).length;

    el.innerHTML = head +
      '<div class="entry">' +
        '<section class="card entry__card">' +
          '<div class="entry__head">' +
            '<div><h3>' + (editing ? 'Edit ' + U.esc(rec.caseReference) : 'New case') + '</h3>' +
              '<p class="muted small">' + U.esc(cyc.label) + ' · form v' + form.version + ' · ' + form.fields.length + ' fields · ' + done + ' of ' + audit.targetSampleSize + ' cases completed</p></div>' +
            (editing ? '<span class="badge ' + (rec.status === 'completed' ? 'badge--green' : 'badge--amber') + '">' + (rec.status === 'completed' ? 'Completed' : 'Incomplete') + '</span>' : '') +
          '</div>' +
          '<div class="privacy-note">' + ui.icon('shield', 15) + '<span>Use the case reference only. Do not record patient names, dates of birth, CHI/NHS or hospital numbers anywhere on this form.</span></div>' +
          (builderDirty ? '<div class="alert alert--info alert--sm">' + ui.icon('fChecks', 14) + '<div>The form builder has unsaved changes. Cases use the last saved form (v' + form.version + ').</div></div>' : '') +
          (olderVersion ? '<div class="alert alert--info alert--sm">' + ui.icon('refresh', 14) + '<div>This case was collected with form v' + rec.formVersion + '. Saving updates it to v' + form.version + '; answers to fields no longer on the form are kept in the record.</div></div>' : '') +
          '<div class="alert alert--error" id="err-summary" hidden></div>' +
          '<form id="case-form" novalidate>' + R.render(form, state, { criteria: audit.criteria, showLinks: false }) + '</form>' +
          '<div class="entry__foot">' +
            '<a class="btn btn--ghost" href="' + (editing ? '#/collect/' + audit.id + '/case/' + rec.id : '#/collect/' + audit.id) + '" id="cancel">Cancel</a>' +
            '<div class="entry__actions">' +
              '<button type="button" class="btn btn--secondary" data-save="draft">' + ui.icon('save', 15) + 'Save as incomplete</button>' +
              (!editing ? '<button type="button" class="btn btn--secondary" data-save="another">Submit &amp; add another</button>' : '') +
              '<button type="button" class="btn btn--primary" data-save="complete">' + ui.icon('check', 15) + (editing && rec.status === 'completed' ? 'Save changes' : 'Submit case') + '</button>' +
            '</div>' +
          '</div>' +
        '</section>' +
      '</div>';

    const formEl = el.querySelector('#case-form');
    R.bind(formEl, form, function () { dirty = true; el.querySelector('#err-summary').hidden = true; });

    el.querySelector('#cancel').addEventListener('click', function (e) {
      if (!dirty) return;
      e.preventDefault();
      const href = e.currentTarget.getAttribute('href');
      ui.confirm({ title: 'Discard this case?', message: 'Your unsaved answers will be lost.', confirmLabel: 'Discard', danger: true, onConfirm: function () { dirty = false; location.hash = href; } });
    });

    el.querySelectorAll('[data-save]').forEach(function (b) {
      b.addEventListener('click', function () { save(el, audit, form, rec, b.dataset.save); });
    });
  }

  function save(el, audit, form, rec, how) {
    if (busy) return;
    const formEl = el.querySelector('#case-form');
    const data = R.read(formEl, form);
    const mode = how === 'draft' ? 'draft' : 'complete';
    const v = C.validateRecord(form, data, mode);
    R.showErrors(formEl, v.errors);
    const summary = el.querySelector('#err-summary');
    if (v.count) {
      const labels = form.fields.filter(function (f) { return v.errors[f.id]; }).map(function (f) { return f.label; });
      if (v.errors._date) labels.unshift('Date of data collection');
      summary.innerHTML = ui.icon('alert', 16) + '<div><strong>' + v.count + ' answer' + (v.count === 1 ? ' needs' : 's need') + ' attention' + (mode === 'draft' ? ' before saving' : ' before submitting') + '.</strong>' +
        '<ul>' + labels.slice(0, 6).map(function (l) { return '<li>' + U.esc(l) + '</li>'; }).join('') + (labels.length > 6 ? '<li>…and ' + (labels.length - 6) + ' more</li>' : '') + '</ul>' +
        (mode === 'complete' ? '<p class="small">Not finished? Use “Save as incomplete” to keep your progress.</p>' : '') + '</div>';
      summary.hidden = false;
      const first = formEl.querySelector('.cf.has-error');
      (first || summary).scrollIntoView({ block: 'center', behavior: 'smooth' });
      const inp = first && first.querySelector('input:not([type=hidden]), select, textarea');
      if (inp) setTimeout(function () { inp.focus({ preventScroll: true }); }, 250);
      ui.toast('Please correct the highlighted answers', 'error');
      return;
    }
    busy = true;
    const saved = store.saveRecord(audit.id, { id: rec ? rec.id : null, collectionDate: data.collectionDate, responses: data.responses, status: mode === 'draft' ? 'draft' : 'completed' });
    dirty = false;
    if (mode === 'draft') ui.toast(saved.caseReference + ' saved as incomplete', 'success');
    else ui.toast(saved.caseReference + (rec ? ' updated' : ' submitted'), 'success');
    if (how === 'another') { DA.router.refresh(true); document.getElementById('main').scrollTop = 0; return; }
    location.hash = rec ? '#/collect/' + audit.id + '/case/' + saved.id : '#/collect/' + audit.id;
  }

  return {
    nav: 'collect',
    keepOnStoreChange: true,
    title: function (p) {
      if (!p.caseId) return 'Add New Case';
      const a = store.getAudit(p.id);
      const r = a && C.records(a).find(function (x) { return x.id === p.caseId; });
      return r ? 'Edit ' + r.caseReference : 'Edit case';
    },
    crumbs: function (p) {
      const a = store.getAudit(p.id);
      const r = p.caseId && a ? C.records(a).find(function (x) { return x.id === p.caseId; }) : null;
      return DA.views.dataCollection.crumbsFor(p, p.caseId ? (r ? 'Edit ' + r.caseReference : 'Edit case') : 'New case');
    },
    render: render
  };
})();
