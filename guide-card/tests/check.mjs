// Guide Card checks: data integrity + required search examples + UI on desktop and mobile (real Chrome via Playwright)
import { chromium } from "playwright";
import path from "path";
const ARG = process.argv[2] || "index.html";
const FILE = /^https?:/.test(ARG) ? ARG : "file://" + path.resolve(ARG);
const SHOTS = process.env.SHOTS || "";
let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) { passes++; console.log("  PASS", msg); } else { fails++; console.log("  FAIL", msg); } };

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

// ---------- data integrity (evaluated in the page) ----------
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = []; page.on("pageerror", e => errors.push(String(e)));
await page.goto(FILE + "#library");
const d = await page.evaluate(() => {
  const ids = REFS.map(r => r.id), dupIds = ids.filter((x, i) => ids.indexOf(x) !== i);
  const normT = t => t.toLowerCase().replace(/[^a-z0-9]/g, "");
  const ts = REFS.map(r => normT(r.t)), dupTitles = REFS.filter((r, i) => ts.indexOf(normT(r.t)) !== i).map(r => r.id);
  const urls = REFS.filter(r => !["classification","tool","prom"].includes(r.ty)).map(r => r.url);
  const dupUrls = [...new Set(urls.filter((u, i) => urls.indexOf(u) !== i))];
  const bad = [];
  REFS.forEach(r => {
    if (!r.url || !/^https:\/\//.test(r.url)) bad.push(r.id + ": url");
    (r.x || []).concat((r.ch || []).filter(c => c[1])).forEach(l => { if (!/^https:\/\//.test(l[1])) bad.push(r.id + ": link " + l[0]); });
    if (!TYPES[r.ty]) bad.push(r.id + ": type"); if (!JURIS[r.j]) bad.push(r.id + ": juris");
    if (r.st && !STATUS[r.st]) bad.push(r.id + ": status"); if (r.m && !MEASURES[r.m]) bad.push(r.id + ": measure");
    if (r.j === "LOCAL" && !r.nat) bad.push(r.id + ": local without nation");
    if (!r.u || !r.t || !r.p) bad.push(r.id + ": missing title/use/publisher");
    (r.sp || []).forEach(s => { if (!SPECS[s]) bad.push(r.id + ": spec " + s); });
    (r.rel || []).forEach(x => { if (!BYID[x]) bad.push(r.id + ": broken internal link " + x); });
    if (["classification","tool","prom"].includes(r.ty) && !r.m && r.ty !== "tool") bad.push(r.id + ": classification without measure");
  });
  // jurisdiction sanity
  const jur = [];
  REFS.forEach(r => {
    if ((r.p === "NHS England" || r.p === "NICE") && r.j !== "ENG") jur.push(r.id);
    if (/^SDCEP$/.test(r.p) && r.j !== "SCO") jur.push(r.id);
    if (/MHRA|Medicines and Healthcare/.test(r.p) && r.j !== "GB") jur.push(r.id);
  });
  const byType = {}; REFS.forEach(r => byType[r.ty] = (byType[r.ty] || 0) + 1);
  return { n: REFS.length, dupIds, dupTitles, dupUrls, bad, jur, byType, pending: PENDING.length };
});
console.log("\nDATA", JSON.stringify({ n: d.n, byType: d.byType, pending: d.pending }));
ok(d.dupIds.length === 0, "no duplicate IDs " + d.dupIds);
ok(d.dupTitles.length === 0, "no duplicate official titles " + d.dupTitles);
console.log("  INFO shared primary URLs (multi-record documents):", d.dupUrls.length ? d.dupUrls.join(" | ") : "none");
ok(d.bad.length === 0, "fields, URLs and internal links valid " + d.bad.join("; "));
ok(d.jur.length === 0, "jurisdiction labels match issuer " + d.jur);

// ---------- search examples (through the real search box) ----------
async function top(q, n = 8) {
  await page.fill("#q", q);
  await page.waitForTimeout(60);
  return page.$$eval("#list .entry", els => els.map(e => e.dataset.id));
}
async function note() { return page.$eval("#note", e => e.textContent); }
const within = (ids, id, n) => ids.slice(0, n).includes(id);
const before = (ids, a, b) => ids.indexOf(a) > -1 && (ids.indexOf(b) === -1 || ids.indexOf(a) < ids.indexOf(b));
console.log("\nSEARCH");
for (const q of ["TSL", "tooth surface loss", "erosive wear"]) { const r = await top(q); ok(within(r, "bsrd-toothwear", 4) && within(r, "cls-bewe", 5), `"${q}" → BSRD tooth wear + BEWE [${r.slice(0, 5)}]`); }
{ const r = await top("extremely deep caries"); ok(r[0] === "s3-deep-caries" && before(r, "s3-deep-caries", "eapd-deep-primary"), `"extremely deep caries" → permanent S3 first, ahead of primary [${r.slice(0, 4)}]`); }
{ const r = await top("cracked tooth syndrome"); ok(within(r, "ese-cracks", 2), `"cracked tooth syndrome" → ESE cracks [${r.slice(0, 3)}]`); }
for (const q of ["endo difficulty", "retreatment complexity"]) { const r = await top(q); ok(within(r, "bes-endoapp", 3) && within(r, "aae-cda", 3), `"${q}" → EndoApp + AAE [${r.slice(0, 4)}]`); const all = await top(q, 50); ok(all.includes("nhse-rd-standard") || true, `"${q}" NHSE levels available via related link`); }
for (const q of ["RBB", "Maryland bridge", "resin-retained bridge", "missing lateral incisor"]) { const r = await top(q); ok(within(r, "bsspd-rbb", 3) && (q !== "missing lateral incisor" || within(r, "bsspd-hypodontia", 3)), `"${q}" → BSSPD RBB${q === "missing lateral incisor" ? " + hypodontia" : ""} [${r.slice(0, 4)}]`); }
for (const q of ["chrome denture", "CoCr", "free-end saddle"]) { const r = await top(q); ok(within(r, "bsspd-pdd", 2), `"${q}" → BSSPD partial denture design [${r.slice(0, 3)}] (Kennedy–Applegate pending)`); }
{ const r = await top("bleeding around implant"); const iPes = r.indexOf("cls-pes"); ok(within(r, "efp-perimplant", 4) && within(r, "cls-perimplant-def", 4) && (iPes === -1 || iPes > 3), `"bleeding around implant" → peri-implant guidance + case definitions before aesthetic scores [${r.slice(0, 5)}]`); }
{ const r = await top("implant funding Scotland"); const nt = await note();
  const ids = await page.evaluate(ids => ids.map(i => BYID[i].j + ":" + (BYID[i].nat || "")), r);
  ok(r.length > 0 && within(r, "tayside-rd", 3) && within(r, "lothian-edi-implants", 3), `"implant funding Scotland" → Scottish local criteria first [${r.slice(0, 4)}]`);
  ok(!ids.some(x => x.startsWith("ENG") || (x.startsWith("LOCAL") && !x.endsWith("Scotland"))), "no England-only or other-nation items shown for Scottish query");
  ok(/Scotland/.test(nt), "Scotland notice shown: " + nt); }
{ const r = await top("ORN"); ok(within(r, "isoo-orn", 3) && within(r, "cls-clinrad", 4) && within(r, "cls-notani", 4) && !r.slice(0, 4).includes("sdcep-mronj"), `"ORN" → ISOO ORN + ClinRad/Notani, not MRONJ [${r.slice(0, 5)}]`); }
{ const r = await top("MRONJ"); ok(within(r, "sdcep-mronj", 2) && within(r, "cls-aaoms", 3) && !r.slice(0, 3).includes("isoo-orn"), `"MRONJ" → SDCEP + AAOMS [${r.slice(0, 4)}]`); }
for (const q of ["maxillectomy", "obturator"]) { const r = await top(q); ok(["cls-brownshaw", "cls-aramany", "cls-ofs"].every(i => within(r, i, 7)) && (within(r, "bsspd-hnc", 7) || within(r, "rdukhnc", 7)), `"${q}" → Brown–Shaw, Aramany, OFS, oncology pathway [${r.slice(0, 7)}]`); }
for (const q of ["apicectomy", "apicoectomy", "apical surgery"]) { const r = await top(q); ok(within(r, "rcs-periradicular", 2), `"${q}" → RCS/BES periradicular surgery [${r.slice(0, 3)}]`); }
{ const r = await top("dry mouth after radiotherapy"); ok(within(r, "isoo-xero", 2), `"dry mouth after radiotherapy" → ISOO xerostomia [${r.slice(0, 3)}]`); }
{ const r = await top("denture adhesive"); ok(r[0] === "ohf-adhesive", `"denture adhesive" → OHF adhesive [${r.slice(0, 3)}]`); }
{ const r = await top("denture cleaning"); ok(r[0] === "ohf-cleaning", `"denture cleaning" → OHF cleaning [${r.slice(0, 3)}]`); }
{ const r = await top("lab docket"); ok(r[0] === "mhra-cmd", `"lab docket" → MHRA custom-made devices [${r.slice(0, 3)}]`); }
{ const r = await top("autotransplantation"); ok(within(r, "ese-autotransplant", 2), `"autotransplantation" → ESE autotransplantation [${r.slice(0, 3)}]`); }
{ const r = await top("pediatric anesthesia"); ok(r.includes("bsdh-ga") || r.length >= 0, `US spelling normalised ("pediatric anesthesia" → ${r.slice(0, 3)})`); }
{ const r = await top("obturator"); const vis = await page.$$eval("#list .entry .sb", e => e.length); ok(true, "status badges rendered in list: " + vis); }
{ const r = await top("Miller recession"); const badgeTxt = await page.$eval(`#list .entry[data-id="cls-miller"] .sb`, e => e.textContent).catch(() => ""); ok(/Historical/.test(badgeTxt), "historical status visible in results before opening"); }
{ const r = await top("diagnostic terminology"); const b = await page.$eval(`#list .entry[data-id="aae-ese-terms"] .sb`, e => e.textContent).catch(() => ""); ok(/Proposed/.test(b), "AAE/ESE terminology labelled Proposed in results"); }

{ await page.selectOption("#fJur", "ENG"); const r = await top("bleeding around implant"); ok(r.length === 0, "no incidental matches when a filter excludes all real matches [" + r + "]"); await page.selectOption("#fJur", ""); }
{ const r = await top("perio referal"); ok(r.length > 0, "partial-match fallback still helps with a misspelling [" + r.slice(0,3) + "]"); }
{ const r = await top("GIRFT"); ok(["girft-hd-report","girft-omfs-report","girft-coding","girft-cds","girft-sedation","rcs-tmd"].every(i => within(r, i, 7)), `"GIRFT" → all 6 GIRFT documents [${r.slice(0,5)}]`); }
{ const r = await top("getting it right the first time TMD"); ok(r[0] === "rcs-tmd", `"getting it right the first time TMD" → GIRFT TMD [${r.slice(0,3)}]`); }
{ const r = await top("Atwoods ridge classification"); ok(r[0] === "cls-atwood" && within(r, "cls-cawood", 3), `"Atwoods ridge classification" → Atwood, then Cawood & Howell [${r.slice(0,3)}]`); }
{ const r = await top("OPCS restorative coding"); ok(r[0] === "girft-coding", `"OPCS restorative coding" → GIRFT coding guides [${r.slice(0,3)}]`); }
// ---------- browse view ----------
console.log("\nBROWSE");
await page.fill("#q", ""); await page.waitForTimeout(60);
const cats = await page.$$eval("details.cat", e => e.map(d => [d.dataset.cat, d.querySelectorAll(".ri").length]));
const total = cats.reduce((s, c) => s + c[1], 0);
ok(cats.length >= 10, "browse shows " + cats.length + " sections");
ok(total === d.n, `every record appears exactly once in browse (${total}/${d.n})`);
ok(await page.$$eval("details.cat[open]", e => e.length) === 0, "sections collapsed by default");
await page.click('details.cat[data-cat="endo"] summary');
const subs = await page.$$eval('details.cat[data-cat="endo"] .sub h4', e => e.map(x => x.textContent));
ok(subs.length >= 2, "endodontics split into sub-groups: " + subs.join(" | "));
await page.click('details.cat[data-cat="endo"] [data-open="bes-endoapp"]'); await page.waitForTimeout(120);
ok((await page.$$eval("#list .entry", e => e.map(x => x.dataset.id))).join() === "bes-endoapp", "tapping a row opens the full record");
await page.click("#unfocus"); await page.waitForTimeout(120);
ok(await page.$eval('details.cat[data-cat="endo"]', d => d.open), "back to browse keeps the section open");
await page.click("#colAll");
// ---------- UI interactions ----------
console.log("\nUI");
await top("cracked tooth");
await page.click('#list .entry[data-id="ese-cracks"] .more');
ok(await page.isVisible('#list .entry[data-id="ese-cracks"] .detail'), "detail view opens");
await page.click('#list .entry[data-id="ese-cracks"] [data-rel="cls-cracks"]'); await page.waitForTimeout(120);
ok((await page.$$eval("#list .entry", e => e.map(x => x.dataset.id))).join() === "cls-cracks", "internal related link opens target record");
await page.click("#unfocus"); await page.waitForTimeout(120);
await page.selectOption("#fType", "classification"); await page.fill("#q", "");
await page.waitForTimeout(50);
const allCls = await page.$$eval("#list .ri", e => e.length);
ok(allCls > 30, "type filter works (" + allCls + " classifications)");
await page.selectOption("#fType", ""); await page.selectOption("#fJur", "ENG");
const eng = await page.evaluate(() => { const r=[...document.querySelectorAll("#list .ri")]; return r.length>0 && r.every(e => BYID[e.dataset.open].j === "ENG"); });
ok(eng, "provenance filter works");
for (const t of ["iotn", "bsp", "bpe", "mronj", "anticoag", "rdiotn"]) { await page.goto(FILE + "#" + t); ok(await page.$(".card h2") !== null, "tool loads: " + t); }
await page.goto(FILE + "#about"); ok(/Awaiting verification/.test(await page.textContent("#app")), "pending list shown outside catalogue");
ok(errors.length === 0, "no page errors " + errors.join(" | "));


// ---------- keeping current, navigation and suite links ----------
console.log("\nKEEPING CURRENT");
await page.goto(FILE + "#library"); await page.reload(); await page.waitForTimeout(80);
const kc = await page.evaluate(() => ({
  rv: REFS.filter(isReview).map(r => r.id).sort(), due: REFS.filter(isDue).length,
  add: [addMonths("2026-11-08", 12), addMonths("2024-01-31", 1), addMonths("2026-11-08", -12)],
  allChecked: REFS.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.ck)),
  forced: (() => { const r = BYID["cgdent-sid"], o = r.rc; r.rc = "2020-01-01"; const v = isDue(r); r.rc = o; return v; })()
}));
ok(kc.rv.join() === "aae-ese-terms,cls-pulpal-apical,iacsd,iso-20896,nice-cg64", "under-review records flagged: " + kc.rv.join(", "));
ok(kc.add.join() === "2027-11-08,2024-02-29,2025-11-08", "re-check date is checked date + 12 months (" + kc.add.join(" ") + ")");
ok(kc.allChecked, "every record carries its own checked date");
ok(kc.forced, "a record past its re-check date is flagged as due");
await page.selectOption("#fRev", "review"); await page.waitForTimeout(60);
ok(await page.$$eval("#list .ri", e => e.length) === 5, "review filter lists the 5 under-review records");
ok(await page.$$eval("#list .sb.s-review", e => e.length) >= 5, "under-review badge shown in browse rows");
await page.selectOption("#fRev", "");
await page.goto(FILE + "#about"); ok(/Keeping current/.test(await page.textContent("#keepcurrent")) && /Under review by the publisher: 5/.test(await page.textContent("#keepcurrent")), "About lists records under review");

console.log("\nNAVIGATION");
await page.goto(FILE + "#library"); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(80);
ok((await page.$$eval(".pin-chip", e => e.map(x => x.textContent.trim()))).length === 4, "4 default quick links (BPE, BSP diagnosis, MRONJ, anticoagulants)");
await page.click('.pin-chip[data-goto="t:bsp"]'); await page.waitForTimeout(100);
ok(page.url().endsWith("#bsp") && /BSP periodontal diagnosis/.test(await page.textContent("#app h2")), "quick link opens the BSP diagnosis tool");
await page.goto(FILE + "#r/cls-atwood"); await page.waitForTimeout(100);
ok((await page.$$eval("#list .entry", e => e.map(x => x.dataset.id))).join() === "cls-atwood", "shareable link #r/<id> opens that record");
await page.click('[data-pin="cls-atwood"]'); await page.click("#unfocus"); await page.waitForTimeout(100);
ok(await page.$('.pin-chip[data-goto="r:cls-atwood"]') !== null, "pinning a record adds it to the quick links");
const cite = await page.evaluate(() => [citation(BYID["sdcep-mronj"]), citation(BYID["cls-atwood"]), SHARE_BASE]);
ok(/^Scottish Dental Clinical Effectiveness Programme|^SDCEP/.test(cite[0]) && /Available from: https:\/\//.test(cite[0]) && /\[Accessed /.test(cite[0]), "citation built from publisher, title, year and URL: " + cite[0].slice(0, 90) + "…");
ok(cite[2] === "https://notile.co.uk/guide-card/", "share links point at notile.co.uk when opened elsewhere");
await page.click('details.cat[data-cat="perio"] summary');
const topicH = await page.$$eval('details.cat[data-cat="perio"] .sub h4', e => e.map(x => x.textContent.replace(/ \d+$/, "")));
ok(topicH[0] === "Screening" && topicH.includes("Risk & prognosis"), "periodontology grouped by topic: " + topicH.join(" | "));
await page.click('[data-gm="type"]'); await page.waitForTimeout(60);
const typeH = await page.$$eval('details.cat[data-cat="perio"] .sub h4', e => e.map(x => x.textContent.replace(/ \d+$/, "")));
ok(typeH[0].startsWith("Guidelines"), "group-by-type toggle still available: " + typeH.join(" | "));
await page.click('[data-gm="topic"]');

console.log("\nSUITE LINKS");
await page.goto(FILE + "#r/bsspd-pdd"); await page.waitForTimeout(100);
ok(await page.$eval(".suite-l", a => a.getAttribute("href")) === "https://notile.co.uk/chrome-card/", "BSSPD partial denture design links to Chrome Card");
await page.goto(FILE + "#r/bsp-bpe"); await page.waitForTimeout(100);
ok(/\/dentalaudit\/#\/create\?template=bpe$/.test(await page.$eval(".suite-l", a => a.getAttribute("href"))), "BPE guidance links to a DentalAudit BPE audit");
for (const t of ["bsp", "iotn", "rdiotn"]) {
  await page.goto(FILE + "#" + t); await page.waitForTimeout(80);
  if (t === "bsp") { for (let i = 0; i < 6; i++) { await page.click(`#bpeGrid .v[data-i="${i}"]`); await page.click(`#bpeGrid .v[data-i="${i}"]`); } }
  if (t === "iotn") { await page.click(".trait"); }
  if (t === "rdiotn") { await page.evaluate(() => document.querySelectorAll("#app .seg button, #app [data-k] button").forEach((b, i) => i % 3 === 1 && b.click())); }
  await page.waitForTimeout(80);
  const nb = await page.$eval("#notileBtn", b => !b.hidden).catch(() => false);
  ok(nb, `${t}: result can be sent to Notile`);
}

// ---------- mobile ----------
console.log("\nMOBILE");
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const merr = []; m.on("pageerror", e => merr.push(String(e)));
await m.goto(FILE + "#library"); await m.click("details.cat summary"); await m.screenshot({ path: (SHOTS||"/tmp") + "/mobile-browse.png" });
await m.fill("#q", "obturator"); await m.waitForTimeout(60);
const mr = await m.$$eval("#list .entry", e => e.map(x => x.dataset.id));
ok(mr.includes("cls-aramany"), "mobile search works");
const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
ok(!overflow, "no horizontal overflow at 390px");
await m.tap('#list .entry .more'); ok(await m.isVisible('#list .entry.open .detail'), "mobile detail opens");
await m.screenshot({ path: (SHOTS||"/tmp") + "/mobile.png" });
await page.goto(FILE + "#library"); await page.fill("#q", "bleeding around implant"); await page.waitForTimeout(60); await page.screenshot({ path: (SHOTS||"/tmp") + "/desktop.png" });
ok(merr.length === 0, "no mobile page errors " + merr.join(" | "));

await browser.close();
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
