(()=>{const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}async function api(url,opt={}){const r=await fetch(url,{...opt,headers:{"content-type":"application/json",...(opt.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Request failed");return d}
async function me(){try{return await api("/api/auth/me")}catch{return{ok:false}}}
function userRow(x){return '<tr><td>'+esc(x.email)+'</td><td>'+esc(x.name)+'</td><td><select data-id="'+x.id+'" data-field="role"><option '+(x.role==="user"?"selected":"")+' value="user">user</option><option '+(x.role==="moderator"?"selected":"")+' value="moderator">moderator</option><option '+(x.role==="admin"?"selected":"")+' value="admin">admin</option></select></td><td><select data-id="'+x.id+'" data-field="plan"><option '+(x.plan==="free"?"selected":"")+' value="free">free</option><option '+(x.plan==="pro"?"selected":"")+' value="pro">pro</option><option '+(x.plan==="premium"?"selected":"")+' value="premium">premium</option></select></td><td>'+String(x.is_active)+'</td><td><div class="row"><input data-days="'+x.id+'" type="number" min="1" max="3650" value="30" style="width:72px"><button class="btn primary" data-premium="'+x.id+'">Grant Premium</button><button class="btn" data-trial="'+x.id+'">Free Trial</button><button class="btn" data-activate="'+x.id+'">Grant Pro</button><button class="btn" data-revoke="'+x.id+'">Revoke</button><button class="btn" data-active="'+x.id+'">'+(x.is_active?"Disable":"Enable")+'</button></div></td></tr>'}
async function loadAccess(){const d=await api("/api/admin/access-settings");$("#subscriptionEnabled").checked=!!d.settings.subscriptionEnabled;$("#freeTrialEnabled").checked=!!d.settings.freeTrialEnabled;$("#freeTrialDays").value=d.settings.freeTrialDays||3;$("#registrationEnabled").checked=d.settings.registrationEnabled!==false;$("#defaultUserPlan").value=d.settings.defaultUserPlan||"free";$("#announcement").value=d.settings.announcement||""}
async function load(){const [s,u,p]=await Promise.all([api("/api/admin/stats"),api("/api/admin/users"),api("/api/plans")]);$("#users").textContent=s.stats.users;$("#paid").textContent=s.stats.paid_users;$("#sessions").textContent=s.stats.active_sessions;$("#audits").textContent=s.stats.audits_24h;$("#usersBody").innerHTML=(u.users||[]).map(userRow).join("");$("#plans").innerHTML=(p.plans||[]).map(x=>'<div class="card"><b>'+esc(x.name)+'</b> — ₦'+Number(x.price_ngn).toLocaleString()+' / '+esc(x.billing_period)+'<div class="muted">'+esc(x.description)+'</div><small class="muted">Paystack plan: '+esc(x.paystack_plan_code||"not configured")+'</small></div>').join("");bindUsers()}
function bindUsers(){
$$("#usersBody select").forEach(x=>x.onchange=async()=>{const id=x.dataset.id,role=$('[data-id="'+id+'"][data-field="role"]').value,plan=$('[data-id="'+id+'"][data-field="plan"]').value;try{await api("/api/admin/users/"+id,{method:"PATCH",body:JSON.stringify({role,plan})});$("#status").textContent="User updated."}catch(e){$("#status").textContent=e.message}});
$$("#usersBody [data-premium]").forEach(b=>b.onclick=async()=>{try{const days=Math.max(1,Math.min(3650,Number($('[data-days="'+b.dataset.premium+'"]').value)||30));await api("/api/admin/users/"+b.dataset.premium+"/grant-premium",{method:"POST",body:JSON.stringify({days,reason:"Manual premium access grant"})});await load();$("#status").textContent="Premium access granted for "+days+" day(s), regardless of payment."}catch(e){$("#status").textContent=e.message}});
$$("#usersBody [data-trial]").forEach(b=>b.onclick=async()=>{try{const days=Math.max(1,Math.min(365,Number($('[data-days="'+b.dataset.trial+'"]').value)||3));await api("/api/admin/users/"+b.dataset.trial+"/free-trial",{method:"POST",body:JSON.stringify({days})});await load();$("#status").textContent="Free trial granted."}catch(e){$("#status").textContent=e.message}});
$$("#usersBody [data-activate]").forEach(b=>b.onclick=async()=>{try{const days=Math.max(1,Math.min(3650,Number($('[data-days="'+b.dataset.activate+'"]').value)||30));await api("/api/admin/users/"+b.dataset.activate+"/subscription",{method:"POST",body:JSON.stringify({plan:"pro",days})});await load();$("#status").textContent="Pro access granted for "+days+" day(s)."}catch(e){$("#status").textContent=e.message}});
$$("#usersBody [data-revoke]").forEach(b=>b.onclick=async()=>{try{await api("/api/admin/users/"+b.dataset.revoke+"/subscription",{method:"DELETE"});await load();$("#status").textContent="Subscription revoked."}catch(e){$("#status").textContent=e.message}});
$$("#usersBody [data-active]").forEach(b=>b.onclick=async()=>{try{await api("/api/admin/users/"+b.dataset.active,{method:"PATCH",body:JSON.stringify({isActive:b.textContent==="Enable"})});await load();$("#status").textContent="Account status updated."}catch(e){$("#status").textContent=e.message}});
}

async function loadPredictionSettings(){
  const d=await api("/api/admin/prediction-settings");
  const s=d.settings||{};
  $("#predMinConfidence").value=s.minConfidence??60;
  $("#predMaxGames").value=s.maxGames??20;
  $("#predDailyCount").value=s.dailyBestCount??10;
  $("#predMinOdds").value=s.minOdds??1.1;
  $("#predCorrectScore").checked=s.correctScoreEnabled!==false;
  $(".pred-market").forEach(x=>x.checked=(s.allowedMarkets||[]).includes(x.value));
}
async function loadHealth(){
  const s=$("#healthStatus");s.textContent="Checking…";
  try{
    const d=await api("/api/health");
    $("#healthDb").textContent=d.accountSystem?.ready?"READY":"UNAVAILABLE";
    $("#healthSporty").textContent=d.liveSportyBet?"CONNECTED":"UNAVAILABLE";
    const i=d.independentStats||{};
    $("#healthStats").textContent=(i.sofascore?"SofaScore ":"")+(i.understat?"Understat":"")||"Limited";
    $("#healthVersion").textContent="v"+(d.version||"—");
    s.textContent="Health check completed.";
  }catch(e){s.textContent=e.message}
}
$("#savePredictionSettings").onclick=async()=>{
  try{
    const allowed=$(".pred-market:checked").map(x=>x.value);
    const d=await api("/api/admin/prediction-settings",{method:"PATCH",body:JSON.stringify({
      minConfidence:Number($("#predMinConfidence").value)||60,maxGames:Number($("#predMaxGames").value)||20,
      dailyBestCount:Number($("#predDailyCount").value)||10,minOdds:Number($("#predMinOdds").value)||1.1,
      correctScoreEnabled:$("#predCorrectScore").checked,allowedMarkets:allowed
    })});
    $("#predictionSettingsStatus").textContent="Prediction controls saved.";
  }catch(e){$("#predictionSettingsStatus").textContent=e.message}
};
$("#refreshHealth").onclick=loadHealth;
$("#createAdmin").onclick=async()=>{try{const name=$("#adminName").value.trim(),email=$("#adminEmail").value.trim(),password=$("#adminPassword").value;if(!email||!password)throw new Error("Email and password are required.");const d=await api("/api/admin/create-admin",{method:"POST",body:JSON.stringify({name,email,password})});$("#adminCreateStatus").textContent="Administrator created: "+d.user.email;$("#adminName").value="";$("#adminEmail").value="";$("#adminPassword").value="";await load()}catch(e){$("#adminCreateStatus").textContent=e.message}};
$("#saveAccess").onclick=async()=>{try{const d=await api("/api/admin/access-settings",{method:"PATCH",body:JSON.stringify({subscriptionEnabled:$("#subscriptionEnabled").checked,freeTrialEnabled:$("#freeTrialEnabled").checked,freeTrialDays:Number($("#freeTrialDays").value)||3,registrationEnabled:$("#registrationEnabled").checked,defaultUserPlan:$("#defaultUserPlan").value,announcement:$("#announcement").value})});$("#accessStatus").textContent="Saved. Subscription requirement is "+(d.settings.subscriptionEnabled?"ON":"OFF")+"; free trials are "+(d.settings.freeTrialEnabled?"ON":"OFF")+"."; }catch(e){$("#accessStatus").textContent=e.message}};
$("#loginBtn").onclick=async()=>{try{const d=await api("/api/auth/login",{method:"POST",body:JSON.stringify({email:$("#email").value,password:$("#password").value})});if(d.user.role!=="admin")throw new Error("This account is not an administrator.");$("#login").classList.add("hidden");$("#panel").classList.remove("hidden");$("#who").textContent=d.user.email;await loadAccess();await load()}catch(e){$("#loginStatus").textContent=e.message}};
$("#logout").onclick=async()=>{await api("/api/auth/logout",{method:"POST"}).catch(()=>{});location.reload()};$("#refreshUsers").onclick=load;$("#searchBtn").onclick=async()=>{try{const d=await api("/api/admin/users?search="+encodeURIComponent($("#search").value));$("#usersBody").innerHTML=(d.users||[]).map(userRow).join("");bindUsers()}catch(e){$("#status").textContent=e.message}};
(async()=>{const d=await me();if(d.ok&&d.user?.role==="admin"){$("#login").classList.add("hidden");$("#panel").classList.remove("hidden");$("#who").textContent=d.user.email;try{await loadAccess();await load();await loadPredictionSettings();await loadHealth()}catch(e){$("#status").textContent=e.message}}})();})()