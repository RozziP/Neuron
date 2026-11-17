const { driverFor } = require('./drivers.cjs');
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {exec} = require('./processes.cjs');
const {atomicWrite,newProfile,validateProfile} = require('./store.cjs');
const normalize = p=>path.win32.normalize(p || '').toLowerCase();
const gameId = p=>'game-'+crypto.createHash('sha256').update(normalize(p)).digest('hex').slice(0,20);
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
async function entries(dir) { try { return await fs.readdir(dir,{withFileTypes:true}); } catch {return [];} }
async function read(file) { try { if((await fs.stat(file)).size>8*1024*1024) return ''; return await fs.readFile(file,'utf8'); } catch {return '';} }
function vdfValues(text,key) {
  return [...text.matchAll(new RegExp('"'+key+'"\\s+"((?:\\\\.|[^"\\\\])*)"','gi'))].map(m=>m[1].replace(/\\\\/g,'\\').replace(/\\"/g,'"'));
}
function safeChild(root,child) {
  const resolved=path.resolve(root,child), relative=path.relative(path.resolve(root),resolved);
  if(relative.startsWith('..')||path.isAbsolute(relative)) return null;
  return resolved;
}
const skipDir=/^(data|.*_data|node_modules|resources|cache|logs?|screenshots|addons|interface|wtf|webcache|redist|_commonredist|directx|dotnet|support|mods|managed|locales|licenses|plugins)$/i;
const skipExe=/(createdump|crash|unins|setup|install|launcher|updater|helper|report|cef|webview|vc_redist|dxsetup|anticheat|easyanti|unitycrash|steamservice|activation)/i;
async function findExecutables(root) {
  const result=[], queue=[{dir:root,depth:0}]; let visited=0;
  while(queue.length && visited++<160) {
    const current=queue.shift();
    for (const item of (await entries(current.dir)).slice(0,3000)) {
      const full=path.join(current.dir,item.name);
      if(item.isFile() && /\.exe$/i.test(item.name) && !skipExe.test(item.name)) result.push(full);
      else if(item.isDirectory() && !item.isSymbolicLink() && current.depth<4 && !skipDir.test(item.name)) queue.push({dir:full,depth:current.depth+1});
    }
  }
  return result.slice(0,80);
}
function rankExecutable(file,name) {
  const base=path.basename(file).toLowerCase(), simplified=name.toLowerCase().replace(/[^a-z0-9]/g,'');
  let score=0;
  if(/^(wow|wowclassic|ffxiv_dx11|league of legends|valorant-win64-shipping)\.exe$/i.test(base)) score+=100;
  if(base.replace(/[^a-z0-9]/g,'').includes(simplified) && simplified.length>2) score+=30;
  if(/(win64-shipping|x64|64bit)/i.test(base)) score+=20;
  if(/(client|game)/i.test(base)) score+=4;
  if(/(config|editor|server|benchmark|test|browser)/i.test(base)) score-=50;
  return score;
}
async function scanGames(options={}) {
  const env=options.env || process.env, warnings=[], found=[];
  let registry=options.registry;
  if(!registry) {
    try {
      const script=path.join(__dirname,'../scripts/game-registry.ps1').replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
      const {stdout}=await exec('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{windowsHide:true,timeout:20000,maxBuffer:4*1024*1024});
      registry=JSON.parse(stdout.replace(/^\uFEFF/,''));
    } catch { registry={entries:[]}; warnings.push('Windows install records could not be read.'); }
  }
  const pf=env.ProgramFiles || 'C:\\Program Files', pfx=env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', pd=env.ProgramData || 'C:\\ProgramData';
  async function add(name,root,source,preferred) {
    if(!root || !name || !await exists(root)) return;
    root=path.resolve(root);
    if(found.some(g=>normalize(g.installPath)===normalize(root))) return;
    let executables=preferred && await exists(preferred) ? [preferred] : await findExecutables(root);
    executables.sort((a,b)=>rankExecutable(b,name)-rankExecutable(a,name)||a.localeCompare(b));
    found.push({id:gameId(root),name,installPath:root,source,executables,executablePath:executables[0]||'',manual:false});
  }
  const steamRoots=new Set([registry.steam,path.join(pfx,'Steam')].filter(Boolean));
  for(const root of [...steamRoots]) {
    const libraries=await read(path.join(root,'steamapps','libraryfolders.vdf'));
    for(const extra of vdfValues(libraries,'path')) steamRoots.add(extra);
  }
  for(const root of steamRoots) for(const item of await entries(path.join(root,'steamapps'))) {
    if(!/^appmanifest_\d+\.acf$/i.test(item.name)) continue;
    const text=await read(path.join(root,'steamapps',item.name)), name=vdfValues(text,'name')[0], dir=vdfValues(text,'installdir')[0];
    if(!dir || /steamworks|redistributable|proton|soundtrack|dedicated server/i.test(name||'')) continue;
    const gameRoot=safeChild(path.join(root,'steamapps','common'),dir);
    if(gameRoot) await add(name,gameRoot,'Steam');
  }
  // Each installed WoW client gets its own path-based identity (Retail and Forever
  // can both be Wow.exe, so process-name-only matching would choose the wrong game).
  const wowRoots=new Set([path.join(pfx,'World of Warcraft'),path.join(pf,'World of Warcraft')]);
  for(const entry of registry.entries || []) if(/world of warcraft/i.test(entry.DisplayName||'')) wowRoots.add(entry.InstallLocation);
  const battleConfig=await read(path.join(env.APPDATA || '', 'Battle.net','Battle.net.config'));
  try {
    const walk=value=>{if(!value||typeof value!=='object')return; for(const [key,v] of Object.entries(value)){if(typeof v==='string' && /installpath|installlocation/i.test(key) && /warcraft/i.test(v))wowRoots.add(v);else if(typeof v==='object')walk(v);}}; walk(JSON.parse(battleConfig));
  } catch { /* Optional launcher config may be absent. */ }
  const wowLabels={_retail_:'Retail',_classic_:'Classic',_classic_era_:'Classic Era',_classic_anniversary_:'Classic Anniversary',_forever_:'Forever',_ptr_:'PTR',_xptr_:'PTR',_beta_:'Beta',_classic_beta_:'Classic Beta'};
  for(const root of wowRoots) if(root) {
    for(const item of await entries(root)) if(item.isDirectory() && !item.isSymbolicLink() && /^_.*_$/.test(item.name)) {
      const dir=path.join(root,item.name), exe=(await entries(dir)).find(e=>e.isFile() && /^wow(?:classic|t|b)?\.exe$/i.test(e.name));
      if(exe) await add(`World of Warcraft · ${wowLabels[item.name]||item.name.replaceAll('_','')}`,dir,'Battle.net',path.join(dir,exe.name));
    }
    if(await exists(path.join(root,'Wow.exe'))) await add('World of Warcraft',root,'Battle.net',path.join(root,'Wow.exe'));
  }
  for(const item of await entries(path.join(pd,'Epic','EpicGamesLauncher','Data','Manifests'))) if(item.name.endsWith('.item')) {
    try { const data=JSON.parse(await read(path.join(pd,'Epic','EpicGamesLauncher','Data','Manifests',item.name))); const exe=data.LaunchExecutable && safeChild(data.InstallLocation,data.LaunchExecutable); await add(data.DisplayName,data.InstallLocation,'Epic Games',exe); } catch {warnings.push(`An Epic manifest could not be read: ${item.name}`);}
  }
  for(const game of registry.gog || []) await add(game.gameName,game.path,'GOG',game.exe && safeChild(game.path,game.exe));
  for(const entry of registry.entries || []) {
    const name=entry.DisplayName||'',root=entry.InstallLocation;
    if(!root || /world of warcraft|steam|battle.net|riot client|vanguard|launcher|redistributable|sdk|anticheat/i.test(name)) continue;
    if(/riot|blizzard|ubisoft|electronic arts|rockstar|bethesda|gog|2k games|square enix/i.test(entry.Publisher||'')) await add(name,root,'Windows install');
  }
  for(const [name,root,exe] of [
    ['League of Legends','C:\\Riot Games\\League of Legends','Game\\League of Legends.exe'],
    ['Teamfight Tactics','C:\\Riot Games\\Teamfight Tactics','Game\\League of Legends.exe'],
    ['VALORANT','C:\\Riot Games\\VALORANT','live\\ShooterGame\\Binaries\\Win64\\VALORANT-Win64-Shipping.exe']
  ]) if(await exists(path.join(root,exe))) await add(name,root,'Riot Games',path.join(root,exe));
  // Standard custom install folders, kept shallow. Never walk whole disks.
  for(const drive of options.drives || registry.drives || ['C:\\','D:\\','E:\\','F:\\']) {
    for(const folder of ['Games','GOG Games','XboxGames']) for(const item of await entries(path.join(drive,folder))) if(item.isDirectory() && !item.isSymbolicLink()) {
      const root=path.join(drive,folder,item.name);
      if(found.some(g=>normalize(g.installPath)===normalize(root))) continue;
      const exes=await findExecutables(root); if(exes.length) await add(item.name,root,folder==='XboxGames'?'Xbox':folder==='GOG Games'?'GOG':'Games folder');
    }
  }
  found.sort((a,b)=>Number(/World of Warcraft/i.test(b.name))-Number(/World of Warcraft/i.test(a.name))||a.name.localeCompare(b.name));
  return {games:found,warnings,scannedAt:new Date().toISOString()};
}
function createGameProfile(game,base,model,plate,executablePath=game.executablePath) {
  if(!game.executables.some(p=>normalize(p)===normalize(executablePath))) throw new Error('Choose a detected executable or locate the game’s executable first.');
  const profile=base?structuredClone(base):newProfile(game.name,model,plate);
  if(base && (base.model!==model || base.plate!==plate)) throw new Error('Choose a standard profile for the same mouse and side plate.');
  return validateProfile({...profile,id:crypto.randomUUID(),name:game.name.slice(0,60),gameId:game.id,gameName:game.name,executable:path.basename(executablePath),executablePath});
}
function matchGameProfile(profiles,foreground,model,plate) {
  const candidates=profiles.filter(p=>p.model===model && p.plate===plate && p.executable);
  return candidates.find(p=>p.executablePath && foreground.path && normalize(p.executablePath)===normalize(foreground.path)) ||
    candidates.find(p=>!p.executablePath && p.executable.toLowerCase()===(foreground.executable||'').toLowerCase());
}
function automaticTarget(profiles,devices,active,foreground,fallbackId) {
  if(!foreground.executable || /^(neuron|electron)\.exe$/i.test(foreground.executable))return null;
  if(active) {
    const profile=matchGameProfile(profiles,foreground,active.profile.model,active.profile.plate);
    if(profile)return profile.id===active.profile.id?null:{profile,deviceId:active.deviceId};
    if(!active.profile.executable)return null;
    if(!foreground.path && foreground.executable.toLowerCase()===active.profile.executable.toLowerCase())return null;
    const compatible=p=>!p.executable && p.model===active.profile.model && p.plate===active.profile.plate;
    const fallback=profiles.find(p=>p.id===fallbackId && compatible(p))||profiles.find(compatible);
    return fallback?{profile:fallback,deviceId:active.deviceId}:{restore:true,deviceId:active.deviceId};
  }
  for(const device of devices.filter(d=>d.support !== 'recognition-only' && driverFor(d)))for(const plate of [...driverFor(device).plates].reverse()) {
    const profile=matchGameProfile(profiles,foreground,device.modelId ?? device.productId,plate);
    if(profile)return {profile,deviceId:device.id};
  }
  return null;
}
class GameLibrary {
  constructor(directory) {
    this.file=path.join(directory,'games.json'); this.data={games:[],warnings:[],scannedAt:null}; this.pending=null;
    try {const data=JSON.parse(syncFs.readFileSync(this.file,'utf8')); if(Array.isArray(data.games))this.data=data;}catch{}
  }
  scan() {
    if(this.pending)return this.pending;
    this.pending=scanGames().then(data=>{
      for(const old of this.data.games) if(old.manual && syncFs.existsSync(old.executablePath)) {
        const detected=data.games.find(g=>g.id===old.id);
        if(detected) { detected.executablePath=old.executablePath; detected.executables=[...new Set([...detected.executables,old.executablePath])]; detected.manual=true; }
        else data.games.push(old);
      }
      this.data=data; atomicWrite(this.file,data); return data;
    }).finally(()=>this.pending=null); return this.pending;
  }
  add(file,name,id) {
    if(!path.isAbsolute(file)||!file.toLowerCase().endsWith('.exe')||!syncFs.statSync(file).isFile())throw new Error('Choose a local game executable.');
    let game=this.data.games.find(g=>g.id===id);
    if(game) { game.executables=[...new Set([...game.executables,file])]; game.executablePath=file; game.manual=true; }
    else {game={id:gameId(path.dirname(file)),name:name||path.basename(file,'.exe'),installPath:path.dirname(file),source:'Added manually',executables:[file],executablePath:file,manual:true};this.data.games.push(game);}
    atomicWrite(this.file,this.data);return game;
  }
}
module.exports={scanGames,findExecutables,vdfValues,safeChild,GameLibrary,createGameProfile,matchGameProfile,automaticTarget,gameId};
