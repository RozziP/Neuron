const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const hid=require('node-hid');
const r=require('../app/redragon.cjs');
const {Hardware}=require('../app/hardware.cjs');
const {newProfile,validateProfile}=require('../app/store.cjs');
const {discoverReceivers}=require('../app/receivers.cjs');
const {driverFor}=require('../app/drivers.cjs');
const {BatteryMonitor}=require('../app/battery.cjs');
const {trayState}=require('../app/tray.cjs');
const {automaticTarget}=require('../app/games.cjs');
const records=[{vendorId:0x3554,productId:0xf55d,path:'mouse',interface:2,usagePage:1,usage:2},
  {vendorId:0x3554,productId:0xf55d,path:'control',interface:1,usagePage:0xff02,usage:2}];
function setup(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'neuron-redragon-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  t.mock.method(hid,'devicesAsync',async()=>records);
  const h=new Hardware(null,dir), memory={config:1,keys:Array.from({length:16},()=>[5,0,0,80]).flat(),shortcuts:Array.from({length:16},(_,i)=>r.shortcut(1,30+i)).flat()};
  const original=structuredClone(memory), writes=[];let fail=false,identity=true,opens=0;
  const session={identify:async()=>{},snapshot:async()=>structuredClone(memory),close:async()=>{},
    battery:async()=>({level:100,charging:false}),reload:async c=>{memory.config=c;},
    write:async(a,data)=>{
      const key=a>=0x100?'shortcuts':'keys',base=a>=0x100?0x100:0x60;
      writes.push(a);memory[key].splice(a-base,data.length,...data);
      assert.ok(fs.existsSync(h.backupFile({id:'13652:62813:mouse',productId:0xf55d})), 'backup must precede first write');
      if(fail){fail=false;throw Error('Lost partial write');}
    }};
  h.openRedragon=async()=>{opens++;if(!identity)throw Error('Wrong model');return session;};
  return {h,memory,original,writes,session,fail:()=>{fail=true;},identity:v=>{identity=v;},get opens(){return opens;}};
}
test('M990-WL wire framing matches captured identity and flash packets',()=>{
  assert.equal(r.packet(16).toString('hex'),'081000000000000000000000000000003d');
  assert.deepEqual(r.decode(Buffer.from('08100000000317300e00000000000000e5','hex'),r.packet(16)),[23,48,14]);
  assert.deepEqual(r.decode(Buffer.from('0808000060080500005005000050000033','hex'),r.packet(8,0x60,Array(8).fill(0))),[5,0,0,80,5,0,0,80]);
  const bad=Buffer.from('08100000000317300e00000000000000e4','hex');assert.throws(()=>r.decode(bad,r.packet(16)),/Invalid/);
  assert.throws(()=>r.decode(Buffer.from('081001000001010000000000000000003a','hex'),r.packet(16)),/rejected/);
  for(const address of [0,0x5f,0xa0,0x300])assert.throws(()=>r.packet(7,address,[1]),/outside/);
  assert.throws(()=>r.packet(15,0,[2]),/profile/);
});
test('shortcut encoding preserves captured Ctrl+1 and modifier-only behavior',()=>{
  assert.equal(Buffer.from(r.shortcut(1,30).slice(0,14)).toString('hex'),'04800100811e00411e0040010091');
  assert.deepEqual(r.shortcut(2,0).slice(0,8),[2,128,2,0,64,2,0,143]);
  assert.equal(validateProfile(newProfile('Redragon',r.MODEL,16)).bindings.length,16);
  assert.throws(()=>validateProfile(newProfile('Bad',103,16)),/Invalid device/);
  const p=validateProfile(newProfile('Redragon',r.MODEL,16));p.topBindings.left={type:'mouse',value:'left'};
  assert.throws(()=>r.desired(p,{}),/Top-button/);
});
test('shared Compx identities require verification and never cross multiple receivers',async t=>{
  const f=setup(t), [device]=await f.h.devices();
  assert.equal(device.modelId,r.MODEL);assert.equal(device.modelVerified,true);assert.equal(device.name,'Redragon M990-WL');
  assert.equal(driverFor({...device,modelVerified:false}),null);
  assert.equal(driverFor({...device,productId:0x1234}),null);
  assert.equal(discoverReceivers([...records,{...records[0],path:'other'}])[0].paths.length,1);
  const p=newProfile('Redragon',r.MODEL,16);p.executable='Game.exe';
  assert.equal(automaticTarget([p],[device],null,{executable:'Game.exe'},null).profile.id,p.id);
  f.h.models.select({...device,support:'recognition-only'},103);assert.equal((await f.h.devices())[0].driver,null);
});
test('Redragon apply and restore preserve every original shortcut byte',async t=>{
  const f=setup(t),[device]=await f.h.devices(),p=newProfile('Redragon',r.MODEL,16);
  p.bindings[0]={type:'key',value:'Ctrl+Alt+F2'};p.bindings[1]={type:'disabled',value:''};p.bindings[2]={type:'mouse',value:'back'};
  await f.h.apply(device.id,p);assert.ok(f.writes.length);assert.deepEqual(f.memory.keys.slice(4,8),[0,0,0,85]);
  assert.deepEqual(f.memory.keys.slice(8,12),[1,8,0,76]);
  await f.h.restore(device.id);assert.deepEqual(f.memory,f.original);
  const before=f.writes.length;await f.h.restore(device.id);assert.equal(f.writes.length,before);
  const backup=JSON.parse(fs.readFileSync(f.h.backupFile(device)));assert.deepEqual(backup.original,f.original);
  const monitor=new BatteryMonitor(f.h);await monitor.refresh([device]);assert.equal(trayState([device],monitor).level,100);
});
test('partial Redragon writes roll back and mismatched identities never write',async t=>{
  const f=setup(t),[device]=await f.h.devices(),p=newProfile('Redragon',r.MODEL,16);
  f.fail();await assert.rejects(f.h.apply(device.id,p),/Previous mappings restored/);assert.deepEqual(f.memory,f.original);
  const count=f.writes.length;f.identity(false);await assert.rejects(f.h.apply(device.id,p),/Wrong model/);assert.equal(f.writes.length,count);
  f.identity(true);f.memory.config=0;await assert.rejects(f.h.restore(device.id),/original onboard profile/);assert.equal(f.writes.length,count);
});
test('write acknowledgement loss is accepted only after exact readback',async()=>{
  const s=new r.Session({});s.exchange=async()=>{throw Error('ACK lost');};s.read=async()=>[1,2];
  await s.write(0x100,[1,2]);s.read=async()=>[1,3];await assert.rejects(s.write(0x100,[1,2]),/ACK lost/);
});
