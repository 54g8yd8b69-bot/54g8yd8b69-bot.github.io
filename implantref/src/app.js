/*
 * ImplantRef 3.0 — application UI.
 * Depends on: window.IMPLANTREF_DATA (catalogue), window.IMPLANTREF_EVIDENCE (curated registry),
 * window.ImplantRefCore (src/core.js). No build step, no network calls, no third-party code.
 */
(() => {
  "use strict";
  const APP_VERSION = "3.8.0";
  const ROOT = document.querySelector(".app");
  if (!ROOT || ROOT.dataset.ready) return;
  ROOT.dataset.ready = "1";

  const C = window.ImplantRefCore;
  const DATA = window.IMPLANTREF_DATA;
  const CURATED = window.IMPLANTREF_EVIDENCE || { documents: [], claims: [] };
  if (!C) throw new Error("src/core.js failed to load.");
  if (!DATA || !Array.isArray(DATA.records)) throw new Error("Catalogue data failed to load. Run the project from its root folder.");

  /* ================================================================ helpers */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtN = (n) => Number(n).toLocaleString("en-GB");

  const records = DATA.records;
  const summary = DATA.summary;
  const byId = new Map(records.map((r) => [r.recordId, r]));
  const findRecord = (id) => byId.get(id);
  const searchText = new Map(
    records.map((r) => [
      r.recordId,
      C.normalize([r.articleNumber, r.component, r.manufacturer, r.implantSystem, r.platform, r.productFamily, r.material, r.cataloguePages, JSON.stringify(r.dimensions)].join(" ")),
    ]),
  );
  /* FDA-listing supplement: manufacturer-registered REFs that are not in the workbook. Identity only, kept apart from
     `records` so the 3,961 workbook rows, filters, evidence and the implant finder are unaffected. */
  const SUP = window.IMPLANTREF_SUPPLEMENT || { items: [], count: 0 };
  const supItems = SUP.items || [];
  const supById = new Map(supItems.map((x) => [x.recordId, x]));
  const supText = new Map(supItems.map((x) => [x.recordId, C.normalize([x.articleNumber, x.description, (x.otherDescriptions || []).join(" "), x.brand, x.category, (x.gmdn || []).join(" "), x.manufacturer].join(" "))]));
  const supByRef = (man, ref) => supItems.find((x) => (!man || x.manufacturer === man) && C.normalizeRef(x.articleNumber) === C.normalizeRef(ref));
  function supMatches() {
    const q = String(ui.query || "").trim();
    if (q.length < 3 || ui.system || ui.platform || ui.family || ui.material || ui.ctype || ui.evidenceFilter) return [];
    const nq = C.normalize(q), rq = C.normalizeRef(q);
    const out = supItems.filter((x) => (!ui.manufacturer || x.manufacturer === ui.manufacturer) && (C.normalizeRef(x.articleNumber) === rq || supText.get(x.recordId).includes(nq)));
    return out.sort((a, b) => (C.normalizeRef(b.articleNumber) === rq) - (C.normalizeRef(a.articleNumber) === rq) || a.articleNumber.localeCompare(b.articleNumber));
  }
  const supDistribution = (x) => (x.inCommercialDistribution ? "" : `<span class="pill neutral">Not in US commercial distribution${x.distributionEnd ? " since " + esc(x.distributionEnd) : ""}</span>`);
  function supRowsHtml(list) {
    return `<div class="cards sup-cards">${list
      .map((x) => `<div class="rcard data-row sup-row" tabindex="0" data-record="${esc(x.recordId)}"><div class="rcard-top"><span class="ref">${esc(x.articleNumber)}</span><span class="pill xc">FDA listing · not in workbook</span></div><b>${esc(x.description)}</b><div class="secondary">${esc(x.manufacturer)} · ${esc(x.category)}${x.brand ? " · " + esc(x.brand) : ""}</div>${supDistribution(x)}</div>`)
      .join("")}</div>`;
  }
  const firstByRef = new Map();
  for (const r of records) {
    const k = r.manufacturer + "|" + C.normalizeRef(r.articleNumber);
    if (!firstByRef.has(k)) firstByRef.set(k, r);
  }
  const typesOf = new Map(records.map((r) => [r.recordId, C.componentTypes(r)]));
  const unique = (key, rows = records) => [...new Set(rows.map((r) => r[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));

  const TITLES = {
    dashboard: "Dashboard",
    identify: "Identify & find parts",
    catalogue: "Component catalogue",
    systems: "Implant systems",
    compare: "Compare components",
    evidence: "Evidence & IFU registry",
    saved: "Saved components",
    casebox: "Case component lists",
    data: "Data management",
  };

  /* ================================================================== state */
  const user = C.emptyUserState(); // persisted
  const ui = {
    view: "dashboard",
    query: "",
    manufacturer: "",
    system: "",
    family: "",
    platform: "",
    material: "",
    ctype: "",
    evidenceFilter: "",
    sort: "article",
    page: 1,
    pageSize: 50,
    selected: null,
    openCaseId: null,
    wiz: { manufacturer: "", system: "", platform: "", intent: "", confirmedOnly: false, showAllPlatforms: true },
    evView: "attention",
    sheetMode: "record",
  };
  let storageNotice = "";

  function evidence() {
    return C.mergeEvidence(CURATED, user.evidence);
  }
  const evOpts = () => ({ staleDays: user.settings.staleDays });

  function persist() {
    try {
      localStorage.setItem(C.STORAGE_KEY_V3, JSON.stringify(user));
      return true;
    } catch (e) {
      toast("Could not save to browser storage — export a backup");
      return false;
    }
  }
  function restore() {
    let raw = null;
    let fromV2 = false;
    try {
      raw = JSON.parse(localStorage.getItem(C.STORAGE_KEY_V3) || "null");
      if (!raw) {
        const v2 = localStorage.getItem(C.STORAGE_KEY_V2);
        if (v2) {
          raw = JSON.parse(v2);
          fromV2 = true;
        }
      }
    } catch (e) {
      storageNotice = "Stored personal data could not be read; it has been left untouched in browser storage.";
      return;
    }
    if (!raw) return;
    Object.assign(user, C.migrateUserState(raw));
    if (fromV2) {
      // Write v3 alongside; the v2 key is deliberately left in place as a rollback copy.
      if (persist()) storageNotice = "Personal data was migrated from ImplantRef 2.0. The original 2.0 copy is retained in this browser.";
    }
  }

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.add("hidden"), 2600);
  }

  /* ============================================================ components */
  const pageHead = (title, desc, actions = "") =>
    `<div class="page-head"><div><h1>${title}</h1><div class="sub">${desc}</div></div>${actions}</div>`;
  const selectField = (label, id, options, value = "", placeholder = "All") =>
    `<div class="field"><label for="${id}">${label}</label><select id="${id}"><option value="">${placeholder}</option>${options
      .map((x) => `<option value="${esc(x)}" ${x === value ? "selected" : ""}>${esc(x)}</option>`)
      .join("")}</select></div>`;
  const statusChip = (res) => `<span class="pill ${res.tone}" title="Evidence status">${esc(res.label)}</span>`;
  const typeLabel = (id) => C.TYPE_BY_ID[id]?.label || id;
  const dimsSummary = (r) => {
    const d = r.dimensions || {};
    return [d.diameterMm && "Ø " + d.diameterMm, d.gingivaHeightMm && "GH " + d.gingivaHeightMm, d.abutmentHeightMm && "AH " + d.abutmentHeightMm, d.heightMm && "H " + d.heightMm, d.lengthMm && "L " + d.lengthMm, d.angulation]
      .filter(Boolean)
      .join(" · ");
  };
  function dimensionRows(r) {
    const d = r.dimensions || {};
    return [
      ["Diameter", d.diameterMm, "mm"],
      ["Length", d.lengthMm, "mm"],
      ["Gingiva height", d.gingivaHeightMm, "mm"],
      ["Abutment height", d.abutmentHeightMm, "mm"],
      ["Height", d.heightMm, "mm"],
      ["Angulation", d.angulation, ""],
    ]
      .filter((x) => x[1] !== null && x[1] !== undefined && x[1] !== "")
      .map((x) => [x[0], x[1] + (x[2] ? " " + x[2] : "")]);
  }
  const sameRefContexts = (r) => records.filter((x) => x.manufacturer === r.manufacturer && C.normalizeRef(x.articleNumber) === C.normalizeRef(r.articleNumber));

  function recordTable(rows, { extraCol = null, showSaved = true, compat = null } = {}) {
    if (!rows.length) return '<div class="empty">No matching records. Try removing one or more filters.</div>';
    const saved = new Set(user.saved);
    const compatCell = (r) => (compat ? statusChip(C.resolveCompatibility(r, compat.ev, compat.want, evOpts())) : "");
    const table = `<div class="table-wrap desktop-only"><table><thead><tr><th>Article no.</th><th>Component</th><th>Manufacturer</th><th>System</th><th>Platform</th><th>Product family</th>${compat ? "<th>Evidence</th>" : "<th>Pack</th>"}<th></th></tr></thead><tbody>${rows
      .map(
        (r) =>
          `<tr class="data-row" tabindex="0" data-record="${r.recordId}"><td class="ref">${esc(r.articleNumber)}</td><td><b>${esc(r.component)}</b><div class="secondary">${esc(r.material || "Material not specified")}</div></td><td>${esc(r.manufacturer)}</td><td>${esc(r.implantSystem)}</td><td>${esc(r.platform)}</td><td>${esc(r.productFamily)}</td><td>${compat ? compatCell(r) : r.packSize ?? "—"}</td><td>${
            extraCol ? extraCol(r) : showSaved && saved.has(r.recordId) ? '<span class="pill ok">Saved</span>' : '<span class="pill">View</span>'
          }</td></tr>`,
      )
      .join("")}</tbody></table></div>`;
    const cards = `<div class="cards mobile-only">${rows
      .map(
        (r) =>
          `<div class="rcard data-row" tabindex="0" data-record="${r.recordId}"><div class="rcard-top"><span class="ref">${esc(r.articleNumber)}</span>${saved.has(r.recordId) && showSaved ? '<span class="pill ok">★</span>' : ""}${compat ? compatCell(r) : ""}</div><b>${esc(r.component)}</b><div class="secondary">${esc(r.manufacturer)} · ${esc(r.implantSystem)} · ${esc(r.platform)}</div><div class="secondary">${esc(r.productFamily)}${dimsSummary(r) ? " · " + esc(dimsSummary(r)) : ""}</div>${extraCol ? `<div class="rcard-actions">${extraCol(r)}</div>` : ""}</div>`,
      )
      .join("")}</div>`;
    return table + cards;
  }

  /* ================================================================ routing
   * Hash format: #/view or #/view/r/<recordId>. Browser Back closes the record sheet. */
  function navigate(view, recordId = null, { replace = false } = {}) {
    const h = "#/" + view + (recordId ? "/r/" + encodeURIComponent(recordId) : "");
    if (location.hash === h) return route();
    if (replace) {
      history.replaceState(null, "", h);
      route();
    } else location.hash = h;
  }
  function parseHash() {
    const m = location.hash.match(/^#\/([a-z]+)(?:\/r\/([^/]+))?/);
    const view = m && TITLES[m[1]] ? m[1] : "dashboard";
    return { view, recordId: m && m[2] ? decodeURIComponent(m[2]) : null };
  }
  function route() {
    const { view, recordId } = parseHash();
    if (view !== ui.view || !$("#screen").innerHTML) {
      ui.view = view;
      ui.page = 1;
      $$("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
      $("#moreTab").classList.toggle("active", ["systems", "compare", "evidence", "casebox", "data"].includes(view));
      $("#crumb").textContent = "ImplantRef / " + TITLES[view];
      document.title = TITLES[view] + " – ImplantRef";
      render();
      $("#screen").scrollTop = 0;
      window.scrollTo(0, 0);
    }
    if (recordId && findRecord(recordId)) openSheet(recordId);
    else if (recordId && supById.has(recordId)) openSupSheet(recordId);
    else closeSheet(false);
  }
  const setView = (v) => navigate(v);
  const openRecord = (id) => navigate(ui.view, id);

  function render() {
    closeMore();
    ({ dashboard: dash, identify, catalogue, systems, compare, evidenceView, saved, casebox, data: dataPage }[ui.view === "evidence" ? "evidenceView" : ui.view] || dash)();
  }

  /* ============================================================== dashboard */
  function dash() {
    const ev = evidence();
    const effectiveRefs = new Set();
    for (const c of ev.claims) {
      const st = C.claimStanding(c, Object.fromEntries(ev.documents.map((d) => [d.documentId, d])), evOpts());
      if (st.effective) effectiveRefs.add(c.subject.manufacturer + "|" + C.normalizeRef(c.subject.articleNumber));
    }
    const uniqueRefs = new Set(records.map((r) => r.manufacturer + "|" + C.normalizeRef(r.articleNumber))).size;
    const recent = user.recent.map(findRecord).filter(Boolean).slice(0, 6);
    $("#screen").innerHTML =
      pageHead("ImplantRef", "A mobile-first restorative component reference for Straumann and Nobel Biocare, with evidence-linked compatibility and torque documentation.") +
      (storageNotice ? `<div class="notice ok-notice">${esc(storageNotice)}</div>` : "") +
      `<div class="notice"><b>Data provenance:</b> catalogue records were imported from your workbook and have not been checked against current manufacturer IFUs. A shared system or platform label is a reference trail, <b>not</b> proof of compatibility. Compatibility and torque are shown only from reviewed, product-specific manufacturer sources; otherwise they read <b>Not established</b>.</div>
<div class="dash-grid"><div class="panel"><h2>Quick REF lookup</h2><div class="sub">Type or paste the REF from the packaging label. Dots and spaces are ignored.</div><form class="search-hero" id="dashForm"><input id="dashQuery" inputmode="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="e.g. 046.415, 36543, Variobase…" aria-label="REF or component search"><button class="btn primary">Search</button></form><div class="quick-actions mt"><button class="btn primary" data-scan-start="lookup">⌖ Scan a label with the camera</button></div><div class="footnote">An exact REF shows every catalogue context in which it appears. Scanning reads the label barcode (UDI) or the printed REF on your device.</div></div>
<div class="panel"><h2>Identify &amp; find parts</h2><div class="sub">Manufacturer → system → connection/platform → restorative intent.</div><div class="quick-actions"><button class="btn primary" data-view="identify">◎ Start the guided finder</button><button class="btn" data-view="catalogue">⌕ Browse the full catalogue</button><button class="btn" data-view="casebox">＋ Create a case component list</button></div></div></div>
<div class="stats"><div class="stat"><div class="stat-label">CATALOGUE-CONTEXT RECORDS</div><div class="stat-value">${fmtN(records.length)}</div><div class="stat-note">No rows deduplicated</div></div><div class="stat"><div class="stat-label">IMPLANT SYSTEMS</div><div class="stat-value">${Object.keys(summary.implantSystems).length}</div><div class="stat-note">Straumann and Nobel Biocare</div></div><div class="stat"><div class="stat-label">REFS WITH VERIFIED EVIDENCE</div><div class="stat-value">${fmtN(effectiveRefs.size)}</div><div class="stat-note">of ${fmtN(uniqueRefs)} unique REFs</div></div><div class="stat"><div class="stat-label">EVIDENCE CLAIMS</div><div class="stat-value">${fmtN(ev.claims.length)}</div><div class="stat-note"><a href="#/evidence">Open registry →</a></div></div></div>
${recent.length ? `<div class="panel"><div class="panel-head"><h2>Recently viewed</h2></div>${recent.map((r) => `<div class="list-row data-row" tabindex="0" data-record="${r.recordId}"><div><b class="ref">${esc(r.articleNumber)}</b> · ${esc(r.component)}<div class="secondary">${esc(r.manufacturer)} · ${esc(r.implantSystem)} · ${esc(r.platform)}</div></div><span class="pill">View</span></div>`).join("")}</div>` : ""}
<div class="dash-grid"><div class="panel"><div class="panel-head"><h2>Records by manufacturer</h2><span class="secondary">Imported rows</span></div>${Object.entries(summary.manufacturers)
        .map(([m, n]) => `<div class="list-row"><div><b>${esc(m)}</b><div class="secondary">${fmtN(n)} catalogue-context records</div></div><b>${Math.round((n / records.length) * 100)}%</b></div><div class="barline"><span style="width:${(n / records.length) * 100}%"></span></div>`)
        .join("")}</div><div class="panel"><h2>Repeated article numbers</h2><p class="sub">A REF may appear in several system, platform or family contexts. These are never collapsed.</p><div class="list-row"><span>Straumann</span><b>${summary.articleNumberContext.Straumann.articleNumbersRepeatedAcrossContexts}</b></div><div class="list-row"><span>Nobel Biocare</span><b>${summary.articleNumberContext["Nobel Biocare"].articleNumbersRepeatedAcrossContexts}</b></div></div></div>
<div class="panel"><div class="panel-head"><h2>Most represented product families</h2><span class="secondary">Top categories by manufacturer</span></div><div class="system-grid">${Object.entries(summary.productFamilyCountsByManufacturer)
        .map(([m, fams]) => `<div><h3>${esc(m)}</h3>${Object.entries(fams).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, c]) => `<div class="list-row"><span>${esc(n)}</span><b>${c}</b></div>`).join("")}</div>`)
        .join("")}</div></div>`;
    $("#dashForm").onsubmit = (e) => {
      e.preventDefault();
      Object.assign(ui, { query: $("#dashQuery").value, manufacturer: "", system: "", family: "", platform: "", material: "", ctype: "", evidenceFilter: "" });
      setView("catalogue");
    };
  }

  /* ============================================================ label scan */
  const viaLabel = { gtin: "barcode (UDI)", gs1: "barcode (UDI)", hibc: "HIBC barcode", ocr: "printed REF", "barcode-text": "barcode", text: "barcode" };
  function scanBannerHtml() {
    const s = ui.scanInfo;
    if (!s || C.normalizeRef(s.ref) !== C.normalizeRef(ui.query)) return "";
    if (s.unknown) {
      const portal = C.ifuPortalUrl(s.manufacturer, s.ref);
      return `<div class="warning scan-note"><b>Scanned label:</b> REF <b>${esc(s.ref)}</b> read from the printed REF (looks like a ${esc(s.manufacturer)} REF) — <b>this REF isn't in the ImplantRef catalogue</b>, so there is nothing to show for it yet. Check it against the label.${portal ? ` <a href="${esc(portal)}" target="_blank" rel="noopener">Find its IFU on the ${esc(s.manufacturer)} eIFU portal</a>.` : ""} <button class="btn small" data-copy="${esc(s.ref)}">Copy REF</button> <button class="linkish" data-scan-start="lookup">Scan another</button></div>`;
    }
    return `<div class="notice exact scan-note"><b>Scanned label:</b> REF ${esc(s.ref)} (${esc(s.manufacturer)}) read from the ${esc(viaLabel[s.via] || s.via)}${s.lot ? ` · LOT <b>${esc(s.lot)}</b> <button class="btn small" data-copy="${esc(s.lot)}">Copy LOT</button>` : ""}${s.expiry ? ` · Use by ${esc(s.expiry)}` : ""}. ${s.via === "ocr" ? "Check the REF matches the label." : ""} <button class="linkish" data-scan-start="lookup">Scan another</button></div>`;
  }
  function startScan(mode) {
    if (!window.ImplantRefScan) return toast("Scanner unavailable");
    window.ImplantRefScan.open({ onResult: (res) => handleScan(res, mode) });
  }
  function handleScan(res, mode) {
    const cands = res.candidates || [];
    if (!cands.length && res.unknownRef) {
      const u = res.unknownRef;
      ui.scanInfo = { ref: u.ref, manufacturer: u.manufacturer, via: "ocr", unknown: true };
      Object.assign(ui, { query: u.ref, manufacturer: "", system: "", family: "", platform: "", material: "", ctype: "", evidenceFilter: "", page: 1 });
      toast(`REF ${u.ref} read — not in the catalogue`);
      return ui.view === "catalogue" ? catalogue() : setView("catalogue");
    }
    if (!cands.length) {
      return toast(res.info && res.info.gtin ? `GTIN ${res.info.gtin} isn't in ImplantRef — type the REF instead` : "No catalogue REF found on that label");
    }
    if (cands.length > 1) return chooseCandidate(cands, res, mode);
    applyScan(cands[0], res, mode);
  }
  function chooseCandidate(cands, res, mode) {
    const box = document.createElement("div");
    box.className = "modal";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.innerHTML = `<div class="modal-inner"><h2>Which REF is on the label?</h2><p class="sub">The ${esc(viaLabel[res.via] || res.via)} matched more than one catalogue REF.</p>${cands
      .map((c, i) => `<button class="option mt" data-pick="${i}"><b class="ref">${esc(c.articleNumber)}</b><span class="secondary">${esc(c.manufacturer)} · ${esc((records.find((r) => r.manufacturer === c.manufacturer && C.normalizeRef(r.articleNumber) === C.normalizeRef(c.articleNumber)) || {}).component || (supByRef(c.manufacturer, c.articleNumber) || {}).description || "")}</span></button>`)
      .join("")}<div class="detail-actions"><button class="btn" data-pick="cancel">Cancel</button></div></div>`;
    document.body.appendChild(box);
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pick]");
      if (!b) return;
      box.remove();
      if (b.dataset.pick !== "cancel") applyScan(cands[+b.dataset.pick], res, mode);
    });
  }
  function applyScan(c, res, mode) {
    const info = res.info || {};
    ui.scanInfo = { ref: c.articleNumber, manufacturer: c.manufacturer, via: c.via || res.via, lot: info.lot || null, expiry: info.expiry || null, gtin: info.gtin || null };
    const rows = records.filter((r) => r.manufacturer === c.manufacturer && C.normalizeRef(r.articleNumber) === C.normalizeRef(c.articleNumber));
    const supHit = !rows.length && supByRef(c.manufacturer, c.articleNumber);
    if (supHit) {
      Object.assign(ui, { query: c.articleNumber, manufacturer: "", system: "", family: "", platform: "", material: "", ctype: "", evidenceFilter: "", page: 1 });
      toast(`REF ${c.articleNumber} — not in your workbook; FDA listing found`);
      return navigate("catalogue", supHit.recordId);
    }
    if (mode === "wizard") {
      const implants = rows.filter((r) => typesOf.get(r.recordId)[0] === "implant");
      if (implants.length === 1) {
        Object.assign(ui.wiz, { manufacturer: implants[0].manufacturer, system: implants[0].implantSystem, platform: implants[0].platform, intent: "" });
        toast("Implant " + c.articleNumber + " — choose what you need");
        return ui.view === "identify" ? identify() : setView("identify");
      }
      if (implants.length > 1) {
        ui.view === "identify" ? identify() : setView("identify");
        setTimeout(() => {
          const inp = $("#implantRef");
          if (inp) {
            inp.value = c.articleNumber;
            $("#implantRefForm").requestSubmit();
          }
        }, 0);
        return;
      }
    }
    Object.assign(ui, { query: c.articleNumber, manufacturer: "", system: "", family: "", platform: "", material: "", ctype: "", evidenceFilter: "", page: 1 });
    toast(`REF ${c.articleNumber} — ${rows.length} catalogue context${rows.length === 1 ? "" : "s"}`);
    if (rows.length === 1) return navigate("catalogue", rows[0].recordId);
    if (ui.view === "catalogue") catalogue();
    else setView("catalogue");
  }

  /* ============================================================== catalogue */
  function applyFilters() {
    const q = C.normalize(ui.query);
    const ev = ui.evidenceFilter ? evidence() : null;
    const arr = records.filter(
      (r) =>
        (!ui.manufacturer || r.manufacturer === ui.manufacturer) &&
        (!ui.system || r.implantSystem === ui.system) &&
        (!ui.family || r.productFamily === ui.family) &&
        (!ui.platform || r.platform === ui.platform) &&
        (!ui.material || r.material === ui.material) &&
        (!ui.ctype || typesOf.get(r.recordId).includes(ui.ctype)) &&
        (!q || searchText.get(r.recordId).includes(q)) &&
        (!ev || evidenceFilterMatch(r, ev)),
    );
    const exactQ = C.normalizeRef(ui.query);
    const isExact = (r) => (exactQ && C.normalizeRef(r.articleNumber) === exactQ ? 0 : 1);
    arr.sort((a, b) => {
      const ex = isExact(a) - isExact(b);
      if (ex) return ex;
      if (ui.sort === "name") return a.component.localeCompare(b.component);
      if (ui.sort === "manufacturer") return a.manufacturer.localeCompare(b.manufacturer) || a.implantSystem.localeCompare(b.implantSystem);
      if (ui.sort === "family") return a.productFamily.localeCompare(b.productFamily) || a.component.localeCompare(b.component);
      return a.articleNumber.localeCompare(b.articleNumber) || a.manufacturer.localeCompare(b.manufacturer);
    });
    return arr;
  }
  function evidenceFilterMatch(r, ev) {
    const comp = C.resolveCompatibility(r, ev, null, evOpts()).status;
    const torque = C.resolveTorque(r, ev, evOpts());
    if (ui.evidenceFilter === "any") return comp !== "not-established" || torque.all.length > 0;
    if (ui.evidenceFilter === "torque") return torque.verified.length > 0;
    if (ui.evidenceFilter === "torque-any") return torque.verified.length > 0 || torque.notEffective.some((g) => g.standing === "unverified");
    return comp === ui.evidenceFilter;
  }
  const activeFilterCount = () => ["manufacturer", "system", "family", "platform", "material", "ctype", "evidenceFilter"].filter((k) => ui[k]).length;

  function catalogue() {
    // Dependent options: systems/platforms narrow to the chosen manufacturer/system.
    const scope = records.filter((r) => (!ui.manufacturer || r.manufacturer === ui.manufacturer) && (!ui.system || r.implantSystem === ui.system));
    const nFilters = activeFilterCount();
    $("#screen").innerHTML =
      pageHead(
        "Component catalogue",
        `Search ${fmtN(records.length)} catalogue-context records. Each row keeps its manufacturer, system, platform and family context.`,
        `<button class="btn" id="resetFilters">Reset</button>`,
      ) +
      `<div class="search-sticky"><div class="field"><label for="q" class="sr-only">Search catalogue</label><input id="q" type="search" inputmode="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="REF, component name, family, material…" value="${esc(ui.query)}"></div><button class="btn" data-scan-start="lookup" aria-label="Scan a label">⌖</button><button class="btn filter-toggle" id="filterToggle" aria-expanded="false" aria-controls="filters">Filters${nFilters ? ` (${nFilters})` : ""}</button></div>
<div class="chips" role="group" aria-label="Component type"><button class="chip ${!ui.ctype ? "on" : ""}" data-ctype="">All types</button>${C.COMPONENT_TYPES.filter((t) => t.id !== "other")
        .map((t) => `<button class="chip ${ui.ctype === t.id ? "on" : ""}" data-ctype="${t.id}">${esc(t.label)}</button>`)
        .join("")}</div>
<div class="filters collapsed" id="filters">${selectField("Manufacturer", "manufacturer", unique("manufacturer"), ui.manufacturer)}${selectField("Implant system", "system", unique("implantSystem", ui.manufacturer ? records.filter((r) => r.manufacturer === ui.manufacturer) : records), ui.system)}${selectField("Platform", "platform", unique("platform", scope), ui.platform)}${selectField("Product family", "family", unique("productFamily", scope), ui.family)}${selectField("Material", "material", unique("material", scope), ui.material)}<div class="field"><label for="evidenceFilter">Evidence</label><select id="evidenceFilter"><option value="">Any (incl. not established)</option><option value="any">Has any evidence record</option><option value="manufacturer-confirmed">Compatibility: manufacturer-confirmed</option><option value="contraindicated">Compatibility: contraindicated</option><option value="pending">Compatibility: pending verification</option><option value="torque">Verified torque recorded</option><option value="torque-any">Torque sourced (verified or awaiting review)</option></select></div></div>
<div id="scanBanner">${scanBannerHtml()}</div><div id="exactBanner"></div>
<div class="filter-actions"><span class="result-count" id="resultCount" aria-live="polite"></span><label class="secondary">Sort <select id="sort" class="inline-select"><option value="article">Article number</option><option value="name">Component name</option><option value="manufacturer">Manufacturer/system</option><option value="family">Product family</option></select></label><label class="secondary desktop-inline">Rows <select id="pageSize" class="inline-select"><option>25</option><option>50</option><option>100</option><option>200</option></select></label></div>
<div id="tableBox"></div><div id="pagination" class="pagination"></div><div id="supBox"></div>
<div class="footnote">Records are imported from your workbook and not independently IFU-verified. Component-type chips are a browsing aid derived from the family label, not a clinical classification.</div>`;
    $("#evidenceFilter").value = ui.evidenceFilter;
    let debounce;
    $("#q").addEventListener("input", (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        ui.query = e.target.value;
        ui.page = 1;
        drawTable();
      }, 120);
    });
    for (const id of ["manufacturer", "system", "family", "platform", "material", "evidenceFilter"])
      $("#" + id).addEventListener("change", (e) => {
        ui[id] = e.target.value;
        if (id === "manufacturer") Object.assign(ui, { system: "", platform: "", family: "" });
        if (id === "system") Object.assign(ui, { platform: "" });
        ui.page = 1;
        const open = !$("#filters").classList.contains("collapsed");
        catalogue();
        if (open) toggleFilters(true);
      });
    $("#filterToggle").onclick = () => toggleFilters();
    $$("[data-ctype]").forEach((b) =>
      b.addEventListener("click", () => {
        ui.ctype = b.dataset.ctype;
        ui.page = 1;
        $$("[data-ctype]").forEach((x) => x.classList.toggle("on", x === b));
        drawTable();
      }),
    );
    $("#sort").value = ui.sort;
    $("#sort").onchange = (e) => {
      ui.sort = e.target.value;
      drawTable();
    };
    $("#pageSize").value = String(ui.pageSize);
    $("#pageSize").onchange = (e) => {
      ui.pageSize = Number(e.target.value);
      ui.page = 1;
      drawTable();
    };
    $("#resetFilters").onclick = () => {
      Object.assign(ui, { query: "", manufacturer: "", system: "", family: "", platform: "", material: "", ctype: "", evidenceFilter: "", page: 1 });
      catalogue();
    };
    drawTable();
  }
  function toggleFilters(force) {
    const f = $("#filters");
    const open = force ?? f.classList.contains("collapsed");
    f.classList.toggle("collapsed", !open);
    $("#filterToggle").setAttribute("aria-expanded", String(open));
  }
  function drawTable() {
    const arr = applyFilters();
    const pages = Math.max(1, Math.ceil(arr.length / ui.pageSize));
    ui.page = Math.min(ui.page, pages);
    const start = (ui.page - 1) * ui.pageSize;
    const view = arr.slice(start, start + ui.pageSize);
    const exact = C.exactRefMatches(records, ui.query);
    $("#exactBanner").innerHTML = exact.length
      ? `<div class="notice exact"><b>Exact REF ${esc(exact[0].articleNumber)}:</b> ${exact.length} catalogue context row${exact.length > 1 ? "s" : ""}${
          new Set(exact.map((r) => r.manufacturer)).size > 1 ? " across manufacturers" : ""
        } — listed first. ${exact.length > 1 ? "Confirm the exact system and platform; repeated contexts are not proof of interchangeability." : ""}</div>`
      : "";
    const sup = supMatches();
    if (!exact.length && sup.length && C.normalizeRef(sup[0].articleNumber) === C.normalizeRef(ui.query))
      $("#exactBanner").innerHTML = `<div class="notice exact"><b>REF ${esc(sup[0].articleNumber)} isn't in your workbook catalogue.</b> It is in ${esc(sup[0].manufacturer)}'s FDA device listing — shown below (identity only: no torque or compatibility evidence).</div>`;
    $("#supBox").innerHTML = sup.length
      ? `<div class="section sup-section"><h3>Not in your workbook — ${esc(fmtN(sup.length))} FDA-listed part${sup.length === 1 ? "" : "s"}</h3><div class="sub">From the manufacturers' own FDA (GUDID) device records. Identity only: no catalogue context, torque or compatibility evidence.</div>${supRowsHtml(sup.slice(0, 30))}${sup.length > 30 ? `<div class="secondary">${fmtN(sup.length - 30)} more — refine the search.</div>` : ""}</div>`
      : "";
    $("#resultCount").textContent = `${fmtN(arr.length)} matching · showing ${arr.length ? start + 1 : 0}–${Math.min(start + ui.pageSize, arr.length)}`;
    $("#tableBox").innerHTML = recordTable(view);
    $("#pagination").innerHTML = `<span class="secondary">Page ${ui.page} of ${pages}</span><div class="page-buttons"><button class="btn small" id="prev" ${ui.page <= 1 ? "disabled" : ""}>← Previous</button><button class="btn small" id="next" ${ui.page >= pages ? "disabled" : ""}>Next →</button></div>`;
    $("#prev").onclick = () => {
      ui.page--;
      drawTable();
      $("#tableBox").scrollIntoView({ block: "start" });
    };
    $("#next").onclick = () => {
      ui.page++;
      drawTable();
      $("#tableBox").scrollIntoView({ block: "start" });
    };
  }

  /* =========================================================== record sheet */
  let lastFocus = null;
  function openSheet(id, mode = "record") {
    const r = findRecord(id);
    if (!r) return;
    if ($("#sheet").classList.contains("hidden")) lastFocus = document.activeElement;
    ui.selected = id;
    ui.sheetMode = mode;
    if (mode === "record") {
      user.recent = [id, ...user.recent.filter((x) => x !== id)].slice(0, 10);
      persist();
    }
    $("#sheetBody").innerHTML = mode === "evidence-form" ? evidenceFormHtml(r) : recordSheetHtml(r);
    $("#sheet").classList.remove("hidden");
    $("#sheetBackdrop").classList.remove("hidden");
    document.body.classList.add("sheet-open");
    $("#sheetBody").scrollTop = 0;
    (mode === "record" ? $("#sheetClose") : $("#efType"))?.focus({ preventScroll: true });
    if (mode === "record") bindRecordSheet(r);
    else bindEvidenceForm(r);
  }
  function openSupSheet(id) {
    const x = supById.get(id);
    if (!x) return;
    if ($("#sheet").classList.contains("hidden")) lastFocus = document.activeElement;
    ui.selected = id;
    ui.sheetMode = "supplement";
    const portal = C.ifuPortalUrl(x.manufacturer, x.articleNumber);
    const scanned = ui.scanInfo && C.normalizeRef(ui.scanInfo.ref) === C.normalizeRef(x.articleNumber) && ui.scanInfo.manufacturer === x.manufacturer;
    $("#sheetBody").innerHTML = `<div class="sheet-head"><div><div class="secondary">${esc(x.manufacturer)} · ${esc(x.category)}</div><h2 id="sheetTitle">${esc(x.description)}</h2><div class="ref big">REF ${esc(x.articleNumber)}</div><div class="chip-row"><span class="pill xc">FDA listing · not in your workbook</span>${supDistribution(x)}</div></div><button class="icon-btn" id="sheetClose" aria-label="Close">✕</button></div>
<div class="warning">This part is <b>not in your workbook catalogue</b>. What is shown is ${esc(x.manufacturer)}'s own registration of REF ${esc(x.articleNumber)} in the FDA device database (GUDID): an identity record only. ImplantRef has <b>no catalogue context, torque or compatibility evidence</b> for it — use the manufacturer's IFU.</div>
${scanned ? `<div class="notice exact scan-note"><b>From the scanned label</b>${ui.scanInfo.lot ? ` · LOT <b>${esc(ui.scanInfo.lot)}</b> <button class="btn small" data-copy="${esc(ui.scanInfo.lot)}">Copy LOT</button>` : ""}. Check the REF matches the label.</div>` : ""}
<div class="detail-grid"><div class="kv"><small>MANUFACTURER</small><b>${esc(x.manufacturer)}</b></div><div class="kv"><small>FDA DEVICE DESCRIPTION</small><b>${esc(x.description)}</b></div>${x.brand ? `<div class="kv"><small>BRAND NAME (FDA)</small><b>${esc(x.brand)}</b></div>` : ""}<div class="kv"><small>CATEGORY (FROM GMDN)</small><b>${esc(x.category)}</b></div>${(x.gmdn || []).length ? `<div class="kv"><small>GMDN TERM</small><b>${esc(x.gmdn.join("; "))}</b></div>` : ""}<div class="kv"><small>US DISTRIBUTION</small><b>${x.inCommercialDistribution ? "In commercial distribution" : "Not in commercial distribution" + (x.distributionEnd ? " (since " + esc(x.distributionEnd) + ")" : "")}</b></div></div>
${(x.otherDescriptions || []).length ? `<div class="muted-box"><b>Other FDA records for this REF</b><br>${x.otherDescriptions.map(esc).join("<br>")}</div>` : ""}
<div class="detail-actions">${portal ? `<a class="btn primary" href="${esc(portal)}" target="_blank" rel="noopener">Find IFU on the ${esc(x.manufacturer)} eIFU portal</a>` : ""}<button class="btn" data-copy="${esc(x.articleNumber)}">Copy REF</button></div>
<div class="footnote">Source: ${esc(SUP.source || "FDA GUDID")} · snapshot ${esc(SUP.builtAt || "")}. GUDID lists devices registered for US distribution; it does not establish UK availability, compatibility or torque.</div>`;
    $("#sheet").classList.remove("hidden");
    $("#sheetBackdrop").classList.remove("hidden");
    document.body.classList.add("sheet-open");
    $("#sheetBody").scrollTop = 0;
    $("#sheetClose").addEventListener("click", () => closeSheet());
    $("#sheetClose").focus({ preventScroll: true });
  }
  function closeSheet(updateHash = true) {
    if ($("#sheet").classList.contains("hidden")) return;
    $("#sheet").classList.add("hidden");
    $("#sheetBackdrop").classList.add("hidden");
    document.body.classList.remove("sheet-open");
    ui.selected = null;
    if (updateHash && parseHash().recordId) history.back();
    // Refresh the underlying view so saved/compare badges are current.
    if (["catalogue"].includes(ui.view) && $("#tableBox")) drawTable();
    else if (["saved", "compare", "identify", "casebox", "dashboard", "evidence"].includes(ui.view)) render();
    lastFocus?.focus?.({ preventScroll: true });
  }

  function claimSourceHtml(g) {
    const s = g.source;
    return `<div class="src">${s.sourceUrl ? `<a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(s.documentTitle || s.sourceUrl)}</a>` : esc(s.documentTitle || "No document")} · ${esc(s.revisionOrDate || "no revision")} · ${esc(g.claim.pageOrSection || "no page/section")}<br><span class="secondary">${esc(s.sourceType || "unknown type")} · ${esc(s.territory || "territory not stated")} · retrieved ${esc(s.retrievedAt || "?")}${g.claim.reviewedBy ? ` · reviewed by ${esc(g.claim.reviewedBy)} ${esc(g.claim.reviewedAt || "")}` : ""} · ${g.claim.origin === "curated" ? (g.claim.reviewOrigin === "local" ? "curated registry, reviewed on this device" : g.claim.reviewSource ? "curated registry, review shipped with the app" : "curated registry") : "your local entry"}</span>${
      g.claim.staleLocalReview ? `<br><span class="secondary"><b>Your earlier review no longer applies:</b> the value, page or document revision changed after you reviewed it. Please review it again.</span>` : ""
    }</div>`;
  }
  const standingLabel = {
    effective: ["Verified & current", "ok"],
    stale: ["Stale — re-verify", "flag"],
    unverified: ["Pending verification", "flag"],
    incomplete: ["Incomplete provenance", "danger"],
    "non-authoritative": ["Non-authoritative source", "flag"],
    superseded: ["Superseded", "neutral"],
    contradicted: ["Contradicted", "danger"],
  };
  /** Automated cross-check label. Never a verification: only a named clinician verifies. */
  const crossCheckHtml = (c) => {
    const x = c.crossCheck;
    if (!x || c.verificationStatus === "verified") return "";
    if (x.status === "agreed")
      return `<div class="xcheck ok"><span class="pill xc">Cross-checked against IFU · automated</span> <span class="secondary">An independent re-reading of ${esc(x.independentPage || "the cited page")} found the same instruction (${esc(x.checkedAt)}). <b>Not clinician-verified</b>: confirm against the IFU before use.${x.note ? `<br><b>Note:</b> ${esc(x.note)}` : ""}</span></div>`;
    return `<div class="warning xcheck"><b>Automated cross-check disagreed.</b> ${esc(x.note || "An independent re-reading of the document did not find this instruction as stated.")} Do not use this value until it is checked against the IFU.</div>`;
  };
  const xcRank = (c) => (c.crossCheck?.status === "disagreed" ? 0 : c.crossCheck?.status === "agreed" ? 1 : 2);
  const standingChip = (g) => {
    const [l, t] = standingLabel[g.standing] || [g.standing, "neutral"];
    return `<span class="pill ${t}" title="${esc(g.reasons.join("; "))}">${l}</span>`;
  };
  function claimActions(g) {
    const id = esc(g.claim.claimId);
    if (g.claim.origin === "curated") {
      const reviewed = !!user.evidence.reviews?.[g.claim.claimId];
      const v = g.claim.verificationStatus;
      return `<div class="claim-actions">${v !== "verified" ? `<button class="btn small" data-claim-act="verify" data-claim="${id}">Review &amp; verify…</button>` : ""}${v !== "contradicted" ? `<button class="btn small" data-claim-act="contradicted" data-claim="${id}">Doesn't match IFU</button>` : ""}${reviewed ? `<button class="btn small" data-claim-act="clear" data-claim="${id}">Clear my review</button>` : ""}<span class="secondary">Shipped claim${g.claim.curationRuleId ? " · rule " + esc(g.claim.curationRuleId) : ""}</span></div>`;
    }
    const v = g.claim.verificationStatus;
    return `<div class="claim-actions">${v !== "verified" ? `<button class="btn small" data-claim-act="verify" data-claim="${id}">Mark verified…</button>` : `<button class="btn small" data-claim-act="pending" data-claim="${id}">Revert to pending</button>`}<button class="btn small" data-claim-act="contradicted" data-claim="${id}">Contradicted</button><button class="btn small" data-claim-act="superseded" data-claim="${id}">Superseded</button><button class="btn small danger" data-claim-act="delete" data-claim="${id}">Delete</button></div>`;
  }
  const torqueHtml = (c) =>
    c.handTight === true
      ? `Hand-tight${c.maxNcm ? ` <small>max ${esc(c.maxNcm)} Ncm</small>` : ""}`
      : c.minNcm !== undefined && c.minNcm !== null
        ? `${esc(c.minNcm)}–${esc(c.maxNcm)} <small>Ncm</small>`
        : `${esc(c.valueNcm)} <small>Ncm</small>`;
  const bindingNote = (c) => {
    if (!c.curationRuleId) return "";
    const ref = esc(c.subject.articleNumber);
    const printed = c.refPrintedInDocument ? `REF ${ref} is printed in the cited document (${esc(c.refPrintedInDocument)}). ` : "";
    const b = c.bindingCheck;
    if (b?.status === "confirmed")
      return `<div class="secondary binding ok">${printed}<b>REF identity checked:</b> ${esc(c.subject.manufacturer)}'s own FDA device listing describes REF ${ref} as “${esc(b.description)}”, which matches the product and connection of the cited statement.</div>`;
    if (printed) return `<div class="secondary">${printed}</div>`;
    return `<div class="secondary">The source states this by product type and platform; ImplantRef matched it to REF ${ref} by catalogue name${c.refPrintedInDocument === false ? " (REF not printed in the cited document)" : ""}${b?.status === "unlisted" ? "; this REF is not in the manufacturer's FDA device listing, so its identity could not be checked independently" : ""}. Confirm the product is covered.</div>`;
  };
  function targetText(c) {
    const t = c.target || {};
    if (t.articleNumber) return `with REF ${esc(t.articleNumber)}${t.manufacturer ? " (" + esc(t.manufacturer) + ")" : ""}`;
    return `with ${esc(t.implantSystem || "?")}${t.platform ? " · " + esc(t.platform) : " (all platforms of system)"}`;
  }

  function recordSheetHtml(r) {
    const ev = evidence();
    const comp = C.resolveCompatibility(r, ev, null, evOpts());
    const ctxComp = C.resolveCompatibility(r, ev, { implantSystem: r.implantSystem, platform: r.platform }, evOpts());
    const torque = C.resolveTorque(r, ev, evOpts());
    const awaiting = torque.notEffective.filter((g) => g.standing === "unverified" && g.claim.verificationStatus === "pending").sort((a, b) => xcRank(a.claim) - xcRank(b.claim));
    const xcAgreed = awaiting.length > 0 && awaiting.every((g) => g.claim.crossCheck?.status === "agreed") && !awaiting.some((g) => g.claim.conflictGroup);
    const otherPending = torque.notEffective.filter((g) => !awaiting.includes(g));
    const disagree = C.pendingDisagreements(torque);
    const contexts = sameRefContexts(r);
    const note = user.notes[r.recordId] || "";
    const portal = C.ifuPortalUrl(r.manufacturer, r.articleNumber);
    const types = typesOf.get(r.recordId);
    return `<div class="sheet-head"><div><div class="secondary">${esc(r.manufacturer)} · ${esc(r.implantSystem)} · ${esc(r.productFamily)}</div><h2 id="sheetTitle">${esc(r.component)}</h2><div class="ref big">REF ${esc(r.articleNumber)}</div><div class="chip-row">${types.map((t) => `<span class="pill">${esc(typeLabel(t))}</span>`).join("")}<span class="pill flag">Catalogue row · not IFU-verified</span></div></div><button class="icon-btn" id="sheetClose" aria-label="Close">✕</button></div>
<div class="detail-grid"><div class="kv"><small>MANUFACTURER</small><b>${esc(r.manufacturer)}</b></div><div class="kv"><small>IMPLANT SYSTEM</small><b>${esc(r.implantSystem)}</b></div><div class="kv"><small>PLATFORM / CONTEXT</small><b>${esc(r.platform)}</b></div><div class="kv"><small>PRODUCT FAMILY</small><b>${esc(r.productFamily)}</b></div><div class="kv"><small>MATERIAL</small><b>${esc(r.material || "Not specified in workbook")}</b></div><div class="kv"><small>PACK SIZE</small><b>${r.packSize ?? "Not specified"}</b></div>${dimensionRows(r)
      .map(([k, v]) => `<div class="kv"><small>${esc(k.toUpperCase())}</small><b>${esc(v)}</b></div>`)
      .join("")}</div>
${ui.scanInfo && C.normalizeRef(ui.scanInfo.ref) === C.normalizeRef(r.articleNumber) && ui.scanInfo.manufacturer === r.manufacturer ? `<div class="notice exact scan-note"><b>From the scanned label</b>${ui.scanInfo.lot ? ` · LOT <b>${esc(ui.scanInfo.lot)}</b> <button class="btn small" data-copy="${esc(ui.scanInfo.lot)}">Copy LOT</button>` : ""}${ui.scanInfo.expiry ? ` · Use by ${esc(ui.scanInfo.expiry)}` : ""}${ui.scanInfo.gtin ? ` · GTIN ${esc(ui.scanInfo.gtin)}` : ""}</div>` : ""}
<div class="muted-box"><b>Catalogue page reference</b><br>${esc(r.cataloguePages || "No page reference supplied")}</div>
${
  contexts.length > 1
    ? `<div class="section"><h3>Same REF in ${contexts.length} catalogue contexts</h3><div class="sub">Separate workbook rows. Listing under several systems is a catalogue association, not documented interchangeability.</div><div class="context-list">${contexts
        .map((x) => `<button class="context-item ${x.recordId === r.recordId ? "current" : ""}" data-goto-record="${x.recordId}" ${x.recordId === r.recordId ? 'aria-current="true"' : ""}><b>${esc(x.implantSystem)}</b><br>${esc(x.platform)}<br><span class="secondary">${esc(x.productFamily)}</span></button>`)
        .join("")}</div></div>`
    : ""
}
<div class="section evidence-block"><div class="panel-head"><h3>Compatibility evidence</h3>${statusChip(comp)}</div>
<div class="sub">For this catalogue context (${esc(r.implantSystem)} · ${esc(r.platform)}): ${statusChip(ctxComp)}</div>
${
  comp.claims.length
    ? comp.claims.slice().sort((a, b) => xcRank(a.claim) - xcRank(b.claim)).map((g) => `<div class="claim"><div class="claim-head"><b>${g.claim.assertion === "contraindicated" ? "Contraindicated" : "Compatible"} ${targetText(g.claim)}</b>${standingChip(g)}</div>${g.claim.caution ? `<div class="warning"><b>Manufacturer restriction:</b> ${esc(g.claim.caution)}</div>` : ""}${crossCheckHtml(g.claim)}${claimSourceHtml(g)}${g.claim.excerpt ? `<div class="excerpt">“${esc(g.claim.excerpt)}”</div>` : ""}${bindingNote(g.claim)}${claimActions(g)}</div>`).join("")
    : `<div class="empty small"><b>Not established.</b> No product-specific manufacturer source is linked to REF ${esc(r.articleNumber)}. The catalogue platform label is not evidence of compatibility.</div>`
}
</div>
<div class="section evidence-block"><div class="panel-head"><h3>Torque documentation</h3>${torque.verified.length ? '<span class="pill ok">Verified value recorded</span>' : awaiting.length ? (xcAgreed ? '<span class="pill xc">Cross-checked · awaiting clinician review</span>' : '<span class="pill flag">Sourced · awaiting review</span>') : '<span class="pill neutral">No verified value</span>'}</div>
${
  torque.verified.length
    ? `<div class="torque-list">${torque.verified
        .map((g) => `<div class="claim torque"><div class="claim-head"><div><div class="torque-val">${torqueHtml(g.claim)}</div><b>${esc(g.claim.application)}</b>${g.claim.instrument ? `<div class="secondary">Instrument: ${esc(g.claim.instrument)}</div>` : ""}</div>${standingChip(g)}</div>${claimSourceHtml(g)}${claimActions(g)}</div>`)
        .join("")}</div>`
    : awaiting.length
      ? ""
      : `<div class="empty small">ImplantRef does not infer torque from platform labels or similar components. Use the current IFU for this exact REF.</div>`
}
${
  awaiting.length
    ? `<div class="awaiting">${disagree.length ? `<div class="warning"><b>Sources disagree</b> for: ${disagree.map(esc).join("; ")}. Check the IFU for this exact REF; verify only the instruction that matches it and mark the other “Doesn't match IFU”.</div>` : ""}<div class="awaiting-head"><b>Sourced from the manufacturer IFU — awaiting clinician review</b><span class="secondary">Not yet confirmed by a clinician. Values marked “cross-checked” were found again by an independent automated re-reading of the document; it catches extraction errors but is not a clinical check. Open the cited page before relying on any value here.</span></div>${awaiting
        .map((g) => `<div class="claim torque pending-val"><div class="claim-head"><div><div class="torque-val">${torqueHtml(g.claim)}</div><b>${esc(g.claim.application)}</b>${g.claim.instrument ? `<div class="secondary">Instrument: ${esc(g.claim.instrument)}</div>` : ""}</div>${standingChip(g)}</div>${crossCheckHtml(g.claim)}${claimSourceHtml(g)}${bindingNote(g.claim)}${g.claim.conflictGroup ? '<div class="secondary"><b>Part of a declared conflict:</b> the same source gives a different instruction elsewhere.</div>' : ""}${g.claim.origin === "local" ? '<div class="secondary">Your own entry.</div>' : ""}${claimActions(g)}</div>`)
        .join("")}</div>`
    : ""
}
${torque.conflicts.length ? `<div class="warning"><b>Conflicting verified values</b> for: ${torque.conflicts.map(esc).join(", ")}. No value is shown until the conflict is resolved.</div>${torque.conflicting.map((g) => `<div class="claim muted">${torqueHtml(g.claim)} — ${esc(g.claim.application)}${claimSourceHtml(g)}${claimActions(g)}</div>`).join("")}` : ""}
${otherPending.length ? `<details class="pending-claims"><summary>${otherPending.length} other torque record(s) not in effect — not for clinical use</summary>${otherPending.map((g) => `<div class="claim muted"><div class="claim-head"><span><s>${esc(C.torqueText(g.claim))}</s> — ${esc(g.claim.application)}</span>${standingChip(g)}</div>${claimSourceHtml(g)}${claimActions(g)}</div>`).join("")}</details>` : ""}
</div>
<div class="detail-actions"><a class="btn" href="${esc(portal)}" target="_blank" rel="noopener noreferrer">Find current IFU ↗</a><button class="btn" id="addEvidence">＋ Record evidence from IFU</button></div>
<div class="footnote">“Find current IFU” opens the manufacturer's eIFU portal${r.manufacturer === "Nobel Biocare" ? " searched for this REF" : ""}. Select your territory and confirm revision and REF before relying on it.</div>
<div class="section"><h3><label for="recordNote">Personal reference note</label></h3><textarea id="recordNote" rows="2" placeholder="Non-patient-specific note about this component…">${esc(note)}</textarea><div id="noteWarn" class="field-warn" aria-live="polite"></div></div>
<div class="detail-actions sticky-actions"><button class="btn primary" id="toggleSave">${user.saved.includes(r.recordId) ? "★ Saved" : "☆ Save"}</button><button class="btn" id="toggleCompare">${user.compare.includes(r.recordId) ? "✓ Comparing" : "＋ Compare"}</button><button class="btn" id="copyRef">Copy REF</button><button class="btn" id="saveNote">Save note</button></div>
<div class="footnote">Data status: ${esc(r.dataStatus)}. This record is not a compatibility determination or clinical recommendation.</div>`;
  }

  function bindRecordSheet(r) {
    const id = r.recordId;
    $("#sheetClose").onclick = () => closeSheet();
    $("#toggleSave").onclick = () => {
      user.saved = user.saved.includes(id) ? user.saved.filter((x) => x !== id) : [...user.saved, id];
      persist();
      toast(user.saved.includes(id) ? "Saved component" : "Removed from saved");
      openSheet(id);
    };
    $("#toggleCompare").onclick = () => {
      if (user.compare.includes(id)) user.compare = user.compare.filter((x) => x !== id);
      else if (user.compare.length < C.MAX_COMPARE) user.compare.push(id);
      else return toast("Comparison is limited to four records");
      persist();
      openSheet(id);
    };
    $("#copyRef").onclick = () => copyText(r.articleNumber);
    const warn = () => {
      const hits = C.detectIdentifiers($("#recordNote").value);
      $("#noteWarn").textContent = hits.length ? "Possible patient identifier: " + hits.join(", ") + ". Notes must not contain patient information." : "";
      return hits;
    };
    $("#recordNote").addEventListener("input", warn);
    $("#saveNote").onclick = () => {
      if (warn().length) return toast("Note not saved — remove patient identifiers");
      const v = $("#recordNote").value.trim();
      if (v) user.notes[id] = v;
      else delete user.notes[id];
      persist();
      toast("Note saved locally");
    };
    $("#addEvidence").onclick = () => openSheet(id, "evidence-form");
  }

  function copyText(s) {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(s).then(() => toast("Copied " + s)).catch(() => toast(s));
    else toast(s);
  }

  /* ========================================================= evidence entry */
  function evidenceFormHtml(r) {
    const ev = evidence();
    const docs = ev.documents.filter((d) => d.manufacturer === r.manufacturer && d.sourceType !== "ifu-portal");
    const systemsForMan = unique("implantSystem", records.filter((x) => x.manufacturer === r.manufacturer));
    return `<div class="sheet-head"><div><div class="secondary">Record evidence · ${esc(r.manufacturer)}</div><h2 id="sheetTitle">REF ${esc(r.articleNumber)}</h2><div class="secondary">${esc(r.component)}</div></div><button class="icon-btn" id="efBack" aria-label="Back to record">←</button></div>
<div class="notice">Enter only what the <b>current manufacturer IFU for your territory</b> states for this <b>exact REF</b>. New entries are saved as <b>pending verification</b> and do not change the status until you review and mark them verified.</div>
<form id="evForm" class="form-grid" novalidate>
<div class="field"><label for="efType">Claim type</label><select id="efType"><option value="torque">Torque value</option><option value="compatibility">Compatibility statement</option></select></div>
<div class="field"><label for="efScope">Applies to</label><select id="efScope"><option value="">Every catalogue context of this REF</option><option value="ctx">Only ${esc(r.implantSystem)} · ${esc(r.platform)}</option></select></div>
<fieldset class="span2 ef-torque"><legend>Torque</legend><div class="form-grid">
 <div class="field"><label for="efNcm">Value (Ncm)</label><input id="efNcm" type="number" inputmode="decimal" min="1" max="100" step="0.5"><label class="check"><input type="checkbox" id="efHand"> IFU says hand-tight (no torque value)</label></div>
 <div class="field"><label for="efApp">Application (as worded in IFU)</label><input id="efApp" list="efAppList" placeholder="e.g. abutment screw to implant"><datalist id="efAppList"><option value="Abutment screw to implant"><option value="Prosthetic screw to abutment"><option value="Basal screw to implant"><option value="Occlusal screw to Ti-base"></datalist></div>
 <div class="field span2"><label for="efInstr">Instrument (optional)</label><input id="efInstr" placeholder="e.g. driver + torque ratchet named in IFU"></div>
</div></fieldset>
<fieldset class="span2 ef-compat hidden"><legend>Compatibility</legend><div class="form-grid">
 <div class="field"><label for="efAssert">Statement</label><select id="efAssert"><option value="compatible">Compatible / indicated for use with</option><option value="contraindicated">Contraindicated / not for use with</option></select></div>
 <div class="field"><label for="efTargetKind">Target</label><select id="efTargetKind"><option value="system">Implant system / platform</option><option value="ref">Specific REF</option></select></div>
 <div class="field ef-tsys"><label for="efTSys">System</label><select id="efTSys">${systemsForMan.map((s) => `<option ${s === r.implantSystem ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
 <div class="field ef-tsys"><label for="efTPlat">Platform</label><select id="efTPlat"></select></div>
 <div class="field span2 ef-tref hidden"><label for="efTRef">Target REF</label><input id="efTRef" autocomplete="off" autocapitalize="off" placeholder="REF as printed"><div class="secondary" id="efTRefHint"></div></div>
</div></fieldset>
<fieldset class="span2"><legend>Source document</legend><div class="form-grid">
 <div class="field span2"><label for="efDoc">Document</label><select id="efDoc"><option value="__new">＋ New document…</option>${docs.map((d) => `<option value="${esc(d.documentId)}">${esc(d.documentTitle)} · ${esc(d.revisionOrDate)} · ${esc(d.territory)}</option>`).join("")}</select></div>
 <div class="ef-newdoc span2"><div class="form-grid">
  <div class="field span2"><label for="efTitle">Document title / number</label><input id="efTitle" placeholder="e.g. IFU number and title"></div>
  <div class="field"><label for="efSType">Source type</label><select id="efSType">${C.SOURCE_TYPES.filter((t) => t !== "ifu-portal").map((t) => `<option value="${t}">${t}</option>`).join("")}</select></div>
  <div class="field"><label for="efRev">Revision / date of issue</label><input id="efRev" placeholder="e.g. Rev 06 · 2025-03-05"></div>
  <div class="field span2"><label for="efUrl">Direct HTTPS URL</label><input id="efUrl" type="url" inputmode="url" placeholder="https://…"></div>
  <div class="field"><label for="efTerr">Territory</label><input id="efTerr" value="${esc(user.settings.territory)}"></div>
  <div class="field"><label for="efRetr">Retrieved</label><input id="efRetr" type="date" value="${today()}"></div>
 </div></div>
 <div class="field"><label for="efPage">Page / section / table</label><input id="efPage" placeholder="e.g. p. 7, Table 3"></div>
 <div class="field"><label for="efPRef">REF as printed in document</label><input id="efPRef" value="${esc(r.articleNumber)}"></div>
 <div class="field span2"><label for="efExcerpt">Short excerpt or paraphrase (optional, ≤ 300 chars)</label><textarea id="efExcerpt" rows="2" maxlength="300"></textarea></div>
</div></fieldset>
<div class="span2" id="efErrors" role="alert"></div>
<div class="detail-actions span2"><button class="btn primary" type="submit">Save as pending verification</button><button class="btn" type="button" id="efCancel">Cancel</button></div>
</form>`;
  }

  function bindEvidenceForm(r) {
    const back = () => openSheet(r.recordId);
    $("#efBack").onclick = back;
    $("#efCancel").onclick = back;
    const sync = () => {
      const t = $("#efType").value;
      $(".ef-torque").classList.toggle("hidden", t !== "torque");
      $(".ef-compat").classList.toggle("hidden", t !== "compatibility");
      const k = $("#efTargetKind").value;
      $$(".ef-tsys").forEach((e) => e.classList.toggle("hidden", k !== "system"));
      $(".ef-tref").classList.toggle("hidden", k !== "ref");
      $(".ef-newdoc").classList.toggle("hidden", $("#efDoc").value !== "__new");
    };
    const fillPlat = () => {
      const sys = $("#efTSys").value;
      const plats = unique("platform", records.filter((x) => x.manufacturer === r.manufacturer && x.implantSystem === sys));
      $("#efTPlat").innerHTML = `<option value="">All platforms of this system</option>` + plats.map((p) => `<option ${p === r.platform && sys === r.implantSystem ? "selected" : ""}>${esc(p)}</option>`).join("");
    };
    ["efType", "efTargetKind", "efDoc"].forEach((i) => $("#" + i).addEventListener("change", sync));
    $("#efTSys").addEventListener("change", fillPlat);
    $("#efTRef").addEventListener("input", (e) => {
      const m = C.exactRefMatches(records, e.target.value);
      $("#efTRefHint").textContent = e.target.value ? (m.length ? `${m.length} catalogue row(s): ${m[0].component}` : "Not found in catalogue") : "";
    });
    fillPlat();
    sync();
    $("#evForm").onsubmit = (e) => {
      e.preventDefault();
      const errs = [];
      let docId = $("#efDoc").value;
      let newDoc = null;
      if (docId === "__new") {
        newDoc = {
          documentId: C.uid("doc"),
          manufacturer: r.manufacturer,
          sourceType: $("#efSType").value,
          documentTitle: $("#efTitle").value.trim(),
          revisionOrDate: $("#efRev").value.trim(),
          sourceUrl: $("#efUrl").value.trim(),
          retrievedAt: $("#efRetr").value,
          territory: $("#efTerr").value.trim(),
          status: "current",
          createdAt: new Date().toISOString(),
        };
        docId = newDoc.documentId;
      }
      const type = $("#efType").value;
      const claim = {
        claimId: C.uid("claim"),
        claimType: type,
        subject: { manufacturer: r.manufacturer, articleNumber: r.articleNumber },
        specificProductRef: $("#efPRef").value.trim(),
        scope: $("#efScope").value === "ctx" ? { implantSystem: r.implantSystem, platform: r.platform } : null,
        documentId: docId,
        pageOrSection: $("#efPage").value.trim(),
        excerpt: $("#efExcerpt").value.trim().slice(0, 300) || undefined,
        verificationStatus: "pending",
        createdAt: new Date().toISOString(),
        history: [{ at: new Date().toISOString(), action: "created (pending)" }],
      };
      if (type === "torque") {
        Object.assign(claim, { application: $("#efApp").value.trim(), instrument: $("#efInstr").value.trim() || undefined });
        if ($("#efHand").checked) {
          claim.handTight = true;
          if ($("#efNcm").value) claim.maxNcm = Number($("#efNcm").value);
        } else claim.valueNcm = $("#efNcm").value === "" ? null : Number($("#efNcm").value);
      }
      else {
        claim.assertion = $("#efAssert").value;
        if ($("#efTargetKind").value === "ref") {
          const tr = $("#efTRef").value.trim();
          const m = C.exactRefMatches(records, tr);
          if (!m.length) errs.push("Target REF is not in the catalogue.");
          claim.target = { articleNumber: tr, manufacturer: m[0]?.manufacturer || "" };
        } else claim.target = { implantSystem: $("#efTSys").value, platform: $("#efTPlat").value || undefined };
      }
      const docsById = Object.fromEntries([...evidence().documents, ...(newDoc ? [newDoc] : [])].map((d) => [d.documentId, d]));
      errs.push(...C.claimProblems(claim, docsById));
      if (newDoc && !newDoc.documentTitle) errs.push("missing document title");
      if (errs.length) {
        $("#efErrors").innerHTML = `<div class="warning"><b>Cannot save:</b><ul>${[...new Set(errs)].map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
        return;
      }
      if (newDoc) user.evidence.documents.push(newDoc);
      user.evidence.claims.push(claim);
      persist();
      toast("Saved as pending verification");
      openSheet(r.recordId);
    };
  }

  /* ========================================================= claim workflow */
  function claimAction(claimId, act) {
    const curated = (CURATED.claims || []).find((x) => x.claimId === claimId);
    if (curated) {
      if (act === "verify") return openVerifyDialog([curated]);
      user.evidence.reviews ??= {};
      if (act === "clear") delete user.evidence.reviews[claimId];
      else setReview(claimId, act);
      persist();
      toast(act === "clear" ? "Your review cleared" : "Recorded: " + act);
      return refreshAfterEvidenceChange();
    }
    const c = user.evidence.claims.find((x) => x.claimId === claimId);
    if (!c) return;
    const log = (action, by) => (c.history = [...(c.history || []), { at: new Date().toISOString(), action, ...(by ? { by } : {}) }]);
    if (act === "verify") return openVerifyDialog([c]);
    if (act === "delete") {
      if (!confirm("Delete this local evidence record? Export evidence first if you may need it.")) return;
      user.evidence.claims = user.evidence.claims.filter((x) => x !== c);
    } else {
      c.verificationStatus = act;
      if (act === "pending") {
        delete c.reviewedBy;
        delete c.reviewedAt;
      }
      log("status → " + act);
    }
    persist();
    toast("Evidence updated");
    refreshAfterEvidenceChange();
  }
  function setReview(claimId, status, by) {
    user.evidence.reviews ??= {};
    const prev = user.evidence.reviews[claimId] || { history: [] };
    const claim = (CURATED.claims || []).find((x) => x.claimId === claimId);
    const doc = claim && (CURATED.documents || []).find((d) => d.documentId === claim.documentId);
    user.evidence.reviews[claimId] = {
      verificationStatus: status,
      fingerprint: C.claimFingerprint(claim, doc),
      reviewedBy: status === "verified" ? by : undefined,
      reviewedAt: status === "verified" ? today() : undefined,
      history: [...(prev.history || []), { at: new Date().toISOString(), action: "status → " + status, ...(by ? { by } : {}) }].slice(-50),
    };
  }
  function refreshAfterEvidenceChange() {
    if (!$("#sheet").classList.contains("hidden") && ui.selected) openSheet(ui.selected);
    else render();
  }
  function claimWhat(c) {
    return c.claimType === "torque" ? C.torqueText(c) + " — " + c.application : (c.assertion || "") + " " + targetText(c);
  }
  /** Verify one or more claims that share a source statement. Local claims are updated; shipped claims get an on-device review. */
  function openVerifyDialog(claims) {
    const c = claims[0];
    const ev = evidence();
    const doc = ev.documents.find((d) => d.documentId === c.documentId) || {};
    const refs = [...new Set(claims.map((x) => x.subject.articleNumber))];
    const many = refs.length > 1;
    const box = document.createElement("div");
    box.className = "modal";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    const refList = refs
      .map((ref) => {
        const r = records.find((x) => x.manufacturer === c.subject.manufacturer && C.normalizeRef(x.articleNumber) === C.normalizeRef(ref));
        const fda = claims.find((x) => x.subject.articleNumber === ref)?.bindingCheck?.description;
        return `<li><b>${esc(ref)}</b> — ${esc(r ? r.component : "not in catalogue")}${fda ? `<br><span class="secondary">Manufacturer's FDA description: ${esc(fda)}</span>` : ""}</li>`;
      })
      .join("");
    box.innerHTML = `<div class="modal-inner"><h2>${many ? `Verify ${refs.length} REFs` : "Verify evidence"}</h2><p class="sub"><b>${esc(claimWhat(c))}</b>${many ? "" : ` for REF <b>${esc(c.subject.articleNumber)}</b>`}</p><div class="muted-box">${doc.sourceUrl ? `<a href="${esc(doc.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(doc.documentTitle || "?")}</a>` : esc(doc.documentTitle || "?")} · ${esc(doc.revisionOrDate || "?")} · <b>${esc(c.pageOrSection)}</b><br>${esc(doc.sourceType || "")} · ${esc(doc.territory || "")} · retrieved ${esc(doc.retrievedAt || "")}${c.curationRuleId ? `<br>REFs matched by catalogue name (rule ${esc(c.curationRuleId)}); ${claims.filter((x) => x.refPrintedInDocument).length} of ${claims.length} are printed in the cited document.` : ""}${c.conflictGroup ? `<br><b>Declared conflict:</b> this source also gives a different instruction for the same products — verify only the one that matches the product IFU.` : ""}</div>
${many ? `<details class="mt" open><summary>${refs.length} REFs covered by this statement</summary><ul class="ref-list">${refList}</ul></details>` : ""}
<label class="check"><input type="checkbox" id="vChk"> I opened this document, confirmed it is the <b>current</b> revision for my territory, and the cited page states this for ${many ? `<b>each of the ${refs.length} products listed</b>` : `the <b>exact REF ${esc(c.subject.articleNumber)}</b>`}.</label>
<div class="field"><label for="vBy">Reviewer initials / name</label><input id="vBy" autocomplete="name"></div>
<div id="vErr" class="field-warn"></div><div class="detail-actions"><button class="btn primary" id="vOk">Mark verified</button><button class="btn" id="vCancel">Cancel</button></div></div>`;
    document.body.appendChild(box);
    $("#vBy", box).focus();
    const close = () => box.remove();
    $("#vCancel", box).onclick = close;
    $("#vOk", box).onclick = () => {
      const by = $("#vBy", box).value.trim().slice(0, 60);
      if (!$("#vChk", box).checked || !by) return ($("#vErr", box).textContent = "Tick the confirmation and enter a reviewer.");
      for (const x of claims) {
        if (x.origin === "curated" || (CURATED.claims || []).some((k) => k.claimId === x.claimId)) setReview(x.claimId, "verified", by);
        else {
          const local = user.evidence.claims.find((k) => k.claimId === x.claimId);
          if (!local) continue;
          Object.assign(local, { verificationStatus: "verified", reviewedBy: by, reviewedAt: today() });
          local.history = [...(local.history || []), { at: new Date().toISOString(), action: "verified", by }];
        }
      }
      persist();
      close();
      const merged = evidence();
      const docs = Object.fromEntries(merged.documents.map((d) => [d.documentId, d]));
      const st = C.claimStanding(merged.claims.find((k) => k.claimId === c.claimId), docs, evOpts());
      toast(st.effective ? `Verified ${claims.length} claim${claims.length > 1 ? "s" : ""} — now shown as current evidence` : "Marked verified, but not effective: " + st.reasons.join("; "));
      refreshAfterEvidenceChange();
    };
  }

  /* ===================================================== identify (wizard) */
  function identify() {
    const w = ui.wiz;
    const ev = evidence();
    const steps = [
      ["Manufacturer", w.manufacturer],
      ["System", w.system],
      ["Connection / platform", w.platform],
      ["Restorative intent", w.intent ? typeLabel(w.intent) : ""],
    ];
    const stepIdx = !w.manufacturer ? 0 : !w.system ? 1 : !w.platform ? 2 : !w.intent ? 3 : 4;
    const crumbs = `<ol class="wiz-steps">${steps
      .map(([l, v], i) => `<li class="${i < stepIdx ? "done" : i === stepIdx ? "now" : ""}">${i < stepIdx ? `<button class="linkish" data-wiz-back="${i}">${esc(l)}: <b>${esc(v)}</b> ✎</button>` : `<span>${i + 1}. ${esc(l)}</span>`}</li>`)
      .join("")}</ol>`;
    let body = "";
    const sysRows = (m) => records.filter((r) => r.manufacturer === m);
    if (stepIdx === 0) {
      body = `<div class="dash-grid"><div class="panel"><h2>Start from an implant REF</h2><div class="sub">If you have the implant's REF (sticker, notes, lab ticket) enter it to set manufacturer, system and platform.</div><form class="search-hero" id="implantRefForm"><input id="implantRef" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Implant REF"><button class="btn primary">Look up</button></form><button class="btn mt" data-scan-start="wizard">⌖ Scan the implant label</button><div id="implantRefOut"></div></div>
<div class="panel"><h2>1. Manufacturer</h2><div class="option-grid">${unique("manufacturer")
        .map((m) => `<button class="option" data-wiz-set="manufacturer" data-val="${esc(m)}"><b>${esc(m)}</b><span class="secondary">${fmtN(sysRows(m).length)} records · ${unique("implantSystem", sysRows(m)).length} systems</span></button>`)
        .join("")}</div></div></div>`;
    } else if (stepIdx === 1) {
      const rows = sysRows(w.manufacturer);
      body = `<div class="panel"><h2>2. Implant system</h2><div class="sub">System labels as printed in your workbook.</div><div class="option-grid">${unique("implantSystem", rows)
        .map((s) => {
          const rs = rows.filter((r) => r.implantSystem === s);
          return `<button class="option" data-wiz-set="system" data-val="${esc(s)}"><b>${esc(s)}</b><span class="secondary">${fmtN(rs.length)} records · ${unique("platform", rs).filter((p) => !C.isSecondaryPlatform(p)).length} implant-level platforms</span></button>`;
        })
        .join("")}</div></div>`;
    } else if (stepIdx === 2) {
      const rows = records.filter((r) => r.manufacturer === w.manufacturer && r.implantSystem === w.system);
      const plats = unique("platform", rows);
      const card = (p) => `<button class="option" data-wiz-set="platform" data-val="${esc(p)}"><b>${esc(p)}</b><span class="secondary">${fmtN(rows.filter((r) => r.platform === p).length)} records</span></button>`;
      body = `<div class="panel"><h2>3. Connection / platform</h2><div class="sub">Implant-level connection for ${esc(w.system)}. Confirm against the implant record or radiograph; the label alone does not identify an implant.</div><div class="option-grid">${plats.filter((p) => !C.isSecondaryPlatform(p)).map(card).join("")}</div>
<h3 class="mt">Already restoring at abutment level, or system-wide items</h3><div class="option-grid">${plats.filter((p) => C.isSecondaryPlatform(p)).map(card).join("")}</div></div>`;
    } else if (stepIdx === 3) {
      const rows = wizardRows(false);
      const counts = {};
      for (const r of rows) for (const t of typesOf.get(r.recordId)) counts[t] = (counts[t] || 0) + 1;
      body = `<div class="panel"><h2>4. What do you need to do?</h2><div class="sub">Categories present in the catalogue for ${esc(w.system)} · ${esc(w.platform)}${w.showAllPlatforms ? " (incl. items listed for all platforms)" : ""}.</div><div class="option-grid">${C.COMPONENT_TYPES.filter((t) => counts[t.id])
        .map((t) => `<button class="option" data-wiz-set="intent" data-val="${t.id}"><b>${esc(t.intent)}</b><span class="secondary">${esc(t.label)} · ${counts[t.id]}</span></button>`)
        .join("")}</div><label class="check mt"><input type="checkbox" id="wizAllPlat" ${w.showAllPlatforms ? "checked" : ""}> Include items the workbook lists under “All platforms” for this system</label></div>`;
    } else {
      const want = C.isSecondaryPlatform(w.platform) ? { implantSystem: w.system } : { implantSystem: w.system, platform: w.platform };
      let rows = wizardRows(true);
      const statuses = rows.map((r) => C.resolveCompatibility(r, ev, want, evOpts()).status);
      const nConfirmed = statuses.filter((s) => s === "manufacturer-confirmed").length;
      const nContra = statuses.filter((s) => s === "contraindicated" || s === "contradictory").length;
      const nPending = statuses.filter((s) => s === "pending").length;
      if (w.confirmedOnly) rows = rows.filter((_, i) => statuses[i] === "manufacturer-confirmed");
      const exact = rows.filter((r) => r.platform === w.platform);
      const wide = rows.filter((r) => r.platform !== w.platform);
      body = `<div class="panel"><div class="panel-head"><h2>${esc(typeLabel(w.intent))}</h2><div class="seg" role="group" aria-label="Evidence filter"><button class="${!w.confirmedOnly ? "on" : ""}" data-wiz-confirmed="0">All catalogue associations</button><button class="${w.confirmedOnly ? "on" : ""}" data-wiz-confirmed="1">Manufacturer-confirmed only</button></div></div>
<div class="notice">${esc(w.manufacturer)} · ${esc(w.system)} · ${esc(w.platform)} — <b>${nConfirmed}</b> of ${statuses.length} with manufacturer-confirmed evidence for this context${nPending ? `, <b>${nPending}</b> sourced from the manufacturer's compatibility IFU and awaiting clinician review` : ""}${nContra ? `, <b>${nContra}</b> contraindicated/contradictory` : ""}. Rows without evidence are <b>catalogue associations only</b> (status: Not established).</div>
${w.confirmedOnly && !rows.length ? `<div class="empty">No manufacturer-confirmed evidence recorded for this context yet. Switch to “All catalogue associations”, then use <b>Find current IFU</b> and <b>Record evidence</b> on a component.</div>` : ""}
${exact.length ? `<h3>Listed for ${esc(w.platform)} (${exact.length})</h3>${recordTable(exact, { compat: { ev, want } })}` : ""}
${wide.length ? `<h3 class="mt">Listed under “All platforms” for ${esc(w.system)} (${wide.length})</h3><div class="sub">System-wide catalogue listing — confirm platform applicability in the IFU.</div>${recordTable(wide, { compat: { ev, want } })}` : ""}
<div class="detail-actions"><button class="btn" data-wiz-back="3">← Change intent</button><button class="btn" id="wizToCase">Start a case list for ${esc(w.system)}</button><button class="btn" id="wizToCat">Open in catalogue</button></div></div>`;
    }
    $("#screen").innerHTML =
      pageHead("Identify & find parts", "Guided path: manufacturer → system → connection/platform → restorative intent. Shows catalogue associations with their evidence status — never inferred compatibility.", w.manufacturer ? `<button class="btn" id="wizReset">Start over</button>` : "") +
      crumbs +
      body;
    $("#wizReset")?.addEventListener("click", () => {
      Object.assign(ui.wiz, { manufacturer: "", system: "", platform: "", intent: "", confirmedOnly: false });
      identify();
    });
    $("#wizAllPlat")?.addEventListener("change", (e) => {
      w.showAllPlatforms = e.target.checked;
      identify();
    });
    $("#wizToCat")?.addEventListener("click", () => {
      Object.assign(ui, { query: "", manufacturer: w.manufacturer, system: w.system, platform: w.platform, family: "", material: "", ctype: w.intent, evidenceFilter: "" });
      setView("catalogue");
    });
    $("#wizToCase")?.addEventListener("click", () => {
      ui.casePreset = { manufacturer: w.manufacturer, system: w.system };
      setView("casebox");
    });
    $("#implantRefForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = $("#implantRef").value;
      const m = C.exactRefMatches(records, q);
      const implants = m.filter((r) => typesOf.get(r.recordId)[0] === "implant");
      const out = $("#implantRefOut");
      if (!m.length) return (out.innerHTML = `<div class="empty small">REF not found in the catalogue. Check the label, or choose the manufacturer below.</div>`);
      if (!implants.length)
        return (out.innerHTML = `<div class="empty small">${esc(m[0].articleNumber)} is listed as “${esc(m[0].component)}”, not an implant. <button class="linkish" data-record="${m[0].recordId}">Open record</button></div>`);
      out.innerHTML = `<div class="sub">Catalogue contexts for this implant REF — choose one:</div>${implants
        .map((r) => `<button class="option" data-wiz-ctx="${r.recordId}"><b>${esc(r.component)}</b><span class="secondary">${esc(r.manufacturer)} · ${esc(r.implantSystem)} · ${esc(r.platform)}</span></button>`)
        .join("")}<div class="footnote">Platform is taken from the workbook row for this REF; confirm on the implant documentation.</div>`;
    });
  }
  function wizardRows(filterIntent) {
    const w = ui.wiz;
    return records.filter(
      (r) =>
        r.manufacturer === w.manufacturer &&
        r.implantSystem === w.system &&
        (r.platform === w.platform || (w.showAllPlatforms && r.platform === "All platforms" && !C.isSecondaryPlatform(w.platform))) &&
        (!filterIntent || typesOf.get(r.recordId).includes(w.intent)),
    );
  }

  /* ================================================================ systems */
  function systems() {
    const pairs = {};
    for (const r of records) (pairs[r.manufacturer + "|||" + r.implantSystem] ??= []).push(r);
    const items = Object.entries(pairs)
      .map(([k, rs]) => {
        const [manufacturer, system] = k.split("|||");
        return { manufacturer, system, count: rs.length, families: new Set(rs.map((x) => x.productFamily)).size, platforms: [...new Set(rs.map((x) => x.platform).filter(Boolean))] };
      })
      .sort((a, b) => a.manufacturer.localeCompare(b.manufacturer) || a.system.localeCompare(b.system));
    const max = Math.max(...items.map((x) => x.count));
    $("#screen").innerHTML =
      pageHead("Implant systems", "Implant systems in your workbook with their platform and product-family coverage.") +
      `<div class="system-grid">${items
        .map(
          (s) =>
            `<div class="system-card"><div class="secondary">${esc(s.manufacturer)}</div><h3>${esc(s.system)}</h3><div class="big-n">${fmtN(s.count)} <span class="secondary">records</span></div><div class="secondary">${s.families} product families</div><div class="barline"><span style="width:${(s.count / max) * 100}%"></span></div><div class="footnote">${s.platforms.map(esc).join(" · ")}</div><div class="detail-actions"><button class="btn small" data-system-filter="${esc(s.manufacturer)}|||${esc(s.system)}">Browse components →</button><button class="btn small" data-wiz-system="${esc(s.manufacturer)}|||${esc(s.system)}">Guided finder →</button></div></div>`,
        )
        .join("")}</div>`;
  }

  /* ================================================================ compare */
  function compare() {
    const chosen = user.compare.map(findRecord).filter(Boolean);
    const ev = evidence();
    const fields = [
      ["Component", (r) => r.component],
      ["Manufacturer", (r) => r.manufacturer],
      ["Implant system", (r) => r.implantSystem],
      ["Platform", (r) => r.platform],
      ["Product family", (r) => r.productFamily],
      ["Material", (r) => r.material],
      ["Diameter (mm)", (r) => r.dimensions?.diameterMm],
      ["Length (mm)", (r) => r.dimensions?.lengthMm],
      ["Gingiva height (mm)", (r) => r.dimensions?.gingivaHeightMm],
      ["Abutment height (mm)", (r) => r.dimensions?.abutmentHeightMm],
      ["Height (mm)", (r) => r.dimensions?.heightMm],
      ["Angulation", (r) => r.dimensions?.angulation],
      ["Pack size", (r) => r.packSize],
      ["Catalogue pages", (r) => r.cataloguePages],
    ];
    $("#screen").innerHTML =
      pageHead("Compare components", "Compare up to four catalogue records. A matching REF or product name does not establish compatibility.") +
      `<div class="notice"><b>Compare like with like.</b> Workbook fields plus each record's own evidence status. Side-by-side display does not establish interchangeability.</div><div class="panel"><div class="panel-head"><h2>Selected records (${chosen.length}/4)</h2><button class="btn small" id="clearCompare">Clear all</button></div>${
        chosen.length
          ? chosen.map((r) => `<div class="list-row"><div class="data-row" tabindex="0" data-record="${r.recordId}"><b>${esc(r.articleNumber)} · ${esc(r.component)}</b><div class="secondary">${esc(r.manufacturer)} · ${esc(r.implantSystem)} · ${esc(r.platform)}</div></div><button class="btn small" data-remove-compare="${r.recordId}">Remove</button></div>`).join("")
          : '<div class="empty">No selected components. Open a record and use “Compare”.</div>'
      }</div>${
        chosen.length >= 2
          ? `<div class="panel mt"><h2>Specification comparison</h2><div class="table-wrap"><table class="compare-table"><thead><tr><th>Field</th>${chosen.map((r) => `<th>${esc(r.articleNumber)}<br>${esc(r.manufacturer)} · ${esc(r.implantSystem)}</th>`).join("")}</tr></thead><tbody>${fields
              .map(([label, fn]) => `<tr><td><b>${label}</b></td>${chosen.map((r) => `<td>${esc(fn(r) ?? "Not entered")}</td>`).join("")}</tr>`)
              .join("")}<tr><td><b>Compatibility evidence</b></td>${chosen.map((r) => `<td>${statusChip(C.resolveCompatibility(r, ev, null, evOpts()))}</td>`).join("")}</tr><tr><td><b>Verified torque</b></td>${chosen
              .map((r) => {
                const t = C.resolveTorque(r, ev, evOpts());
                return `<td>${t.verified.length ? t.verified.map((g) => `${esc(C.torqueText(g.claim))} (${esc(g.claim.application)})`).join("<br>") : "Not established"}</td>`;
              })
              .join("")}</tr></tbody></table></div><div class="detail-actions"><button class="btn primary" id="exportCompare">Export comparison CSV</button></div></div>`
          : ""
      }`;
    $("#clearCompare").onclick = () => {
      user.compare = [];
      persist();
      compare();
    };
    $("#exportCompare")?.addEventListener("click", () => exportCsv(chosen, "implantref-comparison.csv"));
  }

  /* ================================================================== saved */
  function saved() {
    const arr = user.saved.map(findRecord).filter(Boolean);
    const missing = user.saved.length - arr.length;
    $("#screen").innerHTML =
      pageHead("Saved components", "Your locally saved restorative components.") +
      `<div class="panel"><div class="panel-head"><h2>Saved records (${arr.length})</h2><div class="btn-row"><button class="btn small" id="savedCompare">Add first 4 to compare</button><button class="btn small" id="exportSaved">Export CSV</button></div></div>${
        missing ? `<div class="warning">${missing} saved ID(s) are not in the current catalogue. They are kept in storage and in exports.</div>` : ""
      }${arr.length ? recordTable(arr, { extraCol: (r) => `<button class="btn small" data-unsave="${r.recordId}">Remove</button>`, showSaved: false }) : '<div class="empty">No saved components yet. Save records from a component sheet.</div>'}</div>`;
    $("#exportSaved").onclick = () => exportCsv(arr, "implantref-saved-components.csv");
    $("#savedCompare").onclick = () => {
      user.compare = arr.slice(0, C.MAX_COMPARE).map((r) => r.recordId);
      persist();
      setView("compare");
    };
  }

  /* =============================================================== case lists */
  function casebox() {
    const preset = ui.casePreset || {};
    ui.casePreset = null;
    const sysOpts = (m) => unique("implantSystem", m ? records.filter((r) => r.manufacturer === m) : records);
    $("#screen").innerHTML =
      pageHead("Case component lists", "Component lists for implant work, lab discussions or stock enquiries — named after the restoration, never the patient.") +
      `<div class="warning"><b>Privacy:</b> lists are named after the work (tooth, system, platform), never the patient. Do not enter patient names, CHI or hospital numbers, dates of birth or clinical record details. Lists are stored only in this browser.</div>
<div class="dash-grid"><div class="panel"><h2>Create a component list</h2><form id="caseForm" class="form-grid"><div class="field"><label for="caseRef">List name</label><input id="caseRef" maxlength="60" autocomplete="off" placeholder="Describe the work, e.g. UR6 BLX RB crown"><div class="secondary">Name the restoration, not the patient.</div><div id="caseRefWarn" class="field-warn" aria-live="polite"></div></div><div class="field"><label for="caseMan">Manufacturer</label><select id="caseMan"><option value="">Select</option>${unique("manufacturer")
        .map((x) => `<option ${x === preset.manufacturer ? "selected" : ""}>${esc(x)}</option>`)
        .join("")}</select></div><div class="field span2"><label for="caseSys">Implant system</label><select id="caseSys"><option value="">Select system</option>${sysOpts(preset.manufacturer)
        .map((x) => `<option ${x === preset.system ? "selected" : ""}>${esc(x)}</option>`)
        .join("")}</select></div><div class="detail-actions span2"><button class="btn primary">Create list</button></div></form></div>
<div class="panel"><h2>Existing case lists</h2>${
        user.cases.length
          ? user.cases.map((c) => `<div class="list-row"><div><b>${esc(c.ref)}</b><div class="secondary">${esc(c.manufacturer)} · ${esc(c.system)} · ${c.items.length} components</div></div><button class="btn small" data-open-case="${esc(c.id)}">Open</button></div>`).join("")
          : '<div class="empty">No lists created.</div>'
      }</div></div><div id="caseDetail"></div>`;
    $("#caseMan").onchange = () => {
      $("#caseSys").innerHTML = '<option value="">Select system</option>' + sysOpts($("#caseMan").value).map((x) => `<option>${esc(x)}</option>`).join("");
    };
    const warn = () => {
      const hits = C.detectIdentifiers($("#caseRef").value);
      $("#caseRefWarn").textContent = hits.length ? "Looks like a patient identifier (" + hits.join(", ") + ")." : "";
      return hits;
    };
    $("#caseRef").addEventListener("input", warn);
    $("#caseForm").onsubmit = (e) => {
      e.preventDefault();
      const ref = $("#caseRef").value.trim();
      const manufacturer = $("#caseMan").value;
      const system = $("#caseSys").value;
      if (!ref || !manufacturer || !system) return toast("Enter a list name, manufacturer and system");
      if (warn().length) return toast("Name the work, not the patient");
      const c = { id: C.uid("case"), ref, manufacturer, system, items: [], createdAt: new Date().toISOString() };
      user.cases.push(c);
      persist();
      ui.openCaseId = c.id;
      casebox();
    };
    if (ui.openCaseId) openCase(ui.openCaseId, false);
  }
  function openCase(id, scroll = true) {
    const c = user.cases.find((x) => x.id === id);
    if (!c) return;
    ui.openCaseId = id;
    const candidates = records.filter((r) => r.manufacturer === c.manufacturer && r.implantSystem === c.system);
    const items = c.items.map(findRecord).filter(Boolean);
    const missing = c.items.length - items.length;
    $("#caseDetail").innerHTML = `<div class="panel mt"><div class="panel-head"><div><h2>${esc(c.ref)} · ${esc(c.system)}</h2><div class="secondary">${esc(c.manufacturer)} · ${c.items.length} selected references</div></div><button class="btn small danger" id="deleteCase">Delete list</button></div>
<div class="form-grid"><div class="field span2"><label for="addCaseComponent">Add component from ${esc(c.system)}</label><select id="addCaseComponent"><option value="">Select a catalogue record…</option>${candidates
      .map((r) => `<option value="${r.recordId}">${esc(r.articleNumber)} · ${esc(r.component)} · ${esc(r.platform)}</option>`)
      .join("")}</select></div></div>
<div class="detail-actions"><button class="btn primary" id="addCaseItem">Add component</button><button class="btn" id="exportCase">Export CSV</button><button class="btn" id="printCase">Print shortlist</button></div>
${missing ? `<div class="warning">${missing} item(s) are not in the current catalogue and are retained.</div>` : ""}
<div class="mt">${items.length ? recordTable(items, { extraCol: (r) => `<button class="btn small" data-case-remove="${r.recordId}" data-case-id="${esc(c.id)}">Remove</button>`, showSaved: false }) : '<div class="empty">No components added to this list.</div>'}</div></div>`;
    $("#deleteCase").onclick = () => {
      if (!confirm("Delete this local component list?")) return;
      user.cases = user.cases.filter((x) => x.id !== id);
      ui.openCaseId = null;
      persist();
      casebox();
    };
    $("#addCaseItem").onclick = () => {
      const rid = $("#addCaseComponent").value;
      if (!rid) return toast("Select a component");
      if (!c.items.includes(rid)) c.items.push(rid);
      persist();
      openCase(id, false);
    };
    $("#exportCase").onclick = () => exportCsv(items, "implantref-" + c.ref.replace(/[^\w.-]+/g, "_") + ".csv");
    $("#printCase").onclick = () => printShortlist(c, items);
    if (scroll) $("#caseDetail").scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function printShortlist(c, items) {
    const ev = evidence();
    $("#printArea").innerHTML = `<h1>ImplantRef component shortlist</h1><p><b>${esc(c.ref)}</b> · ${esc(c.manufacturer)} · ${esc(c.system)} · printed ${today()}</p><table><thead><tr><th>REF</th><th>Component</th><th>Platform</th><th>Qty</th><th>Verified torque</th></tr></thead><tbody>${items
      .map((r) => {
        const t = C.resolveTorque(r, ev, evOpts());
        return `<tr><td>${esc(r.articleNumber)}</td><td>${esc(r.component)}</td><td>${esc(r.platform)}</td><td></td><td>${t.verified.length ? t.verified.map((g) => `${esc(C.torqueText(g.claim))} – ${esc(g.claim.application)} (${esc(g.source.documentTitle)}, ${esc(g.source.revisionOrDate)})`).join("<br>") : "See current IFU"}</td></tr>`;
      })
      .join("")}</tbody></table><p class="small">Non-identifiable list. Catalogue data imported from a user workbook and not independently IFU-verified. Not a prescription or compatibility determination.</p>`;
    document.body.classList.add("print-shortlist");
    window.addEventListener("afterprint", () => document.body.classList.remove("print-shortlist"), { once: true });
    window.print();
  }

  /* ========================================================= evidence view */
  function evidenceView() {
    const ev = evidence();
    const docsById = Object.fromEntries(ev.documents.map((d) => [d.documentId, d]));
    const graded = ev.claims.map((c) => ({ claim: c, ...C.claimStanding(c, docsById, evOpts()), source: C.withSource(c, docsById) }));
    const count = (s) => graded.filter((g) => g.standing === s).length;
    const recFor = (c) => firstByRef.get(c.subject.manufacturer + "|" + C.normalizeRef(c.subject.articleNumber));
    const inQueue = (g) => g.claim.origin === "curated" && g.claim.curationRuleId && g.standing === "unverified" && g.claim.verificationStatus === "pending";
    const attention = graded.filter((g) => !inQueue(g) && ["stale", "incomplete", "contradicted", "unverified", "non-authoritative"].includes(g.standing));
    const fullList = ui.evView === "attention" ? attention : ui.evView === "all" ? graded : graded.filter((g) => g.standing === ui.evView);
    const LIST_CAP = 150;
    const list = fullList.slice(0, LIST_CAP);
    const groups = {};
    for (const g of graded.filter(inQueue)) (groups[g.claim.curationRuleId] ??= []).push(g);
    const groupList = Object.entries(groups).sort((a, b) => xcRank(a[1][0].claim) - xcRank(b[1][0].claim) || a[0].localeCompare(b[0]));
    const xcCount = (st) => groupList.filter(([, gs]) => gs[0].claim.crossCheck?.status === st).length;
    const queueHtml = groupList.length
      ? `<div class="panel"><div class="panel-head"><h2>Review queue — ${graded.filter(inQueue).length} shipped claims in ${groupList.length} source statements</h2></div><p class="sub">Each row is one statement from one IFU page, bound to the REFs listed. Open the document, check the page, then verify the whole group or flag it.${xcCount("agreed") + xcCount("disagreed") ? ` Automated cross-check: <b>${xcCount("agreed")}</b> statements agreed${xcCount("disagreed") ? `, <b>${xcCount("disagreed")}</b> disagreed (listed first: check these)` : ""}.` : ""}</p>${groupList
          .map(([rid, gs]) => {
            const c = gs[0].claim;
            const s0 = gs[0].source;
            return `<div class="claim queue-row"><div class="claim-head"><div>${c.claimType === "compatibility" ? `<div class="compat-val">Compatible with <b>${esc(c.target?.implantSystem || "")} · ${esc(c.target?.platform || "")}</b></div><b>${esc(c.excerpt && c.excerpt.startsWith("Listed") ? "Implant table row" : "Implant statement")}</b>` : `<div class="torque-val small-val">${torqueHtml(c)}</div><b>${esc(c.application)}</b>`}<div class="secondary">${esc(s0.documentTitle)} · ${esc(s0.revisionOrDate)} · ${esc(c.pageOrSection)}</div><details><summary>${gs.length} REF${gs.length > 1 ? "s" : ""}</summary><div class="ref-chips">${gs.map((g) => { const r = recFor(g.claim); return r ? `<button class="chip" data-record="${r.recordId}">${esc(g.claim.subject.articleNumber)}</button>` : esc(g.claim.subject.articleNumber); }).join(" ")}</div></details></div><span class="btn-row"><span class="pill flag">${gs.length} pending</span>${c.crossCheck?.status === "agreed" ? '<span class="pill xc">Cross-checked</span>' : c.crossCheck?.status === "disagreed" ? '<span class="pill danger">Cross-check disagreed</span>' : ""}${c.conflictGroup ? '<span class="pill danger">Conflicting source</span>' : ""}${c.refPrintedInDocument !== undefined ? `<span class="pill neutral">${gs.filter((g) => g.claim.refPrintedInDocument).length}/${gs.length} REFs printed</span>` : ""}</span></div><div class="claim-actions"><a class="btn small" href="${esc(s0.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open IFU ↗</a><button class="btn small primary" data-group-verify="${esc(rid)}">Verify group…</button><button class="btn small" data-group-flag="${esc(rid)}">Doesn't match IFU</button></div></div>`;
          })
          .join("")}</div>`
      : "";
    $("#screen").innerHTML =
      pageHead("Evidence & IFU registry", "Every compatibility or torque statement links to a product-specific manufacturer document, revision, page and reviewer.", `<a class="btn" href="https://ifu.straumann.com/" target="_blank" rel="noopener noreferrer">Straumann eIFU ↗</a><a class="btn" href="https://ifu.nobelbiocare.com/en" target="_blank" rel="noopener noreferrer">Nobel eIFU ↗</a>`) +
      `<div class="notice"><b>How status is decided.</b> A claim counts only when it is <b>verified</b> by a named reviewer, cites an <b>official IFU, technique guide or manufacturer compatibility chart</b> (not a catalogue, portal or spreadsheet), names the <b>exact REF</b>, is not superseded, and was retrieved within <b>${user.settings.staleDays} days</b>. Everything else stays “pending” or “not established”.</div>
<div class="stats"><div class="stat"><div class="stat-label">VERIFIED &amp; CURRENT</div><div class="stat-value">${count("effective")}</div></div><div class="stat"><div class="stat-label">PENDING</div><div class="stat-value">${count("unverified")}</div></div><div class="stat"><div class="stat-label">STALE</div><div class="stat-value">${count("stale")}</div></div><div class="stat"><div class="stat-label">DOCUMENTS</div><div class="stat-value">${ev.documents.length}</div></div></div>
${queueHtml}
<div class="panel mt"><div class="panel-head"><h2>Claims</h2><div class="seg" role="group" aria-label="Claim filter">${[
        ["attention", `Needs attention (${attention.length})`],
        ["effective", "Verified"],
        ["all", `All (${graded.length})`],
      ]
        .map(([k, l]) => `<button class="${ui.evView === k ? "on" : ""}" data-ev-view="${k}">${l}</button>`)
        .join("")}</div></div>${
        list.length
          ? list
              .map((g) => {
                const r = recFor(g.claim);
                const what = g.claim.claimType === "torque" ? `${esc(C.torqueText(g.claim))} — ${esc(g.claim.application)}` : `${g.claim.assertion === "contraindicated" ? "Contraindicated" : "Compatible"} ${targetText(g.claim)}`;
                return `<div class="claim"><div class="claim-head"><div><b class="ref">${esc(g.claim.subject.manufacturer)} REF ${esc(g.claim.subject.articleNumber)}</b> ${r ? `<button class="linkish" data-record="${r.recordId}">open</button>` : ""}<div>${esc(g.claim.claimType)}: ${what}</div></div>${standingChip(g)}</div>${claimSourceHtml(g)}${
                  g.reasons.length ? `<div class="secondary">${esc(g.reasons.join("; "))}</div>` : ""
                }${claimActions(g)}</div>`;
              })
              .join("")
          : `<div class="empty">${graded.length ? "Nothing in this view." : "No evidence claims yet. Open any component, use <b>Find current IFU</b>, then <b>Record evidence from IFU</b>."}</div>`
      }${fullList.length > LIST_CAP ? `<div class="footnote">Showing ${LIST_CAP} of ${fullList.length}. Use the catalogue's evidence filter to browse the rest.</div>` : ""}</div>
<div class="panel mt"><div class="panel-head"><h2>Documents</h2></div>${ev.documents
        .map(
          (d) =>
            `<div class="list-row"><div><b>${d.sourceUrl ? `<a href="${esc(d.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(d.documentTitle)}</a>` : esc(d.documentTitle)}</b><div class="secondary">${esc(d.manufacturer)} · ${esc(d.sourceType)} · ${esc(d.revisionOrDate)} · ${esc(d.territory)} · retrieved ${esc(d.retrievedAt)} · ${d.origin === "curated" ? "curated" : "local"}</div></div><div class="btn-row"><span class="pill ${d.status === "current" ? "" : "neutral"}">${esc(d.status)}</span>${
              d.origin === "local" && d.status === "current" ? `<button class="btn small" data-doc-supersede="${esc(d.documentId)}">Mark superseded</button>` : ""
            }</div></div>`,
        )
        .join("")}</div>
<div class="dash-grid mt"><div class="panel"><h2>Settings</h2><div class="form-grid"><div class="field"><label for="staleDays">Re-verify after (days)</label><input id="staleDays" type="number" min="30" max="3650" value="${user.settings.staleDays}"></div><div class="field"><label for="territory">Default territory</label><input id="territory" value="${esc(user.settings.territory)}"></div></div><button class="btn mt" id="saveEvSettings">Save settings</button></div>
<div class="panel"><h2>Exchange</h2><p class="sub">Export your local evidence and your reviews of shipped claims (${Object.keys(user.evidence.reviews || {}).length} on this device). Reviews in an export can be imported into the app's shipped data (<code>scripts/import_reviews.py</code>), so every device then starts from them. A shipped review only applies while the claim's value, page and document revision are unchanged. You can also import a colleague's export here (merged by ID, never overwrites; their verifications arrive as pending).</p><div class="detail-actions"><button class="btn primary" id="exportEv">Export evidence &amp; reviews JSON</button></div><div class="field mt"><label for="evFile">Import evidence JSON</label><input type="file" id="evFile" accept=".json,application/json"></div><button class="btn mt" id="importEv">Validate and merge</button></div></div>`;
    $("#saveEvSettings").onclick = () => {
      const sd = Number($("#staleDays").value);
      if (!(sd >= 30 && sd <= 3650)) return toast("Re-verify window must be 30–3650 days");
      user.settings.staleDays = Math.round(sd);
      user.settings.territory = $("#territory").value.trim().slice(0, 10) || "GB";
      persist();
      toast("Settings saved");
      evidenceView();
    };
    $("#exportEv").onclick = () =>
      download(
        "implantref-evidence-" + today() + ".json",
        JSON.stringify({ application: "ImplantRef", registry: "evidence", schemaVersion: 1, exportedAt: new Date().toISOString(), documents: user.evidence.documents, claims: user.evidence.claims, reviews: user.evidence.reviews || {} }, null, 2),
        "application/json",
      );
    $("#importEv").onclick = () =>
      readJsonFile($("#evFile"), (d) => {
        if (d.application !== "ImplantRef" || d.registry !== "evidence" || !Array.isArray(d.claims) || !Array.isArray(d.documents)) throw new Error("Not an ImplantRef evidence file");
        const existingDocs = new Set(evidence().documents.map((x) => x.documentId));
        const existingClaims = new Set(evidence().claims.map((x) => x.claimId));
        const docs = d.documents.filter((x) => x && /^[\w.:-]{1,80}$/.test(x.documentId) && !existingDocs.has(x.documentId)).map(({ origin, ...x }) => x);
        const allDocs = Object.fromEntries([...evidence().documents, ...docs].map((x) => [x.documentId, x]));
        // Imported claims arrive as pending: verification does not transfer between people/devices.
        const claims = d.claims
          .filter((x) => x && /^[\w.:-]{1,80}$/.test(x.claimId) && !existingClaims.has(x.claimId))
          .map(({ origin, ...x }) => ({ ...x, verificationStatus: x.verificationStatus === "verified" ? "pending" : x.verificationStatus, importedReview: x.reviewedBy ? { by: x.reviewedBy, at: x.reviewedAt } : undefined, reviewedBy: undefined, reviewedAt: undefined, history: [...(x.history || []), { at: new Date().toISOString(), action: "imported (set to pending)" }] }))
          .filter((x) => C.claimProblems(x, allDocs).length === 0);
        const skipped = d.claims.length - claims.length;
        user.evidence.documents.push(...docs);
        user.evidence.claims.push(...claims);
        persist();
        toast(`Imported ${claims.length} claim(s) as pending${skipped ? `, skipped ${skipped} duplicate/invalid` : ""}`);
        evidenceView();
      });
  }

  /* ============================================================ data page */
  function dataPage() {
    const hasV2 = (() => {
      try {
        return !!localStorage.getItem(C.STORAGE_KEY_V2);
      } catch (e) {
        return false;
      }
    })();
    $("#screen").innerHTML =
      pageHead("Data management", "Dataset provenance, backups and local personal data.") +
      `<div class="notice"><b>Imported dataset:</b> ${esc(DATA.source?.file || "User-supplied catalogue")} · ${esc(DATA.source?.sheet || "Catalogue")} · ${esc(DATA.source?.rowRange || "")}. All ${fmtN(records.length)} component-context rows are retained. Records are not independently IFU-verified.</div>
<div class="dash-grid"><div class="panel"><h2>Export</h2><p class="sub">Full catalogue, or your personal data (saved, comparisons, notes, case lists, local evidence, settings).</p><div class="detail-actions"><button class="btn primary" id="exportUser">Export personal backup</button><button class="btn" id="exportJson">Full JSON dataset</button><button class="btn" id="exportAllCsv">All records as CSV</button>${hasV2 ? '<button class="btn" id="exportV2">Download retained 2.0 data</button>' : ""}</div></div>
<div class="panel"><h2>Import personal backup</h2><p class="sub">Accepts ImplantRef 2.0 and 3.0 personal backups. Replaces current personal data after confirmation.</p><div class="field mt"><label for="userBackup">JSON backup</label><input type="file" id="userBackup" accept=".json,application/json"></div><button class="btn mt" id="importUser">Validate and restore</button></div></div>
<div class="panel"><h2>Dataset quality and provenance</h2><div class="list-row"><span>Records retained</span><b>${fmtN(records.length)}</b></div><div class="list-row"><span>Unique article numbers — Straumann</span><b>${fmtN(summary.articleNumberContext.Straumann.uniqueArticleNumbers)}</b></div><div class="list-row"><span>Unique article numbers — Nobel Biocare</span><b>${fmtN(summary.articleNumberContext["Nobel Biocare"].uniqueArticleNumbers)}</b></div><div class="list-row"><span>REFs repeated across Straumann contexts</span><b>${summary.articleNumberContext.Straumann.articleNumbersRepeatedAcrossContexts}</b></div><div class="list-row"><span>REFs repeated across Nobel contexts</span><b>${summary.articleNumberContext["Nobel Biocare"].articleNumbersRepeatedAcrossContexts}</b></div><div class="list-row"><span>Label scanning: UDI/GTIN → REF table</span><b>${fmtN(Object.keys(window.IMPLANTREF_GTIN || {}).length)} GTINs · FDA GUDID</b></div><div class="list-row"><span>Curated evidence registry</span><b>v${esc(CURATED.registryVersion || "?")} · ${CURATED.documents?.length || 0} docs · ${CURATED.claims?.length || 0} claims</b></div></div>
<div class="panel mt"><h2>Local storage</h2><p class="sub">Personal data lives in this browser only (schema v${user.schemaVersion}${user.migratedFrom ? `, migrated from ${esc(user.migratedFrom)}` : ""}). ${hasV2 ? "Your ImplantRef 2.0 data is retained unchanged as a rollback copy." : ""} Export a backup to move devices.</p><div class="list-row"><span>Saved</span><b>${user.saved.length}</b></div><div class="list-row"><span>Case lists</span><b>${user.cases.length}</b></div><div class="list-row"><span>Notes</span><b>${Object.keys(user.notes).length}</b></div><div class="list-row"><span>Local evidence claims</span><b>${user.evidence.claims.length}</b></div><div class="detail-actions"><button class="btn danger" id="clearPersonal">Clear personal data…</button></div></div>`;
    $("#exportJson").onclick = () => download("implantref-full-dataset.json", JSON.stringify(DATA, null, 2), "application/json");
    $("#exportUser").onclick = () => download("implantref-personal-backup-" + today() + ".json", JSON.stringify({ application: "ImplantRef", version: APP_VERSION + "-personal", exportedAt: new Date().toISOString(), ...user }, null, 2), "application/json");
    $("#exportAllCsv").onclick = () => exportCsv(records, "implantref-all-catalogue-records.csv");
    $("#exportV2")?.addEventListener("click", () => download("implantref-v2-retained-state.json", localStorage.getItem(C.STORAGE_KEY_V2), "application/json"));
    $("#importUser").onclick = () =>
      readJsonFile($("#userBackup"), (d) => {
        const s = C.parsePersonalBackup(d);
        if (!confirm(`Replace current personal data with this backup?\n${s.saved.length} saved · ${s.cases.length} case lists · ${Object.keys(s.notes).length} notes · ${s.evidence.claims.length} evidence claims`)) return;
        Object.assign(user, s);
        persist();
        toast("Personal backup restored");
        dataPage();
      });
    $("#clearPersonal").onclick = () => {
      if (!confirm("Clear all saved records, comparisons, notes, case lists and local evidence? Export a backup first — this cannot be undone.")) return;
      Object.assign(user, C.emptyUserState());
      persist();
      toast("Personal data cleared");
      dataPage();
    };
  }

  /* ============================================================== utilities */
  function readJsonFile(input, onData) {
    const f = input.files[0];
    if (!f) return toast("Choose a file first");
    if (f.size > 20 * 1024 * 1024) return toast("File too large");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        onData(JSON.parse(reader.result));
      } catch (e) {
        toast("Import failed: " + e.message);
      }
    };
    reader.readAsText(f);
  }
  function download(name, text, type) {
    const u = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = u;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 1500);
    toast("Download started");
  }
  function exportCsv(arr, name) {
    const cols = ["recordId", "articleNumber", "component", "manufacturer", "implantSystem", "platform", "productFamily", "diameterMm", "lengthMm", "gingivaHeightMm", "abutmentHeightMm", "heightMm", "angulation", "material", "packSize", "cataloguePages", "dataStatus"];
    const dimKeys = new Set(["diameterMm", "lengthMm", "gingivaHeightMm", "abutmentHeightMm", "heightMm", "angulation"]);
    // Prefix cells that a spreadsheet would treat as formulas.
    const cell = (v) => {
      let s = String(v ?? "");
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const csv = [cols, ...arr.map((r) => cols.map((k) => (dimKeys.has(k) ? r.dimensions?.[k] : r[k])))].map((row) => row.map(cell).join(",")).join("\r\n");
    download(name, "﻿" + csv, "text/csv;charset=utf-8");
  }

  /* ================================================================= events */
  const moreMenu = $("#moreMenu");
  function closeMore() {
    moreMenu.classList.add("hidden");
    $("#moreTab").setAttribute("aria-expanded", "false");
  }
  $("#moreTab").addEventListener("click", (e) => {
    e.stopPropagation();
    const open = moreMenu.classList.contains("hidden");
    moreMenu.classList.toggle("hidden", !open);
    $("#moreTab").setAttribute("aria-expanded", String(open));
  });
  $("#scanBtn").onclick = () => startScan("lookup");
  $("#globalSearchBtn").onclick = () => {
    ui.query = "";
    if (ui.view === "catalogue") catalogue();
    else setView("catalogue");
    setTimeout(() => $("#q")?.focus(), 0);
  };
  $("#sheetBackdrop").addEventListener("click", () => closeSheet());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if ($(".modal")) return $(".modal").remove();
      if (!$("#sheet").classList.contains("hidden")) return closeSheet();
      closeMore();
    }
    if (e.key === "Enter" && e.target.matches?.(".data-row")) e.target.click();
    if (e.key === "/" && !e.target.closest("input,textarea,select") && $("#sheet").classList.contains("hidden")) {
      e.preventDefault();
      $("#globalSearchBtn").click();
    }
  });

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!t.closest("#moreMenu") && !t.closest("#moreTab")) closeMore();
    // Action buttons are checked BEFORE row clicks so "Remove" inside a row does not open the record.
    const act = (sel) => t.closest(sel);
    let el;
    if ((el = act("[data-unsave]"))) {
      user.saved = user.saved.filter((x) => x !== el.dataset.unsave);
      persist();
      return saved();
    }
    if ((el = act("[data-case-remove]"))) {
      const c = user.cases.find((x) => x.id === el.dataset.caseId);
      if (c) {
        c.items = c.items.filter((x) => x !== el.dataset.caseRemove);
        persist();
        openCase(c.id, false);
      }
      return;
    }
    if ((el = act("[data-remove-compare]"))) {
      user.compare = user.compare.filter((x) => x !== el.dataset.removeCompare);
      persist();
      return compare();
    }
    if ((el = act("[data-scan-start]"))) return startScan(el.dataset.scanStart);
    if ((el = act("[data-copy]"))) return copyText(el.dataset.copy);
    if ((el = act("[data-claim-act]"))) return claimAction(el.dataset.claim, el.dataset.claimAct);
    if ((el = act("[data-group-verify]"))) {
      const cl = evidence().claims.filter((c) => c.origin === "curated" && c.curationRuleId === el.dataset.groupVerify && c.verificationStatus === "pending");
      return cl.length && openVerifyDialog(cl);
    }
    if ((el = act("[data-group-flag]"))) {
      const cl = (CURATED.claims || []).filter((c) => c.curationRuleId === el.dataset.groupFlag);
      if (!confirm(`Mark all ${cl.length} claims from this statement as not matching the IFU? They will stop showing as awaiting review.`)) return;
      cl.forEach((c) => setReview(c.claimId, "contradicted"));
      persist();
      toast("Flagged " + cl.length + " claims");
      return evidenceView();
    }
    if ((el = act("[data-doc-supersede]"))) {
      const d = user.evidence.documents.find((x) => x.documentId === el.dataset.docSupersede);
      if (d && confirm("Mark this document superseded? Claims citing it will stop counting as current evidence.")) {
        d.status = "superseded";
        persist();
        evidenceView();
      }
      return;
    }
    if ((el = act("[data-goto-record]"))) return navigate(ui.view, el.dataset.gotoRecord, { replace: true });
    if ((el = act("[data-record]"))) return openRecord(el.dataset.record);
    if ((el = act("[data-view]"))) return setView(el.dataset.view);
    if ((el = act("[data-system-filter]"))) {
      const [m, s] = el.dataset.systemFilter.split("|||");
      Object.assign(ui, { manufacturer: m, system: s, family: "", platform: "", material: "", query: "", ctype: "", evidenceFilter: "" });
      return setView("catalogue");
    }
    if ((el = act("[data-wiz-system]"))) {
      const [m, s] = el.dataset.wizSystem.split("|||");
      Object.assign(ui.wiz, { manufacturer: m, system: s, platform: "", intent: "", confirmedOnly: false });
      return setView("identify");
    }
    if ((el = act("[data-wiz-set]"))) {
      ui.wiz[el.dataset.wizSet] = el.dataset.val;
      identify();
      return $("#screen").scrollIntoView({ block: "start" });
    }
    if ((el = act("[data-wiz-back]"))) {
      const keys = ["manufacturer", "system", "platform", "intent"];
      keys.slice(Number(el.dataset.wizBack)).forEach((k) => (ui.wiz[k] = ""));
      return identify();
    }
    if ((el = act("[data-wiz-ctx]"))) {
      const r = findRecord(el.dataset.wizCtx);
      Object.assign(ui.wiz, { manufacturer: r.manufacturer, system: r.implantSystem, platform: r.platform, intent: "" });
      return identify();
    }
    if ((el = act("[data-wiz-confirmed]"))) {
      ui.wiz.confirmedOnly = el.dataset.wizConfirmed === "1";
      return identify();
    }
    if ((el = act("[data-ev-view]"))) {
      ui.evView = el.dataset.evView;
      return evidenceView();
    }
    if ((el = act("[data-open-case]"))) return openCase(el.dataset.openCase);
  });
  window.addEventListener("hashchange", route);

  /* =================================================================== boot */
  $("#appVersion").textContent = APP_VERSION;
  // Builds without the scanner (e.g. the offline single-file suite) hide every scan entry point.
  if (!window.ImplantRefScan) document.documentElement.classList.add("no-scan");
  restore();
  route();
  // A host site can own offline caching (e.g. the Notile suite's site-wide worker) by setting <html data-sw="off">.
  if (document.documentElement.dataset.sw !== "off" && "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1"))
    navigator.serviceWorker.register("sw.js").catch(() => {});
})();
