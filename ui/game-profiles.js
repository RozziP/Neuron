let profileTab = 'games', gameLibrary = {games:[],warnings:[],scannedAt:null}, gameSelection = '', gameSearch = '', scanningGames = false, loadedGames = false;
function profileTabs() {
  return `<div class="profile-tabs"><button class="${profileTab==='games'?'active':''}" data-profile-tab="games">Game profiles</button><button class="${profileTab==='standard'?'active':''}" data-profile-tab="standard">Standard profiles</button></div>`;
}
function wireProfileTabs() {
  document.querySelectorAll('[data-profile-tab]').forEach(button=>button.onclick=()=>act(async()=>{
    if(button.dataset.profileTab==='standard' && draft.gameId) {
      if(!await leaveDraft())return;
      const standard=state.profiles.find(p=>!p.gameId); if(standard)setDraft(standard);
    }
    profileTab=button.dataset.profileTab; render();
  }));
}
async function refreshGames() {
  if(scanningGames)return;
  scanningGames=true; if(page==='profiles')renderProfiles();
  try { gameLibrary=await api.scanGames(); loadedGames=true; }
  finally { scanningGames=false; if(page==='profiles')renderProfiles(); }
}
function renderProfiles() {
  if(profileTab==='standard') {
    renderStandardProfiles(); $('#content').insertAdjacentHTML('afterbegin',profileTabs()); wireProfileTabs(); return;
  }
  if(!loadedGames && !scanningGames) { void act(refreshGames); return; }
  const games=gameLibrary.games.filter(g=>`${g.name} ${g.source}`.toLowerCase().includes(gameSearch.toLowerCase()));
  const game=games.find(g=>g.id===gameSelection)||games[0]; if(game)gameSelection=game.id;
  const compatible=p=>p.model===draft.model && p.plate===draft.plate;
  const existing=game && state.profiles.find(p=>p.gameId===game.id && compatible(p));
  const standards=state.profiles.filter(p=>!p.gameId && compatible(p));
  $('#content').innerHTML=`${profileTabs()}<div class="page-tools"><p>${scanningGames?'Looking for installed games…':`${gameLibrary.games.length} installed games`} · ${esc(nameOf(draft.model))} / ${draft.plate} side buttons</p><div class="tool-actions"><button class="button" id="add-game">+ Add game</button><button class="button" id="scan-games" ${scanningGames?'disabled':''}>${scanningGames?'Scanning…':'↻ Scan games'}</button></div></div><div class="game-workspace"><section class="game-library"><label class="game-search"><span class="section-label">FIND YOUR GAME</span><input class="input" id="game-search" type="search" placeholder="Search games or launchers" value="${esc(gameSearch)}"></label><div class="game-grid">${games.map(g=>{
    const ready=state.profiles.some(p=>p.gameId===g.id && compatible(p));
    return `<button class="game-card ${g.id===game?.id?'selected':''}" data-game="${esc(g.id)}" aria-pressed="${g.id===game?.id}"><span class="game-art ${/World of Warcraft/.test(g.name)?'warcraft':''}">${/World of Warcraft/.test(g.name)?'W':esc(g.name.split(/\s+/).slice(0,2).map(w=>w[0]).join(''))}</span><span class="game-card-copy"><strong>${esc(g.name)}</strong><small>${esc(g.source)}</small><span class="game-status ${ready?'ready':''}">${ready?'● Profile ready':'+ Create profile'}</span></span></button>`;
  }).join('')||`<div class="card empty"><h2>${scanningGames?'Finding your games…':'No games found'}</h2><p>${gameSearch?'Try another search.':'Scan your library or use Add game to select an executable.'}</p></div>`}</div></section><section class="card game-setup">${game?`<h2>${esc(game.name)}</h2>${existing?`<div class="game-profile-ready"><span class="pill">PROFILE READY</span><h3>${esc(existing.name)}</h3><p>${existing.plate} side buttons + top controls</p><button class="button primary" id="edit-game-profile">Edit button mapping ↗</button><button class="text-button" id="export-game-profile">Export profile</button><button class="text-button" id="delete-game-profile">Delete game profile</button></div>`:`<label class="field"><span>START FROM</span><select id="game-template"><option value="">Fresh profile · default bindings</option>${standards.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label><details class="game-executable-details"><summary>Game executable & location</summary><label class="field"><span>GAME EXECUTABLE</span><select id="game-executable" ${!game.executables.length?'disabled':''}>${game.executables.map(exe=>`<option value="${esc(exe)}" ${exe===game.executablePath?'selected':''}>${esc(exe.replace(game.installPath+'\\',''))}</option>`).join('')||'<option>Locate the executable to continue</option>'}</select></label><p class="game-path">${esc(game.installPath)}</p><button class="text-button" id="locate-game">Locate executable…</button></details><div class="game-create-actions"><button class="button primary" id="create-game-profile" ${!game.executables.length?'disabled':''}>Create game profile ↗</button><button class="button" id="import-game-profile" ${!game.executables.length?'disabled':''}>Import profile from file</button></div>`}<div class="game-switching"><span class="pill">${existing?'● AUTOMATIC SWITCHING ACTIVE':'AUTOMATIC GAME PROFILES'}</span></div>`:'<h2>Select a game</h2>'}</section></div>${gameLibrary.warnings.length?`<p class="help">${gameLibrary.warnings.map(esc).join(' ')}</p>`:''}<p class="help game-detection-note">Detects Steam, Battle.net / World of Warcraft, Epic, GOG, Riot, Windows install records and common game folders. Missing a game? Use Add game.</p>`;
  wireProfileTabs();
  $('#scan-games').onclick=()=>act(refreshGames);
  $('#game-search').oninput=e=>{const position=e.target.selectionStart;gameSearch=e.target.value;renderProfiles();$('#game-search').focus();try{$('#game-search').setSelectionRange(position,position);}catch{}};
  document.querySelectorAll('[data-game]').forEach(b=>b.onclick=()=>{gameSelection=b.dataset.game;renderProfiles();});
  const add=async id=>{const added=await api.addGame(id);if(added){gameLibrary=await api.games();gameSelection=added.id;gameSearch='';renderProfiles();}};
  $('#add-game').onclick=()=>act(()=>add());
  if(!game)return;
  if(existing) {
    $('#edit-game-profile').onclick=()=>act(async()=>{if(!await leaveDraft())return;setDraft(existing);page='buttons';render();});
    $('#export-game-profile').onclick=()=>act(()=>api.export(existing));
    $('#delete-game-profile').onclick=()=>act(async()=>{if(!await confirmAction('Delete this game profile?','The game stays in your library. Its saved button bindings will be removed. Shared macros stay in your library.','Delete profile'))return;if(draft.id===existing.id && !await leaveDraft())return;await api.remove(existing.id);if(draft.id===existing.id)setDraft(state.profiles[0]);render();});
  } else {
    $('#locate-game').onclick=()=>act(()=>add(game.id));
    const create=async fromFile=>{if(!await leaveDraft())return;const p=await api.createGame(game.id,fromFile?'':$('#game-template').value,draft.model,draft.plate,$('#game-executable').value,fromFile);if(p){setDraft(p);page='buttons';render();toast('Game profile created. Automatic switching is active.');}};
    $('#create-game-profile').onclick=()=>act(()=>create(false));
    $('#import-game-profile').onclick=()=>act(()=>create(true));
  }
}
