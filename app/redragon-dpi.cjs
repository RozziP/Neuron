// M990-WL PAW3395 stage records. Protocol and local evidence: docs/hardware.md.
const {validateDpi}=require('./dpi.cjs');
const limits={min:50,max:26000,step:50};
const sum=bytes=>bytes.reduce((a,b)=>a+b,0)&255;
const equal=(a,b)=>a.length===b.length && a.every((v,i)=>v===b[i]);
function address(stage) {
  if(!Number.isInteger(stage) || stage<0 || stage>7) throw new Error('Invalid Redragon DPI stage.');
  return 0x0c+stage*4;
}
function encode(value) {
  const {x,y}=validateDpi(value,limits), a=x/50-1,b=y/50-1;
  const bytes=[a&255,b&255,((a>>8)<<2)|((b>>8)<<6)];
  return [...bytes,(85-sum(bytes))&255];
}
function decode(bytes) {
  if(!Array.isArray(bytes) || bytes.length!==4 || bytes.some(v=>!Number.isInteger(v)||v<0||v>255) || sum(bytes)!==85 || (bytes[2]&0x33))
    throw new Error('Unrecognized Redragon DPI record.');
  return validateDpi({x:(((bytes[2]>>2&3)<<8|bytes[0])+1)*50,y:(((bytes[2]>>6&3)<<8|bytes[1])+1)*50},limits);
}
async function context(session) {
  const config=await session.exchange(14), stage=await session.read(4,2);
  if(config.length!==1 || ![0,1].includes(config[0]) || stage.length!==2 || sum(stage)!==85) throw new Error('Invalid Redragon DPI context.');
  address(stage[0]);
  return {config:config[0],stage:stage[0]};
}
async function assertContext(session,expected,checkStage=true) {
  const actual=await context(session);
  if(actual.config!==expected.config || (checkStage && actual.stage!==expected.stage))
    throw new Error('Redragon onboard profile or DPI stage changed. Read DPI again.');
}
async function snapshot(session) {
  const current=await context(session), record=await session.read(address(current.stage),4);
  const value=decode(record);
  await assertContext(session,current);
  return {...current,record,...value};
}
function validBackup(dpi,config) {
  try {
    if(!dpi || ![0,1].includes(dpi.config) || dpi.config!==config || !dpi.stages || typeof dpi.stages!=='object' || Array.isArray(dpi.stages)) return false;
    const stages=Object.entries(dpi.stages);
    if(!stages.length || stages.length>8) return false;
    for(const [stage,record] of stages) {if(!/^[0-7]$/.test(stage))return false;decode(record);}
    return true;
  } catch {return false;}
}
async function readStages(session,dpi,validateRecords=true) {
  if(!validBackup(dpi,dpi?.config)) throw new Error('Invalid Redragon DPI backup.');
  await assertContext(session,dpi,false);
  const stages={};
  for(const stage of Object.keys(dpi.stages)) {stages[stage]=await session.read(address(Number(stage)),4);if(validateRecords)decode(stages[stage]);}
  await assertContext(session,dpi,false);
  return {config:dpi.config,stages};
}
async function transfer(session,dpi) {
  // Recovery must also replace partially written, invalid current records.
  const before=await readStages(session,dpi,false);
  for(const [stage,record] of Object.entries(dpi.stages)) if(!equal(before.stages[stage],record)) {
    await assertContext(session,dpi,false);
    await session.write(address(Number(stage)),record);
  }
  await assertContext(session,dpi,false);
  await session.reload(dpi.config);
  const actual=await readStages(session,dpi);
  for(const stage of Object.keys(dpi.stages)) if(!equal(actual.stages[stage],dpi.stages[stage])) throw new Error('Redragon DPI readback failed after reload.');
}
module.exports={address,encode,decode,snapshot,assertContext,validBackup,readStages,transfer};
