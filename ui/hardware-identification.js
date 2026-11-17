const identityDrafts = new Map();
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
function hardwareIdentificationPanels() {
  const messages = {
    'driver-needed':'Thanks — your answer will be included in the hardware report. This device connection does not have a working Neuron driver yet, so its issue stays open.',
    pending:'Confirmed. Neuron is checking the associated support issue and will close it if the reporting service also verifies driver support. Offline requests retry automatically.',
    closed:'Confirmed and supported. The associated automatic hardware issue was closed.',
    'no-issue':'Confirmed and supported. No associated hardware issue was found.',
    'manual-review':'Confirmed and supported. The associated issue is maintained manually and needs a maintainer to close it.',
    'local-only':'Confirmed and supported. Reporting is disabled in this build, so no GitHub issue was changed.'
  };
  return (state.hardwareReports||[]).map(report=>{
    const name=report.candidates[0], confirmed=Boolean(report.confirmedModel), edit=identityDrafts.get(report.key);
    const title=confirmed ? `You identified this mouse as ${report.confirmedModel}` : name ? `Is your mouse a ${name}?` : 'Which mouse uses this receiver or USB connection?';
    const choice = report.candidates.length ? `<label class="field"><span>DETECTED CANDIDATE</span><select class="identity-candidate">${report.candidates.map(name=>`<option>${esc(name)}</option>`).join('')}</select></label><button class="button primary identity-yes">Yes, this is my mouse</button>` : '';
    return `<section class="card identification-card" data-report-key="${esc(report.key)}"><div class="card-head"><div><h2>${esc(title)}</h2><p>${esc(report.deviceName)} · USB ${esc(report.key.toUpperCase())}</p></div><span class="pill ${report.supported?'orange':'muted'}">${confirmed ? report.supported?'DRIVER AVAILABLE':'DRIVER NEEDED':'HELP IDENTIFY'}</span></div><div class="identification-body">${confirmed ? `<p role="status">${esc(messages[report.status]||messages.pending)}</p>` : `<p>Receiver names and installed software can suggest a model. Please confirm the brand and model printed on your mouse or its packaging.</p>${choice}`}<details ${edit?.open||(!confirmed&&!name)?'open':''}><summary>${confirmed?'Correct this identification':name?'It’s a different mouse':'Enter the model'}</summary><form class="identity-form"><label class="field"><span>MOUSE BRAND AND MODEL</span><input class="identity-name" maxlength="100" required placeholder="e.g. Redragon M990-WL" value="${esc(edit?.value??report.confirmedModel)}"></label><button class="button" type="submit">Confirm model</button></form></details><p class="help">Your answer is added to the public hardware report. Confirmation does not enable an unverified driver.${report.supported?' Trinity mapping support is experimental and covers 7- and 12-button plates.':''}</p>${report.issueUrl?`<button class="button ghost identity-issue" type="button">View GitHub issue ↗</button>`:''}</div></section>`;
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
