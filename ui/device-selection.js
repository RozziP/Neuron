const receiverModelDrafts = new Map();
let manualModelDraft = null;
const profileModelOf = device => device.modelId ?? device.productId;
function mouseModelOptions(selected, unknown = false) {
  return `${unknown ? '<option value="">Choose a mouse model</option>' : ''}${state.catalog.map(m => `<option value="${m.productId}" ${m.productId === selected ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}`;
}
function manualMousePanel() {
  return `<section class="card"><div class="card-head"><div><h2>Select your mouse</h2><p>Choose any catalog model, including when automatic detection is unavailable.</p></div></div><form id="manual-mouse-form" class="manual-mouse-form"><label class="field"><span>MOUSE MODEL FOR PROFILES</span><select id="manual-mouse-model">${mouseModelOptions(state.selectedMouse?.model)}</select></label><button class="button" type="submit">Use this mouse</button><p class="help">Adds or opens this mouse’s workspace. Its profiles and macros stay separate from your other mice.</p></form></section>`;
}
function receiverModelPanel(device) {
  const selectedModel = receiverModelDrafts.has(device.id) ? receiverModelDrafts.get(device.id) : device.modelId;
  return `<form class="receiver-model-form manual-mouse-form" data-device-id="${esc(device.id)}"><label class="field"><span>WHICH MOUSE IS PAIRED WITH THIS ${device.connection === 'dock' ? 'DOCK' : 'RECEIVER'}</span><select class="receiver-model">${mouseModelOptions(selectedModel, true)}</select></label><button class="button" type="submit">Save mouse choice</button>${device.modelSource === 'manual' ? '<button class="button ghost reset-mouse-choice" type="button">Clear choice</button>' : ''}<p class="help">Saved on this computer for this connection. Neuron uses a driver only for supported model and connection combinations. For a model outside this list, enter its brand and model in mouse identification.</p></form>`;
}
async function useMouseModel(model, preferredId) {
  const known=state.mouseWorkspaces.find(w=>w.model===model && (!preferredId || w.deviceId===preferredId));
  if(known?.key===state.selectedMouse?.key)return;
  await changeMouse(()=>known ? api.selectMouse(known.key) : api.preferMouseModel(model));
}
const mouseProfileSelections = new Map();
let switchingMouse = false;
function revealSelectedMouse() {
  const list=$('#mouse-list'),selected=list.querySelector('[aria-pressed="true"]');
  if(selected){const item=selected.getBoundingClientRect(),bounds=list.getBoundingClientRect();if(item.bottom>bounds.bottom)list.scrollTop+=item.bottom-bounds.bottom;else if(item.top<bounds.top)list.scrollTop-=bounds.top-item.top;}
}
new ResizeObserver(revealSelectedMouse).observe(document.querySelector('#mouse-list'));
async function changeMouse(action) {
  if(switchingMouse || busy || state.applying || dpiReading)return;
  if((dirty || macroDirty) && !await confirmAction('Discard unsaved edits?', 'Switching mice will discard unsaved profile and macro edits for this mouse.', 'Discard edits'))return;
  if(draft)mouseProfileSelections.set(state.selectedMouse.key,draft.id);
  switchingMouse=true;renderMouseSidebar();
  try { acceptState(await action());manualModelDraft=null;render();if(page==='dpi')await readMouseDpi(); }
  finally {switchingMouse=false;renderMouseSidebar();}
  return true;
}
function renderMouseSidebar() {
  const items=state.mouseWorkspaces || [];
  const list=$('#mouse-list'),scroll=list.scrollTop;
  $('#mouse-list').innerHTML=items.map(mouse=>`<div class="mouse-workspace-row"><button class="device-card mouse-workspace ${mouse.key===state.selectedMouse?.key?'selected':''}" data-mouse-key="${esc(mouse.key)}" aria-pressed="${mouse.key===state.selectedMouse?.key}" ${switchingMouse||busy||state.applying||dpiReading?'disabled':''}><span class="device-mini">◈</span><span><strong>${esc(mouse.name)}</strong><small>${mouse.model===null?'Identify mouse':mouse.connected?'Connected':'Offline · saved profiles'}</small></span><span class="status-dot ${mouse.connected?'':'offline'}"></span></button></div>`).join('');
  document.querySelectorAll('[data-mouse-key]').forEach(button=>button.onclick=()=>button.dataset.mouseKey===state.selectedMouse?.key?undefined:act(()=>changeMouse(()=>api.selectMouse(button.dataset.mouseKey))));
  renderHardwareIdentification();
  list.scrollTop=scroll;
  requestAnimationFrame(revealSelectedMouse);
}
function updateEmptyHeader() {
  renderMouseSidebar();
  $('#content').inert=busy || state.applying;
  $('#workspace-mouse').textContent=state.selectedMouse?.name || 'Workspace';
  $('#device-short').textContent=state.selectedMouse?.name || 'Select a mouse';
  $('#device-status').textContent='Identify this mouse to create profiles';
  $('#page-title').innerHTML=`${esc(pages[page][0])}<span>.</span>`;$('#breadcrumb').textContent=pages[page][0];
  $('#page-subtitle').hidden=true;$('#eyebrow').hidden=true;$('.head-actions').hidden=true;
  $('#profile-select').replaceChildren();$('#macro-count').textContent='0';
  $('#onboard-help').hidden=true;$('#save-onboard').hidden=true;$('#click-warning').hidden=true;$('#notice').hidden=true;$('#runtime-status').textContent='No profiles for this mouse yet';
  document.querySelectorAll('nav [data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===page));
}
function renderEmptyWorkspace() {
  updateEmptyHeader();
  const device=currentDevice();
  $('#content').innerHTML=page==='devices' ? manualMousePanel()+(device?.connection?`<section class="card receiver-device"><div class="card-head"><div><h2>${esc(device.name)}</h2><p>USB ${device.vendorId.toString(16).padStart(4,'0').toUpperCase()}:${device.productId.toString(16).padStart(4,'0').toUpperCase()} · Paired mouse model is unknown</p></div></div>${receiverModelPanel(device)}</section>`:'') : `<section class="card empty"><h2>${esc(state.selectedMouse?.name || 'Select a mouse')}</h2><p>Identify this mouse on Devices to create its own profiles. Profiles from your other mice stay in their workspaces.</p><button class="button" data-nav="devices">Identify this mouse</button></section>`;
  if(page==='devices') {
    $('#content').insertAdjacentHTML('afterbegin','<div class="page-tools"><p>Choose the model for this mouse to create profiles.</p><button class="button" id="scan-devices">Scan devices</button></div>');
    $('#scan-devices').onclick=()=>act(async()=>acceptState(await api.scan()));
    bindMouseSelection();
  }
}
function bindMouseSelection() {
  if (manualModelDraft !== null) $('#manual-mouse-model').value = manualModelDraft;
  $('#manual-mouse-model').onchange = event => { manualModelDraft = event.target.value; };
  $('#manual-mouse-form').onsubmit = event => {
    event.preventDefault(); void act(() => useMouseModel(Number($('#manual-mouse-model').value)));
  };
  document.querySelectorAll('.receiver-model-form').forEach(form => {
    const id = form.dataset.deviceId, select = form.querySelector('.receiver-model');
    select.onchange = () => receiverModelDrafts.set(id, select.value ? Number(select.value) : null);
    form.onsubmit = event => {
      event.preventDefault();
      void act(async () => {
        if (!select.value) throw new Error('Choose the mouse paired with this connection.');
        const model = Number(select.value);
        if(await changeMouse(()=>api.selectDeviceModel(id, model))) {receiverModelDrafts.delete(id);toast('Mouse choice saved on this computer.');}
      });
    };
    form.querySelector('.reset-mouse-choice')?.addEventListener('click', () => void act(async () => {
      if(await changeMouse(()=>api.selectDeviceModel(id, null))) {receiverModelDrafts.delete(id);render();toast('Mouse choice cleared.');}
    }));
  });
}
