const ESPN_BASE="https://site.api.espn.com/apis/site/v2/sports/soccer";
const TIMEOUT=8000;
const cache=new Map();

function key(v){return String(v||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
function poisson(k,lambda){return Math.exp(-lambda)*Math.pow(lambda,k)/factorial(k)}
function factorial(n){let x=1;for(let i=2;i<=n;i++)x*=i;return x}
function clamp(n,a=0,b=1){return Math.max(a,Math.min(b,n))}
async function fetchJson(url){
  const hit=cache.get(url);
  if(hit&&Date.now()-hit.at<3*60*60*1000)return hit.data;
  const c=new AbortController(),t=setTimeout(()=>c.abort(),TIMEOUT);
  try{const r=await fetch(url,{headers:{Accept:"application/json","User-Agent":"Omegaplus-Pro-AI/1.0"},signal:c.signal});if(!r.ok)throw new Error("HTTP "+r.status);const d=await r.json();cache.set(url,{at:Date.now(),data:d});return d}catch{return null}finally{clearTimeout(t)}
}
function matchTeam(a,b){const x=key(a),y=key(b);return Boolean(x&&y)&&(x===y||x.includes(y)||y.includes(x))}
function scoreFromEvent(e){return{home:Number(e?.homeScore?.displayValue??e?.homeScore?.value),away:Number(e?.awayScore?.displayValue??e?.awayScore?.value)}}
function extractStats(events,teamId){
  const finished=(events||[]).filter(e=>e.competitions?.[0]?.status?.type?.completed).slice(-10);
  let gf=0,ga=0,n=0;
  for(const e of finished){
    const c=e.competitions?.[0], comps=c?.competitors||[],me=comps.find(x=>String(x.id)===String(teamId)),opp=comps.find(x=>String(x.id)!==String(teamId));
    if(!me||!opp)continue;
    const f=Number(me.score),a=Number(opp.score);
    if(Number.isFinite(f)&&Number.isFinite(a)){gf+=f;ga+=a;n++}
  }
  return n?{matches:n,gf:n?gf/n:null,ga:n?ga/n:null}:null;
}
async function espnRecent(teamId,leagueSlug){return fetchJson(ESPN_BASE+"/"+leagueSlug+"/teams/"+teamId+"/schedule?limit=20")}
async function espnTeam(fixture,leagueSlug){
  const data=await fetchJson(ESPN_BASE+"/"+leagueSlug+"/scoreboard?limit=100&dates="+new Date(fixture.startTimeMs).toISOString().slice(0,10).replace(/-/g,""));
  const event=(data?.events||[]).find(e=>{const c=e.competitions?.[0];const comps=c?.competitors||[];return comps.some(x=>matchTeam(x.team?.displayName,fixture.home))&&comps.some(x=>matchTeam(x.team?.displayName,fixture.away))});
  if(!event)return null;
  const comps=event.competitions?.[0]?.competitors||[];
  const home=comps.find(x=>x.homeAway==="home"),away=comps.find(x=>x.homeAway==="away");
  if(!home||!away)return null;
  const [hr,ar]=await Promise.all([espnRecent(home.team.id,leagueSlug),espnRecent(away.team.id,leagueSlug)]);
  return{source:"ESPN",eventId:event.id,home:{id:home.team.id,stats:extractStats(hr?.events,home.team.id)},away:{id:away.team.id,stats:extractStats(ar?.events,away.team.id)}};
}
function leagueSlug(league){
  const n=key(league);
  if(n.includes("premier league"))return"eng.1";
  if(n.includes("laliga")||n==="la liga")return"esp.1";
  if(n.includes("serie a"))return"ita.1";
  if(n.includes("bundesliga"))return"ger.1";
  if(n.includes("ligue 1"))return"fra.1";
  if(n.includes("mls"))return"usa.1";
  return null;
}
function marketExpectedGoals(fixture){
  const one=fixture.markets?.find(m=>m.marketId==="1"||key(m.marketName).includes("1x2")||key(m.marketName).includes("match result"));
  const vals=one?.outcomes?.filter(o=>o.isActive&&Number(o.odds)>1).map(o=>({name:key(o.outcomeName),p:1/Number(o.odds)}))||[];
  const sum=vals.reduce((s,x)=>s+x.p,0);
  let hp=.45,ap=.35;
  if(sum){
    const home=vals.find(x=>x.name.includes("home")),away=vals.find(x=>x.name.includes("away"));
    if(home&&away){hp=home.p/sum;ap=away.p/sum;}
  }
  const ou=fixture.markets?.find(m=>{
    const n=key(m.marketName);
    return ["18","900300","900301"].includes(String(m.marketId))||n.includes("over under")||n.includes("total goals")||n.includes("goals total");
  });
  let total=2.55;
  if(ou){
    const parsed=(ou.outcomes||[]).filter(o=>o.isActive&&Number(o.odds)>1).map(o=>{
      const name=key(o.outcomeName),line=String(ou.specifier||"").match(/([0-9]+(?:\.[0-9]+)?)/)?.[1]||name.match(/([0-9]+(?:\.[0-9]+)?)/)?.[1];
      return line?{name,line:Number(line),p:1/Number(o.odds)}:null;
    }).filter(Boolean);
    const line25=parsed.filter(x=>Math.abs(x.line-2.5)<0.01);
    const over=line25.find(x=>x.name.includes("over")),under=line25.find(x=>x.name.includes("under"));
    if(over&&under){
      const s=over.p+under.p,po=over.p/s;
      total=Math.max(1.75,Math.min(3.8,2.5+(po-.5)*2.2));
    }
  }
  const share=(hp+ap)>0?hp/(hp+ap):.56;
  return{home:Math.max(.65,total*share),away:Math.max(.55,total*(1-share))};
}
function scoreMatrix(lh,la){
  // Include a wider score range so high-scoring fixtures are not distorted by truncation.
  const rows=[];
  for(let h=0;h<=8;h++)for(let a=0;a<=8;a++){
    let p=poisson(h,lh)*poisson(a,la);
    // Small low-score correction for the common dependence between 0-0, 1-0, 0-1 and 1-1.
    const rho=-0.06;
    if(h===0&&a===0)p*=1-lh*la*rho;
    else if(h===0&&a===1)p*=1+lh*rho;
    else if(h===1&&a===0)p*=1+la*rho;
    else if(h===1&&a===1)p*=1-rho;
    rows.push({h,a,p:Math.max(0,p)});
  }
  const total=rows.reduce((s,x)=>s+x.p,0);
  return rows.map(x=>({...x,p:total?x.p/total:0})).sort((a,b)=>b.p-a.p);
}
export async function analyzeCorrectScores(fixture,independentStats={}){
  const form=independentStats?.sofascore?.form;
  const uh=Number(independentStats?.understat?.home?.xg),ua=Number(independentStats?.understat?.away?.xg);
  const uha=Number(independentStats?.understat?.home?.xga),uaa=Number(independentStats?.understat?.away?.xga);
  const market=marketExpectedGoals(fixture);
  let homeGoals=market?.home||1.25,awayGoals=market?.away||1.05;
  const formH=Number(form?.homeGoalsFor),formA=Number(form?.awayGoalsFor),conH=Number(form?.homeGoalsAgainst),conA=Number(form?.awayGoalsAgainst);
  if(Number.isFinite(formH)&&Number.isFinite(formA)&&Number.isFinite(conH)&&Number.isFinite(conA)){homeGoals=(homeGoals+.35*formH+.25*conA)/1.6;awayGoals=(awayGoals+.35*formA+.25*conH)/1.6}
  if(Number.isFinite(uh)&&Number.isFinite(uaa))homeGoals=(homeGoals+.65*((uh+uaa)/2))/1.65;
  if(Number.isFinite(ua)&&Number.isFinite(uha))awayGoals=(awayGoals+.65*((ua+uha)/2))/1.65;
  const slug=leagueSlug(fixture.league);
  const espn=slug?await espnTeam(fixture,slug):null;
  if(espn?.home?.stats?.gf!=null&&espn?.away?.stats?.ga!=null)homeGoals=(homeGoals+.5*((espn.home.stats.gf+espn.away.stats.ga)/2))/1.5;
  if(espn?.away?.stats?.gf!=null&&espn?.home?.stats?.ga!=null)awayGoals=(awayGoals+.5*((espn.away.stats.gf+espn.home.stats.ga)/2))/1.5;
  homeGoals=clamp(homeGoals/3,0.25,2.8)*3;awayGoals=clamp(awayGoals/3,0.2,2.6)*3;
  const matrix=scoreMatrix(homeGoals,awayGoals).slice(0,5);
  const sources=[];
  if(form&&[form.homeGoalsFor,form.awayGoalsFor,form.homeGoalsAgainst,form.awayGoalsAgainst].every(v=>Number.isFinite(Number(v)))) sources.push("Sofascore recent form");
  if((Number.isFinite(uh)&&Number.isFinite(uaa))||(Number.isFinite(ua)&&Number.isFinite(uha))) sources.push("Understat xG/xGA");
  if(espn) sources.push("ESPN recent results");
  if(market) sources.push("Live market probability");
  return{expectedGoals:{home:Number(homeGoals.toFixed(2)),away:Number(awayGoals.toFixed(2))},scores:matrix.map(x=>({score:x.h+"-"+x.a,probability:Number((x.p*100).toFixed(1))})),sources};
}