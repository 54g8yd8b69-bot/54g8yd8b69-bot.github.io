/* ===== Clinical tools (IOTN, BSP, BPE, MRONJ, anticoagulants, RD-IOTN) ===== */
/* IOTN DHC traits */
const DHC = [
 {g:5,c:"5i",t:"Impeded eruption of teeth (except third molars) due to crowding, displacement, supernumerary teeth, retained deciduous teeth or any pathological cause"},
 {g:5,c:"5h",t:"Extensive hypodontia with restorative implications (more than one tooth missing in any quadrant) requiring pre-restorative orthodontics"},
 {g:5,c:"5a",t:"Increased overjet greater than 9 mm"},
 {g:5,c:"5m",t:"Reverse overjet greater than 3.5 mm with reported masticatory and speech difficulties"},
 {g:5,c:"5p",t:"Defects of cleft lip and/or palate and other craniofacial anomalies"},
 {g:5,c:"5s",t:"Submerged deciduous teeth"},
 {g:4,c:"4h",t:"Less extensive hypodontia requiring pre-restorative orthodontics or orthodontic space closure to avoid a prosthesis"},
 {g:4,c:"4a",t:"Increased overjet greater than 6 mm but less than or equal to 9 mm"},
 {g:4,c:"4b",t:"Reverse overjet greater than 3.5 mm with no masticatory or speech difficulties"},
 {g:4,c:"4m",t:"Reverse overjet greater than 1 mm but less than 3.5 mm with recorded masticatory or speech difficulties"},
 {g:4,c:"4c",t:"Anterior or posterior crossbite with greater than 2 mm discrepancy between retruded contact position and intercuspal position"},
 {g:4,c:"4l",t:"Posterior lingual crossbite with no functional occlusal contact in one or both buccal segments"},
 {g:4,c:"4d",t:"Severe contact point displacement greater than 4 mm"},
 {g:4,c:"4e",t:"Extreme lateral or anterior open bite greater than 4 mm"},
 {g:4,c:"4f",t:"Increased and complete overbite with gingival or palatal trauma"},
 {g:4,c:"4t",t:"Partially erupted teeth, tipped and impacted against adjacent teeth"},
 {g:4,c:"4x",t:"Presence of supernumerary teeth"},
 {g:3,c:"3a",t:"Increased overjet greater than 3.5 mm but less than or equal to 6 mm with incompetent lips"},
 {g:3,c:"3b",t:"Reverse overjet greater than 1 mm but less than or equal to 3.5 mm"},
 {g:3,c:"3c",t:"Anterior or posterior crossbite with greater than 1 mm but less than or equal to 2 mm discrepancy between RCP and ICP"},
 {g:3,c:"3d",t:"Contact point displacement greater than 2 mm but less than or equal to 4 mm"},
 {g:3,c:"3e",t:"Lateral or anterior open bite greater than 2 mm but less than or equal to 4 mm"},
 {g:3,c:"3f",t:"Increased and complete overbite without gingival trauma"},
 {g:2,c:"2a",t:"Increased overjet greater than 3.5 mm but less than or equal to 6 mm with competent lips"},
 {g:2,c:"2b",t:"Reverse overjet greater than 0 mm but less than or equal to 1 mm"},
 {g:2,c:"2c",t:"Anterior or posterior crossbite with less than or equal to 1 mm discrepancy between RCP and ICP"},
 {g:2,c:"2d",t:"Contact point displacement greater than 1 mm but less than or equal to 2 mm"},
 {g:2,c:"2e",t:"Anterior or posterior open bite greater than 1 mm but less than or equal to 2 mm"},
 {g:2,c:"2f",t:"Increased overbite greater than or equal to 3.5 mm without gingival contact"},
 {g:2,c:"2g",t:"Pre-normal or post-normal occlusion with no other anomalies (up to half a unit discrepancy)"},
 {g:1,c:"1",t:"Extremely minor malocclusion, including contact point displacement less than 1 mm"}
];
const DHC_LABEL = {1:"No need",2:"Little need",3:"Moderate / borderline need",4:"Great need",5:"Very great need"};


/* ============================== TOOLS ============================== */
function seg(name, opts, val){return `<div class="seg" data-seg="${name}">${opts.map(o=>`<button data-v="${esc(o[0])}" class="${String(val)===String(o[0])?"on":""}">${esc(o[1])}</button>`).join("")}</div>`}
function bindSeg(root,state,cb){root.querySelectorAll("[data-seg]").forEach(s=>s.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{
  const k=s.dataset.seg; state[k]=(state[k]===b.dataset.v&&s.dataset.toggle!==undefined)?"":b.dataset.v;
  s.querySelectorAll("button").forEach(x=>x.classList.toggle("on",x.dataset.v===state[k])); cb();
})))}
function head(id){const t=TOOLS.find(x=>x.id===id);return `<button class="back" onclick="location.hash='tools'">← Tools</button><div class="card"><div>${badge(t.body)}</div><h2 style="font-size:1.2rem;margin-top:6px">${esc(t.title)}</h2><p class="muted" style="margin:6px 0 0">${esc(t.desc)}</p></div>`}
function outBox(label,big,body,note){return `<div class="out"><h4>${label}</h4><div class="big">${big}</div>${body||""}${note?`<div class="row" style="margin-top:10px"><button class="btn sm" id="copyBtn">Copy for notes</button><button class="btn sm notile" id="notileBtn" hidden></button></div>`:""}</div>`}
/* Send the result to Notile: on notile.co.uk it goes into the Notile note on this device; elsewhere it is copied and Notile opens. */
const NOTILE_TOOLS = {bsp:"BSP periodontal diagnosis", iotn:"IOTN", rdiotn:"RD-IOTN restorative complexity"};
function notileBtn(note){const id=(location.hash||"").slice(1),b=document.getElementById("notileBtn");if(!b||!NOTILE_TOOLS[id])return;
  b.hidden=false;b.textContent=IN_SUITE?"Send to Notile →":"Copy & open Notile ↗";
  b.onclick=()=>{if(IN_SUITE)sendToNotile(NOTILE_TOOLS[id],note);else{copy(note,"Copied — paste it into Notile");window.open(SITE+"/notile/","_blank","noopener")}}}
function renderTool(id){({iotn:toolIOTN,bsp:toolBSP,bpe:toolBPE,mronj:toolMRONJ,anticoag:toolAnticoag,rdiotn:toolRD})[id]()}

/* ---- IOTN ---- */
const iotnState={sel:new Set(), ac:""};
function toolIOTN(){
  const groups=[5,4,3,2,1].map(g=>`<h4 class="grade-h">Grade ${g} — ${DHC_LABEL[g]}</h4>${DHC.filter(d=>d.g===g).map(d=>`<div class="trait ${iotnState.sel.has(d.c)?"on":""}" data-c="${d.c}"><code>${d.c}</code><span>${esc(d.t)}</span></div>`).join("")}`).join("");
  $app.innerHTML=head("iotn")+`<div class="warn">Work through MOCDO — <b>M</b>issing, <b>O</b>verjet, <b>C</b>rossbite, <b>D</b>isplacement, <b>O</b>verbite — and tap every trait present. Measure with an IOTN ruler.</div>
  <div id="iotnOut"></div>
  <div class="card"><label style="margin-top:0">Aesthetic Component (AC)</label>${seg("ac",[["","Not recorded"],...[1,2,3,4,5,6,7,8,9,10].map(n=>[n,String(n)])],iotnState.ac)}
  <p class="muted" style="margin:8px 0 0">1–4 no/little need · 5–7 borderline · 8–10 great need</p></div>
  <div class="card"><div class="row" style="justify-content:space-between"><h3 style="font-size:1rem">Dental Health Component traits</h3><button class="btn ghost sm" id="clr">Clear</button></div>${groups}</div>`;
  const draw=()=>{
    const sel=DHC.filter(d=>iotnState.sel.has(d.c));
    const el=document.getElementById("iotnOut");
    if(!sel.length){el.innerHTML=outBox("IOTN","Select traits below","<p>The highest grade selected becomes the DHC.</p>");return}
    const top=Math.max(...sel.map(d=>d.g)); const worst=sel.filter(d=>d.g===top);
    const ac=iotnState.ac?parseInt(iotnState.ac,10):null;
    const codes=worst.map(d=>d.c).join(", ");
    let elig;
    if(top>=4)elig="Meets the usual NHS threshold (DHC 4–5).";
    else if(top===3&&ac!==null)elig=ac>=6?"Meets the usual NHS threshold (DHC 3 with AC ≥ 6).":"Below the usual NHS threshold (DHC 3 with AC < 6).";
    else if(top===3)elig="DHC 3 — record the AC to check against the usual NHS threshold (AC ≥ 6).";
    else elig="Below the usual NHS threshold.";
    const note=`IOTN: DHC ${codes}${ac!==null?`, AC ${ac}`:""} (${DHC_LABEL[top].toLowerCase()}).${sel.length>worst.length?` Other traits: ${sel.filter(d=>d.g<top).map(d=>d.c).join(", ")}.`:""}`;
    el.innerHTML=outBox("IOTN result",`DHC ${esc(codes)}${ac!==null?` · AC ${ac}`:""}`,`<p>${DHC_LABEL[top]}. ${elig}</p><p class="muted" style="color:#a9c3d3">${esc(note)}</p>`,true);
    document.getElementById("copyBtn").onclick=()=>copy(note);notileBtn(note);
  };
  $app.querySelectorAll(".trait").forEach(t=>t.addEventListener("click",()=>{const c=t.dataset.c;iotnState.sel.has(c)?iotnState.sel.delete(c):iotnState.sel.add(c);t.classList.toggle("on");draw()}));
  document.getElementById("clr").onclick=()=>{iotnState.sel.clear();iotnState.ac="";toolIOTN()};
  bindSeg($app,iotnState,draw); draw();
}

/* ---- BPE ---- */
const BPE_CODES=[
 ["0","Pockets <3.5 mm, no calculus/overhangs, no bleeding on probing (black band entirely visible)","No periodontal treatment needed"],
 ["1","Pockets <3.5 mm, no calculus/overhangs, bleeding on probing (black band entirely visible)","OHI and risk-factor control"],
 ["2","Pockets <3.5 mm, supra- or subgingival calculus/overhangs (black band entirely visible)","As code 1, plus remove plaque-retentive factors including all supra- and subgingival calculus"],
 ["3","Probing depth 3.5–5.5 mm (black band partially visible: 4–5 mm pocket)","As code 2, plus subgingival instrumentation if needed. Initial therapy, then 6-point pocket chart in that sextant"],
 ["4","Probing depth >5.5 mm (black band disappears: pocket ≥6 mm)","OHI, risk-factor control, subgingival instrumentation; assess need for more complex treatment — referral may be indicated. Full-mouth 6-point pocket chart"],
 ["*","Furcation involvement","Record with the number (e.g. 3*). Treat according to the BPE; referral may be indicated"]
];
function toolBPE(){
  $app.innerHTML=head("bpe")+`<div class="card"><h3 style="font-size:1rem">Codes and actions (BSP 2019)</h3>
  <table><tr><th>Code</th><th>Criteria</th><th>Action</th></tr>${BPE_CODES.map(r=>`<tr><td><b>${r[0]}</b></td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join("")}</table>
  <p class="muted">Radiographs should be available for code 3 and 4 sextants.</p></div>
  <div class="card"><h3 style="font-size:1rem">How to record</h3><ul>
  <li>Six sextants: 17–14, 13–23, 24–27, 47–44, 43–33, 34–37. Record the highest code per sextant.</li>
  <li>A sextant needs at least two teeth; a single tooth's score goes into the adjacent sextant.</li>
  <li>Exclude third molars unless first and/or second molars are missing.</li>
  <li>WHO probe (0.5 mm ball end, black band 3.5–5.5 mm), light force.</li>
  <li>New patients: always. Codes 0–2: every routine examination.</li>
  <li>Not for monitoring treatment response or around implants.</li></ul></div>
  <div class="card"><h3 style="font-size:1rem">Simplified BPE — under 18s (BSP/BSPD 2021)</h3><ul>
  <li>Index teeth: UR6, UR1, UL6, LL6, LL1, LR6.</li>
  <li>7–11 years: codes 0–2 only. 12–17 years: full codes 0–4 and *.</li>
  <li>Screen before orthodontic treatment.</li></ul>
  <a href="https://www.bsperio.org.uk/assets/downloads/BSP_BPE_Guidelines_2019.pdf" target="_blank" rel="noopener">BSP BPE guidelines (PDF) ↗</a></div>
  <div class="row"><a class="btn" href="#bsp">Go to diagnosis builder →</a></div>`;
}

/* ---- BSP diagnosis ---- */
const SEXT=["17–14","13–23","24–27","47–44","43–33","34–37"];
const BPE_CYCLE=["","0","1","2","3","4","-"];
const bspState={bpe:["","","","","",""],fur:[false,false,false,false,false,false],recession:"",bop:"",extent:"",stage:"",bl:"",age:"",gradeManual:"",maxPPD:"",bop4:"",smoker:"",cigs:"",diabetes:"",hba1c:"",other:""};
function toolBSP(){
  const s=bspState;
  $app.innerHTML=head("bsp")+`<div class="warn">Based on the BSP implementation of the 2017 classification. Use clinical judgement, especially where bone loss has causes other than periodontitis.</div>
  <div class="card"><h3 style="font-size:1rem">1 · BPE</h3><p class="muted" style="margin:4px 0 8px">Tap a number to cycle through the codes (blank → 0–4 → missing). Tap * for furcation.</p>
  <div class="bpe" id="bpeGrid">${SEXT.map((x,i)=>`<div class="cell"><small>${x}</small><div class="v" data-i="${i}">${s.bpe[i]||"·"}</div><button class="f ${s.fur[i]?"on":""}" data-f="${i}">*</button></div>`).join("")}</div>
  <label>Interdental recession / attachment loss attributable to periodontitis?</label>${seg("recession",[["no","No"],["yes","Yes"]],s.recession)}
  <label>Full-mouth bleeding on probing (%)</label><input type="number" min="0" max="100" id="bop" value="${esc(s.bop)}" placeholder="e.g. 25">
  </div>
  <div id="perio"></div>
  <div id="bspOut"></div>`;
  const grid=document.getElementById("bpeGrid");
  grid.querySelectorAll(".v").forEach(v=>v.addEventListener("click",()=>{const i=+v.dataset.i;s.bpe[i]=BPE_CYCLE[(BPE_CYCLE.indexOf(s.bpe[i])+1)%BPE_CYCLE.length];v.textContent=s.bpe[i]||"·";draw()}));
  grid.querySelectorAll(".f").forEach(f=>f.addEventListener("click",()=>{const i=+f.dataset.f;s.fur[i]=!s.fur[i];f.classList.toggle("on");draw()}));
  document.getElementById("bop").addEventListener("input",e=>{s.bop=e.target.value;draw()});
  bindSeg($app,s,draw);

  function perioForm(){
    return `<div class="card"><h3 style="font-size:1rem">2 · Periodontitis</h3>
    <label>Extent</label>${seg("extent",[["Localised","Localised (<30% of teeth)"],["Generalised","Generalised (≥30% of teeth)"],["Molar–incisor pattern","Molar–incisor pattern"]],s.extent)}
    <label>Stage — worst site radiographic bone loss</label>${seg("stage",[["I","<15% or <2 mm CAL from CEJ (Stage I)"],["II","Coronal third of root (Stage II)"],["III","Mid third of root (Stage III)"],["IV","Apical third of root (Stage IV)"]],s.stage)}
    <label>Grade — % bone loss at worst site and patient age</label>
    <div class="row"><input type="number" id="bl" min="0" max="100" placeholder="% bone loss" value="${esc(s.bl)}" style="flex:1"><input type="number" id="age" min="1" max="110" placeholder="Age (years)" value="${esc(s.age)}" style="flex:1"></div>
    <p class="muted" id="ratio" style="margin:6px 0"></p>
    ${seg("gradeManual",[["","Use calculation"],["A","Grade A"],["B","Grade B"],["C","Grade C"]],s.gradeManual)}
    <label>Current status</label>
    <div class="row"><input type="number" id="maxPPD" min="0" max="15" placeholder="Deepest PPD (mm)" value="${esc(s.maxPPD)}" style="flex:1"></div>
    <label style="font-weight:400">Bleeding at any 4 mm site?</label>${seg("bop4",[["no","No"],["yes","Yes"]],s.bop4)}
    <label>Risk factors</label>
    ${seg("smoker",[["no","Non-smoker"],["former","Former smoker"],["yes","Current smoker"]],s.smoker)}
    <div class="row" style="margin-top:6px"><input type="text" id="cigs" placeholder="Smoking amount, e.g. 10/day" value="${esc(s.cigs)}"></div>
    <div style="margin-top:8px">${seg("diabetes",[["no","No diabetes"],["controlled","Diabetes — well controlled"],["poor","Diabetes — poorly controlled"]],s.diabetes)}</div>
    <div class="row" style="margin-top:6px"><input type="text" id="hba1c" placeholder="HbA1c (optional), e.g. 58 mmol/mol" value="${esc(s.hba1c)}"></div>
    <div class="row" style="margin-top:6px"><input type="text" id="other" placeholder="Other risk factors (optional)" value="${esc(s.other)}"></div>
    </div>`;
  }
  function calcGrade(){
    if(s.gradeManual)return {g:s.gradeManual,txt:"Grade set manually."};
    const bl=parseFloat(s.bl), age=parseFloat(s.age);
    if(!(bl>=0)||!(age>0))return {g:"",txt:"Enter % bone loss and age to calculate the grade."};
    const r=bl/age; const g=r<0.5?"A":r<=1.0?"B":"C";
    return {g,txt:`% bone loss ÷ age = ${r.toFixed(2)} → Grade ${g} (A <0.5 · B 0.5–1.0 · C >1.0)`};
  }
  function calcStatus(){
    const bop=parseFloat(s.bop), ppd=parseFloat(s.maxPPD);
    if(!(ppd>=0)||!(bop>=0))return "";
    if(ppd>=5||(ppd>=4&&s.bop4==="yes"))return "unstable";
    if(s.bop4==="")return "";
    return bop<10?"stable":"in remission";
  }
  function riskText(){
    const r=[];
    if(s.smoker==="yes")r.push("smoker"+(s.cigs?` (${s.cigs})`:""));
    if(s.smoker==="former")r.push("former smoker"+(s.cigs?` (${s.cigs})`:""));
    if(s.diabetes==="controlled")r.push("diabetes, well controlled"+(s.hba1c?` (HbA1c ${s.hba1c})`:""));
    if(s.diabetes==="poor")r.push("diabetes, poorly controlled"+(s.hba1c?` (HbA1c ${s.hba1c})`:""));
    if(s.other)r.push(s.other);
    if(!r.length&&(s.smoker==="no"&&s.diabetes==="no"))return "none identified (non-smoker, no diabetes)";
    return r.join("; ");
  }
  function draw(){
    const codes=s.bpe.filter(x=>x!==""&&x!=="-").map(Number);
    const max=codes.length?Math.max(...codes):null;
    const anyFur=s.fur.some(Boolean);
    const bop=parseFloat(s.bop);
    const perioPath=max===4||s.recession==="yes";
    const pEl=document.getElementById("perio"), oEl=document.getElementById("bspOut");
    const bpeStr=`${s.bpe.slice(0,3).map((x,i)=>(x||"-")+(s.fur[i]?"*":"")).join(" ")} / ${s.bpe.slice(3).map((x,i)=>(x||"-")+(s.fur[i+3]?"*":"")).join(" ")}`;
    if(perioPath){
      if(!pEl.innerHTML){pEl.innerHTML=perioForm();bindPerio()}
      const gr=calcGrade(); document.getElementById("ratio").textContent=gr.txt;
      const st=calcStatus();
      const missing=[!s.extent&&"extent",!s.stage&&"stage",!gr.g&&"grade",!st&&"current status"].filter(Boolean);
      const dx=`${s.extent||"[Extent]"} periodontitis; Stage ${s.stage||"[?]"} Grade ${gr.g||"[?]"}; currently ${st||"[status]"}`;
      const rf=riskText();
      const note=`BPE: ${bpeStr}${!isNaN(bop)?`. BOP ${bop}%`:""}.\nDiagnosis: ${dx}.${rf?`\nRisk factors: ${rf}.`:""}`;
      const statusHelp=`<ul><li><b>Stable</b>: BOP <10%, PPD ≤4 mm, no BOP at 4 mm sites</li><li><b>In remission</b>: BOP ≥10%, PPD ≤4 mm, no BOP at 4 mm sites</li><li><b>Unstable</b>: PPD ≥5 mm, or PPD ≥4 mm with BOP</li></ul>`;
      oEl.innerHTML=outBox("Diagnostic statement",esc(dx),`${rf?`<p>Risk factors: ${esc(rf)}</p>`:""}${missing.length?`<p style="color:#ffd27a">Still needed: ${missing.join(", ")}.</p>`:""}${statusHelp}`,true);
      document.getElementById("copyBtn").onclick=()=>copy(note);notileBtn(note);
    }else{
      pEl.innerHTML="";
      if(max===null){oEl.innerHTML=outBox("Diagnosis","Enter the BPE","<p>BPE 4 or interdental recession opens the periodontitis pathway.</p>");return}
      let dx,body="";
      if(max===3){
        dx="BPE code 3 — no interdental recession";
        body="<p>Carry out initial therapy (OHI, risk-factor control, PMPR), then a 6-point pocket chart in the code 3 sextant(s). If radiographs show bone loss due to periodontitis, tick interdental recession/attachment loss to move to the periodontitis pathway. If not, diagnose on BOP as below.</p>";
      }
      let gdx="";
      if(!isNaN(bop)){gdx=bop<10?"Clinical gingival health":bop<=30?"Localised gingivitis":"Generalised gingivitis"}
      if(max<=2){dx=gdx||"Enter BOP % to complete";}
      body+=`<ul><li>BOP <10% → clinical gingival health</li><li>BOP 10–30% → localised gingivitis</li><li>BOP >30% → generalised gingivitis</li></ul>${anyFur?"<p style='color:#ffd27a'>Furcation recorded — check for attachment loss and consider the periodontitis pathway.</p>":""}`;
      const final=max<=2?dx:(gdx?`${gdx} (provisional, pending re-assessment of code 3 sextants)`:dx);
      const note=`BPE: ${bpeStr}${!isNaN(bop)?`. BOP ${bop}%`:""}.\nDiagnosis: ${final}.`;
      oEl.innerHTML=outBox("Diagnosis",esc(final),body,true);
      document.getElementById("copyBtn").onclick=()=>copy(note);notileBtn(note);
    }
  }
  function bindPerio(){
    const p=document.getElementById("perio");
    bindSeg(p,s,draw);
    ["bl","age","maxPPD","cigs","hba1c","other"].forEach(k=>document.getElementById(k).addEventListener("input",e=>{s[k]=e.target.value;draw()}));
  }
  draw();
}

/* ---- MRONJ ---- */
const mState={prev:"",ind:"",drug:"",dur:"",steroid:""};
function toolMRONJ(){
  const s=mState;
  $app.innerHTML=head("mronj")+`<div class="warn">Summary of the SDCEP risk assessment (2017, extant 2024). Check the current SDCEP drug list and 2024 supplement.</div>
  <div class="card">
  <label style="margin-top:0">Previous diagnosis of MRONJ?</label>${seg("prev",[["no","No"],["yes","Yes"]],s.prev)}
  <label>Reason for treatment</label>${seg("ind",[["osteo","Osteoporosis / other non-malignant bone disease"],["cancer","Cancer"]],s.ind)}
  <label>Drug</label>${seg("drug",[["bp","Bisphosphonate (oral or IV)"],["dmab","Denosumab"],["aa","Anti-angiogenic drug"],["other","Other / unsure"]],s.drug)}
  <label>Bisphosphonate for 5 years or more?</label>${seg("dur",[["no","Less than 5 years"],["yes","5 years or more"]],s.dur)}
  <label>Concurrent systemic glucocorticoids?</label>${seg("steroid",[["no","No"],["yes","Yes"]],s.steroid)}
  </div><div id="mOut"></div>`;
  const draw=()=>{
    let risk="",why="";
    if(s.prev==="yes"){risk="Higher risk";why="Previous diagnosis of MRONJ."}
    else if(s.ind==="cancer"){risk="Higher risk";why="Anti-resorptive or anti-angiogenic therapy for cancer."}
    else if(s.ind==="osteo"){
      if(s.drug==="other"||s.drug==="aa"){risk="Check guidance";why="Not covered by the standard low/higher-risk categories — consult the SDCEP guidance and supplement, or seek specialist advice."}
      else if(s.steroid==="yes"){risk="Higher risk";why="Anti-resorptive drug with concurrent systemic glucocorticoids."}
      else if(s.drug==="bp"&&s.dur==="yes"){risk="Higher risk";why="Bisphosphonate for 5 years or more."}
      else if(s.drug==="bp"&&s.dur==="no"&&s.steroid==="no"){risk="Low risk";why="Bisphosphonate for less than 5 years without systemic glucocorticoids."}
      else if(s.drug==="dmab"&&s.steroid==="no"){risk="Low risk";why="Denosumab for a non-malignant condition without systemic glucocorticoids."}
    }
    const el=document.getElementById("mOut");
    if(!risk){el.innerHTML=outBox("MRONJ risk","Answer the questions above","");return}
    const common=`<li>Give personalised preventive advice; consider high-fluoride toothpaste.</li><li>Aim to get the patient as dentally fit as feasible, ideally before drug therapy starts.</li><li>Drug holidays are not recommended by SDCEP for dental reasons.</li><li>Report suspected MRONJ via the MHRA Yellow Card scheme.</li>`;
    const mgmt=risk==="Low risk"?`<ul><li>Carry out routine dental treatment, including extractions, as normal in primary care.</li>${common}<li>Advise the patient of the small risk and to report symptoms (e.g. pain, exposed bone, poor healing).</li></ul>`
      :risk==="Higher risk"?`<ul><li>Prioritise care that reduces mucosal trauma and may avoid future extractions or bone-impacting procedures.</li><li>Where extraction is being considered, explore reasonable alternatives (e.g. retaining roots after endodontic treatment). If extraction remains best, it can usually proceed in primary care with review of healing.</li>${common}<li>For medically complex cases, consider advice from oral surgery or special care dentistry.</li>${s.prev==="yes"?"<li>Previous MRONJ: seek specialist advice as per local protocols.</li>":""}</ul>`:"";
    const note=`MRONJ risk (SDCEP): ${risk} — ${why}`;
    el.innerHTML=outBox("MRONJ risk",esc(risk),`<p>${esc(why)}</p>${mgmt}`,true);
    document.getElementById("copyBtn").onclick=()=>copy(note);notileBtn(note);
  };
  bindSeg($app,s,draw); draw();
}

/* ---- Anticoagulants ---- */
const aState={proc:"",drug:""};
const PROC={
 unlikely:{n:"Unlikely to cause bleeding",ex:"e.g. LA by infiltration, intraligamentary or mental nerve block; BPE; supragingival scaling; restorations with supragingival margins; orthograde endodontics; impressions; orthodontic adjustments"},
 low:{n:"Low bleeding risk",ex:"e.g. simple extractions (1–3 teeth, restricted wound size); incision and drainage of swellings; 6-point pocket charting; subgingival instrumentation (RSD); restorations with subgingival margins; regional nerve blocks"},
 higher:{n:"Higher bleeding risk",ex:"e.g. complex extractions; adjacent extractions causing a large wound; more than 3 extractions at once; flap raising; gingival recontouring; biopsies"}
};
const DRUG={warfarin:"Warfarin / other VKA",apix:"Apixaban or dabigatran (twice daily)",riva:"Rivaroxaban or edoxaban (once daily)",ap:"Antiplatelet(s) — single or dual",lmwh:"Low molecular weight heparin"};
function toolAnticoag(){
  const s=aState;
  $app.innerHTML=head("anticoag")+`<div class="warn">Summary of SDCEP 2nd edition (2022). Also assess the patient's medical bleeding risk (e.g. liver disease, renal impairment, other drugs). If in doubt, check the full guidance or speak to the patient's medical team.</div>
  <div class="card"><label style="margin-top:0">Procedure</label>${seg("proc",Object.entries(PROC).map(([k,v])=>[k,v.n]),s.proc)}
  <p class="muted" id="procEx" style="margin:6px 0 0"></p>
  <label>Medication</label>${seg("drug",Object.entries(DRUG),s.drug)}</div><div id="aOut"></div>`;
  const draw=()=>{
    document.getElementById("procEx").textContent=s.proc?PROC[s.proc].ex:"";
    const el=document.getElementById("aOut");
    if(!s.proc||!s.drug){el.innerHTML=outBox("Advice","Choose a procedure and medication","");return}
    let big="",pts=[];
    const local="Use local haemostatic measures (e.g. sutures, haemostatic dressing, pressure).";
    if(s.proc==="unlikely"){big="Treat without interrupting medication";pts=["Take care to avoid unnecessary trauma."]}
    else if(s.drug==="warfarin"){big="Check INR — treat without interrupting if INR is below 4";pts=["Check INR ideally within 24 hours before treatment (up to 72 hours if INR is stably controlled).","If INR is 4 or above, delay invasive treatment or seek advice from the anticoagulant service.",local]}
    else if(s.drug==="apix"||s.drug==="riva"){
      if(s.proc==="low"){big="Treat without interrupting medication";pts=["Plan treatment early in the day.",local]}
      else if(s.drug==="apix"){big="Advise the patient to miss the morning dose";pts=["Restart the usual dose once haemostasis is achieved — see guidance for timing.","Limit the initial treatment area and consider staging treatment.",local]}
      else {big="Advise the patient to delay the morning dose";pts=["Take the delayed dose once haemostasis is achieved — see guidance for timing.","Limit the initial treatment area and consider staging treatment.",local]}
    }
    else if(s.drug==="ap"){big="Treat without interrupting medication";pts=["Dual antiplatelet therapy: expect prolonged bleeding — limit the initial treatment area and consider staging.",local]}
    else if(s.drug==="lmwh"){big="See guidance — depends on dose";pts=["Prophylactic doses: generally treat without interrupting.","Treatment doses or higher-risk procedures: consult the SDCEP guidance or the patient's medical team.",local]}
    pts.push("Give post-operative advice and emergency contact details; plan early in the day and early in the week.");
    const note=`Anticoagulant/antiplatelet (SDCEP 2022): ${DRUG[s.drug]}; ${PROC[s.proc].n.toLowerCase()} procedure. ${big}.`;
    el.innerHTML=outBox(PROC[s.proc].n+" · "+DRUG[s.drug],esc(big),`<ul>${pts.map(p=>`<li>${esc(p)}</li>`).join("")}</ul>`,true);
    document.getElementById("copyBtn").onclick=()=>copy(note);notileBtn(note);
  };
  bindSeg($app,s,draw); draw();
}

/* ---- RD-IOTN ---- */
const rdState={perio:"",endo:"",fixed:"",rem:"",pm:"",em:"",fm:"",rm:""};
function toolRD(){
  const s=rdState;
  const dom=[["perio","pm","Periodontal"],["endo","em","Root canal treatment"],["fixed","fm","Fixed prosthodontics"],["rem","rm","Removable prosthodontics"]];
  $app.innerHTML=head("rdiotn")+`<div class="warn">Score each domain with the criteria in the RCS complexity assessment document, then combine here. A modifying factor raises that domain's code by one.</div>
  <div class="card">${dom.map(([k,m,n])=>`<label>${n}</label>${seg(k,[["","N/A"],["1","1"],["2","2"],["3","3"]],s[k])}<div style="margin-top:6px">${seg(m,[["","No modifying factor"],["y","Modifying factor"]],s[m])}</div>`).join("")}
  <p class="muted" style="margin-top:12px">1 = any dental graduate · 2 = experienced practitioner · 3 = specialist level</p>
  <a href="https://www.rcseng.ac.uk/-/media/files/rcs/fds/publications/complexityassessment.pdf" target="_blank" rel="noopener">RCS complexity assessment (PDF) ↗</a></div><div id="rdOut"></div>`;
  const draw=()=>{
    const parts=dom.filter(([k])=>s[k]).map(([k,m,n])=>({n,v:Math.min(3,+s[k]+(s[m]?1:0)),mod:!!s[m]}));
    const el=document.getElementById("rdOut");
    if(!parts.length){el.innerHTML=outBox("RD-IOTN","Score at least one domain","");return}
    const top=Math.max(...parts.map(p=>p.v));
    const note=`RD-IOTN complexity: ${top} (${parts.map(p=>`${p.n.toLowerCase()} ${p.v}${p.mod?" incl. modifying factor":""}`).join("; ")}).`;
    el.innerHTML=outBox("Restorative dentistry complexity code",`Complexity ${top}`,`<ul>${parts.map(p=>`<li>${esc(p.n)}: ${p.v}${p.mod?" (incl. modifying factor)":""}</li>`).join("")}</ul>`,true);
    document.getElementById("copyBtn").onclick=()=>copy(note);notileBtn(note);
  };
  bindSeg($app,s,draw); draw();
}

