import {getDateResults,norm} from "./sportmonks-results.js";

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
  const h=Number(e?.homeScore?.normaltime??e?.homeScore?.current);
  const a=Number(e?.awayScore?.normaltime??e?.awayScore?.current);
  return {homeScore:Number.isFinite(h)?h:null,awayScore:Number.isFinite(a)?a:null};
}
function dayKey(ms){return new Date(ms).toLocaleDateString("en-CA",{timeZone:"Africa/Lagos"});}
async function sofaDate(date,sport="football"){
  const key="sofa:"+sport+":"+date,hit=cache.get(key);
  if(hit&&Date.now()-hit.at<TTL)return hit.data;
  const c=new AbortController(),t=setTimeout(()=>c.abort(),10000);
  try{
    const res=await fetch(SOFA+"/sport/"+encodeURIComponent(sport)+"/scheduled-events/"+encodeURIComponent(date),{headers:{Accept:"application/json"},signal:c.signal});
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
  for(const x of primary||[])out.push({...x,sources:Array.isArray(x.sources)&&x.sources.length?x.sources:["Sportmonks"]});
  for(const x of secondary||[]){
    const incomingSources=Array.isArray(x.sources)&&x.sources.length?x.sources:["Sofascore"];
    const hit=out.find(y=>match(y,x));
    if(!hit){out.push({...x,sources:incomingSources});continue;}
    hit.sources=[...new Set([...(hit.sources||[]),...incomingSources])];
    if(finished(hit)&&finished(x)){
      hit.verificationStatus=hit.homeScore===x.homeScore&&hit.awayScore===x.awayScore?"confirmed":"conflict";
    }else if(!hit.verificationStatus){
      hit.verificationStatus="unverified";
    }
    hit.verificationCount=hit.sources.length;
  }
  return out.map(x=>{
    if(!x.verificationStatus)x.verificationStatus=finished(x)?(x.sources?.length>1?"confirmed":"single-source"):"unverified";
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
      let hs=Number(m.home?.score),as=Number(m.away?.score);
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
  const sm=await getDateResults(date,force);
  let sofa=[],fotmob=[];
  try{sofa=await sofaDate(date,"football")}catch{}
  try{fotmob=await fotmobDate(date)}catch{}
  const combined=combine(sm.configured?sm.data:[],sofa.map(x=>({...x,sources:["Sofascore"]})));
  const results=combine(combined,fotmob);
  return {date,results,sources:{sportmonks:Boolean(sm.configured),sofascore:true,fotmob:true},updatedAt:Date.now(),cached:false};
}
export async function getVerifiedLiveResults(sport="football"){return getVerifiedResults(dayKey(Date.now()),true,sport);}
