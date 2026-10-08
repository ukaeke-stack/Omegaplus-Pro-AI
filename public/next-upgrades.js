(()=>{"use strict";
const $=s=>document.querySelector(s),esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(u,o){const r=await fetch(u,o),t=await r.text();let d;try{d=t?JSON.parse(t):{}}catch{throw Error("Server returned invalid data.")}if(!r.ok)throw Error(d.error||"Request failed");return d}
function rows(){return window.omegaRows?.()||[]}
function addNav(){
 const nav=document.querySelector(".side-nav");if(!nav)return;
 const items=[["smart-picks","◆ Smart Picks"],["performance","▤ Performance"],["bet-builder","＋ Bet Builder"],["preferences","⚙ My Preferences"]];
 items.forEach(([p,l])=>{if(document.querySelector('[data-page="'+p+'"]'))return;const b=document.createElement("button");b.dataset.page=p;b.innerHTML="<span>"+l+"</span>";nav.appendChild(b)});
 const main=document.querySelector("main");items.forEach(([p])=>{if(document.getElementById("page-"+p))return;const s=document.createElement("div");s.id="page-"+p;s.className="page";s.innerHTML=page(p);main.appendChild(s)});
 document.querySelectorAll("[data-page]").forEach(b=>{if(!b.dataset.boundUpgrade){b.dataset.boundUpgrade="1";b.addEventListener("click",()=>show(b.dataset.page))}});
}
function page(p){
 if(p==="smart-picks")return '<section class="page-title"><small>AI SCANNER</small><h2>Smart Picks</h2><p>Ranked opportunities using market probability, independent statistics, confidence, risk, value and available team intelligence.</p><div class="control-actions"><button class="primary" id="smartScan">Scan Top Opportunities</button><button class="secondary" id="shareSmart">Share Picks</button></div><div class="analysis-status" id="intelStatus">Checking data sources…</div><div id="smartResults"></div></section>';
 if(p==="performance")return '<section class="page-title"><small>TRACK RECORD</small><h2>Performance Dashboard</h2><div class="calendar-picker"><input id="perfFrom" type="date"><input id="perfTo" type="date"><button class="primary" id="perfLoad">Refresh</button></div><div id="perfSummary" class="stats-row"></div><h3>League Performance</h3><div id="perfLeagues"></div><h3>Market Performance</h3><div id="perfMarkets"></div></section>';
 if(p==="bet-builder")return '<section class="page-title"><small>COMBINATION ANALYSIS</small><h2>AI Bet Builder</h2><p>Build a short combination from analyzed predictions. Conservative uses 82%+ confidence; Balanced uses 72%+.</p><div class="control-actions"><button class="primary" id="buildConservative">Build Conservative</button><button class="secondary" id="buildBalanced">Build Balanced</button></div><div id="builderResults"></div></section>';
 return '<section class="page-title"><small>PERSONALIZATION</small><h2>My Preferences</h2><p>Save your preferred sport, risk profile, minimum confidence and odds range on this device.</p><div class="support-card"><label>Preferred sport<select id="prefSport"><option value="football">Football</option><option value="basketball">Basketball</option></select></label><label>Risk profile<select id="prefRisk"><option>Conservative</option><option selected>Balanced</option><option>Aggressive</option></select></label><label>Minimum confidence<input id="prefConfidence" type="number" min="50" max="99" value="70"></label><label>Minimum odds<input id="prefOdds" type="number" min="1.01" step=".01" value="1.10"></label><label><input id="prefNotify" type="checkbox"> Enable browser alerts</label><button class="primary" id="savePrefs">Save Preferences</button><div id="prefStatus" class="analysis-status"></div></div>';
}
function show(p){document.querySelectorAll(".page").forEach(x=>x.classList.remove("active-page"));$("#page-"+p)?.classList.add("active-page");document.querySelectorAll("[data-page]").forEach(x=>x.classList.toggle("active",x.dataset.page===p));if(p==="smart-picks")smart();if(p==="performance")performance();if(p==="bet-builder")builder();if(p==="preferences")prefs()}
async function smart(){
 const box=$("#smartResults");if(!box)return;
 $("#smartScan").onclick=smart;
 $("#shareSmart").onclick=async()=>{const text="Omegaplus Pro AI — Smart Picks\n"+(box.innerText||"");if(navigator.share)await navigator.share({title:"Omegaplus Pro AI",text});else{await navigator.clipboard?.writeText(text);alert("Prediction summary copied.");}};
 box.innerHTML='<div class="empty">Scanning…</div>';
 try{
   const date=window.omegaStateDate?.()||new Date().toISOString().slice(0,10),sport=window.omegaSport?.()||"football";
   const [d,status]=await Promise.all([api("/api/smart-picks?date="+encodeURIComponent(date)+"&sport="+encodeURIComponent(sport)),api("/api/intelligence-status")]);
   const p=status.providers||{};$("#intelStatus").textContent="Sources: SofaScore "+(p.sofascore?"ready":"unavailable")+" · Understat "+(p.understat?"ready":"unavailable")+" · lineups/injuries only when published · odds history "+(p.oddsHistory?"enabled":"unavailable");
   const rows=d.predictions||[];
   box.innerHTML=rows.length?rows.map((x,i)=>'<article class="match compact" data-smart-id="'+esc(x.id)+'"><div><div class="meta">#'+(i+1)+' · '+esc(x.league)+' · '+esc(x.time)+'</div><div class="teams">'+esc(x.home)+' <span>vs</span> '+esc(x.away)+'</div><div class="pick"><span>'+esc(x.market)+' · Odds '+esc(Number(x.odds||0).toFixed(2))+'</span><b>'+esc(x.pick)+'</b></div><small>Confidence '+esc(x.confidence)+'% · Risk '+esc(x.risk)+' · Value '+esc(x.valueRating)+'</small><div class="compact"><small>'+esc((x.reasons||[]).slice(0,2).join(" "))+'</small></div><button class="secondary report-btn" data-report-id="'+esc(x.id)+'">AI Match Report</button></div><div class="prob"><strong>'+esc(x.confidence)+'%</strong></div></article>').join(""):'<div class="empty">No qualifying opportunities found.</div>';
   box.querySelectorAll(".report-btn").forEach(b=>b.onclick=async()=>{const x=rows.find(q=>q.id===b.dataset.reportId);if(!x)return;try{const d=await api("/api/match-report",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prediction:x})});const r=d.report||{};alert(r.headline+"\n\nConfidence: "+r.confidence+"%\nRisk: "+r.risk+"\nValue: "+r.value+"\n\n"+(r.strengths||[]).join("\n")+"\n\nCautions:\n"+(r.cautions||[]).join("\n"))}catch(e){alert(e.message)}});
 }catch(e){box.innerHTML='<div class="empty">'+esc(e.message)+'</div>'}
}
async function performance(){
 const f=$("#perfFrom"),t=$("#perfTo");if(!f||!t)return;const today=new Date().toISOString().slice(0,10);if(!f.value)f.value=today;if(!t.value)t.value=today;
 const load=async()=>{const d=await api("/api/performance-advanced?from="+f.value+"&to="+t.value);$("#perfSummary").innerHTML='<div class="metric"><span>Predictions</span><b>'+d.totalPredictions+'</b><em>'+d.settled+' settled</em></div><div class="metric"><span>Won</span><b>'+d.won+'</b><em>Confirmed</em></div><div class="metric"><span>Lost</span><b>'+d.lost+'</b><em>Confirmed</em></div><div class="metric"><span>Accuracy</span><b>'+((d.accuracy??"—"))+(d.accuracy!=null?"%":"")+'</b><em>Settled only</em></div>';
 $("#perfLeagues").innerHTML=Object.entries(d.byLeague||{}).sort((a,b)=>(b[1].won/(b[1].total||1))-(a[1].won/(a[1].total||1))).map(([k,v])=>'<article class="match compact"><div><b>'+esc(k)+'</b><small>'+v.won+' wins · '+v.lost+' losses</small></div><strong>'+Math.round(v.won/(v.total||1)*100)+'%</strong></article>').join("")||'<div class="empty">No settled league records yet.</div>';
 $("#perfMarkets").innerHTML=Object.entries(d.byMarket||{}).map(([k,v])=>'<article class="match compact"><div><b>'+esc(k)+'</b><small>'+v.won+' wins · '+v.lost+' losses</small></div><strong>'+Math.round(v.won/(v.total||1)*100)+'%</strong></article>').join("")||'<div class="empty">No settled market records yet.</div>';};
 $("#perfLoad").onclick=()=>load().catch(e=>alert(e.message));load().catch(e=>{$("#perfLeagues").innerHTML='<div class="empty">'+esc(e.message)+'</div>'});
}
function builder(){
 const box=$("#builderResults");const build=async mode=>{const source=rows();if(!source.length){box.innerHTML='<div class="empty">Analyze fixtures first, then open Bet Builder.</div>';return}box.innerHTML='<div class="empty">Building…</div>';try{const d=await api("/api/bet-builder",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({mode,predictions:source})});const rs=d.predictions||[];box.innerHTML=rs.length?'<div class="support-card"><h3>'+mode+' builder</h3>'+rs.map(x=>'<div class="history-item"><div><b>'+esc(x.home)+' vs '+esc(x.away)+'</b><small>'+esc(x.pick)+' · '+esc(x.market)+' · '+esc(x.odds)+'</small></div><strong>'+esc(x.confidence)+'%</strong></div>').join("")+'</div>':'<div class="empty">No predictions meet the '+mode+' threshold.</div>'}catch(e){box.innerHTML='<div class="empty">'+esc(e.message)+'</div>'}};
 $("#buildConservative").onclick=()=>build("conservative");$("#buildBalanced").onclick=()=>build("balanced");build("conservative");
}
function prefs(){
 const p=JSON.parse(localStorage.getItem("omegaplus_preferences_v1")||"{}");const map={Sport:"sport",Risk:"risk",Confidence:"confidence",Odds:"odds",Notify:"notify"};
 Object.entries(map).forEach(([id,key])=>{const e=$("#pref"+id);if(e&&p[key]!=null)e.type==="checkbox"?e.checked=!!p[key]:e.value=p[key]});
 $("#savePrefs").onclick=async()=>{const p={sport:$("#prefSport").value,risk:$("#prefRisk").value,confidence:Number($("#prefConfidence").value),odds:Number($("#prefOdds").value),notify:$("#prefNotify").checked};localStorage.setItem("omegaplus_preferences_v1",JSON.stringify(p));if(p.notify&&"Notification"in window&&Notification.permission==="default")await Notification.requestPermission();$("#prefStatus").textContent="Preferences saved."};
}
window.addEventListener("load",addNav);
})();