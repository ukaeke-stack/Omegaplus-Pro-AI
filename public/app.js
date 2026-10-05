const state={rows:[],selected:new Map(),markets:new Set(["ou"]),selections:new Set(["Over 1.5"]),date:"",dates:new Set()};
const marketCatalog=window.OMEGA_MARKET_OPTIONS||{};
const marketNames=Object.fromEntries(Object.entries(marketCatalog).map(([id,x])=>[id,x.name]));
const marketOptionSets=Object.fromEntries(Object.entries(marketCatalog).map(([id,x])=>[id,(x.options||[]).map(o=>o.label)]));
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad=n=>String(n).padStart(2,"0");
const dateKey=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const prettyDate=v=>v?new Date(v+"T00:00:00").toLocaleDateString("en-NG",{weekday:"short",day:"numeric",month:"short",year:"numeric"}):"—";
function setStatus(t){$("#analysisStatus").textContent=t}
function setDate(v){state.date=v;state.dates.add(v);$("#fixtureDate").value=v;$("#calendarDate").value=v;$("#selectedDateMetric").textContent=v.slice(5).replace("-","/");renderDateChips();}
function shiftDate(days){const d=new Date(state.date+"T00:00:00");d.setDate(d.getDate()+days);return dateKey(d)}
function selectedLeagues(){return $("#league")?[...$("#league").selectedOptions].map(o=>o.value):[]}
function renderDateChips(){
  const box=$("#selectedDates");if(!box)return;
  box.innerHTML=[...state.dates].sort().map(d=>'<button class="date-chip" data-date="'+esc(d)+'">'+esc(prettyDate(d))+' ×</button>').join("");
  $$("#selectedDates .date-chip").forEach(b=>b.onclick=()=>{state.dates.delete(b.dataset.date);if(!state.dates.size)state.dates.add(state.date);renderDateChips()});
}
function historyKey(){return "omegaplus_history_v3"}
function archiveKey(){return "omegaplus_day_archive_v1"}
function readArchive(){try{return JSON.parse(localStorage.getItem(archiveKey())||"{}")}catch{return{}}}
function writeArchive(a){try{localStorage.setItem(archiveKey(),JSON.stringify(a));return true}catch{return false}}
function archiveDay(date,payload={}){const a=readArchive();a[date]={...(a[date]||{}),...payload,savedAt:new Date().toISOString()};writeArchive(a)}
function readHistory(){try{return JSON.parse(localStorage.getItem(historyKey())||"[]")}catch{return[]}}
function writeHistory(rows){try{localStorage.setItem(historyKey(),JSON.stringify(rows.slice(-2000)));return true}catch{return false}}
function saveHistoryRows(rows,replaceDate=null){
  const history=readHistory();
  const targetDate=replaceDate||state.date;
  const kept=history.filter(x=>x.date!==targetDate);
  const now=new Date().toISOString();
  const fresh=rows.slice(0,10).map(x=>({id:x.id,date:x.date||targetDate,eventId:x.eventId,league:x.league,time:x.time,home:x.home,away:x.away,pick:x.pick,market:x.market,odds:x.odds,confidence:x.confidence,status:x.matchStatus||"Not start",homeScore:x.homeScore??null,awayScore:x.awayScore??null,outcome:x.outcome||"Pending",resultProviderId:x.resultProviderId||null,recordedAt:now}));
  return writeHistory([...kept,...fresh].filter((x,i,a)=>a.findIndex(y=>y.date===x.date&&y.eventId===x.eventId&&y.id===x.id)===i));
}

function settleOutcome(x){
  const status=String(x.status||x.matchStatus||"").toLowerCase();
  if(/postpon|cancel|void|abandon|suspend/.test(status))return /postpon|cancel|void/.test(status)?"Postponed":"Pending";
  const finished=/finished|full.?time|ended|closed|complete|final|\bft\b|after extra|penalt(y|ies)/i.test(status);
  // A 0-0 (or any current score) from a scheduled/live fixture is NOT a final result.
  // Only settle a prediction after the provider explicitly reports a completed match.
  if(!finished)return "Pending";
  const hs=Number(x.homeScore),as=Number(x.awayScore),pick=String(x.pick||"").toLowerCase();
  if(!Number.isFinite(hs)||!Number.isFinite(as))return "Pending";
  const total=hs+as,m=pick.match(/over\s*(\d+(?:\.\d+)?)/),u=pick.match(/under\s*(\d+(?:\.\d+)?)/);
  if(m)return total>Number(m[1])?"Won":"Lost";
  if(u)return total<Number(u[1])?"Won":"Lost";
  if(pick.includes("home"))return hs>as?"Won":"Lost";
  if(pick.includes("away"))return as>hs?"Won":"Lost";
  if(pick.includes("draw"))return hs===as?"Won":"Lost";
  return "Finished";
}
function historySelectedDate(){
  return $("#historyDate")?.value||dateKey(new Date());
}
function renderHistory(date=historySelectedDate(),fallbackRows=[]){
  const box=$("#historyList");if(!box)return;
  const all=readHistory();
  let h=all.filter(x=>x.date===date).sort((a,b)=>Number(b.confidence||0)-Number(a.confidence||0)||String(a.time).localeCompare(String(b.time))).slice(0,10);
  if(!h.length&&fallbackRows.length){
    const now=new Date().toISOString();
    h=fallbackRows.slice(0,10).map(x=>({id:x.id,date:x.date||date,eventId:x.eventId,league:x.league,time:x.time,home:x.home,away:x.away,pick:x.pick||"Prediction",market:x.market||"Goals Over/Under",odds:x.odds??"—",confidence:Number(x.confidence||0),status:x.matchStatus||"Not start",homeScore:x.homeScore??null,awayScore:x.awayScore??null,outcome:settleOutcome(x),recordedAt:now}));
  }
  $("#historyStatus").textContent=h.length
    ? h.length+" record(s) for "+prettyDate(date)+"."
    : "No prediction records saved for "+prettyDate(date)+".";
  box.innerHTML=h.length?h.map(x=>'<article class="history-item"><div><small>'+esc(prettyDate(x.date))+' · '+esc(x.league)+'</small><b>'+esc(x.home)+' vs '+esc(x.away)+'</b><span>'+esc(x.pick)+' · '+esc(x.confidence)+'% · @'+esc(x.odds)+'</span></div><strong>'+esc(x.outcome)+'</strong></article>').join(""):'<div class="empty">No records for this date.</div>';
}
async function refreshHistory(date=historySelectedDate()){
  let h=readHistory(),fallback=[];
  try{
    const archiveResponse=await (await fetch("/api/history?date="+encodeURIComponent(date))).json();
    const archive=archiveResponse.ok&&archiveResponse.archive?archiveResponse.archive:null;
    let day=(archive?.predictions||[]).slice(0,10).map(x=>({...x,date}));
    if(!day.length){
      const data=await (await fetch("/api/predictions?date="+encodeURIComponent(date))).json();
      const liveRows=data.predictions||[];
      day=h.filter(x=>x.date===date).sort((a,b)=>Number(b.confidence||0)-Number(a.confidence||0)||String(a.time).localeCompare(String(b.time))).slice(0,10);
      if(!day.length){
        try{const analyzed=await (await fetch("/api/daily-best?date="+encodeURIComponent(date))).json();fallback=(analyzed.predictions||[]).slice(0,10).map(x=>({...x,date}));}catch{}
        if(!fallback.length)fallback=liveRows.slice(0,10).map(x=>({...x,date,pick:"Fixture",market:"Fixture",confidence:0,odds:"—"}));
        day=fallback;
      }
    }
    let resultRows=Array.isArray(archive?.results)?archive.results:[];
    try{const rr=await (await fetch("/api/results?date="+encodeURIComponent(date))).json();if(rr.ok)resultRows=rr.results||resultRows;}catch{}
    const norm=v=>String(v||"").toLowerCase().normalize("NFKD").replace(/[\\u0300-\\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
    const findResult=x=>resultRows.find(r=>x.resultProviderId&&String(r.providerId)===String(x.resultProviderId))||resultRows.find(r=>norm(r.home)===norm(x.home)&&norm(r.away)===norm(x.away));
    const liveData=await (await fetch("/api/predictions?date="+encodeURIComponent(date))).json().catch(()=>({predictions:[]}));
    const live=new Map((liveData.predictions||[]).map(x=>[x.eventId,x]));
    day.forEach(x=>{const y=live.get(x.eventId),z=findResult(x);if(y){x.status=y.matchStatus||x.status;x.homeScore=y.homeScore??x.homeScore;x.awayScore=y.awayScore??x.awayScore}if(z){x.status=z.status||x.status;x.homeScore=z.homeScore??x.homeScore;x.awayScore=z.awayScore??x.awayScore;x.resultProviderId=z.providerId||x.resultProviderId}x.outcome=settleOutcome(x)});
    writeHistory([...h.filter(x=>x.date!==date),...day]);
    archiveDay(date,{history:day,results:resultRows});
    try{await fetch("/api/history",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({date,predictions:day,results:resultRows})});}catch{}
    renderHistory(date,day);
  }catch{
    const day=h.filter(x=>x.date===date).sort((a,b)=>Number(b.confidence||0)-Number(a.confidence||0)||String(a.time).localeCompare(String(b.time))).slice(0,10);
    renderHistory(date,day);
  }
}
function renderDropdown(id,items,selectedSet){
  const el=$(id);if(!el)return;
  el.innerHTML=items.map(x=>'<option value="'+esc(x.value??x.label??x)+'" '+(selectedSet.has(x.value??x.label??x)?"selected":"")+'>'+esc(x.label??x)+'</option>').join("");
}
function renderMarketOptions(){
  const items=Object.entries(marketCatalog).map(([id,x])=>({value:id,label:x.name}));
  renderDropdown("#marketOptions",items,state.markets);
  $("#marketCount").textContent=state.markets.size+" selected";
}
function renderSelectionOptions(){
  const options=[...state.markets].flatMap(k=>(marketCatalog[k]?.options||[]).map(o=>({value:o.label,label:o.label})));
  const seen=new Set(),unique=options.filter(o=>!seen.has(o.value)&&seen.add(o.value));
  state.selections=new Set([...state.selections].filter(x=>unique.some(o=>o.value===x)));
  if(!state.selections.size&&unique.length)state.selections.add(unique.some(o=>o.value==="Over 1.5")?"Over 1.5":unique[0].value);
  renderDropdown("#selectionOptions",unique,state.selections);
  $("#selectionCount").textContent=state.selections.size+" selected";
}
function bindMarketDropdowns(){
  $("#marketOptions").onchange=()=>{state.markets=new Set([...$("#marketOptions").selectedOptions].map(o=>o.value));if(!state.markets.size)state.markets.add("ou");renderMarketOptions();renderSelectionOptions()};
  $("#selectionOptions").onchange=()=>{state.selections=new Set([...$("#selectionOptions").selectedOptions].map(o=>o.value));if(!state.selections.size){const first=(marketCatalog[[...state.markets][0]]?.options||[])[0];if(first)state.selections.add(first.label)}renderSelectionOptions()};
}
async function loadLeagues(){
  try{
    const d=await (await fetch("/api/leagues?date="+encodeURIComponent(state.date))).json();
    const chosen=new Set(selectedLeagues());
    const leagues=d.leagues||[];
    $("#league").innerHTML=leagues.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("");
    $$("#league option").forEach(o=>o.selected=chosen.has(o.value));
    $("#leagueCount").textContent=(selectedLeagues().length?selectedLeagues().length+" selected":"All leagues");
  }catch(e){setStatus("Could not load leagues for "+prettyDate(state.date)+".")}
}
async function loadBase(){
  try{
    const d=await (await fetch("/api/predictions?date="+encodeURIComponent(state.date))).json();
    state.rows=d.predictions||[];$("#predictionTotal").textContent=state.rows.length;
    archiveDay(state.date,{fixtures:state.rows});
    setStatus("Daily archive ready for "+prettyDate(state.date)+".");
  }catch(e){state.rows=[];$("#predictionTotal").textContent="—";setStatus("Live SportyBet data is temporarily unavailable.")}
}
function renderRows(){
  if(!state.rows.length){$("#matches").innerHTML='<div class="empty">No games matched this date and filter.</div>';return}
  $("#matches").innerHTML=state.rows.map(x=>{
    const selected=state.selected.has(x.id);
    return '<article class="match"><div><div class="meta">'+esc(x.league)+' · '+esc(x.time)+'</div><div class="teams">'+esc(x.home)+' <span>vs</span> '+esc(x.away)+'</div><div class="pick"><span>'+esc(x.market)+' · '+esc(x.specifier||"")+'</span><b>'+esc(x.pick)+'</b></div><div class="pick"><span>Odds '+esc(x.odds)+'</span><b>'+esc(x.confidenceLabel)+'</b></div><button class="select '+(selected?"selected":"")+'" data-id="'+esc(x.id)+'">'+(selected?"Remove from slip":"Add to slip")+'</button></div><div class="prob"><strong>'+esc(x.confidence)+'%</strong><div class="bar"><i style="width:'+esc(x.confidence)+'%"></i></div><small>Confidence</small></div></article>';
  }).join("");
  $$(".select").forEach(b=>b.onclick=()=>{const row=state.rows.find(x=>x.id===b.dataset.id);if(!row)return;if(state.selected.has(row.id))state.selected.delete(row.id);else if(state.selected.size<50)state.selected.set(row.id,row);else return alert("Maximum 50 selections.");renderRows();renderSlip()});
}
function renderSlip(){
  const rows=[...state.selected.values()];$("#slipCount").textContent=rows.length;$("#selectedHome").textContent=rows.length;
  $("#slip").innerHTML=rows.length?rows.map(x=>'<div class="slipitem"><b>'+esc(x.home)+' vs '+esc(x.away)+'</b><small>'+esc(x.pick)+' · '+esc(x.confidence)+'% · @'+esc(x.odds)+'</small></div>').join(""):"<p>Select analyzed matches to build your slip.</p>";
}
async function analyze(){
  const leagues=selectedLeagues(),marketTypes=[...state.markets],selections=[...state.selections],maxGames=Math.max(1,Math.min(50,Number($("#gameLimit").value)||20)),dates=[...state.dates].sort();
  $("#analyze").disabled=true;setStatus("Analyzing "+dates.length+" selected date(s)...");
  try{
    const all=[];
    for(const date of dates){
      const d=await (await fetch("/api/predictions/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({date,leagues,marketTypes,selections,maxGames})})).json();
      if(!d.ok)throw new Error(d.error||("Analysis failed for "+prettyDate(date)));
      const dated=(d.predictions||[]).map(x=>({...x,date}));
      all.push(...dated);
      archiveDay(date,{predictions:dated});
    }
    const seen=new Set();state.rows=all.filter(x=>{if(seen.has(x.eventId))return false;seen.add(x.eventId);return true});
    state.selected.clear();renderRows();renderSlip();
    renderHistory(dates.length===1?dates[0]:historySelectedDate());
    setStatus(state.rows.length+" unique game(s) returned across "+dates.length+" selected date(s).");
  }catch(e){state.rows=[];renderRows();renderSlip();setStatus(e.message||"Analysis failed")}finally{$("#analyze").disabled=false}
}
async function loadCalendar(){
  const d=$("#calendarDate").value;if(!d)return;
  state.date=d;state.dates.add(d);renderDateChips();
  try{
    const data=await (await fetch("/api/predictions?date="+encodeURIComponent(d))).json(),rows=data.predictions||[];
    $("#calendarStatus").textContent=rows.length?rows.length+" fixture(s) found for "+prettyDate(d):"No fixtures found for "+prettyDate(d)+".";
    $("#calendarGames").innerHTML=rows.map(x=>'<article class="calendar-game"><div><small>'+esc(x.league)+'</small><b>'+esc(x.home)+' vs '+esc(x.away)+'</b></div><time>'+esc(x.time)+'</time></article>').join("");
  }catch{$("#calendarStatus").textContent="Unable to load fixtures for this date."}
}
async function loadDailyBest(){
  const box=$("#dailyBest");if(!box)return;const date=state.date;
  box.innerHTML='<div class="empty">Loading 10 best games for '+esc(prettyDate(date))+'…</div>';
  try{
    const d=await (await fetch("/api/daily-best?date="+encodeURIComponent(date))).json();
    if(!d.ok)throw new Error(d.error||"Unable to load daily picks.");
    const rows=(d.predictions||[]).slice(0,10);
    box.innerHTML=rows.length?rows.map(x=>'<article class="match compact"><div><div class="meta">'+esc(x.league)+' · '+esc(x.time)+'</div><div class="teams">'+esc(x.home)+' <span>vs</span> '+esc(x.away)+'</div><div class="pick"><span>'+esc(x.market)+'</span><b>'+esc(x.pick)+'</b></div></div><div class="prob"><strong>'+esc(x.confidence)+'%</strong><button class="select '+(state.selected.has(x.id)?"selected":"")+'" data-top-id="'+esc(x.id)+'">'+(state.selected.has(x.id)?"Remove":"Select")+'</button></div></article>').join(""):'<div class="empty">No qualifying games found for '+esc(prettyDate(date))+'.</div>';
    saveHistoryRows(rows.map(x=>({...x,date})),date);
    archiveDay(date,{dailyBest:rows.map(x=>({...x,date}))});
    renderHistory(date,rows);
    document.querySelectorAll("#dailyBest [data-top-id]").forEach(b=>b.onclick=()=>{const row=rows.find(x=>x.id===b.dataset.topId);if(!row)return;if(state.selected.has(row.id))state.selected.delete(row.id);else if(state.selected.size<50)state.selected.set(row.id,row);renderSlip();loadDailyBest()});
  }catch(e){renderHistory(date);box.innerHTML='<div class="empty">'+esc(e.message||"Unable to load daily picks.")+'</div>'}
}
async function loadBookmakers(){try{const d=await (await fetch("/api/bookmakers")).json();$("#bookmaker").innerHTML=(d.bookmakers||[]).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+(x.codeGeneration?"":" — setup required")+'</option>').join("");$("#bookmakerStatus").textContent=d.configured?"Multi-bookmaker code generation ready.":"SportyBet is live now. Other bookmaker codes require BETRELAY_API_KEY."}catch{$("#bookmakerStatus").textContent="Unable to load bookmaker services."}}
async function booking(){const rows=[...state.selected.values()];if(!rows.length)return alert("Select at least one analyzed match first.");const bookmaker=$("#bookmaker").value||"sportybet";$("#booking").disabled=true;$("#booking").textContent="Generating…";try{const d=await (await fetch("/api/booking-code",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({bookmaker,selections:rows.map(x=>({eventId:x.eventId,marketId:x.marketId,specifier:x.specifier,outcomeId:x.outcomeId}))})})).json();if(!d.ok)throw new Error(d.error||"Booking code unavailable.");$("#bookingCode").textContent=d.bookingCode;$("#bookingTarget").textContent=(d.target||bookmaker)+" code";$("#bookingSource").textContent=d.source||"";$("#bookingResult").hidden=false;$("#copyBooking").onclick=async()=>{try{await navigator.clipboard.writeText(d.bookingCode);$("#copyBooking").textContent="Copied";setTimeout(()=>$("#copyBooking").textContent="Copy code",1500)}catch{alert("Booking code: "+d.bookingCode)}}}catch(e){alert(e.message||"Booking code unavailable.")}finally{$("#booking").disabled=false;$("#booking").textContent="Generate booking code"}}
function resetFilters(){state.markets=new Set(["ou"]);state.selections=new Set(["Over 1.5"]);$("#gameLimit").value=20;$("#league").selectedIndex=-1;renderMarketOptions();renderSelectionOptions();state.selected.clear();renderSlip();setStatus("Filters reset. Choose your options and Analyze.")}
function showPage(n){
  $$(".page").forEach(p=>p.classList.remove("active-page"));$("#page-"+n)?.classList.add("active-page");
  document.querySelectorAll("[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===n));closeSide();scrollTo({top:0,behavior:"smooth"});
  if(n==="calendar"){$("#calendarDate").value=state.date;loadCalendar()}
  if(n==="predictions")prepareDailyPage();
  if(n==="history"){const d=historySelectedDate();$("#historyDate").value=d;refreshHistory(d)}
}
const side=$("#side"),backdrop=$("#backdrop");function closeSide(){side.classList.remove("open");backdrop.classList.remove("show")}function openSide(){side.classList.add("open");backdrop.classList.add("show")}
$("#menu").onclick=()=>side.classList.contains("open")?closeSide():openSide();$("#sideClose").onclick=closeSide;backdrop.onclick=closeSide;
$$("[data-page]").forEach(b=>b.onclick=()=>showPage(b.dataset.page));
$("#snapToggle").onclick=()=>{$("#snapBody").classList.toggle("open");$("#snapArrow").textContent=$("#snapBody").classList.contains("open")?"⌃":"⌄"};
$("#fixtureFile").onchange=e=>$("#fileName").textContent=e.target.files[0]?"Selected: "+e.target.files[0].name:"";
$("#fixtureDate").onchange=async e=>{setDate(e.target.value);$("#league").innerHTML="";state.selected.clear();renderSlip();await loadLeagues();await loadBase()};
$("#prevDate").onclick=async()=>{$("#fixtureDate").value=shiftDate(-1);$("#fixtureDate").dispatchEvent(new Event("change"))};
$("#nextDate").onclick=async()=>{$("#fixtureDate").value=shiftDate(1);$("#fixtureDate").dispatchEvent(new Event("change"))};
$("#todayDate").onclick=async()=>{setDate(dateKey(new Date()));$("#fixtureDate").dispatchEvent(new Event("change"))};
$("#league").onchange=()=>$("#leagueCount").textContent=(selectedLeagues().length?selectedLeagues().length+" selected":"All leagues");
$("#analyze").onclick=analyze;$("#resetFilters").onclick=resetFilters;$("#booking").onclick=booking;
$("#selectAll").onclick=()=>{
  state.selected.clear();
  state.rows.slice(0,50).forEach(row=>state.selected.set(row.id,row));
  renderRows();renderSlip();
};
$("#clearAll").onclick=()=>{
  state.selected.clear();
  renderRows();renderSlip();
};
$("#sporty").onclick=()=>window.open("https://www.sportybet.com/ng/","_blank");$("#mic").onclick=()=>alert("Voice search integration is next.");
$("#calendarDate").onchange=loadCalendar;$("#calPrev").onclick=()=>{$("#calendarDate").value=shiftDate(-1);loadCalendar()};$("#calNext").onclick=()=>{$("#calendarDate").value=shiftDate(1);loadCalendar()};$("#calToday").onclick=()=>{$("#calendarDate").value=dateKey(new Date());loadCalendar()};$("#calLoad").onclick=loadCalendar;
$("#historyDate").onchange=()=>refreshHistory($("#historyDate").value);
$("#historyPrev").onclick=()=>{const d=new Date(historySelectedDate()+"T00:00:00");d.setDate(d.getDate()-1);$("#historyDate").value=dateKey(d);refreshHistory($("#historyDate").value)};
$("#historyNext").onclick=()=>{const d=new Date(historySelectedDate()+"T00:00:00");d.setDate(d.getDate()+1);$("#historyDate").value=dateKey(d);refreshHistory($("#historyDate").value)};
$("#historyToday").onclick=()=>{$("#historyDate").value=dateKey(new Date());refreshHistory($("#historyDate").value)};
async function updateScan(){const b=$("#refreshScan");if(b)b.disabled=true;setStatus("Scanning SportyBet again for "+prettyDate(state.date)+"...");try{const d=await (await fetch("/api/scan?date="+encodeURIComponent(state.date))).json();if(!d.ok)throw new Error(d.error||"Scan failed");await loadLeagues();await loadBase();await loadDailyBest();await refreshHistory(state.date);setStatus("Fresh scan complete: "+d.fixtureCount+" fixture(s) archived for "+prettyDate(state.date)+".")}catch(e){setStatus(e.message||"Fresh scan failed")}finally{if(b)b.disabled=false}}
$("#refreshScan").onclick=updateScan;
let appDay=dateKey(new Date());
function resetDailyState(){
  const today=dateKey(new Date());
  if(today===appDay)return;
  appDay=today;
  state.date=today;state.dates=new Set([today]);state.rows=[];state.selected.clear();
  $("#fixtureDate").value=today;$("#calendarDate").value=today;$("#selectedDateMetric").textContent=today.slice(5).replace("-","/");
  renderDateChips();renderRows();renderSlip();
  loadLeagues();loadBase();
  if($("#page-predictions")?.classList.contains("active-page"))loadDailyBest();
}
function prepareDailyPage(){
  const today=dateKey(new Date());
  if(state.date!==today){appDay=today;state.date=today;state.dates=new Set([today]);state.rows=[];state.selected.clear();$("#fixtureDate").value=today;$("#calendarDate").value=today;$("#selectedDateMetric").textContent=today.slice(5).replace("-","/");renderDateChips();renderRows();renderSlip();loadLeagues();loadBase()}
  loadDailyBest();
}
function scheduleMidnightReset(){
  const now=new Date(),next=new Date(now);next.setHours(24,0,0,0);
  setTimeout(()=>{resetDailyState();scheduleMidnightReset()},Math.max(1000,next-now+100));
}
const today=dateKey(new Date());setDate(today);appDay=today;renderDateChips();renderMarketOptions();renderSelectionOptions();bindMarketDropdowns();loadLeagues();loadBase();loadBookmakers();renderSlip();$("#historyDate").value=today;renderHistory(today);scheduleMidnightReset();setInterval(resetDailyState,30000);setInterval(()=>{const h=readHistory();const pending=h.some(x=>x.outcome==="Pending"&&x.date<=dateKey(new Date()));if(pending&&$("#historyDate")?.value)refreshHistory($("#historyDate").value)},30000);(async()=>{try{const d=await (await fetch("/api/results/status")).json();if($("#resultProviderStatus"))$("#resultProviderStatus").textContent=d.configured?"Result provider: Sportmonks live results enabled.":"Result provider: Sportmonks token required for automatic settlement."}catch{}})();