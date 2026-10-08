const SOFASCORE_BASE="https://api.sofascore.com/api/v1";
const UNDERSTAT_BASE="https://understat.com/";
const FETCH_TIMEOUT=7000;
const CACHE_TTL=6*60*60*1000;
const MAX_CONCURRENCY=4;
const cache=new Map();

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
  const finished=events.filter(e=>e.status?.type==="finished"||e.status?.code===100).slice(-10);
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
async function independentStatsForFixture(fixture){
  const date=new Date(fixture.startTimeMs).toLocaleDateString("en-CA",{timeZone:"Africa/Lagos"});
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
  const form=homeRecent&&awayRecent?{
    homeWinRate:homeRecent.winRate,awayWinRate:awayRecent.winRate,
    homeOver15:homeRecent.over15Rate,awayOver15:awayRecent.over15Rate,
    homeOver25:homeRecent.over25Rate,awayOver25:awayRecent.over25Rate,
    homeBtts:homeRecent.bttsRate,awayBtts:awayRecent.bttsRate,
    homeGoalsFor:homeRecent.goalsFor,awayGoalsFor:awayRecent.goalsFor,
    homeGoalsAgainst:homeRecent.goalsAgainst,awayGoalsAgainst:awayRecent.goalsAgainst
  }:null;
  const shots=(sofaStats.totalShots||sofaStats.shotsOnTarget||sofaStats.bigChances)?{
    homeShots:sofaStats.totalShots?.home??null,awayShots:sofaStats.totalShots?.away??null,
    homeOnTarget:sofaStats.shotsOnTarget?.home??null,awayOnTarget:sofaStats.shotsOnTarget?.away??null,
    homePossession:sofaStats.ballPossession?.home??null,awayPossession:sofaStats.ballPossession?.away??null,
    homeCorners:sofaStats.cornerKicks?.home??null,awayCorners:sofaStats.cornerKicks?.away??null
  }:null;
  const available=[sofa.found?"sofascore":null,ud?"understat":null].filter(Boolean);
  return{available,date,sofascore:{eventId:sofa.eventId||null,form,stats:shots,lineups,injuries},understat:{home:uh,away:ua}};
}
function clamp(n,min=0,max=100){return Math.max(min,Math.min(max,n))}
function independentConfidence(stats,type){
  const f=stats?.sofascore?.form,u=stats?.understat;
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
export async function enrichPredictions(predictions,{concurrency=MAX_CONCURRENCY}={}){
  const enriched=await mapLimit(predictions,concurrency,async p=>{
    const stats=await independentStatsForFixture(p);
    const type=p.marketType==="ou"&&/^over\s*1\.5$/i.test(p.pick)?"over1.5":
      p.marketType==="ou"&&/^over\s*2\.5$/i.test(p.pick)?"over2.5":
      p.marketType==="btts"?"btts":/home/i.test(p.pick)?"home":/away/i.test(p.pick)?"away":null;
    const independent=independentConfidence(stats,type);
    const market=Number(p.confidence)||0;
    const confidence=independent==null?market:Math.round(market*0.25+independent*0.75);
    return{...p,confidence:clamp(confidence,50,99),marketConfidence:market,independentConfidence:independent,independentSources:stats.available,independentStats:stats};
  });
  return enriched;
}
export async function independentHealth(){
  const out={sofascore:false,understat:false};
  try{await cachedJson("health:sofa",SOFASCORE_BASE+"/sport/football/scheduled-events/"+new Date().toISOString().slice(0,10));out.sofascore=true}catch{}
  try{await cachedJson("health:understat","https://understat.com/getLeagueData/EPL/"+seasonStart(new Date().toISOString().slice(0,10)),{"X-Requested-With":"XMLHttpRequest","Referer":UNDERSTAT_BASE});out.understat=true}catch{}
  return out;
}
