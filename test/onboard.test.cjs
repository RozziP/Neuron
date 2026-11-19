const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Hardware } = require('../app/hardware.cjs');
const { newProfile } = require('../app/store.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'neuron-onboard-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const device = {id:'trinity-one',vendorId:0x1532,productId:0x0067,path:'simulated'};
  const memory = new Map(), writes = [];
  const original = (slot,source) => source === 3 ? {type:1,params:[3]} : {type:2,params:[slot,30]};
  const connect = h => {
    h.target = async id => { assert.equal(id,device.id); return device; };
    h.read = async (_device,slot,source) => structuredClone(memory.get(`${slot}:${source}`) || original(slot,source));
    h.exchange = async (_path,report) => {
      assert.equal(report[7],12);
      const entry = {slot:report[8],source:report[9],action:{type:report[11],params:[...report.subarray(13,13+report[12])]}};
      assert.ok(fs.existsSync(h.backupFile(device)),'originals saved before device writes');
      memory.set(`${entry.slot}:${entry.source}`,entry.action);writes.push(entry);
      return [];
    };
    return h;
  };
  const h = connect(new Hardware(null,directory));
  return {h,device,memory,writes,original,restart:()=>connect(new Hardware(null,directory)),backup:()=>JSON.parse(fs.readFileSync(h.backupFile(device),'utf8'))};
}

test('onboard bindings survive quit cleanup and restart, including temporary profile changes',async t=>{
  const f=fixture(t), p=newProfile('My onboard bindings');p.bindings[0].value='Ctrl+Q';
  await f.h.saveOnboard(f.device.id,p);
  assert.deepEqual(f.memory.get('1:64'),{type:2,params:[1,20]});
  assert.ok(f.writes.findIndex(e=>e.slot===2)<f.writes.findIndex(e=>e.slot===1));
  const count=f.writes.length;
  await f.h.restore(f.device.id,{useOnboard:true});
  assert.equal(f.writes.length,count,'quitting with saved mappings causes no extra writes');
  const restarted=f.restart();
  assert.deepEqual(restarted.onboardSummary(f.device),{name:p.name,plate:12});
  p.bindings[0].value='E';p.topBindings.middle={type:'key',value:'A'};
  await restarted.apply(f.device.id,p);
  await restarted.restore(f.device.id,{useOnboard:true});
  assert.deepEqual(f.memory.get('1:64'),{type:2,params:[1,20]});
  assert.deepEqual(f.memory.get('1:3'),f.original(1,3),'controls added by temporary profiles return to originals');
  assert.equal(f.backup().onboard.name,'My onboard bindings');
});

test('replacing onboard bindings preserves first originals and Restore original clears the preference',async t=>{
  const f=fixture(t),p=newProfile();p.bindings[0].value='Q';
  await f.h.saveOnboard(f.device.id,p);
  const originalEntries=f.backup().entries;
  p.name='Replacement';p.bindings[0].value='E';await f.h.saveOnboard(f.device.id,p);
  assert.deepEqual(f.backup().entries,originalEntries);
  await f.h.restore(f.device.id,{restoreDpi:true});
  assert.equal(f.h.onboardSummary(f.device),null);
  for(const e of originalEntries)assert.deepEqual(f.memory.get(`${e.slot}:${e.source}`),e.action);
  await f.h.apply(f.device.id,p);await f.h.restore(f.device.id,{useOnboard:true});
  assert.deepEqual(f.memory.get('1:64'),f.original(1,64));
});

test('macro assignments and unsupported models/transports are rejected before writes',async t=>{
  const f=fixture(t),p=newProfile();
  p.macros=[{id:'m',name:'Macro',repeat:1,steps:[{type:'key',value:'E'}]}];
  p.bindings[0]={type:'macro',value:'m'};
  await assert.rejects(f.h.saveOnboard(f.device.id,p),/macro assignments/);
  p.bindings[0]={type:'key',value:'Q'};p.topBindings.middle={type:'macro',value:'m'};
  await assert.rejects(f.h.saveOnboard(f.device.id,p),/macro assignments/);
  await assert.rejects(f.h.saveOnboard(f.device.id,newProfile('Pro',0x008f)),/only for Naga Trinity/);
  f.device.productId=0x00a4;f.device.modelId=0x0067;
  await assert.rejects(f.h.saveOnboard(f.device.id,newProfile()),/connected Naga Trinity/);
  assert.equal(f.writes.length,0);
});

test('unused macros are allowed; Original and disabled bindings save correctly without touching DPI',async t=>{
  const f=fixture(t),p=newProfile();
  p.macros=[{id:'m',name:'Unused',repeat:1,steps:[{type:'key',value:'E'}]}];
  await f.h.apply(f.device.id,p);
  p.bindings[0]={type:'default',value:''};p.bindings[1]={type:'disabled',value:''};
  f.h.writeDpi=async()=>assert.fail('onboard operations must not change DPI');
  await f.h.saveOnboard(f.device.id,p);await f.h.restore(f.device.id,{useOnboard:true});
  assert.deepEqual(f.memory.get('1:64'),f.original(1,64));
  assert.deepEqual(f.memory.get('1:65'),{type:0,params:[]});
});

test('saving another plate does not retain temporary macro triggers from the previous plate',async t=>{
  const f=fixture(t),p=newProfile();p.bindings[0].value='Q';
  await f.h.saveOnboard(f.device.id,p);
  p.macros=[{id:'m',name:'Macro',repeat:1,steps:[{type:'key',value:'E'}]}];p.bindings[0]={type:'macro',value:'m'};
  await f.h.apply(f.device.id,p);
  await f.h.saveOnboard(f.device.id,newProfile('Seven buttons',103,7));
  assert.deepEqual(f.memory.get('1:64'),{type:2,params:[0,20]});
  assert.ok(f.backup().onboard.entries.some(e=>e.source===0x50));
});

for (const failure of ['device','disk']) test(`failed ${failure} save retains previous onboard snapshot and rolls back`,async t=>{
  const f=fixture(t),p=newProfile('First');p.bindings[0].value='Q';
  await f.h.saveOnboard(f.device.id,p);
  const baseline=f.backup().onboard, before=structuredClone([...f.memory]);
  p.name='Failed save';p.bindings[0].value='E';
  if(failure==='device') {
    const exchange=f.h.exchange;
    f.h.exchange=async(...args)=>{const result=await exchange(...args);if(args[1][14]===8)throw new Error('Lost acknowledgement');return result;};
  } else {
    const rename=fs.renameSync;
    t.mock.method(fs,'renameSync',(from,to)=>{
      if(String(from).endsWith('.tmp') && JSON.parse(fs.readFileSync(from)).onboard?.name==='Failed save')throw new Error('Disk full');
      return rename(from,to);
    });
  }
  await assert.rejects(f.h.saveOnboard(f.device.id,p),/Previous mappings restored/);
  assert.deepEqual([...f.memory],before);
  assert.deepEqual(f.backup().onboard,baseline);
});

test('failed explicit restore retains onboard preference for retry',async t=>{
  const f=fixture(t);await f.h.saveOnboard(f.device.id,newProfile());
  f.h.write=async()=>{throw new Error('Disconnected');};
  await assert.rejects(f.h.restore(f.device.id,{restoreDpi:true}),/Disconnected/);
  assert.ok(f.backup().onboard);
});

test('onboard preference is isolated to the physical mouse',async t=>{
  const f=fixture(t);await f.h.saveOnboard(f.device.id,newProfile());
  assert.equal(f.h.onboardSummary({...f.device,id:'trinity-two'}),null);
});
