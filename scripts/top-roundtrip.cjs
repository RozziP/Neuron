// Explicit hardware check: temporary modifier mappings, then exact original restoration.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Bridge } = require('../app/bridge.cjs');
const { Hardware } = require('../app/hardware.cjs');
const { parseChord } = require('../app/keys.cjs');
(async () => {
  const bridge = new Bridge(), directory = path.join(__dirname,'../artifacts');
  fs.mkdirSync(directory,{recursive:true});
  const file = path.join(directory,'top-roundtrip.json');
  try {
    const hardware = new Hardware(bridge,directory), found = (await hardware.devices()).find(d=>d.productId===0x0067);
    if (!found) throw new Error('No Trinity connected.');
    const device = await hardware.target(found.id), originals = [];
    for (const slot of [2,1]) originals.push({slot,source:0x0b,action:await hardware.read(device,slot,0x0b)});
    const evidence={time:new Date().toISOString(),originals,verified:[],restored:false};
    fs.writeFileSync(file,JSON.stringify(evidence,null,2));
    try {
      for (const chord of ['Ctrl+Q']) {
        const key=parseChord(chord), action={type:2,params:[key.modifiers,key.hid]};
        for (const slot of [2,1]) await hardware.write(device,{slot,source:0x0b,action});
        assert.deepEqual(await hardware.read(device,1,0x0b),action);
        evidence.verified.push(chord);
      }
    } finally {
      for (const original of originals) await hardware.write(device,original);
      for (const original of originals) assert.deepEqual(await hardware.read(device,original.slot,original.source),original.action);
      evidence.restored=true; fs.writeFileSync(file,JSON.stringify(evidence,null,2));
    }
    console.log('DPI-up control rebind accepted and read back; both original slots restored.');
  } finally {bridge.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
