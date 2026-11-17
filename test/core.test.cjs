const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { packet, decode, checksum, bindingFromReply } = require('../app/protocol.cjs');
const { parseChord } = require('../app/keys.cjs');
const { Store, newProfile, validateProfile } = require('../app/store.cjs');
const { Hardware, actionsFor } = require('../app/hardware.cjs');
const { MacroPlayer } = require('../app/macros.cjs');
function temp(t) { const directory = fs.mkdtempSync(path.join(os.tmpdir(),'neuron-test-')); t.after(() => fs.rmSync(directory,{recursive:true,force:true})); return directory; }
test('HID packets reject corrupt, stale, failed and mismatched responses', () => {
  const request = packet(0x8c,[1,0x40]);
  assert.equal(request.length,90); assert.equal(request[88],0xc5);
  const reply = Buffer.from(request); reply[0] = 2;
  assert.equal(decode(reply,request)[1],0x40);
  assert.throws(() => decode(request,request), /rejected/);
  for (const index of [1,6,7,8,88]) { const broken = Buffer.from(reply); broken[index] ^= 1; assert.throws(() => decode(broken,request)); }
  assert.throws(() => decode(reply.subarray(1),request));
  assert.throws(() => packet(1,new Array(81).fill(0)));
  assert.throws(() => bindingFromReply(Buffer.from([1,0x41,0,2,2,0,4]),1,0x40));
});
test('shortcuts map to both HID usages and Windows virtual keys', () => {
  assert.deepEqual(parseChord('Ctrl+Shift+A'),{hid:4,modifiers:3,virtualKeys:[17,16,65]});
  assert.deepEqual(parseChord('F24'),{hid:0x73,modifiers:0,virtualKeys:[135]});
  assert.equal(parseChord('Win+ArrowLeft').hid,80);
  assert.throws(() => parseChord('Ctrl+Ctrl+A'));
  assert.throws(() => parseChord('Hyper+A'));
  assert.throws(() => parseChord('Ctrl+'));
});
test('profile validation rejects invalid macros and unresolved references', () => {
  const p = newProfile();
  p.macros = [{id:'macro-1',name:'Test',repeat:2,steps:[{type:'key',value:'Ctrl+C'},{type:'delay',ms:100}]}];
  p.bindings[0] = {type:'macro',value:'macro-1'};
  assert.equal(validateProfile(p).macros.length,1);
  assert.equal(actionsFor(p)[0].action.params[1],0x68);
  const badRef = structuredClone(p); badRef.bindings[0].value = 'missing'; assert.throws(() => validateProfile(badRef));
  p.macros[0].steps[0].value = 'F13'; assert.throws(() => validateProfile(p),/reserved/);
  p.macros[0].steps = [{type:'delay',ms:10000}]; p.macros[0].repeat = 50; assert.equal(validateProfile(p).macros[0].repeat,50);
  p.model = 0x0096; assert.throws(() => actionsFor(p));
});
test('standalone modifiers and modifier-only chords compile to held HID modifiers', () => {
  assert.deepEqual(parseChord('Shift'),{hid:0,modifiers:2,virtualKeys:[16]});
  assert.deepEqual(parseChord('Control+Alt'),{hid:0,modifiers:5,virtualKeys:[17,18]});
  assert.deepEqual(parseChord('Ctrl+Shift'),{hid:0,modifiers:3,virtualKeys:[17,16]});
  assert.deepEqual(parseChord('Windows'),{hid:0,modifiers:8,virtualKeys:[91]});
  assert.throws(() => parseChord('Shift+Shift'),/Duplicate/);
  assert.throws(() => parseChord('Shift+'));
  const p = newProfile();
  p.bindings[0] = {type:'key',value:'Shift'};
  p.bindings[1] = {type:'key',value:'Ctrl+1'};
  assert.deepEqual(actionsFor(p)[0].action,{type:2,params:[2,0]});
  assert.deepEqual(actionsFor(p)[1].action,{type:2,params:[1,30]});
  assert.equal(validateProfile(p).bindings[0].value,'Shift');
});
test('profile save survives a fresh store and invalid data keeps a recovery copy', t => {
  const dir = temp(t), first = new Store(dir), profile = first.profiles[0];
  profile.name = 'World of Warcraft'; profile.executable = 'Wow.exe'; first.save(profile);
  const second = new Store(dir); assert.equal(second.profiles[0].name,'World of Warcraft');
  assert.throws(() => second.remove(profile.id),/at least one/);
  fs.writeFileSync(path.join(dir,'profiles.json'),'{broken');
  const recovered = new Store(dir); assert.match(recovered.warning,/recovery/);
  assert.equal(fs.readdirSync(dir).filter(f => f.includes('.recovery-')).length,1);
});
test('profiles cannot create ambiguous automatic switching rules', t => {
  const store = new Store(temp(t)), p = newProfile('Game'); p.executable = 'Wow.exe'; store.save(p);
  const duplicate = newProfile('Other game'); duplicate.executable = 'wow.EXE';
  assert.throws(() => store.save(duplicate),/already uses/);
  duplicate.model = 0x0096; assert.doesNotThrow(() => store.save(duplicate));
});
function fakeHardware(t) {
  const writes = [], device = {id:'fixture-trinity',productId:0x0067,path:'fixture'};
  const hardware = new Hardware(null,temp(t));
  const memory = new Map(); for (const slot of [1,2]) for (let i=0;i<12;i++) memory.set(`${slot}:${0x40+i}`,{type:2,params:[0,30+i]});
  hardware.target = async () => device;
  hardware.read = async (_device,slot,source) => structuredClone(memory.get(`${slot}:${source}`));
  hardware.exchange = async (_path, report) => {
    const key = `${report[8]}:${report[9]}`;
    if (report[7] === 12) { writes.push(key); memory.set(key,{type:report[11],params:[...report.subarray(13,13+report[12])]}); }
    return [];
  };
  return {hardware,writes,memory,device};
}
test('top controls migrate safely, require a primary click, and share macro slots',()=>{
  const p=newProfile();delete p.topBindings;assert.equal(validateProfile(p).topBindings.left.type,'default');
  p.topBindings={'left':{type:'key',value:'Q'}};assert.throws(()=>validateProfile(p),/Left click/);
  p.bindings[0]={type:'mouse',value:'left'};assert.equal(validateProfile(p).topBindings.left.value,'Q');
  p.macros=[{id:'m',name:'Test',repeat:1,steps:[{type:'key',value:'E'}]}];p.bindings[1]={type:'macro',value:'m'};p.topBindings.middle={type:'macro',value:'m'};
  const actions=actionsFor(p);assert.deepEqual(actions.find(a=>a.source===3).action,actions[1].action);
});
test('switching to Original restores both top control slots without changing untouched controls',async t=>{
  const {hardware,memory,device,writes}=fakeHardware(t),p=newProfile();
  for(const slot of [1,2])memory.set(`${slot}:11`,{type:6,params:[slot]});
  p.topBindings['dpi-up']={type:'key',value:'Ctrl+Q'};await hardware.apply(device.id,p);
  assert.deepEqual(memory.get('1:11'),{type:2,params:[1,20]});
  p.topBindings['dpi-up']={type:'default',value:''};await hardware.apply(device.id,p);
  assert.deepEqual(memory.get('1:11'),{type:6,params:[1]});assert.deepEqual(memory.get('2:11'),{type:6,params:[2]});
  assert.ok(!writes.includes('1:1'));
});
test('hardware applies pending before active, skips unchanged writes, and preserves first originals', async t => {
  const {hardware,writes,memory,device} = fakeHardware(t), p = newProfile(); p.bindings[0].value = 'Ctrl+Q';
  await hardware.apply(device.id,p);
  assert.ok(writes.indexOf('2:64') < writes.indexOf('1:64'));
  assert.deepEqual(memory.get('1:64'),{type:2,params:[1,20]});
  const count = writes.length; await hardware.apply(device.id,p); assert.equal(writes.length,count);
  p.bindings[0].value = 'E'; await hardware.apply(device.id,p);
  await hardware.restore(device.id); assert.deepEqual(memory.get('1:64'),{type:2,params:[0,30]});
});
test('partial hardware failure rolls back all captured mappings', async t => {
  const {hardware,memory,device} = fakeHardware(t), p = newProfile(); p.bindings[0].value='Ctrl+Q'; p.bindings[1].value='R';
  const before = structuredClone([...memory]), originalWrite = hardware.write.bind(hardware);
  hardware.write = async (d,entry) => { if(entry.source === 0x41 && entry.action.params[1] === 21) throw new Error('Simulated disconnect'); return originalWrite(d,entry); };
  await assert.rejects(hardware.apply(device.id,p),/Previous mappings restored/);
  assert.deepEqual([...memory],before);
});
test('Trinity stages pending even if it already matches the new active mapping', async t => {
  const {hardware,writes,memory,device} = fakeHardware(t), p = newProfile();
  p.bindings[0].value = 'Q'; memory.set('2:64',{type:2,params:[0,20]});
  await hardware.apply(device.id,p);
  assert.ok(writes.includes('2:64'));
  assert.ok(writes.indexOf('2:64') < writes.indexOf('1:64'));
});
test('readback mismatch fails rather than reporting an applied profile', async t => {
  const {hardware,device} = fakeHardware(t);
  hardware.exchange = async () => [];
  await assert.rejects(hardware.write(device,{slot:1,source:0x40,action:{type:2,params:[0,4]}}),/Readback/);
});
test('macro cancellation interrupts delay and prevents later keys', async () => {
  const sent=[], notices=[];
  const player = new MacroPlayer({call:async (_method,data) => sent.push(data.keys)}, message => notices.push(message));
  const running = player.play({name:'Cancel test',repeat:1,steps:[{type:'key',value:'A'},{type:'delay',ms:10000},{type:'key',value:'B'}]});
  await new Promise(resolve => setImmediate(resolve)); player.stop(); await running;
  assert.deepEqual(sent,[[65]]); assert.equal(player.running,null); assert.ok(notices.includes('Macro stopped'));
});
test('overlapping macro triggers are ignored and repeats are bounded', async () => {
  const sent=[]; const player = new MacroPlayer({call:async (_method,data) => sent.push(data.keys)});
  const macro = {name:'Repeat',repeat:2,steps:[{type:'key',value:'Shift+1'},{type:'delay',ms:10}]};
  const first = player.play(macro); await player.play(macro); await first;
  assert.deepEqual(sent,[[16,49],[16,49]]);
});
