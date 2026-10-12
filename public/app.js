const state={sport:"football",rows:[],selected:new Map(),analyzerSelected:new Map(),markets:new Set(["ou"]),selections:new Set(["ou::over_1_5"]),date:"",dates:new Set(),settings:{games:20,minConfidence:0,defaultMarket:"ou",defaultSelection:"Over 1.5",riskProfile:"Balanced",oddsMin:"",oddsMax:"",autoRefresh:false,showConfidence:true,notifications:false}};
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
function slipStorageKey(sport=state.sport){return "omegaplus_prediction_slip_v1:"+sport}
function saveSlip(){try{localStorage.setItem(slipStorageKey(),JSON.stringify([...state.selected.values()]));return true}catch{return false}}
function restoreSlip(){state.selected.clear();try{const saved=JSON.parse(localStorage.getItem(slipStorageKey())||"[]");if(Array.isArray(saved))saved.filter(x=>x&&x.id&&x.eventId).forEach(x=>state.selected.set(x.id,x))}catch{};return state.selected.size}
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
function setDate(v){state.date=v;state.dates=new Set([v]);state.rows=[];state.analyzerSelected.clear();$("#fixtureDate").value=v;$("#calendarDate").value=v;$("#selectedDateMetric").textContent=v.slice(5).replace("-","/");renderDateChips();if($("#matches"))renderRows();}
function shiftDate(days){const d=new Date(state.date+"T00:00:00");d.setDate(d.getDate()+days);return dateKey(d)}
function selectedLeagues(){return $("#league")?[...$("#league").selectedOptions].map(o=>o.value):[]}
function renderDateChips(){
  const box=$("#selectedDates");if(!box)return;
  box.innerHTML=[...state.dates].sort().map(d=>'<button class="date-chip" data-date="'+esc(d)+'">'+esc(prettyDate(d))+' ×</button>').join("");
  $$("#selectedDates .date-chip").forEach(b=>b.onclick=()=>{state.dates.delete(b.dataset.date);if(!state.dates.size)state.dates.add(state.date);renderDateChips()});
}
function archiveKey(){return "omegaplus_day_archive_v1"}
function readArchive(){try{return JSON.parse(localStorage.getItem(archiveKey())||"{}")}catch{return{}}}
function writeArchive(a){try{localStorage.setItem(archiveKey(),JSON.stringify(a));return true}catch{return false}}
function archiveDay(date,payload={}){const a=readArchive();a[date]={...(a[date]||{}),...payload,savedAt:new Date().toISOString()};writeArchive(a)}

function settleOutcome(x){
  const status=String(x.status||x.matchStatus||"").toLowerCase();
  if(/postpon/.test(status))return "Postponed";
  if(/cancel|void|abandon/.test(status))return "Void";
  const finished=/finished|full.?time|ended|closed|complete|final|\bft\b|after extra|penalt(y|ies)/i.test(status);
  if(!finished)return "Pending";
  if(!["confirmed","single-source"].includes(String(x.verificationStatus||"")))return "Pending";
  if(x.homeScore===null||x.homeScore===undefined||x.homeScore===""||x.awayScore===null||x.awayScore===undefined||x.awayScore==="")return "Pending";
  const hs=Number(x.homeScore),as=Number(x.awayScore),pick=String(x.pick||x.selection||"").toLowerCase();
  if(!Number.isFinite(hs)||!Number.isFinite(as))return "Pending";
  if(String(x.market||"").toLowerCase()==="correct score"){
    const cs=pick.match(/^(\d+)\s*[-:]\s*(\d+)$/);
    if(!cs)return "Pending";
    return hs===Number(cs[1])&&as===Number(cs[2])?"Won":"Lost";
  }

  const total=hs+as,m=pick.match(/over\s*(\d+(?:\.\d+)?)/),u=pick.match(/under\s*(\d+(?:\.\d+)?)/);
  if(m){const line=Number(m[1]);return total===line?"Void":total>line?"Won":"Lost";}
  if(u){const line=Number(u[1]);return total===line?"Void":total<line?"Won":"Lost";}
  if(/btts|both teams to score|gg/.test(pick)||/both teams to score|btts/i.test(String(x.market||""))){
    const yes=!/no|not|ng/.test(pick),actual=hs>0&&as>0;return actual===yes?"Won":"Lost";
  }
  if(/home or draw|1x/.test(pick))return hs>=as?"Won":"Lost";
  if(/home or away|12/.test(pick))return hs!==as?"Won":"Lost";
  if(/draw or away|x2/.test(pick))return as>=hs?"Won":"Lost";
  // European handicap score, e.g. "Home (1:0)", adds the displayed
  // virtual score before evaluating Home/Draw/Away.
  const europeanHcp=pick.match(/\((\d+)\s*:\s*(\d+)\)/)||String(x.specifier||"").match(/hcp=(\d+)\s*:\s*(\d+)/i);
  if(europeanHcp&&(String(x.marketType||"")==="handicap"||/handicap/i.test(String(x.market||""))||/hcp=/i.test(String(x.specifier||"")))){
    const ah=hs+Number(europeanHcp[1]),aa=as+Number(europeanHcp[2]);
    if(/\bhome\b/.test(pick))return ah>aa?"Won":"Lost";
    if(/\bdraw\b/.test(pick))return ah===aa?"Won":"Lost";
    if(/\baway\b/.test(pick))return aa>ah?"Won":"Lost";
    return "Pending";
  }
  const asianHcp=pick.match(/\b(home|away)\s*\(([+-]\d+(?:\.\d+)?)\)/)||pick.match(/\b(home|away)\s*([+-]\d+(?:\.\d+)?)/);
  if(asianHcp&&(String(x.marketType||"")==="handicap"||/handicap/i.test(String(x.market||"")))){
    const side=asianHcp[1],line=Number(asianHcp[2]),adjusted=(side==="home"?hs:as)+line,opponent=side==="home"?as:hs;
    return adjusted===opponent?"Void":adjusted>opponent?"Won":"Lost";
  }
  if(/home/.test(pick))return hs>as?"Won":"Lost";
  if(/away/.test(pick))return as>hs?"Won":"Lost";
  if(/draw|tie/.test(pick))return hs===as?"Won":"Lost";
  return "Pending";
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
function renderHistory(date=historySelectedDate(),rows=[]){
  const box=$("#historyList");
  if(!box)return;
  const h=(Array.isArray(rows)?rows:[])
    .filter(x=>(x.sport||"football")===state.sport&&String(x.date||date)===date)
    .sort((a,b)=>Number(b.confidence||0)-Number(a.confidence||0)||String(a.time||"").localeCompare(String(b.time||"")))
    .slice(0,50);
  const safe=v=>esc(v==null||v===""?"—":v);
  const sourceText=x=>Array.isArray(x.sources)?x.sources.join(" + "):Array.isArray(x.independentSources)?x.independentSources.join(" + "):typeof x.sources==="string"?x.sources:"Result verification pending";
  updateOutcomeSummary(h,"history");
  $("#historyStatus").textContent=h.length?h.length+" shared record(s) for "+prettyDate(date)+".":"No archived prediction records for "+prettyDate(date)+".";
  box.style.display="block";
  box.style.visibility="visible";
  box.style.color="var(--text, #eef5f0)";
  if(!h.length){
    box.innerHTML='<div class="empty" style="display:block;visibility:visible;padding:16px;color:var(--text,#eef5f0)">No records archived online for this date.</div>';
    return;
  }
  box.innerHTML=h.map(x=>{
    const teams=safe(x.home)+" vs "+safe(x.away);
    const outcomeLabel=String(x.outcome||"Pending");
    const outcomeKey=/^won$/i.test(outcomeLabel)?"won":/^lost$/i.test(outcomeLabel)?"lost":/^void(?:ed)?$/i.test(outcomeLabel)?"void":"pending";
    const rawPick=String(x.pick||x.selection||x.market||"");
    const pick=safe(rawPick);
    const odds=x.odds==null?"—":safe(x.odds);
    const confidence=x.confidence==null?"—":safe(x.confidence);
    const score=Number.isFinite(Number(x.homeScore))&&Number.isFinite(Number(x.awayScore))&&x.homeScore!==null&&x.awayScore!==null
      ? " · "+safe(x.homeScore)+"-"+safe(x.awayScore):"";
    return '<article class="history-item" style="display:flex!important;visibility:visible!important;opacity:1!important;color:var(--text,#eef5f0);align-items:center;gap:12px;padding:14px;margin:8px 0;border:1px solid rgba(255,255,255,.14);border-radius:14px;background:rgba(255,255,255,.04)">'+
      '<div style="display:grid!important;visibility:visible;gap:5px;min-width:0;flex:1">'+
      '<small style="display:block;color:#aab8b0">'+safe(x.category||x.league)+' · '+safe(x.time||"Time unavailable")+' · '+safe(date)+'</small>'+
      '<b style="display:block;color:var(--text,#eef5f0);overflow-wrap:anywhere">'+teams+'</b>'+
      '<span style="display:block;color:#d5e0d9">'+pick+' · '+confidence+'% · @'+odds+'</span>'+
      '<small style="display:block;color:#aab8b0">'+safe(sourceText(x))+(x.verificationStatus==="confirmed"?" · VERIFIED":x.verificationStatus==="conflict"?" · CONFLICT":x.verificationStatus==="single-source"?" · SINGLE-SOURCE":" · UNVERIFIED")+score+'</small>'+
      '</div><strong class="outcome-indicator outcome-'+outcomeKey+'">'+safe(outcomeLabel)+'</strong></article>';
  }).join("");
}
let historyRequestSequence=0;
async function refreshHistory(date=historySelectedDate()){
  const requestSequence=++historyRequestSequence;
  $("#historyStatus").textContent="Loading shared online history…";
  try{
    let response=await jsonFetch("/api/history?sport="+encodeURIComponent(state.sport)+"&date="+encodeURIComponent(date));
    let archive=response.archive||null;
    if(!archive&&date===dateKey(new Date())){
      const generated=await jsonFetch("/api/daily-best?sport="+encodeURIComponent(state.sport)+"&date="+encodeURIComponent(date));
      archive={date,sport:state.sport,predictions:generated.predictions||[],correctScores:[],results:[]};
    }
    let day=(archive?.dailyBestPredictions||archive?.predictions||[]).slice(0,10).map(x=>({...x,date,sport:state.sport}));
    let correctScoreRows=(archive?.correctScores||[]).slice(0,5).map((x,i)=>({...x,id:x.id||"cs_"+(x.eventId||i),eventId:x.eventId||x.id||("cs_"+i),sport:"football",date,market:"Correct Score",outcome:x.outcome||"Pending"}));
    let resultRows=Array.isArray(archive?.results)?archive.results:[];
    // Use the result snapshot returned with the archive. A separate forced refresh here
    // can make the UI settle against different data than the server has persisted.
    const norm=v=>String(v||"").toLowerCase().normalize("NFKD").replace(/[\\u0300-\\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
    const teamKey=v=>norm(v).split(" ").filter(t=>t&&!["fc","cf","sc","afc","club","football","soccer","the"].includes(t)).join(" ");
    const teamScore=(a,b)=>{
      const x=teamKey(a),y=teamKey(b);if(!x||!y)return 0;if(x===y)return 1;
      if(x.includes(y)||y.includes(x))return Math.min(x.length,y.length)/Math.max(x.length,y.length)+0.12;
      const xt=new Set(x.split(" ")),yt=new Set(y.split(" "));let common=0;for(const t of xt)if(yt.has(t))common++;
      return common/Math.max(1,new Set([...xt,...yt]).size);
    };
    const findResult=x=>{
      const candidates=resultRows.map(r=>{
        const dateOK=!r.date||r.date==="Invalid Date"||String(r.date)===String(date);
        const hs=teamScore(r.home,x.home),as=teamScore(r.away,x.away);
        const reverseHs=teamScore(r.home,x.away),reverseAs=teamScore(r.away,x.home);
        const normal=hs>=0.68&&as>=0.68?Math.min(hs,as):0;
        const reversed=reverseHs>=0.68&&reverseAs>=0.68?Math.min(reverseHs,reverseAs):0;
        const orientation=reversed>normal?"reversed":"normal";
        let score=Math.max(normal,reversed);
        if(x.league&&r.league&&norm(x.league)===norm(r.league))score+=0.04;
        const xt=Number(x.startTimeMs||0),rt=Number(r.startingAt||0)*1000;
        if(xt&&rt){
          const delta=Math.abs(xt-rt);
          if(delta>18*60*60*1000)score=0;
          else if(delta<=3*60*60*1000)score+=0.04;
        }
        if(score>0&&x.resultProviderId&&String(r.providerId||"")===String(x.resultProviderId))score+=0.12;
        if(score>0&&x.eventId&&String(r.eventId||r.fixtureId||"")===String(x.eventId))score+=0.08;
        return {r,score,orientation,dateOK};
      }).filter(c=>c.dateOK&&c.score>=0.68).sort((a,b)=>b.score-a.score);
      if(!candidates.length)return null;
      if(candidates.length>1&&candidates[0].score-candidates[1].score<0.035)return null;
      const best=candidates[0];
      if(best.orientation==="reversed")return {...best.r,homeScore:best.r.awayScore,awayScore:best.r.homeScore};
      return best.r;
    };
    const updateRow=x=>{
      const z=findResult(x);
      if(z){x.status=z.status||x.status;x.homeScore=z.homeScore??x.homeScore;x.awayScore=z.awayScore??x.awayScore;x.resultProviderId=z.providerId||x.resultProviderId;x.sources=z.sources||x.sources||[];x.verificationStatus=z.verificationStatus||x.verificationStatus||"unverified";x.verificationCount=z.verificationCount||x.verificationCount||1}
      x.outcome=settleOutcome(x);
      return x;
    };
    if(requestSequence!==historyRequestSequence)return;
    day=day.map(updateRow);
    correctScoreRows=correctScoreRows.map(updateRow);
    renderHistory(date,[...day,...correctScoreRows]);
  }catch(e){
    if(requestSequence!==historyRequestSequence)return;
    renderHistory(date,[]);
    $("#historyStatus").textContent="Could not load shared online history: "+(e.message||"server unavailable")+". Please retry.";
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
  $("#marketOptions").onchange=()=>{state.analyzerSelected.clear();state.rows=[];state.markets=new Set([...$("#marketOptions").selectedOptions].map(o=>o.value));if(!state.markets.size)state.markets.add(state.sport==="basketball"?"basketball_total":"ou");renderMarketOptions();renderSelectionOptions();renderRows()};
  $("#selectionOptions").onchange=()=>{state.analyzerSelected.clear();state.rows=[];state.selections=new Set([...$("#selectionOptions").selectedOptions].map(o=>o.value));if(!state.selections.size){const marketId=[...state.markets][0],first=(marketCatalog[marketId]?.options||[])[0];if(first)state.selections.add(selectionValue(marketId,first))}renderSelectionOptions();renderRows()};
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
function predictionReasonsHtml(x){
  const reasons=Array.isArray(x.reasons)?x.reasons.filter(Boolean):[];
  if(!reasons.length){
    const fallback=[];
    if(Number.isFinite(Number(x.marketConfidence)))fallback.push("SportyBet market-implied probability: "+Math.round(Number(x.marketConfidence))+"%.");
    if(x.independentConfidence!==null&&x.independentConfidence!==undefined&&Number.isFinite(Number(x.independentConfidence)))fallback.push("Independent-statistics signal: "+Math.round(Number(x.independentConfidence))+"%.");
    if(Array.isArray(x.independentSources)&&x.independentSources.length)fallback.push("Independent sources: "+x.independentSources.join(", ")+".");
    if(Number.isFinite(Number(x.odds)))fallback.push("Displayed SportyBet odds: "+Number(x.odds).toFixed(2)+".");
    if(!fallback.length)fallback.push("This pick is based on the available SportyBet market data. Independent statistical evidence was not returned for this fixture.");
    return '<details class="reason-box"><summary>Why this pick?</summary><ul>'+fallback.map(v=>"<li>"+esc(v)+"</li>").join("")+'</ul></details>';
  }
  return '<details class="reason-box"><summary>Why this pick?</summary><ul>'+reasons.map(v=>"<li>"+esc(v)+"</li>").join("")+'</ul></details>';
}
function renderRows(){
  if(!state.rows.length){$("#matches").innerHTML='<div class="empty">No games matched this date and filter.</div>';return}
  $("#matches").innerHTML=state.rows.map(x=>{
    const selected=state.analyzerSelected.has(x.id);
    const confidence=Number.isFinite(Number(x.confidence))?Math.max(0,Math.min(100,Number(x.confidence))):null;
    const confidenceLabel=x.confidenceLabel||(confidence===null?"Unavailable":confidence>=85?"Very High":confidence>=75?"High":confidence>=65?"Good":"Moderate");
    const grade=x.qualityGrade||(confidence===null?"—":confidence>=92&&x.independentConfidence!=null?"A+":confidence>=86?"A":confidence>=76?"B":confidence>=66?"C":"D");
    const odds=Number.isFinite(Number(x.odds))?Number(x.odds).toFixed(2):"—";
    const marketName=String(x.market||"Market unavailable")+(x.specifier?" · "+String(x.specifier):"");
    const statsSources=Array.isArray(x.independentSources)&&x.independentSources.length?x.independentSources.join(", "):"not available for this fixture";
    const confidenceMarkup=confidence===null?'<strong>—</strong><small>Confidence unavailable</small>':'<strong>'+esc(confidence.toFixed(0))+'%</strong><div class="bar"><i style="width:'+esc(confidence)+'%"></i></div><small>Model confidence</small>';
    return '<article class="match"><div><div class="meta">'+esc(x.league)+' · '+esc(x.time)+'</div><div class="teams">'+esc(x.home)+' <span>vs</span> '+esc(x.away)+'</div><div class="market-source">SPORTYBET MARKET · '+esc(statsSources)+'</div><div class="pick"><span>SportyBet market · '+esc(marketName)+'</span><b>'+esc(x.pick||"Selection unavailable")+'</b></div><div class="pick"><span>Current listed odds</span><b>'+esc(odds)+'</b></div><div class="pick"><span>Confidence level</span><b>'+esc(confidenceLabel)+'</b></div><div class="pick"><span>Grade</span><b>'+esc(grade)+'</b></div>'+predictionReasonsHtml(x)+'<button class="select '+(selected?"selected":"")+'" data-id="'+esc(x.id)+'">'+(selected?"Selected for slip":"Select for slip")+'</button></div><div class="prob">'+confidenceMarkup+'</div></article>';
  }).join("");
  $$(".select[data-id]").forEach(b=>b.onclick=()=>{const row=state.rows.find(x=>x.id===b.dataset.id);if(!row)return;if(state.analyzerSelected.has(row.id))state.analyzerSelected.delete(row.id);else state.analyzerSelected.set(row.id,{...row,sport:state.sport});renderRows()});
}
function renderSlip(){
  const rows=[...state.selected.values()];$("#slipCount").textContent=rows.length;$("#selectedHome").textContent=rows.length;
  $("#slip").innerHTML=rows.length?rows.map(x=>'<div class="slipitem"><b>'+esc(x.home)+' vs '+esc(x.away)+'</b><small>'+esc(x.date?prettyDate(x.date):"Date unavailable")+' · '+esc(x.pick)+' · '+esc(x.confidence)+'% · @'+esc(x.odds)+'</small><button class="slip-remove" data-remove-slip="'+esc(x.id)+'" type="button" aria-label="Remove '+esc(x.home)+' versus '+esc(x.away)+'">Remove</button></div>').join(""):"<p>Select analyzed matches, then press Hold Slip to save them on this device.</p>";
  $$("#slip [data-remove-slip]").forEach(b=>b.onclick=()=>{state.selected.delete(b.dataset.removeSlip);renderRows();renderSlip()});
  if($("#slipStatus"))$("#slipStatus").textContent=rows.length?"Press Hold Slip to save · "+rows.length+" selection(s)":"Your slip is empty.";
}
async function analyze(){
  state.analyzerSelected.clear();state.rows=[];renderRows();
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
    renderRows();renderSlip();
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
async function loadDailyBest(attempt=0){
  const box=$("#dailyBest");if(!box)return;const date=state.date;
  box.innerHTML='<div class="empty">Loading archived Daily Best picks for '+esc(prettyDate(date))+'…</div>';
  try{
    const d=await jsonFetch("/api/daily-best?sport=football&date="+encodeURIComponent(date),{cache:"no-store"});
    if(!d.ok)throw new Error(d.error||"Unable to load daily picks.");
    if(d.retryable&&attempt<2){
      if($("#bestPicksStatus"))$("#bestPicksStatus").textContent="No fixture response yet — retrying automatically ("+(attempt+1)+"/2)…";
      await new Promise(resolve=>setTimeout(resolve,1400));
      if(date!==state.date)return;
      return loadDailyBest(attempt+1);
    }
    const rows=(d.predictions||[]).slice(0,10).map(x=>({...x,outcome:x.outcome||"Pending"}));
    const odds=rows.reduce((v,x)=>v*Number(x.odds||1),1);
    if($("#bestPicksStatus"))$("#bestPicksStatus").textContent=d.message||"Core markets only · combined odds "+Number(d.combinedOdds||odds).toFixed(2);
    updateOutcomeSummary(rows,"daily");
    if(!rows.length){
      box.innerHTML='<div class="empty">'+esc(d.message||("No quality-qualified Daily 10 set is available for "+prettyDate(date)+"."))+'</div>';
      return;
    }
    const actionBar='<div class="daily-actions"><button class="primary" id="dailySelectAll">Select All 10</button><button class="secondary" id="dailyClearAll">Clear Daily Selections</button><span class="daily-combo">Combined odds: <b>'+esc(Number(d.combinedOdds||odds).toFixed(2))+'</b></span></div>';
    box.innerHTML=rows.map(x=>'<article class="match compact"><div><div class="meta">#'+esc(x.dailyRank||"—")+' · '+esc(x.league)+' · '+esc(x.time)+'</div><div class="teams">'+esc(x.home)+' <span>vs</span> '+esc(x.away)+'</div><div class="pick"><span>'+esc(x.market)+' · '+esc(x.marketType==="1x2"?"1X2":x.marketType==="btts"?"BTTS":x.pick)+' · Odds '+esc(Number(x.odds||0).toFixed(2))+'</span><b>'+esc(x.pick)+'</b></div><div class="pick"><span>Result</span><b>'+esc(x.outcome)+'</b></div>'+predictionReasonsHtml(x)+'</div><div class="prob"><strong>'+esc(x.confidence)+'%</strong><button class="select '+(state.selected.has(x.id)?"selected":"")+'" data-top-id="'+esc(x.id)+'">'+(state.selected.has(x.id)?"Remove":"Select")+'</button></div></article>').join("")+actionBar;
    box.querySelector(".daily-actions").insertAdjacentHTML("beforeend",'<small id="dailySelectedCombo" class="daily-selected-combo">0 selected</small>');
    const renderDailyActions=()=>{
      const selectedRows=rows.filter(x=>state.selected.has(x.id));
      const combined=selectedRows.reduce((v,x)=>v*Number(x.odds||1),selectedRows.length?1:0);
      const badge=$("#dailySelectedCombo");
      if(badge)badge.textContent=selectedRows.length+" selected"+(selectedRows.length?" · odds "+combined.toFixed(2):"");
      const all=$("#dailySelectAll");if(all)all.textContent=rows.every(x=>state.selected.has(x.id))?"All 10 Selected":"Select All 10";
      document.querySelectorAll("#dailyBest [data-top-id]").forEach(b=>{const on=state.selected.has(b.dataset.topId);b.classList.toggle("selected",on);b.textContent=on?"Remove":"Select"});
      renderSlip();
    };
    $("#dailySelectAll").onclick=()=>{
      const allSelected=rows.every(x=>state.selected.has(x.id));
      if(allSelected)rows.forEach(x=>state.selected.delete(x.id));
      else rows.forEach(x=>state.selected.set(x.id,x));
      renderDailyActions();
    };
    $("#dailyClearAll").onclick=()=>{rows.forEach(x=>state.selected.delete(x.id));renderDailyActions()};
    document.querySelectorAll("#dailyBest [data-top-id]").forEach(b=>b.onclick=()=>{
      const row=rows.find(x=>x.id===b.dataset.topId);if(!row)return;
      if(state.selected.has(row.id))state.selected.delete(row.id);else if(state.selected.size<50)state.selected.set(row.id,row);
      renderDailyActions();
    });
    renderDailyActions();
    refreshHistory(date).catch(()=>{});
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
  try{await refreshHistory(date)}catch{}
  }catch(e){$("#csStatus").textContent=e.message||"Correct-score analysis failed.";box.innerHTML='<div class="empty">'+esc(e.message||"Correct-score analysis failed.")+'</div>'}
}
async function loadBookmakers(){try{const d=await (await fetch("/api/bookmakers")).json();$("#bookmaker").innerHTML=(d.bookmakers||[]).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+(x.codeGeneration?"":" — setup required")+'</option>').join("");$("#bookmakerStatus").textContent=d.configured?"Multi-bookmaker code generation ready.":"SportyBet is live now. Other bookmaker codes require BETRELAY_API_KEY."}catch{$("#bookmakerStatus").textContent="Unable to load bookmaker services."}}
async function booking(){const rows=[...state.selected.values()];if(!rows.length)return alert("Select at least one analyzed match first.");const bookmaker=$("#bookmaker").value||"sportybet";$("#booking").disabled=true;$("#booking").textContent="Generating…";try{const d=await (await fetch("/api/booking-code",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sport:state.sport,bookmaker,selections:rows.map(x=>({eventId:x.eventId,home:x.home,away:x.away,pick:x.pick,marketId:x.marketId,specifier:x.specifier,outcomeId:x.outcomeId}))})})).json();if(!d.ok)throw new Error(d.error||"Booking code unavailable.");$("#bookingCode").textContent=d.bookingCode;$("#bookingTarget").textContent=(d.target||bookmaker)+" code";$("#bookingSource").textContent=d.source||"";$("#bookingUnavailable").innerHTML="";$("#bookingResult").hidden=false;$("#copyBooking").onclick=async()=>{try{await navigator.clipboard.writeText(d.bookingCode);$("#copyBooking").textContent="Copied";setTimeout(()=>$("#copyBooking").textContent="Copy code",1500)}catch{alert("Booking code: "+d.bookingCode)}}}catch(e){alert(e.message||"Booking code unavailable.")}finally{$("#booking").disabled=false;$("#booking").textContent="Generate booking code"}}
function resetFilters(){state.analyzerSelected.clear();state.rows=[];const defaults=state.sport==="basketball"?["basketball_total"]:state.sport==="tennis"?["tennis_moneyline"]:state.sport==="ice_hockey"?["hockey_moneyline"]:state.sport==="baseball"?["baseball_moneyline"]:["ou"];const first=state.sport==="basketball"?"Over 150.5":state.sport==="tennis"?"Player 1":state.sport==="ice_hockey"||state.sport==="baseball"?"Home":"Over 1.5";state.markets=new Set(defaults);state.selections=new Set();$("#gameLimit").value=20;$("#league").selectedIndex=-1;renderMarketOptions();renderSelectionOptions();renderRows();renderSlip();setStatus("Filters reset. Analyzer selections cleared; your prediction slip has been kept. Choose your options and Analyze.")}
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
$("#sportSelect").onchange=async e=>{state.analyzerSelected.clear();state.rows=[];state.sport=e.target.value||"football";restoreSlip();const defaults=state.sport==="basketball"?["basketball_total"]:state.sport==="tennis"?["tennis_moneyline"]:state.sport==="ice_hockey"?["hockey_moneyline"]:state.sport==="baseball"?["baseball_moneyline"]:["ou"];state.markets=new Set(defaults);state.selections=new Set();marketCatalog=allMarketCatalog;renderMarketOptions();renderSelectionOptions();renderRows();renderSlip();$("#league").innerHTML="";await Promise.all([loadLeagues(),loadBase()]);if($("#page-predictions")?.classList.contains("active-page"))loadDailyBest();};
$("#fixtureDate").onchange=async e=>{setDate(e.target.value);$("#league").innerHTML="";await Promise.all([loadLeagues(),loadBase()])};
$("#prevDate").onclick=async()=>{$("#fixtureDate").value=shiftDate(-1);$("#fixtureDate").dispatchEvent(new Event("change"))};
$("#nextDate").onclick=async()=>{$("#fixtureDate").value=shiftDate(1);$("#fixtureDate").dispatchEvent(new Event("change"))};
$("#todayDate").onclick=async()=>{setDate(dateKey(new Date()));$("#fixtureDate").dispatchEvent(new Event("change"))};
$("#league").onchange=()=>$("#leagueCount").textContent=(selectedLeagues().length?selectedLeagues().length+" selected":"All leagues");
$("#analyze").onclick=analyze;$("#resetFilters").onclick=resetFilters;$("#booking").onclick=booking;
$("#selectAll").onclick=()=>{
  for(const row of state.rows)state.analyzerSelected.set(row.id,{...row,sport:state.sport});
  renderRows();
};
$("#clearAll").onclick=()=>{
  state.analyzerSelected.clear();
  renderRows();
};
$("#holdSlip").onclick=()=>{
  let added=0;for(const row of state.analyzerSelected.values()){if(state.selected.has(row.id))continue;if(state.selected.size>=50)break;state.selected.set(row.id,{...row,sport:state.sport});added++}
  state.analyzerSelected.clear();renderRows();renderSlip();
  const ok=saveSlip();if($("#slipStatus"))$("#slipStatus").textContent=ok?"Slip held and saved on this device · "+state.selected.size+" selection(s)"+(added?" · "+added+" added":""):"Could not save the slip on this device.";
};
$("#clearSlip").onclick=()=>{state.selected.clear();state.analyzerSelected.clear();try{localStorage.removeItem(slipStorageKey())}catch{};renderRows();renderSlip();$("#bookingResult").hidden=true;if($("#slipStatus"))$("#slipStatus").textContent="Prediction slip cleared.";};
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
  state.date=today;state.dates=new Set([today]);state.rows=[];state.analyzerSelected.clear();
  $("#fixtureDate").value=today;$("#calendarDate").value=today;$("#selectedDateMetric").textContent=today.slice(5).replace("-","/");
  renderDateChips();renderRows();renderSlip();
  loadLeagues();loadBase();
  if($("#page-predictions")?.classList.contains("active-page"))loadDailyBest();
}
function prepareDailyPage(){
  const today=dateKey(new Date());
  if(state.date!==today){appDay=today;state.date=today;state.dates=new Set([today]);state.rows=[];state.analyzerSelected.clear();$("#fixtureDate").value=today;$("#calendarDate").value=today;$("#selectedDateMetric").textContent=today.slice(5).replace("-","/");renderDateChips();renderRows();renderSlip();loadLeagues();loadBase()}
  loadDailyBest();
}
window.renderHistory=renderHistory;
window.loadOmegaplusBest=loadDailyBest;
function scheduleMidnightReset(){
  const now=new Date(),next=new Date(now);next.setHours(24,0,0,0);
  setTimeout(()=>{resetDailyState();scheduleMidnightReset()},Math.max(1000,next-now+100));
}
const today=dateKey(new Date());if($("#sportSelect"))$("#sportSelect").value=state.sport;restoreSlip();state.settings=readSavedSettings();setDate(today);appDay=today;renderDateChips();renderMarketOptions();renderSelectionOptions();applySettings(state.settings);bindMarketDropdowns();loadLeagues();loadBase();loadBookmakers();renderSlip();$("#historyDate").value=today;renderHistory(today);scheduleMidnightReset();setInterval(resetDailyState,30000);setInterval(()=>{if($("#page-history")?.classList.contains("active-page")){const d=$("#historyDate")?.value||dateKey(new Date());refreshHistory(d).catch(()=>{})}},5*60*1000);(async()=>{try{const d=await (await fetch("/api/results/status")).json();if($("#resultProviderStatus"))$("#resultProviderStatus").textContent=d.verification||"Multi-source result verification active."}catch{}})();
// Public read-only bridge for additive upgrade modules. No existing state is replaced.
window.omegaRows=()=>Array.isArray(state.rows)?state.rows.slice():[];
window.omegaStateDate=()=>state.date||new Date().toISOString().slice(0,10);
window.omegaSport=()=>state.sport||"football";
