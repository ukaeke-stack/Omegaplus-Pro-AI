(()=> {
  const APP_VERSION="1.5.0";
  const APP_ID="com.omegaplus.proai";
  const nativeVersionCode=()=>{try{return Number(window.AndroidApp?.getVersionCode?.()||0)}catch{return 0}};
  const KEY="omegaplus_settings_v2";
  const defaults={
    games:20,minConfidence:70,defaultMarket:"ou",defaultSelection:"Over 1.5",
    riskProfile:"Balanced",oddsMin:"",oddsMax:"",autoRefresh:false,
    showConfidence:true,notifications:false
  };
  const get=()=>{try{return {...defaults,...JSON.parse(localStorage.getItem(KEY)||"{}")}}catch{return {...defaults}}};
  const save=v=>localStorage.setItem(KEY,JSON.stringify(v));
  const style=document.createElement("style");
  style.textContent=`
    #settingsModal{position:fixed;inset:0;background:#000b;z-index:100;display:none;align-items:flex-end;justify-content:center;padding:14px}
    #settingsModal.open{display:flex}
    .settings-panel{width:min(620px,100%);max-height:92vh;overflow:auto;background:#07110b;border:1px solid #1b3025;border-radius:22px;padding:20px;box-shadow:0 20px 60px #000}
    .settings-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
    .settings-head h2{margin:0;font-size:25px}.settings-close{border:0;background:#122019;color:#aeb8b2;border-radius:10px;font-size:24px;width:42px;height:42px}
    .settings-section{border:1px solid #17271f;background:#0b1510;border-radius:15px;padding:15px;margin-top:10px}
    .settings-section>strong{display:block;font-size:15px;margin-bottom:8px}.settings-section>small{display:block;color:#89948d;line-height:1.5;margin-top:5px}
    .settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.settings-field{display:grid;gap:6px}
    .settings-field label{font-size:12px;color:#aeb8b2}.settings-field input,.settings-field select{width:100%;box-sizing:border-box;border:1px solid #263b30;background:#0e1b14;color:#eef5f0;border-radius:10px;padding:11px}
    .settings-check{display:flex;align-items:center;gap:9px;margin-top:10px;color:#c9d2cc;font-size:13px}.settings-check input{width:18px;height:18px}
    .settings-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
    .settings-actions{display:flex;gap:10px;margin-top:14px}.settings-button{flex:1;border:1px solid #20342a;background:#0e1b14;color:#eef5f0;border-radius:11px;padding:12px;font-weight:800}
    .settings-button.primary-settings{background:#18e76b;color:#04150b;border-color:#18e76b}
    #settingsSaveStatus{color:#18e76b;min-height:18px}.settings-version{color:#18e76b;font-weight:800}
    @media(max-width:520px){.settings-grid{grid-template-columns:1fr}.settings-actions{flex-direction:column}}
    @media(min-width:700px){#settingsModal{align-items:center}.settings-panel{max-height:84vh}}
  `;
  document.head.appendChild(style);

  const nav=document.querySelector(".side-nav");
  if(nav && !document.querySelector("#settingsButton")){
    const b=document.createElement("button"); b.type="button"; b.id="settingsButton";
    b.innerHTML='⚙ <span>Settings</span>'; b.onclick=()=>openSettings(); nav.appendChild(b);
  }

  const modal=document.createElement("div"); modal.id="settingsModal";
  modal.innerHTML=`
    <section class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
      <div class="settings-head"><h2 id="settingsTitle">Settings</h2><button class="settings-close" id="settingsClose" aria-label="Close settings">×</button></div>
      <div class="settings-section">
        <strong>Prediction Settings</strong>
        <div class="settings-grid">
          <div class="settings-field"><label>Number of games</label><input id="setGames" type="number" min="1" max="50"></div>
          <div class="settings-field"><label>Minimum confidence (%)</label><input id="setConfidence" type="number" min="0" max="100"></div>
          <div class="settings-field"><label>Default market</label><select id="setMarket"><option value="ou">Over / Under</option><option value="1x2">1X2</option><option value="btts">BTTS</option><option value="corners">Corners</option><option value="cards">Cards</option><option value="handicap">Handicap</option></select></div>
          <div class="settings-field"><label>Default selection</label><select id="setSelection"><option>Over 1.5</option><option>Over 2.5</option><option>Under 3.5</option><option>BTTS Yes</option><option>Home Win</option><option>Draw</option><option>Away Win</option></select></div>
          <div class="settings-field"><label>Risk profile</label><select id="setRisk"><option>Conservative</option><option>Balanced</option><option>Aggressive</option></select></div>
          <div class="settings-field"><label>Minimum odds</label><input id="setOddsMin" type="number" min="0" step="0.01" placeholder="Optional"></div>
          <div class="settings-field"><label>Maximum odds</label><input id="setOddsMax" type="number" min="0" step="0.01" placeholder="Optional"></div>
        </div>
        <label class="settings-check"><input id="setShowConfidence" type="checkbox"> Show confidence percentage on predictions</label>
        <label class="settings-check"><input id="setAutoRefresh" type="checkbox"> Auto-refresh live scan</label>
      </div>
      <div class="settings-section">
        <strong>Notifications</strong>
        <label class="settings-check"><input id="setNotifications" type="checkbox"> Enable prediction/update notifications</label>
      </div>
      <div class="settings-section">
        <strong>App Updates</strong>
        <div class="settings-row"><span>Current version</span><span class="settings-version">v${APP_VERSION}</span></div>
        <small id="updateStatus">Check whether a newer version is available.</small>
        <div class="settings-actions"><button class="settings-button" id="checkUpdates">Check for updates</button><button class="settings-button primary-settings" id="applyUpdate" hidden>Apply update</button></div>
      </div>
      <div class="settings-section">
        <strong>System Diagnostics</strong>
        <small id="diagnosticStatus">Provider and prediction-engine health can be checked without leaving Settings.</small>
        <button class="settings-button" id="runDiagnostics">Run diagnostics</button>
      </div>
      <div class="settings-section">
        <strong>Data & Privacy</strong><small>Prediction preferences are saved locally on this device. Clearing history does not affect the live SportyBet feed.</small>
        <button class="settings-button" id="clearSettingsHistory">Clear prediction history</button>
      </div>
      <div class="settings-actions"><button class="settings-button primary-settings" id="saveSettings">Save Settings</button><button class="settings-button" id="resetSettings">Reset Settings</button></div>
      <small id="settingsSaveStatus"></small>
    </section>`;
  document.body.appendChild(modal);

  function fill(){
    const s=get();
    $("#setGames").value=s.games; $("#setConfidence").value=s.minConfidence; $("#setMarket").value=s.defaultMarket;
    $("#setSelection").value=s.defaultSelection; $("#setRisk").value=s.riskProfile; $("#setOddsMin").value=s.oddsMin; $("#setOddsMax").value=s.oddsMax;
    $("#setShowConfidence").checked=!!s.showConfidence; $("#setAutoRefresh").checked=!!s.autoRefresh; $("#setNotifications").checked=!!s.notifications;
  }
  function read(){
    return {
      games:Math.max(1,Math.min(50,Number($("#setGames").value)||20)),
      minConfidence:Math.max(0,Math.min(100,Number($("#setConfidence").value)||0)),
      defaultMarket:$("#setMarket").value,defaultSelection:$("#setSelection").value,
      riskProfile:$("#setRisk").value,oddsMin:$("#setOddsMin").value,oddsMax:$("#setOddsMax").value,
      showConfidence:$("#setShowConfidence").checked,autoRefresh:$("#setAutoRefresh").checked,notifications:$("#setNotifications").checked
    };
  }
  function openSettings(){fill();modal.classList.add("open")}
  function closeSettings(){modal.classList.remove("open")}
  $("#settingsClose").onclick=closeSettings;
  modal.addEventListener("click",e=>{if(e.target===modal)closeSettings()});
  $("#saveSettings").onclick=()=>{
    const s=read(); save(s);
    localStorage.setItem("omegaplus_settings_updated_at",Date.now().toString());
    if(typeof window.applyOmegaplusSettings==="function")window.applyOmegaplusSettings(s);
    $("#settingsSaveStatus").textContent="Settings saved successfully.";
    setTimeout(()=>$("#settingsSaveStatus").textContent="",1800);
  };
  $("#resetSettings").onclick=()=>{save({...defaults});fill();if(typeof window.applyOmegaplusSettings==="function")window.applyOmegaplusSettings(get());$("#settingsSaveStatus").textContent="Settings reset to defaults."};
  $("#checkUpdates").onclick=async()=>{
    const status=$("#updateStatus"),apply=$("#applyUpdate");status.textContent="Checking the latest release…";apply.hidden=true;
    try{
      const r=await fetch("/api/release/status?ts="+Date.now(),{cache:"no-store"}),d=await r.json();if(!d.ok)throw new Error();
      const installed=nativeVersionCode();
      if(d.versionCode&&installed&&Number(d.versionCode)>installed){status.textContent="A newer Android app build is available (build "+d.versionCode+").";apply.textContent="Open Play Store";apply.hidden=false;apply.onclick=()=>window.AndroidApp?.openPlayStore?.()}
      else if(d.version&&d.version!==APP_VERSION){status.textContent="A newer server release is available (v"+d.version+"). Restarting will load it.";apply.textContent="Apply update";apply.hidden=false;apply.onclick=()=>location.replace(location.pathname+"?update="+Date.now())}
      else status.textContent="You are using the current release (v"+APP_VERSION+").";
    }catch{status.textContent="Could not check for updates. Check your internet connection and try again."}
  };
  $("#applyUpdate").onclick=()=>{location.replace(location.pathname+"?update="+Date.now())};
  $("#runDiagnostics").onclick=async()=>{
    const box=$("#diagnosticStatus");box.textContent="Checking providers and engine…";
    try{const r=await fetch("/api/health?ts="+Date.now(),{cache:"no-store"}),d=await r.json(),i=d.independentStats||{};box.textContent="Engine: healthy · SportyBet: "+(d.liveSportyBet?"connected":"unavailable")+" · Sofascore: "+(i.sofascore?"healthy":"unavailable")+" · Understat: "+(i.understat?"healthy":"unavailable")+" · App ID: "+APP_ID+" · v"+(d.version||APP_VERSION)}catch{box.textContent="Diagnostics could not reach the server."}
  };
  $("#clearSettingsHistory").onclick=()=>{
    if(confirm("Clear all saved prediction history on this device?")){
      localStorage.removeItem("omegaplus_prediction_history");localStorage.removeItem("omegaplus_history_v3");localStorage.removeItem("omegaplus_day_archive_v1");
      if(typeof window.renderHistory==="function")window.renderHistory();
      $("#settingsSaveStatus").textContent="Prediction history cleared.";
    }
  };
  window.openOmegaplusSettings=openSettings;
  window.getOmegaplusSettings=get;
  window.applyOmegaplusSettingsFromStorage=()=>{if(typeof window.applyOmegaplusSettings==="function")window.applyOmegaplusSettings(get())};
})();