let capturingBinding = false, capturedModifiers = new Set();
const modifierOrder = ['Ctrl', 'Shift', 'Alt', 'Win'];
function setBindingKey(value) {
  setSelectedBinding({ type: 'key', value });
  capturingBinding = false; capturedModifiers.clear(); markDirty(); renderButtons();
}
function cancelBindingCapture() {
  if (!capturingBinding) return;
  capturingBinding = false; capturedModifiers.clear();
  if (page === 'buttons') renderButtons();
}
function renderButtons() {
  const control=selectedControl(), b = control.binding;
  $('#content').innerHTML = `
    <div class="mapping-layout">
      <section class="card">
        <div class="card-head"><div><h2>1. Choose a mouse control</h2><p>Razer ${esc(nameOf(draft.model))} · every shape below is editable</p></div><span class="pill ${currentDevice() ? '' : 'muted'}">${currentDevice() ? '● CONNECTED' : 'OFFLINE'}</span></div>
        ${renderControlLayout()}
        <div class="device-toolbar"><label>Attached side plate <select id="plate" aria-label="Side plate">${[2,6,7,12].map(n => `<option value="${n}" ${n === draft.plate ? 'selected' : ''}>${n} buttons</option>`).join('')}</select></label><span>Editing <strong>${esc(selectionName())}</strong></span></div>
      </section>
      <section class="card binding-editor">
        <div class="editor-kicker">2. CHOOSE WHAT IT DOES</div>
        <h2 class="binding-summary" aria-live="polite">${esc(selectionName())}: <span class="binding-value">${esc(labelOf(b))}</span></h2>
        <div class="segmented" role="group" aria-label="Assignment type">${[...(control.top?['default']:[]),'key','mouse','macro','disabled'].map(t => `<button data-type="${t}" class="${b.type === t ? 'active' : ''}">${({key:'Key / modifier',mouse:'Mouse',macro:'Macro',disabled:'Disable',default:'Original'})[t]}</button>`).join('')}</div>
        ${b.type === 'key' ? `
          <button id="capture-binding" class="capture-binding ${capturingBinding ? 'listening' : ''}"><span>${capturingBinding ? 'Listening… press your key or shortcut' : 'Click here, then press a key'}</span><small>${capturingBinding ? 'Release a modifier to use it alone. Escape cancels.' : 'For example: Q, Space, or Ctrl + 1'}</small></button>
          ${capturingBinding ? '<button class="text-button" id="cancel-capture">Cancel recording</button>' : ''}
        ` : b.type === 'default' ? '<p class="help original-help">Keep this control’s original mouse function. Choose Key / modifier, Mouse, or Macro above to change it. Returning to Original restores its backed-up setting.</p>' : b.type === 'mouse' ? `<label class="field"><span>MOUSE FUNCTION</span><select id="binding-mouse">${Object.entries(state.mouseActions).map(([value,a])=>`<option value="${value}" ${b.value===value?'selected':''}>${esc(a.name)}</option>`).join('')}</select></label>` : b.type === 'macro' ? `
          <button class="button" id="binding-macro">Choose macro…</button><p class="help">${esc(macroPlaybackLabel(draft.macros.find(m => m.id === b.value) || {}))}. Keep Neuron open or in the tray.</p>
        ` : '<p class="help">This button will send no input after you apply the profile.</p>'}
      </section>
    </div>
    ${renderKeyboard()}`;
  $('#plate').onchange = e => { cancelBindingCapture(); draft.plate = Number(e.target.value); draft.bindings = Array.from({length:draft.plate},(_,i) => draft.bindings[i] || {type:'key',value:defaults[i]}); selected = Math.min(selected,draft.plate-1); markDirty(); render(); };
  if ($('#capture-binding')) $('#capture-binding').onclick = () => { capturingBinding = true; capturedModifiers.clear(); renderButtons(); $('#capture-binding').focus(); };
  if ($('#cancel-capture')) $('#cancel-capture').onclick = cancelBindingCapture;
  if ($('#binding-macro')) $('#binding-macro').onclick = openMacroPicker;
  if ($('#binding-mouse')) $('#binding-mouse').onchange = e => { selectedControl().binding.value = e.target.value; markDirty(); renderButtons(); };
  wireKeyboard();
}
document.addEventListener('keydown', event => {
  if (!capturingBinding) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (event.key === 'Escape') { cancelBindingCapture(); return; }
  for (const [held, name] of [[event.ctrlKey,'Ctrl'],[event.shiftKey,'Shift'],[event.altKey,'Alt'],[event.metaKey,'Win']]) if (held) capturedModifiers.add(name);
  if (['Control','Shift','Alt','Meta'].includes(event.key)) {
    $('#capture-binding span').textContent = [...capturedModifiers].join(' + ') + ' …'; return;
  }
  const chord = eventChord(event);
  if (chord) { setBindingKey(chord); toast(`${selectionName()} set to ${chord}. Click Save & apply to mouse.`); }
  else $('#capture-binding small').textContent = 'That key is not supported yet. Try another key or Escape to cancel.';
}, true);
document.addEventListener('keyup', event => {
  if (!capturingBinding) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (capturedModifiers.size && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
    const chord = modifierOrder.filter(name => capturedModifiers.has(name)).join('+');
    setBindingKey(chord); toast(`${selectionName()} will hold ${chord}. Click Save & apply to mouse.`);
  }
}, true);
window.addEventListener('blur', cancelBindingCapture);

function openMacroPicker() {
  const dialog = $('#macro-picker'), binding = selectedControl().binding;
  $('#macro-picker-description').textContent = `Assign a saved macro to ${selectionName()}.`;
  $('#macro-picker-list').innerHTML = state.macros.length ? state.macros.map(m => `<button class="macro-list-item ${binding.type === 'macro' && binding.value === m.id ? 'active' : ''}" data-bind-macro="${esc(m.id)}"><strong>${esc(m.name)}</strong><small>${m.steps.length} steps · ${esc(macroPlaybackLabel(m))}</small></button>`).join('') : '<p class="help">No saved macros yet. Create and save a macro in the Macros tab, then choose it here.</p>';
  $('#macro-picker-list').onclick = event => {
    const item = event.target.closest('[data-bind-macro]');
    if (!item || !state.macros.some(m => m.id === item.dataset.bindMacro)) return;
    setSelectedBinding({type:'macro',value:item.dataset.bindMacro});
    dialog.close(); markDirty(); renderButtons();
    $('#binding-macro').focus();
  };
  $('#macro-picker-cancel').onclick = () => dialog.close();
  dialog.showModal();
}
document.addEventListener('click', event => {
  if (capturingBinding && event.target.closest('[data-nav], [data-button], [data-type], #apply')) cancelBindingCapture();
}, true);
