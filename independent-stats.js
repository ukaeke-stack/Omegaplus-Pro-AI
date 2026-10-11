import { getGoalApiTeamForm, checkGoalApiStatsHealth } from "./goal-api-stats.js";
import { getMyLeagues } from "./sportmonks-results.js";

const SOFASCORE_BASE="https://api.sofascore.com/api/v1";
const UNDERSTAT_BASE="https://understat.com/";
const FETCH_TIMEOUT=7000;
const CACHE_TTL=6*60*60*1000;
const MAX_CONCURRENCY=4;
const cache=new Map();
let sportmonksHealthCache=null;

function key(v){return String(v||"").toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g," ").trim()}
function seasonStart(date){const d=new Date(date+"T12:00:00Z");const y=d.getUTCFullYear();return d.getUTCMonth()>=6?y:y-1}
function supportedUnderstatLeague(name){
  const n=key(name);
  if(n==="premier league")return"EPL";
  if(n==="laliga"||n==="la liga")return"La_Liga";
  if(n==="serie a")return"Serie_A";
  if(n==="bundesliga")return"Bundesliga";
  if(n==="ligue 1")return"Ligue_1";
  return null;
}
async function fetchJson(url,headers={}){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),FETCH_TIMEOUT);
  try{
    const res=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0","Accept":"application/json,text/plain,*/*",...headers},signal:c.signal});
    if(!res.ok)throw new Error("HTTP "+res.status);
    return await res.json();
  }finally{clearTimeout(t)}
}
async function cachedJson(cacheKey,url,headers={}){
  const hit=cache.get(cacheKey);
  if(hit&&Date.now()-hit.at<CACHE_TTL)return{data:hit.data,cached:true};
  try{
    const data=await fetchJson(url,headers);
    cache.set(cacheKey,{at:Date.now(),data});
    return{data,cached:false};
  }catch(e){
    if(hit)return{data:hit.data,cached:true,stale:true,error:e.message};
    cache.set(cacheKey,{at:Date.now(),data:null,error:e.message,failed:true});
    return{data:null,cached:true,error:e.message};
  }
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length),queue=items.map((_,i)=>i);
  async function worker(){
    while(queue.length){
      const i=queue.shift();
      try{out[i]=await fn(items[i],i)}catch(e){out[i]={error:e.message}}
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));
  return out;
}
function teamNamesMatch(a,b){
  const x=key(a),y=key(b);
  return x===y||x.includes(y)||y.includes(x);
}
function eventTeamsMatch(e,home,away){
  const eh=e.homeTeam?.name||e.homeTeam?.shortName||"";
  const ea=e.awayTeam?.name||e.awayTeam?.shortName||"";
  return teamNamesMatch(eh,home)&&teamNamesMatch(ea,away);
}
async function sofaScheduled(date){
  const x=await cachedJson("sofa-schedule:"+date,SOFASCORE_BASE+"/sport/football/scheduled-events/"+date);
  return x.data?.events||[];
}
async function findSofaEvent(fixture){
  try{
    const events=await sofaScheduled(new Date(fixture.startTimeMs).toLocaleDateString("en-CA",{timeZone:"Africa/Lagos"}));
    const found=events.find(e=>eventTeamsMatch(e,fixture.home,fixture.away));
    if(!found)return{found:false,provider:"Sofascore"};
    return{found:true,provider:"Sofascore",eventId:String(found.id),event:found};
  }catch(e){return{found:false,provider:"Sofascore",error:e.message}}
}
function parsePercent(v){
  if(typeof v==="number")return v;
  const n=parseFloat(String(v||"").replace("%",""));
  return Number.isFinite(n)?n:null;
}
function flattenStats(data){
  const out={};
  for(const p of data?.statistics||[]){
    for(const group of p.groups||[]){
      for(const item of group.statisticsItems||[]){
        const h=Number.isFinite(item.homeValue)?item.homeValue:parsePercent(item.home);
        const a=Number.isFinite(item.awayValue)?item.awayValue:parsePercent(item.away);
        const name=key(item.key||item.name);
        if(name)out[name]={home:h,away:a,name:item.name};
      }
    }
  }
  return out;
}
async function sofaEventStats(eventId){
  try{
    const x=await cachedJson("sofa-stats:"+eventId,SOFASCORE_BASE+"/event/"+eventId+"/statistics");
    return flattenStats(x.data);
  }catch{return{}}
}
async function sofaEventLineups(eventId){
  if(!eventId)return null;
  try{const x=await cachedJson("sofa-lineups:"+eventId,SOFASCORE_BASE+"/event/"+eventId+"/lineups");return x.data||null}catch{return null}
}
async function sofaTeamInjuries(teamId){
  if(!teamId)return null;
  try{const x=await cachedJson("sofa-injuries:"+teamId,SOFASCORE_BASE+"/team/"+teamId+"/injuries");return x.data||null}catch{return null}
}
async function sofaTeamRecent(teamId){
  if(!teamId)return[];
  try{
    const x=await cachedJson("sofa-team-last:"+teamId,SOFASCORE_BASE+"/team/"+teamId+"/events/last/0");
    return x.data?.events||[];
  }catch{return[]}
}
function summarizeRecent(events,teamId){
  const finished=events.filter(e=>e.status?.type==="finished"||e.status?.code===100)
    .sort((a,b)=>Number(b.startTimestamp||0)-Number(a.startTimestamp||0)).slice(0,10);
  let gf=0,ga=0,w=0,d=0,l=0,over15=0,over25=0,btts=0;
  for(const e of finished){
    const home=e.homeTeam?.id===teamId;
    const hs=Number(e.homeScore?.normaltime??e.homeScore?.current??0),as=Number(e.awayScore?.normaltime??e.awayScore?.current??0);
    const f=home?hs:as,a=home?as:hs;
    gf+=f;ga+=a;if(f>a)w++;else if(f===a)d++;else l++;
    if(hs+as>1.5)over15++;if(hs+as>2.5)over25++;if(hs>0&&as>0)btts++;
  }
  const n=finished.length||1;
  return{matches:finished.length,goalsFor:gf/n,goalsAgainst:ga/n,winRate:w/n,drawRate:d/n,lossRate:l/n,over15Rate:over15/n,over25Rate:over25/n,bttsRate:btts/n};
}
async function understatLeagueData(league,season){
  const slug=supportedUnderstatLeague(league);
  if(!slug)return null;
  try{
    const x=await cachedJson("understat-league:"+slug+":"+season,UNDERSTAT_BASE+"getLeagueData/"+slug+"/"+season,{"X-Requested-With":"XMLHttpRequest","Referer":UNDERSTAT_BASE});
    return x.data||null;
  }catch{return null}
}
function understatTeamSummary(data,teamName){
  if(!data?.teams)return null;
  const team=Object.values(data.teams).find(t=>teamNamesMatch(t.title,teamName));
  if(!team?.history?.length)return null;
  const h=team.history.slice(-10);
  const avg=(field)=>{const vals=h.map(x=>Number(x[field])).filter(Number.isFinite);return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null};
  return{xg:avg("xG"),xga:avg("xGA"),npxg:avg("npxG"),npxga:avg("npxGA"),shots:avg("shots"),deep:avg("deep"),wins:h.filter(x=>Number(x.wins)>0).length};
}
async function independentStatsForFixture(fixture,sport="football"){
  const date=new Date(fixture.startTimeMs).toLocaleDateString("en-CA",{timeZone:"Africa/Lagos"});
  if(sport!=="football")return{available:[],date,sofascore:{eventId:null,form:null,stats:null,lineups:null,injuries:{home:null,away:null}},goalApi:{available:false,form:null,home:null,away:null,error:null},understat:{home:null,away:null},models:{expectedGoals:null,probabilities:null,strengthSignals:{recentForm:null,xgEdge:null},modelAgreement:null,methodology:"Football-only xG and goal models are not applied to non-football sports."}};
  const sofa=await findSofaEvent(fixture);
  let homeRecent=null,awayRecent=null,sofaStats={},lineups=null,injuries={home:null,away:null};
  if(sofa.found){
    const ht=sofa.event?.homeTeam,at=sofa.event?.awayTeam;
    const pair=await Promise.all([sofaTeamRecent(ht?.id),sofaTeamRecent(at?.id)]);
    homeRecent=summarizeRecent(pair[0],ht?.id);awayRecent=summarizeRecent(pair[1],at?.id);
    const intelligence=await Promise.all([sofaEventStats(sofa.eventId),sofaEventLineups(sofa.eventId),sofaTeamInjuries(ht?.id),sofaTeamInjuries(at?.id)]);
    sofaStats=intelligence[0];lineups=intelligence[1];injuries={home:intelligence[2],away:intelligence[3]};
  }
  const season=seasonStart(date),ud=await understatLeagueData(fixture.league,season);
  const uh=understatTeamSummary(ud,fixture.home),ua=understatTeamSummary(ud,fixture.away);
  const sofaForm=homeRecent&&awayRecent?{
    homeMatches:homeRecent.matches,awayMatches:awayRecent.matches,
    homeWinRate:homeRecent.winRate,awayWinRate:awayRecent.winRate,
    homeOver15:homeRecent.over15Rate,awayOver15:awayRecent.over15Rate,
    homeOver25:homeRecent.over25Rate,awayOver25:awayRecent.over25Rate,
    homeBtts:homeRecent.bttsRate,awayBtts:awayRecent.bttsRate,
    homeGoalsFor:homeRecent.goalsFor,awayGoalsFor:awayRecent.goalsFor,
    homeGoalsAgainst:homeRecent.goalsAgainst,awayGoalsAgainst:awayRecent.goalsAgainst
  }:null;
  let form=sofaForm;
  const shots=(sofaStats.totalShots||sofaStats.shotsOnTarget||sofaStats.bigChances||sofaStats.expectedGoals)?{
    homeShots:sofaStats.totalShots?.home??null,awayShots:sofaStats.totalShots?.away??null,
    homeOnTarget:sofaStats.shotsOnTarget?.home??null,awayOnTarget:sofaStats.shotsOnTarget?.away??null,
    homePossession:sofaStats.ballPossession?.home??null,awayPossession:sofaStats.ballPossession?.away??null,
    homeCorners:sofaStats.cornerKicks?.home??null,awayCorners:sofaStats.cornerKicks?.away??null,
    homeBigChances:sofaStats.bigChances?.home??null,awayBigChances:sofaStats.bigChances?.away??null,
    homeXg:sofaStats.expectedGoals?.home??null,awayXg:sofaStats.expectedGoals?.away??null,
    homePPDA:sofaStats.ppda?.home??null,awayPPDA:sofaStats.ppda?.away??null
  }:null;
  let goalApi={available:false,home:null,away:null,form:null,error:null};
  // Use GOAL API as a cached form fallback only when Sofascore's recent sample is missing or too small.
  if(!form||Number(form.homeMatches)<5||Number(form.awayMatches)<5){
    const result=await getGoalApiTeamForm(fixture.home,fixture.away,date);
    goalApi={...result,form:result.available?{
      homeMatches:result.home.matches,awayMatches:result.away.matches,
      homeWinRate:result.home.winRate,awayWinRate:result.away.winRate,
      homeOver15:result.home.over15Rate,awayOver15:result.away.over15Rate,
      homeOver25:result.home.over25Rate,awayOver25:result.away.over25Rate,
      homeBtts:result.home.bttsRate,awayBtts:result.away.bttsRate,
      homeGoalsFor:result.home.goalsFor,awayGoalsFor:result.away.goalsFor,
      homeGoalsAgainst:result.home.goalsAgainst,awayGoalsAgainst:result.away.goalsAgainst
    }:null};
    if(goalApi.form&&(!form||Number(form.homeMatches)<5||Number(form.awayMatches)<5))form=goalApi.form;
  }
  const available=[
    (sofaForm&&(Number(sofaForm.homeMatches)>0||Number(sofaForm.awayMatches)>0))||shots||lineups||injuries.home||injuries.away?"sofascore":null,
    uh&&ua?"understat":null,
    goalApi.available?"goalapi":null
  ].filter(Boolean);
  const derived=buildIndependentModels({form,uh,ua,shots});
  return{available,date,sofascore:{eventId:sofa.eventId||null,form:sofaForm,stats:shots,lineups,injuries},goalApi:{available:goalApi.available,form:goalApi.form,home:goalApi.home,away:goalApi.away,error:goalApi.error||null},understat:{home:uh,away:ua},models:derived};
}
function poissonPmf(lambda,k){if(!Number.isFinite(lambda)||lambda<0)return 0;let p=Math.exp(-lambda);for(let i=1;i<=k;i++)p*=lambda/i;return p}
function poissonOver(lambda,line){let s=0;const max=Math.max(12,Math.ceil(lambda+10));for(let k=0;k<=max;k++)if(k<=line)s+=poissonPmf(lambda,k);return clamp(1-s,0,1)}
function buildIndependentModels({form,uh,ua,shots}){
  const hasForm=Number(form?.homeMatches)>=5&&Number(form?.awayMatches)>=5&&Number.isFinite(Number(form?.homeGoalsFor))&&Number.isFinite(Number(form?.awayGoalsFor));
  const hasXg=[uh?.xg,ua?.xg,uh?.xga,ua?.xga].every(v=>v!==null&&v!==undefined&&Number.isFinite(Number(v)));
  if(!hasForm&&!hasXg)return{expectedGoals:null,probabilities:null,strengthSignals:{recentForm:null,xgEdge:null},modelAgreement:null,methodology:"No valid independent inputs; model probabilities withheld rather than synthesized."};
  const hx=Number(uh?.xg),ax=Number(ua?.xg),hxa=Number(uh?.xga),axa=Number(ua?.xga);
  const homeGoals=(Number.isFinite(hx)&&Number.isFinite(axa))?(hx+axa)/2:(Number.isFinite(form?.homeGoalsFor)?form.homeGoalsFor:null);
  const awayGoals=(Number.isFinite(ax)&&Number.isFinite(hxa))?(ax+hxa)/2:(Number.isFinite(form?.awayGoalsFor)?form.awayGoalsFor:null);
  const h=Math.max(0.05,Number(homeGoals)||0.05),a=Math.max(0.05,Number(awayGoals)||0.05),total=h+a;
  const over15=poissonOver(total,1),over25=poissonOver(total,2),btts=(1-Math.exp(-h))*(1-Math.exp(-a));
  const homeWin=(()=>{let p=0;for(let i=0;i<=10;i++)for(let j=0;j<i;j++)p+=poissonPmf(h,i)*poissonPmf(a,j);return p})();
  const awayWin=(()=>{let p=0;for(let i=0;i<=10;i++)for(let j=0;j<i;j++)p+=poissonPmf(a,i)*poissonPmf(h,j);return p})();
  const draw=Math.max(0,1-homeWin-awayWin);
  const formEdge=form?.homeWinRate!=null&&form?.awayWinRate!=null?form.homeWinRate-form.awayWinRate:null;
  const formStrength=formEdge==null?null:clamp(50+formEdge*50);
  const xgStrength=Number.isFinite(hx)&&Number.isFinite(ax)?clamp(50+(hx-ax)*18):null;
  const signals=[formStrength,xgStrength,homeWin*100].filter(Number.isFinite);
  return{expectedGoals:{home:Number(h.toFixed(2)),away:Number(a.toFixed(2)),total:Number(total.toFixed(2))},
    probabilities:{home:Number((homeWin*100).toFixed(1)),draw:Number((draw*100).toFixed(1)),away:Number((awayWin*100).toFixed(1)),over15:Number((over15*100).toFixed(1)),over25:Number((over25*100).toFixed(1)),btts:Number((btts*100).toFixed(1))},
    strengthSignals:{recentForm:formStrength,xgEdge:xgStrength},modelAgreement:signals.length?Math.round(100-(Math.max(...signals)-Math.min(...signals))):null,
    methodology:"Poisson goal model using independent xG/form inputs; derived probabilities are estimates, not guarantees."};
}
function clamp(n,min=0,max=100){return Math.max(min,Math.min(max,n))}
function independentConfidence(stats,type){
  const sf=stats?.sofascore?.form,gf=stats?.goalApi?.form;
  const sfN=Math.min(Number(sf?.homeMatches)||0,Number(sf?.awayMatches)||0),gfN=Math.min(Number(gf?.homeMatches)||0,Number(gf?.awayMatches)||0);
  const f=gfN>sfN?gf:sf,u=stats?.understat;
  const vals=[];
  if(f){
    if(type==="over1.5")vals.push((f.homeOver15+f.awayOver15)/2*100);
    if(type==="over2.5")vals.push((f.homeOver25+f.awayOver25)/2*100);
    if(type==="btts")vals.push((f.homeBtts+f.awayBtts)/2*100);
    if(type==="home")vals.push(f.homeWinRate*100);
    if(type==="away")vals.push(f.awayWinRate*100);
  }
  if(u?.home?.xg!=null&&u?.away?.xg!=null&&u?.home?.xga!=null&&u?.away?.xga!=null){
    const eh=Math.max(0,(u.home.xg+u.away.xga)/2);
    const ea=Math.max(0,(u.away.xg+u.home.xga)/2);
    const lambda=eh+ea;
    const poissonOver=(threshold)=>1-Math.exp(-lambda)*[1,1+lambda,1+lambda+(lambda*lambda/2)][threshold];
    if(type==="over1.5")vals.push(clamp(poissonOver(1)*100));
    if(type==="over2.5")vals.push(clamp(poissonOver(2)*100));
    if(type==="btts")vals.push(clamp((1-Math.exp(-eh))*(1-Math.exp(-ea))*100));
  }
  return vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):null;
}
export async function enrichPredictions(predictions,{concurrency=MAX_CONCURRENCY,sport="football",confidenceFloor=50}={}){
  const enriched=await mapLimit(predictions,concurrency,async p=>{
    const stats=await independentStatsForFixture(p,sport);
    const type=p.marketType==="ou"&&/^over\s*1\.5$/i.test(p.pick)?"over1.5":
      p.marketType==="ou"&&/^over\s*2\.5$/i.test(p.pick)?"over2.5":
      p.marketType==="btts"?"btts":/home/i.test(p.pick)?"home":/away/i.test(p.pick)?"away":null;
    const independent=independentConfidence(stats,type);
    const market=Number(p.confidence)||0;
    const modelHome=stats.models?.probabilities?.home;
    const modelSignal=type==="home"?modelHome:type==="away"?stats.models?.probabilities?.away:type==="btts"?stats.models?.probabilities?.btts:type==="over1.5"?stats.models?.probabilities?.over15:type==="over2.5"?stats.models?.probabilities?.over25:null;
    // Model and independentConfidence can come from the same form/xG sample. Do not count both twice.
    const confidence=modelSignal!==null&&modelSignal!==undefined&&Number.isFinite(modelSignal)
      ? (Number.isFinite(market)?Math.round(market*0.65+modelSignal*0.35):Math.round(modelSignal))
      : independent!==null&&independent!==undefined&&Number.isFinite(independent)
        ? (Number.isFinite(market)?Math.round(market*0.75+independent*0.25):Math.round(independent))
        : market;
    return{...p,confidence:clamp(confidence,confidenceFloor,99),marketConfidence:market,independentConfidence:independent,modelProbability:modelSignal??null,modelAgreement:stats.models?.modelAgreement??null,independentSources:stats.available,independentStats:stats};
  });
  return enriched;
}
export async function independentHealth(){
  const date=new Date().toISOString().slice(0,10);
  const out={sofascore:false,understat:false,goalApi:false,sportmonks:false,checkedAt:new Date().toISOString(),details:{}};
  const [sofa,under,goalApi]=await Promise.all([
    cachedJson("health:sofa",SOFASCORE_BASE+"/sport/football/scheduled-events/"+date),
    cachedJson("health:understat","https://understat.com/getLeagueData/EPL/"+seasonStart(date),{"X-Requested-With":"XMLHttpRequest","Referer":UNDERSTAT_BASE}),
    checkGoalApiStatsHealth()
  ]);
  out.sofascore=Array.isArray(sofa.data?.events);
  out.details.sofascore={available:out.sofascore,cached:Boolean(sofa.cached),stale:Boolean(sofa.stale),error:sofa.error||null,count:Array.isArray(sofa.data?.events)?sofa.data.events.length:0};
  out.understat=Boolean(under.data?.teams&&Object.keys(under.data.teams).length);
  out.details.understat={available:out.understat,cached:Boolean(under.cached),stale:Boolean(under.stale),error:under.error||null,teamCount:under.data?.teams?Object.keys(under.data.teams).length:0};
  out.goalApi=Boolean(goalApi.available);
  out.details.goalApi={...goalApi,role:"cached recent-form fallback when Sofascore samples are missing"};
  if(process.env.SPORTMONKS_API_TOKEN){
    if(!sportmonksHealthCache||Date.now()-sportmonksHealthCache.at>5*60*1000){
      try{const leagues=await getMyLeagues();sportmonksHealthCache={at:Date.now(),available:Boolean(leagues.configured&&Array.isArray(leagues.data)),count:Array.isArray(leagues.data)?leagues.data.length:0,error:leagues.error||null};}
      catch(error){sportmonksHealthCache={at:Date.now(),available:false,count:0,error:error?.message||"Sportmonks health check failed"};}
    }
    out.sportmonks=sportmonksHealthCache.available;
    out.details.sportmonks={...sportmonksHealthCache,configured:true,role:"fixtures/results source; not counted as an extra model probability"};
  }else out.details.sportmonks={available:false,configured:false,count:0,error:"SPORTMONKS_API_TOKEN is not configured"};
  return out;
}
