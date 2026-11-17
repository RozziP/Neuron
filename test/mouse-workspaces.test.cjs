const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {MouseWorkspaces}=require('../app/mouse-workspaces.cjs');
const {Store,newProfile,atomicWrite}=require('../app/store.cjs');
const trinity={id:'trinity-one',vendorId:0x1532,productId:0x0067,name:'Naga Trinity'};
const redragon={id:'redragon-one',vendorId:0x3554,productId:0xf55d,modelId:0xf55d,connection:'receiver',name:'Redragon M990-WL'};
function directory(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'neuron-workspaces-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('first launch starts empty and selects the actual mouse without inventing a Trinity',t=>{
  const dir=directory(t),m=new MouseWorkspaces(dir);
  assert.deepEqual(m.entries,[]);assert.equal(m.storeFor(),null);
  assert.equal(fs.existsSync(path.join(dir,'profiles.json')),false);
  assert.deepEqual(new MouseWorkspaces(dir).entries,[]);
  m.reconcile([redragon]);assert.equal(m.selected.model,redragon.modelId);
  assert.equal(m.entries.length,1);assert.equal(m.storeFor().profiles[0].model,redragon.modelId);
});
function legacyDefault(t) {
  const dir=directory(t),legacy=new Store(dir),key='11111111-1111-4111-8111-111111111111';
  const file=path.join(dir,'mice',key,'profiles.json');
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(legacy.file,file);
  const entry={key,model:103,deviceId:null,name:'Razer Naga Trinity'};
  atomicWrite(path.join(dir,'mouse-workspaces.json'),{version:1,selectedKey:key,entries:[entry]});
  return {dir,legacy,file,entry};
}
test('upgrade hides only the untouched legacy placeholder and keeps its files',t=>{
  const {dir,legacy,file}=legacyDefault(t),before=fs.readFileSync(file,'utf8'),m=new MouseWorkspaces(dir);
  assert.deepEqual(m.entries,[]);assert.equal(m.selectedKey,null);
  assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(fs.readFileSync(legacy.file,'utf8'),before);
  m.reconcile([redragon]);assert.equal(m.selected.model,redragon.modelId);
  assert.equal(new MouseWorkspaces(dir).entries.length,1);
});
test('upgrade preserves edited, previously connected, and independently created offline Trinity workspaces',t=>{
  for(const kind of ['binding','name','macro','connected','independent']) {
    const {dir,file,entry}=legacyDefault(t),s=new Store(path.dirname(file));
    if(kind==='binding'){const p=s.profiles[0];p.bindings[0]={type:'key',value:'Ctrl+Q'};s.save(p);}
    if(kind==='name'){const p=s.profiles[0];p.name='My mouse';s.save(p);}
    if(kind==='macro')s.saveMacros([{id:'kept',name:'Kept macro',repeat:1,steps:[{type:'key',value:'A'}]}]);
    if(kind==='connected'){entry.deviceId=trinity.id;atomicWrite(path.join(dir,'mouse-workspaces.json'),{version:1,selectedKey:entry.key,entries:[entry]});}
    if(kind==='independent')atomicWrite(file,{version:2,macros:[],profiles:[newProfile()]});
    const before=fs.readFileSync(file,'utf8'),m=new MouseWorkspaces(dir);
    assert.equal(m.entries.length,1,kind);assert.equal(m.selectedKey,entry.key,kind);
    assert.equal(fs.readFileSync(file,'utf8'),before,kind);
  }
});
test('an explicitly selected offline Trinity remains after restart',t=>{
  const dir=directory(t),m=new MouseWorkspaces(dir),entry=m.offline(103);m.select(entry.key);
  assert.equal(new MouseWorkspaces(dir).selectedKey,entry.key);
});
test('legacy profiles migrate by model, retain macros, and leave the source intact',t=>{
  const dir=directory(t),old=new Store(dir);
  const macro={id:'combo',name:'Legacy combo',repeatMode:'once',repeat:1,steps:[{type:'key',value:'Ctrl+1'}]};
  old.saveMacros([macro]);old.save(newProfile('Redragon profile',0xf55d,16));
  const original=fs.readFileSync(old.file,'utf8'),m=new MouseWorkspaces(dir);
  assert.equal(m.entries.length,2);
  for(const entry of m.entries){const s=m.storeFor(entry);assert.ok(s.profiles.every(p=>p.model===entry.model));assert.equal(s.macros[0].name,'Legacy combo');}
  assert.equal(fs.readFileSync(old.file,'utf8'),original);
  const a=m.entries[0],b=m.entries[1];m.select(a.key);m.storeFor().saveMacros([]);
  m.select(b.key);assert.equal(m.storeFor().macros.length,1);
  assert.equal(new MouseWorkspaces(dir).selectedKey,b.key);
});
test('two identical mice have different profiles, macros, and stable reconnect ownership',t=>{
  const dir=directory(t),m=new MouseWorkspaces(dir),second={...trinity,id:'trinity-two'};
  m.reconcile([trinity,second]);assert.equal(m.entries.length,2);
  const [a,b]=m.entries;assert.notEqual(a.name,b.name);
  m.select(a.key);const profile=m.storeFor().profiles[0];profile.name='Mouse one only';m.storeFor().save(profile);
  m.storeFor().saveMacros([{id:'private-macro',name:'Mouse one macro',repeatMode:'once',repeat:1,steps:[{type:'key',value:'A'}]}]);
  m.select(b.key);assert.equal(m.storeFor().profiles.length,1);assert.equal(m.storeFor().macros.length,0);
  assert.throws(()=>m.assertProfile(profile),/another mouse/);
  assert.throws(()=>m.assertDevice(trinity.id,[trinity,second]),/sidebar/);
  assert.equal(m.device([trinity,second]).id,second.id);
  m.reconcile([trinity]);assert.equal(m.device([trinity]),undefined);assert.equal(m.selectedKey,b.key);
  m.reconcile([second,trinity]);assert.equal(m.entries.length,2);assert.equal(m.device([second,trinity]).id,second.id);
  const restarted=new MouseWorkspaces(dir);restarted.reconcile([trinity,second]);assert.equal(restarted.device([trinity,second]).id,second.id);
});
test('a different mouse model cannot read, save, export, apply or create a profile in this workspace',t=>{
  const m=new MouseWorkspaces(directory(t));m.reconcile([trinity,redragon]);
  const naga=m.entries.find(e=>e.model===103),red=m.entries.find(e=>e.model===0xf55d);
  const nagaProfile=m.storeFor(naga).profiles[0];m.select(red.key);
  assert.throws(()=>m.assertModel(103),/different mouse/);
  assert.throws(()=>m.assertProfile(nagaProfile),/different mouse/);
  assert.throws(()=>m.assertProfile({...m.storeFor().profiles[0],id:'foreign-id'},{existing:true}),/not found/);
  assert.ok(m.storeFor().profiles.every(p=>p.model===0xf55d));
  assert.throws(()=>m.assertDevice(trinity.id,[trinity,redragon]),/sidebar/);
});
test('unidentified receivers have no profiles and identifying one opens only its own workspace',t=>{
  const m=new MouseWorkspaces(directory(t)),unknown={...redragon,modelId:undefined};
  m.reconcile([trinity,unknown]);const entry=m.entries.find(e=>e.model===null);m.select(entry.key);
  assert.equal(m.storeFor(),null);assert.throws(()=>m.assertProfile(newProfile()),/different mouse/);
  m.reconcile([trinity,redragon]);assert.equal(m.selected.model,0xf55d);assert.equal(m.storeFor().profiles[0].model,0xf55d);
  assert.equal(m.entries.filter(e=>e.deviceId===redragon.id).length,1);
});
test('offline workspace is claimed once and does not follow another same-model mouse',t=>{
  const m=new MouseWorkspaces(directory(t)),entry=m.offline(0xf55d);m.select(entry.key);
  const p=m.storeFor().profiles[0];p.name='Offline work';m.storeFor().save(p);
  m.reconcile([redragon]);assert.equal(m.selected.deviceId,redragon.id);assert.equal(m.storeFor().profiles[0].name,'Offline work');
  m.reconcile([{...redragon,id:'different-redragon'}]);assert.equal(m.device([{...redragon,id:'different-redragon'}]),undefined);
  assert.equal(m.entries.filter(e=>e.model===0xf55d).length,2);
});

test('correcting or clearing a receiver model keeps selection on that connection without sharing profiles',t=>{
  const m=new MouseWorkspaces(directory(t));m.reconcile([redragon]);m.select(m.entries.find(e=>e.deviceId===redragon.id).key);
  const old=m.selected.key,p=m.storeFor().profiles[0];p.name='Redragon only';m.storeFor().save(p);
  const corrected={...redragon,modelId:168};m.reconcile([corrected]);
  assert.equal(m.selected.model,168);assert.equal(m.device([corrected]).id,redragon.id);assert.notEqual(m.storeFor().profiles[0].id,p.id);
  m.reconcile([{...redragon,modelId:undefined}],{clearedDeviceId:redragon.id});assert.equal(m.selected.model,null);assert.equal(m.storeFor(),null);
  m.reconcile([redragon]);assert.equal(m.selectedKey,old);assert.equal(m.storeFor().profiles[0].name,'Redragon only');
});

test('losing dock identification keeps the selected Naga profiles without authorizing hardware writes',t=>{
  const dir=directory(t),m=new MouseWorkspaces(dir);
  const dock={id:'dock-one',vendorId:0x1532,productId:0x00a4,connection:'dock',name:'Razer Mouse Dock Pro'};
  const naga={...dock,modelId:0x00a8,name:'Naga V2 Pro · Razer Mouse Dock Pro'};
  m.reconcile([naga]);const entry=m.entries.find(e=>e.deviceId===dock.id);m.select(entry.key);
  const profile=m.storeFor().profiles[0];profile.name='My Naga mappings';m.storeFor().save(profile);
  m.reconcile([dock]);
  assert.equal(m.selectedKey,entry.key);
  assert.equal(m.storeFor().profiles[0].name,'My Naga mappings');
  assert.equal(m.device([dock]),undefined);
  assert.throws(()=>m.assertDevice(dock.id,[dock]),/sidebar/);
  const unknown=m.entries.find(e=>e.deviceId===dock.id && e.model===null);
  assert.ok(unknown);
  const restarted=new MouseWorkspaces(dir);restarted.reconcile([dock]);
  assert.equal(restarted.selectedKey,entry.key);
  m.reconcile([naga]);
  assert.equal(m.selectedKey,entry.key);assert.equal(m.device([naga]).id,dock.id);
  assert.equal(m.entries.some(e=>e.key===unknown.key),false);
  assert.equal(m.storeFor().profiles[0].id,profile.id);
});

test('corrupt profile recovery stays within the selected mouse model',t=>{
  const dir=directory(t),m=new MouseWorkspaces(dir),entry=m.offline(0xf55d);m.select(entry.key);
  fs.writeFileSync(m.profileFile(entry),'{broken');
  const recovered=new MouseWorkspaces(dir).storeFor();
  assert.equal(recovered.profiles[0].model,0xf55d);assert.equal(recovered.profiles[0].plate,16);
  assert.match(recovered.warning,/recovery/);
  assert.ok(fs.readdirSync(path.dirname(m.profileFile(entry))).some(name=>name.includes('.recovery-')));
});
