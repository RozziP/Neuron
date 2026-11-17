const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { MacroPlayer } = require('../app/macros.cjs');
const { Store, newProfile, validateProfile } = require('../app/store.cjs');
const macro = (repeatMode, repeat = 1) => ({id:'combo',name:'Combo',repeatMode,repeat,steps:[{type:'key',value:'A'}]});

test('all playback modes persist and legacy repeat counts keep their meaning', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'neuron-macros-'));
  t.after(() => fs.rmSync(directory,{recursive:true,force:true}));
  const store = new Store(directory);
  const library = ['once','count','toggle','held'].map(mode => ({...macro(mode,42),id:mode}));
  library.push({...macro(undefined,3),id:'legacy-count'}, {...macro(undefined),id:'legacy-once'});
  store.saveMacros(library);
  const saved = new Store(directory).macros;
  assert.deepEqual(saved.map(m=>m.repeatMode),['once','count','toggle','held','count','once']);
  assert.deepEqual(saved.map(m=>m.repeat),[1,42,1,1,3,1]);
  for (const repeat of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(() => validateProfile({...newProfile(),macros:[macro('count',repeat)]}),/positive whole number/);
  }
  assert.throws(() => validateProfile({...newProfile(),macros:[macro('invalid')]}),/playback mode/);
  assert.throws(() => validateProfile({...newProfile(),macros:[{...macro('toggle'),steps:[]}]}),/1–100 steps/);
});

test('once runs one sequence and count runs the requested number beyond the old limit', async () => {
  const sent = [], player = new MacroPlayer({call:async (_,data)=>sent.push(data.keys)});
  await player.trigger(macro('once',5));
  assert.equal(sent.length,1);
  await player.trigger(macro('count',25));
  assert.equal(sent.length,26);
});

test('toggle repeats without delays, ignores other macros, and stops on the same trigger', {timeout:2000}, async t => {
  const sent = [], notices = [], player = new MacroPlayer({call:async (_,data)=>sent.push(data.keys)}, message=>notices.push(message));
  t.after(()=>player.stop());
  const combo = macro('toggle'), running = player.trigger(combo);
  await nextTurn(); await nextTurn();
  assert.ok(sent.length >= 2);
  await player.trigger({...combo,id:'other'});
  assert.equal(player.runningMacroId,'combo');
  player.trigger(combo); await running;
  assert.equal(player.running,null);
  assert.ok(notices.includes('Macro stopped'));
  const stoppedCount = sent.length;
  await nextTurn(); assert.equal(sent.length,stoppedCount);
  const restarted = player.trigger(combo);
  await nextTurn(); player.stop(); await restarted;
  assert.ok(sent.length > stoppedCount);
});

test('release cancels held playback during a delay and does not affect a later macro', {timeout:2000}, async t => {
  const sent = [], player = new MacroPlayer({call:async (_,data)=>sent.push(data.keys)});
  t.after(()=>player.stop());
  const press = new AbortController();
  const held = {...macro('held'),steps:[{type:'key',value:'A'},{type:'delay',ms:10000},{type:'key',value:'B'}]};
  const running = player.trigger(held,{signal:press.signal});
  await nextTurn(); press.abort(); await running;
  assert.deepEqual(sent,[[65]]);
  await player.trigger(held,{signal:press.signal});
  await player.trigger(held);
  assert.deepEqual(sent,[[65]]);
  await player.trigger(macro('once'));
  assert.deepEqual(sent,[[65],[65]]);
});

test('held playback repeats until release; release never stops a toggle', {timeout:2000}, async t => {
  const sent = [], player = new MacroPlayer({call:async (_,data)=>sent.push(data.keys)});
  t.after(()=>player.stop());
  const press = new AbortController();
  const running = player.trigger(macro('held'),{signal:press.signal});
  await nextTurn(); await nextTurn(); press.abort(); await running;
  assert.ok(sent.length >= 2);
  const togglePress = new AbortController();
  const toggled = player.trigger(macro('toggle'),{signal:togglePress.signal});
  togglePress.abort(); await nextTurn();
  assert.equal(player.running.signal.aborted,false);
  player.stop(); await toggled;
});
