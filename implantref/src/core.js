/*
 * ImplantRef core logic — pure functions, no DOM access.
 * Loaded in the browser as window.ImplantRefCore and in Node via require() for tests.
 *
 * Clinical rule set implemented here (see CLAUDE.md):
 *  - Catalogue association is NOT compatibility. With no linked evidence the answer is "not-established".
 *  - A claim only produces "manufacturer-confirmed" / "contraindicated" when it is verified, reviewed,
 *    fully sourced, product-specific (exact manufacturer + REF), not superseded and not stale.
 *  - Torque values are never inferred: only claims recorded against the exact REF are returned.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImplantRefCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STORAGE_KEY_V2 = "implantref_v2_user_state";
  const STORAGE_KEY_V3 = "implantref_v3_user_state";
  const USER_SCHEMA_VERSION = 3;
  const DEFAULT_STALE_DAYS = 365;
  const MAX_COMPARE = 4;

  /* ------------------------------------------------------------------ text */
  const normalize = (s) =>
    String(s ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]/g, "");

  /** REF normalisation: case/punctuation/space-insensitive ("046.415" == "046415" == "046 415"). */
  const normalizeRef = normalize;

  /* -------------------------------------------------------- component facets
   * Navigation aid derived from the workbook's product-family label and component name.
   * It is a browsing category, not a clinical classification or an indication. */
  const COMPONENT_TYPES = [
    { id: "healing", label: "Healing abutments & caps", intent: "Soft-tissue healing / emergence" },
    { id: "impression", label: "Impression (conventional)", intent: "Conventional impression or bite registration" },
    { id: "scanbody", label: "Scan bodies (digital)", intent: "Digital impression / intraoral scan" },
    { id: "analog", label: "Analogs", intent: "Laboratory model / analog" },
    { id: "temporary", label: "Temporary abutments", intent: "Provisional restoration" },
    { id: "tibase", label: "Ti-bases & CAD/CAM", intent: "Definitive CAD/CAM restoration on a base" },
    { id: "abutment", label: "Definitive abutments & copings", intent: "Definitive cemented or screw-retained crown" },
    { id: "mua", label: "Multi-unit / screw-retained abutments", intent: "Multi-unit or full-arch screw-retained" },
    { id: "baseconcept", label: "Base concepts (On1 / N1 Base)", intent: "Base-concept workflows" },
    { id: "attachment", label: "Attachments & bars", intent: "Overdenture attachment" },
    { id: "screw", label: "Screws", intent: "Prosthetic / abutment screws" },
    { id: "cover", label: "Cover screws & protective caps", intent: "Closure / protection" },
    { id: "instrument", label: "Instruments, tools & kits", intent: "Drivers, tools and retrieval" },
    { id: "lab", label: "Laboratory & planning aids", intent: "Lab work, planning, burn-out copings" },
    { id: "implant", label: "Implants", intent: "Implant fixtures (for identification)" },
    { id: "other", label: "Other", intent: "Uncategorised" },
  ];
  const TYPE_BY_ID = Object.fromEntries(COMPONENT_TYPES.map((t) => [t.id, t]));

  const FAMILY_TYPE = [
    [/^implants\b/i, "implant"],
    [/^healing (abutments|caps)/i, "healing"],
    [/closure caps|cover screws|protective caps/i, "cover"],
    [/^impression components|bite registration/i, "impression"],
    [/digital impression/i, "scanbody"],
    [/temporary abutments/i, "temporary"],
    [/variobase|universal base|purebase|pre-milled/i, "tibase"],
    [/on1|n1.*base/i, "baseconcept"],
    [/multi-unit|screw-retained abutments/i, "mua"],
    [/cementable|solid abutments|angled abutments|esthetic abutments|cares|gold|snappy/i, "abutment"],
    [/locator|novaloc|bar components/i, "attachment"],
    [/implant \/ abutment analogs/i, "analog"],
    [/^screws$/i, "screw"],
    [/instruments|retrieval|storage|sets \/ kits/i, "instrument"],
    [/laboratory|planning|burn-out/i, "lab"],
  ];

  /** Primary browsing category for a record. */
  function classifyComponent(r) {
    const name = String(r?.component || "");
    const fam = String(r?.productFamily || "");
    // Name-level overrides that cut across family labels.
    if (/insertion tool/i.test(name)) return "instrument";
    if (/replica|analog/i.test(name) && !/^implants/i.test(fam) && !/healing/i.test(fam)) return "analog";
    if (/scan\s*body|scanbody|scanpost/i.test(name)) return "scanbody";
    for (const [re, id] of FAMILY_TYPE) if (re.test(fam)) return id;
    return "other";
  }

  /** All browsing categories a record belongs to (primary first). e.g. IOS healing abutments → healing + scanbody. */
  function componentTypes(r) {
    const primary = classifyComponent(r);
    const out = [primary];
    const name = String(r?.component || "");
    if (primary === "healing" && /\bIOS\b/.test(name)) out.push("scanbody");
    return out;
  }

  /** True when a platform label is an abutment-level / system-wide context rather than an implant connection. */
  function isSecondaryPlatform(p) {
    return /^all platforms$|abutment level|multi-unit abutment level/i.test(String(p || ""));
  }

  /* ---------------------------------------------------------------- search */
  /** Records whose REF equals the query after normalisation (every context row, never deduplicated). */
  function exactRefMatches(records, query) {
    const q = normalizeRef(query);
    if (!q) return [];
    return records.filter((r) => normalizeRef(r.articleNumber) === q);
  }

  /* -------------------------------------------------------------- evidence */
  const SOURCE_TYPES = [
    "official-ifu",
    "ifu-portal",
    "technique-guide",
    "manufacturer-catalogue",
    "manufacturer-compatibility-chart",
    "secondary-publication",
    "user-supplied-spreadsheet",
  ];
  /** Only these source types can make a claim "manufacturer-confirmed" or "contraindicated". */
  const AUTHORITATIVE_SOURCE_TYPES = ["official-ifu", "technique-guide", "manufacturer-compatibility-chart"];
  const VERIFICATION_STATUSES = ["draft", "pending", "verified", "contradicted", "superseded"];
  const CLAIM_TYPES = ["compatibility", "torque"];
  const COMPAT_ASSERTIONS = ["compatible", "contraindicated"];

  const COMPAT_STATUS = {
    "manufacturer-confirmed": { label: "Manufacturer-confirmed", tone: "ok" },
    contraindicated: { label: "Explicitly contraindicated", tone: "danger" },
    contradictory: { label: "Contradictory sources", tone: "danger" },
    pending: { label: "Pending verification", tone: "flag" },
    "not-established": { label: "Not established", tone: "neutral" },
  };

  const REQUIRED_SOURCE_FIELDS = ["sourceUrl", "sourceType", "documentTitle", "revisionOrDate", "retrievedAt"];
  const REQUIRED_CLAIM_FIELDS = ["pageOrSection", "specificProductRef", "verificationStatus"];

  function daysBetween(aIso, now) {
    const t = Date.parse(aIso);
    if (Number.isNaN(t)) return Infinity;
    return (now - t) / 86400000;
  }

  /** Merge a claim with its document so every provenance field can be checked in one place. */
  function withSource(claim, docsById) {
    const doc = docsById[claim.documentId] || {};
    return {
      ...claim,
      sourceUrl: claim.sourceUrl || doc.sourceUrl || "",
      sourceType: claim.sourceType || doc.sourceType || "",
      documentTitle: claim.documentTitle || doc.documentTitle || "",
      revisionOrDate: claim.revisionOrDate || doc.revisionOrDate || "",
      retrievedAt: claim.retrievedAt || doc.retrievedAt || "",
      territory: claim.territory || doc.territory || "",
      documentStatus: doc.status || "current",
      document: doc,
    };
  }

  /** Structural problems with a claim (empty array = structurally complete). Not a clinical check. */
  function claimProblems(claim, docsById = {}) {
    const c = withSource(claim, docsById);
    const p = [];
    if (!CLAIM_TYPES.includes(c.claimType)) p.push("unknown claimType");
    if (!c.subject || !c.subject.manufacturer || !c.subject.articleNumber) p.push("subject manufacturer + articleNumber required");
    for (const f of REQUIRED_SOURCE_FIELDS) if (!c[f]) p.push("missing " + f);
    for (const f of REQUIRED_CLAIM_FIELDS) if (!c[f]) p.push("missing " + f);
    if (c.sourceType && !SOURCE_TYPES.includes(c.sourceType)) p.push("unknown sourceType");
    if (c.verificationStatus && !VERIFICATION_STATUSES.includes(c.verificationStatus)) p.push("unknown verificationStatus");
    if (c.specificProductRef && c.subject && normalizeRef(c.specificProductRef) !== normalizeRef(c.subject.articleNumber))
      p.push("specificProductRef does not match subject REF");
    if (c.sourceUrl && !/^https:\/\//i.test(c.sourceUrl)) p.push("sourceUrl must be https");
    if (c.verificationStatus === "verified" && !c.reviewedBy) p.push("verified claims need reviewedBy");
    if (c.verificationStatus === "verified" && !c.reviewedAt) p.push("verified claims need reviewedAt");
    if (c.claimType === "compatibility") {
      if (!COMPAT_ASSERTIONS.includes(c.assertion)) p.push("compatibility assertion must be compatible|contraindicated");
      const t = c.target || {};
      if (!t.articleNumber && !t.implantSystem) p.push("compatibility target needs articleNumber or implantSystem");
    }
    if (c.claimType === "torque") {
      const isRange = c.minNcm !== undefined && c.minNcm !== null && c.handTight !== true;
      if (isRange) {
        const lo = Number(c.minNcm), hi = Number(c.maxNcm);
        if (!(lo > 0 && hi <= 100 && lo < hi)) p.push("torque range must satisfy 0 < minNcm < maxNcm <= 100");
        if (c.valueNcm !== undefined && c.valueNcm !== null) p.push("range claims must not carry valueNcm");
      } else if (c.handTight === true) {
        if (c.valueNcm !== undefined && c.valueNcm !== null) p.push("hand-tight claims must not carry valueNcm");
        if (c.maxNcm !== undefined && c.maxNcm !== null && !(Number(c.maxNcm) > 0 && Number(c.maxNcm) <= 100)) p.push("maxNcm must be a number in (0, 100]");
      } else {
        const v = Number(c.valueNcm);
        if (c.valueNcm === null || c.valueNcm === undefined || c.valueNcm === "" || !Number.isFinite(v) || v <= 0 || v > 100)
          p.push("torque valueNcm must be a number in (0, 100]");
      }
      if (!c.application) p.push("torque application required (e.g. abutment screw to implant)");
    }
    return p;
  }

  /** Does a claim's subject/scope apply to this specific catalogue context row? */
  function claimAppliesTo(claim, r) {
    const s = claim.subject || {};
    if (s.manufacturer !== r.manufacturer) return false;
    if (normalizeRef(s.articleNumber) !== normalizeRef(r.articleNumber)) return false;
    const scope = claim.scope || {};
    if (scope.implantSystem && scope.implantSystem !== r.implantSystem) return false;
    if (scope.platform && scope.platform !== r.platform) return false;
    return true;
  }

  /**
   * Classify a single claim's standing today.
   * Returns { effective: boolean, standing, reasons[] } where standing is one of
   * "effective" | "stale" | "unverified" | "incomplete" | "non-authoritative" | "superseded" | "contradicted".
   */
  function claimStanding(claim, docsById = {}, opts = {}) {
    const now = opts.now ?? Date.now();
    const staleDays = opts.staleDays ?? DEFAULT_STALE_DAYS;
    const c = withSource(claim, docsById);
    const reasons = [];
    const problems = claimProblems(claim, docsById);
    if (problems.length) return { effective: false, standing: "incomplete", reasons: problems };
    if (c.verificationStatus === "superseded" || c.documentStatus === "superseded" || c.documentStatus === "withdrawn")
      return { effective: false, standing: "superseded", reasons: ["claim or document superseded/withdrawn"] };
    if (c.verificationStatus === "contradicted")
      return { effective: false, standing: "contradicted", reasons: ["marked contradicted by reviewer"] };
    if (c.verificationStatus !== "verified")
      return { effective: false, standing: "unverified", reasons: ["status: " + c.verificationStatus] };
    if (!AUTHORITATIVE_SOURCE_TYPES.includes(c.sourceType))
      return { effective: false, standing: "non-authoritative", reasons: ["source type " + c.sourceType + " cannot confirm a clinical claim"] };
    const age = daysBetween(c.retrievedAt, now);
    if (age > staleDays) {
      reasons.push(`source retrieved ${Math.floor(age)} days ago (limit ${staleDays})`);
      return { effective: false, standing: "stale", reasons };
    }
    return { effective: true, standing: "effective", reasons };
  }

  /** Does a compatibility claim's target match a requested target (another REF context, or a system/platform)? */
  function targetMatches(claimTarget = {}, want = {}) {
    if (want.articleNumber) {
      if (!claimTarget.articleNumber) return false;
      if (normalizeRef(claimTarget.articleNumber) !== normalizeRef(want.articleNumber)) return false;
      if (claimTarget.manufacturer && want.manufacturer && claimTarget.manufacturer !== want.manufacturer) return false;
      return true;
    }
    if (want.implantSystem) {
      if (claimTarget.articleNumber) return false;
      if (claimTarget.implantSystem !== want.implantSystem) return false;
      if (want.platform && claimTarget.platform && claimTarget.platform !== want.platform) return false;
      if (want.platform && !claimTarget.platform) return true; // system-wide statement covers platforms
      return true;
    }
    return true;
  }

  /**
   * Resolve evidence-aware compatibility for a record (optionally against a specific target).
   * Default is "not-established". Never derived from shared platform labels or manufacturer.
   */
  function resolveCompatibility(record, evidence, want = null, opts = {}) {
    const docsById = indexDocs(evidence);
    const claims = (evidence?.claims || []).filter(
      (c) => c.claimType === "compatibility" && claimAppliesTo(c, record) && (!want || targetMatches(c.target, want)),
    );
    const graded = claims.map((c) => ({ claim: c, ...claimStanding(c, docsById, opts), source: withSource(c, docsById) }));
    const eff = graded.filter((g) => g.effective);
    const yes = eff.filter((g) => g.claim.assertion === "compatible");
    const no = eff.filter((g) => g.claim.assertion === "contraindicated");
    let status = "not-established";
    if (yes.length && no.length) status = "contradictory";
    else if (no.length) status = "contraindicated";
    else if (yes.length) status = "manufacturer-confirmed";
    else if (graded.length) status = "pending";
    return { status, ...COMPAT_STATUS[status], claims: graded };
  }

  /**
   * Torque evidence for the exact REF context. Returns verified values and pending ones separately.
   * Conflicting effective values for the same application are flagged and none is presented as "the" value.
   */
  function resolveTorque(record, evidence, opts = {}) {
    const docsById = indexDocs(evidence);
    const graded = (evidence?.claims || [])
      .filter((c) => c.claimType === "torque" && claimAppliesTo(c, record))
      .map((c) => ({ claim: c, ...claimStanding(c, docsById, opts), source: withSource(c, docsById) }));
    const effective = graded.filter((g) => g.effective);
    const byApp = {};
    for (const g of effective) (byApp[normalize(g.claim.application)] ??= []).push(g);
    const conflicts = Object.values(byApp)
      .filter((arr) => new Set(arr.map((g) => torqueKey(g.claim))).size > 1)
      .map((arr) => arr[0].claim.application);
    return {
      verified: effective.filter((g) => !conflicts.includes(g.claim.application)),
      conflicts,
      conflicting: effective.filter((g) => conflicts.includes(g.claim.application)),
      notEffective: graded.filter((g) => !g.effective),
      all: graded,
    };
  }

  function indexDocs(evidence) {
    return Object.fromEntries((evidence?.documents || []).map((d) => [d.documentId, d]));
  }

  /** Comparable value of a torque claim ("hand" for hand-tight). */
  function torqueKey(c) {
    if (c.handTight === true) return "hand" + (c.maxNcm ? "<=" + Number(c.maxNcm) : "");
    if (c.minNcm !== undefined && c.minNcm !== null) return Number(c.minNcm) + "-" + Number(c.maxNcm);
    return Number(c.valueNcm);
  }

  /** Human-readable torque, e.g. "35 Ncm" or "Hand-tight (max 15 Ncm)". */
  function torqueText(c) {
    if (c.handTight === true) return "Hand-tight" + (c.maxNcm ? ` (never exceed ${c.maxNcm} Ncm)` : "");
    if (c.minNcm !== undefined && c.minNcm !== null) return `${c.minNcm}–${c.maxNcm} Ncm`;
    return c.valueNcm + " Ncm";
  }

  /** Applications where not-yet-effective (pending) claims for this record disagree with each other. */
  function pendingDisagreements(torqueResult) {
    const byApp = {};
    for (const g of torqueResult.notEffective.filter((x) => x.standing === "unverified")) (byApp[normalize(g.claim.application)] ??= []).push(g);
    return Object.values(byApp)
      .filter((arr) => new Set(arr.map((g) => torqueKey(g.claim))).size > 1)
      .map((arr) => arr[0].claim.application);
  }

  /**
   * Combine curated (shipped) and local (user-entered) evidence, tagging origin.
   * local.reviews is an on-device review overlay for curated claims: { [claimId]: {verificationStatus, reviewedBy, reviewedAt, history} }.
   * The shipped registry is never modified; the overlay records this device's reviewer decisions.
   */
  function mergeEvidence(curated, local) {
    const tag = (arr, origin) => (arr || []).map((x) => ({ ...x, origin: x.origin || origin }));
    const reviews = (local && local.reviews) || {};
    const curatedClaims = tag(curated?.claims, "curated").map((c) => {
      const r = reviews[c.claimId];
      if (!r || !VERIFICATION_STATUSES.includes(r.verificationStatus)) return c;
      const out = { ...c, verificationStatus: r.verificationStatus, reviewOrigin: "local", shippedStatus: c.verificationStatus };
      if (r.verificationStatus === "verified") Object.assign(out, { reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt });
      else {
        delete out.reviewedBy;
        delete out.reviewedAt;
      }
      return out;
    });
    return {
      documents: [...tag(curated?.documents, "curated"), ...tag(local?.documents, "local")],
      claims: [...curatedClaims, ...tag(local?.claims, "local")],
    };
  }

  /** Manufacturer IFU portal search link for a REF. This is a search, not a verified document. */
  function ifuPortalUrl(manufacturer, ref) {
    if (manufacturer === "Nobel Biocare") return "https://ifu.nobelbiocare.com/en?sku=" + encodeURIComponent(String(ref || "").trim());
    if (manufacturer === "Straumann") return "https://ifu.straumann.com/";
    return "";
  }

  /* ------------------------------------------------- privacy / identifiers
   * Heuristic guard for case-list references and notes. It blocks obvious identifiers;
   * it cannot prove text is non-identifiable. */
  function detectIdentifiers(text) {
    const s = String(text || "");
    const hits = [];
    const digits = s.replace(/[\s-]/g, "");
    if (/\b\d{3}[\s-]?\d{3}[\s-]?\d{4}\b/.test(s) || /\d{10}/.test(digits)) hits.push("10-digit number (possible NHS/CHI number)");
    if (/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-](\d{2}|\d{4})\b/.test(s)) hits.push("date (possible date of birth)");
    if (/\b(dob|d\.o\.b|date of birth|born)\b/i.test(s)) hits.push("date-of-birth wording");
    if (/\b(nhs|chi|mrn|hospital)\s*(no|number|#)?\b/i.test(s)) hits.push("health identifier wording");
    if (/\b(?:[Mm](?:rs|r|s|iss|x|aster)|[Dd]r|MR|MRS|MS|MISS|DR)\.?\s+[A-Z][a-z]+/.test(s)) hits.push("title followed by a name");
    if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(s)) hits.push("email address");
    if (/\b(\+44|0)7\d{3}\s?\d{6}\b/.test(s)) hits.push("phone number");
    if (/\b[A-Z]\d{6,8}\b|\b[A-Z]{1,3}\d{6,9}\b/.test(s)) hits.push("hospital-number-like code");
    if (/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/.test(s)) hits.push("postcode");
    return hits;
  }

  /* ------------------------------------------------------------- user state */
  function emptyUserState() {
    return {
      schemaVersion: USER_SCHEMA_VERSION,
      saved: [],
      compare: [],
      cases: [],
      notes: {},
      recent: [],
      evidence: { documents: [], claims: [], reviews: {} },
      settings: { staleDays: DEFAULT_STALE_DAYS, territory: "GB" },
      migratedFrom: null,
    };
  }

  const isStr = (x) => typeof x === "string";
  const safeId = (x) => isStr(x) && /^[A-Za-z0-9_.:-]{1,80}$/.test(x);

  /**
   * Normalise any known user-state shape (v2 localStorage, v2/v3 personal backup) into v3.
   * Unknown record IDs are KEPT (not silently dropped) in saved/cases so nothing is lost if a
   * future catalogue omits them; the UI simply cannot resolve them. Compare is trimmed to 4.
   */
  function migrateUserState(raw) {
    const out = emptyUserState();
    if (!raw || typeof raw !== "object") return out;
    const ids = (a) => (Array.isArray(a) ? [...new Set(a.filter(safeId))] : []);
    out.saved = ids(raw.saved);
    out.compare = ids(raw.compare).slice(0, MAX_COMPARE);
    out.recent = ids(raw.recent).slice(0, 10);
    if (raw.notes && typeof raw.notes === "object" && !Array.isArray(raw.notes))
      for (const [k, v] of Object.entries(raw.notes)) if (safeId(k) && isStr(v)) out.notes[k] = v.slice(0, 4000);
    if (Array.isArray(raw.cases))
      out.cases = raw.cases
        .filter((c) => c && typeof c === "object")
        .map((c, i) => ({
          id: safeId(c.id) ? c.id : "case-imported-" + i + "-" + Date.now(),
          ref: isStr(c.ref) ? c.ref.slice(0, 60) : "Imported list " + (i + 1),
          manufacturer: isStr(c.manufacturer) ? c.manufacturer : "",
          system: isStr(c.system) ? c.system : "",
          items: ids(c.items),
          createdAt: isStr(c.createdAt) ? c.createdAt : new Date().toISOString(),
        }));
    if (raw.evidence && typeof raw.evidence === "object") {
      out.evidence.documents = Array.isArray(raw.evidence.documents) ? raw.evidence.documents.filter((d) => d && safeId(d.documentId)) : [];
      out.evidence.claims = Array.isArray(raw.evidence.claims) ? raw.evidence.claims.filter((c) => c && safeId(c.claimId)) : [];
      if (raw.evidence.reviews && typeof raw.evidence.reviews === "object" && !Array.isArray(raw.evidence.reviews))
        for (const [k, v] of Object.entries(raw.evidence.reviews))
          if (safeId(k) && v && VERIFICATION_STATUSES.includes(v.verificationStatus))
            out.evidence.reviews[k] = {
              verificationStatus: v.verificationStatus,
              reviewedBy: isStr(v.reviewedBy) ? v.reviewedBy.slice(0, 60) : undefined,
              reviewedAt: isStr(v.reviewedAt) ? v.reviewedAt.slice(0, 10) : undefined,
              history: Array.isArray(v.history) ? v.history.slice(-50) : [],
            };
    }
    if (raw.settings && typeof raw.settings === "object") {
      const sd = Number(raw.settings.staleDays);
      if (Number.isFinite(sd) && sd >= 30 && sd <= 3650) out.settings.staleDays = Math.round(sd);
      if (isStr(raw.settings.territory)) out.settings.territory = raw.settings.territory.slice(0, 10);
    }
    out.migratedFrom = raw.schemaVersion === USER_SCHEMA_VERSION ? raw.migratedFrom || null : raw.schemaVersion ? "v" + raw.schemaVersion : "v2";
    return out;
  }

  /** Validate a personal backup file (v2 "2.0-personal" or v3 "3.0-personal"). Throws on invalid. */
  function parsePersonalBackup(obj) {
    if (!obj || obj.application !== "ImplantRef") throw new Error("Not an ImplantRef personal backup");
    if (!Array.isArray(obj.saved) || !Array.isArray(obj.cases)) throw new Error("Backup is missing saved/cases arrays");
    return migrateUserState(obj);
  }

  function uid(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  return {
    STORAGE_KEY_V2,
    STORAGE_KEY_V3,
    USER_SCHEMA_VERSION,
    DEFAULT_STALE_DAYS,
    MAX_COMPARE,
    COMPONENT_TYPES,
    TYPE_BY_ID,
    SOURCE_TYPES,
    AUTHORITATIVE_SOURCE_TYPES,
    VERIFICATION_STATUSES,
    COMPAT_STATUS,
    normalize,
    normalizeRef,
    classifyComponent,
    componentTypes,
    isSecondaryPlatform,
    exactRefMatches,
    withSource,
    claimProblems,
    claimAppliesTo,
    claimStanding,
    resolveCompatibility,
    resolveTorque,
    mergeEvidence,
    torqueKey,
    torqueText,
    pendingDisagreements,
    ifuPortalUrl,
    detectIdentifiers,
    emptyUserState,
    migrateUserState,
    parsePersonalBackup,
    uid,
  };
});
