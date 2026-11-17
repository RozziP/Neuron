const topControls = [
  {id:'left',name:'Left click',short:'L',source:0x01},
  {id:'right',name:'Right click',short:'R',source:0x02},
  {id:'middle',name:'Wheel click',short:'M',source:0x03},
  {id:'wheel-up',name:'Scroll up',short:'↑',source:0x09},
  {id:'wheel-down',name:'Scroll down',short:'↓',source:0x0a},
  {id:'tilt-left',name:'Wheel tilt left',short:'←',source:0x34},
  {id:'tilt-right',name:'Wheel tilt right',short:'→',source:0x35},
  {id:'dpi-up',name:'DPI up',short:'+',source:0x0b},
  {id:'dpi-down',name:'DPI down',short:'−',source:0x0c}
];
for(const [id,[name,short]] of Object.entries(require('./razer-layouts.cjs').defs))
  if(!topControls.some(c=>c.id===id))topControls.push({id,name,short});
const mouseActions = {
  left:{name:'Left click',type:1,params:[1]}, right:{name:'Right click',type:1,params:[2]},
  middle:{name:'Middle click',type:1,params:[3]}, back:{name:'Back',type:1,params:[4]},
  forward:{name:'Forward',type:1,params:[5]}, 'wheel-up':{name:'Scroll up',type:1,params:[9]},
  'wheel-down':{name:'Scroll down',type:1,params:[10]}, 'dpi-up':{name:'DPI up',type:6,params:[1]},
  'dpi-down':{name:'DPI down',type:6,params:[2]}
};
const defaultTopBindings = () => Object.fromEntries(topControls.map(c=>[c.id,{type:'default',value:''}]));
function macroTriggers(profile) {
  const all = [...profile.bindings,...topControls.map(c=>profile.topBindings?.[c.id]).filter(Boolean)];
  const ids = [...new Set(all.filter(b=>b.type==='macro').map(b=>b.value))];
  if(ids.length > 12) throw new Error('A profile can use up to 12 distinct macros across its mouse buttons.');
  return ids.map((id,i)=>({id,key:`F${13+i}`,hid:0x68+i}));
}
module.exports={topControls,mouseActions,defaultTopBindings,macroTriggers};
