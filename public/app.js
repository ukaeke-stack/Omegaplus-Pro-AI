const $=s=>document.querySelector(s);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const today=()=>new Date().toLocaleDateString("en-CA",{timeZone:"Africa/Lagos"});
const state={dates:[today()],leagues:[],markets:new Set(["ou"]),options:new Set(["Over 1.5"]),risk:"balanced",minConfidence:0,rows:[],slip:new Map(),fixtures:[],view:"dashboard"};
const marketNames={ou:"Goals Over/Under",one:"1X2",btts:"BTTS",handicap:"Handicap",corners:"Corners",cards:"Cards"};
const marketTypes={ou:["Over 0.5","Over 1.5","Over 2.5","Over 3.5","Under 1.5","Under 2.5","Under 3.5"],one:["Home","Draw","Away"],btts:["Yes","No"],handicap:["Home","Away"],corners:["Over 7.5","Over 8.5","Over 9.5","Under 9.5","Under 10.5"],cards:["Over 2.5","Over 3.5","Over 4.5","Under 4.5","Under 5.5"]};
const api=async(url,opt)=>{const r=await fetch(url,opt);const d=await r.json();if(!r.ok||d.ok===false)throw Error(d.error||"Request failed");return d};
function toast(msg){const el=$("#toast");el.textContent=msg;el.classList.add("show");clearTimeout(window.__toast);window.__toast=setTimeout(()=>el.classList.remove("show"),2800)}
function show(view){state.view=view;document.querySelectorAll(".view").forEach(x=>x.classList.toggle("active",x.id===view));document.querySelectorAll("#nav button").forEach(x=>x.classList.toggle("active",x.dataset.view===view));window.scrollTo({top:0,behavior:"smooth"});if(view==="accumulator")renderSlip();if(view==="history")loadHistory();if(view==="leaderboard")loadLeaderboard()}
document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>show(b.dataset.view));
document.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>show(b.dataset.go));
$("#menu").onclick=()=>$("#sidebar").classList.toggle("open");

function renderDates(){const box=$("#dateChips");box.innerHTML=state.dates.map(d=>'<button class="date-chip" data-date="'+d+'">'+d+' ×</button>').join("");box.querySelectorAll("button").forEach(b=>b.onclick=()=>{if(state.dates.length>1){state.dates=state.dates.filter(d=>d!==b.dataset.date);loadFilters()}})}
function renderSegmented(){
 $("#risk").innerHTML=[["safe","Safe"],["balanced","Balanced"],["gobig","Go big"]].map(([v,t])=>'<button class="'+(state.risk===v?"selected":"")+'" data-risk="'+v+'">'+t+'</button>').join("");
 $("#risk").querySelectorAll("button").forEach(b=>b.onclick=()=>{state.risk=b.dataset.risk;renderSegmented()});
 $("#confidence").innerHTML=[[0,"Any"],[50,"50%+"],[65,"65%+"],[80,"80%+"]].map(([v,t])=>'<button class="'+(state.minConfidence===v?"selected":"")+'" data-conf="'+v+'">'+t+'</button>').join("");
 $("#confidence").querySelectorAll("button").forEach(b=>b.onclick=()=>{state.minConfidence=Number(b.dataset.conf);renderSegmented()});
}
function renderMarkets(){
 $("#markets").innerHTML=Object.entries(marketNames).map(([k,v])=>'<label class="chip"><input type="checkbox" value="'+k+'" '+(state.markets.has(k)?"checked":"")+'><span>'+v+'</span></label>').join("");
 $("#markets").querySelectorAll("input").forEach(i=>i.onchange=()=>{if(i.checked)state.markets.add(i.value);else state.markets.delete(i.value);if(!state.markets.size){state.markets.add("ou");toast("At least one market is required")}renderMarkets()});
 const values=[...state.markets].flatMap(k=>marketTypes[k]||[]);
 const unique=[...new Set(values)];
 state.options=new Set([...state.options].filter(x=>unique.includes(x)));
 if(!state.options.size&&unique.length)state.options.add(unique.includes("Over 1.5")?"Over 1.5":unique[0]);
 $("#options").innerHTML=unique.map(v=>'<label class="chip"><input type="checkbox" value="'+esc(v)+'" '+(state.options.has(v)?"checked":"")+'><span>'+esc(v)+'</span></label>').join("");
 $("#options").querySelectorAll("input").forEach(i=>i.onchange=()=>{if(i.checked)state.options.add(i.value);else state.options.delete(i.value);renderMarkets()});
}
async function loadFilters(){
 renderDates();renderSegmented();renderMarkets();
 const d=await api("/api/leagues?dates="+encodeURIComponent(state.dates.join(",")));
 state.leagues=d.leagues||[];
 $("#leagues").innerHTML=state.leagues.map(x=>'<label class="league"><input type="checkbox" value="'+esc(x)+'"><span>'+esc(x)+'</span></label>').join("")||'<div class="muted">No leagues returned for these dates.</div>';
 const f=await api("/api/fixtures?dates="+encodeURIComponent(state.dates.join(",")));
 $("#dashFixtures").textContent=f.total??0;$("#availableCount")?.replaceChildren();
 $("#pickStatus").textContent=(f.total||0)+" fixtures available across "+state.dates.length+" date(s).";
 state.fixtures=f.fixtures||[];fillFixtureSelect(state.fixtures);renderDates();
}
function fillFixtureSelect(rows){
 const q=($("#fixtureSearch")?.value||"").toLowerCase();
 const list=rows.filter(x=>(x.home+" "+x.away+" "+x.league).toLowerCase().includes(q));
 $("#fixtureSelect").innerHTML='<option value="">Select a fixture</option>'+list.map(x=>'<option value="'+x.eventId+'">'+esc(x.home)+' vs '+esc(x.away)+' · '+esc(x.league)+' · '+esc(x.date)+' '+esc(x.time)+'</option>').join("");
}
$("#fixtureSearch").oninput=()=>fillFixtureSelect(state.fixtures);

function pickCard(r){
 const selected=state.slip.has(r.id);
 return '<article class="pick '+(selected?"picked":"")+'"><div class="picktop"><span>'+esc(r.league)+' · '+esc(r.date)+' · '+esc(r.time)+'</span><b>'+r.confidence+'%</b></div><div class="teams"><strong>'+esc(r.home)+'</strong><i>vs</i><strong>'+esc(r.away)+'</strong></div><div class="pickline"><strong>'+esc(r.pick)+'</strong><span>'+esc(r.market)+' · @'+Number(r.odds).toFixed(2)+'</span></div><div class="pickmeta"><span class="badge">'+esc(r.band)+'</span><span>Model '+r.modelProbability+'%</span><span>Fair '+Number(r.fairOdds).toFixed(2)+'</span></div><p class="insight">'+esc(r.insight||"Market-derived probability signal.")+'</p><div class="pickactions"><button data-add="'+esc(r.id)+'">'+(selected?"Remove":"Add to slip")+'</button><button data-detail="'+esc(r.eventId)+'">Full analysis</button><button data-save="'+esc(r.id)+'">Save</button></div></article>';
}
function renderPicks(){
 $("#pickResults").innerHTML=state.rows.length?state.rows.map(pickCard).join(""):'<div class="empty">No qualifying picks. Broaden the date, league, market or confidence filter.</div>';
 $("#pickResults").querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>toggleSlip(b.dataset.add));
 $("#pickResults").querySelectorAll("[data-detail]").forEach(b=>b.onclick=()=>openMatch(b.dataset.detail));
 $("#pickResults").querySelectorAll("[data-save]").forEach(b=>b.onclick=()=>saveRow(b.dataset.save));
 $("#dashSlip").textContent=state.slip.size;
}
async function analyze(){
 const leagues=[...document.querySelectorAll("#leagues input:checked")].map(x=>x.value);
 const limit=Math.max(1,Math.min(50,Number($("#limit").value)||20));
 $("#analyze").disabled=true;$("#pickStatus").textContent="Analyzing live markets…";
 try{
  const d=await api("/api/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({dates:state.dates,leagues,marketTypes:[...state.markets].map(x=>x==="one"?"1x2":x),selections:[...state.options],maxGames:limit,risk:state.risk,minConfidence:state.minConfidence})});
  state.rows=d.predictions||[];renderPicks();$("#pickStatus").textContent=d.total+" unique fixtures ranked from "+d.available+" qualifying market signals.";
 }catch(e){$("#pickStatus").textContent=e.message;toast(e.message)}finally{$("#analyze").disabled=false}
}
function toggleSlip(id){const r=state.rows.find(x=>x.id===id);if(!r)return;if(state.slip.has(id))state.slip.delete(id);else state.slip.set(id,r);renderPicks();renderSlip()}
function saveRow(id){const r=state.rows.find(x=>x.id===id);if(!r)return;api("/api/history",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...r,result:"pending"})}).then(()=>toast("Selection saved to Track Record")).catch(e=>toast(e.message))}
async function openMatch(id){show("predictor");$("#fixtureSelect").value=id;await analyzeFixture(id)}
async function analyzeFixture(id){
 if(!id)return toast("Select a fixture first");
 $("#matchPanel").innerHTML='<div class="status">Loading all supported markets…</div>';
 try{const d=await api("/api/match-analysis",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({eventId:id})});const f=d.fixture;$("#matchPanel").innerHTML='<div class="panel matchhead"><div class="eyebrow">'+esc(f.league)+' · '+esc(f.date)+' '+esc(f.time)+'</div><h3>'+esc(f.home)+' <i>vs</i> '+esc(f.away)+'</h3></div><div class="market-results">'+(d.predictions||[]).map(pickCard).join("")+'</div>';$("#matchPanel").querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>{toggleSlip(b.dataset.add);analyzeFixture(id)});}catch(e){$("#matchPanel").innerHTML='<div class="empty">'+esc(e.message)+'</div>'}
}
function renderSlip(){
 const rows=[...state.slip.values()];
 $("#accaSummary").innerHTML='<div class="slip-total"><span>'+rows.length+' legs</span><b>'+rows.reduce((a,x)=>a*Number(x.odds||1),1).toFixed(2)+'x</b><small>combined decimal odds</small></div>';
 $("#accaList").innerHTML=rows.length?rows.map(x=>'<div class="sliprow"><div><b>'+esc(x.home)+' vs '+esc(x.away)+'</b><small>'+esc(x.pick)+' · '+esc(x.market)+' · '+x.confidence+'%</small></div><button data-remove="'+esc(x.id)+'">×</button></div>').join(""):'<div class="empty">Your slip is empty. Add picks from AI Picks or Match Predictor.</div>';
 $("#accaList").querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>{state.slip.delete(b.dataset.remove);renderSlip();renderPicks()});
 $("#dashSlip").textContent=rows.length;
}
$("#booking").onclick=async()=>{const rows=[...state.slip.values()];if(!rows.length)return toast("Add at least one pick.");$("#booking").disabled=true;try{const d=await api("/api/booking-code",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({selections:rows})});$("#bookingBox").hidden=false;$("#bookingBox").innerHTML='<b>SportyBet booking code</b><strong>'+esc(d.bookingCode)+'</strong>'+(d.shareURL?'<a href="'+esc(d.shareURL)+'" target="_blank" rel="noopener">Open share link →</a>':"");toast("Booking code generated from SportyBet");}catch(e){toast(e.message)}finally{$("#booking").disabled=false}};
$("#clearSlip").onclick=()=>{state.slip.clear();renderSlip();renderPicks()};
$("#predictFixture").onclick=()=>analyzeFixture($("#fixtureSelect").value);

async function loadHistory(){
 try{const d=await api("/api/history");const h=d.history||[];const settled=h.filter(x=>x.result==="win"||x.result==="loss");const wins=settled.filter(x=>x.result==="win").length;$("#historyStats").innerHTML='<div><small>SAVED</small><b>'+h.length+'</b></div><div><small>SETTLED</small><b>'+settled.length+'</b></div><div><small>WINS</small><b>'+wins+'</b></div><div><small>HIT RATE</small><b>'+ (settled.length?Math.round(wins/settled.length*100):"—")+'%</b></div>';$("#historyTable").innerHTML=h.length?'<div class="tablehead"><span>Fixture</span><span>Pick</span><span>Confidence</span><span>Result</span></div>'+h.map(x=>'<div class="tablerow"><span>'+esc(x.home)+' vs '+esc(x.away)+'<small>'+esc(x.league)+' · '+esc(x.date||"")+'</small></span><span>'+esc(x.pick||"—")+'</span><span>'+esc(x.confidence||"—")+'%</span><span>'+esc(x.result||"pending")+'</span></div>').join(""):'<div class="empty">No saved selections yet.</div>'}catch(e){toast(e.message)}
}
async function loadLeaderboard(){
 try{const d=await api("/api/leaderboard");$("#leaderboardTable").innerHTML='<div class="leader-summary"><b>'+d.totalPicks+'</b><span>saved picks</span><b>'+(d.hitRate??"—")+'%</b><span>settled hit rate</span></div>'+(d.leagues||[]).length?'<div class="tablehead"><span>League</span><span>Picks</span><span>Settled</span><span>Hit rate</span></div>'+(d.leagues||[]).map((x,i)=>'<div class="tablerow"><span>#'+(i+1)+' '+esc(x.league)+'</span><span>'+x.picks+'</span><span>'+x.settled+'</span><span>'+ (x.hitRate==null?"—":x.hitRate+"%")+'</span></div>').join(""):'<div class="empty">No saved league record yet.</div>'}catch(e){toast(e.message)}
}
function coachAnswer(q){
 const s=q.toLowerCase(),rows=[...state.slip.values()];
 if(s.includes("fair odds"))return "Fair odds are 1 divided by the model probability. For example, 80% corresponds to 1.25. It is a reference price, not a guaranteed bookmaker price.";
 if(s.includes("confidence"))return rows.length?"Confidence is the normalized probability signal shown on each selection. Higher is stronger, but it never means certain.":"Open AI Picks and add a selection first.";
 if(s.includes("slip")||s.includes("accumulator"))return "An accumulator requires every leg to win. The combined odds multiply together, while the probability of the whole slip is lower than the probability of any single leg.";
 if(s.includes("booking")||s.includes("code"))return "The booking code is requested from SportyBet after the selected event, market, specifier and outcome are revalidated.";
 if(s.includes("risk"))return "Safe filters for stronger confidence signals, Balanced keeps the middle of the range, and Go big surfaces lower-confidence selections. These are filters, not guarantees.";
 return "I can explain confidence, fair odds, risk, accumulators, market signals and the SportyBet booking-code flow. Ask one of those.";
}
$("#coachSend").onclick=()=>{const q=$("#coachInput").value.trim();if(!q)return;$("#coachMessages").innerHTML+='<div class="coach-msg user">'+esc(q)+'</div><div class="coach-msg">'+esc(coachAnswer(q))+'</div>';$("#coachInput").value=""};
$("#coachInput").onkeydown=e=>{if(e.key==="Enter")$("#coachSend").click()};

$("#addDate").onclick=()=>{const d=$("#dateInput").value;if(d&&!state.dates.includes(d)){state.dates.push(d);state.dates.sort();loadFilters().catch(e=>toast(e.message))}};
$("#today").onclick=()=>{state.dates=[today()];loadFilters().catch(e=>toast(e.message))};
$("#refresh").onclick=()=>loadFilters().catch(e=>toast(e.message));
$("#toggleLeagues").onclick=()=>{const boxes=[...document.querySelectorAll("#leagues input")],all=boxes.every(x=>x.checked);boxes.forEach(x=>x.checked=!all);$("#toggleLeagues").textContent=all?"Select all":"Clear all"};
$("#saveSettings").onclick=()=>{localStorage.setItem("omegaProfile",JSON.stringify({name:$("#profileName").value,fav:$("#favLeagues").value,risk:$("#defaultRisk").value}));$("#settingsSaved").textContent="Preferences saved on this device."};
function loadSettings(){try{const p=JSON.parse(localStorage.getItem("omegaProfile")||"{}");$("#profileName").value=p.name||"";$("#favLeagues").value=p.fav||"";$("#defaultRisk").value=p.risk||"balanced"}catch{}}
async function boot(){
 loadSettings();renderDates();renderSegmented();renderMarkets();renderSlip();
 try{const h=await api("/api/health");$("#dashStatus").textContent="Online";$("#dashFixtures").textContent=h.fixtureCount??"—"}catch{$("#dashStatus").textContent="Feed check failed"}
 try{await loadFilters();$("#dashLeagues").textContent=state.leagues.length}catch(e){toast(e.message)}
}
boot();
