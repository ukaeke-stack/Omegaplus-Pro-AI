import express from "express";
import path from "node:path";
import {fileURLToPath} from "node:url";

const app=express();
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const PORT=process.env.PORT||3000;
const SPORTYBET_BASE=process.env.SPORTYBET_API_BASE_URL||"https://www.sportybet.com";
const SPORTYBET_REGION=process.env.SPORTYBET_REGION||"ng";
const COUNTRY=(SPORTYBET_REGION||"ng").toUpperCase();

app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"public")));

const MARKET_IDS=[
  "1","10","11","14","16","18","26","29","36","60100",
  "139","136","138","900304","900305","900312",
  "162","165","166","172","900300","900301"
];

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let lastSportyRequest=0;
let liveCache={at:0,key:"",fixtures:[]};

async function sportyFetch(path, options={}){
  const wait=Math.max(0,250-(Date.now()-lastSportyRequest));
  if(wait) await sleep(wait);
  lastSportyRequest=Date.now();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const res=await fetch(SPORTYBET_BASE+"/api/"+SPORTYBET_REGION+path,{
      ...options,
      headers:{
        Accept:"application/json",
        "Content-Type":"application/json",
        "Current-Country":COUNTRY,
        ...(options.headers||{})
      },
      signal:controller.signal
    });
    const text=await res.text();
    let body=null;
    try{body=text?JSON.parse(text):null}catch{}
    if(!res.ok) throw new Error("SportyBet HTTP "+res.status);
    if(!body) throw new Error("SportyBet returned an invalid response");
    if(Number(body.bizCode||10000)!==10000) throw new Error(body.message||"SportyBet rejected the request");
    return body;
  }finally{
    clearTimeout(timer);
  }
}

async function getSportyFixtures(){
  const key=MARKET_IDS.join(",");
  if(Date.now()-liveCache.at<30000 && liveCache.key===key) return liveCache.fixtures;
  const all=[];
  const pageSize=100;
  for(let page=1;page<=20;page++){
    const params=new URLSearchParams({
      sportId:"sr:sport:1",
      marketId:key,
      pageSize:String(pageSize),
      pageNum:String(page),
      todayGames:"false",
      timeline:"48",
      _t:String(Date.now())
    });
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
          markets:(event.markets||[]).map(m => ({
            marketId:String(m.id||""),
            marketName:String(m.desc||m.name||m.title||m.id||""),
            specifier:m.specifier ?? null,
            status:m.status,
            outcomes:(m.outcomes||[]).map(o => ({
              outcomeId:String(o.id||""),
              outcomeName:String(o.desc||""),
              odds:Number(o.odds),
              isActive:o.isActive===undefined ? true : Boolean(Number(o.isActive))
            }))
          }))
        });
      }
    }
    if(pageCount<pageSize) break;
  }
  liveCache={at:Date.now(),key,fixtures:all};
  return all;
}

function localDayKey(ms){
  const d=new Date(ms+60*60*1000);
  return d.toISOString().slice(0,10);
}

function normalizeText(v){return String(v||"").toLowerCase().replace(/[^a-z0-9.]+/g," ").trim()}

function marketMatches(market, type){
  const n=normalizeText(market.marketName);
  if(type==="ou") return market.marketId==="18";
  if(type==="btts") return market.marketId==="29";
  if(type==="1x2") return market.marketId==="1";
  if(type==="handicap") return ["14","16"].includes(market.marketId);
  if(type==="corners") return ["166","165","162"].includes(market.marketId) || n.includes("corner");
  if(type==="cards") return ["139","138","900304","900305","900312"].includes(market.marketId) || n.includes("booking") || n.includes("card");
  return false;
}

function confidenceForOutcome(market,outcome){
  const active=market.outcomes.filter(o=>o.isActive&&Number.isFinite(o.odds)&&o.odds>1);
  if(!active.length||!Number.isFinite(outcome.odds)||outcome.odds<=1) return 0;
  const inv=1/outcome.odds;
  const total=active.reduce((s,o)=>s+1/o.odds,0);
  const normalized=total?inv/total:inv;
  return Math.round(Math.max(50,Math.min(99,normalized*100)));
}

function pickLabel(type,outcome){
  return outcome.outcomeName||(
    type==="1x2" ? "1X2" :
    type==="btts" ? "BTTS" :
    type==="corners" ? "Corners" :
    type==="cards" ? "Bookings" :
    type==="handicap" ? "Handicap" : "Over/Under"
  );
}

function selectionRequested(outcome,requested){
  if(!requested) return true;
  const a=normalizeText(outcome.outcomeName), b=normalizeText(requested);
  return a===b || a.includes(b) || b.includes(a);
}

app.get("/api/health",(_,r)=>r.json({ok:true,service:"Omegaplus Pro AI",liveSportyBet:true}));

app.get("/api/markets",(_,r)=>r.json({
  markets:[
    {id:"ou",name:"Goals Over/Under",type:"ou"},
    {id:"1x2",name:"1X2",type:"1x2"},
    {id:"btts",name:"BTTS",type:"btts"},
    {id:"handicap",name:"Handicap",type:"handicap"},
    {id:"corners",name:"Corners Over/Under",type:"corners"},
    {id:"cards",name:"Cards/Bookings Over/Under",type:"cards"}
  ]
}));

app.get("/api/leagues",async(_,r)=>{
  try{
    const fixtures=await getSportyFixtures();
    const today=localDayKey(Date.now());
    const leagues=[...new Set(fixtures.filter(x=>localDayKey(x.startTimeMs)===today).map(x=>x.league).filter(Boolean))].sort();
    r.json({leagues});
  }catch(e){r.status(502).json({ok:false,error:e.message});}
});

app.get("/api/predictions",async(_,r)=>{
  try{
    const fixtures=await getSportyFixtures();
    const today=localDayKey(Date.now());
    const rows=fixtures.filter(x=>localDayKey(x.startTimeMs)===today).slice(0,1000).map(x=>({
      id:x.eventId,league:x.league,time:new Date(x.startTimeMs).toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit",hour12:false}),
      home:x.home,away:x.away,p:0,xg:null,market:"Live SportyBet markets",confidence:"Select an option to analyze",
      eventId:x.eventId
    }));
    r.json({predictions:rows,source:"SportyBet web feed",generatedAt:new Date().toISOString()});
  }catch(e){r.status(502).json({ok:false,error:e.message,predictions:[]});}
});

app.post("/api/predictions/analyze",async(q,r)=>{
  try{
    const body=q.body||{};
    const league=body.league||"all";
    const type=body.marketType||"ou";
    const requested=body.selection||"";
    const minConfidence=Math.max(0,Math.min(99,Number(body.minConfidence||0)));
    const fixtures=await getSportyFixtures();
    const today=localDayKey(Date.now());
    const results=[];
    for(const fixture of fixtures){
      if(localDayKey(fixture.startTimeMs)!==today) continue;
      if(league!=="all"&&fixture.league!==league) continue;
      for(const market of fixture.markets){
        if(!marketMatches(market,type)) continue;
        for(const outcome of market.outcomes){
          if(!outcome.isActive||!Number.isFinite(outcome.odds)||outcome.odds<=1) continue;
          if(!selectionRequested(outcome,requested)) continue;
          const confidence=confidenceForOutcome(market,outcome);
          if(confidence<minConfidence) continue;
          results.push({
            id:fixture.eventId+"_"+market.marketId+"_"+(market.specifier||"")+"_"+outcome.outcomeId,
            eventId:fixture.eventId,league:fixture.league,category:fixture.category,
            time:new Date(fixture.startTimeMs).toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit",hour12:false}),
            startTimeMs:fixture.startTimeMs,home:fixture.home,away:fixture.away,
            market:market.marketName,marketId:market.marketId,specifier:market.specifier,
            outcomeId:outcome.outcomeId,pick:pickLabel(type,outcome),odds:outcome.odds,
            confidence,confidenceLabel:confidence>=85?"Very High":confidence>=75?"High":confidence>=65?"Good":"Moderate"
          });
        }
      }
    }
    const dedupe=new Map();
    for(const row of results){
      const key=row.eventId+"|"+row.marketId+"|"+row.specifier+"|"+row.outcomeId;
      if(!dedupe.has(key)||dedupe.get(key).confidence<row.confidence) dedupe.set(key,row);
    }
    const predictions=[...dedupe.values()].sort((a,b)=>b.confidence-a.confidence||a.startTimeMs-b.startTimeMs);
    r.json({
      ok:true,source:"SportyBet web feed",generatedAt:new Date().toISOString(),
      criteria:{date:"today",league,marketType:type,selection:requested,minConfidence},
      total:predictions.length,predictions
    });
  }catch(e){
    r.status(502).json({ok:false,error:e.message,total:0,predictions:[]});
  }
});

app.post("/api/booking-code",async(q,r)=>{
  try{
    const selections=Array.isArray(q.body?.selections)?q.body.selections:[];
    if(!selections.length) return r.status(400).json({ok:false,error:"Select at least one analyzed match first."});
    const fixtures=await getSportyFixtures();
    for(const s of selections){
      const f=fixtures.find(x=>x.eventId===s.eventId);
      const m=f?.markets.find(x=>x.marketId===String(s.marketId)&&String(x.specifier||"")===String(s.specifier||""));
      const o=m?.outcomes.find(x=>x.outcomeId===String(s.outcomeId)&&x.isActive);
      if(!f||!m||!o) return r.status(409).json({ok:false,error:"One or more selections are no longer available. Refresh and analyze again."});
    }
    const payload={selections:selections.map(s=>({eventId:s.eventId,marketId:String(s.marketId),specifier:s.specifier??null,outcomeId:String(s.outcomeId)}))};
    const body=await sportyFetch("/orders/share",{method:"POST",body:JSON.stringify(payload)});
    const data=body.data||{};
    if(!data.shareCode) return r.status(502).json({ok:false,error:"SportyBet did not return a booking code."});
    r.json({ok:true,bookingCode:String(data.shareCode),shareURL:data.shareURL||null,deadline:data.deadline||null});
  }catch(e){r.status(502).json({ok:false,error:e.message});}
});

app.get("/{*splat}",(_,r)=>r.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log("Omegaplus Pro AI listening on "+PORT));