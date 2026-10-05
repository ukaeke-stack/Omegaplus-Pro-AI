// Sportmonks result provider: authenticated server-side only.
const BASE="https://api.sportmonks.com/v3/football";
const TOKEN=process.env.SPORTMONKS_API_TOKEN||"";
const cache=new Map();
const ttl=Number(process.env.SPORTMONKS_CACHE_MS||15000);

function keyFor(date){return "date:"+date}
function norm(v){return String(v||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim()}
function dayOf(ms){return new Date(ms).toLocaleDateString("en-CA",{timeZone:"Africa/Lagos"})}
function participantsOf(f){
  const p=Array.isArray(f.participants)?f.participants:[];
  const home=p.find(x=>x.meta?.location==="home")||p[0];
  const away=p.find(x=>x.meta?.location==="away")||p[1];
  return {home:String(home?.name||""),away:String(away?.name||"")};
}
function scoreOf(f){
  let home=null,away=null;
  const p=Array.isArray(f.participants)?f.participants:[];
  const homeId=p.find(x=>x.meta?.location==="home")?.id;
  const awayId=p.find(x=>x.meta?.location==="away")?.id;
  for(const s of Array.isArray(f.scores)?f.scores:[]){
    const g=Number(s.score?.goals ?? s.goals);
    if(!Number.isFinite(g)) continue;
    if(String(s.participant_id)===String(homeId)||String(s.description||"").toUpperCase().includes("HOME")) home=g;
    if(String(s.participant_id)===String(awayId)||String(s.description||"").toUpperCase().includes("AWAY")) away=g;
    if(String(s.description||"").toUpperCase()==="CURRENT"){
      if(home===null&&away===null&&p.length>=2){
        if(String(s.participant_id)===String(homeId)) home=g;
        if(String(s.participant_id)===String(awayId)) away=g;
      }
    }
  }
  return {homeScore:home,awayScore:away};
}
function statusOf(f){
  const raw=String(f.state?.name||f.state?.short_name||f.result_info||"").toLowerCase();
  if(/postpon|cancel|abandon|void/.test(raw)) return raw.includes("postpon")?"Postponed":"Void";
  if(/finished|full time|after.*time|ft\b|ended|complete/.test(raw)) return "Finished";
  if(/half|inplay|live|progress|1st|2nd|extra|penalty/.test(raw)) return "Live";
  return "Pending";
}
async function fetchJson(url){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
    const res=await fetch(url,{headers:{Accept:"application/json"},signal:controller.signal});
    const text=await res.text(); let body=null; try{body=text?JSON.parse(text):null}catch{}
    if(!res.ok) throw new Error(body?.message||("Sportmonks HTTP "+res.status));
    return body||{};
  }finally{clearTimeout(timer)}
}
async function getDateResults(date,force=false){
  if(!TOKEN) return {configured:false,data:[],error:"SPORTMONKS_API_TOKEN is not configured."};
  const k=keyFor(date),hit=cache.get(k);
  if(!force&&hit&&Date.now()-hit.at<ttl)return {configured:true,data:hit.data,cached:true,updatedAt:hit.at};
  const url=BASE+"/fixtures/date/"+encodeURIComponent(date)+"?api_token="+encodeURIComponent(TOKEN)+"&include=participants;scores;state;events";
  const body=await fetchJson(url);
  const data=(body.data||[]).map(f=>{
    const p=participantsOf(f),s=scoreOf(f);
    return {providerId:String(f.id||""),date:dayOf(Number(f.starting_at)*1000),startingAt:f.starting_at,home:p.home,away:p.away,homeKey:norm(p.home),awayKey:norm(p.away),homeScore:s.homeScore,awayScore:s.awayScore,status:statusOf(f),state:String(f.state?.name||""),resultInfo:String(f.result_info||"")};
  });
  cache.set(k,{at:Date.now(),data});
  return {configured:true,data,cached:false,updatedAt:Date.now()};
}
async function getLatestResults(){
  if(!TOKEN)return {configured:false,data:[],error:"SPORTMONKS_API_TOKEN is not configured."};
  const body=await fetchJson(BASE+"/livescores/latest?api_token="+encodeURIComponent(TOKEN)+"&include=participants;scores;state;events");
  const data=(body.data||[]).map(f=>{
    const p=participantsOf(f),s=scoreOf(f);
    return {providerId:String(f.id||""),date:dayOf(Number(f.starting_at)*1000),startingAt:f.starting_at,home:p.home,away:p.away,homeKey:norm(p.home),awayKey:norm(p.away),homeScore:s.homeScore,awayScore:s.awayScore,status:statusOf(f),state:String(f.state?.name||""),resultInfo:String(f.result_info||"")};
  });
  return {configured:true,data,cached:false,updatedAt:Date.now()};
}
export {getDateResults,getLatestResults,norm};
