const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {scanGames,createGameProfile,matchGameProfile,gameId}=require('../app/games.cjs');
const {Store,newProfile}=require('../app/store.cjs');
const {automaticTarget}=require('../app/games.cjs');
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'neuron-games-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function file(root,rel,text=''){const target=path.join(root,rel);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);return target;}
test('scanner finds separate WoW clients, Steam libraries and Epic manifests, excludes utility executables',async t=>{
  const dir=temp(t), steam=path.join(dir,'Steam'), other=path.join(dir,'Library');
  file(steam,'steamapps/libraryfolders.vdf',`"libraryfolders" { "1" { "path" "${other.replaceAll('\\','\\\\')}" } }`);
  file(other,'steamapps/appmanifest_42.acf','"AppState" { "name" "Fixture Game" "installdir" "Fixture" }');
  file(other,'steamapps/common/Fixture/Fixture.exe');file(other,'steamapps/common/Fixture/createdump.exe');file(other,'steamapps/common/Fixture/Uninstall.exe');
  file(dir,'World of Warcraft/_retail_/Wow.exe');file(dir,'World of Warcraft/_forever_/Wow.exe');fs.mkdirSync(path.join(dir,'World of Warcraft/_classic_beta_'));
  const epicExe=file(dir,'EpicGame/ActualGame.exe');file(dir,'Epic/EpicGamesLauncher/Data/Manifests/game.item',JSON.stringify({DisplayName:'Epic fixture',InstallLocation:path.dirname(epicExe),LaunchExecutable:'ActualGame.exe'}));
  const result=await scanGames({env:{ProgramFiles:dir,'ProgramFiles(x86)':dir,ProgramData:dir,APPDATA:dir},registry:{steam,entries:[]},drives:[dir]});
  const wow=result.games.filter(g=>g.name.startsWith('World of Warcraft'));
  assert.equal(wow.length,2);assert.notEqual(wow[0].id,wow[1].id);
  const fixture=result.games.find(g=>g.name==='Fixture Game');assert.equal(fixture.executables.length,1);assert.match(fixture.executablePath,/Fixture.exe$/);
  assert.equal(result.games.find(g=>g.name==='Epic fixture').executablePath,epicExe);
});
test('game copies retain macros independently and persist full-path matching for identical executable names',t=>{
  const store=new Store(temp(t)), base=newProfile('Standard');base.macros=[{id:'macro',name:'Combo',repeat:1,steps:[{type:'key',value:'Q'}]}];base.bindings[0]={type:'macro',value:'macro'};
  const make=edition=>{const exe=`C:\\WoW\\_${edition}_\\Wow.exe`;return {id:gameId(exe),name:'World of Warcraft '+edition,executablePath:exe,executables:[exe]};};
  const retail=createGameProfile(make('retail'),base,103,12), forever=createGameProfile(make('forever'),base,103,12);
  store.save(retail);store.save(forever);
  retail.macros[0].name='Independent';assert.equal(base.macros[0].name,'Combo');
  const reload=new Store(store.directory);
  assert.equal(matchGameProfile(reload.profiles,{executable:'Wow.exe',path:forever.executablePath.toUpperCase()},103,12).id,forever.id);
  assert.equal(matchGameProfile(reload.profiles,{executable:'Wow.exe',path:''},103,12),undefined);
  assert.throws(()=>store.save({...retail,id:'duplicate'}),/already uses/);
  assert.throws(()=>createGameProfile(make('retail'),base,103,7),/same mouse/);
  assert.throws(()=>createGameProfile(make('retail'),base,103,12,'C:\\other.exe'),/detected executable/);
});
test('automatic game profiles work before manual apply and return to desktop or originals',()=>{
  const desktop=newProfile(),game={...newProfile('WoW'),executable:'Wow.exe',executablePath:'C:\\WoW\\Wow.exe'};
  const devices=[{id:'mouse',productId:103}],foreground={executable:'Wow.exe',path:game.executablePath};
  assert.equal(automaticTarget([desktop,game],devices,null,foreground).profile.id,game.id);
  const active={deviceId:'mouse',profile:game};
  assert.equal(automaticTarget([desktop,game],devices,active,{executable:'notepad.exe'}).profile.id,desktop.id);
  assert.equal(automaticTarget([game],devices,active,{executable:'notepad.exe'}).restore,true);
  assert.equal(automaticTarget([desktop,game],[],null,foreground),null);
  assert.equal(automaticTarget([desktop,game],devices,active,{executable:'Neuron.exe'}),null);
  assert.equal(automaticTarget([desktop,game],devices,active,foreground),null);
});
test('legacy profile macros migrate to a shared library without losing differing definitions',t=>{
  const dir=temp(t),a=newProfile('A'),b=newProfile('B');
  a.macros=[{id:'shared-id',name:'Combo',repeat:1,steps:[{type:'key',value:'Q'}]}];
  b.macros=[{id:'shared-id',name:'Combo',repeat:1,steps:[{type:'key',value:'E'}]}];
  a.bindings[0]={type:'macro',value:'shared-id'};b.bindings[0]={type:'macro',value:'shared-id'};
  fs.writeFileSync(path.join(dir,'profiles.json'),JSON.stringify({version:1,profiles:[a,b]}));
  const store=new Store(dir);assert.equal(store.macros.length,2);assert.notEqual(store.profiles[0].bindings[0].value,store.profiles[1].bindings[0].value);
  assert.ok(fs.readdirSync(dir).some(f=>f.includes('before-shared-macros')));
  const saved=JSON.parse(fs.readFileSync(store.file));assert.equal(saved.version,2);assert.equal(saved.profiles[0].macros,undefined);
  const library=structuredClone(store.macros);library[0].name='Renamed';store.saveMacros(library);
  assert.equal(new Store(dir).profiles[1].macros[0].name,'Renamed');
  const stale=structuredClone(a);stale.macros[0].name='Stale';store.save(stale);assert.equal(store.macros[0].name,'Renamed');
  store.saveMacros([]);assert.deepEqual(store.profiles[0].bindings[0],{type:'key',value:'1'});assert.deepEqual(store.profiles[1].bindings[0],{type:'key',value:'1'});
  assert.equal(new Store(dir).macros.length,0);
});
