import pg from "pg";

const {Pool}=pg;
let pool=null;
let initPromise=null;

function getPool(){
  if(!process.env.DATABASE_URL)return null;
  if(!pool){
    pool=new Pool({
      connectionString:process.env.DATABASE_URL,
      max:5,
      idleTimeoutMillis:30000,
      connectionTimeoutMillis:5000,
      ssl:process.env.DATABASE_SSL==="false"?false:{rejectUnauthorized:false}
    });
    pool.on("error",err=>console.error("History database pool error:",err.message));
  }
  return pool;
}

export async function initHistoryStore(){
  if(initPromise)return initPromise;
  initPromise=(async()=>{
    const p=getPool();
    if(!p)return false;
    await p.query(`
      create table if not exists omegaplus_history_archives(
        sport text not null,
        archive_date text not null,
        archive jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key(sport,archive_date)
      );
      create index if not exists omegaplus_history_date_idx
        on omegaplus_history_archives(archive_date desc,sport);
    `);
    return true;
  })().catch(e=>{
    initPromise=null;
    console.error("Central history database initialization failed:",e.message);
    return false;
  });
  return initPromise;
}

function validate(date,sport){
  if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(date||"")))throw new Error("A valid YYYY-MM-DD history date is required.");
  if(!/^[a-z0-9_-]{1,40}$/i.test(String(sport||"")))throw new Error("Invalid sport for history archive.");
}

export async function readHistoryArchive(date,sport="football"){
  validate(date,sport);
  const p=getPool();
  if(!p)throw new Error("Central history database is not configured (DATABASE_URL is missing).");
  await initHistoryStore();
  const result=await p.query(
    "select archive from omegaplus_history_archives where sport=$1 and archive_date=$2",
    [sport,date]
  );
  return result.rows[0]?.archive||null;
}

export async function saveHistoryArchive(date,sport="football",archive={}){
  validate(date,sport);
  const p=getPool();
  if(!p)throw new Error("Central history database is not configured (DATABASE_URL is missing).");
  await initHistoryStore();
  const payload=JSON.stringify(archive&&typeof archive==="object"?archive:{});
  const result=await p.query(`
    insert into omegaplus_history_archives(sport,archive_date,archive)
    values($1,$2,$3::jsonb)
    on conflict(sport,archive_date) do update
      set archive=omegaplus_history_archives.archive || excluded.archive,
          updated_at=now()
    returning archive
  `,[sport,date,payload]);
  return result.rows[0]?.archive||null;
}
