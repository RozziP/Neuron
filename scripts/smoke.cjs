const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const delay = ms => new Promise(r => setTimeout(r,ms));
async function run(window, app, hardware, reporter, updates) {
  const directory = path.dirname(app.getPath('userData')); fs.mkdirSync(directory,{recursive:true});
  const failures=[];
  window.webContents.on('console-message', event => { if(event.level === 'error') failures.push(`${event.message} (${event.sourceId}:${event.lineNumber})`); });
  const js = code => window.webContents.executeJavaScript(`(async () => (${code}))()`);
  const waitFor = async expression => { for(let i=0;i<100;i++) { if(await js(expression)) return; await delay(50); } throw new Error(`UI timeout: ${expression}`); };
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const input = (selector,value) => js(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  const change = (selector,value) => js(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  const saveLocally = async () => { const selector=await js('document.querySelector("#save-macros") ? "#save-macros" : document.querySelector(".binding-editor") ? "#save-mapping" : "#save-profile"'); await click(selector); await waitFor('!document.querySelector("#profile-select").selectedOptions[0].textContent.includes("•") && !document.querySelector("#save-macros")?.textContent.includes("•")'); };
  const screenshots = []; let nativeInput = false;
  const screenshot = async (name, target) => {
    await js(target ? `document.querySelector(${JSON.stringify(target)}).scrollIntoView({block:'center'})` : 'document.querySelector("main").scrollTop = 0');
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await delay(150); const file=path.join(directory,name+'.png');
    fs.writeFileSync(file,(await window.webContents.capturePage()).toPNG()); screenshots.push(file);
  };
  try {
    await waitFor('!!document.querySelector("#profile-select option")');
    await click('[data-nav="buttons"]');
    await waitFor('!!document.querySelector(".mouse-key")');
    // Exercise update checks through the real preload/IPC boundary without network or browser launches.
    const originalFetch = updates.fetchRelease, originalOpen = updates.openExternal;
    const openedReleases = [];
    try {
      assert.equal(await js('document.querySelector("#app-version").textContent'), `v${app.getVersion()}`);
      assert.equal(await js('document.querySelector("#check-updates").textContent'), 'Check for updates');
      updates.openExternal = async url => { openedReleases.push(url); };
      let finishCheck;
      updates.fetchRelease = () => new Promise(resolve => { finishCheck = resolve; });
      await click('#check-updates');
      await waitFor('document.querySelector("#check-updates").disabled');
      while (!finishCheck) await delay(10);
      finishCheck({ ok: true, status: 200, json: async () => ({ tag_name: 'v99.0.0', draft: false, prerelease: false }) });
      await waitFor('document.querySelector("#check-updates").textContent === "Update to v99.0.0" && !document.querySelector("#check-updates").disabled');
      window.setSize(1080,730); await screenshot('update-available');
      assert.equal(await js('document.querySelector("#check-updates").getBoundingClientRect().bottom <= innerHeight'), true, 'Update controls should fit in the compact sidebar.');
      window.setSize(1380,900);
      await click('#check-updates');
      await waitFor('!document.querySelector("#check-updates").disabled');
      assert.deepEqual(openedReleases, ['https://github.com/RozziP/Neuron/releases/tag/v99.0.0']);
      updates.fetchRelease = async () => { throw new Error('offline'); };
      await js('window.neuron.checkUpdates()');
      await waitFor('document.querySelector("#update-status").textContent.includes("connection")');
      assert.equal(await js('document.querySelector("#check-updates").textContent'), 'Update to v99.0.0');
      updates.fetchRelease = async () => ({ ok: true, status: 200, json: async () => ({ tag_name: `v${app.getVersion()}`, draft: false, prerelease: false }) });
      await js('window.neuron.checkUpdates()');
      await waitFor('document.querySelector("#update-status").textContent.includes("up to date")');
      assert.equal(await js('document.querySelector("#check-updates").textContent'), 'Check for updates');
    } finally { updates.fetchRelease = originalFetch; updates.openExternal = originalOpen; }
    // Exercise native SendInput only after confirming our own test window has focus.
    const { Bridge } = require('../app/bridge.cjs');
    const { MacroPlayer } = require('../app/macros.cjs');
    const native = new Bridge();
    try {
      await js(`(()=>{const input=document.createElement('input');input.id='native-test-input';document.querySelector('#keyboard-tester').append(input);return true})()`);
      window.focus(); await js('document.querySelector("#native-test-input").focus()');
      let foreground = await native.call('foreground');
      for (let attempt = 0; attempt < 10 && foreground.pid !== process.pid; attempt++) {
        await delay(100); foreground = await native.call('foreground');
      }
      if (foreground.pid === process.pid) {
        const player = new MacroPlayer(native);
        await player.play({name:'Native smoke',repeat:1,steps:[{type:'key',value:'A'},{type:'delay',ms:30},{type:'key',value:'Shift+B'}]});
        await waitFor('document.querySelector("#native-test-input").value === "aB"');
        assert.equal((await native.call('keyDown',{key:16})).down,false,'Macro must release Shift.');
        nativeInput = true;
      } else console.log('Native input check skipped: another app has foreground focus.');
    } finally { native.close(); await js('document.querySelector("#native-test-input")?.remove()'); }
    assert.equal(await js('document.querySelectorAll(".bindings-overview").length'),0);
    await click('#test-keys');
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Shift',modifiers:['shift']});
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'A',modifiers:['shift']});
    await waitFor('document.querySelector("[data-key-code=ShiftLeft]").classList.contains("pressed") && document.querySelector("[data-key-code=KeyA]").classList.contains("pressed")');
    window.webContents.sendInputEvent({type:'keyUp',keyCode:'A',modifiers:['shift']});
    await waitFor('!document.querySelector("[data-key-code=KeyA]").classList.contains("pressed")');
    assert.equal(await js('document.querySelector("[data-key-code=ShiftLeft]").classList.contains("pressed")'),true);
    window.webContents.sendInputEvent({type:'keyUp',keyCode:'Shift'});
    await waitFor('!document.querySelector(".keyboard-key.pressed")');
    await click('[data-key-code=KeyQ]');
    assert.equal(await js('document.querySelector(".mouse-key.selected .key-label").textContent'),'Q');
    assert.equal(await js('document.querySelectorAll(".mouse-key").length'),21);
    assert.equal(await js('typeof window.require'),'undefined');
    // Capture a shortcut rather than requiring users to type key names.
    await click('#capture-binding');
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'1',modifiers:['control','shift']});
    window.webContents.sendInputEvent({type:'keyUp',keyCode:'1'});
    await waitFor('document.querySelector(".mouse-key.selected .key-label").textContent === "Ctrl+Shift+1"');
    assert.equal(await js('document.querySelector(".binding-value").textContent'),'Ctrl+Shift+1');
    assert.equal(await js('document.querySelectorAll(".modifier-choices, .apply-binding-area, #binding-preview, .secondary-binding-actions, .manual-binding, #jump-keyboard").length'),0);
    await saveLocally();
    assert.equal(await js('(await window.neuron.state()).profiles[0].bindings[0].value'),'Ctrl+Shift+1');
    await click('[data-button="4"]'); assert.equal(await js('document.querySelector(".binding-summary").textContent'),'Button 5: 5');
    await click('#capture-binding');
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Shift',modifiers:['shift']});
    window.webContents.sendInputEvent({type:'keyUp',keyCode:'Shift'});
    await waitFor('document.querySelector(".mouse-key.selected .key-label").textContent === "Shift"');
    await saveLocally();
    await waitFor('(await window.neuron.state()).profiles[0].bindings[4].value === "Shift"');
    await click('#capture-binding');
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
    window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    await waitFor('!document.querySelector(".capture-binding.listening")');
    assert.equal(await js('document.querySelector(".mouse-key.selected .key-label").textContent'),'Shift');
    await screenshot('buttons');
    await click('#test-keys');
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Control',modifiers:['control']});
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Shift',modifiers:['control','shift']});
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'1',modifiers:['control','shift']});
    await screenshot('keyboard','.live-keyboard');
    assert.equal(await js('(()=>{const r=document.querySelector("#apply").getBoundingClientRect(),m=document.querySelector("main").getBoundingClientRect();return r.top>=m.top && r.bottom<m.bottom})()'),true);
    for (const keyCode of ['1','Shift','Control']) window.webContents.sendInputEvent({type:'keyUp',keyCode});
    // An empty library opens the picker without creating a macro or changing the binding.
    await click('[data-type="macro"]');
    assert.equal(await js('document.querySelector("#macro-picker").open'),true);
    assert.match(await js('document.querySelector("#macro-picker-list").textContent'),/No saved macros/);
    assert.equal(await js('document.querySelector("#breadcrumb").textContent'),'Button mapping');
    await click('#macro-picker-cancel');
    assert.equal(await js('document.querySelector(".binding-value").textContent'),'Shift');
    await click('[data-nav="macros"]');
    assert.equal(await js('document.querySelector(".head-actions").hidden'),true);
    await click('#new-macro');
    await input('#macro-name','Quick combo'); await click('#add-delay'); await click('#add-key');
    assert.equal(await js('document.querySelector("#macro-repeat-field").hidden'),true);
    for (const mode of ['count','toggle','held','once']) {
      await change('#macro-repeat-mode',mode);
      assert.equal(await js('document.querySelector("#macro-repeat-field").hidden'),mode!=='count');
      if(mode==='count')await input('#macro-repeat',25);
      await saveLocally();
      assert.equal(await js('(await window.neuron.state()).macros[0].repeatMode'),mode);
      if(mode==='count')assert.equal(await js('(await window.neuron.state()).macros[0].repeat'),25);
    }
    await input('[data-step="2"]','Shift+2'); await saveLocally();
    await waitFor('(await window.neuron.state()).profiles[0].macros.some(m=>m.name==="Quick combo")');
    await screenshot('macros');
    await click('#new-macro'); await input('#macro-name','Held combo');
    await change('#macro-repeat-mode','held'); await saveLocally();
    window.setSize(1080,730); await screenshot('macros-held-compact');
    assert.equal(await js('document.querySelector("main").scrollWidth <= document.querySelector("main").clientWidth'),true);
    window.setSize(1380,900);
    await click('[data-nav="buttons"]'); await click('[data-type="macro"]');
    assert.equal(await js('document.querySelectorAll("[data-bind-macro]").length'),2);
    await screenshot('macro-picker');
    await click('#macro-picker-cancel');
    assert.equal(await js('document.querySelector(".binding-value").textContent'),'Shift');
    await click('[data-type="macro"]'); await click('[data-bind-macro]'); await saveLocally();
    await waitFor('(await window.neuron.state()).profiles[0].bindings[4].type==="macro"');
    await click('#binding-macro');
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
    window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    await waitFor('!document.querySelector("#macro-picker").open');
    assert.equal(await js('document.querySelector(".binding-value").textContent'),'Quick combo');
    await click('[data-top-control="middle"]'); await click('[data-type="macro"]');
    await click('[data-bind-macro]:last-child'); await saveLocally();
    assert.equal(await js('document.querySelector(".binding-value").textContent'),'Held combo');
    // Reload verifies both mode and side/top assignments survive persistence.
    window.webContents.reload();
    await waitFor('!!document.querySelector("#profile-select option")');
    await click('[data-nav="buttons"]');
    await waitFor('!!document.querySelector(".mouse-key")');
    assert.equal(await js('(await window.neuron.state()).macros[1].repeatMode'),'held');
    await click('[data-top-control="middle"]');
    assert.equal(await js('document.querySelector(".binding-value").textContent'),'Held combo');
    await click('[data-button="4"]');
    // Primary-click gates and persistent warnings; never apply these bindings to hardware.
    for (const side of ['left', 'right']) {
      await click('[data-top-control="'+side+'"]');
      assert.equal(await js('document.querySelector("#confirm-dialog").open'), true);
      assert.equal(await js('document.activeElement.id'), 'confirm-cancel');
      assert.equal(await js('document.querySelector(".mouse-key.selected").dataset.topControl'), undefined);
      if (side === 'left') await screenshot('left-click-confirmation');
      await click('#confirm-cancel');
      assert.equal(await js('document.querySelector("[data-top-control='+side+'] .key-label").textContent'), 'Original');
    }
    await click('[data-top-control="right"]'); await click('#confirm-ok');
    await waitFor('document.querySelector(".mouse-key.selected").dataset.topControl === "right"');
    await click('[data-key-code=KeyR]');
    assert.equal(await js('document.querySelector(".binding-value").textContent'), 'R');
    assert.equal(await js('document.querySelector("#click-warning").hidden'), true);
    await click('[data-type="default"]');
    await click('[data-top-control="left"]'); await click('#confirm-ok');
    await waitFor('document.querySelector(".mouse-key.selected").dataset.topControl === "left"');
    await click('[data-type="disabled"]');
    assert.equal(await js('document.querySelector("#click-warning").hidden'), false);
    assert.match(await js('document.querySelector("#click-warning-text").textContent'), /no Left click assignment/);
    await click('#save-mapping');
    await waitFor('document.querySelector("#toast").classList.contains("error")');
    assert.equal(await js('(await window.neuron.state()).profiles[0].topBindings.left.type'), 'default');
    await screenshot('left-click-warning');
    await js('document.querySelector("main").scrollTop = 10000');
    await delay(100);
    assert.equal(await js('(()=>{const r=document.querySelector("#click-warning").getBoundingClientRect(),m=document.querySelector("main").getBoundingClientRect();return r.top>=m.top && r.bottom<m.bottom})()'),true);
    window.setSize(1080,730); await screenshot('left-click-warning-compact');
    assert.equal(await js('document.querySelector("main").scrollWidth <= document.querySelector("main").clientWidth'),true);
    window.setSize(1380,900);
    await click('[data-nav="macros"]');
    assert.equal(await js('document.querySelector("#click-warning").hidden'), false);
    await click('[data-nav="dpi"]');
    assert.equal(await js('document.querySelector("#click-warning").hidden'), false);
    await click('[data-nav="buttons"]');
    await click('[data-button="0"]'); await click('[data-type="mouse"]');
    assert.match(await js('document.querySelector("#click-warning-text").textContent'), /use Button 1/);
    await saveLocally();
    const warningState = await js('window.neuron.state()');
    window.webContents.send('state', { ...warningState, active: { profileId: warningState.profiles[0].id, profile: warningState.profiles[0], deviceId: 'simulated-active' } });
    await waitFor('document.querySelector("#click-warning-text").textContent.includes("Active now")');
    await click('[data-top-control="left"]'); await click('#confirm-ok');
    await waitFor('document.querySelector(".mouse-key.selected").dataset.topControl === "left"');
    await click('[data-type="default"]');
    assert.match(await js('document.querySelector("#click-warning-text").textContent'), /Active now/);
    assert.doesNotMatch(await js('document.querySelector("#click-warning-text").textContent'), /after applying/);
    window.webContents.send('state', warningState);
    await waitFor('document.querySelector("#click-warning").hidden');
    await saveLocally();
    await click('[data-top-control="left"]'); await click('#confirm-ok');
    await waitFor('document.querySelector(".mouse-key.selected").dataset.topControl === "left"');
    await click('[data-type="mouse"]');
    assert.equal(await js('document.querySelector("#click-warning").hidden'), true);
    await click('[data-type="default"]'); await saveLocally();
    await click('[data-top-control="dpi-up"]'); await click('[data-type="key"]');
    await click('#capture-binding');
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Q',modifiers:['control']});
    window.webContents.sendInputEvent({type:'keyUp',keyCode:'Q'});
    await saveLocally();
    await waitFor('(await window.neuron.state()).profiles[0].topBindings["dpi-up"].value === "Ctrl+Q"');
    await click('[data-nav="profiles"]');
    await waitFor('document.querySelectorAll("[data-game]").length > 0');
    assert.equal(await js('document.querySelectorAll("[data-game]").length >= 2'),true);
    await screenshot('game-library');
    await js('document.querySelector("#game-template").selectedIndex = 1');
    await click('#create-game-profile');
    await waitFor('document.querySelector(".mouse-key") && (await window.neuron.state()).profiles.some(p=>p.gameId)');
    assert.equal(await js('(await window.neuron.state()).profiles.find(p=>p.gameId).macros[0].name'),'Quick combo');
    assert.equal(await js('(await window.neuron.state()).profiles.find(p=>p.gameId).topBindings["dpi-up"].value'),'Ctrl+Q');
    await click('[data-nav="profiles"]');
    await waitFor('!!document.querySelector("#edit-game-profile")');
    assert.equal(await js('document.querySelectorAll("#auto-switch").length'),0);
    assert.match(await js('document.querySelector(".game-switching").textContent'),/AUTOMATIC SWITCHING ACTIVE/);
    await screenshot('profiles');
    // Import through the real IPC/file parser, with only the native file picker stubbed.
    const {dialog}=require('electron'), originalPicker=dialog.showOpenDialog;
    const template=(await js('(await window.neuron.state()).profiles[0]'));
    const importPath=path.join(directory,'standard-import.neuron.json');
    fs.writeFileSync(importPath,JSON.stringify({version:1,profile:template}));
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[importPath]});
    try {
      assert.equal(await js(`(async()=>{const library=await window.neuron.games(),s=await window.neuron.state();const g=library.games.find(g=>g.executablePath && !s.profiles.some(p=>p.gameId===g.id));const p=await window.neuron.createGame(g.id,'',103,12,g.executablePath,true);return p.gameId===g.id && p.macros[0].name==='Quick combo' && p.id!==${JSON.stringify(template.id)}})()`),true);
    } finally {dialog.showOpenDialog=originalPicker;}
    await click('[data-profile-tab="standard"]');
    await waitFor('!!document.querySelector("#new-profile")');
    await click('#new-profile');
    await waitFor('document.querySelector("#profile-name").value.startsWith("Profile ")');
    await input('#profile-name','Reusable MMO');await saveLocally();
    await waitFor('(await window.neuron.state()).profiles.some(p=>p.name==="Reusable MMO" && !p.gameId)');
    await click('[data-profile-tab="games"]');
    window.setSize(1080,730);await screenshot('compact-games');window.setSize(1380,900);
    await click('[data-nav="devices"]');
    const connected = await js('(await window.neuron.state()).devices.some(d=>d.productId===103)');
    if(connected) { await click('#inspect-device'); await waitFor('document.querySelectorAll(".readback span").length===12'); }
    await screenshot('devices');
    // Exercise receiver recognition through the real scan IPC and renderer.
    // The fixture has no transport: no commands can be sent to a physical receiver.
    const { discoverReceivers } = require('../app/receivers.cjs');
    const receiverRecord = {vendorId:13652,productId:62813,interface:2,usagePage:1,usage:2,path:'smoke-compx',product:'2.4G Wireless Receiver'};
    const receiver = discoverReceivers([receiverRecord])[0];
    const originalDevices = hardware.devices, realDevices = await hardware.devices();
    const originalWorkspace=await js('(await window.neuron.state()).selectedMouse.key');
    const identityTrinity={id:'identity-trinity',vendorId:0x1532,productId:103,name:'Naga Trinity',mappingPlates:[],paths:[]};
    const selectDevice=async id=>js(`(async()=>{const s=await window.neuron.state();await window.neuron.selectMouse(s.mouseWorkspaces.find(w=>w.deviceId===${JSON.stringify(id)}).key)})()`);
    const originalRecords = hardware.enumerated, originalEnrich = reporter.enrich;
    try {
      hardware.enumerated = [receiverRecord,{vendorId:0x1532,productId:0x0067,product:'Naga Trinity',interface:0,usagePage:1,usage:2,path:'smoke-trinity'}];
      reporter.enrich = async report => ({...report,identification:{...report.identification,software:[{
        source:'installed-driver-config',name:'Redragon M990-WL Gaming Mouse',version:'1.0.2.0',vendorId:13652,productId:62813,configuredModelId:48
      }]}});
      await reporter.tick(hardware.enumerated);
      hardware.devices = async () => [...realDevices.filter(d => d.support !== 'recognition-only' && !(d.vendorId === receiverRecord.vendorId && d.productId === receiverRecord.productId)), receiver,identityTrinity];
      await click('#scan-devices');
      await selectDevice(receiver.id);
      await waitFor('document.querySelectorAll(".receiver-device").length===1');
      assert.match(await js('document.querySelector(".receiver-device").textContent'), /3554:F55D/);
      assert.match(await js('document.querySelector(".receiver-device").textContent'), /model is unknown/);
      const identity = '[data-report-key="3554:f55d"]';
      assert.equal(await js('document.querySelectorAll("#content .identification-card").length'),0);
      await click('[data-nav="buttons"]');
      await click('[data-identity-key="3554:f55d"]');
      assert.equal(await js('document.querySelector("#identity-dialog").open'),true);
      assert.equal(await js('document.querySelector("#page-title").textContent'),'Button mapping.');
      assert.equal(await js('document.querySelectorAll(".identification-card").length'),1);
      await waitFor(`!!document.querySelector(${JSON.stringify(identity+' .identity-yes')})`);
      assert.match(await js(`document.querySelector(${JSON.stringify(identity+' h2')}).textContent`),/Is your mouse a Redragon M990-WL/);
      await screenshot('identify-mouse','[data-report-key="3554:f55d"]');
      await click('[data-report-key="3554:f55d"] .identity-yes');
      await waitFor('(await window.neuron.state()).hardwareReports.find(r=>r.key==="3554:f55d").status === "driver-needed"');
      assert.equal(await js('(await window.neuron.state()).hardwareReports.find(r=>r.key==="3554:f55d").supported'),false);
      await click('#identity-dialog .identity-dialog-head button');
      await waitFor('document.activeElement.dataset.identityKey === "3554:f55d"');
      await selectDevice(identityTrinity.id);
      await click('[data-identity-key="1532:0067"]');
      await click('[data-report-key="1532:0067"] .identity-yes');
      await waitFor('(await window.neuron.state()).hardwareReports.find(r=>r.key==="1532:0067").status === "local-only"');
      await click('#identity-dialog .identity-dialog-head button');
      await waitFor('document.activeElement.dataset.identityKey === "1532:0067"');
      await selectDevice(receiver.id);
      await click('[data-identity-key="3554:f55d"]');
      assert.match(await js(`document.querySelector(${JSON.stringify(identity)}).textContent`),/issue stays open/);
      await js(`document.querySelector(${JSON.stringify(identity+' details')}).open=true`);
      await input('[data-report-key="3554:f55d"] .identity-name','Redragon M990-WL');
      await js(`document.querySelector(${JSON.stringify(identity+' .identity-name')}).focus()`);
      reporter.entries['3554:f55d']={issueUrl:'https://github.com/RozziP/Neuron/issues/1'};reporter.publish();
      await waitFor(`!!document.querySelector(${JSON.stringify(identity+' .identity-issue')})`);
      assert.equal(await js('document.activeElement.value'),'Redragon M990-WL','A report update must not erase an unfinished correction.');
      await js(`document.querySelector(${JSON.stringify(identity+' .identity-form')}).requestSubmit()`);
      await waitFor('(await window.neuron.state()).hardwareReports.find(r=>r.key==="3554:f55d").confirmedModel === "Redragon M990-WL"');
      window.setSize(1080,730);await screenshot('identify-mouse-confirmed','[data-report-key="3554:f55d"]');window.setSize(1380,900);
      window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
      window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
      await waitFor('!document.querySelector("#identity-dialog").open');
      assert.equal(await js('document.querySelector("#page-title").textContent'),'Button mapping.');
      await click('[data-nav="devices"]');
      hardware.devices = async () => [receiver];
      await click('#scan-devices');
      assert.equal(await js('(await window.neuron.state()).profiles.length'),0);
      assert.equal(await js('document.querySelector(".head-actions").hidden'),true);
      assert.equal(await js('document.querySelector("#device-select")'),null);
      assert.match(await js('document.querySelector(".receiver-device").textContent'), /model is unknown/);
      await screenshot('compx-receiver');
      hardware.devices = async () => [];
      await click('#scan-devices');
      await waitFor('!document.querySelector(".receiver-device")');
    } finally {
      hardware.devices = originalDevices;
      hardware.enumerated = originalRecords; reporter.enrich = originalEnrich; reporter.observe(originalRecords);
      await js('window.neuron.scan()');
      await js(`window.neuron.selectMouse(${JSON.stringify(originalWorkspace)})`);
    }
    // Model selection and experimental dock controls through real IPC. All
    // device operations here are simulated; never write to an attached mouse.
    const { mappingCapabilities } = require('../app/drivers.cjs');
    const dock = discoverReceivers([{vendorId:0x1532,productId:0x00a4,interface:0,usagePage:1,usage:2,path:'smoke-dock'}])[0];
    const savedHardware = {devices:hardware.devices,apply:hardware.apply,restore:hardware.restore};
    const applied=[];
    try {
      hardware.devices = async () => { const d=hardware.models.describe(dock); return [{...d,...mappingCapabilities(d)}]; };
      hardware.apply = async (id,profile) => { applied.push({id,model:profile.model}); return {message:'Simulated dock mappings applied.'}; };
      hardware.restore = async () => ({message:'Simulated dock mappings restored.'});
      await click('#scan-devices');
      await selectDevice(dock.id);
      await waitFor('!!document.querySelector(".receiver-model-form")');
      assert.match(await js('document.querySelector(".receiver-device").textContent'),/which mouse is paired/i);
      await change('.receiver-model','168');
      await js('document.querySelector(".receiver-model-form").requestSubmit()');
      await waitFor('(await window.neuron.state()).preferredMouseModel === 168 && !document.querySelector("#apply").disabled');
      assert.equal(await js('(await window.neuron.state()).devices[0].productId'),164);
      assert.equal(await js('document.querySelector("#manual-mouse-model").value'),'168');
      assert.equal(await js('document.querySelector("#inspect-device").disabled'),false);
      window.setSize(1080,730);await screenshot('dock-mouse-selection');
      assert.equal(await js('document.querySelector("main").scrollWidth <= document.querySelector("main").clientWidth'),true);
      window.setSize(1380,900);
      await click('#apply');await waitFor('(await window.neuron.state()).active?.deviceId === '+JSON.stringify(dock.id));
      assert.deepEqual(applied,[{id:dock.id,model:168}]);
      assert.equal(await js(`(async()=>{try{await window.neuron.selectDeviceModel(${JSON.stringify(dock.id)},103);return false}catch{return true}})()`),true);
      await js(`window.neuron.restore(${JSON.stringify(dock.id)})`);
      await change('.receiver-model','103');await js('document.querySelector(".receiver-model-form").requestSubmit()');
      await waitFor('(await window.neuron.state()).devices[0].modelId === 103 && document.querySelector("#apply").disabled');
      assert.equal(await js('document.querySelector("#inspect-device").disabled && document.querySelector("#restore-device").disabled'),true);
      await click('.reset-mouse-choice');await waitFor('!(await window.neuron.state()).devices[0].modelId');
      hardware.devices=async()=>[];await click('#scan-devices');
      await change('#manual-mouse-model','150');await js('document.querySelector("#manual-mouse-form").requestSubmit()');
      await waitFor('(await window.neuron.state()).preferredMouseModel === 150');
      window.webContents.reload();await waitFor('!!document.querySelector(".mouse-key")');
      assert.equal(await js('document.querySelector("#device-short").textContent'),'Naga X');
      await click('[data-nav="devices"]');await change('#manual-mouse-model','103');await js('document.querySelector("#manual-mouse-form").requestSubmit()');
      await waitFor('(await window.neuron.state()).preferredMouseModel === 103');
    } finally { Object.assign(hardware,savedHardware);await js('window.neuron.scan()'); }
    // Invalid payloads must be rejected across the actual renderer/main boundary.
    assert.equal(await js(`(async()=>{try{await window.neuron.save({id:'invalid'});return false}catch{return true}})()`),true);
    // A launch from Start must recover a destroyed window in the running process.
    const { BrowserWindow } = require('electron');
    const closedHandlers = app.listeners('window-all-closed'), keepAlive = () => {};
    app.removeAllListeners('window-all-closed'); app.on('window-all-closed',keepAlive);
    try {
      window.destroy();
      app.emit('second-instance', {}, [], directory);
      app.emit('second-instance', {}, [], directory);
      for (let i=0;i<100;i++) {
        const replacement = BrowserWindow.getAllWindows().find(w=>!w.isDestroyed());
        if (replacement) { window=replacement; break; }
        await delay(50);
      }
      assert.equal(window.isDestroyed(),false,'Launching again should recreate a destroyed window.');
      await waitFor('!!document.querySelector("#profile-select option")');
      await click('[data-nav="buttons"]');
      await waitFor('!!document.querySelector(".mouse-key")');
      assert.equal(BrowserWindow.getAllWindows().length,1);
      assert.equal(await js('(await window.neuron.state()).macros[1].repeatMode'),'held');
      await screenshot('reopened-window');
    } finally {
      app.removeListener('window-all-closed',keepAlive);
      for (const handler of closedHandlers) app.on('window-all-closed',handler);
    }
    assert.deepEqual(failures,[]);
    fs.writeFileSync(path.join(directory,'smoke-result.json'),JSON.stringify({ok:true,nativeInput,hardwareRead:connected,screenshots},null,2));
    console.log('Desktop smoke test passed.');
  } catch(error) {
    await screenshot('failure'); fs.writeFileSync(path.join(directory,'smoke-result.json'),JSON.stringify({ok:false,error:error.stack,failures},null,2));
    console.error(error); app.exit(1); return;
  }
  app.quit();
}
module.exports = {run};
