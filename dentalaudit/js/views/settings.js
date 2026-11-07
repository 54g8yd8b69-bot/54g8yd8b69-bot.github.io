/* DentalAudit — Settings: profile, defaults, data management */
DA.views.settings = (function () {
  const LOCAL_AI = 'http://localhost:8787/api/dentalaudit-ai';
  const U = DA.utils, ui = DA.ui, store = DA.store;

  /** Status line: switched off, configured, or the result of the last connection test. */
  function aiStateHtml(ai) {
    const lc = ai.lastCheck;
    if (lc && ai.enabled && lc.endpoint === ai.endpoint) {
      return '<div class="ai-state ' + (lc.ok ? 'is-on' : 'is-err') + '" id="ai-state">' + ui.icon(lc.ok ? 'check' : 'alert', 15) + '<span>' + U.esc(lc.message) + ' <span class="muted">(' + U.relTime(lc.at) + ')</span></span></div>';
    }
    return '<div class="ai-state ' + (DA.ai.isConfigured() ? 'is-on' : 'is-off') + '" id="ai-state">' + ui.icon(DA.ai.isConfigured() ? 'check' : 'shield', 15) + '<span>' + U.esc(DA.ai.statusText()) + '</span></div>';
  }

  function confirmReset() {
    ui.confirm({
      title: 'Reset demo data?',
      message: 'All audits, cases and activity will be replaced with the example dental audits. Your profile and preferences are kept.',
      confirmLabel: 'Reset data', danger: true,
      onConfirm: function () { store.resetDemo(); ui.toast('Demo data restored', 'success'); }
    });
  }

  function storageSize() {
    try {
      const raw = localStorage.getItem(store.KEY) || '';
      return (raw.length / 1024).toFixed(1) + ' KB';
    } catch (e) { return 'unavailable'; }
  }

  function num(name, label, value, min, max, suffix, hint) {
    return '<label class="field"><span class="field__label">' + label + '</span>' +
      '<div class="input-suffix"><input class="input" type="number" name="' + name + '" min="' + min + '" max="' + max + '" value="' + U.esc(value) + '" required><span>' + suffix + '</span></div>' +
      (hint ? '<span class="field__hint">' + hint + '</span>' : '') + '<span class="field__error">Enter a value from ' + min + ' to ' + max + '.</span></label>';
  }

  function render(el) {
    const s = store.getSettings();
    const n = store.getAudits().length;

    el.innerHTML =
      '<div class="page-head"><div><h2 class="page-head__title">Settings</h2><p class="page-head__sub">Profile, audit defaults and data stored in this browser</p></div></div>' +
      '<div class="settings">' +
        '<form class="card settings__sec" id="profile-form" novalidate>' +
          '<div class="settings__intro"><h3>Profile</h3><p class="muted small">Shown in the top bar and used as the default audit lead.</p></div>' +
          '<div class="settings__fields">' +
            '<div class="profile-preview"><span class="avatar avatar--lg" id="pv-avatar">' + U.esc(U.initials(s.userName)) + '</span><div><div class="cell-title" id="pv-name">' + U.esc(s.userName) + '</div><div class="muted small" id="pv-role">' + U.esc(s.userRole) + '</div></div></div>' +
            '<div class="grid-2">' +
              '<label class="field"><span class="field__label">Full name</span><input class="input" name="userName" value="' + U.esc(s.userName) + '" required><span class="field__error">Name is required.</span></label>' +
              '<label class="field"><span class="field__label">Role</span><input class="input" name="userRole" value="' + U.esc(s.userRole) + '"></label>' +
            '</div>' +
            '<div class="grid-2">' +
              '<label class="field"><span class="field__label">Organisation</span><input class="input" name="organisation" value="' + U.esc(s.organisation) + '"></label>' +
              '<label class="field"><span class="field__label">Default department</span><input class="input" name="department" value="' + U.esc(s.department) + '"></label>' +
            '</div>' +
            '<div class="settings__actions"><button class="btn btn--primary" type="submit">Save profile</button></div>' +
          '</div>' +
        '</form>' +

        '<form class="card settings__sec" id="defaults-form" novalidate>' +
          '<div class="settings__intro"><h3>Audit defaults</h3><p class="muted small">Applied to new audits and to dashboard indicators.</p></div>' +
          '<div class="settings__fields">' +
            '<div class="grid-2">' +
              num('defaultTarget', 'Default compliance target', s.defaultTarget, 1, 100, '%', 'Pre-filled for new criteria.') +
              num('amberMargin', '“Near target” margin', s.amberMargin, 0, 50, 'pts', 'Within this many points of target shows as near target.') +
            '</div>' +
            '<div class="grid-2">' +
              num('reauditMonths', 'Default re-audit interval', s.reauditMonths, 1, 36, 'months', '') +
              num('deadlineWindow', 'Deadline look-ahead', s.deadlineWindow, 7, 180, 'days', 'How far ahead the dashboard lists deadlines.') +
            '</div>' +
            '<div class="settings__actions"><button class="btn btn--primary" type="submit">Save defaults</button></div>' +
          '</div>' +
        '</form>' +

        '<form class="card settings__sec" id="ai-form" novalidate>' +
          '<div class="settings__intro"><h3>AI assistant</h3><p class="muted small">Connect the report assistant to a secure backend that you host. API keys stay on that server — they are never entered or stored here.</p></div>' +
          '<div class="settings__fields">' +
            aiStateHtml(s.ai) +
            '<label class="switch"><input type="checkbox" name="enabled"' + (s.ai.enabled ? ' checked' : '') + '><span class="switch__track"><span class="switch__thumb"></span></span><span class="switch__label">Enable AI assistant<span class="switch__hint">When off, report drafting uses only the built-in, data-driven templates.</span></span></label>' +
            '<label class="field"><span class="field__label">Secure backend endpoint</span><input class="input" name="endpoint" type="url" placeholder="' + LOCAL_AI + '" value="' + U.esc(s.ai.endpoint || LOCAL_AI) + '" autocomplete="off" spellcheck="false">' +
              '<span class="field__hint">Local development: start the backend with <code>npm run start:ai</code> and use <code>' + LOCAL_AI + '</code>. HTTPS is required for anything other than localhost.</span><span class="field__error"></span></label>' +
            '<div class="grid-2">' +
              '<label class="field"><span class="field__label">Provider used by the backend</span><select class="select" name="provider"><option value="anthropic"' + (s.ai.provider !== 'openai' ? ' selected' : '') + '>Anthropic Claude</option><option value="openai"' + (s.ai.provider === 'openai' ? ' selected' : '') + '>OpenAI</option></select></label>' +
              '<label class="field"><span class="field__label">Model</span><input class="input" name="model" value="' + U.esc(s.ai.lastCheck && s.ai.lastCheck.model ? s.ai.lastCheck.model : '') + '" placeholder="Set on the backend (AI_MODEL in .env)" readonly tabindex="-1"><span class="field__hint">Chosen by the backend from <code>AI_MODEL</code> in its <code>.env</code> file. Shown here after a successful test.</span></label>' +
            '</div>' +
            '<label class="switch"><input type="checkbox" name="includeNarrative"' + (s.ai.includeNarrative ? ' checked' : '') + '><span class="switch__track"><span class="switch__thumb"></span></span><span class="switch__label">Include audit narrative<span class="switch__hint">Background, aim and objectives text. Results are always sent as aggregates only; case records and staff names are never sent.</span></span></label>' +
            '<div class="settings__actions"><button type="button" class="btn btn--ghost" id="ai-test">' + ui.icon('refresh', 15) + 'Test connection</button><button class="btn btn--primary" type="submit">Save AI settings</button></div>' +
          '</div>' +
        '</form>' +
        '<section class="card settings__sec">' +
          '<div class="settings__intro"><h3>Data</h3><p class="muted small">This prototype stores everything in your browser’s localStorage. Nothing is sent to a server.</p></div>' +
          '<div class="settings__fields">' +
            '<div class="data-status"><span class="storage-note__dot' + (store.isPersistent() ? '' : ' is-off') + '"></span>' +
              '<span>' + (store.isPersistent() ? 'Saving to this browser' : 'Storage unavailable — changes will be lost on reload') + ' · ' + n + ' audits · ' + storageSize() + '</span></div>' +
            '<div class="data-actions">' +
              '<div class="data-action"><div><div class="cell-title">Export data</div><div class="muted small">Download a JSON backup of all audits and settings.</div></div><button class="btn btn--secondary" id="d-export">' + ui.icon('download', 16) + 'Export</button></div>' +
              '<div class="data-action"><div><div class="cell-title">Import data</div><div class="muted small">Restore from a DentalAudit JSON export. Replaces current data.</div></div><label class="btn btn--secondary">' + ui.icon('upload', 16) + 'Import<input type="file" accept="application/json,.json" id="d-import" class="sr-only"></label></div>' +
              '<div class="data-action"><div><div class="cell-title">Synthetic test audit</div><div class="muted small">Add the labelled “Implant Crown Torque Documentation Audit (synthetic test data)” — Cycle 1 baseline 30/40 (75%) — to test quality improvement and re-audit.</div></div><button class="btn btn--secondary" id="d-synth"' + (store.getAudit('aud_torque_test') ? ' disabled' : '') + '>' + ui.icon('plus', 16) + (store.getAudit('aud_torque_test') ? 'Added' : 'Add') + '</button></div>' +
              '<div class="data-action"><div><div class="cell-title">Reset demo data</div><div class="muted small">Replace all audits with the example dental audits.</div></div><button class="btn btn--secondary" id="d-reset">' + ui.icon('refresh', 16) + 'Reset</button></div>' +
              '<div class="data-action data-action--danger"><div><div class="cell-title">Delete all audits</div><div class="muted small">Start with an empty workspace. This can’t be undone.</div></div><button class="btn btn--danger-ghost" id="d-clear">' + ui.icon('trash', 16) + 'Delete all</button></div>' +
            '</div>' +
          '</div>' +
        '</section>' +

        '<section class="card settings__sec">' +
          '<div class="settings__intro"><h3>About</h3><p class="muted small">DentalAudit prototype v1.0</p></div>' +
          '<div class="settings__fields"><p class="muted small">Example audits are fictional and use pseudonymised case references. Do not enter patient-identifiable information. Compliance is calculated as met ÷ (met + not met), excluding N/A.</p></div>' +
        '</section>' +
      '</div>';

    // Live preview of profile
    const pf = el.querySelector('#profile-form');
    pf.elements.userName.addEventListener('input', function (e) {
      el.querySelector('#pv-name').textContent = e.target.value;
      el.querySelector('#pv-avatar').textContent = U.initials(e.target.value);
    });
    pf.elements.userRole.addEventListener('input', function (e) { el.querySelector('#pv-role').textContent = e.target.value; });
    pf.addEventListener('submit', function (e) {
      e.preventDefault();
      const f = pf.elements;
      if (!f.userName.value.trim()) { f.userName.closest('.field').classList.add('has-error'); f.userName.focus(); return; }
      store.updateSettings({ userName: f.userName.value.trim(), userRole: f.userRole.value.trim(), organisation: f.organisation.value.trim(), department: f.department.value.trim() });
      ui.toast('Profile saved', 'success');
    });

    const df = el.querySelector('#defaults-form');
    df.addEventListener('submit', function (e) {
      e.preventDefault();
      let ok = true;
      const patch = {};
      ['defaultTarget', 'amberMargin', 'reauditMonths', 'deadlineWindow'].forEach(function (k) {
        const inp = df.elements[k];
        const v = Number(inp.value);
        const field = inp.closest('.field');
        field.classList.remove('has-error');
        if (inp.value === '' || isNaN(v) || v < Number(inp.min) || v > Number(inp.max)) { field.classList.add('has-error'); ok = false; }
        else patch[k] = v;
      });
      if (!ok) return;
      store.updateSettings(patch);
      ui.toast('Defaults saved', 'success');
    });

    const aiForm = el.querySelector('#ai-form');
    function readAi() {
      const f = aiForm.elements;
      return { enabled: f.enabled.checked, endpoint: f.endpoint.value.trim(), provider: f.provider.value, model: '', includeNarrative: f.includeNarrative.checked, timeoutMs: s.ai.timeoutMs || 60000, lastCheck: store.getSettings().ai.lastCheck || null };
    }
    function aiError(cfg) {
      const fieldEl = aiForm.elements.endpoint.closest('.field');
      const msg = cfg.endpoint ? DA.ai.endpointProblem(cfg.endpoint) : (cfg.enabled ? 'Enter the endpoint of your secure AI backend, or switch the assistant off.' : '');
      fieldEl.classList.toggle('has-error', !!msg);
      fieldEl.querySelector('.field__error').textContent = msg;
      return msg;
    }
    aiForm.addEventListener('submit', function (e) {
      e.preventDefault();
      const cfg = readAi();
      if (aiError(cfg)) return;
      store.updateSettings({ ai: cfg });
      ui.toast('AI settings saved', 'success');
    });
    el.querySelector('#ai-test').addEventListener('click', async function () {
      const cfg = readAi();
      if (aiError(cfg)) return;
      if (!cfg.enabled) { ui.toast('Switch the assistant on to test the connection', 'error'); return; }
      store.updateSettings({ ai: cfg });
      const btn = el.querySelector('#ai-test'); btn.disabled = true; btn.lastChild.textContent = 'Testing…';
      const stEl = el.querySelector('#ai-state'); stEl.className = 'ai-state is-off'; stEl.innerHTML = '<span class="spinner"></span><span>Contacting the backend…</span>';
      const res = await DA.ai.testConnection();
      btn.disabled = false; btn.lastChild.textContent = 'Test connection';
      const cur = store.getSettings().ai;
      store.updateSettings({ ai: Object.assign({}, cur, { lastCheck: { at: new Date().toISOString(), ok: !!res.ok, message: res.message, provider: res.provider || '', model: res.model || '', verified: !!res.verified, endpoint: cur.endpoint } }) });
      ui.toast(res.ok ? 'AI backend connected' : 'Connection failed', res.ok ? 'success' : 'error');
    });

    el.querySelector('#d-export').addEventListener('click', function () {
      U.download('dentalaudit-export-' + U.isoDay(new Date()) + '.json', store.exportJSON(), 'application/json');
      ui.toast('Data exported', 'success');
    });
    el.querySelector('#d-import').addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        try {
          store.importJSON(String(reader.result));
          ui.toast('Data imported', 'success');
        } catch (err) {
          ui.toast(err.message || 'Could not read that file', 'error');
        }
      };
      reader.readAsText(file);
    });
    el.querySelector('#d-reset').addEventListener('click', confirmReset);
    el.querySelector('#d-synth').addEventListener('click', function () { const a = store.addSyntheticAudit(); ui.toast('Synthetic test audit added', 'success'); location.hash = '#/audits/' + a.id; });
    el.querySelector('#d-clear').addEventListener('click', function () {
      ui.confirm({
        title: 'Delete all audits?',
        message: 'Every audit, case and action plan will be permanently deleted from this browser. Consider exporting a backup first.',
        confirmLabel: 'Delete everything', danger: true,
        onConfirm: function () { store.clearAll(); ui.toast('All audits deleted', 'success'); }
      });
    });
  }

  return {
    nav: 'settings',
    title: function () { return 'Settings'; },
    crumbs: function () { return [{ label: 'Account' }, { label: 'Settings' }]; },
    render: render,
    confirmReset: confirmReset
  };
})();
