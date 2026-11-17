function mouseModel() { return state.catalog.find(m=>m.productId===draft.model); }
function renderMappingReadback(result) {
  if(!result)return '';
  return `<div class="readback">${result.bindings.map((b,i)=>`<span>${i+1} → ${b.error?'Unavailable':`type ${b.type} / ${b.params.map(n=>'0x'+n.toString(16)).join(' ')}`}</span>`).join('')}</div>${result.controls?`<details class="control-readback" open><summary>All physical controls (${result.controls.length})</summary>${result.controls.map(c=>`<div><b>${esc(c.name)}</b> · ${c.status==='readable'?'Read successfully':c.status==='fixed'?'Fixed function':esc(c.error)}${c.note?` · ${esc(c.note)}`:''}</div>`).join('')}</details>`:''}`;
}
function availableTopControls() { const model=mouseModel(); return model?.controls ? model.controls.filter(c=>c.editable) : model?.topControls ? state.topControls.filter(c=>model.topControls.includes(c.id)) : state.topControls; }
function controlAt(index) {
  if (index < draft.plate) return {index,name:mouseModel()?.sideLabels?.[draft.plate]?.[index]||`Button ${index+1}`,short:draft.plate===4?['LF','LR','RF','RR'][index]:draft.plate===2?['F','R'][index]:String(index+1),binding:draft.bindings[index],top:false};
  const c=availableTopControls()[index-draft.plate];
  return {...c,name:state.catalog.find(m => m.productId === draft.model)?.topLabels?.[c.id] || c.name,index,top:true,binding:draft.topBindings[c.id]};
}
function selectedControl() { selected=Math.max(0,Math.min(selected,draft.plate+availableTopControls().length-1));return controlAt(selected); }
function selectionName() { return selectedControl().name; }
function setSelectedBinding(binding) {
  const c=selectedControl();
  if(c.top) draft.topBindings[c.id]=binding; else draft.bindings[selected]=binding;
}
function renderControlLayout() {
  const button = (c, classes) => `<button class="mouse-key ${classes} ${selected===c.index?'selected':''} ${c.binding.type}" data-button="${c.index}" ${c.top?`data-top-control="${c.id}"`:''} aria-label="Rebind ${esc(c.name)}, currently ${esc(labelOf(c.binding))}" aria-pressed="${selected===c.index}"><b>${esc(c.short)}</b>${c.top?`<span class="control-name">${esc(c.name)}</span>`:''}<small class="key-label">${esc(labelOf(c.binding))}</small></button>`;
  const fixed=mouseModel()?.controls?.filter(c=>!c.editable)||[];
  const incompatible=Object.entries(draft.topBindings).filter(([id,b])=>b.type!=='default'&&!availableTopControls().some(c=>c.id===id));
  // Match the V2 Pro panel's physical positions while retaining each button's
  // binding index and hardware source: top 1–2–3, bottom 6–5–4.
  const sideOrder=draft.plate===6 && [0x00a7,0x00a8,0x00a9].includes(draft.model) ? [0,1,2,5,4,3] : draft.bindings.map((_,i)=>i);
  return `<div class="editable-controls"><section class="control-group" ${draft.plate?'':'hidden'}><div class="plate-label">SIDE BUTTONS</div><div class="side-control-keys" data-plate="${draft.plate}">${sideOrder.map(i=>button(controlAt(i),'side-control-key')).join('')}</div></section><section class="control-group top-control-group" ${availableTopControls().length ? '' : 'hidden'}><div class="plate-label">BODY & WHEEL CONTROLS</div><div class="top-control-keys${draft.model===0x0067?' trinity-wheel-layout':''}">${availableTopControls().map((c,i)=>button(controlAt(draft.plate+i),`top-control-key control-${c.id}`)).join('')}</div></section></div>${fixed.length?`<div class="fixed-controls"><strong>Fixed controls</strong>${fixed.map(c=>`<div><b>${esc(c.name)}</b><span>${esc(c.note)}</span></div>`).join('')}</div>`:''}${incompatible.length?'<div class="section-note">This profile contains assignments for controls that are absent or fixed on this model. <button class="button" id="clear-unavailable-bindings">Reset unavailable controls to Original</button></div>':''}`;
}
async function selectMouseControl(index) {
  if (!Number.isInteger(index) || index < 0 || index >= draft.plate + availableTopControls().length || $('#confirm-dialog').open) return;
  const control = controlAt(index);
  if (control.top && ['left', 'right'].includes(control.id)) {
    cancelBindingCapture();
    const snapshot = draft;
    const confirmation = confirmAction(
      `Rebind ${control.name.toLowerCase()}?`,
      control.id === 'left'
        ? 'Changing this button can stop normal left-click selection after the profile is applied. Assign Left click to another button first. Neuron blocks saving or applying a profile with no Left click assignment.'
        : 'Changing this button can stop right-click menus after the profile is applied. Assign Right click to another button if you still need it.',
      'Continue rebinding'
    );
    $('#confirm-cancel').focus();
    if (!await confirmation || draft !== snapshot || page !== 'buttons') return;
  }
  selected = index; renderButtons();
}
function leftClickRebound(profile) {
  const binding = profile?.topBindings?.left;
  return !!binding && binding.type !== 'default' && !(binding.type === 'mouse' && binding.value === 'left');
}
function leftClickButtons(profile) {
  const model=state.catalog.find(m=>m.productId===profile.model);
  const controls=model?.controls?.filter(c=>c.editable)||state.topControls.filter(c=>!model?.topControls||model.topControls.includes(c.id));
  return [
    ...profile.bindings.map((binding, i) => ({ binding, name: `Button ${i + 1}` })),
    ...controls.map(control => ({ binding: profile.topBindings?.[control.id], name: control.name }))
  ].filter(({ binding }) => binding?.type === 'mouse' && binding.value === 'left').map(({ name }) => name);
}
function updateClickWarning() {
  const messages = [], active = state.active?.profile;
  if (leftClickRebound(draft)) {
    const alternatives = leftClickButtons(draft);
    messages.push(alternatives.length
      ? `“${draft.name}”: after applying, use ${alternatives.join(' or ')} to left-click. The primary button will run its new binding.`
      : `“${draft.name}” has no Left click assignment. You would lose left-click selection. Assign Left click to another button before saving or applying; both are blocked until you do.`);
  }
  if (leftClickRebound(active)) {
    const alternatives = leftClickButtons(active);
    messages.push(`Active now — “${active.name}”: ${alternatives.length ? `use ${alternatives.join(' or ')} to left-click.` : 'normal left-click selection is unavailable.'}`);
  }
  const warning = $('#click-warning'), text = $('#click-warning-text'), message = messages.join('\n');
  if (text.textContent !== message) text.textContent = message;
  warning.hidden = !messages.length;
}
