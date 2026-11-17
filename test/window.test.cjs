const test = require('node:test');
const assert = require('node:assert/strict');
const { createWindowOpener } = require('../app/window.cjs');
function fakeWindow({destroyed = false, minimized = false} = {}) {
  const calls = [];
  const window = {calls,isDestroyed:()=>destroyed};
  for (const method of ['isMinimized','restore','show','focus']) window[method] = () => {
    if (destroyed) throw new Error('Object has been destroyed');
    calls.push(method); if (method === 'isMinimized') return minimized;
  };
  return window;
}
test('reopening replaces a destroyed window without calling its native methods', async () => {
  let current = fakeWindow({destroyed:true});
  const stale = current;
  const open = createWindowOpener({getWindow:()=>current,createWindow:async()=>current=fakeWindow()});
  assert.equal(await open(),current);
  assert.notEqual(current,stale);
  assert.deepEqual(stale.calls,[]);
  assert.deepEqual(current.calls,['isMinimized','show','focus']);
});
test('reopening restores and focuses the existing minimized window', async () => {
  const current = fakeWindow({minimized:true});
  const open = createWindowOpener({getWindow:()=>current,createWindow:()=>assert.fail('Unexpected new window')});
  await open();
  assert.deepEqual(current.calls,['isMinimized','restore','show','focus']);
});
test('simultaneous launch requests create only one window and retry after load failure', async () => {
  let current = null, attempts = 0;
  const open = createWindowOpener({getWindow:()=>current,createWindow:async()=>{
    attempts++;
    if (attempts === 1) throw new Error('Load failed');
    return current=fakeWindow();
  }});
  await assert.rejects(open(),/Load failed/);
  const results = await Promise.all([open(),open(),open()]);
  assert.equal(attempts,2);
  assert.ok(results.every(window=>window===current));
  assert.deepEqual(current.calls,['isMinimized','show','focus']);
});
test('startup and shutdown events do not open windows prematurely', async () => {
  let allowed = false, complete;
  const current = fakeWindow();
  const open = createWindowOpener({getWindow:()=>null,canOpen:()=>allowed,createWindow:()=>new Promise(resolve=>complete=resolve)});
  await open(); assert.equal(complete,undefined);
  allowed = true;
  const pending = open(); await Promise.resolve();
  allowed = false; complete(current); await pending;
  assert.deepEqual(current.calls,[]);
});
