import {getDateResults,norm} from "./sportmonks-results.js";
import {getGoalApiDateResults} from "./goal-api-results.js";

const SOFA="https://www.sofascore.com/api/v1";
const cache=new Map();
const TTL=15000;

function statusOf(e){
  const t=String(e?.status?.type||e?.status?.description||e?.status?.name||"").toLowerCase();
  if(/postpon/.test(t)) return "Postponed";
  if(/canceled|cancelled|abandoned|void/.test(t)) return "Void";
  if(/finished|ended|after|aet|penalty/.test(t)||Number(e?.status?.code)===100) return "Finished";
  if(/inprogress|live|period/.test(t)) return "Live";
  return "Pending";
}
function scoreOf(e){
  const rawH=e?.homeScore?.normaltime??e?.homeScore?.current;
  const rawA=e?.awayScore?.normaltime??e?.awayScore?.current;
  const h=rawH===null||rawH===undefined||rawH===""?NaN:Number(rawH);
  const a=rawA===null||rawA===undefined||rawA===""?NaN:Number(rawA);
  return {homeScore:Number.isFinite(h)?h:null,awayScore:Number.isFinite(a)?a:null};
}
function dayKey(ms){const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Lagos",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(ms));const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;}
async function sofaDate(date,sport="football"){
  const key="sofa:"+sport+":"+date,hit=cache.get(key);
  if(hit&&Date.now()-hit.at<TTL)return hit.data;
  const c=new AbortController(),t=setTimeout(()=>c.abort(),10000);
  try{
    const res=await fetch(SOFA+"/sport/"+encodeURIComponent(sport)+"/scheduled-events/"+encodeURIComponent(date),{headers:{Accept:"application/json","User-Agent":"Mozilla/5.0 (compatible; OmegaplusProAI/1.0)","Referer":"https://www.sofascore.com/"},signal:c.signal});
    if(!res.ok)throw new Error("Sofascore HTTP "+res.status);
    const body=await res.json();
    const data=(body.events||[]).map(e=>{const s=scoreOf(e);return{providerId:String(e.id||""),date:dayKey(Number(e.startTimestamp||0)*1000),startingAt:e.startTimestamp,home:String(e.homeTeam?.name||""),away:String(e.awayTeam?.name||""),homeKey:norm(e.homeTeam?.name),awayKey:norm(e.awayTeam?.name),homeScore:s.homeScore,awayScore:s.awayScore,status:statusOf(e),state:String(e.status?.description||e.status?.type||"")};});
    cache.set(key,{at:Date.now(),data});return data;
  }finally{clearTimeout(t)}
}
function same(a,b){const x=norm(a),y=norm(b);return Boolean(x&&y)&&(x===y||x.includes(y)||y.includes(x));}
function match(a,b){if(!same(a.home,b.home)||!same(a.away,b.away))return false;const da=String(a.date||""),db=String(b.date||"");const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v);if(validDate(da)&&validDate(db)&&da!==db)return false;const ta=Number(a.startingAt||0),tb=Number(b.startingAt||0);if(ta>0&&tb>0&&Math.abs(ta-tb)>6*60*60)return false;return true;}
function finished(x){return x?.status==="Finished"&&Number.isFinite(x.homeScore)&&Number.isFinite(x.awayScore);}
function combine(primary,secondary){
  const out=[];
  for(const x of primary||[])out.push({...x,sources:Array.isArray(x.sources)&&x.sources.length?x.sources:["Sportmonks"]});
  for(const x of secondary||[]){
    const incomingSources=Array.isArray(x.sources)&&x.sources.length?x.sources:["Sofascore"];
    const hit=out.find(y=>match(y,x));
    if(!hit){out.push({...x,sources:incomingSources});continue;}
    hit.sources=[...new Set([...(hit.sources||[]),...incomingSources])];
    if(finished(hit)&&finished(x)){
      // Any disagreement from a second provider blocks automatic settlement.
      hit.verificationStatus=hit.verificationStatus==="conflict"?"conflict":
        (hit.homeScore===x.homeScore&&hit.awayScore===x.awayScore?"confirmed":"conflict");
    }else if(!finished(hit)&&finished(x)){
      Object.assign(hit,{homeScore:x.homeScore,awayScore:x.awayScore,status:x.status,state:x.state,providerId:hit.providerId||x.providerId,startingAt:hit.startingAt||x.startingAt,date:hit.date||x.date});
      if(hit.verificationStatus!=="conflict")hit.verificationStatus="unverified";
    }else if(!hit.verificationStatus){
      hit.verificationStatus="unverified";
    }
    hit.verificationCount=new Set(hit.sources).size;
  }
  return out.map(x=>{
    if(!x.verificationStatus)x.verificationStatus=finished(x)?"single-source":"unverified";
    x.verificationCount=x.verificationCount||x.sources?.length||1;
    return x;
  });
}
async function fotmobDate(date){
  const key="fotmob:football:"+date,hit=cache.get(key);
  if(hit&&Date.now()-hit.at<TTL)return hit.data;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
    const res=await fetch("https://www.fotmob.com/api/data/matches?date="+encodeURIComponent(date.replace(/-/g,"")),{headers:{Accept:"application/json","User-Agent":"Mozilla/5.0","Referer":"https://www.fotmob.com/"},signal:controller.signal});
    if(!res.ok)throw new Error("FotMob HTTP "+res.status);
    const body=await res.json(),data=[];
    for(const league of body.leagues||[])for(const m of league.matches||[]){
      const home=String(m.home?.name||""),away=String(m.away?.name||"");
      if(!home||!away)continue;
      const st=m.status||{},reason=String(st.reason?.long||st.reason?.short||"").toLowerCase();
      let status=st.cancelled?( /postpon/.test(reason)?"Postponed":"Void"):st.finished?"Finished":st.started?"Live":"Pending";
      if(/postpon/.test(reason))status="Postponed";else if(/cancel|void|abandon/.test(reason))status="Void";
      const rawHome=m.home?.score,rawAway=m.away?.score;
      let hs=rawHome==null||rawHome===""?NaN:Number(rawHome),as=rawAway==null||rawAway===""?NaN:Number(rawAway);
      if(!Number.isFinite(hs)||!Number.isFinite(as)){
        const score=String(st.scoreStr||"").match(/(\d+)\s*[-–:]\s*(\d+)/);
        if(score){hs=Number(score[1]);as=Number(score[2]);}
      }
      const time=Date.parse(st.utcTime||"");
      data.push({providerId:String(m.id||"fotmob:"+home+":"+away),date:Number.isFinite(time)?dayKey(time):date,startingAt:Number.isFinite(time)?Math.floor(time/1000):null,home,away,homeKey:norm(home),awayKey:norm(away),homeScore:Number.isFinite(hs)?hs:null,awayScore:Number.isFinite(as)?as:null,status,state:reason||status,sources:["FotMob"]});
    }
    cache.set(key,{at:Date.now(),data});return data;
  }finally{clearTimeout(timer)}
}
export async function getVerifiedResults(date,force=false,sport="football"){
  if(sport!=="football"){
    const sofa=await sofaDate(date,sport);
    const results=sofa.map(x=>({...x,verificationStatus:x.status==="Finished"?"single-source":"unverified",verificationCount:1,sources:["Sofascore"]}));
    return {date,results,sources:{sportmonks:false,sofascore:true,fotmob:false},updatedAt:Date.now(),cached:false};
  }
  let sm={configured:Boolean(process.env.SPORTMONKS_API_TOKEN),data:[],error:null};
  let sofa=[],fotmob=[],goal=[],errors={};
  try{sm=await getDateResults(date,force)}catch(e){sm={configured:Boolean(process.env.SPORTMONKS_API_TOKEN),data:[],error:e.message};errors.sportmonks=e.message}
  try{sofa=await sofaDate(date,"football")}catch(e){errors.sofascore=e.message}
  try{fotmob=await fotmobDate(date)}catch(e){errors.fotmob=e.message}
  let goalProvider={configured:Boolean(process.env.GOAL_API_KEY),data:[],error:null};
  try{goalProvider=await getGoalApiDateResults(date,force);goal=goalProvider.data||[]}catch(e){goalProvider={configured:Boolean(process.env.GOAL_API_KEY),data:[],error:e.message};errors.goalApi=e.message}
  const combined=combine(sm.configured?sm.data:[],sofa.map(x=>({...x,sources:["Sofascore"]})));
  const withFotmob=combine(combined,fotmob);
  const results=combine(withFotmob,goal);
  const providerDiagnostics={
    sportmonks:{configured:Boolean(sm.configured),count:Array.isArray(sm.data)?sm.data.length:0,error:sm.error||errors.sportmonks||null},
    sofascore:{configured:!errors.sofascore,count:sofa.length,error:errors.sofascore||null},
    fotmob:{configured:!errors.fotmob,count:fotmob.length,error:errors.fotmob||null},
    goalApi:{configured:Boolean(goalProvider.configured),count:goal.length,error:goalProvider.error||errors.goalApi||null},
    verificationPolicy:"Two independent providers must agree on a finished score; any disagreement blocks settlement."
  };
  return {date,results,sources:{sportmonks:Boolean(sm.configured),sofascore:!errors.sofascore,fotmob:!errors.fotmob,goalApi:Boolean(goalProvider.configured)},providerDiagnostics,updatedAt:Date.now(),cached:false};
}
export async function getVerifiedLiveResults(sport="football"){return getVerifiedResults(dayKey(Date.now()),true,sport);}
