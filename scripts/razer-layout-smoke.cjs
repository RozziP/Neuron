// Offline renderer QA using the real preload and UI. No HID or network calls.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {catalog}=require('../app/catalog.cjs');
const {newProfile}=require('../app/store.cjs');
const {topControls,mouseActions}=require('../app/controls.cjs');
const output=path.resolve(__dirname,'../artifacts/razer-layout-smoke');
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'user-data'));
const profile=newProfile();
const initial={profiles:[profile],macros:[],devices:[],hardwareReports:[],catalog,topControls,mouseActions,active:null,applying:false,auto:false,error:''};
initial.selectedMouse={key:'offline-test',model:profile.model,name:'Razer Naga Trinity',deviceId:null,connected:false};
initial.mouseWorkspaces=[initial.selectedMouse];initial.selectedDeviceId=null;
function selectFixture(profile) {
  const model=catalog.find(m=>m.productId===profile.model);
  return `state.profiles=[${JSON.stringify(profile)}];state.selectedMouse={key:'offline-test',model:${profile.model},name:${JSON.stringify(model.name)},deviceId:null,connected:false};state.mouseWorkspaces=[state.selectedMouse];setDraft(state.profiles[0]);`;
}
ipcMain.handle('state:get',()=>({ok:true,result:initial}));
ipcMain.handle('updates:get',()=>({ok:true,result:{currentVersion:'test',status:'idle'}}));
const failures=[];
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:1380,height:900,show:false,webPreferences:{preload:path.resolve(__dirname,'../app/preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.on('console-message',e=>{if(e.level==='error')failures.push(e.message);});
  const js=code=>win.webContents.executeJavaScript(code);
  try {
    await win.loadFile(path.resolve(__dirname,'../ui/index.html'));
    for(let i=0;i<100 && !await js('!!document.querySelector(".mouse-key")');i++)await new Promise(r=>setTimeout(r,30));
    let cases=0;
    for(const width of [1380,1080]) {
      win.setSize(width,width===1080?730:900);
      for(const model of catalog.filter(m=>m.vendorId===0x1532))for(const plate of model.physicalPlates) {
        const p=newProfile('Layout test',model.productId,plate);
        const result=await js(`(()=>{${selectFixture(p)}page='buttons';render();
          const nodes=[...document.querySelectorAll('.mouse-key')];
          const boxes=nodes.map(n=>n.getBoundingClientRect());
          const overlap=boxes.some((a,i)=>boxes.some((b,j)=>j>i&&a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1));
          const labels=nodes.map(n=>n.getAttribute('aria-label'));
          const count=nodes.length,fixed=document.querySelectorAll('.fixed-controls>div').length;
          const options=[...document.querySelector('#plate').options].map(o=>Number(o.value));
          const overflow=document.querySelector('main').scrollWidth>document.querySelector('main').clientWidth;
          for(let i=0;i<count;i++){selected=i;renderButtons();if(!document.querySelector('.binding-summary').textContent.includes(selectionName()))throw new Error('Wrong editor control');}
          return {count,fixed,overlap,overflow,options,labels};})()`);
        assert.equal(result.count,plate+model.controls.filter(c=>c.editable).length,model.name);
        assert.equal(result.fixed,model.controls.filter(c=>!c.editable).length,model.name);
        assert.deepEqual(result.options,model.physicalPlates,model.name);
        assert.equal(result.overlap,false,`${model.name}: overlapping buttons at ${width}px`);
        assert.equal(result.overflow,false,`${model.name}: horizontal overflow at ${width}px`);
        assert.ok(result.labels.every(s=>s&&!s.includes('undefined')),model.name);cases++;
      }
      for(const pid of [0x0067,0x00e8,0x00a8,0x007b,0x00b9,0x006b]) {
        const model=catalog.find(m=>m.productId===pid),p=newProfile('Layout preview',pid,model.buttons);
        await js(`${selectFixture(p)}page='buttons';render();document.querySelector('main').scrollTop=0;`);
        await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
        fs.writeFileSync(path.join(output,`${pid.toString(16)}-${width}.png`),(await win.webContents.capturePage()).toPNG());
      }
    }
    assert.deepEqual(failures,[]);
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,cases},null,2));
    console.log(`Razer layout smoke passed: ${cases} model/plate/size combinations.`);app.exit(0);
  }catch(error){fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:false,error:error.stack,failures},null,2));console.error(error);app.exit(1);}
});
