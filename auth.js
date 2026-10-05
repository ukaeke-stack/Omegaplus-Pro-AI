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
        created_at timestamptz not null default now()
      );
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
      insert into plans(id,name,description,price_ngn,billing_period,features)
      values
        ('free','Free','Visitor and registered free access',0,'monthly','["limited predictions","basic history"]'),
        ('pro','Pro','Full prediction access',5000,'monthly','["full predictions","Daily Best 10","football","basketball","history","booking tools"]'),
        ('premium','Premium','Advanced access for serious users',10000,'monthly','["everything in Pro","priority features","advanced analytics"]')
      on conflict(id) do nothing;
      delete from sessions where expires_at < now();
    `);
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
    const r=await q(`select u.*,coalesce(su.plan,u.plan) as plan,coalesce(su.status,'none') as subscription_status,su.expires_at as subscription_expires_at
      from sessions s join users u on u.id=s.user_id
      left join lateral(select plan_id as plan,status,expires_at from subscriptions where user_id=u.id order by case when status='active' then 0 else 1 end,created_at desc limit 1) su on true
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
  const paid=["pro","premium"].includes(user.plan)&&(["active","none"].includes(user.subscriptionStatus)||user.role==="admin");
  if(!paid)return res.status(402).json({ok:false,error:"An active paid plan is required for this feature.",code:"PAID_REQUIRED",plan:user.plan,subscriptionStatus:user.subscriptionStatus});
  req.user=user;next();
}
export async function audit(req,action,target="",metadata={}){
  try{await q("insert into audit_logs(user_id,action,target,metadata,ip) values($1,$2,$3,$4,$5)",[req.user?.id||null,action,target,metadata,req.ip||null])}catch{}
}
export async function registerUser({email,password,name=""},req){
  email=cleanEmail(email);
  if(!email||!/^\S+@\S+\.\S+$/.test(email))throw new Error("Enter a valid email address.");
  if(String(password||"").length<8)throw new Error("Password must be at least 8 characters.");
  const exists=await q("select id from users where email=$1",[email]);
  if(exists.rowCount)throw new Error("An account with this email already exists.");
  const {hash,salt}=hashPassword(password);
  const r=await q("insert into users(email,password_hash,password_salt,name,role,plan) values($1,$2,$3,$4,'user','free') returning *",[email,hash,salt,String(name||"").trim().slice(0,100)]);
  const user=safeUser(r.rows[0]);
  await audit({user},"account.register");
  return user;
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
  const offset=(Math.max(1,page)-1)*Math.min(100,Math.max(1,limit)),size=Math.min(100,Math.max(1,limit));
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
export async function listPlans(){const r=await q("select id,name,description,price_ngn,billing_period,features,is_active from plans where is_active order by price_ngn");return r.rows}
export async function createOrUpdatePlan(body){
  const id=String(body.id||"").trim().toLowerCase().replace(/[^a-z0-9_-]/g,"-").slice(0,40);
  if(!id)throw new Error("Plan ID is required.");
  const r=await q(`insert into plans(id,name,description,price_ngn,billing_period,features,is_active)
    values($1,$2,$3,$4,$5,$6,$7)
    on conflict(id) do update set name=excluded.name,description=excluded.description,price_ngn=excluded.price_ngn`,[id,String(body.name||id),String(body.description||""),Math.max(0,Math.round(Number(body.priceNgn)||0)),String(body.billingPeriod||"monthly"),JSON.stringify(Array.isArray(body.features)?body.features:[]),body.isActive!==false]);
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
