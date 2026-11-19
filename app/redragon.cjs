// M990-WL, CID 23 / MID 48. See docs/hardware.md for captures and sources.
const hid = require('node-hid');
const dpi = require('./redragon-dpi.cjs');
const MODEL = 0xf55d;
const DRIVER = {id:'redragon-m990-wl-experimental', plates:[16], validation:'hardware-readback', top:{}};
const sum = bytes => bytes.reduce((a,b) => a+b,0) & 255;
function packet(command, address=0, data=[]) {
  if (![3,4,7,8,14,15,16].includes(command) || !Number.isInteger(address) || address<0 || address>65535 ||
      !Array.isArray(data) || data.length>10 || data.some(b=>!Number.isInteger(b)||b<0||b>255)) throw new Error('Invalid Redragon command.');
  if (command===7) {
    const stage=address>=0x0c && address<0x2c && (address-0x0c)%4===0 && data.length===4;
    if(stage) dpi.decode(data);
    else if(!((address>=0x60 && address+data.length<=0xa0) || (address>=0x100 && address+data.length<=0x300))) throw new Error('Redragon write outside the mapping or DPI stage area.');
  }
  if (command===15 && (address!==0 || data.length!==1 || ![0,1].includes(data[0]))) throw new Error('Invalid Redragon profile reload.');
  const p=Buffer.alloc(17); p[0]=8; p[1]=command; p.writeUInt16BE(address,3); p[5]=data.length; p.set(data,6); p[16]=(85-sum(p))&255; return p;
}
function decode(reply, request) {
  const r=Buffer.from(reply);
  if (r.length!==17 || r[0]!==8 || sum(r)!==85 || r[1]!==request[1] || r[3]!==request[3] || r[4]!==request[4] || r[5]>10) throw new Error('Invalid Redragon response.');
  if (r[2]!==0) throw new Error('Redragon rejected the command.');
  if (request[1]===8 && r[5]!==request[5]) throw new Error('Incomplete Redragon settings response.');
  return [...r.subarray(6,6+r[5])];
}
class Session {
  constructor(handle) { this.handle=handle; }
  async exchange(command,address=0,data=[]) {
    const request=packet(command,address,data);
    // Discard notifications and stale replies before each request.
    for(let i=0;i<32;i++) if (!(await this.handle.read(1)).length) break;
    for(let attempt=0;attempt<(command===7||command===15?1:3);attempt++) {
      await this.handle.write(request);
      const deadline=Date.now()+700;
      while(Date.now()<deadline) {
        const r=await this.handle.read(Math.min(150,deadline-Date.now()));
        if(r.length!==17 || r[0]!==8 || r[1]!==command || r[3]!==request[3] || r[4]!==request[4]) continue;
        return decode(r,request);
      }
    }
    throw new Error('Redragon did not respond. Wake the mouse and close its configuration software.');
  }
  async identify() {
    const data=await this.exchange(16);
    if(data.length<2 || data[0]!==23 || data[1]!==48) throw new Error('This receiver is not paired with a supported Redragon M990-WL.');
    return {cid:data[0],mid:data[1]};
  }
  async read(address,length) {
    const data=[];
    while(data.length<length) data.push(...await this.exchange(8,address+data.length,Array(Math.min(10,length-data.length)).fill(0)));
    return data;
  }
  async write(address,data) {
    for(let off=0;off<data.length;off+=10) {
      const part=data.slice(off,off+10), addr=address+off;
      // An ACK can be lost after a successful write: readback decides success.
      let failure;
      try { await this.exchange(7,addr,part); } catch(error) { failure=error; }
      const actual=await this.read(addr,part.length);
      if (!equal(actual,part)) throw new Error(failure?.message || 'Redragon mapping readback failed.');
    }
  }
  async snapshot() {
    const config=await this.exchange(14);
    if(config.length!==1 || ![0,1].includes(config[0])) throw new Error('Unknown Redragon onboard profile.');
    const keys=await this.read(0x60,64), shortcuts=await this.read(0x100,512);
    for(let i=0;i<64;i+=4) if(sum(keys.slice(i,i+4))!==85) throw new Error('Unrecognized Redragon button layout.');
    return {config:config[0], keys, shortcuts};
  }
  async reload(config) {
    await this.exchange(15,0,[config]);
    const actual=await this.exchange(14);
    if(actual.length!==1 || actual[0]!==config) throw new Error('Redragon profile reload failed.');
  }
  async battery() {
    const data=await this.exchange(4);
    if(data.length<2 || data[0]>100 || ![0,1].includes(data[1])) throw new Error('Invalid Redragon battery response.');
    return {level:data[0],charging:!!data[1]};
  }
  async close() { await this.handle.close(); }
}
const equal=(a,b)=>a.length===b.length && a.every((v,i)=>v===b[i]);
function validSnapshot(s) { return s && [0,1].includes(s.config) && [['keys',64],['shortcuts',512]].every(([key,len])=>Array.isArray(s[key])&&s[key].length===len&&s[key].every(v=>Number.isInteger(v)&&v>=0&&v<=255)); }
async function open(device) {
  const control=device.paths.find(p=>p.interface===1 && p.usagePage===0xff02 && p.usage===2);
  if(device.vendorId!==0x3554 || ![0xf55d,0xf55e].includes(device.productId) || !control) throw new Error('Redragon configuration interface unavailable.');
  const session=new Session(await hid.HIDAsync.open(control.path));
  try { await session.identify(); return session; } catch(error) { await session.close(); throw error; }
}
function record(a,b=0,c=0) { return [a,b,c,(85-a-b-c)&255]; }
function shortcut(modifiers,key) {
  // A modifier mask plus one key fits the vendor's three-key shortcut format.
  const down=[...(modifiers?[[0x80,modifiers,0]]:[]),...(key?[[0x81,key,0]]:[])];
  const contexts=[...down,...down.slice().reverse().map(([head,a,b])=>[head-0x40,a,b])];
  const bytes=[contexts.length,...contexts.flat()];bytes.push((85-sum(bytes))&255);
  return [...bytes,...Array(32-bytes.length).fill(0)];
}
function desired(profile,before) {
  const {parseChord}=require('./keys.cjs'), {macroTriggers}=require('./controls.cjs');
  if(profile.model!==MODEL || profile.plate!==16) throw new Error('Choose the 16-button Redragon M990-WL profile.');
  if(Object.values(profile.topBindings).some(b=>b.type!=='default')) throw new Error('Top-button remapping is not verified for the M990-WL. Leave top controls on Original.');
  const next=structuredClone(before), triggers=macroTriggers(profile);
  profile.bindings.forEach((binding,i)=>{
    let rec;
    if(binding.type==='disabled') rec=record(0);
    else if(binding.type==='mouse') {
      const mask={left:1,right:2,middle:4,back:8,forward:16}[binding.value];
      if(!mask) throw new Error('This mouse action is not supported by the Redragon driver.');
      rec=record(1,mask);
    } else {
      const key=binding.type==='macro'?{modifiers:0,hid:triggers.find(t=>t.id===binding.value).hid}:parseChord(binding.value);
      next.shortcuts.splice(i*32,32,...shortcut(key.modifiers,key.hid));
      rec=record(5); // Each physical button owns the shortcut slot at the same index.
    }
    next.keys.splice(i*4,4,...rec);
  });
  return next;
}
async function transfer(session,from,to) {
  // Write shortcut contexts before activating their button assignments.
  for(const [key,base,size] of [['shortcuts',0x100,32],['keys',0x60,4]])
    for(let i=0;i<to[key].length;i+=size) if(!equal(from[key].slice(i,i+size),to[key].slice(i,i+size))) await session.write(base+i,to[key].slice(i,i+size));
  await session.reload(to.config);
  const verified=await session.snapshot();
  if(verified.config!==to.config || !equal(verified.keys,to.keys) || !equal(verified.shortcuts,to.shortcuts)) throw new Error('Redragon settings changed after reloading the profile.');
}
module.exports={MODEL,DRIVER,Session,packet,decode,open,desired,transfer,validSnapshot,equal,shortcut};
