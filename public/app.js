const state={dates:[new Date().toISOString().slice(0,10)],leagues:[],markets:new Set(["ou"]),options:new Set(["Over 1.5"]),rows:[],slip:new Map()};
const $=s=>document.querySelector(s),esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const options={ou:["Over 0.5","Over 1.5","Over 2.5","Over 3.5","Under 1.5","Under 2.5","Under 3.5"],"1x2":["Home","Draw","Away"],btts:["Yes","No"],handicap:["Home","Away"],corners:["Over 7.5","Over 8.5","Over 9.5","Under 9.5","Under 10.5"],cards:["Over 2.5","Over 3.5","Over 4.5","Under 4.5","Under 5.5"]};
const marketNames={ou:"Goals Over/Under","1x2":"1X2","btts":"BTTS","handicap":"Handicap","corners:"Corners","cards:"Cards"};
function dates(){return state.dates.join(",")}
function status(t){$("#status").textContent=t}
function chips(){ $("#dateChips").innerHTML=state.dates.map(d=>'<button class="date-chip" data-date="'+d+'">'+d+' ×</button>').join("");document.querySelectorAll(".date-chip").forEach(b=>b.onclick=()=>{if(state.dates.length>1){state.dates=state.dates.filter(x=>x!==b.dataset.date);load()}})}
function renderFilters(){
 $("#markets").innerHTML=Object.entries(marketNames).map(([k,v])=>'<label class="chip"><input type="checkbox" '+(state.markets.has(k)?"checked":"")+' value="'+k+'"><span>'+v+'</span></label>').join("");
 $("#markets").querySelectorAll("input").forEach(i=>i.onchange=()=>{i.checked?state.markets.add(i.value):state.markets.delete(i.value);if(!state.markets.size){state.markets.add("ou")}renderFilters()});
 const vals=[...state.markets].flatMap(k=>options[k]||[]);const unique=[...new Set(vals)];state.options=new Set([...state.options].filter(x=>unique.includes(x)));if(!state.options.size)state.options.add(unique.includes("Over 1.5")?"Over 1.5":unique[0]);
 $("#options").innerHTML=unique.map(v=>'<label class="chip"><input type="checkbox" '+(state.options.has(v)?"checked":"")+' value="'+esc(v)+'"><span>'+esc(v)+'</span></label>').join("");
 $("#options").querySelectorAll("input").forEach(i=>i.onchange=()=>{i.checked?state.options.add(i.value):state.options.delete(i.value);if(!state.options.size)state.options.add(i.value);renderFilters()});
}
async function loadLeagues(){
 const d=await (await fetch("/api/leagues?dates="+encodeURIComponent(dates()))).json();state.leagues=d.leagues||[];
 $("#leagues").innerHTML=state.leagues.map(x=>'<label class="league"><input type="checkbox" value="'+esc(x)+'"><span>✓</span>'+esc(x)+'</label>').join("");
}
async function load(){
 chips();status("Loading live fixtures…");
 try{await loadLeagues();const d=await (await fetch("/api/fixtures?dates="+encodeURIComponent(dates()))).json();$("#available").textContent=d.total||0;status((d.total||0)+" fixtures loaded across "+state.dates.length+" date(s). Choose markets and Analyze.")}catch(e){status("Live fixture feed unavailable.")}
}
function render(){
 $("#results").innerHTML=state.rows.length?state.rows.map(r=>'<article class="pick '+(state.slip.has(r.id)?"picked":"")+'"><div class="picktop"><span>'+esc(r.league)+' · '+esc(r.date)+' '+esc(r.time)+'</span><b>'+r.confidence+'%</b></div><h3>'+esc(r.home)+' <i>vs</i> '+esc(r.away)+'</h3><div class="pickline"><strong>'+esc(r.pick)+'</strong><span>'+esc(r.market)+' · @'+esc(r.odds)+' · '+esc(r.band)+'</span></div><button data-id="'+r.id+'">'+(state.slip.has(r.id)?"Remove":"Add to slip")+'</button></article>').join(""):'<div class="empty">No qualifying picks for the selected dates and filters.</div>';
 document.querySelectorAll(".pick button").forEach(b=>b.onclick=()=>{const r=state.rows.find(x=>x.id===b.dataset.id);state.slip.has(r.id)?state.slip.delete(r.id):state.slip.set(r.id,r);render();slip()});
}
function slip(){const a=[...state.slip.values()];$("#slipCount").textContent=a.length;$("#slip").innerHTML=a.length?a.map(x=>'<div>'+esc(x.home)+' vs '+esc(x.away)+' — '+esc(x.pick)+' ('+x.confidence+'%)</div>').join(""):"No selections yet."}
async function analyze(){
 const leagues=[...document.querySelectorAll("#leagues input:checked")].map(x=>x.value),limit=Math.max(1,Math.min(50,Number($("#limit").value)||20));
 status("Analyzing…");$("#analyze").disabled=true;
 try{const d=await (await fetch("/api/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({dates:state.dates,leagues,marketTypes:[...state.markets],selections:[...state.options],maxGames:limit})})).json();if(!d.ok)throw Error(d.error);state.rows=d.predictions||[];state.slip.clear();render();slip();status(d.total+" unique picks ranked by confidence.")}catch(e){status(e.message||"Analysis failed")}finally{$("#analyze").disabled=false}
}
async function booking(){const s=[...state.slip.values()];if(!s.length)return alert("Add picks to the slip first.");$("#booking").disabled=true;try{const d=await (await fetch("/api/booking-code",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({selections:s})})).json();if(!d.ok)throw Error(d.error);$("#code").textContent=d.bookingCode;$("#bookingBox").hidden=false}catch(e){alert(e.message)}finally{$("#booking").disabled=false}}
$("#addDate").onclick=()=>{const d=$("#dateInput").value;if(d&&!state.dates.includes(d)){state.dates.push(d);state.dates.sort();load()}};
$("#analyze").onclick=analyze;$("#booking").onclick=booking;$("#menu").onclick=()=>$("#drawer").classList.toggle("open");
$("#today").onclick=()=>{state.dates=[new Date().toISOString().slice(0,10)];load()};
$("#clear").onclick=()=>{state.dates=[new Date().toISOString().slice(0,10)];state.markets=new Set(["ou"]);state.options=new Set(["Over 1.5"]);renderFilters();load()};
renderFilters();load();slip();
