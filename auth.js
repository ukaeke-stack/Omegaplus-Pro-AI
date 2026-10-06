import pg from "pg";
import crypto from "node:crypto";

const {Pool}=pg;
let pool=null;
let initPromise=null;

function getPool(){
  if(!process.env.DATABASE_URL) return null;
  if(!pool){
    pool=new Pool({
      connectionString:process.env.DATABASE_URL,
      max:10,
      idleTimeoutMillis:30000,
      connectionTimeoutMillis:5000,
      ssl:process.env.DATABASE_SSL==="false"?false:{rejectUnauthorized:false}
    });
    pool.on("error",err=>console.error("Postgres pool error:",err.message));
  }
  return pool;
}
export function authDbConfigured(){return Boolean(process.env.DATABASE_URL)}
export async function dbReady(){try{const p=getPool();if(!p)return false;await p.query("select 1");return true}catch{return false}}

async function q(text,params=[]){const p=getPool();if(!p)throw new Error("Account database is not configured.");return p.query(text,params)}

function hashPassword(password,salt=crypto.randomBytes(16).toString("hex")){
  const hash=crypto.pbkdf2Sync(String(password),salt,210000,64,"sha512").toString("hex");
  return {hash,salt};
}
function verifyPassword(password,hash,salt){
  const actual=crypto.pbkdf2Sync(String(password),salt,210000,64,"sha512");
  const expected=Buffer.from(hash,"hex");
  return expected.length===actual.length&&crypto.timingSafeEqual(expected,actual);
}
function token(){return crypto.randomBytes(32).toString("hex")}
function cleanEmail(v){return String(v||"").trim().toLowerCase()}
function safeUser(row){return row?{id:row.id,email:row.email,name:row.name||"",role:row.role,plan:row.plan||"visitor",subscriptionStatus:row.subscription_status||"none",subscriptionExpiresAt:row.subscription_expires_at||null,createdAt:row.created_at}:null}

export async function initAuthDb(){
  if(initPromise)return initPromise;
  initPromise=(async()=>{
    const p=getPool();
    if(!p)return false;
    await p.query(`
      create table if not exists users(
        id uuid primary key default gen_random_uuid(),
        email text not null unique,
        password_hash text not null,
        password_salt text not null,
        name text not null default '',
        role text not null default 'user' check(role in ('user','admin','moderator')),
        plan text not null default 'free',
        is_active boolean not null default true,
        email_verified boolean not null default false,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        last_login_at timestamptz
      );
      create table if not exists password_reset_tokens(
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        token_hash text not null unique,
        expires_at timestamptz not null,
        used_at timestamptz,
        created_at timestamptz not null default now()
      );
      create index if not exists password_reset_tokens_expiry_idx on password_reset_tokens(expires_at);
      create table if not exists sessions(
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        token_hash text not null unique,
        expires_at timestamptz not null,
        created_at timestamptz not null default now(),
        last_seen_at timestamptz not null default now(),
        ip text,
        user_agent text
      );
      create index if not exists sessions_token_idx on sessions(token_hash);
      create index if not exists sessions_expiry_idx on sessions(expires_at);
      create table if not exists plans(
        id text primary key,
        name text not null,
        description text not null default '',
        price_ngn integer not null default 0,
        billing_period text not null default 'monthly',
        features jsonb not null default '[]'::jsonb,
        is_active boolean not null default true,
        paystack_plan_code text,
        created_at timestamptz not null default now()
      );
      alter table plans add column if not exists paystack_plan_code text;
      create table if not exists subscriptions(
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        plan_id text not null references plans(id),
        status text not null default 'pending' check(status in ('pending','active','expired','cancelled','refunded')),
        provider text,
        provider_reference text,
        starts_at timestamptz,
        expires_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create index if not exists subscriptions_user_idx on subscriptions(user_id,status);
      create table if not exists audit_logs(
        id bigserial primary key,
        user_id uuid references users(id) on delete set null,
        action text not null,
        target text,
        metadata jsonb not null default '{}'::jsonb,
        ip text,
        created_at timestamptz not null default now()
      );
      create table if not exists app_settings(
        key text primary key,
        value jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      );
      create table if not exists payments(
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        plan_id text references plans(id),
        provider text not null,
        provider_reference text,
        amount_ngn integer not null default 0,
        status text not null default 'pending',
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(provider,provider_reference)
      );
      create index if not exists payments_user_idx on payments(user_id,created_at desc);
      insert into plans(id,name,description,price_ngn,billing_period,features,paystack_plan_code)
      values
        ('free','Free','Visitor and registered free access',0,'monthly','["limited predictions","basic history"]',null),
        ('pro','Pro','Full prediction access',5000,'monthly','["full predictions","Daily Best 10","football","basketball","history","booking tools"]',null),
        ('premium','Premium','Advanced access for serious users',10000,'monthly','["everything in Pro","priority features","advanced analytics"]',null)
      on conflict(id) do nothing;
      delete from sessions where expires_at < now();
    `);
    await q(`insert into app_settings(key,value) values
      ('subscription_enabled','true'::jsonb),
      ('free_trial_enabled','true'::jsonb),
      ('free_trial_days','3'::jsonb),
      ('registration_enabled','true'::jsonb),
      ('announcement','""'::jsonb),
      ('default_user_plan','"free"'::jsonb)
      on conflict(key) do nothing`);
    await ensureBootstrapAdmin();
    return true;
  })().catch(err=>{initPromise=null;console.error("Auth DB initialization failed:",err.message);return false});
  return initPromise;
}

async function ensureBootstrapAdmin(){
  const email=cleanEmail(process.env.ADMIN_EMAIL);
  const password=String(process.env.ADMIN_PASSWORD||"");
  if(!email||password.length<12)return;
  const found=await q("select id from users where email=$1",[email]);
  if(found.rowCount)return;
  const {hash,salt}=hashPassword(password);
  await q("insert into users(email,password_hash,password_salt,name,role,plan,email_verified) values($1,$2,$3,$4,'admin','premium',true)",[email,hash,salt,"Omegaplus Administrator"]);
  console.log("Omegaplus admin account provisioned for "+email);
}

function sessionHash(raw){return crypto.createHash("sha256").update(raw).digest("hex")}

export async function createSession(user,req){
  const raw=token(),expires=new Date(Date.now()+1000*60*60*24*30);
  await q("insert into sessions(user_id,token_hash,expires_at,ip,user_agent) values($1,$2,$3,$4,$5)",[user.id,sessionHash(raw),expires,req.ip||null,String(req.get("user-agent")||"").slice(0,500)]);
  return {token:raw,expiresAt:expires.toISOString()};
}
export function setSessionCookie(res,raw){
  res.cookie?.("omega_session",raw,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:30*24*60*60*1000});
  if(!res.cookie)res.setHeader("Set-Cookie",`omega_session=${raw}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV==="production"?"; Secure":""}`);
}
export function clearSessionCookie(res){
  res.setHeader("Set-Cookie",`omega_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV==="production"?"; Secure":""}`);
}
function readCookie(req,name){
  const raw=String(req.headers.cookie||"");
  for(const part of raw.split(";")){
    const [k,...rest]=part.trim().split("=");
    if(k===name)return decodeURIComponent(rest.join("="));
  }
  return "";
}
export async function currentUser(req){
  try{
    const raw=readCookie(req,"omega_session")||String(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
    if(!raw)return null;
    const r=await q(`select u.*,case when su.status='active' and (su.expires_at is null or su.expires_at>now()) then su.plan else 'free' end as plan,case when su.status='active' and su.expires_at is not null and su.expires_at<=now() then 'expired' else coalesce(su.status,'none') end as subscription_status,su.expires_at as subscription_expires_at
      from sessions s join users u on u.id=s.user_id
      left join lateral(select plan_id as plan,status,expires_at from subscriptions where user_id=u.id order by case when status='active' and (expires_at is null or expires_at>now()) then 0 else 1 end,created_at desc limit 1) su on true
      where s.token_hash=$1 and s.expires_at>now() and u.is_active=true`,[sessionHash(raw)]);
    if(!r.rowCount)return null;
    await q("update sessions set last_seen_at=now() where token_hash=$1",[sessionHash(raw)]).catch(()=>{});
    return safeUser(r.rows[0]);
  }catch{return null}
}
export async function requireAuth(req,res,next){
  const user=await currentUser(req);
  if(!user)return res.status(401).json({ok:false,error:"Login required.",code:"AUTH_REQUIRED"});
  req.user=user;next();
}
export function requireRole(...roles){
  return async(req,res,next)=>{
    const user=req.user||await currentUser(req);
    if(!user)return res.status(401).json({ok:false,error:"Login required.",code:"AUTH_REQUIRED"});
    if(!roles.includes(user.role))return res.status(403).json({ok:false,error:"Administrator access required.",code:"ADMIN_REQUIRED"});
    req.user=user;next();
  };
}
export async function requirePaid(req,res,next){
  const user=req.user||await currentUser(req);
  if(!user)return res.status(401).json({ok:false,error:"Login required.",code:"AUTH_REQUIRED"});
  const settings=await getAccessSettings();
  if(settings.subscriptionEnabled===false || user.role==="admin"){req.user=user;return next();}
  const paid=["pro","premium"].includes(user.plan)&&["active","none"].includes(user.subscriptionStatus);
  if(!paid)return res.status(402).json({ok:false,error:"An active paid plan is required for this feature.",code:"PAID_REQUIRED",plan:user.plan,subscriptionStatus:user.subscriptionStatus});
  req.user=user;next();
}
export async function audit(req,action,target="",metadata={}){
  try{await q("insert into audit_logs(user_id,action,target,metadata,ip) values($1,$2,$3,$4,$5)",[req.user?.id||null,action,target,metadata,req.ip||null])}catch{}
}
export async function createAdminUser({email,password,name=""},req){
  email=cleanEmail(email);
  if(!email||!/^\S+@\S+\.\S+$/.test(email))throw new Error("Enter a valid email address.");
  if(String(password||"").length<12)throw new Error("Administrator password must be at least 12 characters.");
  const exists=await q("select id from users where email=$1",[email]);
  if(exists.rowCount)throw new Error("An account with this email already exists. Promote the existing account instead.");
  const {hash,salt}=hashPassword(password);
  const r=await q("insert into users(email,password_hash,password_salt,name,role,plan,email_verified) values($1,$2,$3,$4,'admin','premium',true) returning id,email,name,role,plan,is_active,email_verified,created_at,last_login_at",[email,hash,salt,String(name||"").trim().slice(0,100)]);
  await audit(req,"admin.account.create",r.rows[0].id,{email});
  return r.rows[0];
}
export async function registerUser({email,password,name=""},req){
  const settings=await getAccessSettings();
  if(!settings.registrationEnabled)throw new Error("New account registration is currently disabled.");
  email=cleanEmail(email);
  if(!email||!/^\S+@\S+\.\S+$/.test(email))throw new Error("Enter a valid email address.");
  if(String(password||"").length<8)throw new Error("Password must be at least 8 characters.");
  const exists=await q("select id from users where email=$1",[email]);
  if(exists.rowCount)throw new Error("An account with this email already exists.");
  const {hash,salt}=hashPassword(password);
  const r=await q("insert into users(email,password_hash,password_salt,name,role,plan) values($1,$2,$3,$4,'user',$5) returning *",[email,hash,salt,String(name||"").trim().slice(0,100),settings.defaultUserPlan]);
  const user=safeUser(r.rows[0]);
  await audit({user},"account.register");
  return user;
}
export async function requestPasswordReset(email,req){
  email=cleanEmail(email);
  const r=await q("select id,email,name from users where email=$1 and is_active=true",[email]);
  const generic={message:"If an account exists for that email, a password-reset link has been sent."};
  if(!r.rowCount)return generic;
  const raw=token(),hash=sessionHash(raw),expires=new Date(Date.now()+30*60*1000);
  await q("update password_reset_tokens set used_at=now() where user_id=$1 and used_at is null",[r.rows[0].id]);
  await q("insert into password_reset_tokens(user_id,token_hash,expires_at) values($1,$2,$3)",[r.rows[0].id,hash,expires]);
  const base=String(process.env.PUBLIC_APP_URL||"https://omegaplus-pro-ai.vercel.app").replace(/\/$/,"");
  const link=base+"/reset-password.html?token="+encodeURIComponent(raw);
  const key=String(process.env.RESEND_API_KEY||"");
  const from=String(process.env.RESEND_FROM||"");
  if(!key||!from)throw new Error("Password reset email service is not configured yet.");
  const html="<p>Hello "+String(r.rows[0].name||"there").replace(/[<>]/g,"")+",</p><p>We received a request to reset your Omegaplus Pro AI password.</p><p><a href='"+link+"'>Reset your password</a></p><p>This link expires in 30 minutes. If you did not request this, you can ignore this email.</p>";
  const res=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},body:JSON.stringify({from,to:[email],subject:"Omegaplus Pro AI password reset",html})});
  if(!res.ok)throw new Error("Unable to send the password reset email right now.");
  await audit({user:{id:r.rows[0].id}},"account.password_reset.request",r.rows[0].id);
  return generic;
}
export async function resetPassword(raw,newPassword){
  const password=String(newPassword||"");
  if(password.length<8)throw new Error("Password must be at least 8 characters.");
  const tokenValue=String(raw||"").trim();
  if(!tokenValue)throw new Error("Reset link is invalid or expired.");
  const r=await q("select id,user_id from password_reset_tokens where token_hash=$1 and used_at is null and expires_at>now()",[sessionHash(tokenValue)]);
  if(!r.rowCount)throw new Error("Reset link is invalid or expired.");
  const {hash,salt}=hashPassword(password);
  await q("update users set password_hash=$1,password_salt=$2,updated_at=now() where id=$3",[hash,salt,r.rows[0].user_id]);
  await q("update password_reset_tokens set used_at=now() where id=$1",[r.rows[0].id]);
  await q("delete from sessions where user_id=$1",[r.rows[0].user_id]);
  await audit({user:{id:r.rows[0].user_id}},"account.password_reset.complete",r.rows[0].user_id);
  return {ok:true};
}

export async function loginUser({email,password},req){
  email=cleanEmail(email);
  const r=await q("select * from users where email=$1 and is_active=true",[email]);
  if(!r.rowCount||!verifyPassword(password,r.rows[0].password_hash,r.rows[0].password_salt))throw new Error("Invalid email or password.");
  await q("update users set last_login_at=now(),updated_at=now() where id=$1",[r.rows[0].id]);
  const user=safeUser(r.rows[0]),session=await createSession(user,req);
  await audit({user},"account.login");
  return {user,session};
}
export async function logoutUser(req){
  const raw=readCookie(req,"omega_session")||String(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  if(raw)await q("delete from sessions where token_hash=$1",[sessionHash(raw)]).catch(()=>{});
}
export async function adminUsers({page=1,limit=50,search=""}={}){
  const pageNum=Math.max(1,Number(page)||1),size=Math.min(100,Math.max(1,Number(limit)||50)),offset=(pageNum-1)*size;
  const term=String(search||"").trim().toLowerCase();
  const r=term
    ?await q("select id,email,name,role,plan,is_active,email_verified,created_at,last_login_at from users where lower(email) like $1 or lower(name) like $1 order by created_at desc limit $2 offset $3",["%"+term+"%",size,offset])
    :await q("select id,email,name,role,plan,is_active,email_verified,created_at,last_login_at from users order by created_at desc limit $1 offset $2",[size,offset]);
  return r.rows;
}
export async function setUserAccess(id,{role,plan,isActive}){
  const fields=[],params=[],add=(sql,v)=>{params.push(v);fields.push(sql.replace("$X","$"+params.length))};
  if(["user","moderator","admin"].includes(role))add("role=$X",role);
  if(["free","pro","premium"].includes(plan))add("plan=$X",plan);
  if(typeof isActive==="boolean")add("is_active=$X",isActive);
  if(!fields.length)throw new Error("No valid account changes supplied.");
  params.push(id);
  const r=await q("update users set "+fields.join(",")+",updated_at=now() where id=$"+params.length+" returning id,email,name,role,plan,is_active,email_verified,created_at,last_login_at",params);
  if(!r.rowCount)throw new Error("User not found.");
  return r.rows[0];
}
export async function revokeAllSessions(){
  const r=await q("delete from sessions returning id");
  return Number(r.rowCount||0);
}
export async function adminStats(){
  const r=await q(`select
    (select count(*) from users) as users,
    (select count(*) from users where is_active) as active_users,
    (select count(*) from users where role='admin') as admins,
    (select count(*) from users where plan in ('pro','premium')) as paid_users,
    (select count(*) from sessions where expires_at>now()) as active_sessions,
    (select count(*) from audit_logs where created_at>now()-interval '24 hours') as audits_24h`);
  return Object.fromEntries(Object.entries(r.rows[0]).map(([k,v])=>[k,Number(v)]));
}
export async function listPlans(){const r=await q("select id,name,description,price_ngn,billing_period,features,is_active,paystack_plan_code from plans where is_active order by price_ngn");return r.rows}
export async function createOrUpdatePlan(body){
  const id=String(body.id||"").trim().toLowerCase().replace(/[^a-z0-9_-]/g,"-").slice(0,40);
  if(!id)throw new Error("Plan ID is required.");
  const r=await q(`insert into plans(id,name,description,price_ngn,billing_period,features,is_active,paystack_plan_code)
    values($1,$2,$3,$4,$5,$6,$7,$8)
    on conflict(id) do update set name=excluded.name,description=excluded.description,price_ngn=excluded.price_ngn,billing_period=excluded.billing_period,features=excluded.features,is_active=excluded.is_active,paystack_plan_code=excluded.paystack_plan_code`,[id,String(body.name||id),String(body.description||""),Math.max(0,Math.round(Number(body.priceNgn)||0)),String(body.billingPeriod||"monthly"),JSON.stringify(Array.isArray(body.features)?body.features:[]),body.isActive!==false,body.paystackPlanCode||null]);
  return r.rows[0]||{id};
}
export async function activateSubscription(userId,planId,days=30,provider="admin"){
  if(!["pro","premium"].includes(planId))throw new Error("Only paid plans can be activated.");
  const exists=await q("select id from plans where id=$1 and is_active",[planId]);if(!exists.rowCount)throw new Error("Plan not found.");
  const r=await q("insert into subscriptions(user_id,plan_id,status,provider,starts_at,expires_at) values($1,$2,'active',$3,now(),now()+make_interval(days=>$4)) returning *",[userId,planId,provider,Math.max(1,Math.min(3650,Number(days)||30))]);
  await q("update users set plan=$1,updated_at=now() where id=$2",[planId,userId]);
  return r.rows[0];
}
export async function revokeSubscription(userId){
  await q("update subscriptions set status='cancelled',updated_at=now() where user_id=$1 and status='active'",[userId]);
  await q("update users set plan='free',updated_at=now() where id=$1",[userId]);
}

export async function getAccessSettings(){
  const r=await q("select key,value from app_settings where key in ('subscription_enabled','free_trial_enabled','free_trial_days','registration_enabled','announcement','default_user_plan')");
  const map=Object.fromEntries(r.rows.map(x=>[x.key,x.value]));
  const bool=v=>v===true||v==="true"||v===1||v==="1";
  return {
    subscriptionEnabled: map.subscription_enabled===undefined?true:bool(map.subscription_enabled),
    freeTrialEnabled: map.free_trial_enabled===undefined?true:bool(map.free_trial_enabled),
    freeTrialDays: Math.max(0,Math.min(365,Number(map.free_trial_days)||0)),
    registrationEnabled: map.registration_enabled===undefined?true:bool(map.registration_enabled),
    announcement: String(map.announcement||"").slice(0,500),
    defaultUserPlan: ["free","pro","premium"].includes(String(map.default_user_plan||""))?String(map.default_user_plan):"free"
  };
}
export async function updateAccessSettings(body={}){
  const current=await getAccessSettings();
  const next={
    subscriptionEnabled: typeof body.subscriptionEnabled==="boolean"?body.subscriptionEnabled:current.subscriptionEnabled,
    freeTrialEnabled: typeof body.freeTrialEnabled==="boolean"?body.freeTrialEnabled:current.freeTrialEnabled,
    freeTrialDays: body.freeTrialDays===undefined?current.freeTrialDays:Math.max(0,Math.min(365,Math.round(Number(body.freeTrialDays)||0))),
    registrationEnabled: typeof body.registrationEnabled==="boolean"?body.registrationEnabled:current.registrationEnabled,
    announcement: body.announcement===undefined?current.announcement:String(body.announcement||"").trim().slice(0,500),
    defaultUserPlan: ["free","pro","premium"].includes(String(body.defaultUserPlan||""))?String(body.defaultUserPlan):current.defaultUserPlan
  };
  for(const [key,value] of [["subscription_enabled",next.subscriptionEnabled],["free_trial_enabled",next.freeTrialEnabled],["free_trial_days",next.freeTrialDays],["registration_enabled",next.registrationEnabled],["announcement",next.announcement],["default_user_plan",next.defaultUserPlan]]){
    await q("insert into app_settings(key,value,updated_at) values($1,$2,now()) on conflict(key) do update set value=excluded.value,updated_at=now()",[key,JSON.stringify(value)]);
  }
  return next;
}
export async function grantFreeTrial(userId,days){
  const settings=await getAccessSettings();
  if(!settings.freeTrialEnabled)throw new Error("Free trials are currently disabled by the administrator.");
  const n=Math.max(1,Math.min(365,Number(days)||settings.freeTrialDays||3));
  const r=await q("insert into subscriptions(user_id,plan_id,status,provider,starts_at,expires_at) values($1,'pro','active','admin_free_trial',now(),now()+make_interval(days=>$2)) returning *",[userId,n]);
  await q("update users set plan='pro',updated_at=now() where id=$1",[userId]);
  return r.rows[0];
}
export async function paymentHistory(userId){
  const r=await q("select id,plan_id,provider,provider_reference,amount_ngn,status,metadata,created_at,updated_at from payments where user_id=$1 order by created_at desc limit 100",[userId]);
  return r.rows;
}
export async function createPaymentRecord(data){
  const r=await q("insert into payments(user_id,plan_id,provider,provider_reference,amount_ngn,status,metadata) values($1,$2,$3,$4,$5,$6,$7) on conflict(provider,provider_reference) do update set status=excluded.status,metadata=excluded.metadata,updated_at=now() returning *",[data.userId,data.planId||null,data.provider,data.reference||null,Math.max(0,Number(data.amountNgn)||0),data.status||"pending",JSON.stringify(data.metadata||{})]);
  return r.rows[0];
}

export async function activateProviderSubscription(userId,planId,provider,reference,days=30,metadata={}){
  if(!["pro","premium"].includes(planId))throw new Error("Only paid plans can be activated.");
  const exists=await q("select id from plans where id=$1 and is_active",[planId]);
  if(!exists.rowCount)throw new Error("Plan not found.");
  const existing=reference?await q("select * from payments where provider=$1 and provider_reference=$2",[provider,reference]):{rowCount:0};
  if(existing.rowCount && existing.rows[0].status==="success")return existing.rows[0];
  const subscription=await q("insert into subscriptions(user_id,plan_id,status,provider,starts_at,expires_at) values($1,$2,'active',$3,now(),now()+make_interval(days=>$4)) returning *",[userId,planId,provider,Math.max(1,Math.min(3650,Number(days)||30))]);
  await q("update users set plan=$1,updated_at=now() where id=$2",[planId,userId]);
  const payment=await createPaymentRecord({userId,planId,provider,reference,amountNgn:metadata.amountNgn||0,status:"success",metadata:{...metadata,subscriptionId:subscription.rows[0].id}});
  return {subscription:subscription.rows[0],payment};
}
