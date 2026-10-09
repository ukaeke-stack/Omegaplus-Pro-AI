const state={sport:"football",rows:[],selected:new Map(),markets:new Set(["ou"]),selections:new Set(["ou::over_1_5"]),date:"",dates:new Set(),settings:{games:20,minConfidence:0,defaultMarket:"ou",defaultSelection:"Over 1.5",riskProfile:"Balanced",oddsMin:"",oddsMax:"",autoRefresh:false,showConfidence:true,notifications:false}};
function readSavedSettings(){try{return {...state.settings,...JSON.parse(localStorage.getItem("omegaplus_settings_v2")||"{}")}}catch{return {...state.settings}}}
function applySettings(s){
  state.settings={...state.settings,...s};
  const games=Math.max(1,Math.min(50,Number(state.settings.games)||20));
  if($("#gameLimit"))$("#gameLimit").value=games;
  const market=state.settings.defaultMarket;
  if(market&&marketCatalog[market])state.markets=new Set([market]);
  const selection=state.settings.defaultSelection;
  if(selection)state.selections=new Set([String(selection).includes("::")?selection:"ou::"+selection.toLowerCase().replace(/ /g,"_")]);
  if(typeof renderMarketOptions==="function")renderMarketOptions();
  if(typeof renderSelectionOptions==="function")renderSelectionOptions();
}
window.applyOmegaplusSettings=applySettings;
const allMarketCatalog=window.OMEGA_MARKET_OPTIONS||{};
let marketCatalog=allMarketCatalog;
const marketNames=Object.fromEntries(Object.entries(marketCatalog).map(([id,x])=>[id,x.name]));
const marketOptionSets=Object.fromEntries(Object.entries(marketCatalog).map(([id,x])=>[id,(x.options||[]).map(o=>o.label)]));
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad=n=>String(n).padStart(2,"0");
const dateKey=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const prettyDate=v=>v?new Date(v+"T00:00:00").toLocaleDateString("en-NG",{weekday:"short",day:"numeric",month:"short",year:"numeric"}):"—";
function setStatus(t){$("#analysisStatus").textContent=t}
async function jsonFetch(url,options={}){
  const res=await fetch(url,options);
  const text=await res.text();
  let data=null;
  try{data=text?JSON.parse(text):null}catch{
    const preview=text.replace(/\s+/g," ").slice(0,180);
    throw new Error("Server returned a non-JSON response ("+res.status+"): "+preview);
  }
  if(!res.ok){const err=new Error(data?.error||data?.message||("Request failed ("+res.status+")"));err.code=data?.code||"";if((err.code==="AUTH_REQUIRED"||err.code==="PAID_REQUIRED")&&window.omegaAuth)window.omegaAuth.open();throw err}
  return data;
}
function setDate(v){state.date=v;state.dates=new Set([v]);$("#fixtureDate").value=v;$("#calendarDate").value=v;$("#selectedDateMetric").textContent=v.slice(5).replace("-","/");renderDateChips();}
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
  const kept=history.filter(x=>x.date!==targetDate||((x.sport||"football")!==(state.sport||"football")));
  const now=new Date().toISOString();
  const fresh=rows.slice(0,10).map(x=>({id:x.id,sport:x.sport||state.sport,date:x.date||targetDate,eventId:x.eventId,league:x.league,time:x.time,home:x.home,away:x.away,pick:x.pick,market:x.market,odds:x.odds,confidence:x.confidence,status:x.matchStatus||"Not start",homeScore:x.homeScore??null,awayScore:x.awayScore??null,outcome:x.outcome||"Pending",resultProviderId:x.resultProviderId||null,sources:x.sources||[],verificationStatus:x.verificationStatus||"unverified",verificationCount:x.verificationCount||1,recordedAt:now}));
  return writeHistory([...kept,...fresh].filter((x,i,a)=>a.findIndex(y=>y.date===x.date&&y.eventId===x.eventId&&y.id===x.id)===i));
}

function settleOutcome(x){
  const status=String(x.status||x.matchStatus||"").toLowerCase();
  if(/postpon|cancel|void|abandon|suspend/.test(status))return /postpon|cancel|void/.test(status)?"Postponed":"Pending";
  const finished=/finished|full.?time|ended|closed|complete|final|\bft\b|after extra|penalt(y|ies)/i.test(status);
  // A 0-0 (or any current score) from a scheduled/live fixture is NOT a final result.
  // Only settle a prediction after the provider explicitly reports a completed match.
  if(!finished)return "Pending";
  if(String(x.verificationStatus||"")!=="confirmed")return "Pending";
  const hs=Number(x.homeScore),as=Number(x.awayScore),pick=String(x.pick||"").toLowerCase();
  if(!Number.isFinite(hs)||!Number.isFinite(as))return "Pending";
  if(String(x.market||"").toLowerCase()==="correct score"){
    const cs=pick.match(/^(\d+)\s*[-:]\s*(\d+)$/);
    if(!cs)return "Pending";
    return hs===Number(cs[1])&&as===Number(cs[2])?"Won":"Lost";
  }
  const total=hs+as,m=pick.match(/over\s*(\d+(?:\.\d+)?)/),u=pick.match(/under\s*(\d+(?:\.\d+)?)/);
  if(m)return total>Number(m[1])?"Won":"Lost";
  if(u)return total<Number(u[1])?"Won":"Lost";
  if(pick.includes("home"))return hs>as?"Won":"Lost";
  if(pick.includes("away"))return as>hs?"Won":"Lost";
  if(pick.includes("draw"))return hs===as?"Won":"Lost";
  return "Finished";
}
function updateOutcomeSummary(rows,prefix){
  const won=rows.filter(x=>x.outcome==="Won").length,lost=rows.filter(x=>x.outcome==="Lost").length,pending=rows.filter(x=>!["Won","Lost"].includes(x.outcome)).length;
  const settled=won+lost,accuracy=settled?Math.round(won/settled*100):null;
  const set=(id,v)=>{if($("#"+id))$("#"+id).textContent=v};
  if(prefix==="history"){set("historyWon",won);set("historyLost",lost);set("historyPending",pending);set("historyAccuracy",accuracy===null?"—":accuracy+"%")}
  if(prefix==="daily"){set("dailySelected",rows.length+"/10");set("dailyWon",won);set("dailyLost",lost);set("dailyAccuracy",accuracy===null?"—":accuracy+"%")}
}
function historySelectedDate(){
  return $("#historyDate")?.value||dateKey(new Date());
}
function renderHistory(date=historySelectedDate(),fallbackRows=[]){
  const box=$("#historyList");if(!box)return;
  const all=readHistory();
  let h=all.filter(x=>(x.sport||"football")===state.sport&&x.date===date).sort((a,b)=>Number(b.confidence||0)-Number(a.confidence||0)||String(a.time).localeCompare(String(b.time))).slice(0,50);
  if(!h.length&&fallbackRows.length){
    const now=new Date().toISOString();
    h=fallbackRows.slice(0,10).map(x=>({...x,id:x.id,date:x.date||date,eventId:x.eventId,league:x.league,time:x.time,home:x.home,away:x.away,pick:x.pick||"Prediction",market:x.market||"Goals Over/Under",odds:x.odds??"—",confidence:Number(x.confidence||0),status:x.matchStatus||"Not start",homeScore:x.homeScore??null,awayScore:x.awayScore??null,outcome:x.outcome||settleOutcome(x),recordedAt:now}));
  }
  updateOutcomeSummary(h,"history");
  $("#historyStatus").textContent=h.length?h.length+" record(s) for "+prettyDate(date)+".":"No prediction records saved for "+prettyDate(date)+".";
  box.innerHTML=h.length?h.map(x=>'<article class="history-item"><div><small>'+esc(prettyDate(x.date))+' · '+esc(x.league)+'</small><b>'+esc(x.home)+' vs '+esc(x.away)+'</b><span>'+esc(x.pick)+' · '+esc(x.confidence)+'% · @'+esc(x.odds)+'</span><small>'+esc((x.sources||[]).join(" + ")||"Result verification pending")+(x.verificationStatus==="confirmed"?" · VERIFIED":x.verificationStatus==="conflict"?" · CONFLICT":" · UNVERIFIED")+(Number.isFinite(Number(x.homeScore))?" · "+x.homeScore+"-"+x.awayScore:"")+'</small></div><strong>'+esc(x.outcome)+'</strong></article>').join(""):'<div class="empty">No records for this date.</div>';
}
async function refreshHistory(date=historySelectedDate()){
  let h=readHistory(),fallback=[];
  try{
    const archiveResponse=await (await fetch("/api/history?sport="+encodeURIComponent(state.sport)+"&date="+encodeURIComponent(date))).json();
    const archive=archiveResponse.ok&&archiveResponse.archive?archiveResponse.archive:null;
    if(Array.isArray(archive?.correctScores)&&archive.correctScores.length){
      const existingCs=archive.correctScores.slice(0,5).map((x,i)=>({...x,id:x.id||"cs_"+(x.eventId||i),eventId:x.eventId||x.id||("cs_"+i),sport:"football",date,market:"Correct Score",outcome:x.outcome||"Pending"}));
      h=[...h.filter(x=>!(x.date===date&&(x.sport||"football")==="football"&&x.market==="Correct Score")),...existingCs];
    }
    let day=(archive?.predictions||[]).slice(0,10).map(x=>({...x,date}));
    if(!day.length){
      const data=await (await fetch("/api/predictions?sport="+encodeURIComponent(state.sport)+"&date="+encodeURIComponent(date))).json();
      const liveRows=data.predictions||[];
      day=h.filter(x=>x.date===date).sort((a,b)=>Number(b.confidence||0)-Number(a.confidence||0)||String(a.time).localeCompare(String(b.time))).slice(0,10);
      if(!day.length){
        try{const analyzed=await (await fetch("/api/daily-best?sport="+encodeURIComponent(state.sport)+"&date="+encodeURIComponent(date))).json();fallback=(analyzed.predictions||[]).slice(0,10).map(x=>({...x,date}));}catch{}
        if(!fallback.length)fallback=liveRows.slice(0,10).map(x=>({...x,date,pick:"Fixture",market:"Fixture",confidence:0,odds:"—"}));
        day=fallback;
      }
    }
    let resultRows=Array.isArray(archive?.results)?archive.results:[];
    try{const rr=await (await fetch("/api/results?date="+encodeURIComponent(date))).json();if(rr.ok)resultRows=rr.results||resultRows;}catch{}
    const norm=v=>String(v||"").toLowerCase().normalize("NFKD").replace(/[\\u0300-\\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
    const findResult=x=>resultRows.find(r=>x.resultProviderId&&String(r.providerId)===String(x.resultProviderId))||resultRows.find(r=>norm(r.home)===norm(x.home)&&norm(r.away)===norm(x.away));
    const liveData=await (await fetch("/api/predictions?sport="+encodeURIComponent(state.sport)+"&date="+encodeURIComponent(date))).json().catch(()=>({predictions:[]}));
    const live=new Map((liveData.predictions||[]).map(x=>[x.eventId,x]));
    day.forEach(x=>{const y=live.get(x.eventId),z=findResult(x);if(y){x.status=y.matchStatus||x.status;x.homeScore=y.homeScore??x.homeScore;x.awayScore=y.awayScore??x.awayScore}if(z){x.status=z.status||x.status;x.homeScore=z.homeScore??x.homeScore;x.awayScore=z.awayScore??x.awayScore;x.resultProviderId=z.providerId||x.resultProviderId;x.sources=z.sources||x.sources||[];x.verificationStatus=z.verificationStatus||x.verificationStatus||"unverified";x.verificationCount=z.verificationCount||x.verificationCount||1}x.outcome=settleOutcome(x)});
    const correctScoreRows=h.filter(x=>x.date===date&&(x.market||"")==="Correct Score").map(x=>{
      const z=findResult(x);
      const next={...x};
      if(z){next.status=z.status||next.status;next.homeScore=z.homeScore??next.homeScore;next.awayScore=z.awayScore??next.awayScore;next.resultProviderId=z.providerId||next.resultProviderId;next.sources=z.sources||next.sources||[];next.verificationStatus=z.verificationStatus||next.verificationStatus||"unverified";next.verificationCount=z.verificationCount||next.verificationCount||1;next.outcome=settleOutcome(next);}
      return next;
    });
    const merged=[...h.filter(x=>x.date!==date),...day.filter(x=>x.market!=="Correct Score"),...correctScoreRows];
    writeHistory(merged);
    archiveDay(date,{history:merged.filter(x=>x.date===date),predictions:day,correctScores:correctScoreRows,results:resultRows});
    try{await fetch("/api/history",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sport:state.sport,date,predictions:day,correctScores:correctScoreRows,results:resultRows})});}catch{}
    renderHistory(date,merged.filter(x=>x.date===date));
  }catch{
    const day=h.filter(x=>x.date===date).sort((a,b)=>Number(b.confidence||0)-Number(a.confidence||0)||String(a.time).localeCompare(String(b.time))).slice(0,50);
    renderHistory(date,day);
  }
}
function renderDropdown(id,items,selectedSet){
  const el=$(id);if(!el)return;
  el.innerHTML=items.map(x=>'<option value="'+esc(x.value??x.label??x)+'" '+(selectedSet.has(x.value??x.label??x)?"selected":"")+'>'+esc(x.label??x)+'</option>').join("");
}
function renderMarketOptions(){
  const allowed=(window.OMEGA_SPORT_MARKETS?.[state.sport])||Object.keys(marketCatalog);
  const items=allowed.filter(id=>marketCatalog[id]).map(id=>({value:id,label:marketCatalog[id].name}));
  renderDropdown("#marketOptions",items,state.markets);
  $("#marketCount").textContent=state.markets.size+" selected";
}
function selectionValue(marketId,option){return marketId+"::"+option.key}
function selectionLabel(value){
  const [marketId,key]=String(value||"").split("::");
  return marketCatalog[marketId]?.options?.find(o=>o.key===key)?.label||String(value||"");
}
function renderSelectionOptions(){
  const options=[...state.markets].flatMap(k=>(marketCatalog[k]?.options||[]).map(o=>({value:selectionValue(k,o),label:o.label})));
  const seen=new Set(),unique=options.filter(o=>!seen.has(o.value)&&seen.add(o.value));
  const legacy=[...state.selections].map(x=>{
    if(String(x).includes("::"))return x;
    for(const k of state.markets){
      const hit=(marketCatalog[k]?.options||[]).find(o=>o.label===x);
      if(hit)return selectionValue(k,hit);
    }
    return x;
  });
  state.selections=new Set(legacy.filter(x=>unique.some(o=>o.value===x)));
  if(!state.selections.size&&unique.length){
    const preferred=unique.find(o=>selectionLabel(o.value)==="Over 1.5");
    state.selections.add(preferred?.value||unique[0].value);
  }
  renderDropdown("#selectionOptions",unique,state.selections);
  $("#selectionCount").textContent=state.selections.size+" selected";
}
function bindMarketDropdowns(){
  $("#marketOptions").onchange=()=>{state.markets=new Set([...$("#marketOptions").selectedOptions].map(o=>o.value));if(!state.markets.size)state.markets.add(state.sport==="basketball"?"basketball_total":"ou");renderMarketOptions();renderSelectionOptions()};
  $("#selectionOptions").onchange=()=>{state.selections=new Set([...$("#selectionOptions").selectedOptions].map(o=>o.value));if(!state.selections.size){const marketId=[...state.markets][0],first=(marketCatalog[marketId]?.options||[])[0];if(first)state.selections.add(selectionValue(marketId,first))}renderSelectionOptions()};
}
const leagueUiCache=new Map();
const LEAGUE_UI_CACHE_MS=30*60*1000;

async function loadLeagues(){
  const requestDate=state.date,requestSport=state.sport;
  const cacheKey=requestDate+"|"+requestSport;
  const renderLeagues=(leagues)=>{
    if(requestDate!==state.date||requestSport!==state.sport)return;
    const chosen=new Set(selectedLeagues());
    const groups=["Top Leagues","European Competitions","International","Other Leagues"];
    const groupLabels={"Top Leagues":"TOP LEAGUES","European Competitions":"EUROPEAN / CONTINENTAL","International":"INTERNATIONAL","Other Leagues":"OTHER LEAGUES"};
    $("#league").innerHTML=groups.map(group=>{
      const items=leagues.filter(x=>(typeof x==="string"?group:""+x.group)===group);
      if(!items.length)return "";
      return '<optgroup label="'+esc(groupLabels[group])+'">'+items.map(x=>{
        const value=typeof x==="string"?x:(x.key||((x.name||"")+"|||"+(x.country||"")));
        const country=typeof x==="string"?"":x.country;
        const visible=typeof x==="string"?x:(x.name||value.split("|||")[0]);
        const count=typeof x==="string"?null:(x.count==null?null:Number(x.count));
        const countText=typeof x==="string"?"":(count==null?"—":count+" game"+(count===1?"":"s"));
        return '<option value="'+esc(value)+'">'+esc(visible)+(country?" — "+esc(country):"")+(typeof x==="string"?"":" · "+countText)+'</option>';
      }).join("")+'</optgroup>';
    }).join("");
    $$("#league option").forEach(o=>o.selected=chosen.has(o.value));
    $("#leagueCount").textContent=(selectedLeagues().length?selectedLeagues().length+" selected":"All leagues");
  };
  const cached=leagueUiCache.get(cacheKey);
  if(cached&&Date.now()-cached.at<LEAGUE_UI_CACHE_MS){
    renderLeagues(cached.leagues||[]);
    return;
  }
  $("#league").innerHTML='<option disabled selected>Loading leagues and game counts…</option>';
  try{
    const data=await jsonFetch("/api/leagues?sport="+encodeURIComponent(requestSport)+"&date="+encodeURIComponent(requestDate)+"&counts=1");
    if(requestDate!==state.date||requestSport!==state.sport)return;
    const leagues=data.leagues||[];
    if(data.counts)leagueUiCache.set(cacheKey,{at:Date.now(),leagues});
    renderLeagues(leagues);
  }catch(e){
    if(requestDate!==state.date||requestSport!==state.sport)return;
    setTimeout(async()=>{
      if(requestDate!==state.date||requestSport!==state.sport)return;
      try{
        const retry=await jsonFetch("/api/leagues?sport="+encodeURIComponent(requestSport)+"&date="+encodeURIComponent(requestDate)+"&counts=1");
        if(requestDate!==state.date||requestSport!==state.sport)return;
        const leagues=retry.leagues||[];
        if(retry.counts)leagueUiCache.set(cacheKey,{at:Date.now(),leagues});
        renderLeagues(leagues);
      }catch{
        $("#league").innerHTML='<option disabled selected>Unable to load league counts</option>';
        setStatus("Could not load leagues for "+prettyDate(requestDate)+".");
      }
    },1000);
  }
}
async function loadBase(){
  try{
    const d=await jsonFetch("/api/predictions?sport="+encodeURIComponent(state.sport)+"&date="+encodeURIComponent(state.date));
    state.rows=d.predictions||[];$("#predictionTotal").textContent=state.rows.length;
    archiveDay(state.date,{fixtures:state.rows});
    setStatus("Daily archive ready for "+prettyDate(state.date)+".");
  }catch(e){state.rows=[];$("#predictionTotal").textContent="—";setStatus("Live SportyBet data is temporarily unavailable.")}
}
function predictionReasonsHtml(x){const r=Array.isArray(x.reasons)?x.reasons.map(v=>"<li>"+esc(v)+"</li>").join(""):"<li>Market model ranking.</li>";return '<details class="reason-box"><summary>Why this pick?</summary><ul>'+r+'</ul></details>'}
function renderRows(){
  if(!state.rows.length){$("#matches").innerHTML='<div class="empty">No games matched this date and filter.</div>';return}
  $("#matches").innerHTML=state.rows.map(x=>{
    const selected=state.selected.has(x.id);
    return '<article class="match"><div><div class="meta">'+esc(x.league)+' · '+esc(x.time)+'</div><div class="teams">'+esc(x.home)+' <span>vs</span> '+esc(x.away)+'</div><div class="pick"><span>'+esc(x.market)+' · '+esc(x.specifier||"")+'</span><b>'+esc(x.pick)+'</b></div><div class="pick"><span>Odds '+esc(x.odds)+'</span><b>'+esc(x.confidenceLabel)+' · Grade '+esc(x.qualityGrade||"—")+'</b></div>'+predictionReasonsHtml(x)+'<button class="select '+(selected?"selected":"")+'" data-id="'+esc(x.id)+'">'+(selected?"Remove from slip":"Add to slip")+'</button></div><div class="prob"><strong>'+esc(x.confidence)+'%</strong><div class="bar"><i style="width:'+esc(x.confidence)+'%"></i></div><small>Confidence</small></div></article>';
  }).join("");
  $$(".select").forEach(b=>b.onclick=()=>{const row=state.rows.find(x=>x.id===b.dataset.id);if(!row)return;if(state.selected.has(row.id)){state.selected.delete(row.id);b.classList.remove("selected");b.textContent="Add to slip"}else{if(state.selected.size>=50){alert("Maximum 50 selections.");return}state.selected.set(row.id,row);b.classList.add("selected");b.textContent="Remove from slip"}renderSlip()});
}
function renderSlip(){
  const rows=[...state.selected.values()];$("#slipCount").textContent=rows.length;$("#selectedHome").textContent=rows.length;
  $("#slip").innerHTML=rows.length?rows.map(x=>'<div class="slipitem"><b>'+esc(x.home)+' vs '+esc(x.away)+'</b><small>'+esc(x.pick)+' · '+esc(x.confidence)+'% · @'+esc(x.odds)+'</small></div>').join(""):"<p>Select analyzed matches to build your slip.</p>";
}
async function analyze(){
  const leagues=selectedLeagues(),marketTypes=[...state.markets],selections=[...state.selections],maxGames=Math.max(1,Math.min(50,Number($("#gameLimit").value)||20)),minConfidence=Math.max(0,Math.min(100,Number(state.settings.minConfidence)||0)),dates=[...state.dates].sort();
  $("#analyze").disabled=true;setStatus("Analyzing "+dates.length+" selected date(s)...");
  try{
    const all=[],summaries=[];
    for(const date of dates){
      const remaining=Math.max(0,maxGames-all.length);
      if(remaining===0) break;
      const d=await jsonFetch("/api/predictions/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sport:state.sport,date,leagues,marketTypes,selections,maxGames:remaining,minConfidence})});
      if(!d.ok)throw new Error(d.error||("Analysis failed for "+prettyDate(date)));
      const dated=(d.predictions||[]).slice(0,remaining).map(x=>({...x,date}));
      all.push(...dated);
      summaries.push({date,scannedFixtures:Number(d.scannedFixtures||0),available:Number(d.available||0),returned:dated.length});
      archiveDay(date,{predictions:dated});
      if(!dated.length && d.scannedFixtures!=null) console.warn("Analyzer returned no matches",{date,scannedFixtures:d.scannedFixtures,available:d.available,criteria:d.criteria});
    }
    const seen=new Set();state.rows=all.filter(x=>{if(seen.has(x.eventId))return false;seen.add(x.eventId);return true});
    state.selected.clear();renderRows();renderSlip();
    renderHistory(dates.length===1?dates[0]:historySelectedDate());
    if(!state.rows.length){
      const parts=summaries.map(x=>prettyDate(x.date)+": scanned "+x.scannedFixtures+", available "+x.available);
      setStatus("0 games matched. "+parts.join(" · ")+" — check the selected league/market/option.");
    }else setStatus(state.rows.length+" unique game(s) returned across "+summaries.length+" selected date(s).");
  }catch(e){state.rows=[];renderRows();renderSlip();setStatus(e.message||"Analysis failed")}finally{$("#analyze").disabled=false}
}
async function loadCalendar(){
  const d=$("#calendarDate").value;if(!d)return;
  state.date=d;state.dates.add(d);renderDateChips();
  try{
    const data=await (await fetch("/api/predictions?sport="+encodeURIComponent(state.sport)+"&date="+encodeURIComponent(d))).json(),rows=data.predictions||[];
    $("#calendarStatus").textContent=rows.length?rows.length+" fixture(s) found for "+prettyDate(d):"No fixtures found for "+prettyDate(d)+".";
    $("#calendarGames").innerHTML=rows.map(x=>'<article class="calendar-game"><div><small>'+esc(x.league)+'</small><b>'+esc(x.home)+' vs '+esc(x.away)+'</b></div><time>'+esc(x.time)+'</time></article>').join("");
  }catch{$("#calendarStatus").textContent="Unable to load fixtures for this date."}
}
async function loadDailyBest(){
  const box=$("#dailyBest");if(!box)return;const date=state.date;
  box.innerHTML='<div class="empty">Loading 10 best games for '+esc(prettyDate(date))+'…</div>';
  try{
    const limit=10,market="all";const d=await jsonFetch("/api/daily-best?sport="+encodeURIComponent(state.sport)+"&date="+encodeURIComponent(date));
    if(!d.ok)throw new Error(d.error||"Unable to load daily picks.");if($("#bestPicksStatus"))$("#bestPicksStatus").textContent="Strict daily Top 10 · mixed markets · minimum odds 1.10";
    let rows=(d.predictions||[]).slice(0,10);
    const saved=readHistory().filter(x=>x.date===date);
    const byId=new Map(saved.map(x=>[x.id,x]));
    rows=rows.map(x=>({...x,outcome:byId.get(x.id)?.outcome||"Pending"}));
    updateOutcomeSummary(rows,"daily");
    box.innerHTML=rows.length?rows.map(x=>'<article class="match compact"><div><div class="meta">'+esc(x.league)+' · '+esc(x.time)+'</div><div class="teams">'+esc(x.home)+' <span>vs</span> '+esc(x.away)+'</div><div class="pick"><span>'+esc(x.market)+' · Grade '+esc(x.qualityGrade||"—")+' · Odds '+esc(Number(x.odds||0).toFixed(2))+'</span><b>'+esc(x.pick)+'</b></div><div class="pick"><span>Result</span><b>'+esc(x.outcome)+'</b></div>'+predictionReasonsHtml(x)+'</div><div class="prob"><strong>'+esc(x.confidence)+'%</strong><button class="select '+(state.selected.has(x.id)?"selected":"")+'" data-top-id="'+esc(x.id)+'">'+(state.selected.has(x.id)?"Remove":"Select")+'</button></div></article>').join(""):'<div class="empty">No qualifying games found for '+esc(prettyDate(date))+'.</div>';
    saveHistoryRows(rows.map(x=>({...x,date,sport:state.sport})),date);
    archiveDay(date,{dailyBest:rows.map(x=>({...x,date}))});
    refreshHistory(date).catch(()=>{});
    document.querySelectorAll("#dailyBest [data-top-id]").forEach(b=>b.onclick=()=>{const row=rows.find(x=>x.id===b.dataset.topId);if(!row)return;const selected=state.selected.has(row.id);if(selected)state.selected.delete(row.id);else if(state.selected.size<50)state.selected.set(row.id,row);b.classList.toggle("selected",!selected);b.textContent=selected?"Select":"Remove";renderSlip();});
  }catch(e){renderHistory(date);box.innerHTML='<div class="empty">'+esc(e.message||"Unable to load daily picks.")+'</div>'}
}
async function loadCorrectScores(date=$("#csDate")?.value||state.date){
  const box=$("#correctScores");if(!box)return;
  $("#csStatus").textContent="Analyzing one best correct score for every match…";
  box.innerHTML='<div class="empty">Building the score probability matrix…</div>';
  try{
    const d=await jsonFetch("/api/correct-scores?sport=football&date="+encodeURIComponent(date));
    const rows=d.predictions||[];
    $("#csStatus").textContent=rows.length?rows.length+" match(es) analyzed · one best score per match · "+prettyDate(date):"No qualifying fixtures for "+prettyDate(date)+".";
    box.innerHTML=rows.length?rows.map((x,i)=>{
      const best=x.bestScore||x.topScores?.[0]||{};
      const prob=best.probability ?? best.probabilityPercent ?? x.scoreProbability ?? 0;
      const eg=x.expectedGoals||{};
      return '<article class="match compact"><div><div class="meta">#'+(i+1)+' · '+esc(x.league||"")+' · '+esc(x.time||"")+'</div><div class="teams">'+esc(x.home||"")+' <span>vs</span> '+esc(x.away||"")+'</div><div class="pick"><span>Correct score</span><b>'+esc(best.score||"—")+'</b></div><div class="pick"><span>Score probability</span><b>'+esc(prob)+'%</b></div><div class="pick"><span>Expected goals</span><b>'+esc(eg.home ?? "—")+' — '+esc(eg.away ?? "—")+'</b></div><small class="muted">Analysis sources: '+esc((x.sources||[]).join(", ")||"Independent statistics + market model")+'</small></div><div class="prob"><strong>'+esc(x.confidence ?? prob)+'%</strong><small>best-score confidence</small></div></article>';
    }).join(''):'<div class="empty">No score analysis is available for this date.</div>';
  const existing=readHistory();
  const csRows=rows.slice(0,5).map((x,i)=>{const best=x.topScores?.[0];return {id:"cs_"+(x.eventId||x.id||i),eventId:x.eventId||x.id||("cs_"+i),sport:"football",date,league:x.league,time:x.time,home:x.home,away:x.away,pick:best?.score||"—",market:"Correct Score",odds:best?.probability??"—",confidence:Number(x.confidence||best?.probability||0),status:x.matchStatus||"Not start",homeScore:x.homeScore??null,awayScore:x.awayScore??null,outcome:x.outcome||"Pending",sources:x.sources||[],topScores:Array.isArray(x.topScores)?x.topScores.slice(0,5):[],bestScore:x.bestScore||best||null,expectedGoals:x.expectedGoals||null,verificationStatus:x.verificationStatus||"unverified",verificationCount:x.verificationCount||1,recordedAt:new Date().toISOString()};});
  const other=existing.filter(x=>!(x.date===date&&(x.sport||"football")==="football"&&x.market==="Correct Score"));
  writeHistory([...other,...csRows].slice(-2000));
  try{
    await fetch("/api/history",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sport:"football",date,correctScores:csRows})});
  }catch{}
  try{await refreshHistory(date)}catch{}
  }catch(e){$("#csStatus").textContent=e.message||"Correct-score analysis failed.";box.innerHTML='<div class="empty">'+esc(e.message||"Correct-score analysis failed.")+'</div>'}
}
async function loadBookmakers(){try{const d=await (await fetch("/api/bookmakers")).json();$("#bookmaker").innerHTML=(d.bookmakers||[]).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+(x.codeGeneration?"":" — setup required")+'</option>').join("");$("#bookmakerStatus").textContent=d.configured?"Multi-bookmaker code generation ready.":"SportyBet is live now. Other bookmaker codes require BETRELAY_API_KEY."}catch{$("#bookmakerStatus").textContent="Unable to load bookmaker services."}}
async function booking(){const rows=[...state.selected.values()];if(!rows.length)return alert("Select at least one analyzed match first.");const bookmaker=$("#bookmaker").value||"sportybet";$("#booking").disabled=true;$("#booking").textContent="Generating…";try{const d=await (await fetch("/api/booking-code",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sport:state.sport,bookmaker,selections:rows.map(x=>({eventId:x.eventId,home:x.home,away:x.away,pick:x.pick,marketId:x.marketId,specifier:x.specifier,outcomeId:x.outcomeId}))})})).json();if(!d.ok)throw new Error(d.error||"Booking code unavailable.");$("#bookingCode").textContent=d.bookingCode;$("#bookingTarget").textContent=(d.target||bookmaker)+" code";$("#bookingSource").textContent=d.source||"";$("#bookingUnavailable").innerHTML="";$("#bookingResult").hidden=false;$("#copyBooking").onclick=async()=>{try{await navigator.clipboard.writeText(d.bookingCode);$("#copyBooking").textContent="Copied";setTimeout(()=>$("#copyBooking").textContent="Copy code",1500)}catch{alert("Booking code: "+d.bookingCode)}}}catch(e){alert(e.message||"Booking code unavailable.")}finally{$("#booking").disabled=false;$("#booking").textContent="Generate booking code"}}
function resetFilters(){const defaults=state.sport==="basketball"?["basketball_total"]:state.sport==="table_tennis"?["table_tennis_moneyline"]:state.sport==="tennis"?["tennis_moneyline"]:state.sport==="ice_hockey"?["hockey_moneyline"]:state.sport==="baseball"?["baseball_moneyline"]:["ou"];const first=state.sport==="basketball"?"Over 150.5":state.sport==="tennis"?"Player 1":state.sport==="ice_hockey"||state.sport==="baseball"?"Home":"Over 1.5";state.markets=new Set(defaults);state.selections=new Set();$("#gameLimit").value=20;$("#league").selectedIndex=-1;renderMarketOptions();renderSelectionOptions();state.selected.clear();renderSlip();setStatus("Filters reset. Choose your options and Analyze.")}
function showPage(n){
  $$(".page").forEach(p=>p.classList.remove("active-page"));$("#page-"+n)?.classList.add("active-page");
  document.querySelectorAll("[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===n));closeSide();scrollTo({top:0,behavior:"smooth"});
  if(n==="calendar"){$("#calendarDate").value=state.date;loadCalendar()}
  if(n==="predictions")prepareDailyPage();
  if(n==="history"){const d=historySelectedDate();$("#historyDate").value=d;refreshHistory(d)}
  if(n==="correct-score"){const d=state.date;$("#csDate").value=d;loadCorrectScores(d)}
}
const side=$("#side"),backdrop=$("#backdrop");function closeSide(){side.classList.remove("open");backdrop.classList.remove("show")}function openSide(){side.classList.add("open");backdrop.classList.add("show")}
$("#menu").onclick=()=>side.classList.contains("open")?closeSide():openSide();$("#sideClose").onclick=closeSide;backdrop.onclick=closeSide;
$$("[data-page]").forEach(b=>b.onclick=()=>showPage(b.dataset.page));
$("#snapToggle").onclick=()=>{$("#snapBody").classList.toggle("open");$("#snapArrow").textContent=$("#snapBody").classList.contains("open")?"⌃":"⌄"};
$("#fixtureFile").onchange=e=>$("#fileName").textContent=e.target.files[0]?"Selected: "+e.target.files[0].name:"";
$("#sportSelect").onchange=async e=>{state.sport=e.target.value||"football";const defaults=state.sport==="basketball"?["basketball_total"]:state.sport==="tennis"?["tennis_moneyline"]:state.sport==="ice_hockey"?["hockey_moneyline"]:state.sport==="baseball"?["baseball_moneyline"]:["ou"];state.markets=new Set(defaults);state.selections=new Set();marketCatalog=allMarketCatalog;renderMarketOptions();renderSelectionOptions();state.selected.clear();renderSlip();$("#league").innerHTML="";await Promise.all([loadLeagues(),loadBase()]);if($("#page-predictions")?.classList.contains("active-page"))loadDailyBest();};
$("#fixtureDate").onchange=async e=>{setDate(e.target.value);$("#league").innerHTML="";state.selected.clear();renderSlip();await Promise.all([loadLeagues(),loadBase()])};
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
$("#sporty").onclick=()=>window.open("https://www.sportybet.com/ng/","_blank");
$("#calendarDate").onchange=loadCalendar;$("#calPrev").onclick=()=>{$("#calendarDate").value=shiftDate(-1);loadCalendar()};$("#calNext").onclick=()=>{$("#calendarDate").value=shiftDate(1);loadCalendar()};$("#calToday").onclick=()=>{$("#calendarDate").value=dateKey(new Date());loadCalendar()};$("#calLoad").onclick=loadCalendar;
$("#historyDate").onchange=()=>refreshHistory($("#historyDate").value);$("#csLoad").onclick=()=>loadCorrectScores($("#csDate").value);$("#csToday").onclick=()=>{$("#csDate").value=dateKey(new Date());loadCorrectScores($("#csDate").value)};$("#csPrev").onclick=()=>{const d=new Date($("#csDate").value+"T00:00:00");d.setDate(d.getDate()-1);$("#csDate").value=dateKey(d);loadCorrectScores($("#csDate").value)};$("#csNext").onclick=()=>{const d=new Date($("#csDate").value+"T00:00:00");d.setDate(d.getDate()+1);$("#csDate").value=dateKey(d);loadCorrectScores($("#csDate").value)};

$("#historyPrev").onclick=()=>{const d=new Date(historySelectedDate()+"T00:00:00");d.setDate(d.getDate()-1);$("#historyDate").value=dateKey(d);refreshHistory($("#historyDate").value)};
$("#historyNext").onclick=()=>{const d=new Date(historySelectedDate()+"T00:00:00");d.setDate(d.getDate()+1);$("#historyDate").value=dateKey(d);refreshHistory($("#historyDate").value)};
$("#historyToday").onclick=()=>{$("#historyDate").value=dateKey(new Date());refreshHistory($("#historyDate").value)};
async function updateScan(){const b=$("#refreshScan");if(b)b.disabled=true;setStatus("Scanning SportyBet again for "+prettyDate(state.date)+"...");try{const d=await (await fetch("/api/scan?sport="+encodeURIComponent(state.sport)+"&date="+encodeURIComponent(state.date))).json();if(!d.ok)throw new Error(d.error||"Scan failed");await loadLeagues();await loadBase();await loadDailyBest();await refreshHistory(state.date);setStatus("Fresh scan complete: "+d.fixtureCount+" fixture(s) archived for "+prettyDate(state.date)+".")}catch(e){setStatus(e.message||"Fresh scan failed")}finally{if(b)b.disabled=false}}
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
window.renderHistory=renderHistory;
window.loadOmegaplusBest=loadDailyBest;
function scheduleMidnightReset(){
  const now=new Date(),next=new Date(now);next.setHours(24,0,0,0);
  setTimeout(()=>{resetDailyState();scheduleMidnightReset()},Math.max(1000,next-now+100));
}
const today=dateKey(new Date());if($("#sportSelect"))$("#sportSelect").value=state.sport;state.settings=readSavedSettings();setDate(today);appDay=today;renderDateChips();renderMarketOptions();renderSelectionOptions();applySettings(state.settings);bindMarketDropdowns();loadLeagues();loadBase();loadBookmakers();renderSlip();$("#historyDate").value=today;renderHistory(today);scheduleMidnightReset();setInterval(resetDailyState,30000);setInterval(async()=>{const h=readHistory();const pending=h.some(x=>x.outcome==="Pending"&&x.date<=dateKey(new Date()));if(!pending)return;const d=$("#historyDate")?.value||dateKey(new Date());try{await refreshHistory(d)}catch{}},30*60*1000);(async()=>{try{const d=await (await fetch("/api/results/status")).json();if($("#resultProviderStatus"))$("#resultProviderStatus").textContent=d.verification||"Multi-source result verification active."}catch{}})();
// Public read-only bridge for additive upgrade modules. No existing state is replaced.
window.omegaRows=()=>Array.isArray(state.rows)?state.rows.slice():[];
window.omegaStateDate=()=>state.date||new Date().toISOString().slice(0,10);
window.omegaSport=()=>state.sport||"football";
