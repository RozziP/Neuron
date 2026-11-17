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
    hardware.devices=async()=>[device];
    await js('window.neuron.scan()');
    await click('[data-nav="devices"]');
    await js('(()=>{const el=document.querySelector("#manual-mouse-model");el.value="62813";el.dispatchEvent(new Event("change",{bubbles:true}));document.querySelector("#manual-mouse-form").requestSubmit();})()');
    await wait('document.querySelector("#device-short").textContent==="M990-WL"');
    await click('[data-nav="buttons"]');
    await wait('document.querySelectorAll(".side-control-key").length===16');
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
    hardware.devices=async()=>[{...device,modelVerified:false,driver:null,mappingPlates:[],support:'recognition-only'}];
    await js('window.neuron.scan()');await wait('document.querySelector("#apply").disabled');
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(dir,'redragon-smoke-result.json'),JSON.stringify({ok:true,buttons:16,hardwareWrites:false}));
    console.log('Redragon desktop smoke test passed.');app.quit();
  } catch(error) {fs.writeFileSync(path.join(dir,'redragon-smoke-result.json'),JSON.stringify({ok:false,error:error.stack,errors}));console.error(error);app.exit(1);}
}
module.exports={run};
