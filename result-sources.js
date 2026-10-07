import {getDateResults,norm} from "./sportmonks-results.js";

const SOFA="https://www.sofascore.com/api/v1";
const cache=new Map();
const TTL=15000;

function statusOf(e){
  const t=String(e?.status?.type||e?.status?.description||e?.status?.name||"").toLowerCase();
  if(/canceled|cancelled|postponed|abandoned/.test(t)) return "Postponed";
  if(/finished|ended|after|aet|penalty/.test(t)||Number(e?.status?.code)===100) return "Finished";
  if(/inprogress|live|period/.test(t)) return "Live";
  return "Pending";
}
function scoreOf(e){
  const h=Number(e?.homeScore?.normaltime??e?.homeScore?.current);
  const a=Number(e?.awayScore?.normaltime??e?.awayScore?.current);
  return {homeScore:Number.isFinite(h)?h:null,awayScore:Number.isFinite(a)?a:null};
}
function dayKey(ms){return new Date(ms).toLocaleDateString("en-CA",{timeZone:"Africa/Lagos"});}
async function sofaDate(date){
  const key="sofa:"+date,hit=cache.get(key);
  if(hit&&Date.now()-hit.at<TTL)return hit.data;
  const c=new AbortController(),t=setTimeout(()=>c.abort(),10000);
  try{
    const res=await fetch(SOFA+"/sport/football/scheduled-events/"+encodeURIComponent(date),{headers:{Accept:"application/json"},signal:c.signal});
    if(!res.ok)throw new Error("Sofascore HTTP "+res.status);
    const body=await res.json();
    const data=(body.events||[]).map(e=>{const s=scoreOf(e);return{providerId:String(e.id||""),date:dayKey(Number(e.startTimestamp||0)*1000),startingAt:e.startTimestamp,home:String(e.homeTeam?.name||""),away:String(e.awayTeam?.name||""),homeKey:norm(e.homeTeam?.name),awayKey:norm(e.awayTeam?.name),homeScore:s.homeScore,awayScore:s.awayScore,status:statusOf(e),state:String(e.status?.description||e.status?.type||"")};});
    cache.set(key,{at:Date.now(),data});return data;
  }finally{clearTimeout(t)}
}
function same(a,b){const x=norm(a),y=norm(b);return x===y||x.includes(y)||y.includes(x);}
function match(a,b){return same(a.home,b.home)&&same(a.away,b.away);}
function finished(x){return x?.status==="Finished"&&Number.isFinite(x.homeScore)&&Number.isFinite(x.awayScore);}
function combine(primary,secondary){
  const out=[];
  for(const x of primary||[])out.push({...x,sources:["Sportmonks"]});
  for(const x of secondary||[]){
    const hit=out.find(y=>match(y,x));
    if(!hit){out.push({...x,sources:["Sofascore"]});continue;}
    hit.sofascore={providerId:x.providerId,status:x.status,homeScore:x.homeScore,awayScore:x.awayScore};
    hit.sources=[...new Set([...(hit.sources||[]),"Sofascore"])];
    if(finished(hit)&&finished(x)){
      hit.verificationStatus=hit.homeScore===x.homeScore&&hit.awayScore===x.awayScore?"confirmed":"conflict";
    }else{
      hit.verificationStatus="unverified";
    }
    hit.verificationCount=hit.sources.length;
  }
  return out.map(x=>{
    if(!x.verificationStatus)x.verificationStatus=finished(x)&&x.sources?.length>1?"confirmed":"unverified";
    x.verificationCount=x.verificationCount||x.sources?.length||1;
    return x;
  });
}
export async function getVerifiedResults(date,force=false){
  const sm=await getDateResults(date,force);
  let sofa=[];
  try{sofa=await sofaDate(date)}catch{}
  return {date,results:combine(sm.configured?sm.data:[],sofa),sources:{sportmonks:Boolean(sm.configured),sofascore:true},updatedAt:Date.now(),cached:false};
}
export async function getVerifiedLiveResults(){return getVerifiedResults(dayKey(Date.now()),true);}
