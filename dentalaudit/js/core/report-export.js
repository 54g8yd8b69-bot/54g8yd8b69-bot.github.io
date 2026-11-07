/* DentalAudit — report export: PDF (jsPDF + autoTable), Word (.docx), HTML, print
 * Libraries are bundled in js/vendor and loaded on first use, so exports work offline.
 * Every export is built from the report's frozen analytics snapshot.
 */
DA.reportExport = (function () {
  const U = DA.utils, ui = DA.ui, E = DA.reportEngine, R = DA.reportRender;

  /* =========================================================
   * Library loading
   * ========================================================= */
  const loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve;
      s.onerror = function () { delete loaded[src]; reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
    return loaded[src];
  }

  /* =========================================================
   * Shared document model: section HTML → items
   * ========================================================= */
  function runsOf(node, style, out) {
    node.childNodes.forEach(function (n) {
      if (n.nodeType === 3) { if (n.textContent) out.push({ text: n.textContent.replace(/\s+/g, ' '), bold: style.bold, italic: style.italic, ph: style.ph }); return; }
      if (n.nodeType !== 1) return;
      const t = n.tagName;
      if (t === 'BR') { out.push({ text: '\n' }); return; }
      runsOf(n, { bold: style.bold || t === 'STRONG' || t === 'B', italic: style.italic || t === 'EM' || t === 'I', ph: style.ph || n.classList.contains('ph') }, out);
    });
    return out;
  }

  function tableRows(table) {
    const rows = Array.prototype.map.call(table.querySelectorAll('tr'), function (tr) {
      return { head: !!tr.querySelector('th') && !tr.querySelector('td'), cells: Array.prototype.map.call(tr.children, function (c) { return c.textContent.trim(); }) };
    });
    const head = rows.length && rows[0].head ? rows.shift().cells : null;
    return { head: head, body: rows.map(function (r) { return r.cells; }) };
  }

  /** Data block → export items (same content as the on-screen block). */
  function blockItems(key, arg, report, ctr) {
    const s = report.analyticsSnapshot;
    const P = E.pct, PS = E.pctShort;
    const src = { type: 'source', text: 'Source: DentalAudit analytics snapshot, ' + U.fmtDate(s.generatedAt, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' · ' + s.cycleLabel + ' · ' + s.totals.completed + ' completed records' + (s.form ? ' · form v' + s.form.version : '') };
    const cap = function (t) { ctr.tab++; return { type: 'caption', text: 'Table ' + ctr.tab + '. ' + t }; };
    if (DA.qiReport && DA.qiReport.has(key)) {
      // Same table specs as the on-screen block, mapped to export items.
      return DA.qiReport.parts(key, report).reduce(function (acc, x) {
        if (x.type === 'caption') { if (x.kind === 'figure') { ctr.fig++; acc.push({ type: 'caption', text: 'Figure ' + ctr.fig + '. ' + x.text }); } else acc.push(cap(x.text)); }
        else if (x.type === 'chart') {
          const url = R.chartImage(x.kind, s);
          if (url) { acc.push({ type: 'image', url: url }); ctr.fig++; acc.push({ type: 'caption', text: 'Figure ' + ctr.fig + '. ' + x.caption }); }
          else acc.push({ type: 'note', text: 'Chart not available.' });
        }
        else acc.push(x);
        return acc;
      }, []);
    }
    const fig = function (t) { ctr.fig++; return { type: 'caption', text: 'Figure ' + ctr.fig + '. ' + t }; };
    const ach = function (v) { return v === null ? 'No data' : v ? 'Achieved' : 'Not achieved'; };
    switch (key) {
      case 'criteria-table':
        return [cap('Audit standards, targets and results'), { type: 'table', head: ['#', 'Criterion', 'Clinical standard', 'Reference source', 'Target', 'Actual', 'Eligible', 'Target achieved'], center: [0, 4, 5, 6, 7], widths: [4, 19, 22, 20, 7, 7, 8, 13],
          body: s.criteria.map(function (c, i) { return [String(i + 1), c.name, c.description || c.numeratorDef || '—', c.reference || '—', c.target + '%', PS(c.compliance), String(c.denominator), ach(c.achieved)]; }) }, src];
      case 'results-summary': {
        const t = s.totals;
        return [{ type: 'kpis', pairs: [['Total records', String(t.records)], ['Completed records', String(t.completed)], ['Data completeness', PS(t.completeness)],
          ['Target sample', t.targetSample ? t.completed + ' / ' + t.targetSample + ' (' + PS(t.sampleAchieved) + ')' : '—'],
          ['Overall compliance', PS(s.overall.compliance) + (s.overall.applicable ? ' (' + s.overall.met + '/' + s.overall.applicable + ')' : '')], ['Criteria achieved', s.overall.achieved + ' / ' + s.overall.total]] }, src];
      }
      case 'results-table':
        return [cap('Compliance by criterion'), { type: 'table', head: ['#', 'Criterion', 'Numerator (met)', 'Denominator (eligible)', 'N/A (excluded)', 'Not evidenced', 'Compliance', 'Target', 'Achieved'], center: [0, 2, 3, 4, 5, 6, 7, 8], widths: [4, 24, 11, 13, 9, 9, 11, 7, 12],
          body: s.criteria.map(function (c, i) { return [String(i + 1), c.name, String(c.numerator), String(c.denominator), String(c.na), String(c.notEvidenced), P(c.compliance), c.target + '%', ach(c.achieved)]; })
            .concat([['', 'All criterion assessments', String(s.overall.met), String(s.overall.applicable), '', '', P(s.overall.compliance), '', s.overall.achieved + '/' + s.overall.total]]), totalRow: true }, src, { type: 'source', text: s.method.compliance }];
      case 'chart-compliance': case 'chart-cycle': case 'chart-cat': {
        const url = R.chartImage(key, s, arg);
        if (!url) return [{ type: 'note', text: 'Chart not available — no scored data in this snapshot.' }];
        const title = key === 'chart-compliance' ? 'Compliance by criterion against target (navy line marks the target)'
          : key === 'chart-cycle' ? 'Compliance by criterion: ' + (s.previous ? s.previous.cycleLabel : '') + ' compared with ' + s.cycleLabel
          : 'Distribution of responses: ' + ((s.categorical.find(function (c) { return c.fieldId === arg; }) || {}).label || '');
        return [{ type: 'image', url: url }, fig(title), src];
      }
      case 'numeric-summary':
        if (!s.numeric.length) return [{ type: 'note', text: 'No numerical fields in the data collection form.' }];
        return [cap('Summary of numerical variables (completed records)'), { type: 'table', head: ['Variable', 'n', 'Mean', 'SD', 'Median', 'Min', 'Max', 'Missing / N/A'], center: [1, 2, 3, 4, 5, 6, 7],
          body: s.numeric.map(function (n) { const f = function (v, dp) { return v === null || v === undefined ? '—' : dp ? v.toFixed(dp) : String(v); }; return [n.label + (n.scale ? ' (scale ' + n.scale + ')' : ''), String(n.n), f(n.mean, 2), f(n.sd, 2), f(n.median, 1), f(n.min), f(n.max), n.missing + ' / ' + n.na]; }) }, src];
      case 'categorical':
        if (!s.categorical.length) return [{ type: 'note', text: 'No categorical fields other than criterion questions.' }];
        return s.categorical.reduce(function (acc, c) {
          return acc.concat([cap(c.label + ' (n = ' + c.n + (c.multi ? '; multiple selections allowed' : '') + ')'), { type: 'table', head: ['Response', 'n', '%'], center: [1, 2], narrow: true,
            body: c.rows.map(function (r) { return [r.label, String(r.n), PS(r.pct)]; }).concat(c.missing ? [['Not answered', String(c.missing), '']] : []) }]);
        }, []).concat([src]);
      case 'cycle-table':
        if (!s.previous) return [{ type: 'note', text: 'No previous cycle to compare with.' }];
        return [cap('Comparison with ' + s.previous.cycleLabel), { type: 'table', head: ['Criterion', s.previous.cycleLabel, s.cycleLabel, 'Change', 'Target'], center: [1, 2, 3, 4],
          body: s.criteria.map(function (c) {
            const p = s.previous.criteria.find(function (x) { return x.id === c.id; }) || {};
            const d = p.compliance !== null && p.compliance !== undefined && c.compliance !== null ? c.compliance - p.compliance : null;
            return [c.name, PS(p.compliance) + (p.denominator ? ' (' + p.numerator + '/' + p.denominator + ')' : ''), PS(c.compliance) + (c.denominator ? ' (' + c.numerator + '/' + c.denominator + ')' : ''), d === null ? '—' : (d > 0 ? '+' : '') + Math.round(d) + ' pts', c.target + '%'];
          }) }, src];
      case 'action-plan': {
        const acts = report.actionPlan.filter(function (a) { return a.approved; });
        if (!acts.length) return [{ type: 'note', text: 'No actions have been approved yet.' }];
        return [cap('Action plan'), { type: 'table', small: true, head: ['#', 'Issue identified', 'Criterion', 'Intervention', 'Responsible', 'Target date', 'Success measure', 'Review date', 'Status'], widths: [4, 17, 13, 17, 10, 9, 13, 9, 8],
          body: acts.map(function (a, i) { const c = s.criteria.find(function (x) { return x.id === a.criterionId; }); return [String(i + 1), a.issue, c ? c.name : '—', a.intervention, a.responsible || '—', a.targetDate ? U.fmtDate(a.targetDate) : '—', a.successMeasure || '—', a.reviewDate ? U.fmtDate(a.reviewDate) : '—', E.actionStatus(a)]; }) }];
      }
      case 'references':
        return report.references.length ? [{ type: 'list', ordered: true, items: report.references.map(function (r) { return [{ text: r.text }]; }) }] : [{ type: 'note', text: 'No references recorded.' }];
      case 'form-fields':
        if (!s.form) return [{ type: 'note', text: 'No data collection form.' }];
        return [cap('Data collection form, version ' + s.form.version), { type: 'table', head: ['#', 'Question', 'Type', 'Required', 'Linked criterion', 'Scoring rule'], center: [0, 3],
          body: s.form.fields.map(function (f, i) { const c = s.criteria.find(function (x) { return x.id === f.linkedCriterionId; }); return [String(i + 1), f.label, f.type, f.required ? 'Yes' : 'No', c ? c.name : '—', f.rule || '—']; }) }];
    }
    return [];
  }

  function sectionItems(sec, report, ctr) {
    const doc = new DOMParser().parseFromString('<body>' + sec.html + '</body>', 'text/html');
    const items = [];
    doc.body.childNodes.forEach(function (n) {
      if (n.nodeType === 3) { if (n.textContent.trim()) items.push({ type: 'p', runs: [{ text: n.textContent.trim() }] }); return; }
      if (n.nodeType !== 1) return;
      const t = n.tagName;
      if (t === 'DIV' && n.classList.contains('rb')) { items.push.apply(items, blockItems(n.getAttribute('data-block'), n.getAttribute('data-arg'), report, ctr)); return; }
      if (t === 'H3' || t === 'H4') { items.push({ type: t === 'H3' ? 'h3' : 'h4', text: n.textContent.trim() }); return; }
      if (t === 'UL' || t === 'OL') {
        items.push({ type: 'list', ordered: t === 'OL', items: Array.prototype.filter.call(n.children, function (li) { return li.tagName === 'LI'; }).map(function (li) { return runsOf(li, {}, []); }) });
        return;
      }
      if (t === 'TABLE') { const tr = tableRows(n); items.push({ type: 'table', head: tr.head, body: tr.body, user: true }); return; }
      if (t === 'BLOCKQUOTE') { items.push({ type: 'p', runs: runsOf(n, { italic: true }, []), indent: true }); return; }
      const runs = runsOf(n, { ph: n.classList && n.classList.contains('ph') }, []);
      if (runs.some(function (r) { return r.text.trim(); })) items.push({ type: 'p', runs: runs, note: n.classList && n.classList.contains('rp-note') });
    });
    return items;
  }

  function docModel(report) {
    const ctr = { tab: 0, fig: 0 };
    let n = 0;
    return R.includedSections(report).filter(function (s) { return s.key !== 'title'; }).map(function (s) {
      n++;
      return { key: s.key, num: n, title: s.title, aiDraft: s.aiDraft, items: sectionItems(s, report, ctr) };
    });
  }

  function hasTitle(report) { return !!(report.sections.title && report.sections.title.included); }

  /* =========================================================
   * PDF
   * ========================================================= */
  const NAVY = [15, 27, 61], BLUE = [36, 86, 214], INK = [27, 35, 53], GREY = [107, 116, 137], LINE = [221, 226, 234], AMBER = [122, 74, 0];

  /** jsPDF's standard fonts are WinAnsi: map characters outside it to safe equivalents. */
  function safe(t) {
    return String(t == null ? '' : t)
      .replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/[✓✔]/g, '').replace(/[✗✘]/g, '').replace(/÷/g, '/').replace(/×/g, 'x')
      .replace(/−/g, '-').replace(/→/g, '->').replace(/∞/g, 'inf').replace(/[​-‍﻿]/g, '')
      .replace(/[^\x00-\xFF–—‘’“”•…€]/g, '');
  }

  function imageSize(url) {
    return new Promise(function (res) { const i = new Image(); i.onload = function () { res({ w: i.naturalWidth, h: i.naturalHeight }); }; i.onerror = function () { res({ w: 4, h: 3 }); }; i.src = url; });
  }

  async function buildPdf(report) {
    await loadScript('js/vendor/jspdf.umd.min.js');
    await loadScript('js/vendor/jspdf.plugin.autotable.min.js');
    const jsPDF = window.jspdf.jsPDF;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: false });
    const W = 210, H = 297, ML = 20, MR = 20, MT = 24, MB = 22, CW = W - ML - MR;
    const stats = { tables: 0, images: 0, headings: 0 };
    let y = MT;
    const pt = function (size) { return size * 0.3528; };

    function newPage() { doc.addPage(); y = MT; }
    function ensure(h) { if (y + h > H - MB) newPage(); }
    function setFont(style, size, color) { doc.setFont('helvetica', style || 'normal'); doc.setFontSize(size); doc.setTextColor.apply(doc, color || INK); }

    function heading(text, level) {
      stats.headings++;
      const size = level === 1 ? 15 : level === 2 ? 12 : 10.5;
      ensure(pt(size) * 2 + (level === 1 ? 6 : 3));
      y += level === 1 ? 0 : 3;
      setFont('bold', size, NAVY);
      const lines = doc.splitTextToSize(safe(text), CW);
      lines.forEach(function (l) { doc.text(l, ML, y + pt(size) * 0.85); y += pt(size) * 1.3; });
      if (level === 1) { doc.setDrawColor.apply(doc, NAVY); doc.setLineWidth(0.6); doc.line(ML, y + 0.5, ML + CW, y + 0.5); y += 5; } else y += 1;
    }

    function smallText(text, size, color, style) {
      setFont(style || 'normal', size, color);
      doc.splitTextToSize(safe(text), CW).forEach(function (l) { ensure(pt(size) * 1.4); doc.text(l, ML, y + pt(size) * 0.85); y += pt(size) * 1.4; });
    }

    function table(it) {
      stats.tables++;
      const head = it.head ? [it.head.map(safe)] : undefined;
      const body = it.body.map(function (r) { return r.map(safe); });
      const colStyles = {};
      (it.center || []).forEach(function (i) { colStyles[i] = { halign: 'center' }; });
      if (it.widths) { const tot = it.widths.reduce(function (a, b) { return a + b; }, 0); it.widths.forEach(function (w, i) { colStyles[i] = Object.assign(colStyles[i] || {}, { cellWidth: CW * w / tot }); }); }
      ensure(18);
      doc.autoTable({
        startY: y, head: head, body: body, margin: { left: ML, right: MR, top: MT, bottom: MB },
        tableWidth: it.narrow ? CW * 0.6 : 'auto',
        styles: { font: 'helvetica', fontSize: it.small ? 7.2 : 8.4, cellPadding: 1.6, textColor: INK, lineColor: LINE, lineWidth: 0.15, valign: 'top', overflow: 'linebreak' },
        headStyles: { fillColor: it.user ? [238, 242, 249] : NAVY, textColor: it.user ? NAVY : 255, fontStyle: 'bold', valign: 'bottom', fontSize: it.small ? 6.8 : 7.6 },
        alternateRowStyles: { fillColor: [246, 248, 251] },
        columnStyles: colStyles,
        didParseCell: function (data) {
          if (it.totalRow && data.section === 'body' && data.row.index === body.length - 1) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [238, 242, 249]; }
          if (data.section === 'body' && (data.cell.raw === 'Achieved' || data.cell.raw === 'Not achieved')) { data.cell.styles.textColor = data.cell.raw === 'Achieved' ? [18, 112, 58] : [176, 40, 40]; data.cell.styles.fontStyle = 'bold'; }
        }
      });
      y = doc.lastAutoTable.finalY + 2;
    }

    async function image(url) {
      stats.images++;
      const sz = await imageSize(url);
      let w = CW, h = CW * sz.h / sz.w;
      const maxH = 150;
      if (h > maxH) { h = maxH; w = h * sz.w / sz.h; }
      ensure(h + 4);
      doc.addImage(url, 'PNG', ML + (CW - w) / 2, y, w, h, undefined, 'FAST');
      y += h + 2;
    }

    function kpis(pairs) {
      const cols = 3, gap = 3, bw = (CW - gap * (cols - 1)) / cols, bh = 13;
      ensure(Math.ceil(pairs.length / cols) * (bh + gap));
      pairs.forEach(function (p, i) {
        const cx = ML + (i % cols) * (bw + gap), cy = y + Math.floor(i / cols) * (bh + gap);
        doc.setFillColor(248, 249, 252); doc.setDrawColor.apply(doc, LINE); doc.setLineWidth(0.2);
        doc.roundedRect(cx, cy, bw, bh, 1.5, 1.5, 'FD');
        setFont('normal', 7.5, GREY); doc.text(safe(p[0]), cx + 3, cy + 4.6);
        setFont('bold', 11, NAVY); doc.text(safe(p[1]), cx + 3, cy + 10.2);
      });
      y += Math.ceil(pairs.length / cols) * (bh + gap);
    }

    function list(it) {
      it.items.forEach(function (runs, i) {
        const marker = it.ordered ? (i + 1) + '.' : '•';
        ensure(6);
        setFont('normal', 10.5, INK);
        doc.text(marker, ML + 1, y + pt(10.5) * 0.8);
        rich(runs, ML + 7, CW - 7, 10.5);
        y += 0.8;
      });
      y += 1.5;
    }

    /** Word-wrapped rich text with bold/italic runs. */
    function rich(runs, x, width, size, color) {
      const lh = pt(size) * 1.5;
      const segs = [];
      runs.forEach(function (r) {
        if (r.text === '\n') { segs.push({ br: true }); return; }
        safe(r.text).split(/(\s+)/).forEach(function (w) { if (w) segs.push({ w: w, style: r.bold && r.italic ? 'bolditalic' : r.bold ? 'bold' : r.italic ? 'italic' : 'normal', ph: r.ph }); });
      });
      let line = [], lw = 0;
      function flush() {
        while (line.length && /^\s+$/.test(line[line.length - 1].w)) { lw -= line.pop().width; }
        if (!line.length) { y += lh * 0.4; return; }
        ensure(lh);
        let cx = x;
        line.forEach(function (sg) { setFont(sg.style, size, sg.ph ? AMBER : (color || INK)); doc.text(sg.w, cx, y + pt(size) * 0.82); cx += sg.width; });
        y += lh; line = []; lw = 0;
      }
      segs.forEach(function (sg) {
        if (sg.br) { flush(); return; }
        const space = /^\s+$/.test(sg.w);
        if (space && !line.length) return;
        setFont(sg.style, size);
        const sw = doc.getTextWidth(space ? ' ' : sg.w);
        if (!space && lw + sw > width && line.length) flush();
        if (space && !line.length) return;
        line.push({ w: space ? ' ' : sg.w, style: sg.style, width: sw, ph: sg.ph });
        lw += sw;
      });
      if (line.length) flush();
    }

    /* ---- Title page ---- */
    const m = report.meta;
    if (hasTitle(report)) {
      doc.setFillColor.apply(doc, NAVY); doc.rect(0, 0, W, 8, 'F');
      doc.setFillColor.apply(doc, BLUE); doc.rect(ML, 48, 18, 1.4, 'F');
      setFont('bold', 9, BLUE); doc.text(safe((m.institution || '').toUpperCase()), ML + 22, 49.4);
      setFont('normal', 11, GREY); doc.text(safe(E.TYPES[report.reportType] || 'Audit Report'), ML, 78);
      setFont('bold', 25, NAVY);
      y = 88;
      doc.splitTextToSize(safe(report.title), CW).forEach(function (l) { doc.text(l, ML, y); y += 10.5; });
      if (m.auditTitle && m.auditTitle !== report.title) { setFont('normal', 13, [61, 70, 96]); doc.splitTextToSize(safe(m.auditTitle), CW).forEach(function (l) { y += 1; doc.text(l, ML, y); y += 6; }); }
      y = Math.max(y + 14, 150);
      doc.setDrawColor.apply(doc, NAVY); doc.setLineWidth(1); doc.line(ML, y, ML + CW, y); y += 9;
      const meta = [['Department', m.department], ['Specialty', m.specialty], ['Audit lead', m.auditLead], ['Collaborators', (m.collaborators || []).join(', ')], ['Audit cycle', m.cycleLabel],
        ['Reporting period', m.periodFrom ? U.fmtDate(m.periodFrom) + ' – ' + U.fmtDate(m.periodTo) : ''], ['Report date', U.fmtDate(m.reportDate)], ['Status', (DA.views.reports.STATUS[report.status] || {}).label + ' · revision ' + report.revision]];
      meta.forEach(function (p, i) {
        const cx = ML + (i % 2) * (CW / 2), cy = y + Math.floor(i / 2) * 15;
        setFont('normal', 7.5, GREY); doc.text(safe(p[0].toUpperCase()), cx, cy);
        setFont('bold', 10.5, NAVY); doc.text(doc.splitTextToSize(safe(p[1] || '—'), CW / 2 - 6).slice(0, 2), cx, cy + 5);
      });
      y += Math.ceil(meta.length / 2) * 15 + 6;
      if (report.status === 'approved') { setFont('bold', 10.5, [18, 112, 58]); doc.text(safe('Approved by ' + (report.review.approvedBy || m.auditLead) + ' on ' + U.fmtDate(report.review.approvalDate || report.approvedAt)), ML, y); y += 7; }
      if (R.hasAiDraft(report)) { setFont('bold', 9.5, AMBER); doc.text('Contains AI-assisted text awaiting review by the audit lead', ML, y); }
      setFont('normal', 8, GREY);
      doc.text(safe('Figures from the DentalAudit analytics snapshot of ' + U.fmtDate(report.snapshotAt, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })), ML, H - 18);
    }

    /* ---- Contents placeholder ---- */
    const model = docModel(report);
    if (hasTitle(report)) newPage();
    const tocPage = doc.internal.getNumberOfPages();
    const tocEntries = [];

    /* ---- Sections ---- */
    for (let si = 0; si < model.length; si++) {
      const sec = model[si];
      newPage();
      tocEntries.push({ text: sec.num + '. ' + sec.title, page: doc.internal.getNumberOfPages() });
      heading(sec.num + '. ' + sec.title, 1);
      if (sec.aiDraft) smallText('AI-assisted draft — not yet reviewed by the audit lead', 9, AMBER, 'bold');
      for (let i = 0; i < sec.items.length; i++) {
        const it = sec.items[i];
        if (it.type === 'p') { rich(it.runs, ML + (it.indent ? 6 : 0), CW - (it.indent ? 6 : 0), it.note ? 9.5 : 10.5, it.note ? GREY : INK); y += 1.6; }
        else if (it.type === 'h3') heading(it.text, 2);
        else if (it.type === 'h4') heading(it.text, 3);
        else if (it.type === 'list') list(it);
        else if (it.type === 'table') { table(it); }
        else if (it.type === 'image') await image(it.url);
        else if (it.type === 'kpis') kpis(it.pairs);
        else if (it.type === 'caption') { ensure(10); smallText(it.text, 9, NAVY, 'bold'); y += 0.5; }
        else if (it.type === 'source') { smallText(it.text, 7.5, GREY); y += 1.5; }
        else if (it.type === 'note') { smallText(it.text, 9.5, GREY, 'italic'); y += 1.5; }
      }
    }

    /* ---- Contents page (filled after page numbers are known) ---- */
    doc.setPage(tocPage);
    y = MT;
    heading('Contents', 1);
    tocEntries.forEach(function (t) {
      setFont('normal', 11, INK);
      const label = safe(t.text);
      doc.text(label, ML, y + 4);
      const pn = String(t.page);
      doc.text(pn, ML + CW, y + 4, { align: 'right' });
      const start = ML + doc.getTextWidth(label) + 2, end = ML + CW - doc.getTextWidth(pn) - 2;
      doc.setTextColor.apply(doc, [180, 186, 199]);
      let dots = '';
      while (doc.getTextWidth(dots + '.') < end - start) dots += '.';
      doc.text(dots, start, y + 4);
      doc.link(ML, y, CW, 6, { pageNumber: t.page });
      y += 8;
    });

    /* ---- Running headers and footers ---- */
    const total = doc.internal.getNumberOfPages();
    const first = hasTitle(report) ? 2 : 1;
    for (let p = first; p <= total; p++) {
      doc.setPage(p);
      setFont('normal', 7.5, GREY);
      const head = doc.splitTextToSize(safe(report.title), CW - 50)[0];
      doc.text(head, ML, 13);
      doc.text(safe((DA.views.reports.STATUS[report.status] || {}).label + ' · revision ' + report.revision), W - MR, 13, { align: 'right' });
      doc.setDrawColor.apply(doc, LINE); doc.setLineWidth(0.2); doc.line(ML, 15.5, W - MR, 15.5);
      doc.line(ML, H - 14, W - MR, H - 14);
      doc.text(safe([m.institution, m.department].filter(Boolean).join(' · ')), ML, H - 9.5);
      doc.text('Page ' + p + ' of ' + total, W - MR, H - 9.5, { align: 'right' });
    }
    doc.setProperties({ title: safe(report.title), subject: safe(E.TYPES[report.reportType]), creator: 'DentalAudit', author: safe(report.review.author || '') });
    stats.pages = total;
    return { doc: doc, stats: stats };
  }

  /* =========================================================
   * Word (.docx)
   * ========================================================= */
  function dataUrlBytes(url) {
    const b64 = url.split(',')[1];
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function buildDocx(report) {
    await loadScript('js/vendor/docx.iife.min.js');
    const D = window.docx;
    const m = report.meta;
    const children = [];
    const stats = { tables: 0, images: 0, headings: 0 };
    let listInstance = 0;
    const txt = function (text, o) { return new D.TextRun(Object.assign({ text: String(text == null ? '' : text) }, o || {})); };
    const para = function (runs, o) { return new D.Paragraph(Object.assign({ children: runs }, o || {})); };
    const runsToDocx = function (runs, base) {
      return runs.map(function (r) { return r.text === '\n' ? new D.TextRun({ break: 1 }) : txt(r.text, Object.assign({ bold: !!r.bold, italics: !!r.italic, color: r.ph ? '9A6B00' : undefined }, base || {})); });
    };
    const cellBorder = { top: { style: D.BorderStyle.SINGLE, size: 2, color: 'DDE2EA' }, bottom: { style: D.BorderStyle.SINGLE, size: 2, color: 'DDE2EA' }, left: { style: D.BorderStyle.SINGLE, size: 2, color: 'DDE2EA' }, right: { style: D.BorderStyle.SINGLE, size: 2, color: 'DDE2EA' } };

    function table(it) {
      stats.tables++;
      const cols = (it.head || it.body[0] || []).length;
      const center = it.center || [];
      const mk = function (cells, isHead, isTotal) {
        return new D.TableRow({ tableHeader: isHead, cantSplit: true, children: cells.map(function (c, i) {
          return new D.TableCell({
            shading: isHead ? { fill: it.user ? 'EEF2F9' : '0F1B3D', type: D.ShadingType.CLEAR, color: 'auto' } : isTotal ? { fill: 'EEF2F9', type: D.ShadingType.CLEAR, color: 'auto' } : undefined,
            borders: cellBorder, margins: { top: 60, bottom: 60, left: 80, right: 80 },
            children: [para([txt(c, { bold: isHead || isTotal || c === 'Achieved' || c === 'Not achieved', color: isHead ? (it.user ? '0F1B3D' : 'FFFFFF') : c === 'Achieved' ? '12703A' : c === 'Not achieved' ? 'B02828' : undefined, size: it.small ? 15 : 17 })], { alignment: center.indexOf(i) !== -1 ? D.AlignmentType.CENTER : D.AlignmentType.LEFT })]
          });
        }) });
      };
      const rows = [];
      if (it.head) rows.push(mk(it.head, true));
      it.body.forEach(function (r, i) { rows.push(mk(r.concat(Array(Math.max(0, cols - r.length)).fill('')), false, it.totalRow && i === it.body.length - 1)); });
      children.push(new D.Table({ rows: rows, width: { size: it.narrow ? 60 : 100, type: D.WidthType.PERCENTAGE } }));
      children.push(para([txt('')], { spacing: { after: 60 } }));
    }

    async function image(url) {
      stats.images++;
      const sz = await imageSize(url);
      const w = 600, h = Math.round(w * sz.h / sz.w);
      children.push(para([new D.ImageRun({ data: dataUrlBytes(url), transformation: { width: w, height: Math.min(h, 820) } })], { alignment: D.AlignmentType.CENTER, spacing: { before: 120, after: 60 } }));
    }

    /* Title page */
    if (hasTitle(report)) {
      children.push(para([txt((m.institution || '').toUpperCase(), { bold: true, color: '2456D6', size: 18 })], { spacing: { before: 1600 } }));
      children.push(para([txt(E.TYPES[report.reportType] || 'Audit Report', { color: '5B6478', size: 24 })], { spacing: { before: 1200, after: 120 } }));
      children.push(para([txt(report.title, { bold: true, color: '0F1B3D', size: 52 })], { heading: D.HeadingLevel.TITLE, spacing: { after: 200 } }));
      if (m.auditTitle && m.auditTitle !== report.title) children.push(para([txt(m.auditTitle, { color: '3D4660', size: 26 })]));
      const meta = [['Department', m.department], ['Specialty', m.specialty], ['Audit lead', m.auditLead], ['Collaborators', (m.collaborators || []).join(', ')], ['Audit cycle', m.cycleLabel],
        ['Reporting period', m.periodFrom ? U.fmtDate(m.periodFrom) + ' – ' + U.fmtDate(m.periodTo) : ''], ['Report date', U.fmtDate(m.reportDate)], ['Status', (DA.views.reports.STATUS[report.status] || {}).label + ' · revision ' + report.revision]];
      children.push(para([txt('')], { spacing: { before: 600 }, border: { bottom: { style: D.BorderStyle.SINGLE, size: 18, color: '0F1B3D', space: 4 } } }));
      meta.forEach(function (p) { children.push(para([txt(p[0] + ':  ', { color: '6B7489', size: 18 }), txt(p[1] || '—', { bold: true, color: '0F1B3D', size: 21 })], { spacing: { after: 80 } })); });
      if (report.status === 'approved') children.push(para([txt('Approved by ' + (report.review.approvedBy || m.auditLead) + ' on ' + U.fmtDate(report.review.approvalDate || report.approvedAt), { bold: true, color: '12703A' })], { spacing: { before: 300 } }));
      if (R.hasAiDraft(report)) children.push(para([txt('Contains AI-assisted text awaiting review by the audit lead', { bold: true, color: '7A4A00' })], { spacing: { before: 200 } }));
      children.push(para([new D.PageBreak()]));
      children.push(para([txt('Contents', { bold: true, color: '0F1B3D', size: 32 })], { spacing: { after: 200 } }));
      children.push(new D.TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-1' }));
      children.push(para([txt('If the contents list is empty, right-click it in Word and choose Update Field.', { italics: true, color: '6B7489', size: 16 })]));
    }

    /* Sections */
    const model = docModel(report);
    for (let si = 0; si < model.length; si++) {
      const sec = model[si];
      stats.headings++;
      children.push(para([txt(sec.num + '. ' + sec.title)], { heading: D.HeadingLevel.HEADING_1, pageBreakBefore: true }));
      if (sec.aiDraft) children.push(para([txt('AI-assisted draft — not yet reviewed by the audit lead', { bold: true, color: '7A4A00', size: 18 })]));
      for (let i = 0; i < sec.items.length; i++) {
        const it = sec.items[i];
        if (it.type === 'p') children.push(para(runsToDocx(it.runs, it.note ? { color: '5B6478', italics: true, size: 19 } : null), { indent: it.indent ? { left: 400 } : undefined, spacing: { after: 140, line: 300 } }));
        else if (it.type === 'h3') { stats.headings++; children.push(para([txt(it.text)], { heading: D.HeadingLevel.HEADING_2 })); }
        else if (it.type === 'h4') { stats.headings++; children.push(para([txt(it.text)], { heading: D.HeadingLevel.HEADING_3 })); }
        else if (it.type === 'list') {
          const inst = ++listInstance;
          it.items.forEach(function (runs) {
            children.push(para(runsToDocx(runs), it.ordered ? { numbering: { reference: 'num-list', level: 0, instance: inst }, spacing: { after: 80 } } : { bullet: { level: 0 }, spacing: { after: 80 } }));
          });
        }
        else if (it.type === 'table') table(it);
        else if (it.type === 'image') await image(it.url);
        else if (it.type === 'kpis') table({ head: ['Measure', 'Value'], body: it.pairs, narrow: true, center: [1] });
        else if (it.type === 'caption') children.push(para([txt(it.text, { bold: true, color: '0F1B3D', size: 18 })], { keepNext: true, spacing: { before: 200, after: 60 } }));
        else if (it.type === 'source') children.push(para([txt(it.text, { color: '6B7489', size: 15 })], { spacing: { after: 160 } }));
        else if (it.type === 'note') children.push(para([txt(it.text, { italics: true, color: '7A8399', size: 19 })]));
      }
    }

    const headerPara = function () { return para([txt(report.title, { color: '6B7489', size: 15 }), new D.TextRun({ text: '\t' + (DA.views.reports.STATUS[report.status] || {}).label + ' · revision ' + report.revision, color: '6B7489', size: 15 })], { tabStops: [{ type: D.TabStopType.RIGHT, position: 9000 }], border: { bottom: { style: D.BorderStyle.SINGLE, size: 4, color: 'DDE2EA', space: 4 } } }); };
    const footerPara = function () { return para([txt([m.institution, m.department].filter(Boolean).join(' · '), { color: '6B7489', size: 15 }), new D.TextRun({ children: ['\tPage ', D.PageNumber.CURRENT, ' of ', D.PageNumber.TOTAL_PAGES], color: '6B7489', size: 15 })], { tabStops: [{ type: D.TabStopType.RIGHT, position: 9000 }] }); };

    const document_ = new D.Document({
      creator: 'DentalAudit', title: report.title, description: E.TYPES[report.reportType],
      features: { updateFields: true },
      styles: {
        default: {
          document: { run: { font: 'Calibri', size: 21, color: '1B2335' }, paragraph: { spacing: { line: 288 } } },
          heading1: { run: { font: 'Calibri', size: 32, bold: true, color: '0F1B3D' }, paragraph: { spacing: { after: 200 }, border: { bottom: { style: D.BorderStyle.SINGLE, size: 12, color: '0F1B3D', space: 4 } } } },
          heading2: { run: { font: 'Calibri', size: 26, bold: true, color: '0F1B3D' }, paragraph: { spacing: { before: 240, after: 100 } } },
          heading3: { run: { font: 'Calibri', size: 22, bold: true, color: '24305A' }, paragraph: { spacing: { before: 200, after: 80 } } }
        }
      },
      numbering: { config: [{ reference: 'num-list', levels: [{ level: 0, format: D.LevelFormat.DECIMAL, text: '%1.', alignment: D.AlignmentType.START, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] }] },
      sections: [{
        properties: { titlePage: hasTitle(report), page: { margin: { top: 1300, bottom: 1200, left: 1134, right: 1134 } } },
        headers: { default: new D.Header({ children: [headerPara()] }), first: new D.Header({ children: [para([txt('')])] }) },
        footers: { default: new D.Footer({ children: [footerPara()] }), first: new D.Footer({ children: [para([txt('')])] }) },
        children: children
      }]
    });
    const blob = await D.Packer.toBlob(document_);
    return { blob: blob, stats: stats };
  }

  /* =========================================================
   * Entry point
   * ========================================================= */
  function fileName(report, ext) { return U.slug(report.title) + '-rev' + report.revision + '.' + ext; }

  async function run(kind, report) {
    try {
      if (kind === 'html') {
        U.download(fileName(report, 'html'), R.standaloneHtml(report), 'text/html');
        ui.toast('HTML report downloaded', 'success');
      } else if (kind === 'print') {
        const target = '#/reports/' + report.id + '/preview';
        if (location.hash.split('?')[0] !== target) { location.hash = target; setTimeout(function () { window.print(); }, 700); }
        else window.print();
      } else if (kind === 'pdf') {
        ui.toast('Building PDF…', 'info');
        const res = await buildPdf(report);
        res.doc.save(fileName(report, 'pdf'));
        ui.toast('PDF downloaded · ' + res.stats.pages + ' pages', 'success');
      } else if (kind === 'docx') {
        ui.toast('Building Word document…', 'info');
        const res = await buildDocx(report);
        const url = URL.createObjectURL(res.blob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName(report, 'docx');
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        ui.toast('Word document downloaded', 'success');
      }
    } catch (e) {
      console.error(e);
      ui.toast('Export failed: ' + e.message, 'error');
    }
  }

  return { run: run, buildPdf: buildPdf, buildDocx: buildDocx, docModel: docModel, loadScript: loadScript };
})();
