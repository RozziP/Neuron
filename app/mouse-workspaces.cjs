const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {Store,newProfile,validateProfile,atomicWrite}=require('./store.cjs');
const {isDeepStrictEqual}=require('node:util');
const {catalog}=require('./catalog.cjs');
const modelOf=d=>d.modelId??d.productId;
function knownModel(device) {
  if(device.connection && !device.modelId)return null;
  return catalog.find(m=>m.productId===modelOf(device) && (device.modelId || m.vendorId===device.vendorId))?.productId??null;
}
function untouchedTrinityDefault(file) {
  try {
    const data=JSON.parse(fs.readFileSync(file,'utf8'));
    if(data.version!==2 || !Array.isArray(data.macros) || data.macros.length || data.profiles?.length!==1 || data.profiles[0].dpi!==undefined)return null;
    const profile=validateProfile({...data.profiles[0],macros:[]});
    return isDeepStrictEqual({...profile,id:''},{...validateProfile(newProfile()),id:''}) ? profile.id : null;
  } catch {return null;}
}
class MouseWorkspaces {
  constructor(directory) {
    this.directory=directory;this.file=path.join(directory,'mouse-workspaces.json');this.stores=new Map();this.entries=[];this.selectedKey=null;
    let cleanupDone=false;
    if(fs.existsSync(this.file)) {
      const data=JSON.parse(fs.readFileSync(this.file,'utf8'));
      if(data.version!==1 || !Array.isArray(data.entries) || data.entries.some(e=>!e || !/^[a-f0-9-]{36}$/.test(e.key) || ![null,'string'].includes(e.deviceId===null?null:typeof e.deviceId) || (e.model!==null&&!catalog.some(m=>m.productId===e.model))) || new Set(data.entries.map(e=>e.key)).size!==data.entries.length) throw new Error('Mouse workspace settings are invalid. Your profiles have been kept on disk.');
      this.entries=data.entries;this.selectedKey=this.entries.some(e=>e.key===data.selectedKey)?data.selectedKey:this.entries[0]?.key;
      cleanupDone=data.defaultWorkspaceCleanup===true;
    } else if(fs.existsSync(path.join(directory,'profiles.json'))) {
      // Preserve the legacy file. Each existing model gets an independent copy;
      // subsequent edits never synchronize profiles or macros between mice.
      const legacy=new Store(directory);
      for(const model of [...new Set(legacy.profiles.map(p=>p.model))]) {
        if(!catalog.some(m=>m.productId===model))continue;
        const entry=this.create(model,null);
        atomicWrite(this.profileFile(entry),{version:2,macros:legacy.macros,profiles:legacy.profiles.filter(p=>p.model===model).map(({macros,...p})=>p)});
      }
      this.selectedKey=this.entries[0]?.key;
    }
    if(!cleanupDone) {
      // Old first launches seeded a Trinity even with no mouse. Only hide an
      // unclaimed, unchanged copy of that legacy default; retain its files.
      const seed=untouchedTrinityDefault(path.join(directory,'profiles.json'));
      if(seed)this.entries=this.entries.filter(e=>!(e.model===0x0067 && e.deviceId===null && e.name===this.modelName(0x0067) && untouchedTrinityDefault(this.profileFile(e))===seed));
      if(!this.entries.some(e=>e.key===this.selectedKey))this.selectedKey=this.entries[0]?.key??null;
      this.persist();
    }
  }
  profileFile(entry) {return path.join(this.directory,'mice',entry.key,'profiles.json');}
  create(model,deviceId,name) {
    const count=this.entries.filter(e=>e.model===model).length;
    const entry={key:randomUUID(),model,deviceId,name:(name||this.modelName(model))+(count?` · ${count+1}`:'')};this.entries.push(entry);return entry;
  }
  modelName(model) {const m=catalog.find(m=>m.productId===model);return m?`${m.brand||'Razer'} ${m.name}`:'Unknown mouse';}
  persist() {atomicWrite(this.file,{version:1,defaultWorkspaceCleanup:true,selectedKey:this.selectedKey,entries:this.entries});}
  get selected() {return this.entries.find(e=>e.key===this.selectedKey);}
  storeFor(entry=this.selected) {
    if(!entry || entry.model===null)return null;
    if(!this.stores.has(entry.key)) {
      const file=this.profileFile(entry);
      if(!fs.existsSync(file))atomicWrite(file,{version:2,macros:[],profiles:[newProfile('Default',entry.model,catalog.find(m=>m.productId===entry.model).buttons)]});
      const store=new Store(path.dirname(file),{model:entry.model,plate:catalog.find(m=>m.productId===entry.model).buttons});
      if(store.profiles.some(p=>p.model!==entry.model))throw new Error('A profile belongs to a different mouse workspace.');
      this.stores.set(entry.key,store);
    }
    return this.stores.get(entry.key);
  }
  reconcile(devices,{clearedDeviceId=null}={}) {
    let changed=false;
    for(const device of devices) {
      const model=knownModel(device);
      let entry=this.entries.find(e=>e.deviceId===device.id && e.model===model);
      if(!entry) {
        entry=model!==null && this.entries.find(e=>e.model===model && e.deviceId===null);
        if(entry)entry.deviceId=device.id;
        else entry=this.create(model,device.id,device.name);
        changed=true;
      }
      // A sleeping mouse or failed receiver probe is not a request to abandon
      // its profiles. Keep the workspace selected; device() still requires a
      // matching identified model before any hardware operation is allowed.
      if(this.selected?.deviceId===device.id && this.selectedKey!==entry.key && (model!==null || clearedDeviceId===device.id)){this.selectedKey=entry.key;changed=true;}
      if(model!==null) {
        const unknown=this.entries.find(e=>e.deviceId===device.id && e.model===null);
        if(unknown) {
          if(this.selectedKey===unknown.key)this.selectedKey=entry.key;
          this.entries=this.entries.filter(e=>e!==unknown);changed=true;
        }
      }
    }
    if(!this.selected && this.entries.length){this.selectedKey=this.entries[0].key;changed=true;}
    if(changed)this.persist();
  }
  device(devices,entry=this.selected) {return entry?.deviceId ? devices.find(d=>d.id===entry.deviceId && knownModel(d)===entry.model):null;}
  summaries(devices) {return this.entries.map(e=>({key:e.key,model:e.model,name:e.name,deviceId:e.deviceId,connected:!!this.device(devices,e)}));}
  select(key) {
    if(!this.entries.some(e=>e.key===key))throw new Error('Choose a mouse from the sidebar.');
    this.selectedKey=key;this.persist();return this.storeFor();
  }
  offline(model) {
    if(!catalog.some(m=>m.productId===model))throw new Error('Choose a valid mouse model.');
    const entry=this.entries.find(e=>e.model===model) || this.create(model,null);this.persist();return entry;
  }
  assertModel(model) {if(!this.selected || this.selected.model===null || this.selected.model!==model)throw new Error('This profile belongs to a different mouse. Select that mouse in the sidebar first.');}
  assertDevice(id,devices) {if(!id || this.device(devices)?.id!==id)throw new Error('Select this mouse in the sidebar before changing its settings.');}
  assertProfile(input,{existing=false}={}) {
    this.assertModel(input?.model);
    const store=this.storeFor();
    if(existing && !store.profiles.some(p=>p.id===input.id))throw new Error('Profile not found for the selected mouse.');
    for(const entry of this.entries)if(entry.key!==this.selectedKey && entry.model!==null && this.storeFor(entry).profiles.some(p=>p.id===input.id))throw new Error('This profile belongs to another mouse.');
    return store;
  }
}
module.exports={MouseWorkspaces,knownModel};
