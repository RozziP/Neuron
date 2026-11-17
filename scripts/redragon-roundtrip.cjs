// Temporary side-button 1 -> F24, with a durable snapshot and finally restore.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const hid=require('node-hid');
const r=require('../app/redragon.cjs');
const {discoverReceivers}=require('../app/receivers.cjs');
const {Bridge}=require('../app/bridge.cjs');
(async()=>{
  let session,bridge;
  const file=path.join(__dirname,'../artifacts/redragon-roundtrip.json');
  try {
    const deadline=Date.now()+45000;
    while(!session && Date.now()<deadline) {
      const device=discoverReceivers(await hid.devicesAsync()).find(d=>d.vendorId===0x3554);
      if(device)try{session=await r.open(device);}catch{}
      if(!session)await new Promise(resolve=>setTimeout(resolve,500));
    }
    if(!session)throw Error('Wake the connected M990-WL and retry.');
    const original=await session.snapshot(),next=structuredClone(original);
    next.keys.splice(0,4,5,0,0,80);next.shortcuts.splice(0,32,...r.shortcut(0,0x73));
    const evidence={time:new Date().toISOString(),cid:23,mid:48,original};
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(evidence,null,2));
    try {
      await r.transfer(session,original,next);evidence.writeVerified=true;
      console.log('F24 mapping verified.');
      if(process.argv.includes('--listen')) {
        bridge=new Bridge();console.log('READY: hold Redragon side button 1 for two seconds.');
        const end=Date.now()+90000;let pressed=false;
        while(Date.now()<end){const {down}=await bridge.call('keyDown',{key:135});if(down)pressed=true;if(pressed&&!down){evidence.physicalPressAndRelease=true;break;}await new Promise(resolve=>setTimeout(resolve,15));}
      }
    } finally {
      await session.write(0x100,original.shortcuts.slice(0,32));await session.write(0x60,original.keys.slice(0,4));await session.reload(original.config);
      const after=await session.snapshot();assert.deepEqual(after,original);evidence.restored=true;
      fs.writeFileSync(file,JSON.stringify(evidence,null,2));
    }
    console.log(JSON.stringify({writeVerified:evidence.writeVerified,restored:evidence.restored,physicalPressAndRelease:evidence.physicalPressAndRelease||false}));
  } finally {if(session)await session.close();bridge?.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
