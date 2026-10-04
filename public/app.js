const state={rows:[],selected:new Map(),$:(s)=>document.querySelector(s),$$:(s)=>[...document.querySelectorAll(s)]};
const {$,$$}=state;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const optionSets={
  ou:["Over 0.5","Over 1.5","Over 2.5","Over 3.5","Over 4.5","Under 0.5","Under 1.5","Under 2.5","Under 3.5","Under 4.5"],
  "1x2":["Home","Draw","Away"],
  btts:["Yes","No"],
  handicap:["Home","Away"],
  corners:["Over 7.5","Over 8.5","Over 9.5","Over 10.5","Over 11.5","Under 7.5","Under 8.5","Under 9.5","Under 10.5","Under 11.5"],
  cards:["Over 1.5","Over 2.5","Over 3.5","Over 4.5","Over 5.5","Under 1.5","Under 2.5","Under 3.5","Under 4.5","Under 5.5"]
};

function setStatus(text){$("#analysisStatus").textContent=text}
function updateSelectionOptions(){
  const type=$("#market").value;
  const current=$("#selection").value;
  $("#selection").innerHTML=(optionSets[type]||optionSets.ou).map(x=>'<option value="'+esc(x)+'">'+esc(x)+"</option>").join("");
  if((optionSets[type]||[]).includes(current)) $("#selection").value=current;
}
async function loadBase(){
  try{
    const d=await (await fetch("/api/predictions")).json();
    state.rows=d.predictions||[];
    const leagues=[...new Set(state.rows.map(x=>x.league).filter(Boolean))].sort();
    $("#league").innerHTML='<option value="all">All leagues</option>'+leagues.map(x=>'<option value="'+esc(x)+'">'+esc(x)+"</option>").join("");
    $("#predictionTotal").textContent=state.rows.length;
    setStatus("Live feed ready. Choose your league and market, then Analyze.");
  }catch(e){setStatus("Live SportyBet data is temporarily unavailable.")}
}
function renderRows(){
  const rows=state.rows;
  if(!rows.length){$("#matches").innerHTML='<div class="empty">No qualifying games were returned.</div>';return}
  $("#matches").innerHTML=rows.map(x=>{
    const selected=state.selected.has(x.id);
    return '<article class="match"><div><div class="meta">'+esc(x.league)+' · '+esc(x.time)+'</div><div class="teams">'+esc(x.home)+' <span>vs</span> '+esc(x.away)+'</div><div class="pick"><span>'+esc(x.market)+' · '+esc(x.specifier||"")+'</span><b>'+esc(x.pick)+'</b></div><div class="pick"><span>Odds '+esc(x.odds)+'</span><b>'+esc(x.confidenceLabel)+'</b></div><button class="select '+(selected?"selected":"")+'" data-id="'+esc(x.id)+'">'+(selected?"Remove from slip":"Add to slip")+'</button></div><div class="prob"><strong>'+esc(x.confidence)+'%</strong><div class="bar"><i style="width:'+esc(x.confidence)+'%"></i></div><small>Confidence</small></div></article>';
  }).join("");
  $$(".select").forEach(b=>b.onclick=()=>{
    const row=state.rows.find(x=>x.id===b.dataset.id);
    if(!row)return;
    if(state.selected.has(row.id)) state.selected.delete(row.id);
    else if(state.selected.size<50) state.selected.set(row.id,row);
    else return alert("SportyBet supports up to 50 selections on a slip.");
    renderRows();renderSlip();
  });
}
function renderSlip(){
  const rows=[...state.selected.values()];
  $("#slipCount").textContent=rows.length;
  $("#selectedHome").textContent=rows.length;
  $("#slip").innerHTML=rows.length?rows.map(x=>'<div class="slipitem"><b>'+esc(x.home)+' vs '+esc(x.away)+'</b><small>'+esc(x.pick)+' · '+esc(x.confidence)+'% · @'+esc(x.odds)+'</small></div>').join(""):"<p>Select analyzed matches to build your slip.</p>";
}
async function analyze(){
  const league=$("#league").value,marketType=$("#market").value,selection=$("#selection").value;
  $("#analyze").disabled=true;setStatus("Analyzing today's fixtures across "+(league==="all"?"all leagues":league)+"...");
  try{
    const d=await (await fetch("/api/predictions/analyze",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({league,marketType,selection})})).json();
    if(!d.ok) throw new Error(d.error||"Analysis failed");
    state.rows=d.predictions||[];
    state.selected.clear();
    renderRows();renderSlip();
    setStatus(d.total+" qualifying game(s) found · ranked by confidence · "+new Date(d.generatedAt).toLocaleTimeString());
  }catch(e){
    state.rows=[];renderRows();renderSlip();setStatus(e.message||"Analysis failed");
  }finally{$("#analyze").disabled=false}
}
async function booking(){
  const rows=[...state.selected.values()];
  if(!rows.length)return alert("Select at least one analyzed match first.");
  $("#booking").disabled=true;
  try{
    const d=await (await fetch("/api/booking-code",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({selections:rows.map(x=>({eventId:x.eventId,marketId:x.marketId,specifier:x.specifier,outcomeId:x.outcomeId}))})})).json();
    if(!d.ok)throw new Error(d.error||"Booking code unavailable.");
    alert("SportyBet booking code: "+d.bookingCode);
  }catch(e){alert(e.message||"Booking code unavailable.")}finally{$("#booking").disabled=false}
}
const side=$("#side"),backdrop=$("#backdrop");
function closeSide(){side.classList.remove("open");backdrop.classList.remove("show")}
function openSide(){side.classList.add("open");backdrop.classList.add("show")}
$("#menu").onclick=()=>side.classList.contains("open")?closeSide():openSide();
$("#sideClose").onclick=closeSide;backdrop.onclick=closeSide;
function showPage(n){$$(".page").forEach(p=>p.classList.remove("active-page"));$("#page-"+n)?.classList.add("active-page");$$("[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===n));closeSide();scrollTo({top:0,behavior:"smooth"})}
$$("[data-page]").forEach(b=>b.onclick=()=>showPage(b.dataset.page));
$("#snapToggle").onclick=()=>{$("#snapBody").classList.toggle("open");$("#snapArrow").textContent=$("#snapBody").classList.contains("open")?"⌃":"⌄"};
$("#fixtureFile").onchange=e=>$("#fileName").textContent=e.target.files[0]?"Selected: "+e.target.files[0].name:"";
$("#market").onchange=updateSelectionOptions;
$("#analyze").onclick=analyze;
$("#booking").onclick=booking;
$("#sporty").onclick=()=>window.open("https://www.sportybet.com/ng/","_blank");
$("#mic").onclick=()=>alert("Voice search integration is next.");
updateSelectionOptions();loadBase();renderSlip();