(function(){
  const KEY='omegaplus-settings';
  const defaults={defaultMarket:'Over 1.5',minConfidence:70,maxGames:10,favoriteLeagues:[],notifications:true,theme:'system',fontSize:'normal',language:'English'};
  function get(){try{return {...defaults,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{return {...defaults}}}
  function save(v){localStorage.setItem(KEY,JSON.stringify(v));window.dispatchEvent(new CustomEvent('omegaplus-settings-changed',{detail:v}));}
  function open(){
    let s=get();
    const modal=document.createElement('div'); modal.className='settings-overlay';
    modal.innerHTML='<div class="settings-modal"><div class="settings-head"><h2>Settings</h2><button class="settings-close">×</button></div><div class="settings-grid">'+
      '<label>Default market<select id="set-market"><option>Over 1.5</option><option>Over 2.5</option><option>Under 2.5</option><option>BTTS Yes</option><option>Home Win</option><option>Draw</option><option>Away Win</option></select></label>'+
      '<label>Minimum confidence (%)<input id="set-confidence" type="number" min="50" max="99"></label>'+
      '<label>Games to show<input id="set-games" type="number" min="1" max="50"></label>'+
      '<label>Theme<select id="set-theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>'+
      '<label>Text size<select id="set-font"><option value="normal">Normal</option><option value="large">Large</option></select></label>'+
      '<label>Language<select id="set-language"><option>English</option></select></label>'+
      '</div><div class="settings-checks"><label><input id="set-notify" type="checkbox"> Enable notifications</label></div>'+
      '<div class="settings-links"><button data-action="diagnostics">Connection & Diagnostics</button><button data-action="privacy">Data & Privacy</button><button data-action="about">About Omegaplus AI</button></div>'+
      '<div class="settings-foot"><span>Omegaplus AI v1.1.0</span><button class="update-btn" data-action="update">Check for Update</button><button class="save-settings">Save Settings</button></div></div>';
    document.body.appendChild(modal);
    modal.querySelector('#set-market').value=s.defaultMarket; modal.querySelector('#set-confidence').value=s.minConfidence; modal.querySelector('#set-games').value=s.maxGames; modal.querySelector('#set-theme').value=s.theme; modal.querySelector('#set-font').value=s.fontSize; modal.querySelector('#set-language').value=s.language; modal.querySelector('#set-notify').checked=s.notifications;
    const close=()=>modal.remove(); modal.querySelector('.settings-close').onclick=close;
    modal.querySelector('.save-settings').onclick=()=>{save({defaultMarket:modal.querySelector('#set-market').value,minConfidence:+modal.querySelector('#set-confidence').value,maxGames:+modal.querySelector('#set-games').value,theme:modal.querySelector('#set-theme').value,fontSize:modal.querySelector('#set-font').value,language:modal.querySelector('#set-language').value,notifications:modal.querySelector('#set-notify').checked}); apply(); close(); alert('Settings saved.');};
    modal.querySelector('[data-action="update"]').onclick=checkUpdate;
    modal.querySelector('[data-action="diagnostics"]').onclick=()=>alert('Connection diagnostics: checking Omegaplus services…');
    modal.querySelector('[data-action="privacy"]').onclick=()=>alert('Your prediction preferences are stored locally on this device. Server-side prediction history remains available through your account/app services.');
    modal.querySelector('[data-action="about"]').onclick=()=>alert('Omegaplus AI\nFootball prediction and analysis platform.\nVersion 1.1.0');
  }
  function apply(){const s=get();document.documentElement.dataset.theme=s.theme;document.documentElement.dataset.fontSize=s.fontSize;}
  async function checkUpdate(){
    try{const r=await fetch('/api/app-version?current=1.1.0',{cache:'no-store'}); if(!r.ok)throw 0; const d=await r.json(); if(d.updateAvailable){ if(confirm('Omegaplus AI '+d.latestVersion+' is available. Update now?')) { if(window.AndroidUpdater&&window.AndroidUpdater.startUpdate){ window.AndroidUpdater.startUpdate(d.apkUrl,d.latestVersion); } else { alert('A new version is available. Open this app on Android to install the update.'); window.open(d.apkUrl,'_blank'); } } } else alert('You are using the latest Omegaplus AI version.');}
    catch(e){alert('Update check is temporarily unavailable. The current app will continue working.');}
  }
  window.OmegaSettings={open,checkUpdate,get,save}; apply();
})();