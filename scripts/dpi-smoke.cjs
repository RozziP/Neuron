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
    await wait('!!document.querySelector(".mouse-key")');
    const { validateDpi } = require('../app/dpi.cjs');
    let sensitivity = { x: 1800, y: 1800 }, writes = 0;
    hardware.devices = async () => [{ id: 'dpi-smoke', productId: 103, name: 'Naga Trinity', paths: [], connected: true }];
    hardware.inspectDpi = async () => ({ ...sensitivity });
    hardware.applyDpi = async (_id, value) => { sensitivity = validateDpi(value); writes++; return { ...sensitivity }; };
    await js('await window.neuron.scan()');
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
    assert.equal(writes, 2);
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
