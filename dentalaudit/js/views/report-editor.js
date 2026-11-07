/* DentalAudit — Report editor and preview
 * Routes: #/reports/:id (editor)   #/reports/:id/preview[?rev=N] (read-only document)
 *
 * The editor works on an in-memory copy of the report (session.draft). "Save draft"
 * writes it to the store. Approved, archived and in-review reports are read-only; an
 * approved report can only change by starting a new revision.
 */
DA.views.reportEditor = (function () {
  const U = DA.utils, ui = DA.ui, E = DA.reportEngine, R = DA.reportRender, store = DA.store, AI = DA.ai;
  const sessions = {};
  let s = null, el = null;

  const STATE = {
    reviewed: { label: 'Reviewed', icon: 'check', tone: 'good' },
    generated: { label: 'Auto-generated', icon: 'refresh', tone: 'blue' },
    edited: { label: 'Edited', icon: 'collect', tone: 'blue' },
    needs_review: { label: 'Figures changed — review', icon: 'alert', tone: 'warn' },
    ai_draft: { label: 'AI draft — review required', icon: 'alert', tone: 'warn' },
    incomplete: { label: 'Needs content', icon: 'alert', tone: 'bad' },
    excluded: { label: 'Excluded', icon: 'x', tone: 'muted' }
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function sessionFor(report) {
    let x = sessions[report.id];
    if (!x || (!x.dirty && x.stamp !== report.updatedAt + '|' + report.revision + '|' + report.status)) {
      x = sessions[report.id] = {
        id: report.id, draft: clone(report), stamp: report.updatedAt + '|' + report.revision + '|' + report.status,
        dirty: false, active: (x && x.active) || 'executive', panel: (x && x.panel) || 'assistant', ai: null, busy: false, range: null
      };
    }
    return x;
  }

  function locked(r) { return r.status === 'approved' || r.status === 'archived' || r.status === 'in_review'; }
  function report() { return store.getReport(s.id); }
  function audit() { return store.getAudit(s.draft.auditId); }
  function isLead() {
    const u = (store.getSettings().userName || '').trim().toLowerCase();
    return !!u && (u === String(s.draft.meta.auditLead || '').trim().toLowerCase() || (audit() && u === String(audit().auditLead || '').trim().toLowerCase()));
  }

  window.addEventListener('beforeunload', function (e) {
    if (s && s.dirty && /^#\/reports\/[^/]+$/.test(location.hash)) { e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && s && el && document.body.contains(el)) { e.preventDefault(); save(); }
  });

  /* =========================================================
   * Frame
   * ========================================================= */
  function render(target, params) {
    const r = store.getReport(params.id);
    if (!r) { DA.views.notFound.render(target); return; }
    R.ensureDocCss();
    s = sessionFor(r);
    target.innerHTML = '<div class="re-root"></div>';
    el = target.firstChild;
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    el.addEventListener('change', onChange);
    el.addEventListener('paste', onPaste);
    document.addEventListener('selectionchange', trackRange);
    paint();
  }

  function paint() {
    const d = s.draft;
    const live = report();
    const lock = locked(live);
    const a = audit();
    const changed = E.datasetChanged(live);
    const scroll = document.getElementById('main').scrollTop;
    el.innerHTML =
      '<header class="re-head">' +
        '<div class="re-head__left">' +
          '<a class="back-link" href="#/reports">' + ui.icon('chevronLeft', 15) + 'All reports</a>' +
          '<h2 class="re-head__title">' + U.esc(d.title) + '</h2>' +
          '<div class="re-head__meta">' + DA.views.reports.statusBadge(live.status) + '<span class="badge">Revision ' + live.revision + '</span><span>' + U.esc(E.TYPES[d.reportType]) + '</span>' +
            (a ? '<a href="#/audits/' + a.id + '?tab=reports">' + U.esc(a.title) + '</a>' : '') + '</div>' +
        '</div>' +
        '<div class="re-head__actions">' +
          '<span class="save-state' + (s.dirty ? ' is-dirty' : '') + '" id="re-save-state"><span class="save-state__dot"></span>' + (s.dirty ? 'Unsaved changes' : 'Saved ' + U.relTime(live.updatedAt)) + '</span>' +
          '<a class="btn btn--ghost" href="#/reports/' + d.id + '/preview">' + ui.icon('eye', 15) + 'Preview</a>' +
          '<div class="menu-wrap"><button class="btn btn--secondary" data-act="export-menu" aria-haspopup="true">' + ui.icon('download', 15) + 'Export' + ui.icon('chevronDown', 14) + '</button>' +
            '<div class="popover popover--right export-menu" id="export-menu" hidden>' +
              '<button class="popover__item" data-export="pdf">' + ui.icon('file', 16) + '<span class="result__body"><span class="result__title" style="display:block">PDF document</span><span class="result__meta" style="display:block">Title page, contents, page numbers</span></span></button>' +
              '<button class="popover__item" data-export="docx">' + ui.icon('reports', 16) + '<span class="result__body"><span class="result__title" style="display:block">Word document (.docx)</span><span class="result__meta" style="display:block">Editable headings and tables</span></span></button>' +
              '<button class="popover__item" data-export="html">' + ui.icon('fAlign', 16) + '<span class="result__body"><span class="result__title" style="display:block">Web page (.html)</span><span class="result__meta" style="display:block">Standalone, opens in any browser</span></span></button>' +
              '<div class="popover__sep"></div>' +
              '<button class="popover__item" data-export="print">' + ui.icon('printer', 16) + 'Print…</button>' +
            '</div></div>' +
          (lock ? '' : '<button class="btn btn--primary" data-act="save"' + (s.dirty ? '' : ' disabled') + '>' + ui.icon('save', 15) + 'Save draft</button>') +
        '</div>' +
      '</header>' +
      (changed && live.status !== 'archived' ? '<div class="alert alert--info re-banner">' + ui.icon('refresh', 16) + '<div><strong>The audit data has changed since this report was generated</strong> (snapshot ' + U.fmtDate(live.snapshotAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '). The figures below are unchanged. <button class="link-btn" data-act="refresh">Regenerate results as a new revision</button></div></div>' : '') +
      (live.status === 'approved' ? '<div class="alert alert--good re-banner">' + ui.icon('lockSm', 16) + '<div><strong>Approved revision ' + live.revision + '</strong> — approved by ' + U.esc(live.review.approvedBy || '') + ' on ' + U.fmtDate(live.review.approvalDate) + '. This revision is read-only. <button class="link-btn" data-act="new-revision">Start revision ' + (live.revision + 1) + ' to make changes</button></div></div>' : '') +
      (live.status === 'archived' ? '<div class="alert alert--info re-banner">' + ui.icon('lockSm', 16) + '<div><strong>Archived.</strong> This report is read-only. <button class="link-btn" data-act="new-revision">Restore as a new draft revision</button></div></div>' : '') +
      (live.status === 'in_review' ? '<div class="alert alert--info re-banner">' + ui.icon('eye', 16) + '<div><strong>In review</strong> with ' + U.esc(live.review.reviewer || 'the reviewer') + '. Content is locked while under review; add reviewer comments in the Report panel, or <button class="link-btn" data-act="to-draft">return it to draft</button> to edit.</div></div>' : '') +
      '<div class="re' + (lock ? ' is-locked' : '') + '">' +
        '<nav class="re-nav" aria-label="Report sections">' + navHtml(lock) + '</nav>' +
        '<div class="re-main">' + (lock ? '' : toolbarHtml()) + '<div class="re-paper doc" id="re-paper">' + paperHtml(lock) + '</div></div>' +
        '<aside class="re-side">' + sideHtml(lock) + '</aside>' +
      '</div>';
    R.hydrate(el.querySelector('#re-paper'), s.draft);
    if (!lock) el.querySelectorAll('#re-paper .rb').forEach(addBlockTools);
    document.getElementById('main').scrollTop = scroll;
  }

  /* =========================================================
   * Left — section navigation
   * ========================================================= */
  function navHtml(lock) {
    const d = s.draft;
    const inc = d.sectionOrder.filter(function (k) { return d.sections[k].included; });
    const reviewed = inc.filter(function (k) { return E.sectionState(d.sections[k]) === 'reviewed'; }).length;
    const body = d.sectionOrder.filter(function (k) { return k !== 'title'; });
    return '<div class="re-nav__head"><h4>Sections</h4><span class="muted small">' + reviewed + ' of ' + inc.length + ' reviewed</span></div>' +
      '<div class="progress re-nav__progress">' + '<span style="width:' + (inc.length ? reviewed / inc.length * 100 : 0) + '%"></span></div>' +
      '<ol class="re-nav__list">' +
        navItem('title', d.sections.title, 0, lock, true) +
        body.map(function (k, i) { return navItem(k, d.sections[k], i, lock, false, body.length); }).join('') +
      '</ol>' +
      '<div class="re-nav__legend"><span><i class="st st--good"></i>Reviewed</span><span><i class="st st--blue"></i>Generated / edited</span><span><i class="st st--warn"></i>Needs review</span></div>';
  }

  function navItem(k, sec, i, lock, isTitle, n) {
    const st = E.sectionState(sec);
    const m = STATE[st] || STATE.generated;
    return '<li class="re-nav__item' + (s.active === k ? ' is-active' : '') + (sec.included ? '' : ' is-excluded') + '">' +
      '<button class="re-nav__go" data-go="' + k + '" title="' + m.label + '"><span class="st st--' + m.tone + '">' + ui.icon(m.icon, 10) + '</span><span class="re-nav__label">' + U.esc(sec.title) + '</span></button>' +
      (lock || isTitle ? '' : '<span class="re-nav__tools">' +
        '<button class="icon-btn icon-btn--xs" data-nav-move="up" data-key="' + k + '" aria-label="Move ' + U.esc(sec.title) + ' up"' + (i === 0 ? ' disabled' : '') + '>' + ui.icon('chevronUp', 12) + '</button>' +
        '<button class="icon-btn icon-btn--xs" data-nav-move="down" data-key="' + k + '" aria-label="Move ' + U.esc(sec.title) + ' down"' + (i === n - 1 ? ' disabled' : '') + '>' + ui.icon('chevronDown', 12) + '</button>' +
        '<label class="re-nav__inc" title="' + (sec.included ? 'Included — click to exclude' : 'Excluded — click to include') + '"><input type="checkbox" data-include="' + k + '"' + (sec.included ? ' checked' : '') + '><span>' + ui.icon(sec.included ? 'eye' : 'x', 12) + '</span></label>' +
      '</span>') +
    '</li>';
  }

  /* =========================================================
   * Centre — toolbar and document
   * ========================================================= */
  function toolbarHtml() {
    const tb = function (cmd, icon, label, txt) { return '<button type="button" class="tb" data-cmd="' + cmd + '" title="' + label + '" aria-label="' + label + '">' + (icon ? ui.icon(icon, 15) : '') + (txt ? '<span>' + txt + '</span>' : '') + '</button>'; };
    return '<div class="re-toolbar" role="toolbar" aria-label="Formatting">' +
      '<select class="tb-select" data-cmd-block aria-label="Text style"><option value="p">Paragraph</option><option value="h3">Heading</option><option value="h4">Subheading</option></select>' +
      '<span class="tb-sep"></span>' + tb('bold', null, 'Bold (Ctrl+B)', '<strong>B</strong>') + tb('italic', null, 'Italic (Ctrl+I)', '<em>I</em>') +
      '<span class="tb-sep"></span>' + tb('insertUnorderedList', 'fList', 'Bullet list') + tb('insertOrderedList', 'fChecks', 'Numbered list') +
      '<span class="tb-sep"></span>' + tb('table', 'dashboard', 'Insert table', 'Table') +
      '<div class="menu-wrap"><button type="button" class="tb" data-act="insert-menu" title="Insert data table or chart">' + ui.icon('analytics', 15) + '<span>Insert data</span>' + ui.icon('chevronDown', 12) + '</button>' +
        '<div class="popover insert-menu" id="insert-menu" hidden>' + R.insertableBlocks(s.draft).map(function (b) {
          return '<button class="popover__item" data-insert="' + b.key + '"' + (b.arg ? ' data-arg="' + U.esc(b.arg) + '"' : '') + '>' + ui.icon(b.chart ? 'analytics' : 'fList', 15) + U.esc(b.label) + '</button>';
        }).join('') + '<p class="insert-menu__note">Inserted from the frozen analytics snapshot</p></div></div>' +
      '<span class="tb-sep"></span>' + tb('undo', 'chevronLeft', 'Undo') + tb('redo', 'chevronRight', 'Redo') +
    '</div>';
  }

  function sectionActions(k, sec, lock) {
    if (lock) return '';
    const st = E.sectionState(sec);
    return '<div class="re-sec__actions">' +
      (k !== 'references' && k !== 'actionplan' ? '<button class="btn btn--ghost btn--xs" data-regen="' + k + '" title="Rebuild this section from the audit data (not AI)">' + ui.icon('refresh', 13) + 'Regenerate</button>' : '') +
      '<button class="btn btn--ghost btn--xs" data-ai-for="' + k + '">' + ui.icon('fStar', 13) + 'Assistant</button>' +
      (st !== 'reviewed' ? '<button class="btn btn--secondary btn--xs" data-reviewed="' + k + '">' + ui.icon('check', 13) + 'Mark reviewed</button>' : '<span class="re-sec__ok">' + ui.icon('check', 13) + 'Reviewed</span>') +
    '</div>';
  }

  function paperHtml(lock) {
    const d = s.draft;
    let n = 0;
    return (d.sections.title.included ? '<div class="re-title" data-go-anchor="title" id="re-sec-title">' + R.titlePage(d) +
        (lock ? '' : '<button class="btn btn--secondary btn--sm re-title__edit" data-act="edit-meta">' + ui.icon('collect', 14) + 'Edit title page details</button>') + '</div>' : '') +
      d.sectionOrder.filter(function (k) { return k !== 'title' && d.sections[k].included; }).map(function (k) {
        const sec = d.sections[k];
        n++;
        const st = E.sectionState(sec);
        const m = STATE[st] || STATE.generated;
        return '<section class="re-sec' + (s.active === k ? ' is-active' : '') + '" id="re-sec-' + k + '" data-sec="' + k + '">' +
          '<header class="re-sec__head"><h2><span class="re-sec__num">' + n + '.</span> ' + U.esc(sec.title) + '</h2>' +
            '<span class="re-chip re-chip--' + m.tone + '">' + ui.icon(m.icon, 11) + m.label + '</span>' + sectionActions(k, sec, lock) + '</header>' +
          (sec.aiDraft ? '<div class="ai-flag">' + ui.icon('fStar', 13) + '<span><strong>AI-assisted draft.</strong> Check every statement against the audit data. The audit lead must mark this section reviewed before the report can be approved.</span></div>' : '') +
          (st === 'needs_review' ? '<div class="ai-flag ai-flag--data">' + ui.icon('refresh', 13) + '<span>Results were regenerated after this text was edited. Tables update automatically, but check any figures written in the text.</span></div>' : '') +
          '<div class="re-body" data-body="' + k + '"' + (lock ? '' : ' contenteditable="true" spellcheck="true"') + '>' + sec.html + '</div>' +
          (k === 'actionplan' ? actionBuilderHtml(lock) : '') +
          (k === 'references' ? refsHtml(lock) : '') +
          (lock ? '' : '<button class="re-addp" data-addp="' + k + '">' + ui.icon('plus', 13) + 'Add paragraph</button>') +
        '</section>';
      }).join('');
  }

  function addBlockTools(b) {
    const meta = R.BLOCKS[b.getAttribute('data-block')] || { label: 'Data block' };
    const tools = document.createElement('div');
    tools.className = 'rb-tools';
    tools.innerHTML = '<span>' + ui.icon('lockSm', 11) + U.esc(meta.label) + ' · from analytics snapshot</span><button type="button" data-rb-remove>Remove</button>';
    b.insertBefore(tools, b.firstChild);
  }

  /* ---------- Action plan builder ---------- */
  function actionBuilderHtml(lock) {
    const d = s.draft;
    const snap = d.analyticsSnapshot;
    const pending = d.actionPlan.filter(function (x) { return !x.approved; });
    const approved = d.actionPlan.filter(function (x) { return x.approved; });
    const critName = function (id) { const c = snap.criteria.find(function (x) { return x.id === id; }); return c ? c.name : '—'; };
    return '<div class="ap" contenteditable="false">' +
      '<div class="ap__head"><h4>' + ui.icon('flag', 14) + 'Action plan builder</h4>' +
        (lock ? '' : '<div class="ap__btns"><button class="btn btn--ghost btn--sm" data-act="suggest-actions">' + ui.icon('target', 14) + 'Suggest from findings</button><button class="btn btn--secondary btn--sm" data-act="add-action">' + ui.icon('plus', 14) + 'Add action</button></div>') + '</div>' +
      (pending.length ? '<div class="ap__pending"><p class="ap__note">' + ui.icon('alert', 13) + pending.length + ' suggested action' + (pending.length === 1 ? '' : 's') + ' based on criteria below target. Review, edit and approve each one — suggestions do not appear in the report until approved.</p>' +
        pending.map(function (x) {
          return '<div class="ap-card"><div class="ap-card__body"><span class="ap-card__tag">Suggested</span><strong>' + U.esc(x.issue) + '</strong>' +
            '<span>' + U.esc(x.intervention) + '</span><span class="muted small">Owner: ' + U.esc(x.responsible || '—') + ' · Target ' + U.fmtDate(x.targetDate) + ' · ' + U.esc(x.successMeasure) + '</span></div>' +
            (lock ? '' : '<div class="ap-card__btns"><button class="btn btn--ghost btn--xs" data-act-dismiss="' + x.id + '">Dismiss</button><button class="btn btn--secondary btn--xs" data-act-edit="' + x.id + '">Edit</button><button class="btn btn--primary btn--xs" data-act-approve="' + x.id + '">' + ui.icon('check', 12) + 'Approve</button></div>') + '</div>';
        }).join('') + '</div>' : '') +
      (approved.length ? '<div class="table-wrap"><table class="ap-table"><thead><tr><th>Issue</th><th>Criterion</th><th>Intervention</th><th>Responsible</th><th>Target</th><th>Success measure</th><th>Review</th><th>Status</th>' + (lock ? '' : '<th></th>') + '</tr></thead><tbody>' +
        approved.map(function (x) {
          const lk = store.linkedIntervention(d.id, x.id);
          if (lk && !lock && store.actionStatusFor(lk)) x.status = store.actionStatusFor(lk);
          const st = E.actionStatus(x);
          const link = store.linkedIntervention(d.id, x.id);
          const qiCell = link ? '<a class="re-ivlink" href="#/qi/' + link.projectId + '?tab=interventions&iv=' + link.id + '" title="Linked improvement intervention">' + ui.icon('link', 11) + DA.qi.ivStatus(link).label + '</a>'
            : (report().status === 'archived' ? '' : '<button class="btn btn--ghost btn--xs" data-act-convert="' + x.id + '" title="Convert into a quality improvement intervention">' + ui.icon('qi', 12) + 'To intervention</button>');
          return '<tr><td>' + U.esc(x.issue) + '<div class="re-ivcell">' + qiCell + '</div></td><td>' + U.esc(critName(x.criterionId)) + '</td><td>' + U.esc(x.intervention) + '</td><td>' + U.esc(x.responsible || '—') + '</td>' +
            '<td class="nowrap">' + (x.targetDate ? U.fmtDate(x.targetDate) : '—') + '</td><td>' + U.esc(x.successMeasure || '—') + '</td><td class="nowrap">' + (x.reviewDate ? U.fmtDate(x.reviewDate) : '—') + '</td>' +
            '<td>' + (lock ? '<span class="ap-st ap-st--' + U.slug(st) + '">' + st + '</span>' : '<select class="select ap-st-select ap-st--' + U.slug(st) + '" data-act-status="' + x.id + '" aria-label="Status">' + E.ACTION_STATUSES.map(function (o) { return '<option' + (o === (st === 'Overdue' && x.status !== 'Overdue' ? x.status : st) ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select>' + (st === 'Overdue' && x.status !== 'Overdue' ? '<span class="ap-st ap-st--overdue">Overdue</span>' : '')) + '</td>' +
            (lock ? '' : '<td class="nowrap"><button class="icon-btn icon-btn--sm" data-act-edit="' + x.id + '" aria-label="Edit action">' + ui.icon('collect', 14) + '</button><button class="icon-btn icon-btn--sm icon-btn--danger" data-act-del="' + x.id + '" aria-label="Delete action">' + ui.icon('trash', 14) + '</button></td>') + '</tr>';
        }).join('') + '</tbody></table></div>'
        : (!pending.length ? '<p class="ap__empty">No actions yet. Add an action, or suggest actions from criteria that did not meet their target.</p>' : '')) +
    '</div>';
  }

  function editAction(id) {
    const d = s.draft;
    const x = id ? d.actionPlan.find(function (a) { return a.id === id; }) : { id: DA.model.newId('act'), issue: '', criterionId: '', intervention: '', responsible: d.meta.auditLead || '', targetDate: U.isoDay(U.addDays(new Date(), 90)), successMeasure: '', reviewDate: U.isoDay(U.addDays(new Date(), 120)), status: 'Not Started', source: 'manual', approved: true };
    const f = function (name, label, control, req) { return '<label class="field" data-f="' + name + '"><span class="field__label">' + label + (req ? ' <span class="req">*</span>' : '') + '</span>' + control + '<span class="field__error">Required.</span></label>'; };
    const inp = function (name, type, ph) { return '<input class="input" name="' + name + '" type="' + (type || 'text') + '" value="' + U.esc(x[name] || '') + '"' + (ph ? ' placeholder="' + U.esc(ph) + '"' : '') + '>'; };
    ui.modal({
      title: id ? (x.approved ? 'Edit action' : 'Review suggested action') : 'Add action', size: 'wide',
      subtitle: x.source === 'suggested' && !x.approved ? 'Suggested from the audit findings. Edit as needed, then approve.' : 'Structured improvement action',
      confirmLabel: x.approved ? 'Save action' : 'Approve action',
      body: f('issue', 'Identified issue', inp('issue', 'text', 'e.g. Torque not documented in 40% of implant crown fits'), true) +
        f('criterionId', 'Associated audit criterion', '<select class="select" name="criterionId"><option value="">Not linked to a criterion</option>' + d.analyticsSnapshot.criteria.map(function (c, i) {
          return '<option value="' + c.id + '"' + (c.id === x.criterionId ? ' selected' : '') + '>' + (i + 1) + '. ' + U.esc(c.name) + ' (' + E.pctShort(c.compliance) + ' vs ' + c.target + '%)</option>';
        }).join('') + '</select>') +
        f('intervention', 'Proposed intervention', '<textarea class="textarea" name="intervention" rows="2" placeholder="What will change?">' + U.esc(x.intervention) + '</textarea>', true) +
        '<div class="grid-2">' + f('responsible', 'Responsible person', inp('responsible'), true) + f('status', 'Status', '<select class="select" name="status">' + E.ACTION_STATUSES.map(function (o) { return '<option' + (o === x.status ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select>') + '</div>' +
        '<div class="grid-2">' + f('targetDate', 'Target completion date', inp('targetDate', 'date'), true) + f('reviewDate', 'Review date', inp('reviewDate', 'date')) + '</div>' +
        f('successMeasure', 'Success measure', inp('successMeasure', 'text', 'e.g. Compliance ≥ 95% at re-audit'), true),
      onConfirm: function (form) {
        const v = {};
        ['issue', 'criterionId', 'intervention', 'responsible', 'status', 'targetDate', 'reviewDate', 'successMeasure'].forEach(function (k) { v[k] = form.elements[k].value.trim(); });
        let bad = false;
        ['issue', 'intervention', 'responsible', 'targetDate', 'successMeasure'].forEach(function (k) {
          const w = form.querySelector('[data-f="' + k + '"]');
          w.classList.toggle('has-error', !v[k]);
          if (!v[k]) bad = true;
        });
        if (v.reviewDate && v.targetDate && v.reviewDate < v.targetDate) { const w = form.querySelector('[data-f="reviewDate"]'); w.classList.add('has-error'); w.querySelector('.field__error').textContent = 'Review date should be after the target date.'; bad = true; }
        if (bad) return false;
        Object.assign(x, v, { approved: true });
        if (!id) d.actionPlan.push(x);
        markDirty();
        repaint();
        ui.toast('Action ' + (id ? 'saved' : 'added'), 'success');
      }
    });
  }

  /** Convert an approved action into an improvement intervention (one link per action, no duplicates). */
  function convertAction(actionId) {
    const live = report();
    const saved = live.actionPlan.find(function (x) { return x.id === actionId; });
    if (!saved) { ui.toast('Save the report first so the action can be linked', 'error'); return; }
    const projects = store.projectsForAudit(live.auditId);
    const a = saved;
    const inp = function (name, val, type) { return '<input class="input" name="' + name + '" type="' + (type || 'text') + '" value="' + U.esc(val || '') + '">'; };
    ui.modal({
      title: 'Convert to improvement intervention', size: 'wide', confirmLabel: 'Create intervention',
      subtitle: 'The criterion link, proposed intervention and success measure are carried over. The original action stays in this report.',
      body: '<div class="nc-keep">' + ui.icon('link', 15) + '<div><strong>' + U.esc(a.intervention) + '</strong><span>' + U.esc(a.issue) + '</span></div></div>' +
        '<label class="field"><span class="field__label">Improvement project</span><select class="select" name="projectId">' + projects.map(function (p) { return '<option value="' + p.id + '">' + U.esc(p.title) + '</option>'; }).join('') + '<option value="__new">+ New improvement project for this audit</option></select></label>' +
        '<div class="grid-2"><label class="field" data-f="responsible"><span class="field__label">Responsible person</span>' + inp('responsible', a.responsible) + '<span class="field__error">Required.</span></label>' +
        '<label class="field" data-f="targetDate"><span class="field__label">Target completion date</span>' + inp('targetDate', a.targetDate, 'date') + '<span class="field__error">Required.</span></label></div>' +
        '<label class="field"><span class="field__label">Success measure</span>' + inp('successMeasure', a.successMeasure) + '</label>',
      onConfirm: function (form) {
        const f = form.elements;
        let bad = false;
        ['responsible', 'targetDate'].forEach(function (k) { const ok = !!f[k].value.trim(); form.querySelector('[data-f=' + k + ']').classList.toggle('has-error', !ok); if (!ok) bad = true; });
        if (bad) return false;
        let pid = f.projectId.value;
        if (pid === '__new') {
          const au = audit();
          const ser = DA.qi.series(au).filter(function (r) { return r.cycle.records.some(function (x) { return x.status === 'completed'; }); });
          pid = store.createQiProject({ auditId: au.id, baselineRefKey: ser.length ? ser[ser.length - 1].key : '', title: 'Improving ' + au.title.charAt(0).toLowerCase() + au.title.slice(1), aim: 'Address the findings of “' + live.title + '”.', projectLead: au.auditLead }).id;
        }
        const iv = store.convertAction(live.id, actionId, pid, { responsiblePerson: f.responsible.value.trim(), targetDate: f.targetDate.value, successMeasure: f.successMeasure.value.trim() });
        ui.toast('Intervention created and linked to this action', 'success');
        paint();
        return iv ? undefined : false;
      }
    });
  }

  /* ---------- References ---------- */
  function refsHtml(lock) {
    const refs = s.draft.references;
    return '<div class="refs" contenteditable="false">' +
      '<div class="ap__head"><h4>' + ui.icon('file', 14) + 'Reference manager</h4>' + (lock ? '' : '<button class="btn btn--secondary btn--sm" data-act="add-ref">' + ui.icon('plus', 14) + 'Add reference</button>') + '</div>' +
      (refs.length ? '<ol class="refs__list">' + refs.map(function (r) {
        return '<li><span class="refs__text">' + U.esc(r.text) + '</span><span class="refs__src">' + (r.source === 'criteria' ? 'From audit criteria' : 'Added manually') + '</span>' +
          (lock ? '' : '<span class="refs__btns"><button class="icon-btn icon-btn--sm" data-ref-edit="' + r.id + '" aria-label="Edit reference">' + ui.icon('collect', 14) + '</button><button class="icon-btn icon-btn--sm icon-btn--danger" data-ref-del="' + r.id + '" aria-label="Delete reference">' + ui.icon('trash', 14) + '</button></span>') + '</li>';
      }).join('') + '</ol>' : '<p class="ap__empty">No references yet.</p>') +
      '<p class="refs__note">' + ui.icon('shield', 12) + 'Only references you add or that are recorded in the audit criteria appear here. DentalAudit never generates citations.</p>' +
    '</div>';
  }

  function editRef(id) {
    const r = id ? s.draft.references.find(function (x) { return x.id === id; }) : null;
    ui.modal({
      title: r ? 'Edit reference' : 'Add reference', size: 'wide', confirmLabel: r ? 'Save' : 'Add reference',
      subtitle: 'Enter the reference exactly as published (e.g. authors, title, publisher or journal, year, and URL/DOI only if you have verified it).',
      body: '<label class="field"><span class="field__label">Reference</span><textarea class="textarea" name="text" rows="3" placeholder="e.g. Faculty of General Dental Practice (UK). Clinical Examination and Record-Keeping. 3rd ed. London: FGDP(UK); 2016.">' + U.esc(r ? r.text : '') + '</textarea><span class="field__error">Enter the reference text.</span></label>',
      onConfirm: function (form) {
        const t = form.elements.text.value.trim().replace(/\s+/g, ' ');
        const w = form.querySelector('.field');
        if (!t) { w.classList.add('has-error'); return false; }
        if (s.draft.references.some(function (x) { return x.text.toLowerCase() === t.toLowerCase() && (!r || x.id !== r.id); })) { w.classList.add('has-error'); w.querySelector('.field__error').textContent = 'This reference is already listed.'; return false; }
        if (r) r.text = t; else s.draft.references.push({ id: DA.model.newId('ref'), text: t, source: 'manual' });
        markDirty(); repaint();
        ui.toast(r ? 'Reference updated' : 'Reference added', 'success');
      }
    });
  }

  /* =========================================================
   * Right — assistant, report details, review
   * ========================================================= */
  function sideHtml(lock) {
    return '<div class="re-tabs" role="tablist"><button class="re-tab' + (s.panel === 'assistant' ? ' is-active' : '') + '" data-panel="assistant" role="tab">' + ui.icon('fStar', 14) + 'Assistant</button>' +
      '<button class="re-tab' + (s.panel === 'report' ? ' is-active' : '') + '" data-panel="report" role="tab">' + ui.icon('reports', 14) + 'Report & review</button></div>' +
      '<div class="re-side__body">' + (s.panel === 'assistant' ? assistantHtml(lock) : reportPanelHtml(lock)) + '</div>';
  }

  function assistantHtml(lock) {
    const d = s.draft;
    const sec = d.sections[s.active] || d.sections.executive;
    const conf = AI.isConfigured();
    const actions = AI.ACTIONS.filter(function (a) { return !a.hidden && (a.any || (a.sections || []).indexOf(sec.key) !== -1); });
    const ctx = AI.buildContext(d, sec.key);
    return '<div class="as">' +
      '<label class="field"><span class="field__label">Working on</span><select class="select input--sm" data-active-select>' + d.sectionOrder.filter(function (k) { return d.sections[k].included && k !== 'title'; }).map(function (k) {
        return '<option value="' + k + '"' + (k === sec.key ? ' selected' : '') + '>' + U.esc(d.sections[k].title) + '</option>';
      }).join('') + '</select></label>' +

      '<div class="as-card"><h5>' + ui.icon('refresh', 13) + 'Data-driven drafting</h5><p>Rebuilds “' + U.esc(sec.title) + '” from the audit protocol and the frozen results using fixed templates. This is not AI — every figure comes from the analytics snapshot.</p>' +
        (lock || sec.key === 'references' || sec.key === 'actionplan' ? '' : '<button class="btn btn--secondary btn--sm" data-regen="' + sec.key + '">' + ui.icon('refresh', 14) + 'Regenerate from audit data</button>') + '</div>' +

      '<div class="as-card as-card--ai"><h5>' + ui.icon('fStar', 13) + 'AI assistant</h5>' +
        (conf ? '<p class="as-status is-on">' + ui.icon('check', 13) + U.esc(AI.statusText()) + '</p>'
              : '<div class="as-off"><strong>AI backend not configured</strong><p>The assistant needs a secure server that you host, which holds the API key and talks to the AI provider. Until one is set up, no AI responses are available and no audit data leaves this browser.</p><a class="btn btn--secondary btn--sm" href="#/settings">' + ui.icon('settings', 14) + 'Configure AI backend</a></div>') +
        '<div class="as-actions">' + actions.map(function (a) {
          return '<button class="as-action" data-ai="' + a.key + '"' + (lock || !conf || s.busy ? ' disabled' : '') + ' title="' + (conf ? '' : 'Configure a secure AI backend to use this') + '">' + ui.icon(a.icon, 14) + '<span>' + a.label + '</span></button>';
        }).join('') + '</div>' +
        '<label class="field"><span class="field__label">Custom instructions or question</span><textarea class="textarea input--sm" id="ai-instr" rows="2" placeholder="Instructions, or a question about this audit (e.g. Which criterion had the largest shortfall?)"' + (lock || !conf ? ' disabled' : '') + '></textarea></label>' +
        '<button class="btn btn--primary btn--sm as-send" data-ai="custom"' + (lock || !conf || s.busy ? ' disabled' : '') + '>' + (s.busy ? '<span class="spinner"></span>Waiting for response…' : ui.icon('arrowRight', 14) + 'Send custom request') + '</button>' +
        '<details class="as-data"><summary>' + ui.icon('shield', 13) + 'What would be sent</summary>' +
          '<p><strong>Included</strong></p><ul>' + AI.describeContext(ctx).map(function (x) { return '<li>' + U.esc(x) + '</li>'; }).join('') + '</ul>' +
          '<p><strong>Never sent</strong></p><ul>' + AI.NOT_SENT.map(function (x) { return '<li>' + U.esc(x) + '</li>'; }).join('') + '</ul>' +
          '<button class="link-btn small" data-act="show-payload">View the exact request</button></details>' +
      '</div>' +
      (s.ai ? aiResultHtml() : '') +
      '<div class="as-rules"><h5>' + ui.icon('shield', 13) + 'Assistant rules</h5><ol>' + AI.RULES.slice(0, 8).map(function (r) { return '<li>' + U.esc(r) + '</li>'; }).join('') + '</ol></div>' +
    '</div>';
  }

  function aiResultHtml() {
    const r = s.ai;
    if (!r.ok) return '<div class="as-result as-result--err">' + ui.icon('alert', 14) + '<div><strong>No AI response</strong><p>' + U.esc(r.message) + '</p></div></div>';
    if (r.action === 'question') {
      return '<div class="as-result"><div class="as-result__head"><span class="badge badge--amber">AI answer</span><span class="muted small">' + U.esc([r.provider, r.model].filter(Boolean).join(' · ')) + '</span></div>' +
        '<p class="small"><strong>Q:</strong> ' + U.esc(r.question) + '</p>' +
        (r.unverified.length ? '<div class="alert alert--error alert--sm">' + ui.icon('alert', 13) + '<div>These numbers are not in the analytics snapshot and may be wrong: <strong>' + U.esc(r.unverified.join(', ')) + '</strong>.</div></div>' : '<p class="as-verified">' + ui.icon('check', 12) + 'All numbers match the analytics snapshot</p>') +
        '<div class="as-result__text doc">' + AI.textToHtml(r.text) + '</div>' +
        '<div class="as-result__btns"><button class="btn btn--ghost btn--sm" data-ai-use="discard">Dismiss</button><button class="btn btn--secondary btn--sm" data-ai-use="copy">Copy answer</button></div>' +
        '<p class="muted small">Answers are not added to the report. Check them against the audit data.</p></div>';
    }
    return '<div class="as-result"><div class="as-result__head"><span class="badge badge--amber">AI draft</span><span class="muted small">' + U.esc([r.provider, r.model].filter(Boolean).join(' · ')) + '</span></div>' +
      (r.unverified.length ? '<div class="alert alert--error alert--sm">' + ui.icon('alert', 13) + '<div>These numbers are not in the analytics snapshot and may be wrong: <strong>' + U.esc(r.unverified.join(', ')) + '</strong>. Correct or remove them before use.</div></div>' : '<p class="as-verified">' + ui.icon('check', 12) + 'All numbers match the analytics snapshot</p>') +
      '<div class="as-result__text doc">' + AI.textToHtml(r.text) + '</div>' +
      '<div class="as-result__btns"><button class="btn btn--ghost btn--sm" data-ai-use="discard">Discard</button><button class="btn btn--secondary btn--sm" data-ai-use="append">Add to section</button><button class="btn btn--primary btn--sm" data-ai-use="replace">Replace section</button></div>' +
      '<p class="muted small">Inserted text is labelled as an AI draft until the audit lead marks the section reviewed.</p></div>';
  }

  function reportPanelHtml(lock) {
    const d = s.draft, live = report(), rv = live.review;
    const snap = d.analyticsSnapshot;
    const changed = E.datasetChanged(live);
    const aiPending = d.sectionOrder.filter(function (k) { return d.sections[k].included && d.sections[k].aiDraft; });
    const lead = isLead();
    const st = live.status;
    return '<section class="rp"><h5>Report information</h5><dl class="rp-dl">' +
        '<div><dt>Type</dt><dd>' + U.esc(E.TYPES[d.reportType]) + ' · ' + (d.length === 'summary' ? 'summary' : 'comprehensive') + '</dd></div>' +
        '<div><dt>Audit cycle</dt><dd>' + U.esc(snap.cycleLabel) + '</dd></div>' +
        '<div><dt>Created</dt><dd>' + U.fmtDate(live.createdAt) + '</dd></div>' +
        '<div><dt>Revision</dt><dd>' + live.revision + '</dd></div>' +
      '</dl>' + (lock ? '' : '<button class="btn btn--ghost btn--sm" data-act="edit-meta">' + ui.icon('collect', 14) + 'Edit report settings</button>') + '</section>' +

      '<section class="rp"><h5>Analytics snapshot</h5>' +
        '<p class="rp-snap">' + ui.icon('lockSm', 13) + '<span>Figures frozen on <strong>' + U.fmtDate(live.snapshotAt, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</strong> · ' + snap.totals.completed + ' completed of ' + snap.totals.records + ' records' + (snap.form ? ' · form v' + snap.form.version : '') + '</span></p>' +
        (changed ? '<p class="rp-changed">' + ui.icon('alert', 13) + 'The audit dataset has changed since then.</p>' : '<p class="rp-same">' + ui.icon('check', 13) + 'Matches the current audit data.</p>') +
        (st === 'archived' ? '' : '<button class="btn btn--secondary btn--sm" data-act="refresh">' + ui.icon('refresh', 14) + 'Refresh data / regenerate results</button>') +
      '</section>' +

      '<section class="rp"><h5>Review and sign-off</h5>' +
        '<div class="rp-status">' + DA.views.reports.statusBadge(st) + '</div>' +
        '<div class="stack rp-form">' +
          '<label class="field"><span class="field__label">Report author</span><input class="input input--sm" data-review="author" value="' + U.esc(rv.author || '') + '"' + (st === 'archived' || st === 'approved' ? ' disabled' : '') + '></label>' +
          '<label class="field"><span class="field__label">Reviewer</span><input class="input input--sm" data-review="reviewer" value="' + U.esc(rv.reviewer || '') + '" placeholder="Name of reviewer"' + (st === 'archived' || st === 'approved' ? ' disabled' : '') + '></label>' +
          '<label class="field"><span class="field__label">Reviewer comments</span><textarea class="textarea input--sm" data-review="reviewerComments" rows="3"' + (st === 'archived' || st === 'approved' ? ' disabled' : '') + '>' + U.esc(rv.reviewerComments || '') + '</textarea></label>' +
          '<div class="grid-2"><label class="field"><span class="field__label">Review date</span><input class="input input--sm" type="date" data-review="reviewDate" value="' + U.esc(rv.reviewDate || '') + '"' + (st === 'archived' || st === 'approved' ? ' disabled' : '') + '></label>' +
            '<label class="field"><span class="field__label">Approval date</span><input class="input input--sm" value="' + (rv.approvalDate ? U.fmtDate(rv.approvalDate) : '—') + '" disabled></label></div>' +
          (st === 'draft' || st === 'in_review' ? '<button class="btn btn--ghost btn--sm" data-act="save-review">Save review details</button>' : '') +
        '</div>' +
        '<div class="rp-actions">' +
          (st === 'draft' ? '<button class="btn btn--primary btn--sm" data-act="submit-review">' + ui.icon('arrowRight', 14) + 'Submit for review</button>' : '') +
          (st === 'in_review' ? '<button class="btn btn--primary btn--sm" data-act="approve"' + (lead && !aiPending.length ? '' : ' disabled') + '>' + ui.icon('check', 14) + 'Approve report</button><button class="btn btn--ghost btn--sm" data-act="to-draft">Return to draft</button>' : '') +
          (st === 'approved' ? '<button class="btn btn--secondary btn--sm" data-act="new-revision">' + ui.icon('repeat', 14) + 'Start new revision</button><button class="btn btn--ghost btn--sm" data-act="archive">Archive</button>' : '') +
          (st === 'archived' ? '<button class="btn btn--secondary btn--sm" data-act="new-revision">' + ui.icon('repeat', 14) + 'Restore as new revision</button>' : '') +
        '</div>' +
        (st === 'in_review' && !lead ? '<p class="rp-hint">' + ui.icon('lockSm', 12) + 'Only the audit lead (' + U.esc(d.meta.auditLead || 'not set') + ') can approve. You are signed in as ' + U.esc(store.getSettings().userName) + '.</p>' : '') +
        (st === 'in_review' && aiPending.length ? '<p class="rp-hint">' + ui.icon('alert', 12) + aiPending.length + ' section' + (aiPending.length === 1 ? ' contains' : 's contain') + ' an unreviewed AI draft. Return to draft and mark ' + (aiPending.length === 1 ? 'it' : 'them') + ' reviewed first.</p>' : '') +
      '</section>' +

      '<section class="rp"><h5>Revision history</h5><ol class="rev-list">' + (live.revisions || []).slice().reverse().map(function (x) {
        return '<li><div><strong>Revision ' + x.revision + '</strong> <span class="rev-st">' + (DA.views.reports.STATUS[x.status] || {}).label + '</span><span class="muted small">' + U.esc(x.note || '') + '</span><span class="muted small">' + U.fmtDate(x.savedAt, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' · ' + U.esc(x.by || '') + '</span></div>' +
          '<a class="btn btn--ghost btn--xs" href="#/reports/' + live.id + '/preview?rev=' + (live.revisions.indexOf(x)) + '">View</a></li>';
      }).join('') + '</ol></section>';
  }

  /* =========================================================
   * Editing
   * ========================================================= */
  function trackRange() {
    if (!el || !document.body.contains(el)) { document.removeEventListener('selectionchange', trackRange); return; }
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    const body = r.startContainer.nodeType === 1 ? r.startContainer.closest && r.startContainer.closest('[data-body]') : r.startContainer.parentElement && r.startContainer.parentElement.closest('[data-body]');
    if (body && el.contains(body)) {
      s.range = r.cloneRange();
      if (s.active !== body.dataset.body) setActive(body.dataset.body, false);
    }
  }

  function setActive(k, scroll) {
    s.active = k;
    el.querySelectorAll('.re-nav__item').forEach(function (li) { li.classList.toggle('is-active', li.querySelector('[data-go]').dataset.go === k); });
    el.querySelectorAll('.re-sec').forEach(function (x) { x.classList.toggle('is-active', x.dataset.sec === k); });
    if (s.panel === 'assistant') {
      const sel = el.querySelector('[data-active-select]');
      if (sel && sel.value !== k && s.draft.sections[k] && k !== 'title') refreshSide();
    }
    if (scroll) {
      const t = el.querySelector('#re-sec-' + k);
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  const syncSection = U.debounce(function (body) { capture(body); }, 250);

  function capture(body) {
    const k = body.dataset.body;
    const c = body.cloneNode(true);
    c.querySelectorAll('.rb').forEach(function (b) { b.innerHTML = ''; });
    const sec = s.draft.sections[k];
    const html = R.sanitize(c.innerHTML);
    if (html === sec.html) return;
    sec.html = html;
    if (sec.status === 'generated' || sec.status === 'reviewed') sec.status = 'edited';
    sec.updatedAt = new Date().toISOString();
    markDirty();
    refreshNav();
  }

  function captureAll() {
    el.querySelectorAll('[data-body]').forEach(capture);
  }

  function markDirty() {
    s.dirty = true;
    const st = el.querySelector('#re-save-state');
    if (st) { st.classList.add('is-dirty'); st.lastChild.textContent = 'Unsaved changes'; }
    const b = el.querySelector('[data-act="save"]');
    if (b) b.disabled = false;
  }

  function refreshNav() {
    const nav = el.querySelector('.re-nav');
    if (nav) nav.innerHTML = navHtml(locked(report()));
  }
  function refreshSide() {
    const side = el.querySelector('.re-side');
    if (side) side.innerHTML = sideHtml(locked(report()));
  }
  function repaint() { captureAllSafe(); paint(); }
  function captureAllSafe() { /* draft already holds captured edits */ }

  function insertAtCaret(html, key) {
    const k = key || s.active;
    let body = el.querySelector('[data-body="' + k + '"]');
    if (!body) { ui.toast('Choose a section in the document first', 'error'); return; }
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const node = tmp.firstChild;
    const r = s.range && body.contains(s.range.startContainer) ? s.range : null;
    if (r) {
      let anchor = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
      while (anchor && anchor.parentElement !== body) anchor = anchor.parentElement;
      if (anchor) anchor.after(node); else body.appendChild(node);
    } else body.appendChild(node);
    if (node.classList && node.classList.contains('rb')) {
      R.hydrate(el.querySelector('#re-paper'), s.draft);
      el.querySelectorAll('#re-paper .rb').forEach(function (b) { if (!b.querySelector('.rb-tools')) addBlockTools(b); });
    }
    capture(body);
    node.scrollIntoView && node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function onInput(e) {
    const t = e.target;
    const body = t.closest && t.closest('[data-body]');
    if (body) { syncSection(body); return; }
  }

  function onPaste(e) {
    const body = e.target.closest && e.target.closest('[data-body]');
    if (!body) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  }

  function onChange(e) {
    const t = e.target;
    if (t.dataset.include) {
      const k = t.dataset.include;
      captureAll();
      s.draft.sections[k].included = t.checked;
      markDirty();
      paint();
      ui.toast((t.checked ? 'Included: ' : 'Excluded: ') + s.draft.sections[k].title, 'success');
    } else if (t.hasAttribute('data-active-select')) {
      setActive(t.value, true);
      refreshSide();
    } else if (t.hasAttribute('data-cmd-block')) {
      restoreRange();
      document.execCommand('formatBlock', false, t.value);
      t.value = 'p';
      const body = currentBody(); if (body) capture(body);
    } else if (t.dataset.actStatus) {
      const a = s.draft.actionPlan.find(function (x) { return x.id === t.dataset.actStatus; });
      a.status = t.value;
      markDirty(); paint();
    }
  }

  function currentBody() { return s.range ? (s.range.startContainer.nodeType === 1 ? s.range.startContainer : s.range.startContainer.parentElement).closest('[data-body]') : null; }
  function restoreRange() {
    if (!s.range) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(s.range);
  }

  function onClick(e) {
    const b = e.target.closest('button, [data-go]');
    if (!b || !el.contains(b) || b.disabled) {
      if (!e.target.closest('.menu-wrap')) closeMenus();
      return;
    }
    if (b.dataset.cmd) {
      e.preventDefault();
      if (b.dataset.cmd === 'table') { insertTable(); return; }
      restoreRange();
      document.execCommand(b.dataset.cmd, false, null);
      const body = currentBody(); if (body) capture(body);
      return;
    }
    if (b.dataset.go) { setActive(b.dataset.go, true); return; }
    if (b.dataset.navMove) { moveSection(b.dataset.key, b.dataset.navMove === 'up' ? -1 : 1); return; }
    if (b.dataset.panel) { s.panel = b.dataset.panel; refreshSide(); return; }
    if (b.dataset.insert) { closeMenus(); insertAtCaret('<div class="rb" data-block="' + b.dataset.insert + '"' + (b.dataset.arg ? ' data-arg="' + U.esc(b.dataset.arg) + '"' : '') + ' contenteditable="false"></div>'); ui.toast('Inserted from analytics snapshot', 'success'); return; }
    if (b.hasAttribute('data-rb-remove')) {
      const blk = b.closest('.rb'); const body = blk.closest('[data-body]');
      blk.remove(); capture(body); ui.toast('Data block removed', 'success'); return;
    }
    if (b.dataset.addp) {
      const body = el.querySelector('[data-body="' + b.dataset.addp + '"]');
      const p = document.createElement('p'); p.innerHTML = '<br>';
      body.appendChild(p);
      body.focus();
      const r = document.createRange(); r.setStart(p, 0); r.collapse(true);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      s.range = r.cloneRange();
      return;
    }
    if (b.dataset.regen) { regenerate(b.dataset.regen); return; }
    if (b.dataset.reviewed) { markReviewed(b.dataset.reviewed); return; }
    if (b.dataset.aiFor) { setActive(b.dataset.aiFor, false); s.panel = 'assistant'; refreshSide(); el.querySelector('.re-side').scrollIntoView({ block: 'nearest' }); return; }
    if (b.dataset.ai) { askAI(b.dataset.ai); return; }
    if (b.dataset.aiUse) { useAI(b.dataset.aiUse); return; }
    if (b.dataset.export) { closeMenus(); doExport(b.dataset.export); return; }
    if (b.dataset.actConvert) { convertAction(b.dataset.actConvert); return; }
    if (b.dataset.actApprove) { const a = s.draft.actionPlan.find(function (x) { return x.id === b.dataset.actApprove; }); a.approved = true; markDirty(); paint(); ui.toast('Action approved', 'success'); return; }
    if (b.dataset.actEdit) { editAction(b.dataset.actEdit); return; }
    if (b.dataset.actDismiss) { s.draft.actionPlan = s.draft.actionPlan.filter(function (x) { return x.id !== b.dataset.actDismiss; }); markDirty(); paint(); ui.toast('Suggestion dismissed', 'success'); return; }
    if (b.dataset.actDel) {
      const id = b.dataset.actDel;
      ui.confirm({ title: 'Delete action?', message: 'This action will be removed from the action plan.', confirmLabel: 'Delete', danger: true, onConfirm: function () { s.draft.actionPlan = s.draft.actionPlan.filter(function (x) { return x.id !== id; }); markDirty(); paint(); } });
      return;
    }
    if (b.dataset.refEdit) { editRef(b.dataset.refEdit); return; }
    if (b.dataset.refDel) {
      const id = b.dataset.refDel;
      const r = s.draft.references.find(function (x) { return x.id === id; });
      ui.confirm({ title: 'Remove reference?', message: '“' + r.text.slice(0, 120) + '” will be removed from this report' + (r.source === 'criteria' ? ' (it remains in the audit criteria)' : '') + '.', confirmLabel: 'Remove', danger: true,
        onConfirm: function () { s.draft.references = s.draft.references.filter(function (x) { return x.id !== id; }); markDirty(); paint(); } });
      return;
    }

    switch (b.dataset.act) {
      case 'save': save(); break;
      case 'export-menu': toggleMenu('#export-menu'); break;
      case 'insert-menu': toggleMenu('#insert-menu'); break;
      case 'edit-meta': editMeta(); break;
      case 'add-action': editAction(null); break;
      case 'suggest-actions': suggest(); break;
      case 'add-ref': editRef(null); break;
      case 'refresh': refreshData(); break;
      case 'new-revision': startRevision(); break;
      case 'submit-review': submitReview(); break;
      case 'approve': approve(); break;
      case 'to-draft': toDraft(); break;
      case 'archive': archive(); break;
      case 'save-review': saveReview(true); break;
      case 'show-payload': showPayload(); break;
    }
  }

  function toggleMenu(sel) {
    const m = el.querySelector(sel);
    const open = m.hidden;
    closeMenus();
    m.hidden = !open;
  }
  function closeMenus() { if (el) el.querySelectorAll('.export-menu, .insert-menu').forEach(function (m) { m.hidden = true; }); }

  function moveSection(k, dir) {
    captureAll();
    const order = s.draft.sectionOrder;
    const body = order.filter(function (x) { return x !== 'title'; });
    const i = body.indexOf(k), j = i + dir;
    if (j < 0 || j >= body.length) return;
    body[i] = body[j]; body[j] = k;
    s.draft.sectionOrder = ['title'].concat(body);
    markDirty();
    paint();
    const btn = el.querySelector('[data-nav-move="' + (dir < 0 ? 'up' : 'down') + '"][data-key="' + k + '"]');
    if (btn && !btn.disabled) btn.focus();
  }

  function insertTable() {
    ui.modal({
      title: 'Insert table', confirmLabel: 'Insert',
      body: '<div class="grid-2"><label class="field"><span class="field__label">Rows</span><input class="input" type="number" name="rows" min="1" max="30" value="3"></label><label class="field"><span class="field__label">Columns</span><input class="input" type="number" name="cols" min="1" max="8" value="3"></label></div>' +
        '<label class="mini-toggle"><input type="checkbox" name="head" checked> First row is a header</label>',
      onConfirm: function (form) {
        const rows = Math.min(30, Math.max(1, parseInt(form.elements.rows.value, 10) || 3));
        const cols = Math.min(8, Math.max(1, parseInt(form.elements.cols.value, 10) || 3));
        const head = form.elements.head.checked;
        let html = '<table>';
        for (let r = 0; r < rows; r++) {
          html += '<tr>';
          for (let c = 0; c < cols; c++) html += (head && r === 0 ? '<th>Heading ' + (c + 1) + '</th>' : '<td><br></td>');
          html += '</tr>';
        }
        html += '</table>';
        setTimeout(function () { insertAtCaret(html); }, 0);
      }
    });
  }

  function regenerate(k) {
    const sec = s.draft.sections[k];
    const go = function () {
      captureAll();
      sec.html = E.regenerateSection(s.draft, audit(), k);
      sec.status = 'generated'; sec.aiDraft = false; sec.updatedAt = new Date().toISOString();
      markDirty(); paint();
      ui.toast('“' + sec.title + '” rebuilt from audit data', 'success');
    };
    if (sec.status === 'generated') go();
    else ui.confirm({ title: 'Replace this section?', message: 'Your edits to “' + sec.title + '” will be replaced by text generated from the audit data and frozen snapshot. Save first if you may need them — earlier saved revisions remain in the history.', confirmLabel: 'Replace text', onConfirm: go });
  }

  function markReviewed(k) {
    const sec = s.draft.sections[k];
    if (sec.aiDraft && !isLead()) { ui.toast('Only the audit lead (' + (s.draft.meta.auditLead || 'not set') + ') can sign off an AI-assisted draft', 'error'); return; }
    if (/class="ph"/.test(sec.html)) { ui.toast('Replace the highlighted placeholder text first', 'error'); setActive(k, true); return; }
    captureAll();
    sec.status = 'reviewed'; sec.aiDraft = false; sec.updatedAt = new Date().toISOString();
    markDirty(); paint();
  }

  function suggest() {
    captureAll();
    const existing = s.draft.actionPlan.map(function (x) { return x.criterionId; });
    const add = E.suggestActions(s.draft.analyticsSnapshot, audit(), s.draft).filter(function (x) { return existing.indexOf(x.criterionId) === -1; });
    s.draft.actionPlan = s.draft.actionPlan.concat(add);
    if (add.length) markDirty();
    paint();
    ui.toast(add.length ? add.length + ' suggestion' + (add.length === 1 ? '' : 's') + ' added for review' : 'Every criterion below target already has an action', add.length ? 'success' : 'info');
  }

  function editMeta() {
    const d = s.draft, m = d.meta;
    const inp = function (name, val, type) { return '<input class="input" name="' + name + '" type="' + (type || 'text') + '" value="' + U.esc(val || '') + '">'; };
    ui.modal({
      title: 'Report settings', size: 'wide', confirmLabel: 'Apply',
      body: '<label class="field"><span class="field__label">Report title</span>' + inp('title', d.title) + '<span class="field__error">Required.</span></label>' +
        '<div class="grid-2"><label class="field"><span class="field__label">Audit title</span>' + inp('auditTitle', m.auditTitle) + '</label><label class="field"><span class="field__label">Department</span>' + inp('department', m.department) + '</label></div>' +
        '<div class="grid-2"><label class="field"><span class="field__label">Institution</span>' + inp('institution', m.institution) + '</label><label class="field"><span class="field__label">Audit lead</span>' + inp('auditLead', m.auditLead) + '</label></div>' +
        '<label class="field"><span class="field__label">Collaborating clinicians</span>' + inp('collaborators', (m.collaborators || []).join(', ')) + '<span class="field__hint">Separate names with commas.</span></label>' +
        '<div class="grid-3"><label class="field"><span class="field__label">Period from</span>' + inp('periodFrom', m.periodFrom, 'date') + '</label><label class="field"><span class="field__label">Period to</span>' + inp('periodTo', m.periodTo, 'date') + '</label><label class="field"><span class="field__label">Report date</span>' + inp('reportDate', m.reportDate, 'date') + '</label></div>' +
        '<div class="grid-2"><label class="field"><span class="field__label">Report type</span><select class="select" name="reportType">' + Object.keys(E.TYPES).map(function (k) { return '<option value="' + k + '"' + (k === d.reportType ? ' selected' : '') + '>' + E.TYPES[k] + '</option>'; }).join('') + '</select></label>' +
          '<label class="field"><span class="field__label">Length</span><select class="select" name="length"><option value="comprehensive"' + (d.length !== 'summary' ? ' selected' : '') + '>Comprehensive</option><option value="summary"' + (d.length === 'summary' ? ' selected' : '') + '>Short summary</option></select></label></div>',
      onConfirm: function (form) {
        const f = form.elements;
        if (!f.title.value.trim()) { f.title.closest('.field').classList.add('has-error'); return false; }
        captureAll();
        d.title = f.title.value.trim();
        ['auditTitle', 'department', 'institution', 'auditLead', 'periodFrom', 'periodTo', 'reportDate'].forEach(function (k) { m[k] = f[k].value.trim(); });
        m.collaborators = f.collaborators.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        d.reportType = f.reportType.value; d.length = f.length.value;
        markDirty(); paint();
      }
    });
  }

  /* =========================================================
   * Persistence and workflow
   * ========================================================= */
  function save(quiet) {
    if (!s || locked(report())) return false;
    captureAll();
    try {
      const d = s.draft;
      store.saveReport(d.id, { title: d.title, reportType: d.reportType, length: d.length, meta: d.meta, sectionOrder: d.sectionOrder, sections: d.sections, actionPlan: d.actionPlan, references: d.references, review: Object.assign({}, report().review, readReview()) }, quiet ? null : 'Saved report “' + d.title + '”');
      s.dirty = false;
      s.draft = clone(report());
      s.stamp = report().updatedAt + '|' + report().revision + '|' + report().status;
      if (!quiet) ui.toast('Report draft saved', 'success');
      paint();
      return true;
    } catch (err) { ui.toast(err.message, 'error'); return false; }
  }

  function readReview() {
    const out = {};
    el.querySelectorAll('[data-review]').forEach(function (i) { out[i.dataset.review] = i.value.trim(); });
    return out;
  }

  function saveReview(toast) {
    const live = report();
    const rv = Object.assign({}, live.review, readReview());
    live.review = rv;
    s.draft.review = rv;
    // Review details may be recorded while in review without unlocking the content.
    try { store.saveReviewDetails(live.id, rv); } catch (err) { ui.toast(err.message, 'error'); return; }
    s.stamp = report().updatedAt + '|' + report().revision + '|' + report().status;
    if (toast) ui.toast('Review details saved', 'success');
  }

  function guardDirty(then) {
    if (!s.dirty) { then(); return; }
    if (save(true)) then();
  }

  function submitReview() {
    const rv = readReview();
    if (!rv.reviewer) { ui.toast('Enter the reviewer’s name first', 'error'); const i = el.querySelector('[data-review="reviewer"]'); if (i) i.focus(); return; }
    guardDirty(function () {
      store.setReportStatus(s.id, 'in_review', { review: rv });
      ui.toast('Submitted for review', 'success');
      s = sessionFor(report()); paint();
    });
  }

  function approve() {
    if (!isLead()) { ui.toast('Only the audit lead can approve this report', 'error'); return; }
    const pending = s.draft.sectionOrder.filter(function (k) { return s.draft.sections[k].included && s.draft.sections[k].aiDraft; });
    if (pending.length) { ui.toast('Review the AI-assisted sections before approving', 'error'); return; }
    ui.confirm({
      title: 'Approve revision ' + report().revision + '?',
      message: 'The report will be locked as approved. Any later change will create a new revision, and this approved version will be kept in the history.',
      confirmLabel: 'Approve report',
      onConfirm: function () { store.setReportStatus(s.id, 'approved', { review: readReview() }); ui.toast('Report approved', 'success'); s = sessionFor(report()); paint(); }
    });
  }

  function toDraft() {
    store.setReportStatus(s.id, 'draft', { review: readReview() });
    ui.toast('Returned to draft', 'success');
    s = sessionFor(report()); paint();
  }

  function archive() {
    ui.confirm({ title: 'Archive report?', message: 'The report will be read-only and marked as archived. It stays in the list and can be restored as a new revision.', confirmLabel: 'Archive',
      onConfirm: function () { store.setReportStatus(s.id, 'archived'); ui.toast('Report archived', 'success'); s = sessionFor(report()); paint(); } });
  }

  function startRevision() {
    const live = report();
    ui.confirm({
      title: 'Start revision ' + (live.revision + 1) + '?',
      message: 'Revision ' + live.revision + ' (' + DA.views.reports.STATUS[live.status].label.toLowerCase() + ') is kept unchanged in the revision history. A new draft revision will be created for editing.',
      confirmLabel: 'Start new revision',
      onConfirm: function () { store.newRevision(live.id); ui.toast('Revision ' + report().revision + ' started as a draft', 'success'); s = sessionFor(report()); paint(); }
    });
  }

  function refreshData() {
    const live = report();
    const changed = E.datasetChanged(live);
    ui.confirm({
      title: 'Regenerate results?',
      message: (changed ? 'The audit data has changed since this report was generated. ' : 'The audit data has not changed, but a fresh snapshot will be taken. ') +
        'A new analytics snapshot will be frozen as revision ' + (live.revision + 1) + '. Tables and charts update automatically; auto-generated sections are rebuilt, and sections you have edited keep their text but are flagged if they contain figures. Revision ' + live.revision + ' stays in the history' + (live.status === 'approved' ? ' as approved' : '') + '.',
      confirmLabel: 'Regenerate results',
      onConfirm: function () {
        if (s.dirty && !locked(live)) save(true);
        const res = store.refreshReportData(live.id);
        s = sessionFor(res.report);
        s.dirty = false; s.draft = clone(res.report);
        paint();
        ui.toast('Results regenerated — revision ' + res.report.revision + (res.flagged.length ? ' · ' + res.flagged.length + ' edited section' + (res.flagged.length === 1 ? '' : 's') + ' flagged for review' : ''), 'success');
      }
    });
  }

  /* ---------- AI ---------- */
  async function askAI(key) {
    if (!AI.isConfigured()) { s.ai = { ok: false, message: AI.statusText() + ' No request was sent.' }; refreshSide(); return; }
    captureAll();
    const instr = (el.querySelector('#ai-instr') || {}).value || '';
    const action = key;
    const def = AI.ACTIONS.find(function (a) { return a.key === key; }) || {};
    if (def.needsInstructions && !instr.trim()) { ui.toast(key === 'question' ? 'Type your question in the box first' : 'Enter your instructions first', 'error'); const t = el.querySelector('#ai-instr'); if (t) t.focus(); return; }
    s.busy = true; s.ai = null; refreshSide();
    const res = await AI.request(action, s.draft, s.active, instr);
    s.busy = false;
    s.ai = Object.assign({ section: s.active, action: action, question: action === 'question' ? instr.trim() : '' }, res);
    refreshSide();
  }

  function useAI(how) {
    if (how === 'discard') { s.ai = null; refreshSide(); return; }
    if (how === 'copy') { try { navigator.clipboard.writeText(s.ai.text); ui.toast('Answer copied', 'success'); } catch (e) { ui.toast('Copy not available', 'error'); } return; }
    const r = s.ai;
    const sec = s.draft.sections[r.section];
    captureAll();
    const html = AI.textToHtml(r.text);
    sec.html = how === 'replace' ? html : sec.html + html;
    sec.aiDraft = true;
    sec.status = 'edited';
    sec.updatedAt = new Date().toISOString();
    s.ai = null;
    markDirty(); paint(); setActive(r.section, true);
    ui.toast('Inserted as an AI draft — review before approval', 'success');
  }

  function showPayload() {
    captureAll();
    const p = AI.buildRequest('improve_writing', s.draft, s.active, '');
    ui.modal({
      title: 'Request preview', subtitle: 'Exactly what would be sent to your AI backend for this section. No API key is included — the backend adds it server-side.', size: 'wide', confirmLabel: 'Close', cancelLabel: 'Copy JSON',
      body: '<pre class="payload">' + U.esc(JSON.stringify(p, null, 2)) + '</pre>',
      onOpen: function (form) {
        form.querySelector('.modal__foot .btn--ghost').addEventListener('click', function (e) {
          e.stopPropagation();
          try { navigator.clipboard.writeText(JSON.stringify(p, null, 2)); ui.toast('Copied', 'success'); } catch (x) { /* ignore */ }
        }, true);
      }
    });
  }

  /* ---------- Export ---------- */
  function doExport(kind) {
    captureAll();
    const doc = locked(report()) || !s.dirty ? report() : s.draft;
    if (s.dirty) ui.toast('Exporting your unsaved edits — remember to save the draft', 'info');
    DA.reportExport.run(kind, doc);
  }

  /* =========================================================
   * Preview — #/reports/:id/preview[?rev=N]
   * ========================================================= */
  function renderPreview(target, params) {
    const r = store.getReport(params.id);
    if (!r) { DA.views.notFound.render(target); return; }
    R.ensureDocCss();
    const q = params.query || {};
    let doc = r, revNote = '';
    if (q.rev !== undefined && r.revisions[Number(q.rev)]) {
      const rv = r.revisions[Number(q.rev)];
      doc = Object.assign(clone(r), rv.content, { revision: rv.revision, status: rv.status });
      revNote = '<div class="alert alert--info no-print">' + ui.icon('repeat', 16) + '<div>Viewing <strong>revision ' + rv.revision + '</strong> as saved on ' + U.fmtDate(rv.savedAt, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' (' + U.esc(rv.note || '') + '). Read only.</div></div>';
    } else if (sessions[r.id] && sessions[r.id].dirty) {
      revNote = '<div class="alert alert--info no-print">' + ui.icon('alert', 16) + '<div>You have unsaved edits in the editor. This preview shows the last saved version.</div></div>';
    }
    target.innerHTML = '<div class="pv-bar no-print"><a class="back-link" href="#/reports/' + r.id + '">' + ui.icon('chevronLeft', 15) + 'Back to editor</a>' +
      '<div class="pv-bar__actions"><button class="btn btn--ghost btn--sm" data-x="print">' + ui.icon('printer', 15) + 'Print</button><button class="btn btn--ghost btn--sm" data-x="html">' + ui.icon('fAlign', 15) + 'HTML</button><button class="btn btn--secondary btn--sm" data-x="docx">' + ui.icon('reports', 15) + 'Word</button><button class="btn btn--primary btn--sm" data-x="pdf">' + ui.icon('download', 15) + 'PDF</button></div></div>' +
      revNote + '<div class="pv-paper">' + R.documentHtml(doc) + '</div>';
    target.querySelectorAll('[data-x]').forEach(function (b) { b.addEventListener('click', function () { DA.reportExport.run(b.dataset.x, doc); }); });
  }

  return {
    nav: 'reports',
    keepOnStoreChange: true,
    title: function () { return 'Report Editor'; },
    crumbs: function (p) {
      const r = store.getReport(p.id);
      return [{ label: 'Insight' }, { label: 'Reports', href: '#/reports' }, { label: r ? r.title : 'Report' }];
    },
    render: render,
    hasUnsaved: function (id) { return !!(sessions[id] && sessions[id].dirty); },
    preview: {
      nav: 'reports',
      title: function () { return 'Report Preview'; },
      crumbs: function (p) {
        const r = store.getReport(p.id);
        return [{ label: 'Insight' }, { label: 'Reports', href: '#/reports' }, { label: r ? r.title : 'Report', href: r ? '#/reports/' + r.id : null }, { label: 'Preview' }];
      },
      render: renderPreview
    }
  };
})();
