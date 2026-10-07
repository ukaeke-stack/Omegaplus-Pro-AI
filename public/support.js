(()=>{const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const style=document.createElement("style");style.textContent=`
.support-card{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.09);border-radius:16px;padding:16px;margin:14px 0;display:grid;gap:12px}.support-card label{display:grid;gap:7px}.support-card input,.support-card textarea{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.13);background:rgba(0,0,0,.18);color:inherit;border-radius:10px;padding:11px;font:inherit}.support-card textarea{resize:vertical}.chat-messages{min-height:280px;max-height:55vh;overflow:auto;display:grid;gap:9px;padding:12px;background:rgba(0,0,0,.16);border-radius:14px}.chat-bubble{max-width:82%;padding:10px 12px;border-radius:13px;background:rgba(255,255,255,.07);justify-self:start}.chat-bubble.mine{justify-self:end;background:rgba(24,231,107,.14)}.chat-bubble small{display:block;opacity:.65;margin-top:5px}.ticket-row{padding:12px;border-bottom:1px solid rgba(255,255,255,.08)}.ticket-row:last-child{border-bottom:0}`;document.head.appendChild(style);
let chatThread=null,chatTimer=null;
async function api(url,opt={}){const res=await fetch(url,{...opt,headers:{"content-type":"application/json",...(opt.headers||{})}});const d=await res.json().catch(()=>({}));if(!res.ok){const e=new Error(d.error||"Request failed");e.code=d.code;throw e}return d}
function needLogin(){if(window.omegaAuth){window.omegaAuth.open();return}alert("Please log in first.")}
function status(id,msg,bad=false){const x=$(id);if(x){x.textContent=msg;x.className="analysis-status"+(bad?" omega-danger":"")}}
async function sendTicket(type,subjectId,bodyId,statusId){
  try{await api("/api/support/tickets",{method:"POST",body:JSON.stringify({type,subject:$(subjectId).value.trim(),body:$(bodyId).value.trim()})});$(subjectId).value="";$(bodyId).value="";status(statusId,"Sent successfully. The admin can review it in the Admin Console.");if(type==="message")loadTickets()}
  catch(e){if(e.code==="AUTH_REQUIRED"){needLogin();return}status(statusId,e.message,true)}
}
async function loadTickets(){try{const d=await api("/api/support/tickets");const box=$("#ticketList");if(!box)return;box.innerHTML=(d.tickets||[]).map(t=>'<div class="ticket-row"><b>'+esc(t.subject||t.type)+'</b><div>'+esc(t.body)+'</div><small>'+esc(t.status)+' · '+new Date(t.created_at).toLocaleString()+'</small></div>').join("")||'<span class="muted">No previous requests.</span>'}catch{}}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function renderChat(messages){const box=$("#chatMessages");if(!box)return;box.innerHTML=(messages||[]).map(m=>'<div class="chat-bubble '+(m.sender_role==="user"?"mine":"")+'"><div>'+esc(m.message).replace(/\n/g,"<br>")+'</div><small>'+esc(m.sender_role==="user"?"You":"Admin")+' · '+new Date(m.created_at).toLocaleTimeString()+'</small></div>').join("")||'<div class="muted">No messages yet. Send a message to start the conversation.</div>';box.scrollTop=box.scrollHeight}
async function loadChat(){try{const d=await api("/api/support/chat");chatThread=d.thread;renderChat(d.messages);status("#chatStatus",d.thread.status==="closed"?"This chat is closed by the admin.":"Chat connected.");return d}catch(e){if(e.code==="AUTH_REQUIRED")needLogin();return null}}
async function sendChat(){const input=$("#chatInput"),msg=input?.value.trim();if(!msg)return;try{await api("/api/support/chat",{method:"POST",body:JSON.stringify({message:msg})});input.value="";await loadChat()}catch(e){if(e.code==="AUTH_REQUIRED")needLogin();else status("#chatStatus",e.message,true)}}
$("#sendFeedback")?.addEventListener("click",()=>sendTicket("feedback","#feedbackSubject","#feedbackBody","#feedbackStatus"));
$("#sendSuggestion")?.addEventListener("click",()=>sendTicket("suggestion","#suggestionSubject","#suggestionBody","#suggestionStatus"));
$("#sendMessage")?.addEventListener("click",()=>sendTicket("message","#messageSubject","#messageBody","#messageStatus"));
$("#sendChat")?.addEventListener("click",sendChat);
$("#chatInput")?.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendChat()}});
const originalShow=window.showPage;
function onPage(){const active=document.querySelector(".page.active-page")?.id;if(active==="page-message")loadTickets();if(active==="page-live-chat"){loadChat();clearInterval(chatTimer);chatTimer=setInterval(()=>{if(document.querySelector(".page.active-page")?.id==="page-live-chat")loadChat()},3000)}else clearInterval(chatTimer)}
$$("[data-page]").forEach(b=>b.addEventListener("click",()=>setTimeout(onPage,0)));
setTimeout(onPage,1000);
})();