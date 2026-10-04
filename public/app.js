const state={rows:[],selected:new Map(),markets:new Set(["ou"]),selections:new Set(["Over 1.5"]),date:"",dates:new Set(),optionSets:{ou:["Over 0.5","Over 1.5","Over 2.5","Over 3.5","Over 4.5","Under 0.5","Under 1.5","Under 2.5","Under 3.5","Under 4.5"],"1x2":["Home","Draw","Away"],btts:["Yes","No"],handicap:["Home","Away"],corners:["Over 7.5","Over 8.5","Over 9.5","Over 10.5","Over 11.5","Under 7.5","Under 8.5","Under 9.5","Under 10.5","Under 11.5"],cards:["Over 1.5","Over 2.5","Over 3.5","Over 4.5","Over 5.5","Under 1.5","Under 2.5","Under 3.5","Under 4.5","Under 5.5"]}};
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const marketNames={ou:"Goals Over/Under","1x2":"1X2",btts:"BTTS",handicap:"Handicap",corners:"Corners Over/Under",cards:"Cards/Bookings Over/Under"};
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
function readHistory(){try{return JSON.parse(localStorage.getItem(historyKey())||"[]")}catch{return[]}}
function writeHistory(rows){localStorage.setItem(historyKey(),JSON.stringify(rows.slice(-2000)))}
function saveHistoryRows(rows,replaceDate=null){
  const history=readHistory();
  const targetDate=replaceDate||state.date;
  const kept=history.filter(x=>x.date!==targetDate);
  const now=new Date().toISOString();
  const fresh=rows.map(x=>({id:x.id,date:x.date||targetDate,eventId:x.eventId,league:x.league,time:x.time,home:x.home,away:x.away,pick:x.pick,market:x.market,odds:x.odds,confidence:x.confidence,status:x.matchStatus||"Not start",homeScore:x.homeScore??null,awayScore:x.awayScore??null,outcome:"Pending",recordedAt:now}));
  writeHistory([...kept,...fresh]);
}

function settleOutcome(x){
  const hs=Number(x.homeScore),as=Number(x.awayScore),pick=String(x.pick||"").toLowerCase();
  if(!Number.isFinite(hs)||!Number.isFinite(as))return /ended|finished|closed|complete/i.test(String(x.status))?"Finished":"Pending";
  const total=hs+as,m=pick.match(/overs+(d+(?:.d+)?)/),u=pick.match(/unders+(d+(?:.d+)?)/);
  if(m)return total>Number(m[1])?"Won":"Lost";if(u)return total<Number(u[1])?"Won":"Lost";
  if(pick.includes("home"))return hs>as?"Won":"Lost";if(pick.includes("away"))return as>hs?"Won":"Lost";if(pick.includes("draw"))return hs===as?"Won":"Lost";
  return "Finished";
}
function historySelectedDate(){
  return $("#historyDate")?.value||dateKey(new Date());
}
function renderHistory(date=historySelectedDate()){
  const box=$("#historyList");if(!box)return;
  const all=readHistory(),h=all.filter(x=>x.date===date).sort((a,b)=>String(a.time).localeCompare(String(b.time)));
  $("#historyStatus").textContent=h.length
    ? h.length+" record(s) for "+prettyDate(date)+"."
    : "No prediction records saved for "+prettyDate(date)+".";
  box.innerHTML=h.length?h.map(x=>'<article class="history-item"><div><small>'+esc(prettyDate(x.date))+' · '+esc(x.league)+'</small><b>'+esc(x.home)+' vs '+esc(x.away)+'</b><span>'+esc(x.pick)+' · '+esc(x.confidence)+'% · @'+esc(x.odds)+'</span></div><strong>'+esc(x.outcome)+'</strong></article>').join(""):'<div class="empty">No records for this date.</div>';
}
async function refreshHistory(date=historySelectedDate()){
  const h=readHistory();
  try{
    const data=await (await fetch("/api/predictions?date="+encodeURIComponent(date))).json();
    const live=new Map((data.predictions||[]).map(x=>[x.eventId,x]));
    h.filter(x=>x.date===date).forEach(x=>{
      const y=live.get(x.eventId);
      if(y){x.status=y.matchStatus||x.status;x.homeScore=y.homeScore??x.homeScore;x.awayScore=y.awayScore??x.awayScore;x.outcome=settleOutcome(x)}
    });
  }catch{}
  writeHistory(h);renderHistory(date);
}
function renderMarketOptions(){
  $("#marketOptions").innerHTML=Object.entries(marketNames).map(([id,name])=>'<label class="chip '+(state.markets.has(id)?"active":"")+'"><input type="checkbox" value="'+id+'" '+(state.markets.has(id)?"checked":"")+'><span>'+esc(name)+'</span></label>').join("");
  $$("#marketOptions input").forEach(i=>i.onchange=()=>{i.checked?state.markets.add(i.value):state.markets.delete(i.value);if(!state.markets.size){state.markets.add("ou");i.checked=true}renderMarketOptions();renderSelectionOptions()});
  $("#marketCount").textContent=state.markets.size+" selected";
}
function renderSelectionOptions(){
  const all=[...state.markets].flatMap(k=>state.optionSets[k]||[]);
  const unique=[...new Set(all)];
  state.selections=new Set([...state.selections].filter(x=>unique.includes(x)));
  if(!state.selections.size)state.selections.add(unique.includes("Over 1.5")?"Over 1.5":unique[0]);
  $("#selectionOptions").innerHTML=unique.map(x=>'<label class="chip '+(state.selections.has(x)?"active":"")+'"><input type="checkbox" value="'+esc(x)+'" '+(state.selections.has(x)?"checked":"")+'><span>'+esc(x)+'</span></label>').join("");
  $$("#selectionOptions input").forEach(i=>i.onchange=()=>{i.checked?state.selections.add(i.value):state.selections.delete(i.value);if(!state.selections.size){state.selections.add(i.value);i.checked=true}renderSelectionOptions()});
  $("#selectionCount").textContent=state.selections.size+" selected";
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
    setStatus("Live feed ready for "+prettyDate(state.date)+".");
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
      all.push(...(d.predictions||[]).map(x=>({...x,date})));
    }
    const seen=new Set();state.rows=all.filter(x=>{if(seen.has(x.eventId))return false;seen.add(x.eventId);return true});
    state.selected.clear();renderRows();renderSlip();
     if(dates.length===1)saveHistoryRows(state.rows,dates[0]);
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
    const d=await (await fetch("/api/predictions/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({date,leagues:[],marketTypes:["ou"],selections:["Over 1.5","Over 2.5"],maxGames:10})})).json();
    if(!d.ok)throw new Error(d.error||"Unable to load daily picks.");
    const rows=d.predictions||[];
    box.innerHTML=rows.length?rows.map(x=>'<article class="match compact"><div><div class="meta">'+esc(x.league)+' · '+esc(x.time)+'</div><div class="teams">'+esc(x.home)+' <span>vs</span> '+esc(x.away)+'</div><div class="pick"><span>'+esc(x.market)+'</span><b>'+esc(x.pick)+'</b></div></div><div class="prob"><strong>'+esc(x.confidence)+'%</strong><button class="select '+(state.selected.has(x.id)?"selected":"")+'" data-top-id="'+esc(x.id)+'">'+(state.selected.has(x.id)?"Remove":"Select")+'</button></div></article>').join(""):'<div class="empty">No qualifying games found for '+esc(prettyDate(date))+'.</div>';
    $$("#dailyBest [data-top-id]").forEach(b=>b.onclick=()=>{const row=rows.find(x=>x.id===b.dataset.topId);if(!row)return;if(state.selected.has(row.id))state.selected.delete(row.id);else if(state.selected.size<50)state.selected.set(row.id,row);renderSlip();loadDailyBest()});
  }catch(e){saveHistoryRows([],date);renderHistory(date);box.innerHTML='<div class="empty">'+esc(e.message||"Unable to load daily picks.")+'</div>'}
}
async function loadBookmakers(){try{const d=await (await fetch("/api/bookmakers")).json();$("#bookmaker").innerHTML=(d.bookmakers||[]).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+(x.codeGeneration?"":" — setup required")+'</option>').join("");$("#bookmakerStatus").textContent=d.configured?"Multi-bookmaker code generation ready.":"SportyBet is live now. Other bookmaker codes require BETRELAY_API_KEY."}catch{$("#bookmakerStatus").textContent="Unable to load bookmaker services."}}
async function booking(){const rows=[...state.selected.values()];if(!rows.length)return alert("Select at least one analyzed match first.");const bookmaker=$("#bookmaker").value||"sportybet";$("#booking").disabled=true;$("#booking").textContent="Generating…";try{const d=await (await fetch("/api/booking-code",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({bookmaker,selections:rows.map(x=>({eventId:x.eventId,marketId:x.marketId,specifier:x.specifier,outcomeId:x.outcomeId}))})})).json();if(!d.ok)throw new Error(d.error||"Booking code unavailable.");$("#bookingCode").textContent=d.bookingCode;$("#bookingTarget").textContent=(d.target||bookmaker)+" code";$("#bookingSource").textContent=d.source||"";$("#bookingResult").hidden=false;$("#copyBooking").onclick=async()=>{try{await navigator.clipboard.writeText(d.bookingCode);$("#copyBooking").textContent="Copied";setTimeout(()=>$("#copyBooking").textContent="Copy code",1500)}catch{alert("Booking code: "+d.bookingCode)}}}catch(e){alert(e.message||"Booking code unavailable.")}finally{$("#booking").disabled=false;$("#booking").textContent="Generate booking code"}}
function resetFilters(){state.markets=new Set(["ou"]);state.selections=new Set(["Over 1.5"]);$("#gameLimit").value=20;$("#league").selectedIndex=-1;renderMarketOptions();renderSelectionOptions();state.selected.clear();renderSlip();setStatus("Filters reset. Choose your options and Analyze.")}
function showPage(n){
  $$(".page").forEach(p=>p.classList.remove("active-page"));$("#page-"+n)?.classList.add("active-page");
  $("[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===n));closeSide();scrollTo({top:0,behavior:"smooth"});
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
const today=dateKey(new Date());setDate(today);appDay=today;renderDateChips();renderMarketOptions();renderSelectionOptions();loadLeagues();loadBase();loadBookmakers();renderSlip();$("#historyDate").value=today;renderHistory(today);scheduleMidnightReset();setInterval(resetDailyState,30000);