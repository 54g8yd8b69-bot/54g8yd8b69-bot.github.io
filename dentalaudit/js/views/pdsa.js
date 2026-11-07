/* DentalAudit — PDSA cycle editor (#/qi/:id/pdsa/:pid, or /pdsa/new) */
DA.views.pdsa = (function () {
  const U = DA.utils, ui = DA.ui, store = DA.store, Q = DA.qi;
  const esc = U.esc;
  let creating = false;
  let stageView = {};   // pid -> stage being viewed
  let dirty = false;

  const STAGES = {
    plan: {
      label: 'Plan', icon: 'fAlign', intro: 'Describe the change, what you expect to happen and how you will know.',
      fields: [
        ['change', 'What change are we testing?', 'textarea', true],
        ['aim', 'What are we trying to achieve?', 'textarea', true],
        ['prediction', 'What is the prediction?', 'textarea', true, 'What do you expect to happen, and why?'],
        ['who', 'Who will be involved?', 'text'],
        ['where', 'Where will the change take place?', 'text'],
        ['data', 'What data will be collected?', 'textarea'],
        ['measure', 'How will success be measured?', 'textarea', true],
        ['startDate', 'Planned start date', 'date', true],
        ['endDate', 'Planned end date', 'date']
      ]
    },
    do: {
      label: 'Do', icon: 'activity', intro: 'Record what actually happened when the change was carried out.',
      fields: [
        ['implemented', 'What was implemented?', 'textarea', true],
        ['when', 'When was it implemented?', 'date', true],
        ['participants', 'Who participated?', 'text'],
        ['deviations', 'Were there any deviations from the original plan?', 'textarea'],
        ['problems', 'What problems occurred?', 'textarea'],
        ['notes', 'Implementation notes', 'textarea']
      ]
    },
    study: {
      label: 'Study', icon: 'analytics', intro: 'Compare what happened with the prediction. Link audit figures where relevant — they are recorded as observed data, not as proof of effect.',
      fields: [
        ['results', 'What were the results?', 'textarea', true],
        ['expected', 'Did the intervention achieve the expected outcome?', 'select', true, '', [['', 'Select…'], ['yes', 'Yes'], ['partly', 'Partly'], ['no', 'No'], ['unclear', 'Too early / unclear']]],
        ['data', 'What did the collected data demonstrate?', 'textarea'],
        ['unexpected', 'Were there any unexpected findings?', 'textarea'],
        ['learned', 'What did we learn?', 'textarea'],
        ['workedWell', 'What worked well?', 'textarea'],
        ['notWell', 'What did not work well?', 'textarea']
      ]
    },
    act: {
      label: 'Act', icon: 'flag', intro: 'Decide what to do next. The decision is yours — DentalAudit never marks a change successful from compliance figures alone.',
      fields: [
        ['rationale', 'Rationale', 'textarea', true],
        ['changes', 'Changes required', 'textarea'],
        ['nextSteps', 'Next steps', 'textarea'],
        ['responsible', 'Responsible person', 'text'],
        ['reviewDate', 'Review date', 'date']
      ]
    }
  };
  const ORDER = ['plan', 'do', 'study', 'act'];
  const REACHED = { planning: 0, doing: 1, studying: 2, acting: 3, completed: 4 };

  function render(el, params) {
    const p = store.getQiProject(params.id);
    if (!p) { DA.views.notFound.render(el); return; }
    if (params.pid === 'new') {
      if (creating) return;
      creating = true;
      const q = params.query || {};
      const prev = Q.pdsaFor(p.id).slice(-1)[0];
      const seed = prev && prev.act.decision === 'adapt' ? { change: prev.act.changes ? 'Adapted change: ' + prev.act.changes : '', aim: prev.plan.aim, interventionId: prev.interventionId } : { interventionId: q.iv || null, aim: p.aim };
      const pd = store.createPdsa(p.id, seed);
      creating = false;
      dirty = false;
      location.replace('#/qi/' + p.id + '/pdsa/' + pd.id);
      return;
    }
    const pd = store.getPdsaCycle(params.pid);
    if (!pd || pd.projectId !== p.id) { DA.views.notFound.render(el); return; }
    paint(el, p, pd);
  }

  function paint(el, p, pd) {
    const st = Q.pdsaStatus(pd);
    const reached = REACHED[st];
    const view = stageView[pd.id] && ORDER.indexOf(stageView[pd.id]) <= Math.min(3, reached) ? stageView[pd.id] : ORDER[Math.min(3, reached)];
    const def = STAGES[view];
    const data = pd[view] || {};
    const ivs = Q.interventionsFor(p.id);
    const iv = pd.interventionId && store.getIntervention(pd.interventionId);
    const prev = pd.previousPdsaId && store.getPdsaCycle(pd.previousPdsaId);
    const locked = st === 'completed';
    dirty = false;

    el.innerHTML =
      '<a class="back-link" href="#/qi/' + p.id + '?tab=pdsa">' + ui.icon('chevronLeft', 15) + esc(p.title) + '</a>' +
      '<div class="page-head page-head--detail"><div><div class="detail-badges"><span class="badge badge--' + Q.PDSA_STATUS[st].tone + '">' + Q.PDSA_STATUS[st].label + '</span>' + (pd.act.decision ? '<span class="pdsa-dec pdsa-dec--' + pd.act.decision + '">' + Q.ACT_DECISIONS[pd.act.decision].label + '</span>' : '') + '</div>' +
        '<h2 class="page-head__title">PDSA cycle ' + pd.cycleNumber + '</h2><p class="page-head__sub">' + esc(pd.plan.change || 'Describe the change being tested in the Plan stage') + '</p></div>' +
        '<div class="page-head__actions">' + (locked ? '<button class="btn btn--ghost" data-act="reopen">' + ui.icon('repeat', 15) + 'Re-open Act</button><a class="btn btn--primary" href="#/qi/' + p.id + '/pdsa/new">' + ui.icon('plus', 15) + 'Start PDSA cycle ' + (Q.pdsaFor(p.id).reduce(function (m, x) { return Math.max(m, x.cycleNumber); }, 0) + 1) + '</a>' : '') +
          '<button class="icon-btn icon-btn--danger" data-act="delete" aria-label="Delete PDSA cycle" title="Delete PDSA cycle">' + ui.icon('trash', 17) + '</button></div></div>' +
      '<ol class="pdsa-steps">' + ORDER.map(function (k, i) {
        const s = i < reached ? 'done' : i === reached ? 'current' : 'todo';
        return '<li class="pdsa-step pdsa-step--' + k + ' pdsa-step--' + s + (k === view ? ' is-view' : '') + '"><button type="button" data-stage="' + k + '"' + (i > reached ? ' disabled' : '') + '><span class="pdsa-step__l">' + (s === 'done' ? ui.icon('check', 13) : k.charAt(0).toUpperCase()) + '</span><span class="pdsa-step__t">' + STAGES[k].label + '<small>' + (pd[k].completedAt ? 'Completed ' + U.fmtDate(pd[k].completedAt) : s === 'current' ? 'In progress' : s === 'todo' ? 'Not started' : '') + '</small></span></button></li>';
      }).join('') + '</ol>' +
      '<div class="pdsa-grid">' +
        '<section class="card pdsa-form"><form id="pd-form" novalidate><div class="card__head"><div><h3 class="card__title">' + ui.icon(def.icon, 16) + ' ' + def.label + '</h3><p class="card__sub">' + esc(def.intro) + '</p></div></div><div class="card__body stack">' +
          (view === 'act' ? decisionHtml(pd, locked) : '') +
          def.fields.map(function (f) { return fieldHtml(f, data[f[0]], locked); }).join('') +
          (view === 'study' ? studyLinkHtml(p, pd, locked) : '') +
          (view === 'act' ? '<p class="pdsa-note">' + ui.icon('shield', 13) + 'Recording “Adopt” does not change the linked intervention’s status or effectiveness. Update those in Interventions after reviewing the evidence.</p>' : '') +
        '</div>' +
        (locked ? '<div class="pdsa-foot"><span class="muted small">' + ui.icon('lockSm', 12) + ' This cycle is completed. Re-open the Act stage to change it.</span></div>' :
          '<div class="pdsa-foot"><span class="save-state" id="pd-state"><span class="save-state__dot"></span>Saved</span><button type="button" class="btn btn--secondary" data-act="save">' + ui.icon('save', 15) + 'Save</button>' +
          '<button type="submit" class="btn btn--primary">' + ui.icon('check', 15) + (view === 'act' ? 'Complete PDSA cycle' : (pd[view].completedAt ? 'Save ' + def.label : 'Complete ' + def.label + ' → ' + STAGES[ORDER[ORDER.indexOf(view) + 1]].label)) + '</button></div>') +
        '</form></section>' +
        '<aside class="stack">' +
          '<section class="card"><div class="card__body stack"><h5 class="pdsa-h5">' + ui.icon('target', 13) + 'Project aim</h5><p class="small">' + esc(p.aim || '—') + '</p>' +
            '<label class="field"><span class="field__label">Linked intervention</span><select class="select input--sm" id="pd-iv"' + (locked ? ' disabled' : '') + '><option value="">Not linked</option>' + ivs.map(function (i) { return '<option value="' + i.id + '"' + (i.id === pd.interventionId ? ' selected' : '') + '>' + esc(i.title) + '</option>'; }).join('') + '</select></label>' +
            (iv ? '<p class="small muted">' + esc(iv.responsiblePerson || '—') + ' · ' + Q.IV_STATUS[iv.status].label + ' · due ' + (iv.targetDate ? U.fmtDate(iv.targetDate) : '—') + '</p>' : '') +
          '</div></section>' +
          (prev ? '<section class="card"><div class="card__body"><h5 class="pdsa-h5">' + ui.icon('repeat', 13) + 'Previous cycle · PDSA ' + prev.cycleNumber + '</h5><p class="small"><strong>' + esc(prev.plan.change || '—') + '</strong></p>' + (prev.act.decision ? '<p class="small"><span class="pdsa-dec pdsa-dec--' + prev.act.decision + '">' + Q.ACT_DECISIONS[prev.act.decision].label + '</span> ' + esc(prev.act.rationale || '') + '</p>' : '') + (prev.act.changes ? '<p class="small muted">Changes required: ' + esc(prev.act.changes) + '</p>' : '') + '<a class="link-btn small" href="#/qi/' + p.id + '/pdsa/' + prev.id + '">Open PDSA ' + prev.cycleNumber + '</a></div></section>' : '') +
          '<section class="card"><div class="card__body"><h5 class="pdsa-h5">' + ui.icon('activity', 13) + 'All PDSA cycles</h5>' + DA.views.qi.pdsaRail(p, Q.pdsaFor(p.id)) + '</div></section>' +
        '</aside>' +
      '</div>';

    const form = el.querySelector('#pd-form');
    const collect = function () {
      const v = {};
      def.fields.forEach(function (f) { const x = form.elements[f[0]]; if (x) v[f[0]] = x.value.trim(); });
      if (view === 'act') { const d = form.querySelector('input[name=decision]:checked'); v.decision = d ? d.value : ''; }
      return v;
    };
    const required = function (v) {
      let bad = false;
      form.querySelectorAll('.field').forEach(function (w) { w.classList.remove('has-error'); });
      def.fields.forEach(function (f) { if (f[3] && !v[f[0]]) { form.querySelector('[data-f="' + f[0] + '"]').classList.add('has-error'); bad = true; } });
      if (view === 'plan' && v.endDate && v.startDate && v.endDate < v.startDate) { const w = form.querySelector('[data-f=endDate]'); w.classList.add('has-error'); w.querySelector('.field__error').textContent = 'Must be after the start date.'; bad = true; }
      if (view === 'act' && !v.decision) { form.querySelector('.pdsa-decs').classList.add('has-error'); bad = true; }
      return !bad;
    };
    if (!locked) {
      form.addEventListener('input', function () { dirty = true; const s = el.querySelector('#pd-state'); if (s) { s.classList.add('is-dirty'); s.lastChild.textContent = 'Unsaved changes'; } });
      form.addEventListener('change', function (e) {
        if (e.target.name === 'decision') form.querySelectorAll('.pdsa-dec-card').forEach(function (l) { l.classList.toggle('is-checked', l.querySelector('input').checked); });
      });
      el.querySelector('[data-act=save]').addEventListener('click', function () { store.savePdsaStage(pd.id, view, collect(), false); dirty = false; ui.toast(def.label + ' saved', 'success'); });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        const v = collect();
        if (!required(v)) { ui.toast('Complete the required fields first', 'error'); return; }
        if (view === 'act') {
          ui.confirm({
            title: 'Complete PDSA cycle ' + pd.cycleNumber + '?', confirmLabel: 'Complete cycle',
            message: 'Decision: ' + Q.ACT_DECISIONS[v.decision].label + ' — ' + Q.ACT_DECISIONS[v.decision].text + (v.decision === 'adapt' ? ' You can start the next PDSA cycle straight away.' : ''),
            onConfirm: function () { store.savePdsaStage(pd.id, 'act', v, true); dirty = false; ui.toast('PDSA cycle ' + pd.cycleNumber + ' completed', 'success'); }
          });
          return;
        }
        store.savePdsaStage(pd.id, view, v, true);
        dirty = false;
        stageView[pd.id] = pd[view].completedAt && REACHED[Q.pdsaStatus(store.getPdsaCycle(pd.id))] > ORDER.indexOf(view) ? ORDER[ORDER.indexOf(view) + 1] : view;
        ui.toast(def.label + ' completed', 'success');
        DA.router.refresh(true);
      });
      const ivSel = el.querySelector('#pd-iv');
      ivSel.addEventListener('change', function () { store.updatePdsa(pd.id, { interventionId: ivSel.value || null }); ui.toast('Linked intervention updated', 'success'); });
      const link = el.querySelector('[data-act=link-analytics]');
      if (link) link.addEventListener('click', function () { linkModal(p, pd); });
      const unl = el.querySelector('[data-act=unlink-analytics]');
      if (unl) unl.addEventListener('click', function () { store.savePdsaStage(pd.id, 'study', { linkedAnalytics: null }, false); });
    }
    el.querySelectorAll('[data-stage]').forEach(function (b) {
      b.addEventListener('click', function () {
        const go = function () { stageView[pd.id] = b.dataset.stage; DA.router.refresh(true); };
        if (dirty) ui.confirm({ title: 'Discard unsaved changes?', message: 'Your changes to the ' + def.label + ' stage have not been saved.', confirmLabel: 'Discard', danger: true, onConfirm: go });
        else go();
      });
    });
    const re = el.querySelector('[data-act=reopen]');
    if (re) re.addEventListener('click', function () { store.reopenPdsa(pd.id); stageView[pd.id] = 'act'; ui.toast('Act stage re-opened', 'success'); });
    el.querySelector('[data-act=delete]').addEventListener('click', function () {
      ui.confirm({ title: 'Delete PDSA cycle ' + pd.cycleNumber + '?', danger: true, confirmLabel: 'Delete PDSA cycle', message: 'The Plan, Do, Study and Act records of this cycle will be permanently deleted. Interventions and audit data are not affected.',
        onConfirm: function () { store.deletePdsa(pd.id); ui.toast('PDSA cycle deleted', 'success'); location.hash = '#/qi/' + p.id + '?tab=pdsa'; } });
    });
  }

  function fieldHtml(f, val, locked) {
    const name = f[0], label = f[1], type = f[2], req = f[3], hint = f[4];
    const dis = locked ? ' disabled' : '';
    let control;
    if (type === 'textarea') control = '<textarea class="textarea" name="' + name + '" rows="2"' + dis + '>' + esc(val || '') + '</textarea>';
    else if (type === 'select') control = '<select class="select" name="' + name + '"' + dis + '>' + f[5].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === (val || '') ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>';
    else control = '<input class="input" type="' + type + '" name="' + name + '" value="' + esc(val || '') + '"' + dis + '>';
    return '<label class="field" data-f="' + name + '"><span class="field__label">' + label + (req ? ' <span class="req">*</span>' : '') + '</span>' + control + (hint ? '<span class="field__hint">' + hint + '</span>' : '') + '<span class="field__error">Required.</span></label>';
  }

  function decisionHtml(pd, locked) {
    return '<fieldset class="field pdsa-decs"><legend class="field__label">Decision <span class="req">*</span></legend><div class="pdsa-dec-grid">' +
      Object.keys(Q.ACT_DECISIONS).map(function (k) {
        const d = Q.ACT_DECISIONS[k];
        return '<label class="pdsa-dec-card pdsa-dec-card--' + k + (pd.act.decision === k ? ' is-checked' : '') + '"><input type="radio" name="decision" value="' + k + '"' + (pd.act.decision === k ? ' checked' : '') + (locked ? ' disabled' : '') + '><strong>' + d.label + '</strong><span>' + d.text + '</span></label>';
      }).join('') + '</div><span class="field__error">Choose Adopt, Adapt or Abandon.</span></fieldset>';
  }

  function studyLinkHtml(p, pd, locked) {
    const la = pd.study.linkedAnalytics;
    return '<div class="pdsa-link"><h5 class="pdsa-h5">' + ui.icon('link', 13) + 'Linked audit analytics</h5>' +
      (la ? '<p class="small muted">' + esc(la.label) + ' · figures recorded ' + U.fmtDate(la.capturedAt, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' from the analytics engine (' + la.completed + ' completed cases). They do not change if data are edited later.</p>' +
        '<table class="qn-crit"><thead><tr><th>Criterion</th><th>Target</th><th>Compliance</th>' + (la.baseline ? '<th>vs baseline</th>' : '') + '</tr></thead><tbody>' + la.rows.map(function (r) {
          return '<tr><td>' + esc(r.name) + '</td><td>' + r.target + '%</td><td><strong>' + Q.fmtPct(r.compliance) + '</strong> <span class="muted small">' + r.met + '/' + r.denominator + '</span></td>' + (la.baseline ? '<td>' + Q.fmtPP(r.pp) + '</td>' : '') + '</tr>';
        }).join('') + '</tbody></table>' + (locked ? '' : '<div class="pdsa-link__btns"><button type="button" class="btn btn--ghost btn--sm" data-act="link-analytics">Update link</button><button type="button" class="link-btn small" data-act="unlink-analytics">Remove</button></div>')
        : '<p class="small muted">Optionally attach the latest cycle results so the Study findings are traceable to the audit data.</p>' + (locked ? '' : '<button type="button" class="btn btn--secondary btn--sm" data-act="link-analytics"' + (p.auditId ? '' : ' disabled title="Link an audit to the project first"') + '>' + ui.icon('analytics', 14) + 'Link audit analytics</button>')) +
    '</div>';
  }

  function linkModal(p, pd) {
    const a = store.getAudit(p.auditId);
    const ser = Q.series(a).filter(function (r) { return r.cycle.records.some(function (x) { return x.status === 'completed'; }); });
    if (!ser.length) { ui.toast('No cycle with completed cases yet', 'error'); return; }
    ui.modal({
      title: 'Link audit analytics', confirmLabel: 'Link figures',
      subtitle: 'The selected cycle’s criterion results are copied into this Study record with the date they were taken.',
      body: '<label class="field"><span class="field__label">Audit cycle</span><select class="select" name="key">' + ser.map(function (r, i) { return '<option value="' + r.key + '"' + (i === ser.length - 1 ? ' selected' : '') + '>' + esc(r.label) + '</option>'; }).join('') + '</select></label>' +
        '<label class="mini-toggle"><input type="checkbox" name="targeted" checked> Only criteria targeted by the project</label>',
      onConfirm: function (form) {
        const r = Q.ref(form.elements.key.value);
        const res = Q.cycleResults(r);
        const keyOf = Q.criterionKeyer(a);
        const tk = (p.targetCriteria || []).map(keyOf);
        const rows = res.rows.filter(function (x) { return !form.elements.targeted.checked || !tk.length || tk.indexOf(x.key) !== -1; }).map(function (x) {
          const b = p.baseline && p.baseline.rows.find(function (y) { return keyOf(y.criterionId) === x.key; });
          return { key: x.key, name: x.name, target: x.target, compliance: x.compliance, met: x.met, denominator: x.denominator, pp: b && b.compliance !== null && x.compliance !== null && (!p.baseline || p.baseline.cycleId !== r.cycle.id) ? x.compliance - b.compliance : null };
        });
        store.savePdsaStage(pd.id, 'study', { linkedAnalytics: { refKey: r.key, label: res.label, completed: res.completed, capturedAt: new Date().toISOString(), baseline: !!(p.baseline && p.baseline.cycleId !== r.cycle.id), rows: rows } }, false);
        ui.toast('Audit figures linked to the Study stage', 'success');
      }
    });
  }

  return {
    nav: 'qi', keepOnStoreChange: false,
    title: function () { return 'PDSA Cycle'; },
    crumbs: function (p) {
      const x = store.getQiProject(p.id);
      const pd = p.pid !== 'new' && store.getPdsaCycle(p.pid);
      return [{ label: 'Quality Improvement', href: '#/qi' }, { label: x ? x.title : 'Project', href: x ? '#/qi/' + x.id + '?tab=pdsa' : null }, { label: pd ? 'PDSA ' + pd.cycleNumber : 'PDSA' }];
    },
    render: render
  };
})();
