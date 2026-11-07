/* DentalAudit — AI assistant service (provider-independent)
 *
 * The browser NEVER talks to OpenAI or Anthropic directly and NEVER holds an API key.
 * It sends a structured request to a configurable secure backend endpoint (see
 * /server/ai-proxy.example.mjs), which holds the key server-side and calls the provider.
 *
 * Request  POST <endpoint>  { schema: 'dentalaudit.ai.v1', task, section, prompt: { system, user },
 *                             rules, context, constraints }
 * Response 200              { text, provider?, model? }
 *
 * Context is minimised: aggregate results only — no case records, case references,
 * free-text answers, or names of staff.
 * When no backend is configured, nothing is sent and the UI says so plainly.
 */
DA.ai = (function () {
  const U = DA.utils;
  const SCHEMA = 'dentalaudit.ai.v1';

  const RULES = [
    'Use only the numbers provided in context.results. Never calculate, estimate or invent statistics.',
    'Never fabricate clinical results, cases or outcomes.',
    'Never invent citations, guidelines, journal articles, DOIs or URLs. Only cite sources listed in context.audit.references.',
    'Never change, reinterpret or relax the audit standards or their targets.',
    'Never invent a clinical diagnosis or patient outcome.',
    'Distinguish association from causation; do not claim an intervention caused a change.',
    'Label assumptions and uncertainties explicitly. Present possible explanations as hypotheses, not findings.',
    'Do not make clinical decisions or give patient-specific clinical advice.',
    'Write in UK English in a professional, concise clinical audit style. Return the section text only.',
    'If the context does not contain the information needed, say what is missing instead of guessing.'
  ];

  const ACTIONS = [
    { key: 'improve_writing', label: 'Improve professional academic writing', icon: 'collect', any: true, needsText: true,
      task: 'Rewrite the current section text in a clear, professional academic style suitable for a clinical audit report. Preserve every fact and number exactly; do not add new content.' },
    { key: 'executive_summary', label: 'Draft an executive summary', icon: 'reports', sections: ['executive'], template: 'executive',
      task: 'Draft an executive summary (about 200 words) covering background, aim, method, number of cases, main findings with key compliance figures, and main recommendations.' },
    { key: 'interpret', label: 'Interpret the audit findings', icon: 'analytics', sections: ['results', 'discussion', 'executive'],
      task: 'Explain in plain professional language what the results show: which standards were achieved and which were not, the size of any shortfall, and notable patterns (e.g. N/A rates, data completeness, change from the previous cycle).' },
    { key: 'discussion', label: 'Draft a discussion', icon: 'fAlign', sections: ['discussion'], template: 'discussion',
      task: 'Draft a discussion with sub-headings: Observed findings; Possible explanations (clearly labelled as hypotheses to explore); Implications for practice; Areas for further investigation.' },
    { key: 'qi_interventions', label: 'Suggest practical QI interventions', icon: 'target', sections: ['recommendations', 'actionplan', 'discussion'], template: 'recommendations',
      task: 'Suggest practical, measurable quality improvement interventions, each tied to a specific criterion that did not meet its target. Do not suggest interventions for standards that were met except to sustain them.' },
    { key: 'action_plan', label: 'Draft an action plan', icon: 'flag', sections: ['actionplan'],
      task: 'Draft action plan items for each criterion below target: issue, intervention, a role (not a named person) to own it, a success measure linked to the criterion target, and a review point.' },
    { key: 'limitations', label: 'Identify potential limitations', icon: 'alert', sections: ['limitations', 'discussion'], template: 'limitations',
      task: 'List limitations supported by the recorded methodology and dataset characteristics only (sample size vs target, retrospective design, sampling method, single setting, missing or incomplete data, form changes).' },
    { key: 'clarity', label: 'Improve clarity and grammar', icon: 'check', any: true, needsText: true,
      task: 'Correct grammar, spelling and clarity in the current section text. Keep meaning, facts and numbers unchanged.' },
    { key: 'presentation', label: 'Summarise for a presentation', icon: 'dashboard', any: true,
      task: 'Summarise the audit as 5–7 concise bullet points suitable for a departmental audit meeting slide, using only the figures provided.' },
    { key: 'recommendations', label: 'Draft recommendations', icon: 'target', sections: ['recommendations', 'future'], template: 'recommendations',
      task: 'Draft numbered recommendations. Each must relate to a specific finding in context.results (name the criterion and its figure), be practical and measurable, and be phrased as a recommendation for the audit team to consider. Do not add recommendations unrelated to the findings.' },
    { key: 'conclusion', label: 'Draft a conclusion', icon: 'check', sections: ['conclusion', 'compliancechange'], template: 'conclusion',
      task: 'Draft a concise conclusion (about 100–150 words) stating how many predefined standards were achieved, which were not (with their figures), and the next step (action plan and re-audit). Do not introduce new information.' },
    { key: 'question', label: 'Ask a question about this audit', icon: 'search', any: true, needsInstructions: true, answerOnly: true,
      task: 'Answer the user\'s question about this audit using only the context provided. If the context does not contain the answer, say so plainly and state what information would be needed. Keep the answer brief.' },
    { key: 'custom', label: 'Custom request', icon: 'arrowRight', any: true, hidden: true, needsInstructions: true,
      task: 'Carry out the user\'s instructions for the current section, using only the audit context provided.' }
  ];

  function settings() { return DA.store.getSettings().ai; }

  function endpointProblem(url) {
    if (!url) return 'No endpoint URL entered.';
    let u;
    try { u = new URL(url); } catch (e) { return 'The endpoint is not a valid URL.'; }
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return 'Use HTTPS (plain HTTP is only allowed for localhost during development).';
    if (/key=|token=|api[_-]?key/i.test(u.search)) return 'Do not put API keys or tokens in the endpoint URL. Keys belong on the server.';
    return '';
  }

  function isConfigured() {
    const c = settings();
    return !!(c.enabled && c.endpoint && !endpointProblem(c.endpoint));
  }

  function statusText() {
    const c = settings();
    if (!c.enabled) return 'AI assistant is switched off. No audit data is sent anywhere.';
    if (!c.endpoint) return 'No secure AI backend has been configured yet.';
    const p = endpointProblem(c.endpoint);
    return p || 'Connected via ' + new URL(c.endpoint).host + ' (' + (c.provider === 'openai' ? 'OpenAI' : 'Anthropic Claude') + ' through your backend).';
  }

  /* ---------- Context: the minimum needed, aggregate only ---------- */
  function plain(html) {
    const d = document.createElement('div');
    d.innerHTML = (html || '').replace(/<div class="rb"[^>]*><\/div>/g, ' [data table] ');
    d.querySelectorAll('li').forEach(function (li) { li.prepend('• '); li.append('\n'); });
    d.querySelectorAll('p, h3, h4').forEach(function (p) { p.append('\n'); });
    return d.textContent.replace(/\n{3,}/g, '\n\n').trim();
  }

  function buildContext(report, sectionKey) {
    const audit = DA.store.getAudit(report.auditId);
    const s = report.analyticsSnapshot;
    const c = settings();
    const sec = report.sections[sectionKey];
    const month = function (d) { return d ? String(d).slice(0, 7) : null; };
    const ctx = {
      report: { type: DA.reportEngine.TYPES[report.reportType], length: report.length, revision: report.revision },
      audit: {
        title: report.meta.auditTitle, projectType: audit && audit.projectType, specialty: report.meta.specialty, setting: report.meta.department,
        cycle: s.cycleLabel,
        criteria: s.criteria.map(function (x, i) { return { ref: 'C' + (i + 1), name: x.name, target: x.target, measurementMethod: x.measurementMethod, reference: x.reference || null }; }),
        references: report.references.map(function (r) { return r.text; }),
        methodology: audit ? {
          design: audit.methodology || null, samplingMethod: DA.model.samplingText(audit) || null, targetSample: s.totals.targetSample,
          collectionMethods: DA.model.collectionMethodsText(audit), collectedFrom: month(s.totals.collectedFrom), collectedTo: month(s.totals.collectedTo),
          inclusion: DA.model.filled(audit.inclusionCriteria).map(function (x) { return x.text; }),
          exclusion: DA.model.filled(audit.exclusionCriteria).map(function (x) { return x.text; })
        } : null
      },
      results: {
        snapshotDate: s.generatedAt.slice(0, 10),
        totals: { records: s.totals.records, completed: s.totals.completed, incomplete: s.totals.drafts, completenessPct: round(s.totals.completeness), targetSample: s.totals.targetSample, sampleAchievedPct: round(s.totals.sampleAchieved) },
        overall: { compliancePct: round(s.overall.compliance), met: s.overall.met, eligible: s.overall.applicable, criteriaAchieved: s.overall.achieved, criteriaTotal: s.overall.total },
        criteria: s.criteria.map(function (x, i) {
          return { ref: 'C' + (i + 1), compliant: x.numerator, eligible: x.denominator, notApplicable: x.na, notEvidenced: x.notEvidenced, compliancePct: round(x.compliance), target: x.target, achieved: x.achieved };
        }),
        numeric: s.numeric.map(function (n) { return { variable: n.label, n: n.n, mean: round(n.mean, 2), sd: round(n.sd, 2), median: n.median, min: n.min, max: n.max }; }),
        categorical: s.categorical.map(function (k) { return { variable: k.label, n: k.n, distribution: k.rows.map(function (r) { return { response: r.label, n: r.n, pct: round(r.pct) }; }) }; }),
        previousCycle: s.previous ? { cycle: s.previous.cycleLabel, completed: s.previous.completed, criteria: s.previous.criteria.map(function (p, i) { return { ref: 'C' + (i + 1), compliancePct: round(p.compliance), compliant: p.numerator, eligible: p.denominator }; }) } : null,
        method: s.method.compliance
      },
      actionPlan: report.actionPlan.filter(function (a) { return a.approved; }).map(function (a) {
        const i = s.criteria.findIndex(function (x) { return x.id === a.criterionId; });
        return { criterion: i >= 0 ? 'C' + (i + 1) : null, issue: a.issue, intervention: a.intervention, successMeasure: a.successMeasure, status: DA.reportEngine.actionStatus(a) };
      }),
      section: sec ? { key: sec.key, title: sec.title, currentText: plain(sec.html).slice(0, 6000) } : null
    };
    // Quality improvement / re-audit reports: aggregate comparison and improvement work (no names).
    if (s.qi) {
      const q = s.qi;
      const ref = function (name) { const i = s.criteria.findIndex(function (x) { return x.name === name; }); return i >= 0 ? 'C' + (i + 1) : name; };
      ctx.qualityImprovement = {
        aim: q.project ? q.project.aim || null : null,
        baseline: q.baseline ? { cycle: q.baseline.cycleLabel, completed: q.baseline.completed, compliancePct: round(q.baseline.overall.compliance), criteria: q.baseline.rows.map(function (r) { return { ref: ref(r.name), compliant: r.met, eligible: r.denominator, compliancePct: round(r.compliance), target: r.target, achieved: r.achieved }; }) } : null,
        comparison: q.comparison ? {
          from: q.comparison.aLabel, to: q.comparison.bLabel, completedFrom: q.comparison.a.completed, completedTo: q.comparison.b.completed,
          overall: { fromPct: round(q.comparison.overall.a.compliance), toPct: round(q.comparison.overall.b.compliance), absoluteChangePP: round(q.comparison.overall.pp), relativeChangePct: round(q.comparison.overall.rel, 2) },
          criteria: q.comparison.rows.map(function (r) { return { ref: ref(r.name), fromPct: r.a ? round(r.a.compliance) : null, toPct: r.b ? round(r.b.compliance) : null, fromCompliant: r.a ? r.a.met : null, toCompliant: r.b ? r.b.met : null, fromEligible: r.a ? r.a.denominator : null, toEligible: r.b ? r.b.denominator : null, absoluteChangePP: round(r.pp), relativeChangePct: r.relNote ? null : round(r.rel, 2), comparability: r.level, excluded: r.excluded }; }),
          notes: q.comparison.notes
        } : null,
        interventions: q.interventions.map(function (i) { return { title: i.title, criterion: i.criterion ? ref(i.criterion) : null, change: i.proposedSolution, successMeasure: i.successMeasure, status: i.status, completed: i.completedAt ? String(i.completedAt).slice(0, 7) : null, effectiveness: i.effectiveness ? i.effectiveness.rating : null }; }),
        pdsa: q.pdsa.map(function (x) { return { cycle: x.n, change: x.plan.change, prediction: x.plan.prediction, results: x.study.results, learned: x.study.learned, decision: x.act.decisionLabel || null }; })
      };
    }
    if (c.includeNarrative && audit) {
      ctx.audit.question = audit.auditQuestion || null;
      ctx.audit.background = audit.background || null;
      ctx.audit.aim = audit.aim || null;
      ctx.audit.objectives = DA.model.filled(audit.objectives).map(function (o) { return o.text; });
    }
    return ctx;
  }

  function round(v, dp) {
    if (v === null || v === undefined || isNaN(v)) return null;
    const f = Math.pow(10, dp || 1);
    return Math.round(v * f) / f;
  }

  /* ---------- Prompt assembly (backend may use it as-is) ---------- */
  function buildRequest(actionKey, report, sectionKey, instructions) {
    const action = ACTIONS.find(function (a) { return a.key === actionKey; });
    const context = buildContext(report, sectionKey);
    const system = 'You are an assistant helping a UK dental clinician write a clinical audit report. Follow these rules strictly:\n' +
      RULES.map(function (r, i) { return (i + 1) + '. ' + r; }).join('\n');
    const user = 'Task: ' + (action ? action.task : 'Help with the report section.') + '\n' +
      (context.section ? 'Section: ' + context.section.title + '\n' : '') +
      (instructions ? (actionKey === 'question' ? 'Question: ' : 'Additional instructions from the user: ') + instructions + '\n' : '') +
      'Audit context (JSON):\n' + JSON.stringify(context);
    return {
      schema: SCHEMA, task: actionKey, section: sectionKey,
      model: null, providerPreference: settings().provider, // the backend chooses the model (AI_MODEL in its .env)
      prompt: { system: system, user: user },
      rules: RULES, context: context,
      constraints: { maxWords: actionKey === 'presentation' ? 150 : actionKey === 'question' ? 250 : actionKey === 'conclusion' ? 200 : 600, format: 'plain text with optional "- " bullets and "### " sub-headings' }
    };
  }

  /** Human-readable list of what would be transmitted (shown before sending). */
  function describeContext(ctx) {
    return [
      'Audit title, project type, specialty and department',
      ctx.audit.criteria.length + ' criteria (name, target, measurement method, reference source)',
      ctx.audit.question !== undefined ? 'Audit question, background, aim and objectives' : 'No narrative text (switched off in settings)',
      'Methodology summary (design, sampling, collection methods, month range)',
      'Aggregate results only: totals and per-criterion counts and percentages',
      ctx.results.numeric.length || ctx.results.categorical.length ? 'Summary statistics for ' + (ctx.results.numeric.length + ctx.results.categorical.length) + ' form variables' : null,
      ctx.actionPlan.length ? ctx.actionPlan.length + ' approved actions (no names)' : null,
      ctx.section ? 'Current text of “' + ctx.section.title + '”' : null,
      ctx.qualityImprovement ? 'Quality improvement summary: baseline and re-audit percentages, intervention titles and PDSA outcomes (no names)' : null
    ].filter(Boolean);
  }
  const NOT_SENT = ['Case records, case references or individual answers', 'Free-text responses from case forms', 'Names of the audit lead, collaborators, author or reviewer', 'Institution name', 'Any API key (keys live only on your server)'];

  /* ---------- Transport ---------- */
  async function post(payload) {
    const c = settings();
    if (!isConfigured()) return { ok: false, code: 'not_configured', message: statusText() };
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, Number(c.timeoutMs) || 45000);
    try {
      const res = await fetch(c.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        signal: ctrl.signal, credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer'
      });
      const text = await res.text();
      let body = null;
      try { body = JSON.parse(text); } catch (e) { /* not JSON */ }
      if (!res.ok) return { ok: false, code: 'http_' + res.status, message: 'The AI backend returned an error (' + res.status + ')' + (body && body.error ? ': ' + body.error : '.') };
      if (!body) return { ok: false, code: 'bad_response', message: 'The AI backend did not return JSON.' };
      return { ok: true, body: body };
    } catch (e) {
      return { ok: false, code: e.name === 'AbortError' ? 'timeout' : 'network', message: e.name === 'AbortError' ? 'The AI backend did not respond in time.' : 'Could not reach the AI backend (' + (e.message || 'network error') + ').' };
    } finally { clearTimeout(timer); }
  }

  async function request(actionKey, report, sectionKey, instructions) {
    const payload = buildRequest(actionKey, report, sectionKey, instructions);
    const res = await post(payload);
    if (!res.ok) return res;
    const text = String(res.body.text || '').trim();
    if (!text) return { ok: false, code: 'empty', message: 'The AI backend returned no text.' };
    const audit = DA.store.getAudit(report.auditId);
    return { ok: true, text: text, provider: res.body.provider || settings().provider, model: res.body.model || settings().model || '', unverified: verifyNumbers(text, report, audit) };
  }

  /** Ping the backend. verify=true asks it to make a minimal live request to the AI provider. */
  async function testConnection() {
    const res = await post({ schema: SCHEMA, task: 'ping', verify: true });
    if (!res.ok) return res;
    const b = res.body || {};
    if (!b.ok) return { ok: false, code: 'bad_ping', message: b.error || 'The endpoint responded but not with the DentalAudit AI contract ({ ok: true }).' };
    return { ok: true, provider: b.provider || '', model: b.model || '', verified: !!b.verified,
      message: (b.verified ? 'Connected — a live test request to ' : 'Backend reachable — configuration found for ') + (b.provider === 'openai' ? 'OpenAI' : 'Anthropic Claude') + (b.model ? ' (' + b.model + ')' : '') + (b.verified ? ' succeeded.' : '. A live request has not been tested.') };
  }

  /**
   * Rule 1 guard: every number in AI text must exist in the analytics snapshot.
   * Years and small list ordinals are ignored. Returns the numbers that could not be traced.
   */
  function verifyNumbers(text, report, audit) {
    const known = DA.reportEngine.snapshotNumbers(report.analyticsSnapshot, audit);
    const out = [];
    (String(text).match(/\d+(?:\.\d+)?%?/g) || []).forEach(function (tok) {
      const isPct = /%$/.test(tok);
      const v = Number(tok.replace('%', ''));
      if (!isPct && v >= 1900 && v <= 2100 && Number.isInteger(v)) return;
      if (!isPct && Number.isInteger(v) && v <= 10) return;
      const keys = [String(v), String(Math.round(v)), String(Math.round(v * 10) / 10)];
      if (!keys.some(function (k) { return known.has(k); }) && out.indexOf(tok) === -1) out.push(tok);
    });
    return out;
  }

  /** Convert returned plain text (bullets, ### headings) to safe section HTML. */
  function textToHtml(text) {
    const lines = String(text).replace(/\r/g, '').split('\n');
    let html = '', list = null;
    const close = function () { if (list) { html += '</' + list + '>'; list = null; } };
    lines.forEach(function (raw) {
      const l = raw.trim();
      if (!l) { close(); return; }
      let m;
      if ((m = /^#{1,4}\s+(.*)$/.exec(l))) { close(); html += '<h4>' + inline(m[1]) + '</h4>'; return; }
      if ((m = /^[-•*]\s+(.*)$/.exec(l))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += '<li>' + inline(m[1]) + '</li>'; return; }
      if ((m = /^\d+[.)]\s+(.*)$/.exec(l))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += '<li>' + inline(m[1]) + '</li>'; return; }
      close(); html += '<p>' + inline(l) + '</p>';
    });
    close();
    return DA.reportRender.sanitize(html);
    function inline(s) { return U.esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, '$1<em>$2</em>'); }
  }

  return {
    SCHEMA, RULES, ACTIONS, NOT_SENT,
    settings, isConfigured, statusText, endpointProblem,
    buildContext, buildRequest, describeContext, request, testConnection, verifyNumbers, textToHtml, plain, post
  };
})();
