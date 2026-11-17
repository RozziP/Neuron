function controlAt(index) {
  if (index < draft.plate) return {index,name:`Button ${index+1}`,short:String(index+1),binding:draft.bindings[index],top:false};
  const c=state.topControls[index-draft.plate];
  return {...c,index,top:true,binding:draft.topBindings[c.id]};
}
function selectedControl() { return controlAt(selected); }
function selectionName() { return selectedControl().name; }
function setSelectedBinding(binding) {
  const c=selectedControl();
  if(c.top) draft.topBindings[c.id]=binding; else draft.bindings[selected]=binding;
}
function renderControlLayout() {
  const button = (c, classes) => `<button class="mouse-key ${classes} ${selected===c.index?'selected':''} ${c.binding.type}" data-button="${c.index}" ${c.top?`data-top-control="${c.id}"`:''} aria-label="Rebind ${esc(c.name)}, currently ${esc(labelOf(c.binding))}" aria-pressed="${selected===c.index}"><b>${esc(c.short)}</b>${c.top?`<span class="control-name">${esc(c.name)}</span>`:''}<small class="key-label">${esc(labelOf(c.binding))}</small></button>`;
  return `<div class="editable-controls"><section class="control-group"><div class="plate-label">SIDE KEYPAD</div><div class="side-control-keys" data-plate="${draft.plate}">${draft.bindings.map((_,i)=>button(controlAt(i),'side-control-key')).join('')}</div></section><section class="control-group top-control-group"><div class="plate-label">TOP CONTROLS</div><div class="top-control-keys">${state.topControls.map((c,i)=>button(controlAt(draft.plate+i),`top-control-key control-${c.id}`)).join('')}</div></section></div>`;
}
async function selectMouseControl(index) {
  if (!Number.isInteger(index) || index < 0 || index >= draft.plate + state.topControls.length || $('#confirm-dialog').open) return;
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
  return [
    ...profile.bindings.map((binding, i) => ({ binding, name: `Button ${i + 1}` })),
    ...state.topControls.map(control => ({ binding: profile.topBindings?.[control.id], name: control.name }))
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
