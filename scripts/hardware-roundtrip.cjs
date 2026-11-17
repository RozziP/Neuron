// Temporarily changes side button 1 to F24, verifies the change, then restores
// both original slots in finally. A recovery snapshot is written before mutation.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Bridge } = require('../app/bridge.cjs');
const { Hardware } = require('../app/hardware.cjs');
(async () => {
  const bridge = new Bridge();
  try {
    const hardware = new Hardware(bridge,path.join(__dirname,'../artifacts'));
    const devices = await hardware.devices(), found = devices.find(d => d.productId === 0x0067);
    if (!found) throw new Error('Connect a Naga Trinity for this test.');
    const device = await hardware.target(found.id), original = await hardware.read(device,1,0x40);
    const pendingOriginal = await hardware.read(device,2,0x40);
    const evidence = {time:new Date().toISOString(),model:device.name,slot:1,source:0x40,original,pendingOriginal};
    fs.mkdirSync(path.join(__dirname,'../artifacts'),{recursive:true});
    fs.writeFileSync(path.join(__dirname,'../artifacts/hardware-roundtrip.json'),JSON.stringify(evidence,null,2));
    const temporary = {type:2,params:[0,0x73]};
    try {
      await hardware.write(device,{slot:2,source:0x40,action:temporary});
      await hardware.write(device,{slot:1,source:0x40,action:temporary});
      evidence.changed = await hardware.read(device,1,0x40); assert.deepEqual(evidence.changed,temporary);
    } finally {
      await hardware.write(device,{slot:2,source:0x40,action:pendingOriginal});
      await hardware.write(device,{slot:1,source:0x40,action:original});
      evidence.after = await hardware.read(device,1,0x40);
      evidence.pendingAfter = await hardware.read(device,2,0x40);
      assert.deepEqual(evidence.after,original); assert.deepEqual(evidence.pendingAfter,pendingOriginal);
      evidence.restored = true;
      fs.writeFileSync(path.join(__dirname,'../artifacts/hardware-roundtrip.json'),JSON.stringify(evidence,null,2));
    }
    evidence.ok = true;
    fs.writeFileSync(path.join(__dirname,'../artifacts/hardware-roundtrip.json'),JSON.stringify(evidence,null,2));
    console.log('Naga Trinity: temporary F24 mapping verified; both original slots restored and verified.');
  } finally { bridge.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
