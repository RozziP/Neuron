const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),hid=require('node-hid');
const {Hardware}=require('../app/hardware.cjs'),r=require('../app/redragon.cjs'),d=require('../app/redragon-dpi.cjs');
const {dpiCapabilities}=require('../app/dpi.cjs'),{newProfile}=require('../app/store.cjs');
function fixture(t,pid=0xf55d) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'neuron-redragon-dpi-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  t.mock.method(hid,'devicesAsync',async()=>[
    {vendorId:0x3554,productId:pid,path:'mouse',interface:2,usagePage:1,usage:2},
    {vendorId:0x3554,productId:pid,path:'control',interface:1,usagePage:0xff02,usage:2}]);
  const h=new Hardware(null,dir),memory=Array(0x300).fill(0),writes=[];
  let config=1,identity=true,fail=null,closes=0,disconnected=false;
  memory.splice(4,2,0,85);
  for(let stage=0;stage<8;stage++) memory.splice(d.address(stage),4,...d.encode({x:800+stage*400,y:1200+stage*400}));
  for(let i=0;i<16;i++) {memory.splice(0x60+i*4,4,5,0,0,80);memory.splice(0x100+i*32,32,...r.shortcut(1,30+i));}
  const original=[...memory],s=new r.Session({close:async()=>{closes++;}});
  s.exchange=async(command,address=0,data=[])=>{
    r.packet(command,address,data);
    if(disconnected)throw Error('Disconnected');
    if(command===14)return [config];
    if(command===15){config=data[0];if(fail==='reload'){fail=null;memory[d.address(0)]^=1;}return [];}
    if(command===8)return memory.slice(address,address+data.length);
    if(command===7) {
      const device={id:`13652:${pid}:mouse`,productId:pid};
      assert.ok(fs.existsSync(h.backupFile(device)),'durable backup before writes');
      writes.push({address,data:[...data]});
      if(fail==='disconnect') {disconnected=true;throw Error('Disconnected');}
      if(fail==='ignore'){fail=null;return [];}
      memory.splice(address,data.length,...data);
      if(fail==='ack'){fail=null;throw Error('Lost acknowledgement');}
      return [];
    }
    throw Error('Unexpected command '+command);
  };
  h.openRedragon=async()=>{if(!identity)throw Error('Wrong model');return s;};
  return {h,s,memory,original,writes,dir,fail:v=>{fail=v;},identity:v=>{identity=v;},config:v=>{config=v;},stage:v=>{memory.splice(4,2,v,(85-v)&255);},get closes(){return closes;}};
}
test('PAW3395 records encode independent axes and reject noncanonical bytes',()=>{
  assert.deepEqual(d.encode({x:2650,y:2650}),[52,52,0,237]); // local captured record
  assert.deepEqual(d.encode({x:26000,y:50}),[7,0,8,70]);
  assert.deepEqual(d.encode({x:50,y:26000}),[0,7,128,206]);
  for(const x of [50,800,12800,12850,25600,26000]) for(const y of [50,1800,12850,26000]) assert.deepEqual(d.decode(d.encode({x,y})),{x,y});
  for(const value of [0,49,51,801,26050,800.5,'800']) assert.throws(()=>d.encode({x:value,y:800}),/DPI/);
  for(const bytes of [[52,52,0,236],[0,0,17,68],[255,255,204,139],[],[0,0,0]]) assert.throws(()=>d.decode(bytes),/DPI/);
  for(const address of [0,2,4,8,0x0d,0x2c,0x5f]) assert.throws(()=>r.packet(7,address,[0,0,0,85]),/outside/);
  assert.throws(()=>r.packet(7,0x0c,[1]),/outside/);
  assert.throws(()=>r.packet(7,0x0c,[0,0,0,0]),/DPI/);
  assert.doesNotThrow(()=>r.packet(7,0x28,d.encode({x:50,y:26000})));
});
test('DPI capabilities require verified model identity and exact transports',()=>{
  const device={vendorId:0x3554,productId:0xf55d,modelId:r.MODEL,modelVerified:true};
  assert.deepEqual(dpiCapabilities(device),{min:50,max:26000,step:50,activeStage:true});
  for(const change of [{modelVerified:false},{modelId:null},{productId:123},{vendorId:123}])assert.equal(dpiCapabilities({...device,...change}),null);
});
for(const pid of [0xf55d,0xf55e])test(`Redragon ${pid.toString(16)} DPI backs up stages, preserves mappings and restores originals`,async t=>{
  const f=fixture(t,pid),[device]=await f.h.devices();
  const before=await f.h.inspectDpi(device.id);
  assert.deepEqual(before,{config:1,stage:0,x:800,y:1200});
  const apply=async(x,y)=>f.h.applyDpi(device.id,{...await f.h.inspectDpi(device.id),x,y});
  await apply(50,26000);const writes=f.writes.length;await apply(50,26000);assert.equal(f.writes.length,writes);
  assert.deepEqual(await f.h.inspectDpi(device.id),{config:1,stage:0,x:50,y:26000});
  assert.deepEqual(f.memory.slice(0x2c),f.original.slice(0x2c));
  f.stage(7);await apply(26000,50);
  const backup=JSON.parse(fs.readFileSync(f.h.backupFile(device)));
  assert.deepEqual(backup.dpi.stages,{'0':f.original.slice(12,16),'7':f.original.slice(40,44)});
  const dpiBytes=f.memory.slice(0,0x2c);
  await f.h.apply(device.id,newProfile('Buttons',r.MODEL,16));await f.h.restore(device.id);
  assert.deepEqual(f.memory.slice(0,0x2c),dpiBytes,'profile apply and automatic restoration preserve DPI');
  await f.h.restore(device.id,{restoreDpi:true});
  assert.deepEqual(f.memory.slice(0x0c),f.original.slice(0x0c));
  assert.equal(f.memory[4],7,'restore does not change the selected stage');
  assert.ok(f.closes>0);
});
test('DPI accepts lost ACK only with readback and rolls back ignored writes or reload corruption',async t=>{
  const f=fixture(t),[device]=await f.h.devices(),input={...await f.h.inspectDpi(device.id),x:1600,y:1600};
  f.fail('ack');await f.h.applyDpi(device.id,input);
  for(const failure of ['ignore','reload']) {
    f.fail(failure);await assert.rejects(f.h.applyDpi(device.id,{...input,x:3200}),/Previous DPI restored/);
    assert.equal((await f.h.inspectDpi(device.id)).x,1600);
  }
  f.fail('disconnect');await assert.rejects(f.h.applyDpi(device.id,{...input,x:3200}),/Previous DPI could not be restored/);
});
test('Redragon rejects stale stage/profile context, wrong identity, malformed reads and backups before writing',async t=>{
  const f=fixture(t),[device]=await f.h.devices(),input={...await f.h.inspectDpi(device.id),x:1600,y:1600};
  f.stage(1);await assert.rejects(f.h.applyDpi(device.id,input),/Read DPI again/);f.stage(0);
  f.config(0);await assert.rejects(f.h.applyDpi(device.id,input),/Read DPI again/);f.config(1);
  await assert.rejects(f.h.applyDpi(device.id,{x:800,y:800}),/Read DPI again/);
  await assert.rejects(f.h.applyDpi(device.id,{...input,x:801}),/increments/);
  f.identity(false);await assert.rejects(f.h.applyDpi(device.id,input),/Wrong model/);f.identity(true);
  f.memory[5]=0;await assert.rejects(f.h.inspectDpi(device.id),/context/);f.memory[5]=85;
  f.memory[15]^=1;await assert.rejects(f.h.inspectDpi(device.id),/record/);f.memory[15]^=1;
  assert.equal(f.writes.length,0);
  await f.h.applyDpi(device.id,input);
  const file=f.h.backupFile(device),backup=JSON.parse(fs.readFileSync(file));backup.dpi.stages['-1']=backup.dpi.stages[0];
  fs.writeFileSync(file,JSON.stringify(backup));const count=f.writes.length;
  await assert.rejects(f.h.applyDpi(device.id,input),/Invalid Redragon DPI backup/);
  await assert.rejects(f.h.restore(device.id,{restoreDpi:true}),/Invalid Redragon DPI backup/);
  assert.equal(f.writes.length,count);
});
test('existing mapping backups survive DPI changes and multi-stage restore rolls back on failure',async t=>{
  const f=fixture(t),[device]=await f.h.devices();
  await f.h.apply(device.id,newProfile('Buttons',r.MODEL,16));
  const file=f.h.backupFile(device),original=JSON.parse(fs.readFileSync(file)).original;
  await f.h.applyDpi(device.id,{...await f.h.inspectDpi(device.id),x:50,y:26000});
  assert.deepEqual(JSON.parse(fs.readFileSync(file)).original,original);
  f.stage(1);await f.h.applyDpi(device.id,{...await f.h.inspectDpi(device.id),x:26000,y:50});
  // Fail the second stage restoration, after the first stage has been restored.
  const write=f.s.write.bind(f.s);let fail=true;
  f.s.write=async(address,bytes)=>{if(fail && address===16){fail=false;throw Error('Second stage failed');}return write(address,bytes);};
  const before=[...f.memory];await assert.rejects(f.h.restore(device.id,{restoreDpi:true}),/Previous mappings restored/);
  assert.deepEqual(f.memory,before);
  f.config(0);await assert.rejects(f.h.restore(device.id,{restoreDpi:true}),/original onboard profile/);
});
test('Restore original can recover a corrupted DPI stage from its valid backup',async t=>{
  const f=fixture(t),[device]=await f.h.devices();
  await f.h.applyDpi(device.id,{...await f.h.inspectDpi(device.id),x:50,y:26000});
  f.memory[15]^=1;
  await f.h.restore(device.id,{restoreDpi:true});
  assert.deepEqual(f.memory,f.original);
});
