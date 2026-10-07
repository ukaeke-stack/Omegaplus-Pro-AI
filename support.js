import pg from "pg";

const {Pool}=pg;
let pool=null;
let initPromise=null;

function getPool(){
  if(!process.env.DATABASE_URL)return null;
  if(!pool) pool=new Pool({
    connectionString:process.env.DATABASE_URL,
    max:10,
    idleTimeoutMillis:30000,
    connectionTimeoutMillis:5000,
    ssl:process.env.DATABASE_SSL==="false"?false:{rejectUnauthorized:false}
  });
  return pool;
}
async function q(sql,params=[]){
  const p=getPool();
  if(!p)throw new Error("Account database is not configured.");
  return p.query(sql,params);
}
function clean(v,max=5000){return String(v??"").trim().slice(0,max)}
function requireText(v,label){const x=clean(v);if(!x)throw new Error(label+" is required.");return x}

export async function initSupportDb(){
  if(initPromise)return initPromise;
  initPromise=(async()=>{
    if(!getPool())return false;
    await q(`
      create table if not exists support_tickets(
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        type text not null check(type in ('feedback','suggestion','message')),
        subject text not null default '',
        body text not null,
        status text not null default 'open' check(status in ('open','in_progress','resolved','closed')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create index if not exists support_tickets_user_idx on support_tickets(user_id,created_at desc);
      create index if not exists support_tickets_status_idx on support_tickets(status,updated_at desc);
      create table if not exists chat_threads(
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null unique references users(id) on delete cascade,
        status text not null default 'open' check(status in ('open','closed')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table if not exists chat_messages(
        id bigserial primary key,
        thread_id uuid not null references chat_threads(id) on delete cascade,
        sender_user_id uuid not null references users(id) on delete cascade,
        sender_role text not null check(sender_role in ('user','admin','moderator')),
        message text not null,
        created_at timestamptz not null default now()
      );
      create index if not exists chat_messages_thread_idx on chat_messages(thread_id,id);
    `);
    return true;
  })().catch(e=>{initPromise=null;console.error("Support DB initialization failed:",e.message);return false});
  return initPromise;
}

export async function createTicket(user,{type,subject,body}){
  if(!["feedback","suggestion","message"].includes(type))throw new Error("Invalid support type.");
  const b=requireText(body,"Message");
  const s=clean(subject,200);
  const r=await q("insert into support_tickets(user_id,type,subject,body) values($1,$2,$3,$4) returning id,type,subject,body,status,created_at,updated_at",[user.id,type,s,b]);
  return r.rows[0];
}

export async function listUserTickets(user){
  const r=await q("select id,type,subject,body,status,created_at,updated_at from support_tickets where user_id=$1 order by created_at desc limit 100",[user.id]);
  return r.rows;
}

export async function getOrCreateChat(user){
  let r=await q("select id,status,created_at,updated_at from chat_threads where user_id=$1",[user.id]);
  if(!r.rowCount){
    r=await q("insert into chat_threads(user_id) values($1) returning id,status,created_at,updated_at",[user.id]);
  }
  return r.rows[0];
}

export async function listChatMessages(user,threadId){
  const t=await q("select id from chat_threads where id=$1 and user_id=$2",[threadId,user.id]);
  if(!t.rowCount)throw new Error("Chat thread not found.");
  const r=await q(`select m.id,m.message,m.sender_role,m.created_at,u.name,u.email
    from chat_messages m join users u on u.id=m.sender_user_id
    where m.thread_id=$1 order by m.id asc limit 500`,[threadId]);
  return r.rows;
}

export async function addChatMessage(user,threadId,message){
  const b=requireText(message,"Message");
  const t=await q("select id,status from chat_threads where id=$1 and user_id=$2",[threadId,user.id]);
  if(!t.rowCount)throw new Error("Chat thread not found.");
  if(t.rows[0].status==="closed")throw new Error("This chat is closed.");
  const r=await q("insert into chat_messages(thread_id,sender_user_id,sender_role,message) values($1,$2,$3,$4) returning id,message,sender_role,created_at",[threadId,user.id,user.role,b]);
  await q("update chat_threads set updated_at=now() where id=$1",[threadId]);
  return r.rows[0];
}

export async function adminTickets(){
  const r=await q(`select t.id,t.type,t.subject,t.body,t.status,t.created_at,t.updated_at,
    u.email,u.name,u.id as user_id
    from support_tickets t join users u on u.id=t.user_id
    order by case when t.status='open' then 0 when t.status='in_progress' then 1 else 2 end,t.updated_at desc limit 500`);
  return r.rows;
}

export async function updateTicket(id,status){
  if(!["open","in_progress","resolved","closed"].includes(status))throw new Error("Invalid ticket status.");
  const r=await q("update support_tickets set status=$1,updated_at=now() where id=$2 returning id,status,updated_at",[status,id]);
  if(!r.rowCount)throw new Error("Ticket not found.");
  return r.rows[0];
}

export async function adminThreads(){
  const r=await q(`select t.id,t.user_id,t.status,t.created_at,t.updated_at,u.email,u.name,
    (select count(*) from chat_messages m where m.thread_id=t.id) as message_count
    from chat_threads t join users u on u.id=t.user_id
    order by t.updated_at desc limit 500`);
  return r.rows;
}

export async function adminMessages(threadId){
  const r=await q(`select m.id,m.message,m.sender_role,m.created_at,u.email,u.name
    from chat_messages m join users u on u.id=m.sender_user_id
    where m.thread_id=$1 order by m.id asc limit 1000`,[threadId]);
  return r.rows;
}

export async function adminAddMessage(admin,threadId,message){
  const b=requireText(message,"Message");
  const t=await q("select id,status from chat_threads where id=$1",[threadId]);
  if(!t.rowCount)throw new Error("Chat thread not found.");
  if(t.rows[0].status==="closed")throw new Error("This chat is closed.");
  const r=await q("insert into chat_messages(thread_id,sender_user_id,sender_role,message) values($1,$2,'admin',$3) returning id,message,sender_role,created_at",[threadId,admin.id,b]);
  await q("update chat_threads set updated_at=now() where id=$1",[threadId]);
  return r.rows[0];
}

export async function setThreadStatus(threadId,status){
  if(!["open","closed"].includes(status))throw new Error("Invalid chat status.");
  const r=await q("update chat_threads set status=$1,updated_at=now() where id=$2 returning id,status,updated_at",[status,threadId]);
  if(!r.rowCount)throw new Error("Chat thread not found.");
  return r.rows[0];
}
