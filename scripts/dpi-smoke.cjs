// Real renderer/preload/store integration with a simulated DPI device. No hardware writes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run(window, app, hardware) {
  const directory = path.dirname(app.getPath('userData'));
  fs.mkdirSync(directory, { recursive: true });
  const errors = [], screenshots = [];
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const js = code => window.webContents.executeJavaScript(`(async () => { ${code} })()`);
  const wait = async condition => {
    for (let i = 0; i < 100; i++) { if (await js(`return ${condition}`)) return; await delay(50); }
    throw new Error(`Timed out: ${condition}`);
  };
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const input = (selector, value) => js(`const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true }));`);
  const screenshot = async name => {
    await delay(200);
    const file = path.join(directory, `${name}.png`);
    fs.writeFileSync(file, (await window.webContents.capturePage()).toPNG()); screenshots.push(file);
  };
  try {
    await wait('!!document.querySelector("#profile-select option")');
    await click('[data-nav="buttons"]');
    await wait('!!document.querySelector(".mouse-key")');
    const { validateDpi } = require('../app/dpi.cjs');
    let sensitivity = { x: 1800, y: 1800 }, writes = 0;
    hardware.devices = async () => [{ id: 'dpi-smoke', vendorId: 0x1532, productId: 103, name: 'Naga Trinity', dpi:{min:100,max:16000}, paths: [], connected: true }];
    hardware.inspectDpi = async () => ({ ...sensitivity });
    hardware.applyDpi = async (_id, value) => { sensitivity = validateDpi(value); writes++; return { ...sensitivity }; };
    await js('await window.neuron.scan()');
    await js('const s=await window.neuron.state(); await window.neuron.selectMouse(s.mouseWorkspaces.find(w=>w.deviceId==="dpi-smoke").key);');
    await click('[data-nav="dpi"]');
    await wait('document.querySelector(".dpi-device-value strong").textContent === "1,800"');
    assert.equal(await js('return document.querySelector(".head-actions").hidden'), true);
    assert.equal(await js('return !!document.querySelector("#dpi-enabled")'), false);
    await input('#dpi-x', '800');
    assert.equal(await js('return document.querySelector("#dpi-y").value'), '800');
    await click('#dpi-linked'); await input('#dpi-y', '1200');
    await click('#apply-dpi');
    await wait('document.querySelector(".dpi-device-value strong").textContent === "800"');
    assert.deepEqual(sensitivity, { x: 800, y: 1200 });
    assert.equal(await js('return (await window.neuron.state()).profiles.some(p => "dpi" in p)'), false);
    await input('#dpi-x', '0'); await click('#apply-dpi');
    await wait('document.querySelector("#toast").classList.contains("error")');
    assert.deepEqual(sensitivity, { x: 800, y: 1200 });
    assert.equal(writes, 1);
    await click('[data-dpi-preset="1600"]'); await click('#apply-dpi');
    await wait('document.querySelector(".dpi-device-value strong").textContent === "1,600"');
    await screenshot('dpi');
    window.setSize(1080, 730); await delay(200);
    assert.equal(await js('return document.querySelector("main").scrollWidth <= document.querySelector("main").clientWidth'), true);
    await screenshot('dpi-compact'); window.setSize(1380, 900);
    await click('[data-nav="buttons"]');
    assert.equal(await js('return document.querySelector(".head-actions").hidden'), false);
    await js('await window.neuron.create("Other profile", 103, 12)');
    await js('const s = await window.neuron.state(); const el = document.querySelector("#profile-select"); el.value = s.profiles[1].id; el.dispatchEvent(new Event("change", { bubbles: true }));');
    await click('[data-nav="dpi"]');
    assert.equal(await js('return document.querySelector("#dpi-x").value'), '1600');
    assert.deepEqual(sensitivity, { x: 1600, y: 1600 });
    window.webContents.reload(); await delay(200); await wait('!!document.querySelector(".mouse-key")');
    await click('[data-nav="dpi"]');
    await wait('document.querySelector("#dpi-y").value === "1600"');
    hardware.devices = async () => [];
    await js('await window.neuron.scan()');
    assert.equal(await js('return document.querySelector("#apply-dpi").disabled'), true);
    assert.equal(await js('return document.querySelector("#read-dpi").disabled'), true);
    const {catalog}=require('../app/catalog.cjs');
    const dpiDevices=[...[['v2-dock',0x00a8],['v3-dock',0x00e8]].map(([id,modelId])=>({id,productId:0x00a4,modelId,connection:'dock',name:catalog.find(m=>m.productId===modelId).name+' · Mouse Dock Pro',dpi:catalog.find(m=>m.productId===modelId).dpi})),
      ...[0x008f,0x0090,0x008d,0x0096,0x00b4].map(pid=>({...catalog.find(m=>m.productId===pid),id:'naga-'+pid.toString(16)}))];
    for(const device of dpiDevices) {
      const max=device.dpi.max;
      hardware.devices = async () => [{...device,vendorId:0x1532,paths:[],connected:true}];
      sensitivity={x:max-6000,y:max};
      let failRead=true;
      hardware.inspectDpi = async () => {if(failRead)throw new Error('Simulated unavailable DPI');return {...sensitivity};};
      hardware.applyDpi = async (_id,value) => {sensitivity=validateDpi(value,{min:100,max});writes++;return {...sensitivity};};
      await js(`await window.neuron.scan(); const s=await window.neuron.state(); await window.neuron.selectMouse(s.mouseWorkspaces.find(w=>w.deviceId===${JSON.stringify(device.id)}).key);`);
      assert.equal(await js('return document.querySelector(".dpi-device-value strong").textContent'),'—');
      assert.equal(await js('return document.querySelector("#apply-dpi").disabled'),true);
      assert.equal(await js('return document.querySelector(".dpi-controls").hidden'),true);
      await click('#read-dpi');await wait('!dpiReading');
      assert.equal(await js('return document.querySelector(".dpi-device-value strong").textContent'),'—');
      assert.equal(await js('return document.querySelector("#apply-dpi").disabled'),true);
      failRead=false;await click('#read-dpi');await wait(`document.querySelector("#dpi-x").value === "${max-6000}"`);
      assert.equal(await js('return document.querySelector("#dpi-x").max'),String(max));
      assert.equal(await js('return document.querySelector("#dpi-y").value'),String(max));
      const beforeWrites=writes;
      await input('#dpi-x',String(max+1));await click('#apply-dpi');await wait('!busy');
      assert.equal(writes,beforeWrites,'Out-of-range values must not reach hardware.');
      await input('#dpi-x','100');await click('#apply-dpi');await wait('document.querySelector(".dpi-device-value strong").textContent === "100"');
      assert.deepEqual(sensitivity,{x:100,y:max});
      await screenshot(`dpi-${device.id}`);
      failRead=true;await click('#read-dpi');await wait('!dpiReading');
      assert.equal(await js('return document.querySelector(".dpi-device-value strong").textContent'),'—','A failed refresh must not leave a stale reading.');
      assert.equal(await js('return document.querySelector("#apply-dpi").disabled'),true);
    }
    assert.equal(writes, 2+dpiDevices.length);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(directory, 'dpi-smoke-result.json'), JSON.stringify({ ok: true, simulatedDevice: true, screenshots }, null, 2));
    console.log('DPI desktop smoke passed.');
    app.quit();
  } catch (error) {
    await screenshot('dpi-failure');
    fs.writeFileSync(path.join(directory, 'dpi-smoke-result.json'), JSON.stringify({ ok: false, error: error.stack, errors }, null, 2));
    console.error(error); app.exit(1);
  }
}
module.exports = { run };
