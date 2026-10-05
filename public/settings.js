(()=> {
  const APP_VERSION="1.1.0";
  const style=document.createElement("style");
  style.textContent=`
    #settingsModal{position:fixed;inset:0;background:#000b;z-index:100;display:none;align-items:flex-end;justify-content:center;padding:14px}
    #settingsModal.open{display:flex}
    .settings-panel{width:min(560px,100%);max-height:90vh;overflow:auto;background:#07110b;border:1px solid #1b3025;border-radius:22px;padding:20px;box-shadow:0 20px 60px #000}
    .settings-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}
    .settings-head h2{margin:0;font-size:25px}.settings-close{border:0;background:#122019;color:#aeb8b2;border-radius:10px;font-size:24px;width:42px;height:42px}
    .settings-section{border:1px solid #17271f;background:#0b1510;border-radius:15px;padding:15px;margin-top:10px}
    .settings-section strong{display:block;font-size:15px}.settings-section small{display:block;color:#89948d;line-height:1.5;margin-top:5px}
    .settings-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
    .settings-button{margin-top:12px;width:100%;border:1px solid #20342a;background:#0e1b14;color:#eef5f0;border-radius:11px;padding:12px;font-weight:800}
    .settings-button.primary-settings{background:#18e76b;color:#04150b;border-color:#18e76b}
    #updateStatus{color:#18e76b}.settings-version{color:#18e76b;font-weight:800}
    @media(min-width:700px){#settingsModal{align-items:center}.settings-panel{max-height:80vh}}
  `;
  document.head.appendChild(style);

  const nav=document.querySelector(".side-nav");
  if(nav && !document.querySelector("[data-page=settings]")){
    const b=document.createElement("button");
    b.type="button"; b.id="settingsButton"; b.innerHTML='⚙ <span>Settings</span>';
    b.onclick=()=>openSettings();
    nav.appendChild(b);
  }

  const modal=document.createElement("div");
  modal.id="settingsModal";
  modal.innerHTML=`
    <section class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
      <div class="settings-head"><h2 id="settingsTitle">Settings</h2><button class="settings-close" id="settingsClose" aria-label="Close settings">×</button></div>
      <div class="settings-section"><div class="settings-row"><strong>App version</strong><span class="settings-version">v${APP_VERSION}</span></div><small>Omegaplus Pro AI web application.</small></div>
      <div class="settings-section"><strong>App updates</strong><small id="updateStatus">Check whether a newer version is available.</small><button class="settings-button primary-settings" id="checkUpdates">Check for updates</button><button class="settings-button" id="applyUpdate" hidden>Apply update</button></div>
      <div class="settings-section"><strong>Data</strong><small>Your prediction history is stored locally on this device. Clearing it does not affect the live SportyBet feed.</small><button class="settings-button" id="clearSettingsHistory">Clear prediction history</button></div>
      <div class="settings-section"><strong>About</strong><small>Live fixture and market data are retrieved from the configured SportyBet feed. Prediction confidence is a ranking estimate, not a guarantee of an outcome.</small></div>
    </section>`;
  document.body.appendChild(modal);

  function openSettings(){modal.classList.add("open");}
  function closeSettings(){modal.classList.remove("open");}
  document.querySelector("#settingsClose").onclick=closeSettings;
  modal.addEventListener("click",e=>{if(e.target===modal)closeSettings();});

  document.querySelector("#checkUpdates").onclick=async()=>{
    const status=document.querySelector("#updateStatus"), apply=document.querySelector("#applyUpdate");
    status.textContent="Checking the latest version…"; apply.hidden=true;
    try{
      const r=await fetch("/api/health?ts="+Date.now(),{cache:"no-store"});
      const d=await r.json();
      if(!d.ok) throw new Error("Update service unavailable");
      if(d.version && d.version!==APP_VERSION){
        status.textContent="A newer version is available (v"+d.version+").";
        apply.hidden=false;
      }else{
        status.textContent="You are using the latest version (v"+APP_VERSION+").";
      }
    }catch(e){status.textContent="Could not check for updates. Check your internet connection and try again.";}
  };

  document.querySelector("#applyUpdate").onclick=()=>{
    location.href=location.pathname+"?update="+Date.now();
  };

  document.querySelector("#clearSettingsHistory").onclick=()=>{
    if(confirm("Clear all saved prediction history on this device?")){
      localStorage.removeItem("omegaplus_prediction_history");
      if(typeof window.renderHistory==="function") window.renderHistory();
      document.querySelector("#updateStatus").textContent="Prediction history cleared.";
    }
  };

  window.openOmegaplusSettings=openSettings;
})();