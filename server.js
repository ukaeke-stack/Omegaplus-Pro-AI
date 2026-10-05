import express from "express";
import {put,get} from "@vercel/blob";
import {getDateResults,getLatestResults,getMyLeagues,norm as resultNorm} from "./sportmonks-results.js";
import path from "node:path";
import {fileURLToPath} from "node:url";

const app=express();
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const PORT=process.env.PORT||3000;
const SPORTYBET_BASE=process.env.SPORTYBET_API_BASE_URL||"https://www.sportybet.com";
const SPORTYBET_REGION=process.env.SPORTYBET_REGION||"ng";
const COUNTRY=(SPORTYBET_REGION||"ng").toUpperCase();
const BOOKMAKERS=[{id:"sportybet",name:"SportyBet",country:"ng",native:true},{id:"bet9ja",name:"Bet9ja",country:"ng"},{id:"msport",name:"MSport",country:"ng"},{id:"betking",name:"BetKing",country:"ng"},{id:"1xbet",name:"1xBet",country:"ng"},{id:"betano",name:"Betano",country:"ng"},{id:"22bet",name:"22Bet",country:"ng"}];
const BETRELAY_BASE=process.env.BETRELAY_API_BASE_URL||"https://betrelay.com.ng/api/v1";
const BETRELAY_API_KEY=process.env.BETRELAY_API_KEY||"";
async function betRelayFetch(pathname,options={}){if(!BETRELAY_API_KEY)throw new Error("Multi-bookmaker code service is not configured yet. Add BETRELAY_API_KEY to Railway.");const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);try{const res=await fetch(BETRELAY_BASE+pathname,{...options,headers:{Accept:"application/json","Content-Type":"application/json","X-API-Key":BETRELAY_API_KEY,...(options.headers||{})},signal:controller.signal});const text=await res.text();let body=null;try{body=text?JSON.parse(text):null}catch{}if(!res.ok)throw new Error(body?.message||("BetRelay HTTP "+res.status));if(!body)throw new Error("BetRelay returned an invalid response");return body}finally{clearTimeout(timer)}}
function bookmakerById(id){return BOOKMAKERS.find(x=>x.id===String(id))}
async function createSportyBooking(selections){const fixtures=await getSportyFixtures();for(const s of selections){const f=fixtures.find(x=>x.eventId===s.eventId);const m=f?.markets.find(x=>x.marketId===String(s.marketId)&&String(x.specifier||"")===String(s.specifier||""));const o=m?.outcomes.find(x=>x.outcomeId===String(s.outcomeId)&&x.isActive);if(!f||!m||!o)throw new Error("One or more selections are no longer available. Refresh and analyze again.")}const payload={selections:selections.map(s=>({eventId:s.eventId,marketId:String(s.marketId),specifier:s.specifier??null,outcomeId:String(s.outcomeId)}))};const body=await sportyFetch("/orders/share",{method:"POST",body:JSON.stringify(payload)}),data=body.data||{};if(!data.shareCode)throw new Error("SportyBet did not return a booking code.");return{bookingCode:String(data.shareCode),shareURL:data.shareURL||null,deadline:data.deadline||null}}
async function generateTargetBooking(target,selections){const targetBookie=bookmakerById(target);if(!targetBookie)throw new Error("Unsupported bookmaker.");const sporty=await createSportyBooking(selections);if(target==="sportybet")return{...sporty,source:"SportyBet",target:"SportyBet"};const body=await betRelayFetch("/convert",{method:"POST",body:JSON.stringify({code:sporty.bookingCode,from:"sportybet",to:target,country:"ng"})});const data=body.data||{};if(!data.shareCode)throw new Error(targetBookie.name+" did not return a booking code.");return{bookingCode:String(data.shareCode),shareURL:data.shareURL||null,source:"SportyBet → BetRelay",target:targetBookie.name,sourceCode:sporty.bookingCode,selections:data.selections||[]}}


app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"public")));

const MARKET_IDS=["1","10","11","14","16","18","26","29","36","60100","139","136","138","900304","900305","900312","162","165","166","172","900300","900301"];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let lastSportyRequest=0;
let liveCache={at:0,key:"",fixtures:[]};
let liveFetchPromise=null;
const dayCache=new Map();
const DAY_CACHE_MS=24*60*60*1000;
const resultCache=new Map();\nconst ARCHIVE_PREFIX="omegaplus-history";
function archivePath(date){return ARCHIVE_PREFIX+"/"+String(date).slice(0,4)+"/"+String(date).slice(5,7)+"/"+String(date).slice(8,10)+".json"}
async function readPersistentArchive(date){
  try{
    const {stream}=await get(archivePath(date),{access:"private",useCache:false});
    return JSON.parse(await new Response(stream).text());
  }catch{return null}
}
async function writePersistentArchive(date,data){
  return put(archivePath(date),JSON.stringify(data),{access:"private",addRandomSuffix:false,allowOverwrite:true,contentType:"application/json"});
}
async function archiveRecord(date,patch={}){
  const existing=await readPersistentArchive(date)||{date,predictions:[],results:[],savedAt:null,updatedAt:null};
  const next={...existing,...patch,date,updatedAt:new Date().toISOString(),savedAt:existing.savedAt||new Date().toISOString()};
  await writePersistentArchive(date,next); return next;
}


async function sportyFetch(pathname,options={}){
  const wait=Math.max(0,100-(Date.now()-lastSportyRequest));
  if(wait) await sleep(wait);
  lastSportyRequest=Date.now();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const res=await fetch(SPORTYBET_BASE+"/api/"+SPORTYBET_REGION+pathname,{
      ...options,
      headers:{Accept:"application/json","Content-Type":"application/json","Current-Country":COUNTRY,...(options.headers||{})},
      signal:controller.signal
    });
    const text=await res.text();
    let body=null;
    try{body=text?JSON.parse(text):null}catch{}
    if(!res.ok) throw new Error("SportyBet HTTP "+res.status);
    if(!body) throw new Error("SportyBet returned an invalid response");
    if(Number(body.bizCode||10000)!==10000) throw new Error(body.message||"SportyBet rejected the request");
    return body;
  }finally{clearTimeout(timer)}
}

async function getSportyFixtures(todayOnly=false,force=false){
  const marketKey=MARKET_IDS.join(",");
  const cacheKey=marketKey+"|"+(todayOnly?"today":"future");
  if(!force&&Date.now()-liveCache.at<300000&&liveCache.key===cacheKey) return liveCache.fixtures;
  if(liveFetchPromise) return liveFetchPromise;
  liveFetchPromise=(async()=>{
  const all=[],pageSize=100;
  for(let page=1;page<=(todayOnly?10:50);page++){
    const params=new URLSearchParams({sportId:"sr:sport:1",marketId:marketKey,pageSize:String(pageSize),pageNum:String(page),todayGames:String(todayOnly),timeline:todayOnly?"48":"720",_t:String(Date.now())});
    const body=await sportyFetch("/factsCenter/pcUpcomingEvents?"+params);
    const tournaments=body.data?.tournaments||[];
    let pageCount=0;
    for(const tournament of tournaments){
      for(const event of tournament.events||[]){
        pageCount++;
        all.push({
          eventId:String(event.eventId||""),
          league:String(tournament.name||""),
          category:String(tournament.categoryName||""),
          home:String(event.homeTeamName||""),
          away:String(event.awayTeamName||""),
          startTimeMs:Number(event.estimateStartTime||0),
          matchStatus:String(event.matchStatus||"Not start"),
          homeScore:event.homeScore?.current??event.homeScore?.display??event.homeScore??event.homeTeamScore??null,
          awayScore:event.awayScore?.current??event.awayScore?.display??event.awayScore??event.awayTeamScore??null,
          markets:(event.markets||[]).map(m=>({
            marketId:String(m.id||""),
            marketName:String(m.desc||m.name||m.title||m.id||""),
            specifier:m.specifier??null,
            status:m.status,
            outcomes:(m.outcomes||[]).map(o=>({
              outcomeId:String(o.id||""),
              outcomeName:String(o.desc||""),
              odds:Number(o.odds),
              isActive:o.isActive===undefined?true:Boolean(Number(o.isActive))
            }))
          }))
        });
      }
    }
    if(pageCount<pageSize) break;
  }
  liveCache={at:Date.now(),key:cacheKey,fixtures:all};
  return all;
  })();
  try{return await liveFetchPromise}finally{liveFetchPromise=null}
}

function localDayKey(ms){
  const d=new Date(ms);
  return d.toLocaleDateString("en-CA",{timeZone:"Africa/Lagos"});
}
function normalizeText(v){return String(v||"").toLowerCase().replace(/[^a-z0-9.]+/g," ").trim()}
function marketMatches(market,type){
  const n=normalizeText(market.marketName);
  if(type==="ou") return market.marketId==="18";
  if(type==="btts") return market.marketId==="29";
  if(type==="1x2") return market.marketId==="1";
  if(type==="handicap") return ["14","16"].includes(market.marketId);
  if(type==="corners") return ["166","165","162"].includes(market.marketId)||n.includes("corner");
  if(type==="cards") return ["139","138","900304","900305","900312"].includes(market.marketId)||n.includes("booking")||n.includes("card");
  return false;
}
function confidenceForOutcome(market,outcome){
  const active=market.outcomes.filter(o=>o.isActive&&Number.isFinite(o.odds)&&o.odds>1);
  if(!active.length||!Number.isFinite(outcome.odds)||outcome.odds<=1) return 0;
  const inv=1/outcome.odds,total=active.reduce((s,o)=>s+1/o.odds,0),normalized=total?inv/total:inv;
  return Math.round(Math.max(50,Math.min(99,normalized*100)));
}
function pickLabel(type,outcome){
  return outcome.outcomeName||(type==="1x2"?"1X2":type==="btts"?"BTTS":type==="corners"?"Corners":type==="cards"?"Bookings":type==="handicap"?"Handicap":"Over/Under");
}
function selectionRequested(outcome,requested){
  if(!requested) return true;
  const a=normalizeText(outcome.outcomeName),b=normalizeText(requested);
  return a===b;
}
function leagueRank(name){
  const n=normalizeText(name);
  const top=[
    "premier league","la liga","laliga","bundesliga","serie a","ligue 1",
    "eredivisie","primeira liga","championship","super lig","belgium first",
    "scottish premiership","mls","major league soccer","saudi pro league"
  ];
  const champions=["champions league","uefa champions","europa league","conference league","copa libertadores","afc champions"];
  const international=["world cup","euro","nations league","africa cup","afcon","international","world","qualifiers"];
  const i=top.findIndex(x=>n.includes(x)); if(i>=0) return i;
  if(champions.some(x=>n.includes(x))) return 100;
  if(international.some(x=>n.includes(x))) return 200;
  return 300;
}
function sortLeagues(a,b){
  const ra=leagueRank(a),rb=leagueRank(b);
  if(ra!==rb) return ra-rb;
  return a.localeCompare(b);
}

app.get("/api/health",(_,r)=>r.json({ok:true,service:"Omegaplus Pro AI",liveSportyBet:true,multiBookmaker:BOOKMAKERS.map(x=>({id:x.id,name:x.name,codeGeneration:x.id==="sportybet"||Boolean(BETRELAY_API_KEY)}))}));
app.get("/api/bookmakers",(_,r)=>r.json({ok:true,bookmakers:BOOKMAKERS.map(x=>({id:x.id,name:x.name,codeGeneration:x.id==="sportybet"||Boolean(BETRELAY_API_KEY),method:x.id==="sportybet"?"native":"SportyBet→BetRelay"})),configured:Boolean(BETRELAY_API_KEY)}));

app.get("/api/markets",(_,r)=>r.json({markets:[
  {id:"ou",name:"Goals Over/Under",type:"ou"},{id:"1x2",name:"1X2",type:"1x2"},
  {id:"btts",name:"BTTS",type:"btts"},{id:"handicap",name:"Handicap",type:"handicap"},
  {id:"corners",name:"Corners Over/Under",type:"corners"},{id:"cards",name:"Cards/Bookings Over/Under",type:"cards"}
]}));

async function getDayFixtures(date,force=false){
  const hit=dayCache.get(date);
  if(!force&&hit&&Date.now()-hit.at<DAY_CACHE_MS)return {fixtures:hit.fixtures,cached:true,scannedAt:hit.at};
  const fixtures=await getSportyFixtures(date===localDayKey(Date.now()),force);
  const day=fixtures.filter(x=>localDayKey(x.startTimeMs)===date);
  dayCache.set(date,{at:Date.now(),fixtures:day});
  return {fixtures:day,cached:false,scannedAt:Date.now()};
}

app.get("/api/scan",async(req,r)=>{
  try{const date=String(req.query.date||localDayKey(Date.now()));const x=await getDayFixtures(date,true);r.json({ok:true,date,cached:false,scannedAt:x.scannedAt,fixtureCount:x.fixtures.length,leagues:[...new Set(x.fixtures.map(f=>f.league).filter(Boolean))].sort(sortLeagues)});}catch(e){r.status(502).json({ok:false,error:e.message})}
});
app.get("/api/history",async(req,r)=>{
  try{const date=String(req.query.date||localDayKey(Date.now()));const archive=await readPersistentArchive(date);r.json({ok:true,date,found:Boolean(archive),archive:archive||null,storage:"vercel-blob"});}catch(e){r.status(500).json({ok:false,error:e.message,archive:null})}
});
app.post("/api/history",async(req,r)=>{
  try{const date=String(req.body?.date||localDayKey(Date.now()));const patch={};if(Array.isArray(req.body?.predictions))patch.predictions=req.body.predictions.slice(0,10);if(Array.isArray(req.body?.results))patch.results=req.body.results;const archive=await archiveRecord(date,patch);r.json({ok:true,date,archive,storage:"vercel-blob"});}catch(e){r.status(500).json({ok:false,error:e.message})}
});
app.get("/api/results/status",(_,r)=>r.json({ok:true,configured:Boolean(process.env.SPORTMONKS_API_TOKEN),provider:"Sportmonks",cacheSeconds:15}));
app.get("/api/results/leagues",async(_,r)=>{try{const x=await getMyLeagues();if(!x.configured)return r.status(503).json({ok:false,configured:false,error:x.error,leagues:[]});r.json({ok:true,configured:true,provider:"Sportmonks",count:x.data.length,leagues:x.data.map(l=>({id:l.id,name:l.name,countryId:l.country_id,active:l.active}))})}catch(e){r.status(502).json({ok:false,configured:true,provider:"Sportmonks",error:e.message,leagues:[]})}});
app.get("/api/results",async(req,r)=>{
  try{const date=String(req.query.date||localDayKey(Date.now()));const force=String(req.query.refresh||"") === "1";const x=await getDateResults(date,force);if(!x.configured)return r.status(503).json({ok:false,configured:false,provider:"Sportmonks",error:x.error,results:[]});r.json({ok:true,configured:true,provider:"Sportmonks",date,results:x.data,cached:x.cached,updatedAt:x.updatedAt});}
  catch(e){r.status(502).json({ok:false,configured:true,provider:"Sportmonks",error:e.message,results:[]})}
});
app.get("/api/results/live",async(_,r)=>{try{const x=await getLatestResults();if(!x.configured)return r.status(503).json({ok:false,configured:false,provider:"Sportmonks",error:x.error,results:[]});r.json({ok:true,configured:true,provider:"Sportmonks",results:x.data,updatedAt:x.updatedAt})}catch(e){r.status(502).json({ok:false,configured:true,provider:"Sportmonks",error:e.message,results:[]})}});

app.get("/api/leagues",async(req,r)=>{
  try{
    const requestedDate=String(req.query.date||localDayKey(Date.now()));
    const {fixtures}=await getDayFixtures(requestedDate,false);
    const leagues=[...new Set(fixtures.map(x=>x.league).filter(Boolean))].sort(sortLeagues);
    r.json({ok:true,date:requestedDate,leagues});
  }catch(e){r.status(502).json({ok:false,error:e.message,leagues:[]})}
});

app.get("/api/predictions",async(req,r)=>{
  try{
    const requestedDate=String(req.query.date||localDayKey(Date.now())),fixtures=(await getDayFixtures(requestedDate,false)).fixtures;
    const rows=fixtures.filter(x=>localDayKey(x.startTimeMs)===requestedDate).slice(0,1000).map(x=>({
      id:x.eventId,league:x.league,time:new Date(x.startTimeMs).toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit",hour12:false}),
      home:x.home,away:x.away,market:"Live SportyBet markets",confidence:"Select an option to analyze",eventId:x.eventId,matchStatus:x.matchStatus,homeScore:x.homeScore,awayScore:x.awayScore
    }));
    r.json({predictions:rows,source:"SportyBet web feed",generatedAt:new Date().toISOString(),date:requestedDate});
  }catch(e){r.status(502).json({ok:false,error:e.message,predictions:[]})}
});

async function buildDailyBest(date){
  const fixtures=(await getDayFixtures(date,false)).fixtures,results=[];
  for(const fixture of fixtures){
    if(localDayKey(fixture.startTimeMs)!==date) continue;
    for(const market of fixture.markets){
      if(market.marketId!=="18") continue;
      for(const outcome of market.outcomes){
        if(!outcome.isActive||!Number.isFinite(outcome.odds)||outcome.odds<=1) continue;
        const label=pickLabel("ou",outcome); if(!/^over\\s*(1\\.5|2\\.5)$/i.test(label)) continue;
        const confidence=confidenceForOutcome(market,outcome);
        results.push({id:fixture.eventId+"_"+market.marketId+"_"+(market.specifier||"")+"_"+outcome.outcomeId,eventId:fixture.eventId,league:fixture.league,category:fixture.category,time:new Date(fixture.startTimeMs).toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit",hour12:false}),startTimeMs:fixture.startTimeMs,home:fixture.home,away:fixture.away,market:market.marketName,marketId:market.marketId,specifier:market.specifier,outcomeId:outcome.outcomeId,pick:label,odds:outcome.odds,marketType:"ou",confidence,confidenceLabel:confidence>=85?"Very High":confidence>=75?"High":confidence>=65?"Good":"Moderate",date});
      }
    }
  }
  const dedupe=new Map(); for(const row of results){if(!dedupe.has(row.eventId)||dedupe.get(row.eventId).confidence<row.confidence)dedupe.set(row.eventId,row)}
  return [...dedupe.values()].sort((a,b)=>b.confidence-a.confidence||a.startTimeMs-b.startTimeMs).slice(0,10);
}
app.get("/api/daily-best",async(req,r)=>{
  try{const date=String(req.query.date||localDayKey(Date.now()));const existing=await readPersistentArchive(date);if(existing?.predictions?.length)return r.json({ok:true,date,predictions:existing.predictions.slice(0,10),archived:true});const predictions=await buildDailyBest(date);const archive=await archiveRecord(date,{predictions,results:[]});r.json({ok:true,date,predictions,archived:true,archive:archive.savedAt});}catch(e){r.status(502).json({ok:false,error:e.message,predictions:[]})}
});
app.post("/api/predictions/analyze",async(req,r)=>{
  try{
    const body=req.body||{};
    const requestedDate=String(body.date||localDayKey(Date.now()));
    const leagues=Array.isArray(body.leagues)?body.leagues.filter(Boolean):[];
    const marketTypes=Array.isArray(body.marketTypes)?body.marketTypes.filter(Boolean):[];
    const selections=Array.isArray(body.selections)?body.selections.filter(Boolean):[];
    const maxGames=Math.max(1,Math.min(50,Number(body.maxGames)||20));
    const minConfidence=Math.max(0,Math.min(99,Number(body.minConfidence)||0));
    const fixtures=(await getDayFixtures(requestedDate,false)).fixtures,results=[];
    for(const fixture of fixtures){
      if(localDayKey(fixture.startTimeMs)!==requestedDate) continue;
      if(leagues.length&&!leagues.includes(fixture.league)) continue;
      for(const market of fixture.markets){
        const types=marketTypes.length?marketTypes:["ou"];
        for(const type of types){
          if(!marketMatches(market,type)) continue;
          for(const outcome of market.outcomes){
            if(!outcome.isActive||!Number.isFinite(outcome.odds)||outcome.odds<=1) continue;
            if(selections.length&&!selections.some(s=>selectionRequested(outcome,s))) continue;
            const confidence=confidenceForOutcome(market,outcome);
            if(confidence<minConfidence) continue;
            results.push({
              id:fixture.eventId+"_"+market.marketId+"_"+(market.specifier||"")+"_"+outcome.outcomeId,
              eventId:fixture.eventId,league:fixture.league,category:fixture.category,
              time:new Date(fixture.startTimeMs).toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit",hour12:false}),
              startTimeMs:fixture.startTimeMs,home:fixture.home,away:fixture.away,
              market:market.marketName,marketId:market.marketId,specifier:market.specifier,
              outcomeId:outcome.outcomeId,pick:pickLabel(type,outcome),odds:outcome.odds,marketType:type,
              confidence,confidenceLabel:confidence>=85?"Very High":confidence>=75?"High":confidence>=65?"Good":"Moderate"
            });
          }
        }
      }
    }
    const dedupe=new Map();
    for(const row of results){
      const key=row.eventId;
      if(!dedupe.has(key)||dedupe.get(key).confidence<row.confidence) dedupe.set(key,row);
    }
    const qualified=[...dedupe.values()].sort((a,b)=>b.confidence-a.confidence||a.startTimeMs-b.startTimeMs);
    const predictions=qualified.slice(0,maxGames);
    r.json({ok:true,source:"SportyBet web feed",generatedAt:new Date().toISOString(),criteria:{date:requestedDate,leagues,marketTypes,selections,maxGames,minConfidence},total:predictions.length,available:qualified.length,predictions});
  }catch(e){r.status(502).json({ok:false,error:e.message,total:0,available:0,predictions:[]})}
});

app.post("/api/booking-code",async(req,r)=>{try{const selections=Array.isArray(req.body?.selections)?req.body.selections:[],target=String(req.body?.bookmaker||"sportybet");if(!selections.length)return r.status(400).json({ok:false,error:"Select at least one analyzed match first."});r.json({ok:true,...await generateTargetBooking(target,selections)})}catch(e){r.status(502).json({ok:false,error:e.message})}});

app.get("/api/daily-rollover",async(req,r)=>{
  try{
    const date=localDayKey(Date.now()),prev=localDayKey(Date.now()-86400000);
    const prevResults=await getDateResults(prev,true); const resultRows=prevResults.configured?prevResults.data:[];
    const prevArchive=await readPersistentArchive(prev);
    if(prevArchive){await archiveRecord(prev,{predictions:prevArchive.predictions||[],results:resultRows});}
    const todayArchive=await readPersistentArchive(date); const predictions=todayArchive?.predictions?.length?todayArchive.predictions:await buildDailyBest(date);
    await archiveRecord(date,{predictions,results:[]});
    r.json({ok:true,date,previousDate:prev,previousResults:resultRows.length,newDailyBest:predictions.length});
  }catch(e){r.status(500).json({ok:false,error:e.message})}
});
app.get("/{*splat}",(_,r)=>r.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log("Omegaplus Pro AI listening on "+PORT));
