import {getVerifiedResults} from "./result-sources.js";
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function risk(c){return c>=88?"Low":c>=78?"Medium":"High"}
function value(odds,confidence){const o=n(odds),c=n(confidence);if(!o||!c)return"Unknown";const implied=100/o;return c-implied>=15?"Strong":c-implied>=5?"Positive":c-implied>=0?"Fair":"Weak"}
export function decorateAdvanced(rows=[]){return rows.map(x=>{const c=n(x.confidence??x.modelProbability??x.independentConfidence)??0;return {...x,risk:risk(c),valueRating:value(x.odds,c),modelProbability:c}})}
export async function smartPickRank(rows=[]){return decorateAdvanced(rows).filter(x=>n(x.odds)>=1.10).sort((a,b)=>(n(b.confidence)||0)-(n(a.confidence)||0)+(n(b.independentConfidence)||0)-(n(a.independentConfidence)||0)).slice(0,20)}
export async function performanceFromArchives(readArchive,from,to){
  const dates=[];const d=new Date(from+"T12:00:00"),end=new Date(to+"T12:00:00");
  while(d<=end&&dates.length<62){dates.push(d.toISOString().slice(0,10));d.setDate(d.getDate()+1)}
  const rows=[];for(const date of dates){const a=await readArchive(date);for(const p of a?.predictions||[])rows.push({...p,date})}
  const settled=rows.filter(x=>["Won","Lost"].includes(x.outcome)),won=settled.filter(x=>x.outcome==="Won").length,lost=settled.filter(x=>x.outcome==="Lost").length;
  const byMarket={},byLeague={};
  for(const x of settled){
    const k=x.marketType||x.market||"Other";byMarket[k]??={total:0,won:0,lost:0};byMarket[k].total++;x.outcome==="Won"?byMarket[k].won++:byMarket[k].lost++;
    const l=x.league||"Other";byLeague[l]??={total:0,won:0,lost:0};byLeague[l].total++;x.outcome==="Won"?byLeague[l].won++:byLeague[l].lost++;
  }
  return{totalPredictions:rows.length,settled:settled.length,won,lost,accuracy:settled.length?Math.round(won/settled.length*100):null,byMarket,byLeague}
}
export function buildBetBuilder(rows=[],mode="conservative"){const threshold=mode==="conservative"?82:72;return rows.filter(x=>(n(x.confidence)||0)>=threshold&&n(x.odds)>=1.10).sort((a,b)=>(b.confidence||0)-(a.confidence||0)).slice(0,5)}
export function buildMatchReport(p={}){
  const c=n(p.confidence),ind=n(p.independentConfidence),od=n(p.odds),stats=p.independentStats||{},form=stats.sofascore?.form||{},u=stats.understat||{};
  const reasons=Array.isArray(p.reasons)?p.reasons:[];
  const strengths=[];
  if(ind!=null) strengths.push("Independent model signal "+Math.round(ind)+"%.");
  if(od!=null) strengths.push("Current market odds "+od.toFixed(2)+".");
  if(form.homeWinRate!=null&&form.awayWinRate!=null) strengths.push("Recent win rates: home "+Math.round(form.homeWinRate*100)+"%, away "+Math.round(form.awayWinRate*100)+"%.");
  if(u.home?.xg!=null&&u.away?.xg!=null) strengths.push("Recent xG averages: "+Number(u.home.xg).toFixed(2)+" home, "+Number(u.away.xg).toFixed(2)+" away.");
  const li=stats.sofascore?.lineups,inj=stats.sofascore?.injuries; if(li) strengths.push("SofaScore lineup data is available when teams publish confirmed lineups."); if(inj?.home||inj?.away) strengths.push("SofaScore injury availability data was checked for the fixture.");
  const cautions=[];if(!ind)cautions.push("Independent statistics were unavailable; confidence is market-model based.");if(p.verificationStatus&&p.verificationStatus!=="confirmed")cautions.push("This is a pre-match prediction and is not a verified result.");
  if(!li)cautions.push("Confirmed lineup information may not yet be published.");
  return{headline:(p.home||"Home")+" vs "+(p.away||"Away")+" — "+(p.pick||"Market prediction"),confidence:c,risk:p.risk||risk(c||0),value:p.valueRating||value(od,c),strengths,reasons,cautions,sourceCount:Array.isArray(p.independentSources)?p.independentSources.length:0}
}
export function oddsMovement(current={},previous={}){const a=n(current.odds),b=n(previous.odds);if(a==null||b==null)return{status:"Unavailable",change:null,percent:null};const change=Number((a-b).toFixed(3)),percent=b?Number((change/b*100).toFixed(1)):null;return{status:change>0?"Drift":change<0?"Shortening":"Stable",change,percent,previous:b,current:a}}
export function extractOddsSnapshot(rows=[]){return rows.map(x=>({id:x.id,eventId:x.eventId,home:x.home,away:x.away,market:x.market,marketId:x.marketId,specifier:x.specifier,outcomeId:x.outcomeId,pick:x.pick,odds:n(x.odds),capturedAt:new Date().toISOString()})).filter(x=>x.odds!=null)}
