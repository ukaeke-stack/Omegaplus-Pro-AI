const state={rows:[],selected:new Map(),markets:new Set(["ou"]),selections:new Set(["Over 1.5"]),date:"",dates:[],optionSets:{ou:["Over 0.5","Over 1.5","Over 2.5","Over 3.5","Over 4.5","Under 0.5","Under 1.5","Under 2.5","Under 3.5","Under 4.5"],"1x2":["Home","Draw","Away"],btts:["Yes","No"],handicap:["Home","Away"],corners:["Over 7.5","Over 8.5","Over 9.5","Over 10.5","Over 11.5","Under 7.5","Under 8.5","Under 9.5","Under 10.5","Under 11.5"],cards:["Over 1.5","Over 2.5","Over 3.5","Over 4.5","Over 5.5","Under 1.5","Under 2.5","Under 3.5","Under 4.5","Under 5.5"]}};
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const marketNames={ou:"Goals Over/Under","1x2":"1X2",btts:"BTTS",handicap:"Handicap",corners:"Corners Over/Under",cards:"Cards/Bookings Over/Under"};
const pad=n=>String(n).padStart(2,"0");
const dateKey=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const prettyDate=v=>v?new Date(v+"T00:00:00").toLocaleDateString("en-NG",{weekday:"short",day:"numeric",month:"short",year:"numeric"}):"—";
function setStatus(t){$("#analysisStatus").textContent=t}
function setDate(v){state.date=v;if(!state.dates.includes(v))state.dates=[...state.dates,v].sort();if($("#fixtureDate"))$("#fixtureDate").value=v;if($("#calendarDate"))$("#calendarDate").value=v;$("#selectedDateMetric").textContent=state.dates.length>1?state.dates.length+" dates":v.slice(5).replace("-","/");renderDateChips();}
function renderDateChips(){const box=$("#dateOptions");if(!box)return;box.innerHTML=state.dates.map(v=>'<button type="button" class="date-chip" data-date="'+esc(v)+'">'+esc(prettyDate(v))+' ×</button>').join("");$("#dateCount").textContent=state.dates.length+" selected";$("#dateOptions .date-chip").forEach(b=>b.onclick=()=>{state.dates=state.dates.filter(x=>x!==b.dataset.date);if(!state.dates.length)state.dates=[state.date||dateKey(new Date())];state.date=state.dates[0];renderDateChips();refreshDateData()})}
async function refreshDateData(){state.selected.clear();renderSlip();await loadLeagues();await loadBase();}

function shiftDate(days){const d=new Date(state.date+"T00:00:00");d.setDate(d.getDate()+days);return dateKey(d)}
function selectedLeagues(){return $("#league")?[...$("#league").selectedOptions].map(o=>o.value):[]}
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
    const d=await (await fetch("/api/leagues?dates="+encodeURIComponent(state.dates.join(",")))).json();
    const chosen=new Set(selectedLeagues());
    const leagues=d.leagues||[];
    $("#league").innerHTML=leagues.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("");
    $$("#league option").forEach(o=>o.selected=chosen.has(o.value));
    $("#leagueCount").textContent=(selectedLeagues().length?selectedLeagues().length+" selected":"All leagues");
  }catch(e){setStatus("Could not load leagues for "+prettyDate(state.date)+".")}
}
async function loadBase(){
  try{
    const d=await (await fetch("/api/predictions?dates="+encodeURIComponent(state.dates.join(",")))).json();
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
  const dates=state.dates.length?state.dates:[state.date],leagues=selectedLeagues(),marketTypes=[...state.markets],selections=[...state.selections],maxGames=Math.max(1,Math.min(50,Number($("#gameLimit").value)||20));
  $("#analyze").disabled=true;setStatus("Analyzing "+prettyDate(state.date)+" across "+(leagues.length?leagues.length+" leagues":"all leagues")+" and "+marketTypes.length+" markets...");
  try{
    const d=await (await fetch("/api/predictions/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({date:state.date,dates,leagues,marketTypes,selections,maxGames})})).json();
    if(!d.ok)throw new Error(d.error||"Analysis failed");
    state.rows=d.predictions||[];state.selected.clear();renderRows();renderSlip();
    setStatus(d.total+" game(s) returned from "+d.available+" qualifying result(s), ranked by highest confidence · "+prettyDate(state.date));
  }catch(e){state.rows=[];renderRows();renderSlip();setStatus(e.message||"Analysis failed")}finally{$("#analyze").disabled=false}
}
function renderCalendarDates(){const box=$("#calendarDates");if(!box)return;box.innerHTML=state.dates.map(v=>'<button type="button" class="date-chip" data-date="'+esc(v)+'">'+esc(prettyDate(v))+' ×</button>').join("");$("#calendarDates .date-chip").forEach(b=>b.onclick=()=>{state.dates=state.dates.filter(x=>x!==b.dataset.date);if(!state.dates.length)state.dates=[state.date];renderCalendarDates()})}
async function loadCalendar(){
  const d=$("#calendarDate").value;
  try{
    const data=await (await fetch("/api/predictions?dates="+encodeURIComponent(d))).json(),rows=data.predictions||[];
    $("#calendarStatus").textContent=rows.length?rows.length+" fixture(s) found for "+prettyDate(d):"No fixtures found for "+prettyDate(d)+".";
    $("#calendarGames").innerHTML=rows.map(x=>'<article class="calendar-game"><div><small>'+esc(x.league)+'</small><b>'+esc(x.home)+' vs '+esc(x.away)+'</b></div><time>'+esc(x.time)+'</time></article>').join("");
  }catch(e){$("#calendarStatus").textContent="Unable to load fixtures for this date."}
}
async function booking(){
  const rows=[...state.selected.values()];if(!rows.length)return alert("Select at least one analyzed match first.");
  $("#booking").disabled=true;
  try{const d=await (await fetch("/api/booking-code",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({selections:rows.map(x=>({eventId:x.eventId,marketId:x.marketId,specifier:x.specifier,outcomeId:x.outcomeId}))})})).json();if(!d.ok)throw new Error(d.error||"Booking code unavailable.");$("#bookingCode").textContent=d.bookingCode;$("#bookingResult").hidden=false;$("#copyBooking").onclick=async()=>{try{await navigator.clipboard.writeText(d.bookingCode);$("#copyBooking").textContent="Copied";setTimeout(()=>$("#copyBooking").textContent="Copy code",1500)}catch{alert("Booking code: "+d.bookingCode)}};}catch(e){alert(e.message||"Booking code unavailable.")}finally{$("#booking").disabled=false}
}
function resetFilters(){state.markets=new Set(["ou"]);state.selections=new Set(["Over 1.5"]);$("#gameLimit").value=20;$("#league").selectedIndex=-1;renderMarketOptions();renderSelectionOptions();state.selected.clear();renderSlip();setStatus("Filters reset. Choose your options and Analyze.")}
function showPage(n){$$(".page").forEach(p=>p.classList.remove("active-page"));$("#page-"+n)?.classList.add("active-page");$$("[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===n));closeSide();scrollTo({top:0,behavior:"smooth"});if(n==="calendar"){$("#calendarDate").value=state.date;loadCalendar()}}
const side=$("#side"),backdrop=$("#backdrop");function closeSide(){side.classList.remove("open");backdrop.classList.remove("show")}function openSide(){side.classList.add("open");backdrop.classList.add("show")}
$("#menu").onclick=()=>side.classList.contains("open")?closeSide():openSide();$("#sideClose").onclick=closeSide;backdrop.onclick=closeSide;
$$("[data-page]").forEach(b=>b.onclick=()=>showPage(b.dataset.page));
$("#snapToggle").onclick=()=>{$("#snapBody").classList.toggle("open");$("#snapArrow").textContent=$("#snapBody").classList.contains("open")?"⌃":"⌄"};
$("#fixtureFile").onchange=e=>$("#fileName").textContent=e.target.files[0]?"Selected: "+e.target.files[0].name:"";
$("#fixtureDate").onchange=async e=>{const v=e.target.value;if(!v)return;if(!state.dates.includes(v))state.dates=[...state.dates,v].sort();state.date=v;renderDateChips();await refreshDateData()};
$("#prevDate").onclick=async()=>{$("#fixtureDate").value=shiftDate(-1);$("#fixtureDate").dispatchEvent(new Event("change"))};
$("#nextDate").onclick=async()=>{$("#fixtureDate").value=shiftDate(1);$("#fixtureDate").dispatchEvent(new Event("change"))};
$("#todayDate").onclick=async()=>{setDate(dateKey(new Date()));await refreshDateData()};
$("#league").onchange=()=>$("#leagueCount").textContent=(selectedLeagues().length?selectedLeagues().length+" selected":"All leagues");
$("#analyze").onclick=analyze;$("#resetFilters").onclick=resetFilters;$("#booking").onclick=booking;
$("#sporty").onclick=()=>window.open("https://www.sportybet.com/ng/","_blank");$("#mic").onclick=()=>alert("Voice search integration is next.");
$("#calendarDate").onchange=loadCalendar;$("#calPrev").onclick=()=>{$("#calendarDate").value=shiftDate(-1);loadCalendar()};$("#calNext").onclick=()=>{$("#calendarDate").value=shiftDate(1);loadCalendar()};$("#calToday").onclick=()=>{$("#calendarDate").value=dateKey(new Date());loadCalendar()};$("#calAdd").onclick=()=>{const v=$("#calendarDate").value;if(v&&!state.dates.includes(v))state.dates=[...state.dates,v].sort();if(v)state.date=v;renderCalendarDates();renderDateChips()};$("#calLoad").onclick=loadCalendar;
$("#predictionsDate").onchange=()=>{$("#predictionsStatus").textContent="Selected "+prettyDate($("#predictionsDate").value)+". Use the Fixture Analyzer on Home to analyze markets.";};$("#predictionsLoad").onclick=()=>{$("#predictionsStatus").textContent="Loaded date control for "+prettyDate($("#predictionsDate").value)+". Analyze from Home for confidence-ranked picks.";};
$("#historyDate").onchange=()=>{$("#historyStatus").textContent="Selected "+prettyDate($("#historyDate").value)+".";};$("#historyLoad").onclick=()=>{$("#historyStatus").textContent="History filter set to "+prettyDate($("#historyDate").value)+".";};
const today=dateKey(new Date());setDate(today);renderDateChips();renderCalendarDates();if($("#predictionsDate"))$("#predictionsDate").value=today;if($("#historyDate"))$("#historyDate").value=today;renderMarketOptions();renderSelectionOptions();loadLeagues();loadBase();renderSlip();