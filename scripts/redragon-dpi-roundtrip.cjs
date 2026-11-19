// Temporary 50-DPI X-axis change, durable recovery record, and exact restoration.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const hid=require('node-hid'),r=require('../app/redragon.cjs'),d=require('../app/redragon-dpi.cjs');
const {discoverReceivers}=require('../app/receivers.cjs');
(async()=>{
  const devices=discoverReceivers(await hid.devicesAsync()).filter(device=>device.vendorId===0x3554);
  if(devices.length!==1)throw Error('Connect exactly one M990-WL for the DPI roundtrip.');
  const session=await r.open(devices[0]);
  const file=path.join(__dirname,'../artifacts/redragon-dpi/roundtrip.json');
  try {
    const original=await d.snapshot(session),settings=await session.read(0,0x60),mappings=await session.snapshot();
    const target={x:original.x+(original.x<26000?50:-50),y:original.y};
    const evidence={time:new Date().toISOString(),cid:23,mid:48,original,target,settings,mappings};
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(evidence,null,2));
    await d.assertContext(session,original);
    try {
      await d.transfer(session,{config:original.config,stages:{[original.stage]:d.encode(target)}});
      const actual=await d.snapshot(session);
      assert.equal(actual.stage,original.stage);assert.equal(actual.x,target.x);assert.equal(actual.y,target.y);
      const changed=await session.read(0,0x60),expected=[...settings];
      expected.splice(d.address(original.stage),4,...d.encode(target));
      assert.deepEqual(changed,expected);assert.deepEqual(await session.snapshot(),mappings);
      evidence.writeVerified=true;
    } finally {
      try {
        await d.transfer(session,{config:original.config,stages:{[original.stage]:original.record}});
        assert.deepEqual(await d.snapshot(session),original);
        assert.deepEqual(await session.read(0,0x60),settings);
        assert.deepEqual(await session.snapshot(),mappings);
        evidence.restored=true;
      } finally {fs.writeFileSync(file,JSON.stringify(evidence,null,2));}
    }
    console.log(JSON.stringify({writeVerified:evidence.writeVerified,restored:evidence.restored,originalDpi:{x:original.x,y:original.y},temporaryDpi:target}));
  } finally {await session.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
