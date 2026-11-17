const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, newProfile, validateProfile } = require('../app/store.cjs');
const { Hardware } = require('../app/hardware.cjs');
const { dpiCapabilities, dpiPacket, dpiFromReply } = require('../app/dpi.cjs');
const hid = require('node-hid');
const { checksum } = require('../app/protocol.cjs');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuron-dpi-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const h = new Hardware(null, dir), device = { id: 'dpi-trinity', productId:0x0067, path: 'fixture' };
  let dpi = { x: 1800, y: 2000 };
  const writes = [], bindings = new Map();
  h.target = async () => device;
  h.read = async (_d, slot, source) => bindings.get(`${slot}:${source}`) || { type: 2, params: [0, 30] };
  h.write = async (_d, entry) => bindings.set(`${entry.slot}:${entry.source}`, entry.action);
  h.exchange = async (_p, request) => {
    if (request[7] === 5) { dpi = { x: request.readUInt16BE(9), y: request.readUInt16BE(11) }; writes.push(dpi); }
    return Buffer.from([0, dpi.x >> 8, dpi.x & 255, dpi.y >> 8, dpi.y & 255, 0, 0]);
  };
  return { h, device, dir, writes, bindings, current: () => dpi };
}
test('legacy profile DPI is ignored and no longer saved or exported', t => {
  const { dir } = fixture(t), p = { ...newProfile(), dpi: { x: 800, y: 800 } };
  assert.equal(validateProfile(p).dpi, undefined);
  const store = new Store(dir); store.save(p);
  assert.equal(new Store(dir).profiles.find(x => x.id === p.id).dpi, undefined);
  assert.equal(validateProfile({ ...p, dpi: 'legacy' }).dpi, undefined);
});

test('DPI report uses big-endian axes and rejects invalid replies', () => {
  const request = dpiPacket({ x: 800, y: 16000 });
  assert.deepEqual([...request.subarray(5, 15)], [7, 4, 5, 0, 3, 32, 62, 128, 0, 0]);
  assert.equal(dpiPacket()[7], 0x85);
  assert.deepEqual(dpiFromReply(Buffer.from([0, 3, 32, 62, 128, 0, 0])), { x: 800, y: 16000 });
  assert.throws(() => dpiFromReply(Buffer.from([0, 3, 32])));
  assert.throws(() => dpiFromReply(Buffer.from([1, 3, 32, 3, 32, 0, 0])));
});
test('mouse DPI is backed up, verified, and unchanged by profile switching or automatic restore', async t => {
  const { h, device, current, writes } = fixture(t), p = newProfile();
  const exchange = h.exchange;
  h.exchange = async (path, report) => {
    if (report[7] === 5) assert.deepEqual(JSON.parse(fs.readFileSync(h.backupFile(device))).dpi, { x: 1800, y: 2000 });
    return exchange(path, report);
  };
  await h.applyDpi(device.id, { x: 800, y: 800 });
  await h.applyDpi(device.id, { x: 800, y: 800 });
  assert.equal(writes.length, 1);
  await h.apply(device.id, { ...p, dpi: { x: 3200, y: 3200 } });
  await h.apply(device.id, newProfile('Other'));
  await h.restore(device.id);
  assert.deepEqual(current(), { x: 800, y: 800 });
  assert.equal(writes.length, 1);
  await h.restore(device.id, { restoreDpi: true });
  assert.deepEqual(current(), { x: 1800, y: 2000 });
});

test('standalone DPI works without applying bindings and explicit restore accepts a DPI-only backup', async t => {
  const { h, device, current, bindings } = fixture(t);
  for (const value of [{ x: 0, y: 800 }, { x: 800, y: 16001 }, { x: 800.5, y: 800 }, { x: '800', y: 800 }, [], false])
    await assert.rejects(h.applyDpi(device.id, value), /DPI/);
  await h.applyDpi(device.id, { x: 100, y: 16000 });
  assert.equal(bindings.size, 0);
  await h.restore(device.id, { restoreDpi: true });
  assert.deepEqual(current(), { x: 1800, y: 2000 });
});

test('DPI failure rolls back sensitivity without touching button mappings', async t => {
  const { h, device, current, bindings } = fixture(t);
  const exchange = h.exchange;
  h.exchange = async (path, report) => {
    const result = await exchange(path, report);
    if (report[7] === 5 && report.readUInt16BE(9) === 800) throw new Error('Simulated DPI write failure');
    return result;
  };
  await assert.rejects(h.applyDpi(device.id, { x: 800, y: 800 }), /Previous DPI restored/);
  assert.deepEqual(current(), { x: 1800, y: 2000 });
  assert.equal(bindings.size, 0);
});

test('DPI writes require matching readback and surface restoration failures', async t => {
  const { h, device } = fixture(t);
  h.readDpi = async () => ({ x: 1800, y: 2000 });
  await assert.rejects(h.writeDpi(device, { x: 800, y: 800 }), /readback/);
  h.writeDpi = async () => { throw new Error('Disconnected'); };
  await assert.rejects(h.applyDpi(device.id, { x: 800, y: 800 }), /Previous DPI could not be restored/);
});

function proFixture(t, pid, model=0x00a8, max=30000, writeStorage=0) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'neuron-pro-dpi-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  t.mock.method(hid,'devicesAsync',async()=>[{vendorId:0x1532,productId:pid,serialNumber:'v2',path:'v2-control',interface:0,usagePage:1,usage:2}]);
  const original={x:max-6000,y:max};
  let dpi={...original},failure=null,paired=model;
  const requests=[],writes=[];
  const h=new Hardware({call:async(_,{path:target,report})=>{
    assert.equal(target,'v2-control');
    const req=Buffer.from(report,'base64');requests.push(req);
    const reply=Buffer.from(req);reply[0]=2;
    if(req[6]===0 && req[7]===0xbf)reply.set([1,1,paired>>8,paired&255],8);
    else {
      assert.equal(req[1],0x1f);assert.equal(req[6],4);assert.equal(req[5],7);assert.equal(req[8],req[7]===5?writeStorage:0);
      assert.ok([5,0x85].includes(req[7]),'No DPI stage or button writes');
      if(req[7]===5) {
        const backupFile=h.backupFile({productId:pid,modelId:paired,id:pid===0x00a4?'5426:164:v2-control':`${pid}:v2`});
        assert.deepEqual(JSON.parse(fs.readFileSync(backupFile)).dpi,original);
        const next={x:req.readUInt16BE(9),y:req.readUInt16BE(11)};writes.push(next);
        if(failure!=='ignore' || next.x!==800)dpi=next;
        if(failure==='ack' && next.x===800)throw new Error('Lost acknowledgement');
      }
      reply.set([0,dpi.x>>8,dpi.x&255,dpi.y>>8,dpi.y&255,0,0],8);
      if(failure==='short' && req[7]===0x85)reply[5]=0;
      if(failure==='echo' && req[7]===0x85)reply[8]=1;
    }
    reply[88]=checksum(reply);return {report:reply.toString('base64')};
  }},dir);
  return {h,requests,writes,current:()=>dpi,fail:mode=>{failure=mode;},pair:model=>{paired=model;h.dockModels.clear();}};
}

const dpiCases=[['V2',0x00a8,30000,0,[0x00a7,0x00a8,0x00a4]],['V3',0x00e8,50000,0,[0x00e7,0x00e8,0x00a4]],
  ['Pro',0x0090,20000,1,[0x008f,0x0090]],['X',0x0096,18000,1,[0x0096]],
  ['Left-Handed 2020',0x008d,20000,1,[0x008d]],['V2 HyperSpeed',0x00b4,30000,1,[0x00b4]]];
for(const [version,model,max,writeStorage,transports] of dpiCases) for(const pid of transports) {
  test(`Naga ${version} DPI reads actual XY, verifies changes and restores ${max} DPI originals via ${pid.toString(16)}`,async t=>{
    const f=proFixture(t,pid,model,max,writeStorage),[device]=await f.h.devices();
    if(pid===0x00a4) {
      await f.h.selectModel(device.id,model);
      assert.equal((await f.h.devices())[0].modelSource,'manual');
    }
    assert.deepEqual(device.dpi,{min:100,max});
    assert.deepEqual(await f.h.inspectDpi(device.id),{x:max-6000,y:max});
    await f.h.applyDpi(device.id,{x:max-10000,y:max});
    await f.h.applyDpi(device.id,{x:max-10000,y:max});assert.equal(f.writes.length,1);
    await assert.rejects(f.h.applyDpi(device.id,{x:max+1,y:800}),/DPI/);assert.equal(f.writes.length,1);
    await f.h.restore(device.id);assert.deepEqual(f.current(),{x:max-10000,y:max});
    await f.h.restore(device.id,{restoreDpi:true});assert.deepEqual(f.current(),{x:max-6000,y:max});
    assert.equal(f.requests.some(r=>r[6]===2),false);
  });
  test(`Naga ${version} DPI rejects malformed reads and rolls back failed writes via ${pid.toString(16)}`,async t=>{
    const f=proFixture(t,pid,model,max,writeStorage),[device]=await f.h.devices();
    for(const mode of ['short','echo']) {
      f.fail(mode);await assert.rejects(f.h.inspectDpi(device.id),/DPI response/);
      await assert.rejects(f.h.applyDpi(device.id,{x:800,y:900}),/DPI response/);assert.equal(f.writes.length,0);
    }
    for(const mode of ['ignore','ack']) {
      f.fail(mode);await assert.rejects(f.h.applyDpi(device.id,{x:800,y:900}),/Previous DPI restored/);
      assert.deepEqual(f.current(),{x:max-6000,y:max});
    }
  });
}
test('DPI capabilities require a supported model and transport, not just a manually supplied model ID',()=>{
  for(const device of [{productId:0x00a4},{productId:0x00a4,modelId:0x0067},{productId:0x00a4,modelId:0x00e9},{productId:0x00a4,modelId:0x0090},{productId:0x00a4,modelId:0x00b4},{productId:0x0092},{productId:0x00a9},{productId:0x00e9},{vendorId:0x3554,productId:0x00a7},{productId:0xf55d,modelId:0x00a8}])assert.equal(dpiCapabilities(device),null);
});
test('dock loses DPI capability when its identified mouse changes',async t=>{
  const f=proFixture(t,0x00a4),[device]=await f.h.devices();
  await f.h.inspectDpi(device.id);f.pair(0x00ab);await f.h.devices();
  const before=f.requests.length;
  await assert.rejects(f.h.applyDpi(device.id,{x:800,y:800}),/unavailable/);
  assert.equal(f.requests.length,before);assert.equal(f.writes.length,0);
});
