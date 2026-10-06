import express from "express";
import {initAuthDb,authDbConfigured,dbReady,currentUser,requireAuth,requirePaid,requireRole,registerUser,createAdminUser,loginUser,logoutUser,setSessionCookie,clearSessionCookie,adminUsers,setUserAccess,adminStats,listPlans,createOrUpdatePlan,activateSubscription,revokeSubscription,audit,getAccessSettings,updateAccessSettings,grantFreeTrial,paymentHistory,createPaymentRecord,activateProviderSubscription} from "./auth.js";
import {put,get} from "@vercel/blob";
import {getDateResults,getLatestResults,getMyLeagues,norm as resultNorm} from "./sportmonks-results.js";
import {enrichPredictions,independentHealth} from "./independent-stats.js";
import {analyzeCorrectScores} from "./correct-score.js";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import {fileURLToPath} from "node:url";

const app=express();
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const PORT=process.env.PORT||3000;
const APP_VERSION="1.5.0";
const DAILY_PREDICTION_MIN_ODDS=1.10;
const DAILY_SELECTION_VERSION="mixed-top10-v1";
const SPORTYBET_BASE=process.env.SPORTYBET_API_BASE_URL||"https://www.sportybet.com";
const SPORTYBET_REGION=process.env.SPORTYBET_REGION||"ng";
const COUNTRY=(SPORTYBET_REGION||"ng").toUpperCase();
const SPORTS=[{id:"football",name:"Football",sportId:"sr:sport:1"},{id:"basketball",name:"Basketball",sportId:"sr:sport:2"}];
const BOOKMAKERS=[{id:"sportybet",name:"SportyBet",country:"ng",native:true},{id:"bet9ja",name:"Bet9ja",country:"ng"},{id:"msport",name:"MSport",country:"ng"},{id:"betking",name:"BetKing",country:"ng"},{id:"1xbet",name:"1xBet",country:"ng"},{id:"betano",name:"Betano",country:"ng"},{id:"22bet",name:"22Bet",country:"ng"}];
const BETRELAY_BASE=process.env.BETRELAY_API_BASE_URL||"https://betrelay.com.ng/api/v1";
const BETRELAY_API_KEY=process.env.BETRELAY_API_KEY||"";
async function betRelayFetch(pathname,options={}){if(!BETRELAY_API_KEY)throw new Error("Multi-bookmaker code service is not configured yet. Add BETRELAY_API_KEY to Railway.");const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);try{const res=await fetch(BETRELAY_BASE+pathname,{...options,headers:{Accept:"application/json","Content-Type":"application/json","X-API-Key":BETRELAY_API_KEY,...(options.headers||{})},signal:controller.signal});const text=await res.text();let body=null;try{body=text?JSON.parse(text):null}catch{}if(!res.ok)throw new Error(body?.message||("BetRelay HTTP "+res.status));if(!body)throw new Error("BetRelay returned an invalid response");return body}finally{clearTimeout(timer)}}
function bookmakerById(id){return BOOKMAKERS.find(x=>x.id===String(id))}
async function createSportyBooking(selections,sport="football"){const fixtures=await getSportyFixtures(false,true,sport);for(const s of selections){const f=fixtures.find(x=>x.eventId===s.eventId);const m=f?.markets.find(x=>x.marketId===String(s.marketId)&&String(x.specifier||"")===String(s.specifier||""));const o=m?.outcomes.find(x=>x.outcomeId===String(s.outcomeId)&&x.isActive);if(!f||!m||!o)throw new Error("One or more selections are no longer available. Refresh and analyze again.")}const payload={selections:selections.map(s=>({eventId:s.eventId,marketId:String(s.marketId),specifier:s.specifier??null,outcomeId:String(s.outcomeId)}))};const body=await sportyFetch("/orders/share",{method:"POST",body:JSON.stringify(payload)}),data=body.data||{};if(!data.shareCode)throw new Error("SportyBet did not return a booking code.");return{bookingCode:String(data.shareCode),shareURL:data.shareURL||null,deadline:data.deadline||null}}
async function generateTargetBooking(target,selections,sport="football"){const targetBookie=bookmakerById(target);if(!targetBookie)throw new Error("Unsupported bookmaker.");const sporty=await createSportyBooking(selections,sport);if(target==="sportybet")return{...sporty,source:"SportyBet",target:"SportyBet"};const body=await betRelayFetch("/convert",{method:"POST",body:JSON.stringify({code:sporty.bookingCode,from:"sportybet",to:target,country:"ng"})});const data=body.data||{};if(!data.shareCode)throw new Error(targetBookie.name+" did not return a booking code.");return{bookingCode:String(data.shareCode),shareURL:data.shareURL||null,source:"SportyBet → BetRelay",target:targetBookie.name,sourceCode:sporty.bookingCode,selections:data.selections||[]}}


app.use(express.json({limit:"1mb",verify:(req,res,buf)=>{req.rawBody=Buffer.from(buf)}}));
initAuthDb().then(ok=>console.log("Account database:",ok?"ready":"not configured/unavailable"));
app.use(express.static(path.join(__dirname,"public")));

const MARKET_IDS=["1","10","11","14","16","18","26","29","36","60100","139","136","138","900304","900305","900312","162","165","166","172","900300","900301","219","223","225","227","228"];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let lastSportyRequest=0;
let liveCache={at:0,key:"",fixtures:[]};
let liveFetchPromise=null;
const dayCache=new Map();
const DAY_CACHE_MS=24*60*60*1000;
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
  const marketKey=MARKET_IDS.join(",");
  const cacheKey=sportDef.id+"|"+marketKey+"|"+(todayOnly?"today":"future");
  if(!force&&Date.now()-liveCache.at<300000&&liveCache.key===cacheKey) return liveCache.fixtures;
  if(liveFetchPromise) return liveFetchPromise;
  liveFetchPromise=(async()=>{
  const all=[],pageSize=100;
  for(let page=1;page<=(todayOnly?4:12);page++){
    const params=new URLSearchParams({sportId:sportDef.sportId,marketId:marketKey,pageSize:String(pageSize),pageNum:String(page),todayGames:String(todayOnly),timeline:todayOnly?"48":"720",_t:String(Date.now())});
    let body;
    try{body=await sportyFetch("/factsCenter/pcUpcomingEvents?"+params)}catch(e){if(all.length) break;throw e}
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
  const outcomes=(market.outcomes||[]).map(o=>normalizeText(o.outcomeName));
  const hasAny=patterns=>outcomes.some(o=>patterns.some(p=>o.includes(p)));
  if(type==="basketball_total") return ["225"].includes(market.marketId)||n.includes("total")||n.includes("over under")||hasAny(["over ","under "]);
  if(type==="basketball_handicap") return ["223"].includes(market.marketId)||n.includes("handicap")||n.includes("spread")||hasAny(["handicap","spread"]);
  if(type==="basketball_moneyline") return ["219"].includes(market.marketId)||n.includes("winner")||n.includes("moneyline")||n.includes("match result")||hasAny(["home","away"]);
  if(type==="basketball_team_total") return ["227","228"].includes(market.marketId)||n.includes("team total");
  if(type==="ou") return market.marketId==="18"||n.includes("over under")||n.includes("total goals")||n.includes("goals total")||hasAny(["over ","under "]);
  if(type==="btts") return market.marketId==="29"||n.includes("both teams to score")||n.includes("btts")||hasAny(["both teams to score","yes","no"]);
  if(type==="1x2") return market.marketId==="1"||n.includes("1x2")||n.includes("match result")||n==="winner"||hasAny(["home","draw","away"]);
  if(type==="handicap") return ["14","16"].includes(market.marketId)||n.includes("handicap")||n.includes("spread")||hasAny(["handicap","spread"]);
  if(type==="corners") return ["166","165","162"].includes(market.marketId)||n.includes("corner")||hasAny(["corner"]);
  if(type==="cards") return ["139","138","900304","900305","900312"].includes(market.marketId)||n.includes("booking")||n.includes("card")||hasAny(["card","booking"]);
  return false;
}
function confidenceForOutcome(market,outcome){
  const active=market.outcomes.filter(o=>o.isActive&&Number.isFinite(o.odds)&&o.odds>1);
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
function pickLabel(type,outcome){
  return outcome.outcomeName||(type==="1x2"?"1X2":type==="btts"?"BTTS":type==="corners"?"Corners":type==="cards"?"Bookings":type==="handicap"?"Handicap":"Over/Under");
}
function selectionRequested(outcome,requested){
  if(!requested) return true;
  const a=normalizeText(outcome?.outcomeName),b=normalizeText(requested);
  if(a===b)return true;
  const clean=v=>v.replaceAll("goals"," ").replaceAll("goal"," ").replaceAll("total"," ").replaceAll("over"," ").replaceAll("under"," ").replaceAll(/[^a-z0-9.]+/g," ").trim();
  const aa=clean(a),bb=clean(b);
  if(aa===bb)return true;
  if((a.includes("over")&&b.includes("over"))||(a.includes("under")&&b.includes("under"))){
    const an=(a.match(/[0-9]+(?:\.[0-9]+)?/)||[])[0],bn=(b.match(/[0-9]+(?:\.[0-9]+)?/)||[])[0];
    if(an&&bn&&an===bn)return true;
  }
  return aa.startsWith(bb+" ")||bb.startsWith(aa+" ");
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

app.get("/api/sports",(_,r)=>r.json({ok:true,sports:SPORTS}));
app.get("/health",(_,r)=>r.status(200).json({status:"healthy",service:"omegaplus-pro-ai",version:APP_VERSION,uptime:Math.round(process.uptime())}));
app.get("/api/health",async(_,r)=>{const stats=await independentHealth();r.json({ok:true,service:"Omegaplus Pro AI",version:APP_VERSION,branch:"integration-omegaplus-current",liveSportyBet:true,accountSystem:{configured:authDbConfigured(),ready:await dbReady()},independentStats:stats,multiBookmaker:BOOKMAKERS.map(x=>({id:x.id,name:x.name,codeGeneration:x.id==="sportybet"||Boolean(BETRELAY_API_KEY)}))})});
app.get("/api/auth/me",async(req,r)=>{try{const user=await currentUser(req);r.json({ok:Boolean(user),user:user||null})}catch{r.json({ok:false,user:null})}});
app.post("/api/auth/register",async(req,r)=>{try{const user=await registerUser(req.body||{},req);const session=await (await import("./auth.js")).createSession(user,req);setSessionCookie(r,session.token);r.status(201).json({ok:true,user})}catch(e){r.status(400).json({ok:false,error:e.message})}});
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

app.post("/api/admin/create-admin",requireRole("admin"),async(req,r)=>{try{const user=await createAdminUser(req.body||{},req);r.status(201).json({ok:true,user})}catch(e){r.status(400).json({ok:false,error:e.message})}});
app.get("/api/admin/stats",requireRole("admin"),async(_,r)=>{try{r.json({ok:true,stats:await adminStats()})}catch(e){r.status(503).json({ok:false,error:e.message})}});
app.get("/api/admin/users",requireRole("admin"),async(req,r)=>{try{r.json({ok:true,users:await adminUsers({page:req.query.page,limit:req.query.limit,search:req.query.search})})}catch(e){r.status(503).json({ok:false,error:e.message,users:[]})}});
app.patch("/api/admin/users/:id",requireRole("admin"),async(req,r)=>{try{const user=await setUserAccess(req.params.id,req.body||{});await audit(req,"admin.user.update",req.params.id,{changes:req.body||{}});r.json({ok:true,user})}catch(e){r.status(400).json({ok:false,error:e.message})}});
app.post("/api/admin/users/:id/subscription",requireRole("admin"),async(req,r)=>{try{const sub=await activateSubscription(req.params.id,String(req.body?.plan||"pro"),Number(req.body?.days)||30,"admin");await audit(req,"admin.subscription.activate",req.params.id,{plan:req.body?.plan||"pro",days:Number(req.body?.days)||30});r.json({ok:true,subscription:sub})}catch(e){r.status(400).json({ok:false,error:e.message})}});
app.delete("/api/admin/users/:id/subscription",requireRole("admin"),async(req,r)=>{try{await revokeSubscription(req.params.id);await audit(req,"admin.subscription.revoke",req.params.id);r.json({ok:true})}catch(e){r.status(400).json({ok:false,error:e.message})}});
app.post("/api/admin/plans",requireRole("admin"),async(req,r)=>{try{const plan=await createOrUpdatePlan(req.body||{});await audit(req,"admin.plan.update",String(req.body?.id||""),req.body||{});r.json({ok:true,plan})}catch(e){r.status(400).json({ok:false,error:e.message})}});
app.get("/api/admin/access-settings",requireRole("admin"),async(_,r)=>{try{r.json({ok:true,settings:await getAccessSettings()})}catch(e){r.status(503).json({ok:false,error:e.message})}});
app.patch("/api/admin/access-settings",requireRole("admin"),async(req,r)=>{try{const settings=await updateAccessSettings(req.body||{});await audit(req,"admin.access_settings.update","app",settings);r.json({ok:true,settings})}catch(e){r.status(400).json({ok:false,error:e.message})}});
app.post("/api/admin/users/:id/free-trial",requireRole("admin"),async(req,r)=>{try{const days=Math.max(1,Math.min(365,Number(req.body?.days)||3));const sub=await grantFreeTrial(req.params.id,days);await audit(req,"admin.free_trial.grant",req.params.id,{days});r.json({ok:true,subscription:sub})}catch(e){r.status(400).json({ok:false,error:e.message})}});

app.get("/api/stats/status",async(_,r)=>{try{const x=await independentHealth();r.json({ok:true,providers:{Sofascore:{configured:x.sofascore,role:"fixtures, form, match statistics, standings-compatible data"},Understat:{configured:x.understat,role:"xG, xGA, shot-quality data",coverage:["Premier League","LaLiga","Serie A","Bundesliga","Ligue 1"]},Sportmonks:{configured:Boolean(process.env.SPORTMONKS_API_TOKEN),role:"supplementary results/statistics where subscription covers the league"}}})}catch(e){r.status(200).json({ok:false,error:e.message})}});
app.get("/api/bookmakers",(_,r)=>r.json({ok:true,bookmakers:BOOKMAKERS.map(x=>({id:x.id,name:x.name,codeGeneration:x.id==="sportybet"||Boolean(BETRELAY_API_KEY),method:x.id==="sportybet"?"native":"SportyBet→BetRelay"})),configured:Boolean(BETRELAY_API_KEY)}));

app.get("/api/markets",(_,r)=>r.json({markets:[
  {id:"ou",name:"Goals Over/Under",type:"ou"},{id:"1x2",name:"1X2",type:"1x2"},
  {id:"btts",name:"BTTS",type:"btts"},{id:"handicap",name:"Handicap",type:"handicap"},
  {id:"corners",name:"Corners Over/Under",type:"corners"},{id:"cards",name:"Cards/Bookings Over/Under",type:"cards"}
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
app.post("/api/history",async(req,r)=>{try{const sport=String(req.body?.sport||"football");const date=String(req.body?.date||localDayKey(Date.now()));const old=await readPersistentArchive(date,sport)||{date,sport,predictions:[],results:[]};const next={...old};if(Array.isArray(req.body?.predictions))next.predictions=req.body.predictions.slice(0,10);if(Array.isArray(req.body?.results))next.results=req.body.results;next.updatedAt=new Date().toISOString();if(!next.savedAt)next.savedAt=next.updatedAt;await writePersistentArchive(date,next,sport);r.json({ok:true,date,sport,archive:next,storage:"vercel-blob"})}catch(e){r.status(500).json({ok:false,error:e.message})}});
app.get("/api/results/status",(_,r)=>r.json({ok:true,configured:Boolean(process.env.SPORTMONKS_API_TOKEN),provider:"Sportmonks",cacheSeconds:15}));
app.get("/api/results/leagues",async(_,r)=>{try{const x=await getMyLeagues();if(!x.configured)return r.status(503).json({ok:false,configured:false,error:x.error,leagues:[]});r.json({ok:true,configured:true,provider:"Sportmonks",count:x.data.length,leagues:x.data.map(l=>({id:l.id,name:l.name,countryId:l.country_id,active:l.active}))})}catch(e){r.status(502).json({ok:false,configured:true,provider:"Sportmonks",error:e.message,leagues:[]})}});
app.get("/api/results",async(req,r)=>{
  try{const date=String(req.query.date||localDayKey(Date.now()));const force=String(req.query.refresh||"") === "1";const x=await getDateResults(date,force);if(!x.configured)return r.status(503).json({ok:false,configured:false,provider:"Sportmonks",error:x.error,results:[]});r.json({ok:true,configured:true,provider:"Sportmonks",date,results:x.data,cached:x.cached,updatedAt:x.updatedAt});}
  catch(e){r.status(502).json({ok:false,configured:true,provider:"Sportmonks",error:e.message,results:[]})}
});
app.get("/api/results/live",async(_,r)=>{try{const x=await getLatestResults();if(!x.configured)return r.status(503).json({ok:false,configured:false,provider:"Sportmonks",error:x.error,results:[]});r.json({ok:true,configured:true,provider:"Sportmonks",results:x.data,updatedAt:x.updatedAt})}catch(e){r.status(502).json({ok:false,configured:true,provider:"Sportmonks",error:e.message,results:[]})}});

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
app.get("/api/leagues",async(req,r)=>{
  const sport=String(req.query.sport||"football");
  const requestedDate=String(req.query.date||localDayKey(Date.now()));
  try{
    const {fixtures}=await getDayFixtures(requestedDate,false,sport);
    const map=new Map();
    const catalog=sport==="basketball"?BASKETBALL_LEAGUE_CATALOG:TOP_LEAGUE_CATALOG;
    for(const [name,country] of catalog){
      const key=name+"|||"+country;
      map.set(key,{name,country,group:"Top Leagues",key});
    }
    if(sport==="football"){
      for(const f of fixtures){
        if(!f.league) continue;
        if(topLeagueIndex(f.league)>=0) continue;
        const country=leagueCountry(f.league,f.category);
        const key=f.league+"|||"+country;
        if(!map.has(key)) map.set(key,{name:f.league,country,group:"Other Leagues",key});
      }
    }
    const leagues=[...map.values()].sort((a,b)=>{
      const ga=["Top Leagues","European Competitions","International","Other Leagues"];
      const ai=ga.indexOf(a.group),bi=ga.indexOf(b.group);
      return (ai-bi)||a.name.localeCompare(b.name)||a.country.localeCompare(b.country);
    });
    r.json({ok:true,date:requestedDate,sport,leagues});
  }catch(e){
    const catalog=sport==="basketball"?BASKETBALL_LEAGUE_CATALOG:TOP_LEAGUE_CATALOG;
    const leagues=catalog.map(([name,country])=>({name,country,group:"Top Leagues",key:name+"|||"+country}));
    r.status(200).json({ok:false,date:requestedDate,sport,degraded:true,error:e.message,leagues});
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
  const types=sport==="basketball"?["basketball_total","basketball_handicap","basketball_moneyline","basketball_team_total"]:["ou","btts","1x2","handicap","corners","cards"];
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
  const shortlist=unique.sort((a,b)=>b.confidence-a.confidence||b.odds-a.odds||a.startTimeMs-b.startTimeMs).slice(0,60);
  const enriched=decoratePredictions(await enrichPredictions(shortlist,{concurrency:4}));
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
  const types=requestedType==="all"?(sport==="basketball"?["basketball_total","basketball_handicap","basketball_moneyline"]:["ou","btts","1x2","handicap","corners","cards"]):[requestedType];
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
  const shortlist=unique.sort((a,b)=>b.confidence-a.confidence||a.startTimeMs-b.startTimeMs).slice(0,40);
  const enriched=decoratePredictions(await enrichPredictions(shortlist,{concurrency:4}));
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
app.get("/api/correct-scores",requirePaid,async(req,r)=>{
  try{
    const sport=String(req.query.sport||"football");
    const date=String(req.query.date||localDayKey(Date.now()));
    if(sport!=="football")return r.status(400).json({ok:false,error:"Correct-score analysis is currently available for football."});
    const {fixtures}=await getDayFixtures(date,false,sport);
    // Analyze a broad pool, then return exactly the five strongest matches for the selected day.
    const candidates=fixtures.filter(f=>localDayKey(f.startTimeMs)===date).filter(f=>f.home&&f.away).slice(0,40);
    if(!candidates.length)return r.json({ok:true,date,predictions:[],sources:[],message:"No football fixtures found for this date."});
    const base=candidates.map(f=>({id:f.eventId,eventId:f.eventId,home:f.home,away:f.away,league:f.league,time:new Date(f.startTimeMs).toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit",hour12:false}),startTimeMs:f.startTimeMs,marketType:"1x2",pick:"Home",confidence:50,odds:1.5}));
    const enriched=await enrichPredictions(base,{concurrency:3});
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
    const topFive=results.slice(0,5).map(x=>({...x,topScores:x.topScores?.slice(0,1)||[]}));
    r.json({ok:true,date,sport,predictions:topFive,generatedAt:new Date().toISOString(),count:topFive.length,requiredCount:5,method:"Top five correct-score matches ranked with independent form/xG/recent-results signals plus live market probability"});
  }catch(e){r.status(502).json({ok:false,error:e.message,predictions:[]})}
});
app.get("/api/daily-best",async(req,r)=>{try{const sport=String(req.query.sport||"football");const date=String(req.query.date||localDayKey(Date.now()));const existing=await readPersistentArchive(date,sport);if(existing?.sport===sport&&existing?.dailySelectionVersion===DAILY_SELECTION_VERSION&&existing?.predictions?.length===10&&existing.predictions.every(p=>Number(p?.odds)>=DAILY_PREDICTION_MIN_ODDS))return r.json({ok:true,date,predictions:existing.predictions.slice(0,10),archived:true});const predictions=await buildDailyBest(date,sport);const archive=await readPersistentArchive(date,sport)||{date,sport,predictions:[],results:[]};archive.predictions=predictions;archive.sport=sport;archive.dailySelectionVersion=DAILY_SELECTION_VERSION;archive.updatedAt=new Date().toISOString();if(!archive.savedAt)archive.savedAt=archive.updatedAt;await writePersistentArchive(date,archive,sport);r.json({ok:true,date,sport,predictions,archived:true})}catch(e){r.status(502).json({ok:false,error:e.message,predictions:[]})}});
app.post("/api/predictions/analyze",requirePaid,async(req,r)=>{
  try{
    const body=req.body||{};
    const requestedSport=String(body.sport||"football");
    const requestedDate=String(body.date||localDayKey(Date.now()));
    const leagueFilters=(Array.isArray(body.leagues)?body.leagues.filter(Boolean):[]).map(value=>{const raw=String(value),parts=raw.split("|||");return{name:parts[0],country:parts.slice(1).join("|||")||""}});
    const marketTypes=Array.isArray(body.marketTypes)?body.marketTypes.filter(Boolean):[];
    const selections=Array.isArray(body.selections)?body.selections.filter(Boolean):[];
    const maxGames=Math.max(1,Math.min(50,Number(body.maxGames)||20));
    const minConfidence=Math.max(0,Math.min(99,Number(body.minConfidence)||0));
    const fixtures=(await getDayFixtures(requestedDate,false,requestedSport)).fixtures,results=[];
    for(const fixture of fixtures){
      if(localDayKey(fixture.startTimeMs)!==requestedDate) continue;
      // League name is the authoritative fixture identifier. Country/category is display metadata and must not eliminate a valid league.
      if(leagueFilters.length&&!leagueFilters.some(l=>normalizeText(l.name)===normalizeText(fixture.league))) continue;
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
    const candidates=qualified.slice(0,Math.min(60,qualified.length));
    const enriched=await enrichPredictions(candidates,{concurrency:3});
    enriched.sort((a,b)=>b.confidence-a.confidence||a.startTimeMs-b.startTimeMs);
    const predictions=decoratePredictions(enriched).slice(0,maxGames);
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
  if(p.marketType==="btts"||/btts/.test(pick)){
    const yes=/yes|gg|both.*score/.test(pick),actual=hs>0&&as>0;
    return actual===yes?"Won":"Lost";
  }
  if(p.marketType==="basketball_moneyline"){ if(/home|1/.test(pick)) return hs>as?"Won":"Lost"; if(/away|2/.test(pick)) return as>hs?"Won":"Lost"; }
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
      if(!results.length){try{const rr=await getDateResults(date,false);if(rr.configured)results=rr.data||[]}catch{}}
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
app.post("/api/booking-code",requirePaid,async(req,r)=>{try{const selections=Array.isArray(req.body?.selections)?req.body.selections:[],sport=String(req.body?.sport||"football"),target=String(req.body?.bookmaker||"sportybet");if(!selections.length)return r.status(400).json({ok:false,error:"Select at least one analyzed match first."});r.json({ok:true,...await generateTargetBooking(target,selections,sport)})}catch(e){r.status(502).json({ok:false,error:e.message})}});

app.get("/api/daily-rollover",async(req,r)=>{if(process.env.CRON_SECRET&&req.headers.authorization!==`Bearer ${process.env.CRON_SECRET}`)return r.status(401).json({ok:false,error:"Unauthorized"});try{const date=localDayKey(Date.now()),prev=localDayKey(Date.now()-86400000);let prevArchive=await readPersistentArchive(prev);let resultRows=[];try{const rr=await getDateResults(prev,true);if(rr.configured)resultRows=rr.data||[]}catch{}if(!prevArchive||!Array.isArray(prevArchive.predictions)||prevArchive.predictions.length!==10){try{const predictions=await buildDailyBest(prev);prevArchive=prevArchive||{date:prev,predictions:[],results:[]};prevArchive.predictions=predictions;prevArchive.dailySelectionVersion=DAILY_SELECTION_VERSION}catch{}}if(prevArchive){prevArchive.predictions=Array.isArray(prevArchive.predictions)?prevArchive.predictions.slice(0,10):[];prevArchive.results=resultRows;prevArchive.updatedAt=new Date().toISOString();if(!prevArchive.savedAt)prevArchive.savedAt=prevArchive.updatedAt;await writePersistentArchive(prev,prevArchive)}const todayArchive=await readPersistentArchive(date);const predictions=todayArchive?.dailySelectionVersion===DAILY_SELECTION_VERSION&&todayArchive?.predictions?.length===10?todayArchive.predictions:await buildDailyBest(date);const next=todayArchive||{date,predictions:[],results:[]};next.predictions=predictions;next.dailySelectionVersion=DAILY_SELECTION_VERSION;next.updatedAt=new Date().toISOString();if(!next.savedAt)next.savedAt=next.updatedAt;await writePersistentArchive(date,next);r.json({ok:true,date,previousDate:prev,previousResults:resultRows.length,newDailyBest:predictions.length})}catch(e){r.status(500).json({ok:false,error:e.message})}});
app.get("/{*splat}",(_,r)=>r.sendFile(path.join(__dirname,"public","index.html")));

// Vercel invokes the Express app as a serverless function. Keep the local
// listener for `npm start`, but do not open a second listener inside Vercel.
if (!process.env.VERCEL) app.listen(PORT,()=>console.log("Omegaplus Pro AI listening on "+PORT));
export default app;
