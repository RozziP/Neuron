const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
async function run(window,app,hardware) {
  const dir=path.dirname(app.getPath('userData')),errors=[];
  window.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
  const js=code=>window.webContents.executeJavaScript(`(async()=>(${code}))()`);
  const wait=async code=>{for(let i=0;i<100;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,50));}throw Error('UI timeout: '+code);};
  const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  try {
    await wait('!!document.querySelector("#profile-select option")');
    // Simulated device exercises the renderer and real IPC without hardware writes.
    const device={id:'redragon-ui',name:'Redragon M990-WL',vendorId:0x3554,productId:0xf55d,modelId:0xf55d,modelVerified:true,modelSource:'automatic',connection:'receiver',support:'experimental',driver:'redragon-m990-wl-experimental',mappingPlates:[16],paths:[]};
    const {dpiCapabilities,validateDpi}=require('../app/dpi.cjs');
    device.dpi=dpiCapabilities(device);
    hardware.devices=async()=>[device];
    await js('window.neuron.scan()');
    await click('[data-nav="devices"]');
    await js('(()=>{const el=document.querySelector("#manual-mouse-model");el.value="62813";el.dispatchEvent(new Event("change",{bubbles:true}));document.querySelector("#manual-mouse-form").requestSubmit();})()');
    await wait('document.querySelector("#device-short").textContent==="M990-WL"');
    await js('window.neuron.selectMouse((await window.neuron.state()).mouseWorkspaces.find(w=>w.deviceId==="redragon-ui").key)');
    await click('[data-nav="buttons"]');
    await wait('document.querySelectorAll(".side-control-key").length===16');
    await wait('!document.querySelector("#apply").disabled');
    assert.equal(await js('document.querySelectorAll(".top-control-key").length'),0);
    assert.equal(await js('document.querySelectorAll("#plate option").length'),1);
    assert.equal(await js('document.querySelector("#apply").disabled'),false);
    await click('[data-button="15"]');await click('[data-type="mouse"]');
    assert.equal(await js('document.querySelectorAll("#binding-mouse option").length'),5);
    await click('[data-type="key"]');await click('#save-mapping');
    await wait('!document.querySelector("#profile-select").selectedOptions[0].textContent.includes("•")');
    const p=await js('(await window.neuron.state()).profiles.find(p=>p.model===62813)');
    assert.equal(p.plate,16);assert.equal(p.bindings.length,16);
    assert.ok(Object.values(p.topBindings).every(b=>b.type==='default'));
    window.setSize(1080,730);await new Promise(r=>setTimeout(r,150));
    fs.writeFileSync(path.join(dir,'redragon-buttons.png'),(await window.webContents.capturePage()).toPNG());
    let sensitivity={x:2650,y:2650,config:1,stage:0},writes=0,failRead=false;
    hardware.inspectDpi=async()=>{if(failRead)throw Error('Mouse asleep');return {...sensitivity};};
    hardware.applyDpi=async(id,value)=>{
      assert.equal(id,device.id);assert.equal(value.stage,0);assert.equal(value.config,1);
      sensitivity={...validateDpi(value,device.dpi),config:1,stage:0};writes++;return {...sensitivity};
    };
    const input=(selector,value)=>js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('[data-nav="dpi"]');await wait('document.querySelector("#dpi-x")?.value==="2650"');
    assert.equal(await js('document.querySelector("#dpi-x").min'),'50');
    assert.equal(await js('document.querySelector("#dpi-x").max'),'26000');
    assert.equal(await js('document.querySelector("#dpi-x").step'),'50');
    assert.ok(await js('document.querySelector("#content").textContent.includes("Editing onboard DPI stage 1")'));
    await input('#dpi-x','801');await click('#apply-dpi');await wait('document.querySelector("#toast").textContent.includes("increments of 50")');assert.equal(writes,0);
    await click('#dpi-linked');await input('#dpi-x','50');await input('#dpi-y','26000');await click('#apply-dpi');
    await wait('document.querySelector(".dpi-device-value strong").textContent==="50"');
    assert.deepEqual(sensitivity,{x:50,y:26000,config:1,stage:0});
    await click('[data-dpi-preset="1600"]');await click('#apply-dpi');await wait('document.querySelector(".dpi-device-value strong").textContent==="1,600"');
    assert.equal(writes,2);
    await wait('!busy && !state.applying && !document.querySelector("#apply-dpi").disabled');
    assert.ok(await js('document.querySelector("main").scrollWidth<=document.querySelector("main").clientWidth'));
    window.setSize(1380,1000);await new Promise(r=>setTimeout(r,150));
    fs.writeFileSync(path.join(dir,'redragon-dpi.png'),(await window.webContents.capturePage()).toPNG());
    failRead=true;await click('#read-dpi');await wait('document.querySelector("#apply-dpi").disabled && document.querySelector(".dpi-device-value strong").textContent==="—"');
    hardware.devices=async()=>[{...device,dpi:null,modelVerified:false,driver:null,mappingPlates:[],support:'recognition-only'}];
    await js('window.neuron.scan()');await wait('document.querySelector("#content").textContent.includes("DPI unavailable")');
    await click('[data-nav="buttons"]');
    await js('window.neuron.scan()');await wait('document.querySelector("#apply").disabled');
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(dir,'redragon-smoke-result.json'),JSON.stringify({ok:true,buttons:16,dpi:true,simulatedDpiWrites:writes,hardwareWrites:false}));
    console.log('Redragon desktop smoke test passed.');app.quit();
  } catch(error) {fs.writeFileSync(path.join(dir,'redragon-smoke-result.json'),JSON.stringify({ok:false,error:error.stack,errors}));console.error(error);app.exit(1);}
}
module.exports={run};
