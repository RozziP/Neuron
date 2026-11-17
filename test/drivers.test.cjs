const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const hid = require('node-hid');
const { Hardware, actionsFor } = require('../app/hardware.cjs');
const { discoverReceivers } = require('../app/receivers.cjs');
const { DeviceModels } = require('../app/device-models.cjs');
const { driverFor, pairedMouse } = require('../app/drivers.cjs');
const { newProfile } = require('../app/store.cjs');
const { checksum, packet, decode } = require('../app/protocol.cjs');
const { automaticTarget } = require('../app/games.cjs');

const dockRecords = [[-1,1,128],[-1,12,1],[0,1,2],[1,1,0],[1,1,2],[1,1,6],[1,1,128],[1,12,1],[2,1,6]]
  .map(([iface,usagePage,usage],i) => ({vendorId:5426,productId:164,product:'Razer Mouse Dock Pro',
    manufacturer:'Razer',release:257,interface:iface,usagePage,usage,path:`dock-${i}`,serialNumber:''}));
function directory(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'neuron-drivers-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); return dir;
}
function fixture(t, pid, paired = null) {
  let records=pid===164 ? dockRecords : [{vendorId:0x1532,productId:pid,serialNumber:'fixture',path:'mouse',interface:0,usagePage:1,usage:2}];
  t.mock.method(hid,'devicesAsync',async()=>records);
  const memory=new Map(), writes=[], requests=[];
  // Captured native length-1 keyboard form; all seven bytes must survive restore.
  const original=[2,1,0,0x1e,0,0,0];
  let rejectSource=null, pairedId=paired;
  const bridge={call:async (_method,{report})=>{
    const req=Buffer.from(report,'base64'); requests.push(req);
    const reply=Buffer.from(req); reply[0]=2;
    if(req[6]===0 && req[7]===0xbf) {
      if(pairedId===null) throw new Error('Identity command unsupported');
      reply.set([1,1,pairedId>>8,pairedId&255],8);
    } else if(req[6]===7) reply.set([0,128],8);
    else {
      assert.equal(req[1],0x1f); assert.equal(req[6],2); assert.equal(req[5],10);
      const slot=req[8], source=req[9], key=`${slot}:${source}`;
      if(req[7]===12) {
        writes.push({slot,source,layer:req[10],raw:[...req.subarray(11,18)]});
        memory.set(key,[...req.subarray(11,18)]);
        if(source===rejectSource && req[14]===4) throw new Error('Lost write acknowledgement');
      } else assert.equal(req[7],0x8c);
      reply[10]=1; // Observed stored flag is not a requested-layer echo.
      reply.set(memory.get(key)||original,11);
    }
    reply[88]=checksum(reply); return {report:reply.toString('base64')};
  }};
  const h=new Hardware(bridge,directory(t));
  return {h,memory,writes,requests,original,disconnect:()=>{records=[];},reject:source=>{rejectSource=source;},pair:pid=>{pairedId=pid;}};
}

test('all nine reported Dock Pro collections produce one connection, never an inferred mouse', () => {
  const [d]=discoverReceivers(dockRecords);
  assert.equal(discoverReceivers(dockRecords).length,1);
  assert.equal(d.productId,164); assert.equal(d.paths[0].interface,0); assert.equal(d.driver,null);
  assert.equal(discoverReceivers([...dockRecords].reverse())[0].id,d.id);
  assert.equal(discoverReceivers(dockRecords.filter(d=>d.interface!==0)).length,0);
  assert.equal(discoverReceivers([...dockRecords,{...dockRecords[2],path:'second-dock'}]).length,2);
});

test('manual model and preferred mouse survive restart without changing transport identity', async t => {
  const {h}=fixture(t,164), [dock]=await h.devices();
  await h.selectModel(dock.id,0x00a8); h.models.prefer(0x00a8);
  const restarted=new Hardware(null,h.directory), [selected]=await restarted.devices();
  assert.equal(selected.modelId,0x00a8); assert.equal(selected.productId,164);
  assert.equal(selected.modelSource,'manual'); assert.equal(selected.driver,'naga-v2-pro-experimental');
  assert.equal(restarted.models.preferredModel,0x00a8);
  await assert.rejects(h.selectModel(dock.id,'168'),/valid mouse/);
  await h.selectModel(dock.id,0x0067);
  assert.equal((await h.devices())[0].driver,null,'Picking Trinity must not enable its driver on a dock');
  await assert.rejects(h.target(dock.id),/not supported/);
  await h.selectModel(dock.id,null);
  assert.equal(new DeviceModels(h.directory).models[dock.id],undefined);
});

test('dock identification selects a known paired Naga, caches reads, and asks when uncertain', async t => {
  const f=fixture(t,164,0x00a8), [d]=await f.h.devices();
  assert.equal(d.modelSource,'automatic'); assert.equal(d.modelId,0x00a8);
  await f.h.devices(); assert.equal(f.requests.length,1);
  assert.equal((await f.h.target(d.id)).path,'dock-2');
  f.disconnect(); assert.deepEqual(await f.h.devices(),[]);
  assert.equal(f.h.dockModels.size,0);
  await assert.rejects(f.h.target(d.id),/disconnected/);
  assert.equal(pairedMouse(Buffer.from([2,1,0,168,1,0,232])),null);
  assert.equal(pairedMouse(Buffer.from([1,0,0,168])),null);
  assert.throws(()=>pairedMouse(Buffer.from([27])),/Invalid/);
});

for(const pid of [0x008f,0x0090,0x00a7,0x00a8,0x00b4,0x00e7,0x00e8,0x00a4]) {
  test(`driver ${pid.toString(16)} preflights, applies, reads back and restores native function bytes`,async t=>{
    const f=fixture(t,pid,pid===164?0x00a8:null), [d]=await f.h.devices();
    const model=d.modelId??pid, profile=newProfile('Test',model,12);
    profile.bindings[0]={type:'key',value:'Ctrl+Q'};
    await f.h.apply(d.id,profile);
    assert.deepEqual(f.memory.get('0:64'),[2,2,1,20,0,0,0]);
    assert.ok(f.writes.every(w=>w.layer===0));
    assert.deepEqual([...new Set(f.writes.map(w=>w.slot))],pid===0x00b4?[1,0]:[0]);
    const firstWrite=f.requests.findIndex(r=>r[6]===2&&r[7]===12);
    assert.equal(f.requests.slice(0,firstWrite).filter(r=>r[7]===0x8c).length,12*(pid===0x00b4?2:1));
    const count=f.writes.length; await f.h.apply(d.id,profile); assert.equal(f.writes.length,count);
    await f.h.restore(d.id); for(const block of f.memory.values())assert.deepEqual(block,f.original);
    const game={...profile,executable:'Game.exe'};
    assert.equal(automaticTarget([game],[d],null,{executable:'Game.exe'},null).deviceId,d.id);

  });
}

test('modern failures roll back even after a write applied but its acknowledgement was lost',async t=>{
  const f=fixture(t,0x00a8),[d]=await f.h.devices(),p=newProfile('Test',0x00a8,12);
  p.bindings[1]={type:'key',value:'A'}; f.reject(65);
  await assert.rejects(f.h.apply(d.id,p),/Previous mappings restored/);
  for(const block of f.memory.values())assert.deepEqual(block,f.original);
});

for(const pid of [0x00a7,0x00a8,0x00a4]) {
  test(`V2 Pro top buttons preserve native actions through apply, restore and rollback via ${pid.toString(16)}`,async t=>{
    const f=fixture(t,pid,pid===0x00a4?0x00a8:null),[d]=await f.h.devices();
    const nativeFront=[0x12,1,4,0,0,0,0],nativeRear=[6,1,6,0,0,0,0];
    f.memory.set('0:109',nativeFront);f.memory.set('0:96',nativeRear);
    const p=newProfile('Top buttons',d.modelId??pid,6);
    p.topBindings['dpi-up']={type:'key',value:'Q'};p.topBindings['dpi-down']={type:'key',value:'E'};
    await f.h.apply(d.id,p);
    assert.deepEqual(f.memory.get('0:109'),[2,2,0,20,0,0,0]);
    assert.deepEqual(f.memory.get('0:96'),[2,2,0,8,0,0,0]);
    await f.h.restore(d.id);
    assert.deepEqual(f.memory.get('0:109'),nativeFront);assert.deepEqual(f.memory.get('0:96'),nativeRear);
    p.topBindings['dpi-down']={type:'key',value:'A'};f.reject(96);
    await assert.rejects(f.h.apply(d.id,p),/Previous mappings restored/);
    assert.deepEqual(f.memory.get('0:109'),nativeFront);assert.deepEqual(f.memory.get('0:96'),nativeRear);
    assert.equal(f.requests.some(r=>r[6]===4),false,'Button remapping must not change DPI.');
  });
}

for(const pid of [0x00e7,0x00e8,0x00a4]) {
  test(`V3 Pro body buttons restore native actions and roll back via ${pid.toString(16)}`,async t=>{
    const f=fixture(t,pid,pid===0x00a4?0x00e8:null),[d]=await f.h.devices();
    const originals=new Map([[11,[6,1,1,0,0,0,0]],[12,[6,1,2,0,0,0,0]],
      [57,[11,1,1,0,0,0,0]],[106,[0x12,1,1,0,0,0,0]],[128,[0,1,0,0,0,0,0]],[14,[7,1,1,0,0,0,0]]]);
    for(const [source,raw] of originals)f.memory.set(`0:${source}`,raw);
    const p=newProfile('V3 body buttons',d.modelId??pid,6);
    for(const id of ['dpi-up','dpi-down','pinky','scroll-front','scroll-rear','profile-cycle'])p.topBindings[id]={type:'key',value:'Q'};
    await f.h.apply(d.id,p);
    for(const source of originals.keys())assert.deepEqual(f.memory.get(`0:${source}`),[2,2,0,20,0,0,0]);
    await f.h.restore(d.id);
    for(const [source,raw] of originals)assert.deepEqual(f.memory.get(`0:${source}`),raw);
    p.topBindings['scroll-rear']={type:'key',value:'A'};f.reject(128);
    await assert.rejects(f.h.apply(d.id,p),/Previous mappings restored/);
    for(const [source,raw] of originals)assert.deepEqual(f.memory.get(`0:${source}`),raw);
    assert.equal(f.requests.some(r=>r[6]===4),false,'Button remapping must not change DPI.');
  });
}

for(const [pid,controls] of [[0x008f,{'dpi-up':12,'dpi-down':11,'profile-cycle':14}],
  [0x0090,{'dpi-up':12,'dpi-down':11,'profile-cycle':14}],
  [0x008d,{'dpi-up':12,'dpi-down':11}],[0x0096,{'dpi-cycle':96}],
  [0x00b4,{'dpi-up':11,'dpi-down':12}]]) {
  test(`modern Naga ${pid.toString(16)} body buttons write and restore every storage bank`,async t=>{
    const f=fixture(t,pid),[d]=await f.h.devices(),p=newProfile('Body controls',pid,12);
    const slots=pid===0x00b4?[1,0]:[0],native=[6,1,6,0,0,0,0];
    for(const [id,source] of Object.entries(controls)) {
      p.topBindings[id]={type:'key',value:'Q'};
      for(const slot of slots)f.memory.set(`${slot}:${source}`,native);
    }
    await f.h.apply(d.id,p);
    for(const source of Object.values(controls)) for(const slot of slots)assert.deepEqual(f.memory.get(`${slot}:${source}`),[2,2,0,20,0,0,0]);
    await f.h.restore(d.id);
    for(const source of Object.values(controls)) for(const slot of slots)assert.deepEqual(f.memory.get(`${slot}:${source}`),native);
    const last=Object.keys(controls).at(-1);p.topBindings[last]={type:'key',value:'A'};f.reject(controls[last]);
    await assert.rejects(f.h.apply(d.id,p),/Previous mappings restored/);
    for(const source of Object.values(controls)) for(const slot of slots)assert.deepEqual(f.memory.get(`${slot}:${source}`),native);
    assert.equal(f.requests.some(r=>r[6]===4),false);
  });
}

test('model, plate and short-reply mismatches fail before writes',async t=>{
  const f=fixture(t,0x00a8),[d]=await f.h.devices();
  await assert.rejects(f.h.apply(d.id,newProfile()),/does not match/);
  await assert.rejects(f.h.apply(d.id,newProfile('Bad plate',0x00a8,7)),/side plate/);
  assert.equal(f.writes.length,0);
  const request=packet(0x8c,[0,64]), reply=Buffer.from(request);reply[0]=2;reply[5]=7;reply[88]=checksum(reply);
  assert.throws(()=>decode(reply,request),/Incomplete button/);
  assert.equal(driverFor({vendorId:0x3554,productId:0xf55d,modelId:0x00a8}),null);
});

test('Pro plates and V2 top buttons use their model-specific source IDs',()=>{
  const two=newProfile('Two',0x0090,2);
  assert.deepEqual(actionsFor(two).map(a=>a.source),[5,4]);
  const six=newProfile('Six',0x00a8,6);six.topBindings['dpi-up']={type:'key',value:'Q'};six.topBindings['dpi-down']={type:'key',value:'E'};
  assert.deepEqual(actionsFor(six).slice(-2).map(a=>a.source),[109,96]);
  six.topBindings['dpi-up']={type:'default',value:''};six.topBindings['dpi-down']={type:'default',value:''};
  assert.deepEqual(actionsFor(six).map(a=>a.source),[80,81,82,83,84,85]);
});
