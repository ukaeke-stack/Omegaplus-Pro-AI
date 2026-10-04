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

const MARKET_IDS=["1","18","10","29","11","26","36","14","60100"];\nconst FALLBACK_MARKET_IDS=["1","18","10","29","11","26","36","14","60100","16","139","136","138","900304","900305","900312","162","165","166","172","900300","900301"];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let lastSportyRequest=0;
let liveCache={at:0,key:"",fixtures:[]};

async function sportyFetch(pathname,options={}){
  const wait=Math.max(0,250-(Date.now()-lastSportyRequest));
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

function normalizeActive(v){\n  if(v===undefined||v===null||v===\"\") return true;\n  if(v===true||v===1||v===\"1\"||String(v).toLowerCase()===\"true\") return true;\n  return false;\n}\nfunction normalizeStartTime(v){\n  const n=Number(v||0);\n  if(!Number.isFinite(n)||n<=0) return 0;\n  return n<100000000000?n*1000:n;\n}\nasync function fetchSportyFixturePages(marketIds){\n  const key=marketIds.join(\",\"),all=[],pageSize=100;\n  for(let page=1;page<=50;page++){\n    const params=new URLSearchParams({sportId:\"sr:sport:1\",marketId:key,pageSize:String(pageSize),pageNum:String(page),todayGames:\"false\",timeline:\"720\",_t:String(Date.now())});\n    const body=await sportyFetch(\"/factsCenter/pcUpcomingEvents?\"+params);\n    const tournaments=Array.isArray(body.data?.tournaments)?body.data.tournaments:[];\n    let pageCount=0;\n    for(const tournament of tournaments){\n      for(const event of (tournament.events||[])){\n        pageCount++;\n        all.push({\n          eventId:String(event.eventId||\"\"),\n          league:String(tournament.name||\"\"),\n          category:String(tournament.categoryName||\"\"),\n          home:String(event.homeTeamName||\"\"),\n          away:String(event.awayTeamName||\"\"),\n          startTimeMs:normalizeStartTime(event.estimateStartTime),\n          matchStatus:String(event.matchStatus||\"Not start\"),\n          markets:(event.markets||[]).map(m=>({\n            marketId:String(m.id||\"\"),\n            marketName:String(m.desc||m.name||m.title||m.id||\"\"),\n            specifier:m.specifier??null,\n            status:m.status,\n            outcomes:(m.outcomes||[]).map(o=>({\n              outcomeId:String(o.id||\"\"),\n              outcomeName:String(o.desc||o.name||o.title||\"\"),\n              odds:Number(o.odds),\n              isActive:normalizeActive(o.isActive)\n            }))\n          }))\n        });\n      }\n    }\n    if(pageCount<pageSize) break;\n  }\n  return all;\n}\nasync function getSportyFixtures(){\n  const key=MARKET_IDS.join(\",\");\n  if(Date.now()-liveCache.at<30000&&liveCache.key===key) return liveCache.fixtures;\n  let all=await fetchSportyFixturePages(MARKET_IDS);\n  if(!all.length) all=await fetchSportyFixturePages(FALLBACK_MARKET_IDS);\n  liveCache={at:Date.now(),key,fixtures:all};\n  return all;\n}\n
