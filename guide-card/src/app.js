/* ============================== APP (library + search) ============================== */
const BODIES = {sdcep:{short:"SDCEP"}, iotn:{short:"IOTN"}, bsp:{short:"BSP"}, rcs:{short:"RCS"}};
const TOOLS = [
 {id:"iotn", body:"iotn", title:"IOTN calculator", desc:"Tap every trait present — the worst one sets the DHC grade. Add the AC for the full IOTN."},
 {id:"bsp", body:"bsp", title:"BSP periodontal diagnosis", desc:"BPE to diagnostic statement: extent, stage, grade, stability and risk factors."},
 {id:"bpe", body:"bsp", title:"BPE codes & actions", desc:"Code criteria, what to do next, and the simplified BPE for under-18s."},
 {id:"mronj", body:"sdcep", title:"MRONJ risk (SDCEP)", desc:"Low or higher risk of MRONJ, with management prompts."},
 {id:"anticoag", body:"sdcep", title:"Anticoagulants & antiplatelets (SDCEP)", desc:"Procedure bleeding risk × drug → what to do."},
 {id:"rdiotn", body:"rcs", title:"RD-IOTN complexity (RCS)", desc:"Combine the four domain codes into an overall restorative complexity code."}
];
const CLS_TYPES = ["classification","tool","prom"];
const BYID = Object.fromEntries(REFS.map(r=>[r.id,r]));

/* ---------- search vocabulary ---------- */
const SPELL = {anesthesia:"anaesthesia",anesthetic:"anaesthetic",pediatric:"paediatric",pedodontic:"paediatric",hemorrhage:"haemorrhage",color:"colour",esthetic:"aesthetic",esthetics:"aesthetics",
  center:"centre",tumor:"tumour",behavior:"behaviour",dentin:"dentine",mineralization:"mineralisation",hypomineralization:"hypomineralisation",apicoectomy:"apicectomy",
  orthopedic:"orthopaedic",edema:"oedema",fiber:"fibre",traumatized:"traumatised",localized:"localised",generalized:"generalised",analyze:"analyse",program:"programme",
  sterilization:"sterilisation",colour:"colour",gray:"grey",pulpotomies:"pulpotomy"};
const SYN = [
 [["tsl","tooth surface loss","erosive wear","erosion","attrition","abrasion","worn teeth","worn dentition"],["tooth wear","tsl","bewe"]],
 [["cracked tooth syndrome","cracked tooth","cracked","crack"],["cracked tooth","vertical root fracture"]],
 [["endo difficulty","endodontic difficulty","retreatment complexity","re-treatment complexity","endo complexity","case difficulty","rct difficulty"],["case difficulty","endo difficulty","retreatment complexity"]],
 [["rbb","maryland bridge","maryland","resin-retained bridge","resin retained bridge","resin-retained","adhesive bridge","resin bonded bridge","resin-bonded bridge"],["resin bonded bridge","rbb"]],
 [["missing lateral incisor","missing lateral","missing laterals"],["missing lateral incisor","hypodontia","resin bonded bridge"]],
 [["chrome denture","cocr","co-cr","cobalt chrome","cobalt chromium","cobalt-chrome","free-end saddle","free end saddle","rpd","partial denture"],["partial denture","cobalt chrome","free-end saddle"]],
 [["bleeding around implant","implant bleeding","bleeding implant","bleeding on probing implant","sore implant","failing implant","peri-implantitis","peri implantitis","mucositis"],["peri-implantitis","peri-implant mucositis","bleeding around implant"]],
 [["orn","osteoradionecrosis","radionecrosis"],["osteoradionecrosis","orn"]],
 [["mronj","bronj","onj","bisphosphonate","denosumab"],["mronj"]],
 [["maxillectomy","obturator"],["maxillectomy","obturator"]],
 [["apicectomy","apical surgery","root end surgery","root-end surgery","periradicular","endodontic surgery","retrograde"],["apicectomy","periradicular surgery"]],
 [["dry mouth","xerostomia","hyposalivation","dry mouth after radiotherapy"],["xerostomia","dry mouth"]],
 [["denture adhesive","fixative","denture glue","denture cream"],["denture adhesive"]],
 [["denture cleaning","clean dentures","denture hygiene","denture care"],["denture cleaning"]],
 [["lab docket","lab sheet","lab prescription","laboratory prescription","statement of manufacture","custom made device","custom-made device"],["lab docket","custom-made device"]],
 [["autotransplantation","autotransplant","tooth transplant","transplantation"],["autotransplantation"]],
 [["implant funding","nhs implants","implant eligibility","implants on the nhs"],["implant funding","nhs implants","implant eligibility"]],
 [["tmd","tmj","jaw pain","jaw clicking","temporomandibular"],["tmd","temporomandibular"]],
 [["wisdom tooth","wisdom teeth","third molar"],["third molar"]],
 [["xray","x-ray","x ray","radiograph","radiography"],["radiograph"]],
 [["intraoral scanner","intra-oral scanner","ios","digital impression","scan accuracy"],["intraoral scanner","digital impression"]],
 [["mih","chalky teeth","hypomineralisation"],["mih"]],
 [["recall interval","recall","check up","check-up"],["recall interval"]],
 [["blood thinner","blood thinners","anticoagulant","doac","noac","warfarin"],["anticoagulant"]],
 [["general anaesthetic","general anaesthesia","ga"],["general anaesthesia"]],
 [["sedation","iv sedation"],["sedation"]],
 [["extremely deep caries","very deep caries"],["extremely deep caries"]],
 [["girft","getting it right first time","getting it right the first time"],["girft"]],
 [["ridge resorption","residual ridge","atwood","atwoods"],["residual ridge","ridge resorption"]]
];
const STOP = new Set(["the","a","an","of","for","and","or","in","on","to","with","after","around","guideline","guidelines","guidance","what","how","is","my","management","manage"]);
const NATIONS = [
 {re:/\b(scotland|scottish)\b/, nat:"Scotland", juris:"SCO"},
 {re:/\b(wales|welsh)\b/, nat:"Wales", juris:null},
 {re:/\b(northern ireland|ni)\b/, nat:"Northern Ireland", juris:null},
 {re:/\b(england|english)\b/, nat:"England", juris:"ENG"}
];
const norm = s => String(s||"").toLowerCase().replace(/[’']/g,"'").replace(/\b([a-z]+)\b/g,w=>SPELL[w]||w);
function blob(r){
  return {
    title:norm([r.s,r.t].join(" | ")),
    alias:norm((r.al||[]).join(" | ")),
    mid:norm([r.tp,r.u,r.pop,r.note,(r.pts||[]).join(" ")].join(" | ")),
    low:norm([r.p,r.ed,TYPES[r.ty],JURIS[r.j],r.nat,(r.sp||[]).map(x=>SPECS[x]).join(" "),MEASURES[r.m],(r.ch||[]).map(c=>c[0]).join(" ")].join(" | "))
  };
}
REFS.forEach(r=>r._b=blob(r));
const hasTok = (txt,tok) => tok.length<=4 ? new RegExp("(^|[^a-z0-9])"+tok.replace(/[.*+?^${}()|[\]\\/]/g,"\\$&")+"([^a-z0-9]|$)").test(txt) : txt.includes(tok);

function search(qRaw, list){
  let q = norm(qRaw).trim();
  if(!q) return {res:list.slice(), note:""};
  // nation handling
  let nation=null;
  NATIONS.forEach(n=>{ if(n.re.test(q)){ nation=n; q=q.replace(n.re," ").replace(/\s+/g," ").trim(); }});
  // synonym phrases
  const phrases=new Set(); const covered=new Set();
  SYN.forEach(([keys,exp])=>keys.forEach(k=>{ if(hasTok(q,k)){ exp.forEach(e=>phrases.add(e)); k.split(/\s+/).forEach(w=>covered.add(w)); }}));
  const toks=q.split(/[^a-z0-9/\-.]+/).filter(t=>t&&!STOP.has(t));
  let res=[];
  list.forEach(r=>{
    const b=r._b; let score=0, missing=0, strong=false;
    let phraseHit=false;
    phrases.forEach(p=>{ if(hasTok(b.alias,p)||hasTok(b.title,p)){score+=14;phraseHit=true;} else if(hasTok(b.mid,p)){score+=5;phraseHit=true;} });
    toks.forEach(t=>{
      let s=0;
      if(hasTok(b.title,t)) s=8; else if(hasTok(b.alias,t)) s=7; else if(hasTok(b.mid,t)) s=3; else if(hasTok(b.low,t)) s=1;
      if(s>=3) strong=true;
      if(!s && !(covered.has(t) && phraseHit)) missing++;
      score+=s;
    });
    if(!strong && !phraseHit) return;
    if(q.length>3 && (b.alias.includes(q)||b.title.includes(q))) score+=25;
    if(nation){
      if(r.nat===nation.nat || (nation.juris && r.j===nation.juris)) score+=20;
    }
    if(score<=0) return;
    if(r.st==="archived"||r.st==="historical"||r.st==="proposed"||r.st==="superseded") score-=3;
    if(["UK","SCO","ENG","LOCAL","GB"].includes(r.j)) score+=1.5;
    r._score=score; r._miss=missing; r._ph=phraseHit;
    res.push(r);
  });
  // require all tokens unless nothing matches
  const strict=res.filter(r=>r._miss===0 || (r._ph && r._miss<=1));
  // fall back to partial matches only when they are strong (title/alias-level), never to incidental hits
  res = strict.length ? strict : res.filter(r=>r._score>=7 && r._miss<toks.length);
  let note="";
  if(nation){
    const before=res.length;
    res=res.filter(r=>{
      if(r.j==="LOCAL" && r.nat && r.nat!==nation.nat) return false;
      if(nation.nat!=="England" && r.j==="ENG") return false;
      if(nation.nat==="England" && r.j==="SCO") return true; // Scottish guidance can be relevant UK-wide; labelled as Scottish
      return true;
    });
    const hidden=before-res.length;
    const hasLocal=res.some(r=>r.nat===nation.nat || (nation.juris&&r.j===nation.juris));
    note=`Showing results relevant to ${nation.nat}.`+(hidden?` ${hidden} England-only or other-nation item${hidden>1?"s":""} hidden.`:"")+(hasLocal?"":` No ${nation.nat}-specific item is in the catalogue for this search — check your local Health Board or Trust.`);
  }
  res.sort((a,b)=>b._score-a._score);
  return {res, note};
}

/* ---------- state ---------- */
const store = {
  get(k,d){try{const v=localStorage.getItem("guidecard:"+k);return v?JSON.parse(v):d}catch(e){return d}},
  set(k,v){try{localStorage.setItem("guidecard:"+k,JSON.stringify(v))}catch(e){}}
};
let saved = new Set(store.get("saved",[]).filter(id=>BYID[id]));
const validPin = p => (p.startsWith("r:")&&BYID[p.slice(2)]) || (p.startsWith("t:")&&TOOLS.some(t=>t.id===p.slice(2)));
let pins = store.get("pins",DEFAULT_PINS).filter(validPin);
let filter = {q:"", coll:"all", spec:"", type:"", juris:"", review:"", focus:null};
let groupMode = store.get("groupMode","topic");
const $app = document.getElementById("app");
const esc = s => String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(m){const t=document.getElementById("toast");t.textContent=m;t.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove("show"),1800)}
function copy(text,msg){
  const done=()=>toast(msg||"Copied to clipboard");
  try{navigator.clipboard.writeText(text).then(done,()=>fallback())}catch(e){fallback()}
  function fallback(){const ta=document.createElement("textarea");ta.value=text;document.body.appendChild(ta);ta.select();try{document.execCommand("copy");done()}catch(e){toast("Copy not available")}ta.remove()}
}

/* ---------- where this copy is running ----------
   On notile.co.uk (or the offline suite file) links to the other apps open in place and results can be handed
   to Notile on this device. Anywhere else (e.g. a standalone copy) they open notile.co.uk in a new tab. */
const SITE = "https://notile.co.uk";
const ON_SITE = /^https?:$/.test(location.protocol) && /(^|\.)notile\.co\.uk$|^localhost$|^127\.0\.0\.1$/.test(location.hostname);
const IN_SUITE = ON_SITE || !!window.__SUITE_APP;
const SHARE_BASE = ON_SITE ? location.origin + "/guide-card/" : SITE + "/guide-card/";
const suiteHref = path => IN_SUITE ? path : SITE + path;
const suiteTarget = IN_SUITE ? "" : ` target="_blank" rel="noopener"`;
function goSuite(path){ if(window.__SUITE_APP && parent && parent.SUITE) parent.SUITE.go(path); else if(IN_SUITE) location.href=path; else window.open(SITE+path,"_blank","noopener"); }

/* ---------- review dates ---------- */
const today = () => { const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
function addMonths(iso,n){ const [y,m,d]=iso.split("-").map(Number); const t=new Date(Date.UTC(y,m-1+n,1)); const last=new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth()+1,0)).getUTCDate();
  return t.getUTCFullYear()+"-"+String(t.getUTCMonth()+1).padStart(2,"0")+"-"+String(Math.min(d,last)).padStart(2,"0"); }
const recheckBy = r => r.rc || addMonths(r.ck||CK, RECHECK_MONTHS);
const isDue = r => recheckBy(r) <= today();
const isReview = r => !!r.rv;
const fmtDate = iso => { try{ return new Date(iso+"T12:00:00Z").toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}); }catch(e){ return iso; } };
const REVIEW_OPTS = {flag:"Needs attention (either)", review:"Under review by publisher", due:"Re-check due (over "+RECHECK_MONTHS+" months)"};
const reviewMatch = (r,k) => !k || (k==="review"?isReview(r):k==="due"?isDue(r):(isReview(r)||isDue(r)));

function badge(b){return `<span class="badge b-${b}">${BODIES[b].short}</span>`}
const jBadge = r => `<span class="jb j-${r.j}">${esc(r.j==="LOCAL"?("Local · "+(r.nat||"")):JURIS[r.j])}</span>`;
const sBadge = r => (r.st && r.st!=="current" ? `<span class="sb s-${r.st}">${esc(STATUS[r.st])}</span>` : "")
  + (isReview(r) ? `<span class="sb s-review" title="${esc(r.rv)}">Under review</span>` : "")
  + (isDue(r) ? `<span class="sb s-due" title="Last checked ${esc(fmtDate(r.ck||CK))}">Re-check due</span>` : "");
const tBadge = r => `<span class="type">${esc(TYPES[r.ty])}${r.m?" · "+esc(MEASURES[r.m]):""}</span>`;

/* ---------- citation ---------- */
function citation(r){
  const doi = (r.url.match(/^https:\/\/doi\.org\/(.+)$/)||[])[1];
  const parts = [r.p.replace(/\.$/,""), r.t.replace(/\.$/,"")];
  if(r.ed) parts.push(r.ed.replace(/\.$/,""));
  if(r.y) parts.push(String(r.y));
  let c = parts.join(". ") + ".";
  c += doi ? ` doi:${doi}` : ` Available from: ${r.url}`;
  c += ` [Accessed ${fmtDate(today())}].`;
  return c;
}

/* ---------- pins (quick links) ---------- */
function pinLabel(p){ if(p.startsWith("r:")){const r=BYID[p.slice(2)];return r.s||r.t} const t=TOOLS.find(t=>t.id===p.slice(2)); return t.title; }
function togglePin(p){ pins = pins.includes(p) ? pins.filter(x=>x!==p) : pins.concat(p); store.set("pins",pins); toast(pins.includes(p)?"Pinned to quick links":"Removed from quick links"); }
function pinsHTML(){
  if(!pins.length) return `<div class="pins"><span class="muted small">Quick links: tap 📌 on any record or tool to pin it here.</span></div>`;
  return `<div class="pins" aria-label="Quick links"><span class="pins-l">Quick links</span>${pins.map(p=>`<button class="chip pin-chip ${p[0]==="t"?"is-tool":""}" data-goto="${esc(p)}">${p[0]==="t"?"⚙ ":""}${esc(pinLabel(p))}</button>`).join("")}</div>`;
}
function bindPins(root){ root.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>{const p=b.dataset.goto; location.hash = p[0]==="t" ? p.slice(2) : "r/"+p.slice(2);})); }

/* ---------- send a tool result to Notile ---------- */
const INBOX = "notile:inbox";
function sendToNotile(src,text){
  if(!IN_SUITE){ copy(text,"Copied — paste it into Notile"); return; }
  try{
    const now=Date.now(); let box=JSON.parse(localStorage.getItem(INBOX)||"[]"); if(!Array.isArray(box)) box=[];
    box=box.filter(x=>x&&now-x.at<12*3600e3&&x.src!==src).concat({id:"gc"+now.toString(36),src,text,at:now}).slice(-6);
    localStorage.setItem(INBOX,JSON.stringify(box));
  }catch(e){ copy(text,"Copied — paste it into Notile"); return; }
  toast("Sent to Notile"); setTimeout(()=>goSuite("/notile/"),350);
}

/* ---------- router ---------- */
const VIEWS = {library:renderLibrary, tools:renderTools, saved:renderSaved, about:renderAbout};
TOOLS.forEach(t=>VIEWS[t.id]=()=>renderTool(t.id));
function route(){
  const h=decodeURIComponent((location.hash||"#library").slice(1));
  if(h.startsWith("r/")){
    const id=h.slice(2);
    document.querySelectorAll("#tabs a").forEach(a=>a.classList.toggle("on",a.dataset.v==="library"));
    const y=route._y; filter.focus = BYID[id] ? id : null; renderLibrary(); window.scrollTo(0,0); route._y=y; return;
  }
  const v=VIEWS[h]?h:"library";
  if(v==="library") filter.focus=null;
  const tab = TOOLS.some(t=>t.id===v)?"tools":v;
  document.querySelectorAll("#tabs a").forEach(a=>a.classList.toggle("on",a.dataset.v===tab));
  const y=v==="library"?(route._y||0):0; route._y=0;
  VIEWS[v]();
  if(TOOLS.some(t=>t.id===v)) addToolPin(v);
  window.scrollTo(0,y);
}
window.addEventListener("hashchange",route);
function addToolPin(id){
  const h=$app.querySelector("h2, h3"); if(!h||$app.querySelector(".toolpin")) return;
  const b=document.createElement("button"); b.className="btn sm ghost toolpin"; const set=()=>{b.textContent=pins.includes("t:"+id)?"📌 Pinned":"📌 Pin to quick links"}; set();
  b.onclick=()=>{togglePin("t:"+id);set()}; h.insertAdjacentElement("afterend",b);
}

/* ---------- library ---------- */
function linkA(label,url,cls){return `<a class="${cls||""}" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`}
function entryHTML(r,open){
  const meta=[r.p, r.y].filter(Boolean).join(" · ");
  const tool = r.tool?`<a class="btn sm ghost" href="#${r.tool}">Open tool</a>`:"";
  const parts = (r.ch||[]).length?`<div class="dl"><b>Parts / chapters</b><ul>${r.ch.map(c=>`<li>${c[1]?linkA(c[0],c[1]):esc(c[0])}</li>`).join("")}</ul></div>`:"";
  const extra = (r.x||[]).length?`<div class="links">${r.x.map(l=>linkA(l[0],l[1])).join("")}</div>`:"";
  const suite = (r.suite||[]).length?`<div class="suite">${r.suite.map(([l,p])=>`<a class="btn sm suite-l" href="${esc(suiteHref(p))}"${suiteTarget}>${esc(l)}${IN_SUITE?" →":" ↗"}</a>`).join("")}</div>`:"";
  const rel = (r.rel||[]).filter(id=>BYID[id]).map(id=>`<button class="relb" data-rel="${id}">${esc(BYID[id].s||BYID[id].t)}</button>`).join("");
  const pinned = pins.includes("r:"+r.id);
  return `<div class="card entry ${open?"open":""}" data-id="${r.id}">
    <div class="top"><h3>${esc(r.s||r.t)}</h3><button class="pinb ${pinned?"on":""}" data-pin="${r.id}" aria-label="${pinned?"Unpin from":"Pin to"} quick links" title="Pin to quick links">📌</button><button class="star ${saved.has(r.id)?"on":""}" data-star="${r.id}" aria-label="Save">★</button></div>
    <p class="use">Use this when ${esc(r.u)}</p>
    <div class="meta">${sBadge(r)}${jBadge(r)}${tBadge(r)}</div>
    <div class="meta2">${esc(meta)}</div>
    ${isReview(r)?`<p class="rvnote">⚑ ${esc(r.rv)}</p>`:""}
    <div class="row act"><a class="btn sm" href="${esc(r.url)}" target="_blank" rel="noopener">Open source ↗</a>${tool}<button class="btn sm ghost more">${open?"Hide details":"Details"}</button></div>
    ${suite}
    <div class="detail">
      <dl>
        <dt>Official title</dt><dd>${esc(r.t)}</dd>
        <dt>Publisher / authors</dt><dd>${esc(r.p)}</dd>
        ${r.y||r.ed?`<dt>Date / edition</dt><dd>${esc([r.y,r.ed].filter(Boolean).join(" — "))}</dd>`:""}
        <dt>Resource type</dt><dd>${esc(TYPES[r.ty])}${r.m?` — ${esc(MEASURES[r.m])}`:""}</dd>
        <dt>Provenance</dt><dd>${esc(r.j==="LOCAL"?`Local service pathway (${r.nat})`:JURIS[r.j])}${r.uk?` — ${esc(r.uk)}`:""}</dd>
        ${r.pop?`<dt>Population</dt><dd>${esc(r.pop)}</dd>`:""}
        <dt>Status</dt><dd>${r.st?esc(STATUS[r.st]):"Not specified by publisher"}${isReview(r)?" — under review (see note)":""}</dd>
        <dt>Topic / specialty</dt><dd>${esc(r.tp)} · ${(r.sp||[]).map(s=>esc(SPECS[s])).join(", ")}</dd>
        ${r.acc==="restricted"?`<dt>Access</dt><dd>Restricted full text (paid standard)</dd>`:""}
        <dt>Source checked</dt><dd>${esc(fmtDate(r.ck||CK))} · re-check by ${esc(fmtDate(recheckBy(r)))}${isDue(r)?" (due)":""}</dd>
      </dl>
      ${(r.pts||[]).length?`<ul>${r.pts.map(p=>`<li>${esc(p)}</li>`).join("")}</ul>`:""}
      ${parts}${extra}
      ${r.note?`<p class="muted">${esc(r.note)}</p>`:""}
      ${rel?`<div class="dl"><b>Related</b><div class="rels">${rel}</div></div>`:""}
      <div class="row act2"><button class="btn sm ghost" data-cite="${r.id}">Copy citation</button><button class="btn sm ghost" data-share="${r.id}">Copy link to this record</button></div>
      <p class="muted">Also found by: ${esc((r.al||[]).slice(0,10).join(", "))}${(r.al||[]).length>10?"…":""}</p>
    </div></div>`;
}
function bindEntries(root){
  root.querySelectorAll(".entry .more").forEach(b=>b.addEventListener("click",()=>{const e=b.closest(".entry");e.classList.toggle("open");b.textContent=e.classList.contains("open")?"Hide details":"Details"}));
  root.querySelectorAll("[data-star]").forEach(b=>b.addEventListener("click",()=>{
    const id=b.dataset.star; saved.has(id)?saved.delete(id):saved.add(id);
    store.set("saved",[...saved]); b.classList.toggle("on"); toast(saved.has(id)?"Saved":"Removed");
  }));
  root.querySelectorAll("[data-pin]").forEach(b=>b.addEventListener("click",()=>{togglePin("r:"+b.dataset.pin);b.classList.toggle("on",pins.includes("r:"+b.dataset.pin));const pe=document.getElementById("pinsWrap");if(pe){pe.innerHTML=pinsHTML();bindPins(pe)}}));
  root.querySelectorAll("[data-cite]").forEach(b=>b.addEventListener("click",()=>copy(citation(BYID[b.dataset.cite]),"Citation copied — check it against the source")));
  root.querySelectorAll("[data-share]").forEach(b=>b.addEventListener("click",()=>copy(SHARE_BASE+"#r/"+b.dataset.share,"Link copied")));
  root.querySelectorAll("[data-rel]").forEach(b=>b.addEventListener("click",()=>{ location.hash="r/"+b.dataset.rel; }));
}
function opts(obj,val,all){return `<option value="">${all}</option>`+Object.entries(obj).map(([k,v])=>`<option value="${k}" ${val===k?"selected":""}>${esc(v)}</option>`).join("")}
function renderLibrary(){
  if(filter.focus && BYID[filter.focus]){
    const r=BYID[filter.focus];
    $app.innerHTML=`<button class="back" id="unfocus">← ${filter.q.trim()?"Back to results":"Back to browse"}</button><div id="list">${entryHTML(r,true)}</div>`;
    document.getElementById("unfocus").onclick=()=>{filter.focus=null; location.hash="library";};
    bindEntries(document.getElementById("list")); return;
  }
  filter.focus=null;
  const nAct=[filter.spec,filter.type,filter.juris,filter.review].filter(Boolean).length;
  $app.innerHTML=`<div id="pinsWrap">${pinsHTML()}</div>
  <div class="search"><input id="q" type="search" placeholder="Search, or browse the sections below — e.g. cracked tooth, obturator, RBB" value="${esc(filter.q)}" aria-label="Search"></div>
  <div class="chips" id="coll">${[["all","All"],["docs","Guidance & documents"],["cls","Classifications & tools"]].map(([k,l])=>`<button class="chip ${filter.coll===k?"on":""}" data-c="${k}">${l}</button>`).join("")}</div>
  <details class="fwrap" id="fwrap" ${(window.innerWidth>620||nAct)?"open":""}><summary>Filters${nAct?` (${nAct} active)`:""}</summary><div class="filters">
    <select id="fSpec" aria-label="Specialty">${opts(SPECS,filter.spec,"All specialties")}</select>
    <select id="fType" aria-label="Resource type">${opts(TYPES,filter.type,"All resource types")}</select>
    <select id="fJur" aria-label="Provenance">${opts(JURIS,filter.juris,"All provenance")}</select>
    <select id="fRev" aria-label="Review status">${opts(REVIEW_OPTS,filter.review,"Any review status")}</select>
  </div></details>
  <div id="note"></div><div class="muted" id="count"></div><div id="list"></div>`;
  bindPins(document.getElementById("pinsWrap"));
  const draw=()=>{
    let base=REFS.filter(r=>(filter.coll==="all"||(filter.coll==="cls"?CLS_TYPES.includes(r.ty):!CLS_TYPES.includes(r.ty)))
      &&(!filter.spec||(r.sp||[]).includes(filter.spec))&&(!filter.type||r.ty===filter.type)&&(!filter.juris||r.j===filter.juris)&&reviewMatch(r,filter.review));
    const el=document.getElementById("list");
    if(!filter.q.trim()){
      document.getElementById("note").innerHTML=""; document.getElementById("count").textContent="";
      el.innerHTML=base.length?browseHTML(base):`<div class="empty">No records match these filters.</div>`;
      bindBrowse(el); return;
    }
    let {res,note}=search(filter.q,base);
    document.getElementById("note").innerHTML=note?`<div class="warn">${esc(note)}</div>`:"";
    document.getElementById("count").textContent=`${res.length} result${res.length===1?"":"s"}`;
    el.innerHTML=res.length?res.map(r=>entryHTML(r,false)).join(""):`<div class="empty">No matches. Try a broader word or clear the filters.</div>`;
    bindEntries(el);
  };
  const q=document.getElementById("q");
  q.addEventListener("input",e=>{filter.q=e.target.value;draw()});
  document.querySelectorAll("#coll .chip").forEach(c=>c.addEventListener("click",()=>{filter.coll=c.dataset.c;document.querySelectorAll("#coll .chip").forEach(x=>x.classList.toggle("on",x===c));draw()}));
  [["fSpec","spec"],["fType","type"],["fJur","juris"],["fRev","review"]].forEach(([id,k])=>document.getElementById(id).addEventListener("change",e=>{filter[k]=e.target.value;draw()}));
  draw();
}

/* ---------- browse (sections → topic or type sub-groups) ---------- */
const CATS = SECTIONS.map(s=>[s.id,s.label,s.specialties,s.groups||null]);
const SUBS = [
 ["Guidelines & position statements",["guideline","consensus"]],
 ["Classifications, indices & tools",["classification","tool","prom"]],
 ["Referral & commissioning",["commissioning"]],
 ["Standards, training & regulation",["standard","training","technical"]]
];
const TYPE_ORDER = ["guideline","consensus","standard","commissioning","classification","tool","prom","technical","training"];
const SHORT_TYPE = {guideline:"Guideline",consensus:"Consensus",standard:"Standard",commissioning:"Referral",classification:"Classification",tool:"Tool",prom:"PROM",technical:"Technical",training:"Training"};
const catOf = r => (CATS.find(c=>c[2].includes((r.sp||[])[0]))||CATS[0])[0];
let openCats = new Set(store.get("openCats",[]));
function rowHTML(r,showType){
  return `<button class="ri" data-open="${r.id}"><span class="ri-t">${esc(r.s||r.t)}</span>
    <span class="ri-m">${showType?`<span class="ri-ty">${esc(SHORT_TYPE[r.ty])}</span>`:""}${sBadge(r)}${jBadge(r)}<span class="ri-p">${esc([r.p&&r.p.split(" (")[0], r.y].filter(Boolean).join(" · "))}</span></span></button>`;
}
const byName=(a,b)=>String(a.s).localeCompare(String(b.s));
const byType=(a,b)=>TYPE_ORDER.indexOf(a.ty)-TYPE_ORDER.indexOf(b.ty)||byName(a,b);
function browseHTML(list){
  return `<div class="row browse-bar"><span class="muted">${list.length} records in ${CATS.length} sections — or type to search</span>
    <span class="gm" role="group" aria-label="Group sections by"><span class="muted small">Group by</span> <button class="chip sm ${groupMode==="topic"?"on":""}" data-gm="topic">Topic</button><button class="chip sm ${groupMode==="type"?"on":""}" data-gm="type">Type</button></span>
    <span><button class="btn ghost sm" id="expAll">Expand all</button> <button class="btn ghost sm" id="colAll">Collapse all</button></span></div>`+
  CATS.map(([k,label,,groups])=>{
    const items=list.filter(r=>catOf(r)===k); if(!items.length) return "";
    let subs;
    if(groupMode==="topic" && groups){
      subs=groups.concat([null]).map(g=>{
        const si=items.filter(r=>g===null?!groups.includes(r.grp):r.grp===g).sort(byType);
        return si.length?`<div class="sub"><h4>${esc(g||"Other")} <span class="cnt">${si.length}</span></h4>${si.map(r=>rowHTML(r,true)).join("")}</div>`:"";
      }).join("");
    }else{
      subs=SUBS.map(([sl,types])=>{
        const si=items.filter(r=>types.includes(r.ty)).sort(byName);
        return si.length?`<div class="sub"><h4>${esc(sl)} <span class="cnt">${si.length}</span></h4>${si.map(r=>rowHTML(r,false)).join("")}</div>`:"";
      }).join("");
    }
    return `<details class="cat card" data-cat="${k}" ${openCats.has(k)?"open":""}><summary><span>${esc(label)}</span><span class="cnt">${items.length}</span></summary>${subs}</details>`;
  }).join("");
}
function bindBrowse(root){
  root.querySelectorAll("details.cat").forEach(d=>d.addEventListener("toggle",()=>{d.open?openCats.add(d.dataset.cat):openCats.delete(d.dataset.cat);store.set("openCats",[...openCats])}));
  root.querySelectorAll("[data-open]").forEach(b=>b.addEventListener("click",()=>{route._y=window.scrollY; location.hash="r/"+b.dataset.open;}));
  root.querySelectorAll("[data-gm]").forEach(b=>b.addEventListener("click",()=>{groupMode=b.dataset.gm;store.set("groupMode",groupMode);renderLibrary()}));
  const set=v=>{root.querySelectorAll("details.cat").forEach(d=>d.open=v)};
  const e=document.getElementById("expAll"), c=document.getElementById("colAll");
  if(e) e.onclick=()=>set(true); if(c) c.onclick=()=>set(false);
}
function renderSaved(){
  const list=REFS.filter(e=>saved.has(e.id));
  $app.innerHTML=list.length?`<div id="list">${list.map(r=>entryHTML(r,false)).join("")}</div>`:`<div class="empty">Tap ★ on any entry in the Library to keep it here.</div>`;
  if(list.length)bindEntries(document.getElementById("list"));
}
function renderTools(){
  const col={sdcep:"var(--sdcep)",iotn:"var(--iotn)",bsp:"var(--bsp)",rcs:"var(--rcs)"};
  $app.innerHTML=`<div class="toolgrid">${TOOLS.map(t=>`<div class="card toolcard" style="border-left-color:${col[t.body]}"><a href="#${t.id}" class="toolcard-a"><div>${badge(t.body)}</div><h3 style="margin-top:6px;font-size:1.05rem">${esc(t.title)}</h3><p>${esc(t.desc)}</p></a><button class="pinb ${pins.includes("t:"+t.id)?"on":""}" data-tpin="${t.id}" aria-label="Pin ${esc(t.title)} to quick links" title="Pin to quick links">📌</button></div>`).join("")}</div>`;
  $app.querySelectorAll("[data-tpin]").forEach(b=>b.addEventListener("click",()=>{togglePin("t:"+b.dataset.tpin);b.classList.toggle("on",pins.includes("t:"+b.dataset.tpin))}));
}
function renderAbout(){
  const byType=Object.keys(TYPES).map(k=>[TYPES[k],REFS.filter(r=>r.ty===k).length]).filter(x=>x[1]);
  const rv=REFS.filter(isReview), due=REFS.filter(isDue);
  const li=r=>`<li><a href="#r/${r.id}">${esc(r.s||r.t)}</a>${r.rv?` — ${esc(r.rv)}`:` — last checked ${esc(fmtDate(r.ck||CK))}`}</li>`;
  $app.innerHTML=`<div class="card"><h2 style="font-size:1.15rem">About Guide Card</h2>
  <p>A quick reference to UK restorative dentistry guidance, classifications and assessment tools, searchable by the condition or clinical question.</p>
  <p><b>${REFS.length}</b> catalogue records:</p><ul>${byType.map(([t,n])=>`<li>${esc(t)}: ${n}</li>`).join("")}</ul>
  <p class="muted">Every record links to its issuing organisation or original publication and shows the date the source was checked. Provenance (UK professional, England-only NHS, Scottish, local service, European, international, original research) is shown separately from UK relevance. Status is shown only where the publisher states one. Summaries are paraphrased and are not a substitute for the source. This catalogue is not exhaustive. No patient-identifiable information is entered or stored; saved items, pins and settings stay on this device.</p></div>
  <div class="card" id="keepcurrent"><h3 style="font-size:1rem">Keeping current</h3>
  <p class="muted">Each record gets a re-check date ${RECHECK_MONTHS} months after its source was last checked. Records past that date are flagged “Re-check due”; records the publisher says are being revised are flagged “Under review”. Use the review filter in the Library to list them.</p>
  <p><b>Under review by the publisher: ${rv.length}</b></p>${rv.length?`<ul>${rv.map(li).join("")}</ul>`:""}
  <p><b>Re-check due: ${due.length}</b>${due.length?"":` <span class="muted">— next due ${esc(fmtDate(REFS.map(recheckBy).sort()[0]))}</span>`}</p>${due.length?`<ul>${due.map(li).join("")}</ul>`:""}</div>
  <div class="card"><h3 style="font-size:1rem">Awaiting verification — not in the live catalogue</h3><p class="muted">Requested items whose source could not yet be verified.</p>
  <ul>${PENDING.map(p=>`<li><b>${esc(p.name)}</b> — ${esc(p.reason)}</li>`).join("")}</ul></div>`;
}
