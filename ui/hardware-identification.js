const identityDrafts = new Map();
let identityReportKey = null;
let identityMouseKey = null;
document.querySelector('#identity-dialog').addEventListener('close', () => {
  const trigger = [...document.querySelectorAll('[data-identity-key]')].find(button => button.dataset.identityKey === identityReportKey && button.closest('.mouse-workspace-row')?.querySelector('[data-mouse-key]').dataset.mouseKey === identityMouseKey);
  (trigger || document.querySelector('[data-nav="devices"]')).focus({preventScroll:true});
  identityReportKey = null;
  identityMouseKey = null;
  document.querySelector('#identity-details').replaceChildren();
});
function renderHardwareIdentification() {
  const sidebar = $('#mouse-list');
  sidebar.querySelectorAll('[data-identity-key]').forEach(button => button.remove());
  sidebar.querySelectorAll('.mouse-workspace-row').forEach(row => {
    const mouse=state.mouseWorkspaces.find(mouse=>mouse.key===row.querySelector('[data-mouse-key]').dataset.mouseKey);
    const device=state.devices.find(device=>device.id===mouse?.deviceId);
    if(!device)return;
    const key=`${device.vendorId.toString(16).padStart(4,'0')}:${device.productId.toString(16).padStart(4,'0')}`;
    const report=(state.hardwareReports || []).find(report=>report.key===key);
    if(!report)return;
    const label=`${report.confirmedModel ? 'Identity details for' : 'Help identify'} ${mouse.name}`;
    row.insertAdjacentHTML('beforeend', `<button type="button" class="identity-entry-action" data-identity-key="${esc(report.key)}" aria-label="${esc(label)}" title="${esc(label)}" aria-haspopup="dialog" aria-controls="identity-dialog"><span aria-hidden="true">i</span></button>`);
  });
  sidebar.querySelectorAll('[data-identity-key]').forEach(button => button.onclick = () => {
    recording = false;
    identityReportKey = button.dataset.identityKey;
    identityMouseKey = button.closest('.mouse-workspace-row').querySelector('[data-mouse-key]').dataset.mouseKey;
    renderIdentityDetails();
    $('#identity-dialog').showModal();
  });
  if ($('#identity-dialog').open) renderIdentityDetails();
}
function renderIdentityDetails() {
  const editing = captureIdentityEditing();
  const report = (state.hardwareReports || []).find(report => report.key === identityReportKey);
  $('#identity-details').innerHTML = report ? hardwareIdentificationPanels([report]) : '<p>This device is no longer available. Reconnect it to view its identity details.</p>';
  bindHardwareIdentification();
  restoreIdentityEditing(editing);
}
function captureIdentityEditing() {
  const input=document.activeElement;
  return input?.classList.contains('identity-name') ? {key:input.closest('[data-report-key]').dataset.reportKey,start:input.selectionStart,end:input.selectionEnd} : null;
}
function restoreIdentityEditing(editing) {
  if(!editing)return;
  const card=[...document.querySelectorAll('.identification-card')].find(c=>c.dataset.reportKey===editing.key);
  const input=card?.querySelector('.identity-name');
  if(input){card.querySelector('details').open=true;input.focus({preventScroll:true});input.setSelectionRange(editing.start,editing.end);}
}
function hardwareIdentificationPanels(reports) {
  const messages = {
    'verified-locally':'Neuron verified the connected M990-WL through its device protocol. Experimental side-button remapping and battery readings are available. The shared receiver ID alone does not identify other mice.',
    'driver-needed':'Thanks — your answer will be included in the hardware report. This device connection does not have a working Neuron driver yet, so its issue stays open.',
    pending:'Confirmed. Neuron is checking the associated support issue and will close it if the reporting service also verifies driver support. Offline requests retry automatically.',
    closed:'Confirmed and supported. The associated automatic hardware issue was closed.',
    'no-issue':'Confirmed and supported. No associated hardware issue was found.',
    'manual-review':'Confirmed and supported. The associated issue is maintained manually and needs a maintainer to close it.',
    'local-only':'Confirmed and supported. Reporting is disabled in this build, so no GitHub issue was changed.'
  };
  return reports.map(report=>{
    if (state.devices.some(d=>d.vendorId===0x3554 && d.modelVerified && d.driver && `${d.vendorId.toString(16)}:${d.productId.toString(16)}`===report.key)) report={...report,supported:true,status:'verified-locally'};
    const name=report.candidates[0], confirmed=Boolean(report.confirmedModel), edit=identityDrafts.get(report.key);
    const title=confirmed ? `You identified this mouse as ${report.confirmedModel}` : name ? `Is your mouse a ${name}?` : 'Which mouse uses this receiver or USB connection?';
    const choice = report.candidates.length ? `<label class="field"><span>DETECTED CANDIDATE</span><select class="identity-candidate">${report.candidates.map(name=>`<option>${esc(name)}</option>`).join('')}</select></label><button class="button primary identity-yes">Yes, this is my mouse</button>` : '';
    return `<section class="card identification-card" data-report-key="${esc(report.key)}"><div class="card-head"><div><h2>${esc(title)}</h2><p>${esc(report.deviceName)} · USB ${esc(report.key.toUpperCase())}</p></div><span class="pill ${report.supported?'orange':'muted'}">${confirmed ? report.supported?'DRIVER AVAILABLE':'DRIVER NEEDED':'HELP IDENTIFY'}</span></div><div class="identification-body">${confirmed ? `<p role="status">${esc(messages[report.status]||messages.pending)}</p>` : `<p>Receiver names and installed software can suggest a model. Please confirm the brand and model printed on your mouse or its packaging.</p>${choice}`}<details ${edit?.open||(!confirmed&&!name)?'open':''}><summary>${confirmed?'Correct this identification':name?'It’s a different mouse':'Enter the model'}</summary><form class="identity-form"><label class="field"><span>MOUSE BRAND AND MODEL</span><input class="identity-name" maxlength="100" required placeholder="e.g. Redragon M990-WL" value="${esc(edit?.value??report.confirmedModel)}"></label><button class="button" type="submit">Confirm model</button></form></details><p class="help">Your answer is added to the public hardware report. Confirmation does not enable an unverified driver.${report.supported?' Hardware features depend on the verified model and connection.':''}</p>${report.issueUrl?`<button class="button ghost identity-issue" type="button">View GitHub issue ↗</button>`:''}</div></section>`;
  }).join('');
}
function bindHardwareIdentification() {
  document.querySelectorAll('.identification-card').forEach(card=>{
    const confirm = name=>act(async()=>{
      const buttons=[...card.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
      try { state=await api.confirmHardware(card.dataset.reportKey,name);identityDrafts.delete(card.dataset.reportKey);render();toast('Mouse identification saved.'); }
      finally { buttons.forEach(b=>b.disabled=false); }
    });
    card.querySelector('.identity-yes')?.addEventListener('click',()=>confirm(card.querySelector('.identity-candidate').value));
    card.querySelector('.identity-issue')?.addEventListener('click',()=>act(()=>api.openHardwareIssue(card.dataset.reportKey)));
    card.querySelector('.identity-name').addEventListener('input',event=>identityDrafts.set(card.dataset.reportKey,{value:event.target.value,open:true}));
    card.querySelector('.identity-form').addEventListener('submit',event=>{event.preventDefault();void confirm(card.querySelector('.identity-name').value);});
  });
}
