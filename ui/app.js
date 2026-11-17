const api = window.neuron;
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const defaults = ['1','2','3','4','5','6','7','8','9','0','-','='];
let state, draft, page = 'buttons', renderedPage, selected = 0, selectedMacro = null, dirty = false, deviceId = null, busy = false, toastTimer, recording = false, lastRecord = 0, readback = null;
let macroDraft = [], macroDirty = false;
const pages = {
  dpi: ['DPI', '', 'Find the sensitivity that feels right.'],
  buttons: ['Button mapping', '', 'Choose a button, pick a key or modifier, then save & apply.'],
  macros: ['Macros', '', 'Turn a sequence of keystrokes into a single click.'],
  profiles: ['Profiles', '', ''],
  devices: ['Your devices', '', '']
};
function toast(message, error = false) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').className = error ? 'error' : ''; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, error ? 9000 : 4500); }
async function act(fn) { try { return await fn(); } catch(error) { toast(error.message, true); return undefined; } }
function confirmAction(title, text, label = 'Continue') {
  return new Promise(resolve => {
    const dialog = $('#confirm-dialog'); $('#confirm-title').textContent = title; $('#confirm-text').textContent = text; $('#confirm-ok').textContent = label;
    $('#confirm-ok').onclick = () => { dialog.close(); resolve(true); };
    $('#confirm-cancel').onclick = () => { dialog.close(); resolve(false); };
    dialog.oncancel = () => resolve(false); dialog.showModal();
  });
}
function currentDevice() { return state.devices.find(d => d.id === deviceId && d.productId === draft.model); }
function nameOf(model) { return state.catalog.find(d => d.productId === model)?.name || 'Naga'; }
function labelOf(binding) { return binding.type === 'macro' ? draft.macros.find(m => m.id === binding.value)?.name || 'Choose macro' : binding.type === 'disabled' ? 'Disabled' : binding.type === 'default' ? 'Original' : binding.type === 'mouse' ? state.mouseActions[binding.value].name : binding.value; }
function markMacroDirty() { macroDirty=true; updateHeader(); if($('#save-macros'))$('#save-macros').textContent='Save macros •'; }
async function saveMacros() { recording=false; macroDraft=await api.saveMacros(macroDraft); macroDirty=false; syncSharedMacros(); render(); toast('Macros saved to your shared library.'); }
function syncSharedMacros() {
  if(!draft)return; draft.macros=structuredClone(state.macros);
  const ids=new Set(state.macros.map(m=>m.id));
  draft.bindings=draft.bindings.map((b,i)=>b.type==='macro'&&!ids.has(b.value)?{type:'key',value:defaults[i]}:b);
  for(const [id,b] of Object.entries(draft.topBindings))if(b.type==='macro'&&!ids.has(b.value))draft.topBindings[id]={type:'default',value:''};
}
function markDirty() { dirty = true; updateHeader(); }
function updateHeader() {
  const meta = pages[page], device = currentDevice();
  updateClickWarning();
  $('#page-title').innerHTML = `${esc(meta[0])}<span>.</span>`; $('#breadcrumb').textContent = meta[0]; $('#eyebrow').hidden = true; $('#page-subtitle').textContent = meta[2]; $('#page-subtitle').hidden = !meta[2];
  document.querySelectorAll('nav [data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === page));
  $('#profile-select').innerHTML = state.profiles.map(p => `<option value="${esc(p.id)}" ${p.id === draft.id ? 'selected' : ''}>${esc(p.id === draft.id ? draft.name : p.name)}${dirty && p.id === draft.id ? ' •' : ''}</option>`).join('');
  $('#macro-count').textContent = macroDraft.length;
  $('.head-actions').hidden = page === 'macros' || page === 'dpi';
  document.querySelector('[data-nav="buttons"]').classList.toggle('parent-active',page==='profiles');
  $('#save-mapping').disabled=busy || state.applying;
  $('#save-mapping').textContent=dirty?'Save profile •':'Save profile';
  $('#device-short').textContent = nameOf(draft.model); $('#device-status').textContent = device ? 'Connected via USB' : 'Not connected'; $('#device-dot').className = `status-dot ${device ? '' : 'offline'}`;
  const available = device && draft.model === 0x0067 && [7,12].includes(draft.plate);
  $('#content').inert = busy || state.applying;
  if (page === 'dpi') updateDpiControls();
  $('#profile-select').disabled = busy || state.applying;
  $('#apply').disabled = busy || state.applying || !available;
  $('#apply').innerHTML = busy || state.applying ? 'Working…' : 'Save & apply to mouse <span>↗</span>';
  const activeProfile = state.active && state.profiles.find(p => p.id === state.active.profileId);
  $('#runtime-status').textContent = activeProfile ? `${activeProfile.name} is running${state.auto ? ' · Auto-switch on' : ''} · Close to keep in tray` : 'Profiles saved on this computer · No profile applied';
  const notice = $('#notice');
  let message = state.error || '';
  if (!message && !device) message = 'Profile editing is available offline. Connect a matching Naga to apply supported mappings.';
  if (!message && device && !available) message = 'This Naga is recognized. Its hardware mapping driver is pending verification; you can prepare profiles and macros now.';

  notice.textContent = message; notice.hidden = !message || (['macros','dpi'].includes(page) && !state.error);
}
function macroPlaybackLabel(macro) {
  const mode = macro.repeatMode ?? (macro.repeat === 1 ? 'once' : 'count');
  return ({once:'Once per press',count:`${macro.repeat}× per press`,toggle:'Toggle on / off',held:'Continuous while held'})[mode];
}
function renderMacros() {
  let macro = macroDraft.find(m => m.id === selectedMacro) || macroDraft[0]; if (macro) selectedMacro = macro.id;
  $('#content').innerHTML = `<div class="page-tools"><p></p><div class="tool-actions"><button class="button" id="save-macros">${macroDirty?'Save macros •':'Save macros'}</button><button class="button primary" id="new-macro">+ New macro</button></div></div>${!macro ? `<section class="card empty"><div class="empty-icon">ϟ</div><h2>Make your first move.</h2><p>Build a sequence of keys and delays, then assign it to any side button. Macros are shared across all button mappings.</p><button class="button" id="first-macro">Create a macro</button></section>` : `<div class="macro-layout"><section class="card macro-list">${macroDraft.map(m => `<button class="macro-list-item ${macro.id === m.id ? 'active' : ''}" data-macro="${esc(m.id)}"><strong>ϟ &nbsp; ${esc(m.name)}</strong><small>${m.steps.length} steps · ${esc(macroPlaybackLabel(m))}</small></button>`).join('')}</section><section class="card"><div class="card-head"><div><h2>Sequence editor</h2><p>Each key step presses and releases a shortcut.</p></div><button class="text-button" id="delete-macro">Delete macro</button></div><div class="macro-editor"><div class="macro-meta"><label class="field"><span>MACRO NAME</span><input id="macro-name" maxlength="60" value="${esc(macro.name)}"></label><label class="field"><span>PLAYBACK</span><select id="macro-repeat-mode">${Object.entries({once:'Do once',count:'Do X times',toggle:'Toggle (repeat indefinitely)',held:'Continuous while held'}).map(([value,label]) => `<option value="${value}" ${(macro.repeatMode ?? (macro.repeat === 1 ? 'once' : 'count')) === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><div id="macro-repeat-settings"><label class="field" id="macro-repeat-field" ${(macro.repeatMode ?? (macro.repeat === 1 ? 'once' : 'count')) === 'count' ? '' : 'hidden'}><span>NUMBER OF TIMES</span><input id="macro-repeat" type="number" min="1" step="1" max="9007199254740991" value="${macro.repeat}"></label><p class="help" id="macro-playback-help"></p></div><div class="steps">${macro.steps.map((s,i) => `<div class="step"><span class="step-index">${String(i+1).padStart(2,'0')}</span><span class="step-kind">${s.type === 'key' ? '⌨ KEY' : '◷ DELAY'}</span><input data-step="${i}" aria-label="${s.type === 'key' ? 'Key chord' : 'Delay in milliseconds'} ${i+1}" ${s.type === 'delay' ? 'type="number" min="10" max="10000"' : 'maxlength="80"'} value="${esc(s.type === 'key' ? s.value : s.ms)}">${s.type === 'delay' ? '<span class="muted">ms</span>' : ''}<button class="icon-button" data-up="${i}" aria-label="Move step ${i+1} up" ${i === 0 ? 'disabled' : ''}>↑</button><button class="icon-button" data-remove="${i}" aria-label="Remove step ${i+1}">×</button></div>`).join('')}</div><div class="record-bar"><button class="button" id="add-key">+ Key press</button><button class="button" id="add-delay">+ Delay</button><button class="button ${recording ? 'recording' : ''}" id="record">${recording ? '■ Stop recording' : '● Record keys'}</button></div><div class="record-note">${recording ? 'Recording keystrokes in this window. Press Escape to finish. Timing between keystrokes is captured.' : 'Assign this macro in Button mapping → Macro. Stop playback at any time with Ctrl + Alt + Esc.'}</div><p class="help">Playback runs while Neuron is open. A key step is a tap; held keys and mouse gestures are not recorded. Macros cannot send input into apps running at a higher privilege level.</p></div></section></div>`}`;
  $('#save-macros').onclick = () => act(saveMacros); $('#new-macro').onclick = addMacro; if ($('#first-macro')) $('#first-macro').onclick = addMacro;
  if (!macro) return;
  $('#macro-name').oninput = e => { macro.name = e.target.value; markMacroDirty(); };
  const updatePlayback = () => {
    const mode = $('#macro-repeat-mode').value;
    $('#macro-repeat-field').hidden = mode !== 'count';
    $('#macro-playback-help').textContent = ({once:'Run the sequence once each time you press the button.',count:'Run the sequence the specified number of times per press.',toggle:'Press the bound button to start repeating. Press it again to stop.',held:'Repeat while the bound button is held. Release it to stop.'})[mode];
  };
  $('#macro-repeat-mode').onchange = e => { macro.repeatMode = e.target.value; markMacroDirty(); updatePlayback(); };
  $('#macro-repeat').oninput = e => { macro.repeat = Number(e.target.value); markMacroDirty(); };
  updatePlayback();
  document.querySelectorAll('[data-step]').forEach(input => input.oninput = e => { const s = macro.steps[Number(input.dataset.step)]; if (s.type === 'key') s.value = e.target.value; else s.ms = Number(e.target.value); markMacroDirty(); });
  $('#add-key').onclick = () => { if (macro.steps.length >= 100) return toast('Limit: 100 steps.', true); macro.steps.push({type:'key',value:'1'}); markMacroDirty(); render(); };
  $('#add-delay').onclick = () => { if (macro.steps.length >= 100) return toast('Limit: 100 steps.', true); macro.steps.push({type:'delay',ms:100}); markMacroDirty(); render(); };
  $('#record').onclick = () => { recording = !recording; lastRecord = 0; renderMacros(); };
  $('#delete-macro').onclick = async () => { if(await confirmAction('Delete this macro?', 'Saving removes it from the shared library and resets buttons assigned to it across profiles.', 'Delete macro')) { macroDraft=macroDraft.filter(m=>m.id!==macro.id);selectedMacro=null;recording=false;markMacroDirty();render(); } };
}
function addMacro() {
  if (macroDraft.length >= 500) return toast('Limit: 500 macros.', true);
  const macro = {id:crypto.randomUUID(),name:`Macro ${macroDraft.length+1}`,repeatMode:'once',repeat:1,steps:[{type:'key',value:'1'}]}; macroDraft.push(macro); selectedMacro = macro.id; page = 'macros'; markMacroDirty(); render();
}
function renderStandardProfiles() {
  $('#content').innerHTML = `<div class="page-tools standard-profile-tools"><div class="tool-actions"><button class="button ghost" id="import-profile">↙ Import</button><button class="button ghost" id="export-profile">↗ Export</button><button class="button primary" id="new-profile">+ New profile</button></div></div><div class="profile-layout"><section class="card profile-list">${state.profiles.filter(p => !p.gameId).map(p => `<button class="profile-row ${p.id === draft.id ? 'selected' : ''}" data-profile="${esc(p.id)}">${state.active?.profileId === p.id ? '<span class="pill">RUNNING</span>' : ''}<strong>${esc(p.id === draft.id ? draft.name : p.name)}</strong><small>${esc(nameOf(p.model))} · ${esc(p.executable || 'Desktop / manual')}</small></button>`).join('')}</section><section class="card profile-editor"><label class="field"><span>PROFILE NAME</span><input id="profile-name" maxlength="60" value="${esc(draft.name)}"></label><label class="field"><span>NAGA MODEL</span><select id="profile-model">${state.catalog.map(d => `<option value="${d.productId}" ${d.productId === draft.model ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label><label class="field"><span>OPTIONAL PROCESS NAME (ADVANCED)</span><input id="profile-exe" placeholder="e.g. Wow.exe or FFXIV_dx11.exe" value="${esc(draft.executable)}" maxlength="104"></label><div class="row"><button class="button primary" id="save-profile">Save profile</button><button class="button" id="duplicate-profile">Duplicate</button><button class="text-button" id="delete-profile">Delete</button></div></section></div>`;
  $('#profile-name').oninput = e => { draft.name = e.target.value; markDirty(); };
  $('#profile-exe').oninput = e => { draft.executable = e.target.value; markDirty(); };
  $('#profile-model').onchange = e => { draft.model = Number(e.target.value); draft.plate = state.catalog.find(d => d.productId === draft.model).buttons; draft.bindings = Array.from({length:draft.plate},(_,i) => draft.bindings[i] || {type:'key',value:defaults[i]}); deviceId = state.devices.find(d => d.productId === draft.model)?.id; selected = 0; markDirty(); render(); };
  $('#save-profile').onclick = () => act(save);
  $('#new-profile').onclick = () => act(async () => { if (!(await leaveDraft())) return; const p = await api.create(`Profile ${state.profiles.length+1}`, draft.model, draft.plate); setDraft(p); render(); });
  $('#duplicate-profile').onclick = () => act(async () => { const p = await api.save({...draft,id:crypto.randomUUID(),name:(draft.name+' copy').slice(0,60),executable:'',executablePath:'',gameId:'',gameName:''}); setDraft(p); render(); });
  $('#delete-profile').onclick = () => act(async () => { if (await confirmAction('Delete this profile?', 'This removes the locally saved button profile. Shared macros stay in your library.', 'Delete profile')) { await api.remove(draft.id); setDraft(state.profiles[0]); render(); } });
  $('#export-profile').onclick = () => act(async () => { if (await api.export(draft)) toast('Profile exported.'); });
  $('#import-profile').onclick = () => act(async () => { if (!(await leaveDraft())) return; const p = await api.import(); if (p) { setDraft(p); render(); toast('Profile imported.'); } });
}
function renderDevices() {
  const device = currentDevice();
  $('#content').innerHTML = `<section class="card"><div class="connected-device"><div><span class="pill ${device ? '' : 'muted'}">${device ? '● CONNECTED' : 'NO MATCHING DEVICE'}</span><h2 class="device-name">Razer ${esc(nameOf(draft.model))}</h2><p>${device ? `USB · 1532:${draft.model.toString(16).padStart(4,'0').toUpperCase()} · ${draft.plate}-button profile` : 'Plug in your mouse or select its model in Profiles → Standard profiles.'}</p></div><div class="device-actions"><button class="button" id="scan-devices">↻ Refresh</button><button class="button" id="inspect-device" ${!device || draft.model !== 0x0067 || ![7,12].includes(draft.plate) || busy ? 'disabled' : ''}>Read mappings</button><button class="button" id="restore-device" ${!device || draft.model !== 0x0067 || busy ? 'disabled' : ''}>Restore original</button></div></div>${state.devices.length > 1 ? `<div class="section-note"><label>Selected mouse <select id="device-select" class="input">${state.devices.filter(d => d.productId === draft.model).map(d => `<option value="${esc(d.id)}" ${d.id === deviceId ? 'selected' : ''}>${esc(d.name)} · ${esc(d.serial || d.id)}</option>`).join('')}</select></label></div>` : ''}<div class="section-note">Hardware writes are enabled for the Trinity’s 7- and 12-button side plates as an experimental driver. Every changed mapping is read back, and originals are backed up before applying.${readback ? `<div class="readback">${readback.bindings.map((b,i) => `<span>${i+1} → type ${b.type} / ${b.params.map(n => '0x'+n.toString(16)).join(' ')}</span>`).join('')}</div>` : ''}</div></section><section class="card compatibility"><div class="card-head"><div><h2>The Naga compatibility roadmap</h2><p>All Naga models are the goal. Recognition does not imply working hardware control.</p></div><span class="pill muted">${state.catalog.length} USB IDENTITIES</span></div><table class="table"><thead><tr><th>MODEL / CONNECTION</th><th>USB PRODUCT ID</th><th>HARDWARE MAPPING</th></tr></thead><tbody>${state.catalog.map(d => `<tr><td>Razer ${esc(d.name)}</td><td>1532:${d.productId.toString(16).padStart(4,'0').toUpperCase()}</td><td><span class="pill ${d.driver ? 'orange' : 'muted'}">${d.driver ? 'EXPERIMENTAL · 7 / 12 BUTTON' : 'DRIVER PLANNED'}</span></td></tr>`).join('')}</tbody></table><div class="section-note">Bluetooth, newer USB identities, detachable plate detection, onboard macros, DPI stages, and lighting are future work. Current sensitivity is available in DPI for Trinity. Macros currently run on Windows through Neuron.</div></section>`;
  $('#scan-devices').onclick = () => act(async () => { state = await api.scan(); deviceId = state.devices.find(d => d.productId === draft.model)?.id; readback = null; render(); toast(`${state.devices.length} Naga device(s) found.`); });
  $('#inspect-device').onclick = () => act(async () => { busy = true; render(); try { readback = await api.inspect(deviceId, draft.plate); toast('Current mappings read from your mouse.'); } finally { busy = false; render(); } });
  $('#restore-device').onclick = () => act(async () => { if (!(await confirmAction('Restore original mouse settings?', 'Restore the original button mappings and any DPI backed up before Neuron changed them. This also stops automatic profile switching.', 'Restore original'))) return; busy = true; render(); try { await api.restore(deviceId); readback = null; } finally { busy = false; render(); } });
  if ($('#device-select')) $('#device-select').onchange = e => { deviceId = e.target.value; readback = null; render(); };
}
function render() {
  updateHeader(); ({buttons:renderButtons,dpi:renderDpi,macros:renderMacros,profiles:renderProfiles,devices:renderDevices})[page]();
  if (renderedPage !== page) $('main').scrollTop = 0;
  renderedPage = page;
}
function setDraft(profile) { draft = structuredClone(profile); dirty = false; selected = 0; selectedMacro = null; recording = false; readback = null; deviceId = state.devices.find(d => d.productId === draft.model)?.id; }
async function save() { recording = false; const profile = await api.save(draft); draft = structuredClone(profile); dirty = false; render(); toast('Profile saved locally. Apply to update your mouse.'); }
async function leaveDraft() { if (!dirty) return true; return confirmAction('Discard unsaved edits?', 'Switching profiles will discard edits that have not been saved.', 'Discard edits'); }
async function selectProfile(id) { if (id === draft.id) return; if (!(await leaveDraft())) { updateHeader(); return; } setDraft(state.profiles.find(p => p.id === id)); render(); }
document.addEventListener('click', event => {
  const nav = event.target.closest('[data-nav]'); if (nav) { recording = false; page = nav.dataset.nav; render(); if (page === 'dpi' && !dpiReadback.has(dpiDevice()?.id)) void act(readMouseDpi); }
  const button = event.target.closest('[data-button]'); if (button) void act(() => selectMouseControl(Number(button.dataset.button)));
  const type = event.target.closest('[data-type]');
  if (type) {
    const t = type.dataset.type;
    if (t === 'macro') { openMacroPicker(); return; }
    setSelectedBinding({type:t,value:t === 'key' ? (selectedControl().top ? 'Space' : defaults[selected]) : t === 'mouse' ? 'left' : ''}); markDirty(); render();
  }
  const macro = event.target.closest('[data-macro]'); if (macro) { selectedMacro = macro.dataset.macro; recording = false; renderMacros(); }
  const remove = event.target.closest('[data-remove]'), up = event.target.closest('[data-up]');
  if (remove || up) {
    const m = macroDraft.find(m => m.id === selectedMacro), index = Number((remove || up).dataset[remove ? 'remove' : 'up']);
    if (remove) m.steps.splice(index,1); else if (index > 0) [m.steps[index-1],m.steps[index]] = [m.steps[index],m.steps[index-1]];
    markMacroDirty(); renderMacros();
  }
  const profile = event.target.closest('[data-profile]'); if (profile) act(() => selectProfile(profile.dataset.profile));
});
function eventChord(event) {
  let key = event.code.replace(/^Key/,'').replace(/^Digit/,'');
  const map = {Space:'Space',Minus:'-',Equal:'=',BracketLeft:'[',BracketRight:']',Backslash:'\\',Semicolon:';',Quote:"'",Backquote:'`',Comma:',',Period:'.',Slash:'/'};
  key = map[event.code] || key;
  if (!/^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Space|Enter|Tab|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right)|[-=\[\]\\;'`,./])$/.test(key)) return null;
  return [...(event.ctrlKey ? ['Ctrl'] : []),...(event.shiftKey ? ['Shift'] : []),...(event.altKey ? ['Alt'] : []),...(event.metaKey ? ['Win'] : []),key].join('+');
}
document.addEventListener('keydown', event => {
  if (!recording) return;
  event.preventDefault(); event.stopPropagation();
  if (event.key === 'Escape') { recording = false; renderMacros(); return; }
  if (event.repeat) return;
  const value = eventChord(event); if (!value) return;
  const macro = macroDraft.find(m => m.id === selectedMacro);
  if (macro.steps.length >= 98) { recording = false; renderMacros(); toast('Recording stopped at the step limit.'); return; }
  if (lastRecord) macro.steps.push({type:'delay',ms:Math.max(10,Math.min(10000,Date.now()-lastRecord))});
  macro.steps.push({type:'key',value}); lastRecord = Date.now(); markMacroDirty(); renderMacros();
}, true);
window.addEventListener('blur', () => { if (recording) { recording = false; renderMacros(); toast('Recording stopped when Neuron lost focus.'); } });
$('#save-mapping').onclick = () => act(save);
$('#profile-select').onchange = e => act(() => selectProfile(e.target.value));
$('#apply').onclick = () => act(async () => {
  if (!currentDevice()) throw new Error('Connect the matching Naga first.');
  recording = false; busy = true; updateHeader();
  try { await api.apply(deviceId, draft); draft = structuredClone(state.profiles.find(p => p.id === draft.id)); dirty = false; }
  finally { busy = false; render(); }
});
$('#stop-macro').onclick = () => act(async () => { await api.stop(); toast('Macro playback stopped.'); });
api.onState(next => { const dpiDevicesChanged = page === 'dpi' && JSON.stringify(state?.devices) !== JSON.stringify(next.devices); state = next; if(!macroDirty)macroDraft=structuredClone(state.macros); syncSharedMacros(); if (!deviceId || !state.devices.some(d => d.id === deviceId)) deviceId = state.devices.find(d => d.productId === draft?.model)?.id; if (draft) updateHeader(); if (dpiDevicesChanged) renderDpi(); });
api.onNotice(message => toast(message));
act(async () => { state = await api.state(); macroDraft=structuredClone(state.macros); setDraft(state.profiles[0]); render(); });
