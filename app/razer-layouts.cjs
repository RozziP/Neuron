// Physical layouts and candidate USB button sources. These are independently
// expressed protocol facts/family estimates, not upstream application code.
// References and confidence boundaries are in docs/razer-drivers.md.
const devices = require('./razer-devices.json');
const base = {left:1, right:2, middle:3, 'wheel-up':9, 'wheel-down':10};
const tilt = {'tilt-left':52, 'tilt-right':53};
const dpiPair = {'dpi-up':12, 'dpi-down':11};
const dpiCycle = {'dpi-cycle':96};
const profile = {'profile-cycle':14};
const defs = {
  left:['Left click','L'], right:['Right click','R'], middle:['Wheel click','M'],
  'wheel-up':['Scroll up','↑'], 'wheel-down':['Scroll down','↓'],
  'tilt-left':['Wheel tilt left','←'], 'tilt-right':['Wheel tilt right','→'],
  'dpi-up':['DPI up','+'], 'dpi-down':['DPI down','−'], 'dpi-cycle':['DPI cycle','DPI'],
  'profile-cycle':['Profile button','P'], 'wheel-mode':['Wheel mode','Mode'],
  clutch:['Sensitivity clutch','Clutch'], 'right-back':['Right-side rear','RB'],
  'right-forward':['Right-side front','RF'], pinky:['Pinky button','Pinky'],
  'scroll-front':['Front scroll button','SF'], 'scroll-rear':['Rear scroll button','SR'],
  'thumb-paddle':['Thumb paddle','Thumb'], 'side-front':['Extra front side button','Front'],
  'grip-left':['Left grip trigger','GL'], 'grip-right':['Right grip trigger','GR'],
  'smart-action':['AI / shortcut button','AI']
};
const layouts = new Map();
function add(ids, side, extra={}, options={}) {
  for(const pid of ids) layouts.set(pid, {plates:[side], side, top:{...base,...extra},
    fixed:[], validation:'best-guess', transaction:pid<0x0060?0xff:0x1f, ...options});
}
// Three-button mice; the two scroll directions are actions, not extra switches.
add([0x0020],0,{}, {fixed:[{id:'hardware-dpi',name:'Underside DPI / polling switch',note:'Hardware switch; not a remappable button.'}]});
add([0x0042,0x005e,0x006a,0x006b],0);
add([0x005b],0,dpiCycle);
// Conventional five-button mice without a separate DPI switch.
add([0x0016,0x0029,0x0037,0x0038,0x0043,0x004f,0x0054,0x005f,0x006e,0x0071,0x0098],2);
add([0x0062,0x0083,0x008a,0x008c,0x0094,0x0095,0x009e,0x009f,0x00a3,0x00a5,0x00a6,0x00b2,0x00b6,0x00b7,0x00b8,0x00be,0x00bf,0x00c0,0x00c1,0x00c2,0x00c3,0x00c4,0x00c5,0x00da,0x00db,0x00de,0x00df,0x00e0,0x00e5,0x00e6],2,dpiCycle);
add([0x0024,0x0025,0x002f,0x005c,0x0072,0x0073,0x0084,0x009c,0x00a1],2,dpiPair);
add([0x007c,0x007d,0x00af,0x00b0],2,{...dpiPair,...profile});
add([0x0044,0x0045,0x0046,0x006c],2,{...tilt,...dpiPair});
// Ambidextrous mice have two physical side buttons on each side.
add([0x0013,0x0039,0x0048,0x004c],4);
add([0x0034,0x0059,0x005a,0x0060,0x006f,0x0070],4,dpiPair);
add([0x0078,0x007a,0x007b,0x0091],4,dpiCycle);
add([0x0032],4,{...dpiPair,'grip-left':15,'grip-right':16});
// Office mice, including wheel-mode toggles which firmware handles itself.
add([0x0077,0x0080],2,{...tilt,...dpiCycle});
add([0x009a],2,tilt,{fixed:[{id:'wheel-mode',name:'Wheel mode toggle',note:'Mechanical wheel-mode toggle.'}]});
const connectivity={id:'connectivity',name:'Connectivity / pairing button',note:'Hardware connection control; not a remappable input.'};
add([0x00c7,0x00c8],2,{'smart-action':128},{fixed:[connectivity]});
add([0x00d0,0x00d1],2,tilt,{labels:{middle:'Wheel click / AI long press'},fixed:[connectivity,{id:'wheel-mode',name:'Wheel mode toggle',note:'Firmware wheel-mode control; remapping is not established.'}]});
add([0x00d3,0x00d4],2,{...tilt,'smart-action':128},{fixed:[connectivity,{id:'wheel-mode',name:'Wheel mode toggle',note:'Firmware wheel-mode control; remapping is not established.'}]});
// Basilisk: older two-DPI-button models differ from the V3 wheel-mode layout.
add([0x0064],2,{...dpiPair,clutch:15});
add([0x0065],2,{...dpiCycle,clutch:15});
add([0x0085,0x0086,0x0088],2,{...tilt,...dpiPair,clutch:15,...profile});
add([0x0099,0x00aa,0x00ab,0x00ac,0x00cb,0x00cc,0x00cd,0x00d6,0x00d7,0x00d8],2,{...tilt,...dpiCycle,clutch:15}, {
  validation:'community-protocol', fixed:[
    {id:'wheel-mode',name:'Wheel mode toggle',source:14,note:'Built-in wheel-mode control; remapping is unavailable.'},
    {id:'profile-cycle',name:'Underside profile button',source:106,note:'Keeps its built-in profile function; reliable remapping is unavailable.'}]});
add([0x00b9,0x00ba],2,dpiCycle,{readLayout:'layer-or-compact',validation:'community-protocol',fixed:[{id:'clutch',name:'Hypershift / thumb button',source:6,note:'Keeps its built-in function; this control cannot be remapped here.'}]});
add([0x00ea,0x00eb,0x00ec],2,{...tilt,'thumb-paddle':57,'side-front':128,...profile},{validation:'community-protocol'});
// Naga side panels are separate source ranges. Never infer a six-button ring
// or a two-button panel from the twelve-button grid.
add([0x0015,0x001f,0x002e],12,{'dpi-up':11,'dpi-down':12});
add([0x0036,0x0041],6,{'dpi-up':11,'dpi-down':12});
add([0x003e,0x003f,0x0040,0x0053],12,{...tilt,...dpiPair});
add([0x008d],12,{...tilt,...dpiPair},{fixed:[{id:'profile-cycle',name:'Underside profile button',note:'Hardware profile selection; remapping is not established for this model.'}]});
add([0x0050],7,{...tilt,...dpiPair});
add([0x0096],12,dpiCycle);
add([0x0067],12,{...tilt,'dpi-up':11,'dpi-down':12},{plates:[2,7,12],validation:'locally-tested',slots:[2,1],readSlot:1});
add([0x008f,0x0090,0x0092],12,{...tilt,...dpiPair,...profile},{plates:[2,6,12],validation:'community-protocol'});
// V2 Pro capture validates live writes/restoration on 0x6D and 0x60 even
// though the reference application's UI still labels them read-only.
add([0x00a7,0x00a8,0x00a9],12,{...tilt,'dpi-up':109,'dpi-down':96,...profile},{plates:[2,6,12],validation:'community-protocol',
  labels:{'dpi-up':'Scroll mode button (front)','dpi-down':'DPI cycle button (rear)'}});
add([0x00b4],12,{...tilt,'dpi-up':11,'dpi-down':12},{slots:[1,0],validation:'community-protocol',labels:{'dpi-up':'Index button (front)','dpi-down':'Index button (rear)'}});
add([0x00e7,0x00e8,0x00e9],12,{...tilt,'dpi-up':11,'dpi-down':12,pinky:57,'scroll-front':106,'scroll-rear':128,...profile},{plates:[2,6,12],validation:'community-protocol',labels:{'dpi-up':'Index button (front)','dpi-down':'Index button (rear)'}});
// Only the V4 Pro's 80-byte button requests are capture-backed here.
for(const pid of [0x00be,0x00bf]) Object.assign(layouts.get(pid),{requestSize:80,validation:'community-protocol'});
for(const pid of [0x007a,0x007b]) Object.assign(layouts.get(pid),{slots:[1,0],validation:'community-protocol'});
function layoutFor(pid) { return layouts.get(pid); }
function controlsFor(pid) {
  const layout=layoutFor(pid); if(!layout)return [];
  const controls=Object.entries(layout.top).map(([id,source])=>({id,source,name:layout.labels?.[id]||defs[id][0],short:defs[id][1],editable:true}));
  return [...controls,...layout.fixed.map(c=>({...c,short:defs[c.id]?.[1]||'Fixed',editable:false}))];
}
function sideIds(layout,plate) {
  if(!layout?.plates.includes(plate))throw new Error('This driver does not support the selected side plate.');
  if(plate===0)return [];
  if(plate===2)return [5,4];
  if(plate===4)return [5,4,7,6];
  return Array.from({length:plate},(_,i)=>(plate===12?64:80)+i);
}
function sideLabels(plate) {
  if(plate===2)return ['Side front','Side rear'];
  if(plate===4)return ['Left side front','Left side rear','Right side front','Right side rear'];
  return Array.from({length:plate},(_,i)=>`Button ${i+1}`);
}
for(const d of devices) if(!layouts.has(d.productId))throw new Error(`Missing Razer layout: ${d.name}`);
module.exports={devices,layouts,layoutFor,controlsFor,sideIds,sideLabels,defs};
