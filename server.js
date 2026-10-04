import express from "express";
import path from "node:path";
import fs from "node:fs";
import {fileURLToPath} from "node:url";

const app=express();
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const PORT=process.env.PORT||8080;
const BASE=process.env.SPORTYBET_API_BASE_URL||"https://www.sportybet.com";
const REGION=process.env.SPORTYBET_REGION||"ng";
const COUNTRY=REGION.toUpperCase();
const MARKETS=["1","14","16","18","29","139","138","162","165","166","900304","900305","900312"];
const cache={at:0,fixtures:[]};
let requestPromise=null,lastRequest=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"public")));

async function sporty(pathname,options={}){
  const wait=Math.max(0,250-(Date.now()-lastRequest)); if(wait) await sleep(wait);
  lastRequest=Date.now();
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),15000);
  try{
    const res=await fetch(BASE+"/api/"+REGION+pathname,{...options,signal:c.signal,headers:{Accept:"application/json","Content-Type":"application/json","Current-Country":COUNTRY,...(options.headers||{})}});
    const txt=await res.text(); let body; try{body=JSON.parse(txt)}catch{throw new Error("Invalid SportyBet response")};
    if(!res.ok) throw new Error("SportyBet HTTP "+res.status);
    if(Number(body.bizCode||10000)!==10000) throw new Error(body.message||"SportyBet rejected request");
    return body;
  }finally{clearTimeout(timer)}
}
const dayKey=ms=>{let n=Number(ms);if(n<1e11)n*=1000;return new Date(n+3600000).toISOString().slice(0,10)};
const msValue=v=>{let n=Number(v);if(n<1e11)n*=1000;return n};
const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9.]+/g," ").trim();

async function getFixtures(){
  if(Date.now()-cache.at<60000&&cache.fixtures.length)return cache.fixtures;
  if(requestPromise)return requestPromise;
  requestPromise=(async()=>{
    const allById=new Map();
    const keys=[MARKETS.join(","),"18","1"];
    for(const key of keys){
      let addedThisQuery=0;
      for(let page=1;page<=12;page++){
        const q=new URLSearchParams({sportId:"sr:sport:1",marketId:key,pageSize:"100",pageNum:String(page),todayGames:"false",timeline:"720",_t:String(Date.now())});
        const body=await sporty("/factsCenter/pcUpcomingEvents?"+q);
        const ts=body.data?.tournaments||[]; let count=0;
        for(const t of ts) for(const e of t.events||[]){
          count++; addedThisQuery++;
          const id=String(e.eventId||""); if(!id) continue;
          const incoming={eventId:id,league:String(t.name||""),category:String(t.categoryName||""),home:String(e.homeTeamName||""),away:String(e.awayTeamName||""),startTimeMs:msValue(e.estimateStartTime),markets:(e.markets||[]).map(m=>({marketId:String(m.id||""),marketName:String(m.desc||m.name||m.title||m.id||""),specifier:m.specifier??null,outcomes:(m.outcomes||[]).map(o=>({outcomeId:String(o.id||""),outcomeName:String(o.desc||""),odds:Number(o.odds),isActive:o.isActive===undefined?true:Boolean(Number(o.isActive))}))}))};
          const existing=allById.get(id);
          if(!existing) allById.set(id,incoming);
          else {
            const seen=new Set(existing.markets.map(m=>m.marketId+"|"+String(m.specifier??"")));
            for(const m of incoming.markets){const k=m.marketId+"|"+String(m.specifier??"");if(!seen.has(k)){existing.markets.push(m);seen.add(k);}}
          }
        }
        if(count<100 || (Number(body.data?.totalNum||0)&&page*100>=Number(body.data.totalNum)))break;
      }
      if(addedThisQuery>0 && allById.size>0) break;
    }
    const all=[...allById.values()];
    cache.at=Date.now();cache.fixtures=all;return all;
  })().finally(()=>{requestPromise=null});
  return requestPromise;
}
function marketType(m){
  if(m.marketId==="18")return"ou"; if(m.marketId==="1")return"1x2"; if(m.marketId==="29")return"btts";
  if(["14","16"].includes(m.marketId))return"handicap";
  if(["162","165","166"].includes(m.marketId)||norm(m.marketName).includes("corner"))return"corners";
  if(["139","138","900304","900305","900312"].includes(m.marketId)||/card|booking/i.test(m.marketName))return"cards";
  return null;
}
function confidence(m,o){
  const active=m.outcomes.filter(x=>x.isActive&&x.odds>1&&Number.isFinite(x.odds));
  if(!active.length||!(o.odds>1))return 0;
  const p=1/o.odds,sum=active.reduce((a,x)=>a+1/x.odds,0);
  return Math.round(Math.max(50,Math.min(97,p/sum*100)));
}
const band=p=>p>=85?"Very High":p>=75?"High":p>=65?"Strong":p>=55?"Moderate":"Long-shot";
function matchesOption(name,selected){
  if(!selected.length)return true;
  const a=norm(name); return selected.some(x=>{const b=norm(x);return a===b||a.includes(b)||b.includes(a)});
}
function leaguesFor(fixtures,dates){return [...new Set(fixtures.filter(f=>dates.includes(dayKey(f.startTimeMs))).map(f=>f.league).filter(Boolean))].sort((a,b)=>norm(a).localeCompare(norm(b)))}
function datesFrom(reqBodyOrQuery){
  const raw=reqBodyOrQuery.dates??reqBodyOrQuery.date??"";
  return String(raw).split(",").map(x=>x.trim()).filter(/^\d{4}-\d{2}-\d{2}$/.test);
}

app.get("/api/health",async(_,res)=>res.json({ok:true,service:"Omegaplus Pro AI",source:"SportyBet web feed"}));
app.get("/api/leagues",async(req,res)=>{try{const f=await getFixtures(),dates=datesFrom(req.query);res.json({ok:true,dates,leagues:leaguesFor(f,dates)})}catch(e){res.status(502).json({ok:false,error:e.message,leagues:[]})}});
app.get("/api/fixtures",async(req,res)=>{try{const f=await getFixtures(),dates=datesFrom(req.query),rows=f.filter(x=>dates.includes(dayKey(x.startTimeMs)));res.json({ok:true,dates,total:rows.length,fixtures:rows.map(x=>({id:x.eventId,league:x.league,date:dayKey(x.startTimeMs),time:new Date(x.startTimeMs).toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit",hour12:false}),home:x.home,away:x.away}))})}catch(e){res.status(502).json({ok:false,error:e.message,fixtures:[]})}});

app.post("/api/analyze",async(req,res)=>{
  try{
    const f=await getFixtures(),dates=datesFrom(req.body||{}),leagues=Array.isArray(req.body?.leagues)?req.body.leagues:[],types=Array.isArray(req.body?.marketTypes)?req.body.marketTypes:[],options=Array.isArray(req.body?.selections)?req.body.selections:[],limit=Math.max(1,Math.min(50,Number(req.body?.maxGames)||20));
    const out=[];
    for(const x of f){
      if(!dates.includes(dayKey(x.startTimeMs))||leagues.length&&!leagues.includes(x.league))continue;
      for(const m of x.markets){const type=marketType(m);if(!type||types.length&&!types.includes(type))continue;
        for(const o of m.outcomes){if(!o.isActive||!(o.odds>1)||!matchesOption(o.outcomeName,options))continue;
          const p=confidence(m,o);out.push({id:x.eventId+"-"+m.marketId+"-"+o.outcomeId,eventId:x.eventId,league:x.league,date:dayKey(x.startTimeMs),time:new Date(x.startTimeMs).toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit",hour12:false}),home:x.home,away:x.away,marketType:type,market:m.marketName,specifier:m.specifier,outcomeId:o.outcomeId,pick:o.outcomeName,odds:o.odds,confidence:p,band:band(p)});
        }
      }
    }
    out.sort((a,b)=>b.confidence-a.confidence||a.date.localeCompare(b.date));
    const unique=[];const seen=new Set();for(const r of out){if(seen.has(r.eventId))continue;seen.add(r.eventId);unique.push(r);if(unique.length>=limit)break}
    res.json({ok:true,dates,total:unique.length,available:out.length,predictions:unique});
  }catch(e){res.status(502).json({ok:false,error:e.message,total:0,predictions:[]})}
});


app.post("/api/match-analysis",async(req,res)=>{try{const f=await getFixtures(),id=String(req.body?.eventId||""),fixture=f.find(x=>x.eventId===id);if(!fixture)return res.status(404).json({ok:false,error:"Fixture is no longer available."});const rows=[];for(const m of fixture.markets){const type=marketType(m);if(!type)continue;for(const o of m.outcomes){if(!o.isActive||!(o.odds>1))continue;const p=confidence(m,o);rows.push({id:fixture.eventId+"-"+m.marketId+"-"+o.outcomeId,eventId:fixture.eventId,marketId:m.marketId,outcomeId:o.outcomeId,specifier:m.specifier,league:fixture.league,date:dayKey(fixture.startTimeMs),time:new Date(fixture.startTimeMs).toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit",hour12:false}),home:fixture.home,away:fixture.away,marketType:type,market:m.marketName,pick:o.outcomeName,odds:o.odds,confidence:p,modelProbability:p,fairOdds:Number((100/p).toFixed(2)),band:band(p)});}}rows.sort((a,b)=>b.confidence-a.confidence);res.json({ok:true,fixture:{id:fixture.eventId,league:fixture.league,date:dayKey(fixture.startTimeMs),time:new Date(fixture.startTimeMs).toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit",hour12:false}),home:fixture.home,away:fixture.away},predictions:rows});}catch(e){res.status(502).json({ok:false,error:e.message})}});
app.get("/api/leaderboard",(_,res)=>{const h=readHistory(),m=new Map();for(const x of h){const l=String(x.league||"Unknown");const a=m.get(l)||{league:l,picks:0,settled:0,wins:0};a.picks++;if(x.result==="win"||x.result==="loss"){a.settled++;if(x.result==="win")a.wins++;}m.set(l,a);}const leagues=[...m.values()].map(x=>({...x,hitRate:x.settled?Math.round(x.wins/x.settled*100):null})).sort((a,b)=>(b.hitRate??-1)-(a.hitRate??-1));const settled=h.filter(x=>x.result==="win"||x.result==="loss");const wins=settled.filter(x=>x.result==="win").length;res.json({ok:true,totalPicks:h.length,settled:settled.length,correct:wins,hitRate:settled.length?Math.round(wins/settled.length*100):null,leagues});});
app.post("/api/booking-code",async(req,res)=>{
  try{
    const s=Array.isArray(req.body?.selections)?req.body.selections:[];if(!s.length)return res.status(400).json({ok:false,error:"Select at least one pick."});
    const f=await getFixtures();
    for(const x of s){const fixture=f.find(v=>v.eventId===x.eventId),m=fixture?.markets.find(v=>v.marketId===String(x.marketId)&&String(v.specifier||"")===String(x.specifier||"")),o=m?.outcomes.find(v=>v.outcomeId===String(x.outcomeId)&&v.isActive);if(!fixture||!m||!o)return res.status(409).json({ok:false,error:"A selection changed or is no longer available. Analyze again."})}
    const payload={selections:s.map(x=>({eventId:x.eventId,marketId:String(x.marketId),specifier:x.specifier??null,outcomeId:String(x.outcomeId)}))};
    const body=await sporty("/orders/share",{method:"POST",body:JSON.stringify(payload)});
    if(!body.data?.shareCode)return res.status(502).json({ok:false,error:"SportyBet did not return a booking code."});
    res.json({ok:true,bookingCode:String(body.data.shareCode),shareURL:body.data.shareURL||null});
  }catch(e){res.status(502).json({ok:false,error:e.message})}
});

const historyFile=path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH||"/tmp","omegaplus-history.json");
function readHistory(){try{return JSON.parse(fs.readFileSync(historyFile,"utf8"))}catch{return[]}}
function writeHistory(v){try{fs.mkdirSync(path.dirname(historyFile),{recursive:true});fs.writeFileSync(historyFile,JSON.stringify(v.slice(0,500),null,2))}catch{}}
app.get("/api/history",(_,res)=>res.json({ok:true,history:readHistory()}));
app.post("/api/history",async(req,res)=>{const h=readHistory();h.unshift({...req.body,savedAt:new Date().toISOString()});writeHistory(h);res.json({ok:true})});

app.get("/{*splat}",(_,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log("Omegaplus Pro AI listening on "+PORT));
