// Renderer, IPC, durable snapshots and actual quit flow; all binding I/O is simulated.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { mappingCapabilities } = require('../app/drivers.cjs');
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function run(window,app,hardware) {
  const directory=path.dirname(app.getPath('userData')), errors=[], memory=new Map();
  const resultFile=path.join(directory,'onboard-smoke-result.json');
  const js=code=>window.webContents.executeJavaScript(`(async()=>{${code}})()`);
  const wait=async condition=>{for(let i=0;i<100;i++){if(await js(`return ${condition}`))return;await delay(50);}throw new Error(`Timed out: ${condition}`);};
  const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const screenshot=async name=>fs.writeFileSync(path.join(directory,name+'.png'),(await window.webContents.capturePage()).toPNG());
  window.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
  const device={id:'onboard-simulated',vendorId:0x1532,productId:103,name:'Naga Trinity',paths:[],connected:true};
  Object.assign(device,mappingCapabilities(device));
  hardware.devices=async()=>[device];
  hardware.target=async id=>{assert.equal(id,device.id);return device;};
  hardware.read=async(_device,slot,source)=>structuredClone(memory.get(`${slot}:${source}`)||{type:2,params:[0,30]});
  hardware.exchange=async(_path,report)=>{
    assert.equal(report[7],12);
    memory.set(`${report[8]}:${report[9]}`,{type:report[11],params:[...report.subarray(13,13+report[12])]});return [];
  };
  try {
    await wait('!!document.querySelector("#profile-select option")');
    await js('await window.neuron.scan(); const s=await window.neuron.state(); await window.neuron.selectMouse(s.mouseWorkspaces.find(w=>w.deviceId==="onboard-simulated").key);');
    await wait('!document.querySelector("#save-onboard").disabled');
    await js('draft.name="My Trinity";draft.bindings[0]={type:"key",value:"Ctrl+Q"};markDirty();');
    await click('#save-onboard');
    await wait('(await window.neuron.state()).onboard?.name==="My Trinity" && !document.querySelector("#save-onboard").disabled');
    assert.deepEqual(memory.get('1:64'),{type:2,params:[1,20]});
    assert.equal(await js('return dirty'),false);
    await screenshot('onboard');
    window.setSize(1080,730);await delay(200);
    assert.equal(await js('return document.querySelector("main").scrollWidth<=document.querySelector("main").clientWidth'),true);
    assert.equal(await js('const a=document.querySelector("#save-onboard").getBoundingClientRect(),b=document.querySelector("#apply").getBoundingClientRect();return a.right<=b.left || a.bottom<=b.top || b.bottom<=a.top'),true);
    await screenshot('onboard-compact');
    window.webContents.reload();await wait('document.querySelector("#onboard-help").textContent.includes("My Trinity")');
    await js('const s=await window.neuron.state(); const p=structuredClone(s.profiles[0]); p.bindings[0]={type:"key",value:"E"};await window.neuron.apply(s.selectedDeviceId,p);');
    assert.deepEqual(memory.get('1:64'),{type:2,params:[0,8]});
    assert.equal((await js('return (await window.neuron.state()).onboard')).name,'My Trinity');
    await js('const s=await window.neuron.state(); await window.neuron.saveMacros([{id:"test-macro",name:"Test macro",repeat:1,steps:[{type:"key",value:"A"}]}]);draft.bindings[1]={type:"macro",value:"test-macro"};markDirty();');
    assert.equal(await js('return document.querySelector("#save-onboard").disabled'),true);
    assert.equal(await js('try {await window.neuron.saveOnboard(deviceId,draft);return false;}catch(e){return /macro assignments/.test(e.message);}'),true);
    await js('draft.bindings[1]={type:"key",value:"2"};markDirty();');
    await js('await window.neuron.restore(deviceId)');
    assert.equal(await js('return (await window.neuron.state()).onboard'),null);
    assert.deepEqual(memory.get('1:64'),{type:2,params:[0,30]});
    await js('draft.bindings[0]={type:"key",value:"Ctrl+Q"};markDirty();');
    await click('#save-onboard');await wait('!document.querySelector("#save-onboard").disabled && !!(await window.neuron.state()).onboard');
    // Switching workspaces uses the same release path as updates and quitting.
    await js('await window.neuron.preferMouseModel(0x008f)');
    assert.equal(await js('return document.querySelector("#save-onboard").hidden'),true);
    assert.deepEqual(memory.get('1:64'),{type:2,params:[1,20]});
    await js('const s=await window.neuron.state();await window.neuron.selectMouse(s.mouseWorkspaces.find(w=>w.deviceId==="onboard-simulated").key);');
    await js('const p=structuredClone(draft);p.bindings[0]={type:"key",value:"E"};await window.neuron.apply(deviceId,p);');
    assert.deepEqual(errors,[]);
    const restore=hardware.restore.bind(hardware);
    hardware.restore=async(id,options)=>{
      try {
        assert.equal(options.useOnboard,true);
        const result=await restore(id,options);
        assert.deepEqual(memory.get('1:64'),{type:2,params:[1,20]});
        fs.writeFileSync(resultFile,JSON.stringify({ok:true,quitRestoredOnboard:true,physicalWrites:false,errors}));
        return result;
      }catch(error){fs.writeFileSync(resultFile,JSON.stringify({ok:false,error:error.stack}));app.exit(1);throw error;}
    };
    app.quit();
  } catch(error) {
    await screenshot('onboard-failure');fs.writeFileSync(resultFile,JSON.stringify({ok:false,error:error.stack,errors}));console.error(error);app.exit(1);
  }
}
module.exports={run};
