import express from "express";
import {initAuthDb,authDbConfigured,dbReady,currentUser,requireAuth,requirePaid,requireRole,registerUser,createAdminUser,loginUser,logoutUser,setSessionCookie,clearSessionCookie,adminUsers,setUserAccess,adminStats,listPlans,createOrUpdatePlan,activateSubscription,revokeSubscription,audit,getAccessSettings,updateAccessSettings,grantFreeTrial,paymentHistory,createPaymentRecord,activateProviderSubscription,getAdminSettings,updateAdminSettings} from "./auth.js";
import {put,get} from "@vercel/blob";
import {getDateResults,getLatestResults,getMyLeagues,norm as resultNorm} from "./sportmonks-results.js";
import {getVerifiedResults,getVerifiedLiveResults} from "./result-sources.js";
import {enrichPredictions,independentHealth} from "./independent-stats.js";
import {applyDerivedModel} from "./model-ensemble.js";
import {analyzeCorrectScores} from "./correct-score.js";
import {createTicket,listUserTickets,getOrCreateChat,listChatMessages,addChatMessage,adminTickets,updateTicket,adminThreads,adminMessages,adminAddMessage,setThreadStatus,initSupportDb} from "./support.js";
import {smartPickRank,buildBetBuilder,performanceFromArchives,buildMatchReport,oddsMovement,extractOddsSnapshot} from "./advanced-features.js";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import {fileURLToPath} from "node:url";

async function enrichAndModel(rows,opts){return applyDerivedModel(await enrichPredictions(rows,opts))}
const app=express();
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const PORT=process.env.PORT||3000;
const APP_VERSION="1.6.0";
const APP_ID="com.omegaplus.proai";
const APP_VERSION_CODE=5;
const ANDROID_TARGET_SDK=36;
const MIN_SUPPORTED_WEB_VERSION="1.6.0";
const DAILY_PREDICTION_MIN_ODDS=1.10;
const DAILY_SELECTION_VERSION="mixed-top10-v1";
const SPORTYBET_BASE=process.env.SPORTYBET_API_BASE_URL||"https://www.sportybet.com";
const SPORTYBET_REGION=process.env.SPORTYBET_REGION||"ng";
const COUNTRY=(SPORTYBET_REGION||"ng").toUpperCase();
const SPORTS=[{id:"football",name:"Football",sportId:"sr:sport:1"},{id:"basketball",name:"Basketball",sportId:"sr:sport:2"},{id:"baseball",name:"Baseball",sportId:"sr:sport:3"},{id:"ice_hockey",name:"Ice Hockey",sportId:"sr:sport:4"},{id:"tennis",name:"Tennis",sportId:"sr:sport:5"},{id:"table_tennis",name:"Table Tennis",sportId:"sr:sport:20"}];
const BOOKMAKERS=[{id:"sportybet",name:"SportyBet",country:"ng",native:true},{id:"bet9ja",name:"Bet9ja",country:"ng"},{id:"msport",name:"MSport",country:"ng"},{id:"betking",name:"BetKing",country:"ng"},{id:"1xbet",name:"1xBet",country:"ng"},{id:"betano",name:"Betano",country:"ng"},{id:"22bet",name:"22Bet",country:"ng"}];
const BETRELAY_BASE=process.env.BETRELAY_API_BASE_URL||"https://betrelay.com.ng/api/v1";
const BETRELAY_API_KEY=process.env.BETRELAY_API_KEY||"";
async function betRelayFetch(pathname,options={}){if(!BETRELAY_API_KEY)throw new Error("Multi-bookmaker code service is not configured yet. Add BETRELAY_API_KEY to Railway.");const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);try{const res=await fetch(BETRELAY_BASE+pathname,{...options,headers:{Accept:"application/json","Content-Type":"application/json","X-API-Key":BETRELAY_API_KEY,...(options.headers||{})},signal:controller.signal});const text=await res.text();let body=null;try{body=text?JSON.parse(text):null}catch{}if(!res.ok)throw new Error(body?.message||("BetRelay HTTP "+res.status));if(!body)throw new Error("BetRelay returned an invalid response");return body}finally{clearTimeout(timer)}}
function bookmakerById(id){return BOOKMAKERS.find(x=>x.id===String(id))}
async function createSportyBooking(selections,sport="football"){
  const fixtures=await getSportyFixtures(false,true,sport);
  const available=[],unavailable=[];
  for(const s of selections){
    const f=fixtures.find(x=>x.eventId===s.eventId);
    const m=f?.markets.find(x=>x.marketId===String(s.marketId)&&String(x.specifier||"")===String(s.specifier||""));
    const o=m?.outcomes.find(x=>x.outcomeId===String(s.outcomeId)&&x.isActive);
    if(!f||!m||!o){
      unavailable.push({eventId:s.eventId,home:s.home||f?.home||"Unknown",away:s.away||f?.away||"Unknown",pick:s.pick||s.outcomeName||"Selection unavailable"});
      continue;
    }
    available.push(s);
  }
  if(!available.length){
    const err=new Error("None of the selected games are currently available for booking. Refresh and analyze again.");
    err.code="NO_AVAILABLE_SELECTIONS"; err.unavailable=unavailable; throw err;
  }
  const payload={selections:available.map(s=>({eventId:s.eventId,marketId:String(s.marketId),specifier:s.specifier??null,outcomeId:String(s.outcomeId)}))};
  const body=await sportyFetch("/orders/share",{method:"POST",body:JSON.stringify(payload)}),data=body.data||{};
  if(!data.shareCode)throw new Error("SportyBet did not return a booking code for the available selections.");
  return{bookingCode:String(data.shareCode),shareURL:data.shareURL||null,deadline:data.deadline||null,availableSelections:available,unavailableSelections:unavailable};
}
async function generateTargetBooking(target,selections,sport="football"){const targetBookie=bookmakerById(target);if(!targetBookie)throw new Error("Unsupported bookmaker.");const sporty=await createSportyBooking(selections,sport);if(target==="sportybet")return{...sporty,source:"SportyBet",target:"SportyBet"};const body=await betRelayFetch("/convert",{method:"POST",body:JSON.stringify({code:sporty.bookingCode,from:"sportybet",to:target,country:"ng"})});const data=body.data||{};if(!data.shareCode)throw new Error(targetBookie.name+" did not return a booking code.");return{bookingCode:String(data.shareCode),shareURL:data.shareURL||null,source:"SportyBet → BetRelay",target:targetBookie.name,sourceCode:sporty.bookingCode,selections:data.selections||[],availableSelections:sporty.availableSelections||[],unavailableSelections:sporty.unavailableSelections||[]}}


app.use(express.json({limit:"1mb",verify:(req,res,buf)=>{req.rawBody=Buffer.from(buf)}}));
initAuthDb().then(ok=>{console.log("Account database:",ok?"ready":"not configured/unavailable");return initSupportDb()}).then(ok=>console.log("Support database:",ok?"ready":"not configured/unavailable"));
app.use((req,res,next)=>{
  if(req.path==="/"||/\.(?:js|css|html|webmanifest)$/.test(req.path)) res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");
  next();
});
app.use(express.static(path.join(__dirname,"public")));

const MARKET_IDS=["1","10","11","14","16","18","26","29","36","60100","139","136","138","900304","900305","900312","162","165","166","172","900300","900301","219","223","225","227","228"];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let lastSportyRequest=0;
let liveCache={at:0,key:"",fixtures:[]};
let liveFetchPromise=null;
const dayCache=new Map();
const DAY_CACHE_MS=30*60*1000;
const resultCache=new Map();
const ARCHIVE_PREFIX="omegaplus-history";
const LOCAL_DATA_ROOT=process.env.DATA_DIR||"/data";
function archivePath(date,sport="football"){const suffix=sport==="football"?"":"-"+sport;return ARCHIVE_PREFIX+"/"+date.slice(0,4)+"/"+date.slice(5,7)+"/"+date.slice(8,10)+suffix+".json"}
function localArchivePath(date,sport="football"){const suffix=sport==="football"?"":"-"+sport;return path.join(LOCAL_DATA_ROOT,ARCHIVE_PREFIX,date.slice(0,4),date.slice(5,7),date.slice(8,10)+suffix+".json")}
const blobConfigured=Boolean(process.env.BLOB_READ_WRITE_TOKEN||(process.env.VERCEL_OIDC_TOKEN&&process.env.BLOB_STORE_ID));
async function readPersistentArchive(date,sport="football"){
  if(blobConfigured){try{const x=await get(archivePath(date,sport),{access:"private",useCache:false});return JSON.parse(await new Response(x.stream).text())}catch{}}
  try{return JSON.parse(await fs.readFile(localArchivePath(date,sport),"utf8"))}catch{return null}
}
async function writePersistentArchive(date,data,sport="football"){
  const payload=JSON.stringify(data);
  if(blobConfigured){try{return await put(archivePath(date,sport),payload,{access:"private",addRandomSuffix:false,allowOverwrite:true,contentType:"application/json"})}catch{}}
  const file=localArchivePath(date,sport);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,payload,"utf8");return {url:"local://"+file};
}


async function sportyFetch(pathname,options={}){
  const wait=Math.max(0,100-(Date.now()-lastSportyRequest));
  if(wait) await sleep(wait);
  lastSportyRequest=Date.now();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),6000);
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

async function getSportyFixtures(todayOnly=false,force=false,sport="football"){
  const sportDef=SPORTS.find(x=>x.id===sport)||SPORTS[0];
  const marketKey=sportDef.id==="football"?MARKET_IDS.join(","):"1";
  const cacheKey=sportDef.id+"|"+marketKey+"|"+(todayOnly?"today":"future");
  if(!force&&Date.now()-liveCache.at<30*60*1000&&liveCache.key===cacheKey) return liveCache.fixtures;
  if(liveFetchPromise) return liveFetchPromise;
  liveFetchPromise=(async()=>{
  const all=[],pageSize=100;
  for(let page=1;page<=(todayOnly?4:12);page++){
    const params=new URLSearchParams({sportId:sportDef.sportId,marketId:marketKey,pageSize:String(pageSize),pageNum:String(page),todayGames:String(todayOnly),timeline:todayOnly?"48":"720",_t:String(Date.now())});
    let body;
    try{
      body=await sportyFetch("/factsCenter/pcUpcomingEvents?"+params);
      if(sportDef.id!=="football" && !(body.data?.tournaments||[]).some(t=>(t.events||[]).length)){
        const unfiltered=new URLSearchParams(params);
        unfiltered.delete("marketId");
        body=await sportyFetch("/factsCenter/pcUpcomingEvents?"+unfiltered);
      }
    }catch(e){if(all.length) break;throw e}
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
              isActive:o.isActive===undefined?true:(typeof o.isActive==="boolean"?o.isActive:["1","true","active","open"].includes(String(o.isActive).toLowerCase()))
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
function isDirectWinningMarket(market){
  const name=normalizeText(market?.marketName);
  const id=String(market?.marketId||"");
  return id==="1"||["1x2","match result","winner","direct winning"].includes(name);
}
function marketMatches(market,type){
  const n=normalizeText(market.marketName),id=String(market.marketId||"");
  const has=(...terms)=>terms.some(x=>n.includes(normalizeText(x)));
  if(type==="basketball_total") return id==="225"||(has("over","under","total")&&!has("corner","card","booking"));
  if(type==="basketball_handicap") return id==="223"||has("handicap","spread");
  if(type==="basketball_moneyline") return id==="219"||has("winner","moneyline","match result");
  if(type==="basketball_team_total") return ["227","228"].includes(id)||has("team total","team points");
  if(type==="basketball_first_half_total") return has("first half","1st half","half total")&&has("over under","total");
  if(type==="basketball_first_half_moneyline") return has("first half","1st half")&&has("winner","moneyline","match result");
  if(type==="basketball_quarter_total") return has("quarter","q1","q2","q3","q4")&&has("over under","total");
  if(type==="table_tennis_moneyline") return has("winner","match winner","moneyline","to win");
  if(type==="table_tennis_total_points") return has("total points","points total","over under points","total games")||((has("over","under","total"))&&!has("goals","runs","sets","period"));
  if(type==="table_tennis_handicap") return has("points handicap","handicap","spread");
  if(type==="table_tennis_set_betting") return has("correct score","set betting","sets","exact score");
  if(type==="tennis_moneyline") return has("winner","match winner","moneyline","to win");
  if(type==="tennis_total_games") return has("total games","games total","over under games")||((has("over","under","total"))&&!has("points","goals","runs","sets","period"));
  if(type==="tennis_handicap") return has("games handicap","handicap","game spread");
  if(type==="tennis_set_betting") return has("set betting","correct score","sets");
  if(type==="hockey_moneyline") return has("moneyline","match result","winner","to win")&&!has("period");
  if(type==="hockey_total_goals") return has("goal","goals","total")&&has("over","under");
  if(type==="hockey_puck_line") return has("puck line","puck handicap","handicap");
  if(type==="hockey_period") return has("period","1st period","2nd period","3rd period")&&(has("winner","moneyline","result","over","under"));
  if(type==="baseball_moneyline") return has("moneyline","match result","winner","to win");
  if(type==="baseball_total_runs") return has("run","runs","total")&&has("over","under");
  if(type==="baseball_run_line") return has("run line","run handicap","handicap");
  if(type==="baseball_innings") return has("inning","innings")&&(has("over","under","winner","result"));

  if(type==="ou") return id==="18"||(has("goal","goals")&&has("over","under","total")&&!has("corner","corners","card","cards","booking","team"));
  if(type==="btts") return id==="29"||has("both teams to score","btts");
  if(type==="btts_goals") return has("btts","both teams")&&has("over","under")&&!has("corner","card","booking");
  if(type==="1x2") return id==="1"||has("1x2","match result","winner");
  if(type==="handicap") return ["14","16"].includes(id)||has("handicap","spread");
  if(type==="corners") return ["166","165","162"].includes(id)||has("corner");
  if(type==="team_corners") return has("corner")&&has("team");
  if(type==="cards") return ["139","138","900304","900305","900312"].includes(id)||has("booking","card");
  if(type==="team_cards") return has("card","booking")&&has("team");
  if(type==="double_chance") return ["10","11","12"].includes(id)||has("double chance","double result");
  if(type==="team_total") return ["20","21","22"].includes(id)||has("team total","team goals");
  if(type==="first_half_ou") return has("first half","1st half","half total","total goals");
  if(type==="half_time_result") return has("half time","half-time","ht result");
  return false;
}
function directWinningSelectionRequested(outcome,requested){
  const req=normalizeText(requested);
  const raw=normalizeText(outcome?.outcomeName);
  if(!req) return true;
  if(req==="home"||req==="1"||req==="player 1") return raw==="home"||raw==="1"||raw.includes("home team");
  if(req==="draw"||req==="x") return raw==="draw"||raw==="x"||raw.includes("tie");
  if(req==="away"||req==="2"||req==="player 2") return raw==="away"||raw==="2"||raw.includes("away team");
  return raw===req;
}
function confidenceForOutcome(market,outcome){
  const active=market.outcomes.filter(o=>o.isActive!==false&&Number.isFinite(Number(o.odds))&&Number(o.odds)>1);
  if(!active.length||!Number.isFinite(outcome.odds)||outcome.odds<=1) return 0;
  const inv=1/outcome.odds,total=active.reduce((s,o)=>s+1/o.odds,0),normalized=total?inv/total:inv;
  return Math.round(Math.max(50,Math.min(99,normalized*100)));
}

function qualityGrade(p){
  const c=Number(p?.confidence)||0;
  if(c>=92&&p?.independentConfidence!=null)return "A+";
  if(c>=86)return "A";
  if(c>=76)return "B";
  if(c>=66)return "C";
  return "D";
}
function predictionReasons(p){
  const reasons=[];
  const market=Number(p?.marketConfidence), independent=Number(p?.independentConfidence);
  if(Number.isFinite(market)) reasons.push("Market probability signal: "+Math.round(market)+"%.");
  if(p?.independentConfidence!=null&&Number.isFinite(independent)) reasons.push("Independent statistics signal: "+Math.round(independent)+"%.");
  const sources=Array.isArray(p?.independentSources)?p.independentSources:[];
  if(sources.length) reasons.push("Independent sources: "+sources.join(", ")+".");
  const form=p?.independentStats?.sofascore?.form;
  if(form){
    const vals=[];
    if(Number.isFinite(form.homeOver15)&&Number.isFinite(form.awayOver15)) vals.push("recent Over 1.5 rate "+Math.round(((form.homeOver15+form.awayOver15)/2)*100)+"%");
    if(Number.isFinite(form.homeOver25)&&Number.isFinite(form.awayOver25)) vals.push("recent Over 2.5 rate "+Math.round(((form.homeOver25+form.awayOver25)/2)*100)+"%");
    if(Number.isFinite(form.homeBtts)&&Number.isFinite(form.awayBtts)) vals.push("recent BTTS rate "+Math.round(((form.homeBtts+form.awayBtts)/2)*100)+"%");
    if(vals.length) reasons.push("Recent team-form indicators: "+vals.join(", ")+".");
  }
  const uh=p?.independentStats?.understat?.home,ua=p?.independentStats?.understat?.away;
  if(uh?.xg!=null&&ua?.xg!=null) reasons.push("Recent Understat xG averages: "+Number(uh.xg).toFixed(2)+" home, "+Number(ua.xg).toFixed(2)+" away.");
  if(Number.isFinite(Number(p?.odds))) reasons.push("Current odds: "+Number(p.odds).toFixed(2)+".");
  if(!reasons.length) reasons.push("Live market model ranking; independent data was unavailable for this fixture.");
  return reasons;
}
function decoratePredictions(rows){
  return (Array.isArray(rows)?rows:[]).map(p=>({...p,modelProbability:p.independentConfidence!=null&&Number.isFinite(Number(p.independentConfidence))?Number(p.independentConfidence):Number(p.marketConfidence??p.confidence??0),qualityGrade:qualityGrade(p),reasons:predictionReasons(p)}));
}
function marketLine(value){
  const s=String(value||"").toLowerCase();
  const m=s.match(/(?:over|under|1h_over|1h_under|q[1-4]_over|q[1-4]_under|btts_over|btts_under|home_over|away_over|home_corners|away_corners|home_cards|away_cards)_(\d+)_(\d+)/);
  return m?m[1]+"."+m[2]:(String(value||"").match(/\d+(?:\.\d+)?/)||[])[0]||"";
}
function pickLabel(type,outcome){
  const raw=String(outcome?.outcomeName||"");
  const spec=String(outcome?.specifier||"");
  const line=(spec.match(/[0-9]+(?:\.[0-9]+)?/)||[])[0]||"";
  const direction=/\bunder\b/i.test(raw)?"Under":/\bover\b/i.test(raw)?"Over":"";
  if(["ou","corners","cards","first_half_ou","basketball_total","basketball_first_half_total","basketball_quarter_total"].includes(type)){
    const prefix=type==="first_half_ou"||type==="basketball_first_half_total"?"1H ":type==="basketball_quarter_total"?(String(raw).match(/Q[1-4]/i)?.[0]?.toUpperCase()+" "||""):"";
    return direction&&line?prefix+direction+" "+line:(raw||"Over/Under");
  }
  if(type==="btts_goals"){
    const dir=/\bunder\b/i.test(raw)?"Under":"Over";
    return "BTTS "+dir+" "+line;
  }
  if(type==="btts") return /no/i.test(raw)?"No":"Yes";
  if(type==="half_time_result"){
    const x=raw.toLowerCase();
    return x.includes("home")?"HT Home":x.includes("draw")?"HT Draw":x.includes("away")?"HT Away":raw;
  }
  return raw||(type==="1x2"?"1X2":type==="btts"?"BTTS":type==="corners"?"Corners":type==="cards"?"Bookings":type==="handicap"?"Handicap":"Over/Under");
}
function selectionRequested(outcome,requested,market,type=""){
  const req=String(requested||"");
  const parts=req.split("::");
  const requestedMarket=parts.length>1?parts[0]:"";
  const requestedKey=parts.length>1?parts.slice(1).join("::"):"";
  const label=parts.length>1?String(parts[1]||""):req;
  if(requestedMarket&&requestedMarket!==String(type||""))return false;
  const n=normalizeText(market?.marketName), raw=normalizeText(outcome?.outcomeName);
  const spec=normalizeText(market?.specifier);
  const line=marketLine(requestedKey||label);
  const has=(...terms)=>terms.some(x=>n.includes(normalizeText(x)));
  const actualLine=(spec.match(/[0-9]+(?:\.[0-9]+)?/)||n.match(/[0-9]+(?:\.[0-9]+)?/)||raw.match(/[0-9]+(?:\.[0-9]+)?/)||[])[0]||"";
  const direction=/\bunder\b/.test(normalizeText(requestedKey+" "+label))?"under":/\bover\b/.test(normalizeText(requestedKey+" "+label))?"over":"";
  if(type==="ou"){
    if(!(String(market?.marketId)==="18" || (has("goal","goals")&&has("over","under","total"))))return false;
    return Boolean(direction&&actualLine===line&&raw.includes(direction));
  }
  if(type==="cards"){
    if(!(["139","138","900304","900305","900312"].includes(String(market?.marketId))||has("card","booking")))return false;
    return Boolean(direction&&actualLine===line&&raw.includes(direction));
  }
  if(type==="corners"){
    if(!(["166","165","162"].includes(String(market?.marketId))||has("corner")))return false;
    return Boolean(direction&&actualLine===line&&raw.includes(direction));
  }
  if(type==="btts"){
    if(!(String(market?.marketId)==="29"||has("both teams to score","btts")))return false;
    return label.toLowerCase().endsWith("yes")?(raw==="yes"||raw.includes("goal goal")):(raw==="no"||raw.includes("no"));
  }
  if(type==="btts_goals"){
    if(!(has("btts","both teams")&&has("over","under")))return false;
    if(line&&actualLine!==line)return false;
    const wantsUnder=/under/.test(normalizeText(requestedKey+" "+label));
    const wantsOver=/over/.test(normalizeText(requestedKey+" "+label));
    if(wantsUnder&&!raw.includes("under"))return false;
    if(wantsOver&&!raw.includes("over")&&!raw.includes("yes")&&!raw.includes("goal goal"))return false;
    return raw==="yes"||raw.includes("goal goal")||raw.includes("over")||raw.includes("under");
  }
  if(type==="team_total"){
    if(!(has("team total","team goals")||["20","21","22"].includes(String(market?.marketId))))return false;
    const side=label.toLowerCase().startsWith("home")?"home":label.toLowerCase().startsWith("away")?"away":"";
    return Boolean(side&&direction&&actualLine===line&&raw.includes(direction)&&(raw.includes(side)||spec.includes(side)||n.includes(side)));
  }
  if(type==="team_corners"){
    if(!has("corner"))return false;
    const side=label.toLowerCase().startsWith("home")?"home":label.toLowerCase().startsWith("away")?"away":"";
    return Boolean(side&&direction&&actualLine===line&&raw.includes(direction)&&(raw.includes(side)||spec.includes(side)||n.includes(side)));
  }
  if(type==="team_cards"){
    if(!(has("card","booking")))return false;
    const side=label.toLowerCase().startsWith("home")?"home":label.toLowerCase().startsWith("away")?"away":"";
    return Boolean(side&&direction&&actualLine===line&&raw.includes(direction)&&(raw.includes(side)||spec.includes(side)||n.includes(side)));
  }
  if(type==="first_half_ou"){
    if(!(has("first half","1st half","half total")&&has("goal","goals","total")))return false;
    return Boolean(direction&&actualLine===line&&raw.includes(direction));
  }
  if(type==="half_time_result"){
    if(!has("half time","half-time","ht"))return false;
    const want=normalizeText(label).replace(/^ht\s*/,"");
    return raw===want||raw.includes(want);
  }
  if(type==="double_chance"){
    if(!(has("double chance","double result")||["10","11","12"].includes(String(market?.marketId))))return false;
    const map={home_or_draw:["home","draw"],home_or_away:["home","away"],draw_or_away:["draw","away"]};
    const want=map[requestedKey]||[];
    return want.length===2&&want.every(x=>raw.includes(x)||(x==="draw"&&raw==="x"));
  }
  if(type==="1x2"){
    if(!(String(market?.marketId)==="1"||has("1x2","match result","winner")))return false;
    return directWinningSelectionRequested(outcome,label);
  }
  if(type==="handicap"){
    if(!(has("handicap","spread")||["14","16"].includes(String(market?.marketId))))return false;
    const want=normalizeText(label);
    return raw===want||raw.includes(want);
  }
  if(type==="table_tennis_total_points"){
    const range=String(requestedKey||label).match(/^(over|under)_range_(\d+)_([0-9]+)_(\d+)_([0-9]+)$/);
    if(range){const low=Number(range[2]+"."+range[3]),high=Number(range[4]+"."+range[5]),actual=Number(actualLine);return Number.isFinite(actual)&&actual>=low&&actual<=high&&raw.includes(range[1]);}
    if(line&&actualLine!==line)return false;
    return Boolean(direction&&raw.includes(direction));
  }
  if(["tennis_total_games","hockey_total_goals","baseball_total_runs"].includes(type)){
    if(line&&actualLine!==line)return false;
    return Boolean(direction&&raw.includes(direction));
  }
  if(["table_tennis_moneyline","tennis_moneyline","hockey_moneyline","baseball_moneyline"].includes(type)){
    return directWinningSelectionRequested(outcome,label);
  }
  if(["table_tennis_handicap","table_tennis_set_betting","tennis_handicap","hockey_puck_line","baseball_run_line","tennis_set_betting","hockey_period","baseball_innings"].includes(type)){
    const want=normalizeText(label);
    return raw===want||raw.includes(want);
  }
  if(type==="basketball_total"||type==="basketball_first_half_total"||type==="basketball_quarter_total"){
    if(!has("over","under","total"))return false;
    return Boolean(direction&&actualLine===line&&raw.includes(direction));
  }
  if(type==="basketball_team_total"){
    if(!has("team total","total points"))return false;
    return Boolean(direction&&actualLine===line&&raw.includes(direction));
  }
  if(["tennis_moneyline","tennis_total_games","tennis_handicap","tennis_set_betting","hockey_moneyline","hockey_total_goals","hockey_puck_line","hockey_period","baseball_moneyline","baseball_total_runs","baseball_run_line","baseball_innings"].includes(type)){
    if(["tennis_total_games","hockey_total_goals","baseball_total_runs"].includes(type)){
      return direction&&line?direction+" "+line:raw;
    }
    return raw;
  }
  if(type==="basketball_handicap"||type==="basketball_moneyline"||type==="basketball_first_half_moneyline"){
    const want=normalizeText(label);
    return has("winner","moneyline","match result","handicap","spread")&&(raw===want||raw.includes(want));
  }
  return false;
}
const TABLE_TENNIS_LEAGUE_CATALOG=[["WTT","International"],["ITTF World Championships","International"],["WTT Champions","International"],["WTT Contender","International"],["European Championships","Europe"],["Olympic Games","International"]];\nconst TENNIS_LEAGUE_CATALOG=[
  ["ATP","International"],["WTA","International"],["ATP Challenger","International"],["WTA 125","International"],["ITF Men","International"],["ITF Women","International"]
];
const ICE_HOCKEY_LEAGUE_CATALOG=[
  ["NHL","USA"],["AHL","USA"],["KHL","Europe"],["SHL","Sweden"],["Liiga","Finland"],["DEL","Germany"],["Extraliga","Czech Republic"],["National League","Switzerland"]
];
const BASEBALL_LEAGUE_CATALOG=[
  ["MLB","USA"],["NPB","Japan"],["KBO","South Korea"],["CPBL","Taiwan"],["MiLB","USA"],["World Baseball Classic","International"]
];
function sportLeagueCatalog(sport){
  if(sport==="basketball") return BASKETBALL_LEAGUE_CATALOG;
  if(sport==="tennis") return TENNIS_LEAGUE_CATALOG;\n  if(sport==="table_tennis") return TABLE_TENNIS_LEAGUE_CATALOG;
  if(sport==="ice_hockey") return ICE_HOCKEY_LEAGUE_CATALOG;
  if(sport==="baseball") return BASEBALL_LEAGUE_CATALOG;
  return TOP_LEAGUE_CATALOG;
}
const BASKETBALL_LEAGUE_CATALOG=[
  ["NBA","USA"],["WNBA","USA"],["NBA G League","USA"],["NCAA","USA"],["EuroLeague","Europe"],["EuroCup","Europe"],["ACB","Spain"],["BBL","United Kingdom"],["LNB Pro A","France"],["BBL Germany","Germany"],["Lega Basket Serie A","Italy"],["BSL","Turkey"],["NBL","Australia"],["CBA","China"],["B.League","Japan"]
];
const TOP_LEAGUE_CATALOG=[
  ["Africa Cup of Nations Qualification","Africa"],
  ["UEFA Nations League","Europe"],
  ["Int. Friendly Games","International"],
  ["MLS","USA"],
  ["Liga MX","Mexico"],
  ["Premier League","England"],
  ["LaLiga","Spain"],
  ["Serie A","Italy"],
  ["Bundesliga","Germany"],
  ["Ligue 1","France"],
  ["Liga Portugal","Portugal"],
  ["Eredivisie","Netherlands"],
  ["Super Lig","Turkey"],
  ["Championship","England"],
  ["Saudi Pro League","Saudi Arabia"],
  ["Brasileiro Serie A","Brazil"],
  ["J1 League","Japan"],
  ["K-League 1","South Korea"],
  ["Chinese Super League","China"],
  ["UEFA Champions League","Europe"],
  ["UEFA Europa League","Europe"],
  ["UEFA Conference League","Europe"],
  ["CONMEBOL Libertadores","South America"],
  ["CONMEBOL Sudamericana","South America"]
];
const TOP_LEAGUE_KEYS=TOP_LEAGUE_CATALOG.map(([name])=>normalizeText(name));
function topLeagueIndex(name){
  const n=normalizeText(name);
  return TOP_LEAGUE_KEYS.findIndex(k=>n===k);
}
function leagueRank(name){
  const topIndex=topLeagueIndex(name);
  if(topIndex>=0) return topIndex;
  return 300;
}
function sortLeagues(a,b){
  const ra=leagueRank(a),rb=leagueRank(b);
  if(ra!==rb) return ra-rb;
  return a.localeCompare(b);
}

app.get("/api/release/status",async(_,r)=>{
  r.json({ok:true,appId:APP_ID,version:APP_VERSION,versionCode:APP_VERSION_CODE,targetSdk:ANDROID_TARGET_SDK,minSupportedVersion:MIN_SUPPORTED_WEB_VERSION,updateMode:"web-server-first",nativeUpdateRequired:false,playStoreUrl:"https://play.google.com/store/apps/details?id="+APP_ID,releaseChannel:"production",generatedAt:new Date().toISOString()});
});
app.get("/api/admin/release-check",requireRole("admin"),async(req,r)=>{
  try{
    const dbConfigured=authDbConfigured(),dbReadyNow=await dbReady();
    let adminCount=0;
    try{
      const users=await adminUsers({page:1,limit:100,search:""});
      adminCount=(users?.users||users||[]).filter(x=>String(x.role||"").toLowerCase()==="admin").length;
    }catch{}
    const checks={databaseConfigured:dbConfigured,databaseReady:dbReadyNow,adminAccountPresent:adminCount>0,productionVersion:APP_VERSION,appId:APP_ID,versionCode:APP_VERSION_CODE};
    const passed=Boolean(dbConfigured&&dbReadyNow&&adminCount>0);
    await audit(req,"admin.release.check",null,{passed,checks});
    r.status(passed?200:503).json({ok:passed,releaseReady:passed,checks});
  }catch(e){r.status(503).json({ok:false,releaseReady:false,error:e.message})}
});
app.get("/api/sports",(_,r)=>r.json({ok:true,sports:SPORTS}));
app.get("/health",(_,r)=>r.status(200).json({status:"healthy",service:"omegaplus-pro-ai",version:APP_VERSION,uptime:Math.round(process.uptime())}));
app.get("/api/health",async(_,r)=>{const stats=await independentHealth();r.json({ok:true,service:"Omegaplus Pro AI",version:APP_VERSION,branch:"main",liveSportyBet:true,accountSystem:{configured:authDbConfigured(),ready:await dbReady()},independentStats:stats,multiBookmaker:BOOKMAKERS.map(x=>({id:x.id,name:x.name,codeGeneration:x.id==="sportybet"||Boolean(BETRELAY_API_KEY)}))})});
app.get("/api/auth/me",async(req,r)=>{try{const user=await currentUser(req);r.json({ok:Boolean(user),user:user||null})}catch{r.json({ok:false,user:null})}});
app.post("/api/auth/register",async(req,r)=>{try{if(!(await getAdminSettings()).registrationEnabled)return r.status(403).json({ok:false,error:"New registration is currently disabled by the administrator."});const user=await registerUser(req.body||{},req);const session=await (await import("./auth.js")).createSession(user,req);setSessionCookie(r,session.token);r.status(201).json({ok:true,user})}catch(e){r.status(400).json({ok:false,error:e.message})}});
app.post("/api/auth/login",async(req,r)=>{try{const x=await loginUser(req.body||{},req);setSessionCookie(r,x.session.token);r.json({ok:true,user:x.user})}catch(e){r.status(401).json({ok:false,error:e.message})}});
app.post("/api/auth/logout",async(req,r)=>{try{await logoutUser(req);clearSessionCookie(r);r.json({ok:true})}catch{clearSessionCookie(r);r.json({ok:true})}});
app.get("/api/plans",async(_,r)=>{try{r.json({ok:true,plans:await listPlans()})}catch(e){r.status(503).json({ok:false,error:e.message,plans:[]})}});

app.get("/api/account",requireAuth,async(req,r)=>{try{r.json({ok:true,user:req.user,payments:await paymentHistory(req.user.id),access:await getAccessSettings()})}catch(e){r.status(503).json({ok:false,error:e.message})}});
app.get("/api/subscription/settings",async(_,r)=>{try{r.json({ok:true,settings:await getAccessSettings()})}catch(e){r.status(503).json({ok:false,error:e.message})}});
app.post("/api/payments/paystack/initialize",requireAuth,async(req,r)=>{
  try{
    const key=process.env.PAYSTACK_SECRET_KEY||"";
    if(!key)return r.status(503).json({ok:false,error:"Online payment is not configured yet. The administrator must add PAYSTACK_SECRET_KEY."});
    const planId=String(req.body?.plan||"pro");
    const plans=await listPlans();
    const plan=plans.find(x=>x.id===planId&&x.is_active&&x.price_ngn>0);
    if(!plan)throw new Error("Selected paid plan is unavailable.");
    const callbackUrl=String(req.body?.callbackUrl||process.env.PAYSTACK_CALLBACK_URL||"").trim()||null;
    const payload={email:req.user.email,amount:Math.round(Number(plan.price_ngn)*100),metadata:{userId:req.user.id,planId,planName:plan.name}};
    if(callbackUrl)payload.callback_url=callbackUrl;
    if(plan.paystack_plan_code)payload.plan=plan.paystack_plan_code;
    const response=await fetch("https://api.paystack.co/transaction/initialize",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.status)throw new Error(data.message||"Paystack could not initialize the payment.");
    await createPaymentRecord({userId:req.user.id,planId,provider:"paystack",reference:data.data?.reference,amountNgn:plan.price_ngn,status:"pending",metadata:{accessCode:data.data?.access_code||null}});
    await audit(req,"payment.initialize",planId,{provider:"paystack",reference:data.data?.reference||null});
    r.json({ok:true,authorizationUrl:data.data?.authorization_url,reference:data.data?.reference,planId});
  }catch(e){r.status(400).json({ok:false,error:e.message})}
});
app.get("/api/payments/paystack/verify/:reference",requireAuth,async(req,r)=>{
  try{
    const key=process.env.PAYSTACK_SECRET_KEY||"";
    if(!key)return r.status(503).json({ok:false,error:"Paystack is not configured."});
    const reference=String(req.params.reference||"");
    const response=await fetch("https://api.paystack.co/transaction/verify/"+encodeURIComponent(reference),{headers:{Authorization:"Bearer "+key}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.status||data.data?.status!=="success")throw new Error(data.message||"Payment has not been confirmed.");
    const meta=data.data?.metadata||{};
    if(String(meta.userId)!==String(req.user.id))throw new Error("Payment account mismatch.");
    const planId=String(meta.planId||"");
    const plan=(await listPlans()).find(x=>x.id===planId&&x.price_ngn>0);
    if(!plan)throw new Error("Paid plan not found.");
    const sub=await activateProviderSubscription(req.user.id,planId,"paystack",reference,30,{amountNgn:plan.price_ngn,channel:data.data?.channel,paidAt:data.data?.paid_at,transactionId:data.data?.id});
    await audit(req,"payment.verified",reference,{provider:"paystack",planId});
    r.json({ok:true,subscription:sub,user:await currentUser(req)});
  }catch(e){r.status(400).json({ok:false,error:e.message})}
});
app.post("/api/payments/paystack/webhook",async(req,r)=>{
  const signature=String(req.headers["x-paystack-signature"]||"");
  const secret=process.env.PAYSTACK_SECRET_KEY||"";
  if(!secret||!signature||!req.rawBody)return r.status(401).send("Unauthorized");
  const expected=crypto.createHmac("sha512",secret).update(req.rawBody).digest("hex");
  if(!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return r.status(401).send("Invalid signature");
  r.sendStatus(200);
  const event=req.body||{};
  try{
    if(event.event==="charge.success"){
      const meta=event.data?.metadata||{},userId=String(meta.userId||""),planId=String(meta.planId||"");
      if(userId&&planId){
        const plans=await listPlans(),plan=plans.find(x=>x.id===planId&&x.price_ngn>0);
        if(plan)await activateProviderSubscription(userId,planId,"paystack",String(event.data?.reference||""),30,{amountNgn:plan.price_ngn,channel:event.data?.channel,paidAt:event.data?.paid_at,webhookEvent:event.event});
      }
    }
  }catch(e){console.error("Paystack webhook processing failed:",e.message)}
});

app.get("/api/admin/system-settings",requireRole("admin"),async(_,r)=>{try{r.json({ok:true,settings:await getAdminSettings()})}catch(e){r.status(503).json({ok:false,error:e.message})}});
app.patch("/api/admin/system-settings",requireRole("admin"),async(req,r)=>{try{const settings=await updateAdminSettings(req.body||{});await audit(req,"admin.system-settings.update","system",settings);r.json({ok:true,settings})}catch(e){r.status(400).json({ok:false,error:e.message})}});
app.post("/api/admin/create-admin",requireRole("admin"),async(req,r)=>{try{const user=await createAdminUser(req.body||{},req);r.status(201).json({ok:true,user})}catch(e){r.status(400).json({ok:false,error:e.message})}});
app.get("/api/admin/stats",requireRole("admin"),async(_,r)=>{try{r.json({ok:true,stats:await adminStats()})}catch(e){r.status(503).json({ok:false,error:e.message})}});
app.get("/api/admin/users",requireRole("admin"),async(req,r)=>{try{r.json({ok:true,users:await adminUsers({page:req.query.page,limit:req.query.limit,search:req.query.search})})}catch(e){r.status(503).json({ok:false,error:e.message,users:[]})}});
app.patch("/api/admin/users/:id",requireRole("admin"),async(req,r)=>{try{const user=await setUserAccess(req.params.id,req.body||{});await audit(req,"admin.user.update",req.params.id,{changes:req.body||{}});r.json({ok:true,user})}catch(e){r.status(400).json({ok:false,error:e.message})}});
app.post("/api/admin/users/:id/subscription",requireRole("admin"),async(req,r)=>{try{const plan=String(req.body?.plan||"pro"),days=Math.max(1,Math.min(3650,Number(req.body?.days)||30));const sub=await activateSubscription(req.params.id,plan,days,"admin");await audit(req,"admin.subscription.activate",req.params.id,{plan,days,grantedByAdmin:true});r.json({ok:true,subscription:sub,grantedByAdmin:true})}catch(e){r.status(400).json({ok:false,error:e.message})}});
app.post("/api/admin/plans",requireRole("admin"),async(req,r)=>{try{const plan=await createOrUpdatePlan(req.body||{});await audit(req,"admin.plan.update",String(req.body?.id||""),req.body||{});r.json({ok:true,plan})}catch(e){r.status(400).json({ok:false,error:e.message})}});
app.get("/api/admin/access-settings",requireRole("admin"),async(_,r)=>{try{r.json({ok:true,settings:await getAccessSettings()})}catch(e){r.status(503).json({ok:false,error:e.message})}});
app.patch("/api/admin/access-settings",requireRole("admin"),async(req,r)=>{try{const settings=await updateAccessSettings(req.body||{});await audit(req,"admin.access_settings.update","app",settings);r.json({ok:true,settings})}catch(e){r.status(400).json({ok:false,error:e.message})}});
app.post("/api/admin/users/:id/free-trial",requireRole("admin"),async(req,r)=>{try{const days=Math.max(1,Math.min(365,Number(req.body?.days)||3));const sub=await grantFreeTrial(req.params.id,days);await audit(req,"admin.free_trial.grant",req.params.id,{days});r.json({ok:true,subscription:sub})}catch(e){r.status(400).json({ok:false,error:e.message})}});

app.get("/api/stats/status",async(_,r)=>{try{const x=await independentHealth();r.json({ok:true,providers:{Sofascore:{configured:x.sofascore,role:"fixtures, form, match statistics, standings-compatible data"},Understat:{configured:x.understat,role:"xG, xGA, shot-quality data",coverage:["Premier League","LaLiga","Serie A","Bundesliga","Ligue 1"]},Sportmonks:{configured:Boolean(process.env.SPORTMONKS_API_TOKEN),role:"supplementary results/statistics where subscription covers the league"}}})}catch(e){r.status(200).json({ok:false,error:e.message})}});
app.get("/api/bookmakers",(_,r)=>r.json({ok:true,bookmakers:BOOKMAKERS.map(x=>({id:x.id,name:x.name,codeGeneration:x.id==="sportybet"||Boolean(BETRELAY_API_KEY),method:x.id==="sportybet"?"native":"SportyBet→BetRelay"})),configured:Boolean(BETRELAY_API_KEY)}));

app.get("/api/markets",(_,r)=>r.json({markets:[
  {id:"ou",name:"Goals Over/Under",type:"ou"},{id:"1x2",name:"1X2",type:"1x2"},
  {id:"btts",name:"BTTS",type:"btts"},{id:"handicap",name:"Handicap",type:"handicap"},
  {id:"corners",name:"Corners Over/Under",type:"corners"},{id:"cards",name:"Cards/Bookings Over/Under",type:"cards"},
  {id:"basketball_total",name:"Points Over/Under",type:"basketball_total"},
  {id:"basketball_handicap",name:"Basketball Handicap / Spread",type:"basketball_handicap"},
  {id:"basketball_moneyline",name:"Basketball Winner",type:"basketball_moneyline"},
  {id:"basketball_team_total",name:"Team Total Points",type:"basketball_team_total"}
]}));

async function getDayFixtures(date,force=false,sport="football"){
  const cacheKey=date+"|"+(SPORTS.find(x=>x.id===sport)?.id||"football");
  const hit=dayCache.get(cacheKey);
  if(!force&&hit&&Date.now()-hit.at<DAY_CACHE_MS)return {fixtures:hit.fixtures,cached:true,scannedAt:hit.at};
  const fixtures=await getSportyFixtures(date===localDayKey(Date.now()),force,sport);
  const day=fixtures.filter(x=>localDayKey(x.startTimeMs)===date);
  dayCache.set(cacheKey,{at:Date.now(),fixtures:day});
  return {fixtures:day,cached:false,scannedAt:Date.now()};
}

app.get("/api/scan",async(req,r)=>{
  try{const sport=String(req.query.sport||"football");const date=String(req.query.date||localDayKey(Date.now()));const x=await getDayFixtures(date,true,sport);r.json({ok:true,date,sport,cached:false,scannedAt:x.scannedAt,fixtureCount:x.fixtures.length,leagues:[...new Set(x.fixtures.map(f=>f.league).filter(Boolean))].sort(sortLeagues)});}catch(e){r.status(502).json({ok:false,error:e.message})}
});
app.get("/api/history",async(req,r)=>{try{const sport=String(req.query.sport||"football");const date=String(req.query.date||localDayKey(Date.now()));const archive=await readPersistentArchive(date,sport);r.json({ok:true,date,found:Boolean(archive),archive:archive||null,storage:"vercel-blob"})}catch(e){r.status(500).json({ok:false,error:e.message,archive:null})}});
app.post("/api/history",async(req,r)=>{try{const sport=String(req.body?.sport||"football");const date=String(req.body?.date||localDayKey(Date.now()));const old=await readPersistentArchive(date,sport)||{date,sport,predictions:[],results:[]};const next={...old};if(Array.isArray(req.body?.predictions))next.predictions=req.body.predictions.slice(0,10);if(Array.isArray(req.body?.correctScores))next.correctScores=req.body.correctScores.slice(0,5);if(Array.isArray(req.body?.results))next.results=req.body.results;next.updatedAt=new Date().toISOString();if(!next.savedAt)next.savedAt=next.updatedAt;await writePersistentArchive(date,next,sport);r.json({ok:true,date,sport,archive:next,storage:"vercel-blob"})}catch(e){r.status(500).json({ok:false,error:e.message})}});
app.get("/api/results/status",async(req,r)=>{try{const sport=String(req.query.sport||"football");const x=await getVerifiedResults(localDayKey(Date.now()),false,sport);r.json({ok:true,configured:x.sources.sportmonks,providers:x.sources,verification:"Sportmonks + Sofascore agreement required for settlement",cacheSeconds:15});}catch(e){r.json({ok:true,configured:Boolean(process.env.SPORTMONKS_API_TOKEN),providers:{sportmonks:Boolean(process.env.SPORTMONKS_API_TOKEN),sofascore:true},verification:"Multi-source verification unavailable: "+e.message})}});
app.get("/api/results/leagues",async(_,r)=>{try{const x=await getMyLeagues();if(!x.configured)return r.status(503).json({ok:false,configured:false,error:x.error,leagues:[]});r.json({ok:true,configured:true,provider:"Sportmonks",count:x.data.length,leagues:x.data.map(l=>({id:l.id,name:l.name,countryId:l.country_id,active:l.active}))})}catch(e){r.status(502).json({ok:false,configured:true,provider:"Sportmonks",error:e.message,leagues:[]})}});
app.get("/api/results",async(req,r)=>{
  try{const date=String(req.query.date||localDayKey(Date.now()));const sport=String(req.query.sport||"football");const force=String(req.query.refresh||"") === "1";const x=await getVerifiedResults(date,force,sport);r.json({ok:true,configured:x.sources.sportmonks,providers:x.sources,verification:"confirmed only when Sportmonks and Sofascore agree",date,results:x.results,updatedAt:x.updatedAt});}
  catch(e){r.status(502).json({ok:false,configured:false,providers:{sportmonks:Boolean(process.env.SPORTMONKS_API_TOKEN),sofascore:true},error:e.message,results:[]})}
});
app.get("/api/results/live",async(req,r)=>{try{const sport=String(req.query.sport||"football");const x=await getVerifiedLiveResults(sport);r.json({ok:true,configured:x.sources.sportmonks,providers:x.sources,results:x.results,updatedAt:x.updatedAt});}catch(e){r.status(502).json({ok:false,configured:false,error:e.message,results:[]})}});

function leagueCountry(name,category=""){
  const c=String(category||"").trim();
  if(c) return c;
  const topIndex=topLeagueIndex(name);
  if(topIndex>=0) return TOP_LEAGUE_CATALOG[topIndex][1];
  return "International";
}
function leagueGroup(name,category=""){
  if(topLeagueIndex(name)>=0) return "Top Leagues";
  return "Other Leagues";
}
const leagueCountCache=new Map();
const leagueCountPromises=new Map();
const LEAGUE_COUNT_CACHE_MS=30*60*1000;

async function getLeagueCountFixtures(date,sport="football"){
  const sportDef=SPORTS.find(x=>x.id===sport)||SPORTS[0];
  const cacheKey=date+"|"+sportDef.id;
  const hit=leagueCountCache.get(cacheKey);
  if(hit&&Date.now()-hit.at<LEAGUE_COUNT_CACHE_MS)return {fixtures:hit.fixtures,cached:true};
  const running=leagueCountPromises.get(cacheKey);
  if(running)return running;
  const promise=(async()=>{
    const all=[];
    const pageSize=100;
    const marketId="1";
    for(let page=1;page<=12;page++){
      const params=new URLSearchParams({
        sportId:sportDef.sportId,
        marketId,
        pageSize:String(pageSize),
        pageNum:String(page),
        todayGames:"false",
        timeline:"720",
        _t:String(Date.now())
      });
      let body;
      try{body=await sportyFetch("/factsCenter/pcUpcomingEvents?"+params)}catch(e){
        if(all.length)break;
        throw e;
      }
      const tournaments=body.data?.tournaments||[];
      let pageCount=0;
      let pageMin=Infinity,pageMax=-Infinity;
      for(const tournament of tournaments){
        for(const event of tournament.events||[]){
          pageCount++;
          const startTimeMs=Number(event.estimateStartTime||0);
          if(Number.isFinite(startTimeMs)&&startTimeMs>0){
            pageMin=Math.min(pageMin,startTimeMs);
            pageMax=Math.max(pageMax,startTimeMs);
          }
          all.push({
            eventId:String(event.eventId||""),
            league:String(tournament.name||""),
            category:String(tournament.categoryName||""),
            startTimeMs
          });
        }
      }
      if(pageCount<pageSize)break;
      if(Number.isFinite(pageMax)&&pageMax>0){
        const maxDate=localDayKey(pageMax);
        const minDate=Number.isFinite(pageMin)&&pageMin>0?localDayKey(pageMin):"";
        if(maxDate>date&&minDate>date)break;
        if(maxDate===date)break;
      }
    }
    const fixtures=all.filter(x=>localDayKey(x.startTimeMs)===date);
    leagueCountCache.set(cacheKey,{at:Date.now(),fixtures});
    return {fixtures,cached:false};
  })();
  leagueCountPromises.set(cacheKey,promise);
  try{return await promise}finally{leagueCountPromises.delete(cacheKey)}
}

app.get("/api/leagues",async(req,r)=>{
  const sport=String(req.query.sport||"football");
  const requestedDate=String(req.query.date||localDayKey(Date.now()));
  const includeCounts=String(req.query.counts||"1")!=="0";
  try{
    const cacheKey=requestedDate+"|"+(SPORTS.find(x=>x.id===sport)?.id||"football");
    let fixtures=[];
    let cached=false;
    if(includeCounts){
      const dayHit=dayCache.get(cacheKey);
      if(dayHit&&Date.now()-dayHit.at<DAY_CACHE_MS){
        fixtures=dayHit.fixtures||[];
        cached=true;
      }else{
        const loaded=await getLeagueCountFixtures(requestedDate,sport);
        fixtures=loaded.fixtures||[];
        cached=Boolean(loaded.cached);
      }
    }
    const map=new Map();
    const catalog=sportLeagueCatalog(sport);
    for(const [name,country] of catalog){
      const key=name+"|||"+country;
      map.set(key,{name,country,group:"Top Leagues",key,count:includeCounts?0:null});
    }
    if(includeCounts){
      for(const f of fixtures){
        if(!f.league)continue;
        const actualCountry=leagueCountry(f.league,f.category);
        const topIndex=topLeagueIndex(f.league);
        if(topIndex>=0){
          const [name,country]=TOP_LEAGUE_CATALOG[topIndex];
          if(normalizeText(actualCountry)===normalizeText(country)){
            const key=name+"|||"+country;
            const item=map.get(key);
            if(item)item.count++;
            continue;
          }
        }
        const key=f.league+"|||"+actualCountry;
        if(!map.has(key))map.set(key,{name:f.league,country:actualCountry,group:"Other Leagues",key,count:1});
        else map.get(key).count++;
      }
    }
    const leagues=[...map.values()].sort((a,b)=>{
      const ga=["Top Leagues","European Competitions","International","Other Leagues"];
      const ai=ga.indexOf(a.group),bi=ga.indexOf(b.group);
      return (ai-bi)||a.name.localeCompare(b.name)||a.country.localeCompare(b.country);
    });
    r.json({ok:true,date:requestedDate,sport,counts:includeCounts,cached,leagues});
  }catch(e){
    const catalog=sportLeagueCatalog(sport);
    const leagues=catalog.map(([name,country])=>({name,country,group:"Top Leagues",key:name+"|||"+country,count:null}));
    r.status(200).json({ok:false,date:requestedDate,sport,degraded:true,error:e.message,counts:false,leagues});
  }
});

app.get("/api/predictions",async(req,r)=>{
  try{
    const sport=String(req.query.sport||"football");
    const requestedDate=String(req.query.date||localDayKey(Date.now())),fixtures=(await getDayFixtures(requestedDate,false,sport)).fixtures;
    const rows=fixtures.filter(x=>localDayKey(x.startTimeMs)===requestedDate).slice(0,1000).map(x=>({
      id:x.eventId,league:x.league,time:new Date(x.startTimeMs).toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit",hour12:false}),
      home:x.home,away:x.away,market:"Live SportyBet markets",confidence:"Select an option to analyze",eventId:x.eventId,matchStatus:x.matchStatus,homeScore:x.homeScore,awayScore:x.awayScore
    }));
    r.json({predictions:rows,source:"SportyBet web feed",sport,generatedAt:new Date().toISOString(),date:requestedDate});
  }catch(e){r.status(502).json({ok:false,error:e.message,predictions:[]})}
});

async function buildDailyBest(date,sport="football"){
  const fixtures=(await getDayFixtures(date,false,sport)).fixtures,candidates=[];
  const types=sport==="basketball"?["basketball_total","basketball_handicap","basketball_moneyline","basketball_team_total"]:sport==="tennis"?["tennis_moneyline","tennis_total_games","tennis_handicap","tennis_set_betting"]:sport==="ice_hockey"?["hockey_moneyline","hockey_total_goals","hockey_puck_line","hockey_period"]:sport==="baseball"?["baseball_moneyline","baseball_total_runs","baseball_run_line","baseball_innings"]:["ou","btts","1x2","handicap","corners","cards","double_chance","team_total","first_half_ou","half_time_result","btts_goals","team_corners","team_cards"];
  for(const fixture of fixtures){
    if(localDayKey(fixture.startTimeMs)!==date) continue;
    for(const market of fixture.markets||[]){
      for(const type of types){
        if(!marketMatches(market,type)) continue;
        for(const outcome of market.outcomes||[]){
          if(!outcome.isActive||!Number.isFinite(outcome.odds)||outcome.odds<DAILY_PREDICTION_MIN_ODDS) continue;
          const confidence=confidenceForOutcome(market,outcome);
          if(confidence<60) continue;
          candidates.push({
            id:fixture.eventId+"_"+market.marketId+"_"+(market.specifier||"")+"_"+outcome.outcomeId,
            eventId:fixture.eventId,league:fixture.league,category:fixture.category,
            time:new Date(fixture.startTimeMs).toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit",hour12:false}),
            startTimeMs:fixture.startTimeMs,home:fixture.home,away:fixture.away,
            market:market.marketName,marketId:market.marketId,specifier:market.specifier,
            outcomeId:outcome.outcomeId,pick:pickLabel(type,outcome),odds:outcome.odds,marketType:type,
            confidence,confidenceLabel:confidence>=85?"Very High":confidence>=75?"High":confidence>=65?"Good":"Moderate",date
          });
        }
      }
    }
  }
  const seen=new Set();
  const unique=candidates.filter(x=>{
    const key=x.eventId+"|"+x.marketId+"|"+x.specifier+"|"+x.outcomeId;
    if(seen.has(key)) return false;
    seen.add(key); return true;
  });
  const shortlist=unique.sort((a,b)=>b.confidence-a.confidence||b.odds-a.odds||a.startTimeMs-b.startTimeMs).slice(0,20);
  const enriched=decoratePredictions(await enrichAndModel(shortlist,{concurrency:4}));
  const ranked=enriched.sort((a,b)=>Number(b.modelProbability||b.confidence)-Number(a.modelProbability||a.confidence)||Number(b.confidence||0)-Number(a.confidence||0)||Number(b.odds||0)-Number(a.odds||0));
  const selected=[],usedEvents=new Set(),usedMarkets=new Set();
  // First guarantee market diversity: take the strongest available pick from each market type.
  for(const type of types){
    if(selected.length>=10) break;
    const p=ranked.find(x=>x.marketType===type&&!usedEvents.has(x.eventId));
    if(!p) continue;
    selected.push(p); usedEvents.add(p.eventId); usedMarkets.add(type);
  }
  // Then fill the remaining slots strictly by model ranking, avoiding duplicate matches.
  for(const p of ranked){
    if(selected.length>=10) break;
    if(usedEvents.has(p.eventId)) continue;
    selected.push(p); usedEvents.add(p.eventId);
  }
  return selected.slice(0,10);
}
async function buildBestPicks(date,limit=25,requestedType="all",sport="football"){
  const fixtures=(await getDayFixtures(date,false,sport)).fixtures,candidates=[];
  const types=requestedType==="all"?(sport==="basketball"?["basketball_total","basketball_handicap","basketball_moneyline","basketball_team_total","basketball_first_half_total","basketball_first_half_moneyline","basketball_quarter_total"]:sport==="tennis"?["tennis_moneyline","tennis_total_games","tennis_handicap"]:sport==="ice_hockey"?["hockey_moneyline","hockey_total_goals","hockey_puck_line"]:sport==="baseball"?["baseball_moneyline","baseball_total_runs","baseball_run_line"]:["ou","btts","1x2","handicap","corners","cards"]):[requestedType];
  for(const fixture of fixtures){
    if(localDayKey(fixture.startTimeMs)!==date) continue;
    for(const market of fixture.markets){
      for(const type of types){
        if(!marketMatches(market,type)) continue;
        for(const outcome of market.outcomes||[]){
          if(!outcome.isActive||!Number.isFinite(outcome.odds)||outcome.odds<1.10) continue;
          const confidence=confidenceForOutcome(market,outcome);
          if(confidence<60) continue;
          candidates.push({id:fixture.eventId+"_"+market.marketId+"_"+(market.specifier||"")+"_"+outcome.outcomeId,eventId:fixture.eventId,league:fixture.league,category:fixture.category,time:new Date(fixture.startTimeMs).toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit",hour12:false}),startTimeMs:fixture.startTimeMs,home:fixture.home,away:fixture.away,market:market.marketName,marketId:market.marketId,specifier:market.specifier,outcomeId:outcome.outcomeId,pick:pickLabel(type,outcome),odds:outcome.odds,marketType:type,confidence,confidenceLabel:confidence>=85?"Very High":confidence>=75?"High":confidence>=65?"Good":"Moderate",date});
        }
      }
    }
  }
  const seen=new Set(),unique=candidates.filter(x=>{const k=x.eventId+"|"+x.marketId+"|"+x.specifier+"|"+x.outcomeId;if(seen.has(k))return false;seen.add(k);return true});
  const shortlist=unique.sort((a,b)=>b.confidence-a.confidence||a.startTimeMs-b.startTimeMs).slice(0,20);
  const enriched=decoratePredictions(await enrichAndModel(shortlist,{concurrency:4}));
  return enriched.sort((a,b)=>b.confidence-a.confidence||b.modelProbability-a.modelProbability||a.startTimeMs-b.startTimeMs).slice(0,Math.max(1,Math.min(25,limit)));
}
app.get("/api/best-picks",async(req,r)=>{
  try{
    const sport=String(req.query.sport||"football");
    const date=String(req.query.date||localDayKey(Date.now()));
    const limit=Math.max(1,Math.min(25,Number(req.query.limit)||25));
    const market=String(req.query.market||"all");
    const predictions=await buildBestPicks(date,limit,market,sport);
    r.json({ok:true,date,limit,market,sport,predictions,generatedAt:new Date().toISOString(),source:"SportyBet market model + independent statistics"});
  }catch(e){r.status(502).json({ok:false,error:e.message,predictions:[]})}
});
app.get("/api/correct-scores",requirePaid,async(req,r)=>{if(!(await getAdminSettings()).correctScoreEnabled)return r.status(503).json({ok:false,error:"Correct-score analysis is temporarily disabled by the administrator."});
  try{
    const sport=String(req.query.sport||"football");
    const date=String(req.query.date||localDayKey(Date.now()));
    if(sport!=="football")return r.status(400).json({ok:false,error:"Correct-score analysis is currently available for football."});
    const archived=await readPersistentArchive(date,sport);
    const archivedScores=Array.isArray(archived?.correctScores)?archived.correctScores:[];
    const archiveHasRichAnalysis=archivedScores.length>0&&archivedScores.some(x=>x&&(Array.isArray(x.topScores)||x.bestScore||x.expectedGoals));
    if(archiveHasRichAnalysis){
      return r.json({ok:true,date,sport,predictions:archivedScores.slice(0,5),generatedAt:archived.correctScoresGeneratedAt||archived.updatedAt||new Date().toISOString(),count:Math.min(5,archivedScores.length),requiredCount:5,archived:true,method:"Archived correct-score analysis"});
    }
    const {fixtures}=await getDayFixtures(date,false,sport);
    // Analyze a broad pool, then return exactly the five strongest matches for the selected day.
    const candidates=fixtures.filter(f=>localDayKey(f.startTimeMs)===date).filter(f=>f.home&&f.away).slice(0,40);
    if(!candidates.length)return r.json({ok:true,date,predictions:[],sources:[],message:"No football fixtures found for this date."});
    const base=candidates.map(f=>({id:f.eventId,eventId:f.eventId,home:f.home,away:f.away,league:f.league,time:new Date(f.startTimeMs).toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit",hour12:false}),startTimeMs:f.startTimeMs,marketType:"1x2",pick:"Home",confidence:50,odds:1.5}));
    const enriched=await enrichAndModel(base,{concurrency:3});
    const ranked=enriched.sort((a,b)=>{
      const as=(a.independentSources||[]).length,bs=(b.independentSources||[]).length;
      return bs-as||Number(b.independentConfidence||0)-Number(a.independentConfidence||0)||a.startTimeMs-b.startTimeMs;
    });
    const results=[];
    for(const p of ranked){
      const f=candidates.find(x=>x.eventId===p.eventId);
      if(!f)continue;
      const model=await analyzeCorrectScores(f,p.independentStats||{});
      results.push({id:p.eventId,eventId:p.eventId,league:f.league,time:p.time,home:f.home,away:f.away,expectedGoals:model.expectedGoals,topScores:model.scores,sources:model.sources,confidence:Number((model.scores[0]?.probability||0).toFixed(1))});
    }
    results.sort((a,b)=>b.confidence-a.confidence);
    const topFive=results.slice(0,5).map(x=>({...x,bestScore:x.topScores?.[0]||null,topScores:x.topScores?.slice(0,5)||[]}));
    const archive=await readPersistentArchive(date,sport)||{date,sport,predictions:[],results:[]};
    archive.correctScores=topFive;
    archive.correctScoresGeneratedAt=new Date().toISOString();
    archive.updatedAt=new Date().toISOString();
    if(!archive.savedAt)archive.savedAt=archive.updatedAt;
    await writePersistentArchive(date,archive,sport);
    r.json({ok:true,date,sport,predictions:topFive,generatedAt:archive.correctScoresGeneratedAt,count:topFive.length,requiredCount:5,archived:false,method:"Top five correct-score matches ranked with independent form/xG/recent-results signals plus live market probability"});
  }catch(e){r.status(502).json({ok:false,error:e.message,predictions:[]})}
});
app.get("/api/daily-best",async(req,r)=>{try{const sport=String(req.query.sport||"football");const date=String(req.query.date||localDayKey(Date.now()));const existing=await readPersistentArchive(date,sport);if(existing?.sport===sport&&existing?.dailySelectionVersion===DAILY_SELECTION_VERSION&&existing?.predictions?.length===10&&existing.predictions.every(p=>Number(p?.odds)>=DAILY_PREDICTION_MIN_ODDS))return r.json({ok:true,date,predictions:existing.predictions.slice(0,10),archived:true});const predictions=await buildDailyBest(date,sport);const archive=await readPersistentArchive(date,sport)||{date,sport,predictions:[],results:[]};archive.predictions=predictions;archive.sport=sport;archive.dailySelectionVersion=DAILY_SELECTION_VERSION;archive.updatedAt=new Date().toISOString();if(!archive.savedAt)archive.savedAt=archive.updatedAt;await writePersistentArchive(date,archive,sport);r.json({ok:true,date,sport,predictions,archived:true})}catch(e){r.status(502).json({ok:false,error:e.message,predictions:[]})}});
app.post("/api/predictions/analyze",requirePaid,async(req,r)=>{
  try{
    const body=req.body||{}, admin=await getAdminSettings();
    if(!admin.analyzerEnabled)return r.status(503).json({ok:false,error:"Analyzer is temporarily disabled by the administrator.",code:"ANALYZER_DISABLED",predictions:[]});
    const requestedSport=String(body.sport||"football");
    const requestedDate=String(body.date||localDayKey(Date.now()));
    const leagueFilters=(Array.isArray(body.leagues)?body.leagues.filter(Boolean):[]).map(value=>{const raw=String(value),parts=raw.split("|||");return{name:parts[0],country:parts.slice(1).join("|||")||""}});
    const marketTypes=Array.isArray(body.marketTypes)?body.marketTypes.filter(Boolean):[];
    const selections=Array.isArray(body.selections)?body.selections.filter(Boolean):[];
    const maxGames=Math.max(1,Math.min(admin.maxAnalyzerGames,Number(body.maxGames)||20));
    const minConfidence=Math.max(admin.minAnalyzerConfidence,Math.min(99,Number(body.minConfidence)||0));
    const fixtures=(await getDayFixtures(requestedDate,false,requestedSport)).fixtures||[],results=[];
    for(const fixture of fixtures){
      if(localDayKey(fixture.startTimeMs)!==requestedDate) continue;
      if(leagueFilters.length&&!leagueFilters.some(l=>{
        const fixtureLeague=normalizeText(fixture.league), requestedLeague=normalizeText(l.name);
        const sameName=fixtureLeague===requestedLeague||fixtureLeague.includes(requestedLeague)||requestedLeague.includes(fixtureLeague);
        if(!sameName) return false;
        if(!l.country) return true;
        // For non-football sports, provider categories such as "Challenger",
        // "ITF", or "UTR" are competition groups, not geographic countries.
        // The league catalog already supplies the correct country grouping.
        if(requestedSport!=="football") return true;
        return normalizeText(l.country)===normalizeText(leagueCountry(fixture.league,fixture.category));
      })) continue;
      for(const market of fixture.markets){
        const types=marketTypes.length?marketTypes:["ou"];
        for(const type of types){
          if(!marketMatches(market,type)) continue;
          for(const outcome of market.outcomes){
            if(outcome.isActive===false||!Number.isFinite(Number(outcome.odds))||Number(outcome.odds)<=1) continue;
            if(selections.length&&!selections.some(s=>selectionRequested(outcome,s,market,type))) continue;
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
    const candidates=qualified.slice(0,Math.min(60,qualified.length));
    const enriched=await enrichAndModel(candidates,{concurrency:3});
    enriched.sort((a,b)=>b.confidence-a.confidence||a.startTimeMs-b.startTimeMs);
    const predictions=decoratePredictions(enriched).slice(0,maxGames);
    const existing=await readPersistentArchive(requestedDate,requestedSport)||{date:requestedDate,sport:requestedSport,predictions:[],results:[]};
    existing.predictions=predictions.slice(0,10);
    const newOddsSnapshot=extractOddsSnapshot(predictions);
    existing.oddsSnapshotsPrevious=Array.isArray(existing.oddsSnapshots)?existing.oddsSnapshots:[];
    existing.oddsSnapshots=newOddsSnapshot;
    existing.oddsSnapshotsHistory=[...(Array.isArray(existing.oddsSnapshotsHistory)?existing.oddsSnapshotsHistory:[]),newOddsSnapshot].slice(-5);
    existing.updatedAt=new Date().toISOString();
    existing.savedAt=existing.savedAt||existing.updatedAt;
    existing.criteria={sport:requestedSport,date:requestedDate,leagues:leagueFilters,marketTypes,selections,maxGames,minConfidence};
    await writePersistentArchive(requestedDate,existing,requestedSport);
    r.json({ok:true,sport:requestedSport,source:"SportyBet markets + independent statistics",generatedAt:new Date().toISOString(),criteria:{sport:requestedSport,date:requestedDate,leagues:leagueFilters,marketTypes,selections,maxGames,minConfidence},total:predictions.length,available:qualified.length,independentStatsApplied:predictions.some(x=>x.independentConfidence!=null),predictions});
  }catch(e){r.status(502).json({ok:false,error:e.message,total:0,available:0,predictions:[]})}
});


function serverSettlePrediction(p,result){
  if(!result||!Number.isFinite(Number(result.homeScore))||!Number.isFinite(Number(result.awayScore))) return "Pending";
  const status=String(result.status||"").toLowerCase();
  if(/postpon|cancel|void|abandon/.test(status)) return /postpon|cancel|void/.test(status)?"Postponed":"Pending";
  if(!/finished|full time|ended|complete|ft|final/.test(status)) return "Pending";
  const hs=Number(result.homeScore),as=Number(result.awayScore),total=hs+as,pick=String(p.pick||"").toLowerCase();
  const over=pick.match(/over\s*(\d+(?:\.\d+)?)/),under=pick.match(/under\s*(\d+(?:\.\d+)?)/);
  if(over) return total>Number(over[1])?"Won":"Lost";
  if(under) return total<Number(under[1])?"Won":"Lost";
  if(result.verificationStatus!=="confirmed") return "Pending";
  if(p.marketType==="btts"||/btts/.test(pick)){
    const yes=/yes|gg|both.*score/.test(pick),actual=hs>0&&as>0;
    return actual===yes?"Won":"Lost";
  }
  if(p.marketType==="basketball_moneyline"){ if(/home|1/.test(pick)) return hs>as?"Won":"Lost"; if(/away|2/.test(pick)) return as>hs?"Won":"Lost"; }
  if(p.marketType==="double_chance"){
    if(/home or draw|1x/.test(pick)) return hs>=as?"Won":"Lost";
    if(/home or away|12/.test(pick)) return hs!==as?"Won":"Lost";
    if(/draw or away|x2/.test(pick)) return as>=hs?"Won":"Lost";
  }
  if(p.marketType==="team_total"){
    const hm=pick.match(/home\s*over\s*(\d+(?:\.\d+)?)/),am=pick.match(/away\s*over\s*(\d+(?:\.\d+)?)/);
    if(hm)return hs>Number(hm[1])?"Won":"Lost"; if(am)return as>Number(am[1])?"Won":"Lost";
  }
  if(p.marketType==="1x2"){
    if(/home|1x2.*1|\b1\b/.test(pick)) return hs>as?"Won":"Lost";
    if(/away|1x2.*2|\b2\b/.test(pick)) return as>hs?"Won":"Lost";
    if(/draw|tie|x/.test(pick)) return hs===as?"Won":"Lost";
  }
  if(/home/.test(pick)&&!/handicap/.test(pick)) return hs>as?"Won":"Lost";
  if(/away/.test(pick)&&!/handicap/.test(pick)) return as>hs?"Won":"Lost";
  if(/draw/.test(pick)) return hs===as?"Won":"Lost";
  return "Pending";
}
function dateListInclusive(from,to){
  const out=[],d=new Date(from+"T12:00:00"),end=new Date(to+"T12:00:00");
  while(d<=end&&out.length<31){out.push(localDayKey(d.getTime()));d.setDate(d.getDate()+1)}
  return out;
}
app.get("/api/performance",async(req,r)=>{
  try{
    const today=localDayKey(Date.now()),from=String(req.query.from||today),to=String(req.query.to||from);
    const dates=dateListInclusive(from,to); if(!dates.length)return r.status(400).json({ok:false,error:"Invalid date range."});
    const rows=[];
    for(const date of dates){
      const archive=await readPersistentArchive(date);
      const predictions=Array.isArray(archive?.predictions)?archive.predictions:[];
      let results=Array.isArray(archive?.results)?archive.results:[];
      if(!results.length){try{const rr=await getVerifiedResults(date,false,String(archive?.sport||"football"));results=rr.results||[]}catch{}}
      for(const p of predictions){
        const pk=resultNorm(p.home),ak=resultNorm(p.away);
        const result=results.find(x=>x.providerId&&p.resultProviderId&&String(x.providerId)===String(p.resultProviderId))||results.find(x=>resultNorm(x.home)===pk&&resultNorm(x.away)===ak);
        rows.push({...p,date,outcome:serverSettlePrediction(p,result)});
      }
    }
    const settled=rows.filter(x=>x.outcome==="Won"||x.outcome==="Lost"),won=settled.filter(x=>x.outcome==="Won").length,lost=settled.filter(x=>x.outcome==="Lost").length;
    const byMarket={}; for(const x of settled){const k=x.marketType||"other";byMarket[k]??={total:0,won:0,lost:0};byMarket[k].total++;if(x.outcome==="Won")byMarket[k].won++;else byMarket[k].lost++}
    r.json({ok:true,from,to,days:dates.length,totalPredictions:rows.length,settled:settled.length,won,lost,accuracy:settled.length?Math.round(won/settled.length*100):null,byMarket});
  }catch(e){r.status(200).json({ok:false,error:e.message,totalPredictions:0,settled:0,won:0,lost:0,accuracy:null,byMarket:{}})}
});
app.post("/api/booking-code",requirePaid,async(req,r)=>{if(!(await getAdminSettings()).bookingCodeEnabled)return r.status(503).json({ok:false,error:"Booking-code generation is temporarily disabled by the administrator."});try{const selections=Array.isArray(req.body?.selections)?req.body.selections:[],sport=String(req.body?.sport||"football"),target=String(req.body?.bookmaker||"sportybet");if(!selections.length)return r.status(400).json({ok:false,error:"Select at least one analyzed match first."});r.json({ok:true,...await generateTargetBooking(target,selections,sport)})}catch(e){r.status(e.code==="NO_AVAILABLE_SELECTIONS"?409:502).json({ok:false,error:e.message,unavailableSelections:e.unavailable||[]})}});

app.get("/api/daily-rollover",async(req,r)=>{if(process.env.CRON_SECRET&&req.headers.authorization!==`Bearer ${process.env.CRON_SECRET}`)return r.status(401).json({ok:false,error:"Unauthorized"});try{const date=localDayKey(Date.now()),prev=localDayKey(Date.now()-86400000);let prevArchive=await readPersistentArchive(prev);let resultRows=[];try{const rr=await getDateResults(prev,true);if(rr.configured)resultRows=rr.data||[]}catch{}if(!prevArchive||!Array.isArray(prevArchive.predictions)||prevArchive.predictions.length!==10){try{const predictions=await buildDailyBest(prev);prevArchive=prevArchive||{date:prev,predictions:[],results:[]};prevArchive.predictions=predictions;prevArchive.dailySelectionVersion=DAILY_SELECTION_VERSION}catch{}}if(prevArchive){prevArchive.predictions=Array.isArray(prevArchive.predictions)?prevArchive.predictions.slice(0,10):[];prevArchive.results=resultRows;prevArchive.updatedAt=new Date().toISOString();if(!prevArchive.savedAt)prevArchive.savedAt=prevArchive.updatedAt;await writePersistentArchive(prev,prevArchive)}const todayArchive=await readPersistentArchive(date);const predictions=todayArchive?.dailySelectionVersion===DAILY_SELECTION_VERSION&&todayArchive?.predictions?.length===10?todayArchive.predictions:await buildDailyBest(date);const next=todayArchive||{date,predictions:[],results:[]};next.predictions=predictions;next.dailySelectionVersion=DAILY_SELECTION_VERSION;next.updatedAt=new Date().toISOString();if(!next.savedAt)next.savedAt=next.updatedAt;await writePersistentArchive(date,next);r.json({ok:true,date,previousDate:prev,previousResults:resultRows.length,newDailyBest:predictions.length})}catch(e){r.status(500).json({ok:false,error:e.message})}});


// User support, feedback, suggestions and admin live-chat endpoints.
app.post("/api/support/tickets",requireAuth,async(req,r)=>{
  try{const ticket=await createTicket(req.user,req.body||{});r.status(201).json({ok:true,ticket})}
  catch(e){r.status(400).json({ok:false,error:e.message})}
});
app.get("/api/support/tickets",requireAuth,async(req,r)=>{
  try{r.json({ok:true,tickets:await listUserTickets(req.user)})}
  catch(e){r.status(500).json({ok:false,error:e.message})}
});
app.get("/api/support/chat",requireAuth,async(req,r)=>{
  try{const thread=await getOrCreateChat(req.user);const messages=await listChatMessages(req.user,thread.id);r.json({ok:true,thread,messages})}
  catch(e){r.status(500).json({ok:false,error:e.message})}
});
app.post("/api/support/chat",requireAuth,async(req,r)=>{
  try{const thread=await getOrCreateChat(req.user);const message=await addChatMessage(req.user,thread.id,req.body?.message);r.status(201).json({ok:true,message})}
  catch(e){r.status(400).json({ok:false,error:e.message})}
});
app.get("/api/admin/support/tickets",requireRole("admin","moderator"),async(req,r)=>{
  try{r.json({ok:true,tickets:await adminTickets()})}
  catch(e){r.status(500).json({ok:false,error:e.message})}
});
app.patch("/api/admin/support/tickets/:id",requireRole("admin","moderator"),async(req,r)=>{
  try{r.json({ok:true,ticket:await updateTicket(req.params.id,String(req.body?.status||"open"))})}
  catch(e){r.status(400).json({ok:false,error:e.message})}
});
app.get("/api/admin/support/chats",requireRole("admin","moderator"),async(req,r)=>{
  try{r.json({ok:true,threads:await adminThreads()})}
  catch(e){r.status(500).json({ok:false,error:e.message})}
});
app.get("/api/admin/support/chats/:id",requireRole("admin","moderator"),async(req,r)=>{
  try{r.json({ok:true,messages:await adminMessages(req.params.id)})}
  catch(e){r.status(404).json({ok:false,error:e.message})}
});
app.post("/api/admin/support/chats/:id",requireRole("admin","moderator"),async(req,r)=>{
  try{r.status(201).json({ok:true,message:await adminAddMessage(req.user,req.params.id,req.body?.message)})}
  catch(e){r.status(400).json({ok:false,error:e.message})}
});
app.patch("/api/admin/support/chats/:id",requireRole("admin","moderator"),async(req,r)=>{
  try{r.json({ok:true,thread:await setThreadStatus(req.params.id,String(req.body?.status||"open"))})}
  catch(e){r.status(400).json({ok:false,error:e.message})}
});
// Advanced analytics APIs.
app.get("/api/smart-picks",async(req,res)=>{
 try{const sport=String(req.query.sport||"football"),date=String(req.query.date||localDayKey(Date.now()));const archive=await readPersistentArchive(date,sport);let rows=Array.isArray(archive?.predictions)?archive.predictions:[];if(!rows.length)rows=await buildBestPicks(date,20,"all",sport);res.json({ok:true,date,sport,predictions:await smartPickRank(rows),generatedAt:new Date().toISOString()})}
 catch(e){res.status(502).json({ok:false,error:e.message,predictions:[]})}
});
app.post("/api/bet-builder",requirePaid,async(req,res)=>{
 try{const rows=Array.isArray(req.body?.predictions)?req.body.predictions:[];const mode=String(req.body?.mode||"conservative");res.json({ok:true,mode,predictions:buildBetBuilder(rows,mode)})}
 catch(e){res.status(400).json({ok:false,error:e.message,predictions:[]})}
});
app.get("/api/performance-advanced",async(req,res)=>{
 try{const today=localDayKey(Date.now()),from=String(req.query.from||today),to=String(req.query.to||from);res.json({ok:true,from,to,...await performanceFromArchives(d=>readPersistentArchive(d),from,to)})}
 catch(e){res.status(200).json({ok:false,error:e.message,totalPredictions:0,settled:0,won:0,lost:0,accuracy:null,byMarket:{},byLeague:{}})}
});
app.post("/api/match-report",async(req,res)=>{
 try{res.json({ok:true,report:buildMatchReport(req.body?.prediction||req.body||{})})}
 catch(e){res.status(400).json({ok:false,error:e.message})}
});
app.get("/api/odds-movement",async(req,res)=>{
 try{
   const sport=String(req.query.sport||"football"),date=String(req.query.date||localDayKey(Date.now()));
   const archive=await readPersistentArchive(date,sport),current=Array.isArray(archive?.predictions)?archive.predictions:[];
   const history=Array.isArray(archive?.oddsSnapshotsHistory)?archive.oddsSnapshotsHistory:[];
   const previous=history.length>1?history[history.length-2]:Array.isArray(archive?.oddsSnapshotsPrevious)?archive.oddsSnapshotsPrevious:[];
   const prevMap=new Map(previous.map(x=>[x.id,x]));
   const movement=current.map(x=>({...x,movement:oddsMovement(x,prevMap.get(x.id)||{})}));
   res.json({ok:true,date,sport,movement,hasSnapshot:previous.length>0,updatedAt:archive?.updatedAt||null});
 }catch(e){res.status(200).json({ok:false,error:e.message,movement:[],hasSnapshot:false})}
});
app.get("/api/intelligence-status",async(req,res)=>{
 try{
   const health=await independentHealth();
   res.json({ok:true,providers:{sofascore:!!health.sofascore,understat:!!health.understat,oddsHistory:true,lineups:"Sofascore event lineups when published",injuries:"Sofascore team injury feed when available"},note:"Lineups and injuries are availability-dependent and are never invented."});
 }catch(e){res.status(200).json({ok:false,providers:{sofascore:false,understat:false,oddsHistory:true},error:e.message})}
});
app.get("/{*splat}",(_,r)=>r.sendFile(path.join(__dirname,"public","index.html")));

// Vercel invokes the Express app as a serverless function. Keep the local
// listener for `npm start`, but do not open a second listener inside Vercel.
if (!process.env.VERCEL) app.listen(PORT,()=>console.log("Omegaplus Pro AI listening on "+PORT));
export default app;
