const receiverModelDrafts = new Map();
let manualModelDraft = null;
const profileModelOf = device => device.modelId ?? device.productId;
function mouseModelOptions(selected, unknown = false) {
  return `${unknown ? '<option value="">Choose a mouse model</option>' : ''}${state.catalog.map(m => `<option value="${m.productId}" ${m.productId === selected ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}`;
}
function manualMousePanel() {
  return `<section class="card"><div class="card-head"><div><h2>Select your mouse</h2><p>Choose any catalog model, including when automatic detection is unavailable.</p></div></div><form id="manual-mouse-form" class="manual-mouse-form"><label class="field"><span>MOUSE MODEL FOR PROFILES</span><select id="manual-mouse-model">${mouseModelOptions(draft.model)}</select></label><button class="button" type="submit">Use this mouse</button><p class="help">Opens a saved desktop profile for this model, or creates one. Receiver and dock model choices are saved separately below. Hardware controls depend on support for the actual connection.</p></form></section>`;
}
function receiverModelPanel(device) {
  const selectedModel = receiverModelDrafts.has(device.id) ? receiverModelDrafts.get(device.id) : device.modelId;
  return `<form class="receiver-model-form manual-mouse-form" data-device-id="${esc(device.id)}"><label class="field"><span>WHICH MOUSE IS PAIRED WITH THIS ${device.connection === 'dock' ? 'DOCK' : 'RECEIVER'}</span><select class="receiver-model">${mouseModelOptions(selectedModel, true)}</select></label><button class="button" type="submit">Save mouse choice</button>${device.modelSource === 'manual' ? '<button class="button ghost reset-mouse-choice" type="button">Clear choice</button>' : ''}<p class="help">Saved on this computer for this connection. Neuron uses a driver only for supported model and connection combinations. For a model outside this list, enter its brand and model in mouse identification.</p></form>`;
}
async function useMouseModel(model, preferredId) {
  if (draft.model === model) {
    state = await api.preferMouseModel(model); manualModelDraft = null;
    if (preferredId) deviceId = preferredId;
    render(); return;
  }
  if (!(await leaveDraft())) { render(); return; }
  const profile = state.profiles.find(p => p.model === model && !p.executable && !p.gameId)
    || await api.create(nameOf(model), model, state.catalog.find(m => m.productId === model).buttons);
  state = await api.preferMouseModel(model); manualModelDraft = null;
  setDraft(profile);
  if (preferredId) deviceId = preferredId;
  render();
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
        state = await api.selectDeviceModel(id, model); receiverModelDrafts.delete(id);
        await useMouseModel(model, id); toast('Mouse choice saved on this computer.');
      });
    };
    form.querySelector('.reset-mouse-choice')?.addEventListener('click', () => void act(async () => {
      state = await api.selectDeviceModel(id, null); receiverModelDrafts.delete(id); render(); toast('Mouse choice cleared.');
    }));
  });
}
