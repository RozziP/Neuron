const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {catalog}=require('../app/catalog.cjs');
const {mappingDrivers,sideSources,driverFor}=require('../app/drivers.cjs');
const {controlsFor}=require('../app/razer-layouts.cjs');
const {newProfile,validateProfile,Store}=require('../app/store.cjs');
const {Hardware,actionsFor}=require('../app/hardware.cjs');
const {checksum}=require('../app/protocol.cjs');
const {collectReports,supportedConfirmation}=require('../app/hardware-report.cjs');
const {bindingFromReply}=require('../app/protocol.cjs');
const {hasBattery,BatteryMonitor}=require('../app/battery.cjs');
function fixture(t,pid) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'neuron-razer-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const memory=new Map(),calls=[],original=[2,1,0,30,0,0,0];let reject=null;
  const model=catalog.find(d=>d.productId===pid),driver=driverFor({productId:pid});
  const device={...model,vendorId:0x1532,id:'fixture',path:'fixture',paths:[{path:'fixture',interface:0,usage:2}]};
  const hardware=new Hardware({call:async(_,{report})=>{
    const req=Buffer.from(report,'base64');calls.push(req);
    assert.equal(req[1],driver.transaction);assert.equal(req[5],driver.requestSize);
    const key=`${req[8]}:${req[9]}`,reply=Buffer.from(req);reply[0]=2;
    if(req[7]===12)memory.set(key,[...req.subarray(11,18)]);
    else {assert.equal(req[7],140);if(req[9]===reject)throw new Error('Unsupported source');}
    reply[10]=1;reply.set(memory.get(key)||original,11);reply[88]=checksum(reply);
    return {report:reply.toString('base64')};
  }},dir);
  hardware.devices=async()=>[device];
  return {hardware,device,memory,calls,original,dir,reject:source=>reject=source};
}
test('every catalog Razer connection has a complete, unique layout; Bluetooth has no USB driver',()=>{
  const models=catalog.filter(m=>m.vendorId===0x1532);
  assert.ok(models.length>120);assert.equal(new Set(models.map(m=>m.productId)).size,models.length);
  for(const model of models) {
    assert.ok(model.controls.length>=5,model.name);
    assert.equal(new Set(model.controls.map(c=>c.id)).size,model.controls.length,model.name);
    if(model.bluetooth){assert.equal(driverFor(model),null);continue;}
    const driver=mappingDrivers.get(model.productId);
    for(const plate of driver.plates) {
      const p=newProfile('Every control',model.productId,plate);
      p.bindings=p.bindings.map(()=>({type:'key',value:'Q'}));
      for(const id of Object.keys(driver.top))p.topBindings[id]={type:'key',value:'Q'};
      p.topBindings.right={type:'mouse',value:'left'};
      const sources=actionsFor(p).map(a=>a.source);
      assert.equal(sources.length,plate+Object.keys(driver.top).length,model.name);
      assert.equal(new Set(sources).size,sources.length,model.name);
      assert.ok(sources.every(s=>Number.isInteger(s)&&s>0&&s<256));
      for(const fixed of model.controls.filter(c=>!c.editable))if(fixed.source!==undefined)assert.ok(!sources.includes(fixed.source),model.name);
    }
  }
});
test('named layouts cover V3 extras, both Viper sides, and only real side panels',()=>{
  assert.deepEqual(Object.values(driverFor({productId:0x00e8}).top).sort((a,b)=>a-b),[1,2,3,9,10,11,12,14,52,53,57,106,128]);
  assert.deepEqual(sideSources(driverFor({productId:0x007b}),4),[5,4,7,6]);
  assert.deepEqual(sideSources(driverFor({productId:0x0067}),2),[5,4]);
  assert.throws(()=>sideSources(driverFor({productId:0x0096}),6),/side plate/);
  assert.deepEqual(driverFor({productId:0x0096}).top,{left:1,right:2,middle:3,'wheel-up':9,'wheel-down':10,'dpi-cycle':96});
  assert.equal(controlsFor(0x00b9).find(c=>c.source===6).editable,false);
  assert.equal(controlsFor(0x00cb).find(c=>c.source===106).editable,false);
  assert.equal(controlsFor(0x005b).some(c=>c.id==='dpi-cycle'),true);
  assert.equal(controlsFor(0x00d0).some(c=>c.id==='smart-action'),false,'AI is a wheel long press, not another physical button');
});
test('missing or fixed controls cannot satisfy primary-click protection or compile to source zero',()=>{
  const p=newProfile('Naga X',0x0096,12);p.topBindings.left={type:'disabled'};p.topBindings['tilt-left']={type:'mouse',value:'left'};
  assert.throws(()=>validateProfile(p),/Left click/);
  p.topBindings.left={type:'default'};assert.throws(()=>actionsFor(p),/absent or fixed/);
  const basilisk=newProfile('Basilisk',0x00cb,2);basilisk.topBindings['wheel-mode']={type:'key',value:'Q'};
  assert.throws(()=>actionsFor(basilisk),/fixed/);
});
test('best-guess preflight fails before any writes and remains reportable',async t=>{
  const f=fixture(t,0x0096),p=newProfile('Guess',0x0096,12);f.reject(65);
  await assert.rejects(f.hardware.apply(f.device.id,p),/Unsupported source/);
  assert.equal(f.calls.some(r=>r[7]===12),false);
  assert.equal(fs.existsSync(f.hardware.backupFile(f.device)),false);
  const reports=collectReports([{vendorId:0x1532,productId:0x0096,interface:0,usagePage:1,usage:2}],{appVersion:'test',platform:'win32'});
  assert.equal(reports.length,1);
  assert.equal(supportedConfirmation({version:1,vendorId:0x1532,productId:0x0096,modelName:'Razer Naga X'}),null);
});
test('80-byte DeathAdder requests preserve raw originals and Original restores side assignments',async t=>{
  const f=fixture(t,0x00bf),p=newProfile('DeathAdder',0x00bf,2);
  assert.ok(p.bindings.every(b=>b.type==='default'));
  p.bindings[0]={type:'key',value:'Ctrl+Q'};p.topBindings['dpi-cycle']={type:'key',value:'E'};
  await f.hardware.apply(f.device.id,p);
  assert.deepEqual(f.memory.get('0:5'),[2,2,1,20,0,0,0]);
  p.bindings[0]={type:'default'};p.topBindings['dpi-cycle']={type:'default'};
  await f.hardware.apply(f.device.id,p);
  for(const bytes of f.memory.values())assert.deepEqual(bytes,f.original);
  const saved=new Store(f.dir).save(p);assert.equal(new Store(f.dir).profiles.find(p=>p.id===saved.id).bindings[0].type,'default');
});
test('inspection includes V2 top buttons without guessing unreadable assignments',async t=>{
  const f=fixture(t,0x00a8);f.reject(52);
  const result=await f.hardware.inspect(f.device.id,12);
  assert.equal(result.controls.length,22);assert.equal(result.bindings.length,12);
  assert.equal(result.controls.find(c=>c.source===52).status,'unavailable');
  assert.equal(result.controls.find(c=>c.source===109).status,'readable');
  assert.equal(result.controls.find(c=>c.source===96).status,'readable');
  assert.equal(f.calls.some(r=>r[7]===12),false);
});
test('an unchanged non-Naga profile is a no-op and can be restored on exit',async t=>{
  const f=fixture(t,0x006e);await f.hardware.apply(f.device.id,newProfile('No changes',0x006e,2));
  await f.hardware.restore(f.device.id);assert.equal(f.calls.length,0);
});

test('compact Basilisk replies preserve keyboard modifiers and key without shifting the block',()=>{
  const raw=[2,2,1,20,0,0,0],driver=driverFor({productId:0x00b9});
  const compact=Buffer.from([0,5,...raw,0]);
  const extended=Buffer.from([0,5,0,...raw]);
  for(const reply of [compact,extended])assert.deepEqual(bindingFromReply(reply,0,5,true,driver.readLayout),{type:2,params:[1,20],raw});
});

test('wireless models without battery transport support show unavailable instead of wired',async()=>{
  const device={productId:0x007b,id:'viper'};
  assert.equal(hasBattery(device),true);
  assert.equal(hasBattery({productId:0x006e}),false);
  const monitor=new BatteryMonitor({readBattery:async()=>{throw new Error('Unsupported');}});
  await monitor.refresh([device]);assert.equal(monitor.status(device),'Battery unavailable');
});
