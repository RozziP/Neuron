let dpiDeviceId = '', dpiValues = new Map(), dpiReadback = new Map(), dpiReading = false;
function dpiDevice() {
  return state.devices.find(d => d.id === dpiDeviceId) || state.devices.find(d => d.productId === 0x0067) || state.devices[0];
}
function updateDpiControls() {
  const device = dpiDevice(), unavailable = !device || device.productId !== 0x0067 || busy || state.applying || dpiReading;
  if ($('#read-dpi')) $('#read-dpi').disabled = unavailable;
  if ($('#apply-dpi')) $('#apply-dpi').disabled = unavailable;
  if ($('#dpi-device')) $('#dpi-device').disabled = busy || state.applying || dpiReading;
  if ($('.dpi-controls')) $('.dpi-controls').disabled = unavailable;
}
async function readMouseDpi() {
  const device = dpiDevice();
  if (!device || device.productId !== 0x0067 || dpiReading) return;
  dpiReading = true; updateDpiControls();
  try {
    const value = await api.inspectDpi(device.id);
    dpiReadback.set(device.id, value); dpiValues.set(device.id, { ...value });
  } finally { dpiReading = false; if (page === 'dpi') renderDpi(); }
}
function renderDpi() {
  const device = dpiDevice();
  if (device) dpiDeviceId = device.id;
  const value = dpiValues.get(device?.id) || { x: 1800, y: 1800 };
  if (device && !dpiValues.has(device.id)) dpiValues.set(device.id, value);
  const reading = dpiReadback.get(device?.id);
  const axis = (id, label) => `<div class="dpi-axis"><div class="dpi-axis-heading"><label for="dpi-${id}">${label}</label><div class="dpi-number"><input id="dpi-${id}" type="number" min="100" max="16000" step="1" value="${value[id]}" aria-label="${label} DPI"><span>DPI</span></div></div><input id="dpi-${id}-slider" type="range" min="100" max="16000" step="50" value="${value[id]}" aria-label="${label} DPI slider"><div class="dpi-scale"><span>100</span><span>16,000</span></div></div>`;
  $('#content').innerHTML = `<div class="dpi-layout">
    <section class="card">
      <div class="card-head"><h2>Mouse sensitivity</h2><button class="button primary" id="apply-dpi">Apply DPI</button></div>
      <div class="dpi-editor">
        ${state.devices.length > 1 ? `<label class="field"><span>MOUSE</span><select id="dpi-device">${state.devices.map(d => `<option value="${esc(d.id)}" ${d.id === device.id ? 'selected' : ''}>${esc(d.name)}${d.serial ? ' · ' + esc(d.serial) : ''}</option>`).join('')}</select></label>` : ''}
        ${!device ? '<p class="help">Connect a Naga Trinity to adjust DPI.</p>' : device.productId !== 0x0067 ? '<p class="help">DPI control is available for Naga Trinity.</p>' : ''}
        <fieldset class="dpi-controls">
          <legend class="dpi-sr-only">Mouse sensitivity</legend>
          <label class="dpi-link"><input id="dpi-linked" type="checkbox" ${value.x === value.y ? 'checked' : ''}> Use the same DPI for both axes</label>
          ${axis('x', 'Horizontal (X)')}${axis('y', 'Vertical (Y)')}
          <div class="dpi-presets"><span>QUICK PICKS</span>${[400,800,1600,1800,3200].map(n => `<button class="button ${value.x === n && value.y === n ? 'dpi-picked' : ''}" data-dpi-preset="${n}">${n.toLocaleString()}</button>`).join('')}</div>
        </fieldset>
      </div>
    </section>
    <aside class="dpi-aside"><section class="card"><div class="card-head"><h2>On your mouse</h2><button class="button" id="read-dpi">Read DPI</button></div><div class="dpi-device-value"><strong>${reading ? reading.x.toLocaleString() : '—'}</strong><span>${reading ? (reading.x === reading.y ? 'DPI · both axes' : `X DPI · Y ${reading.y.toLocaleString()} DPI`) : 'Read your current sensitivity'}</span></div></section></aside>
  </div>`;
  function setAxis(id, next) {
    value[id] = next;
    if ($('#dpi-linked').checked) value.x = value.y = next;
    for (const key of ['x','y']) {
      if (document.activeElement !== $(`#dpi-${key}`)) $(`#dpi-${key}`).value = value[key];
      $(`#dpi-${key}-slider`).value = value[key];
    }
    document.querySelectorAll('[data-dpi-preset]').forEach(button => button.classList.toggle('dpi-picked', value.x === Number(button.dataset.dpiPreset) && value.y === value.x));
  }
  for (const id of ['x','y']) {
    $(`#dpi-${id}`).oninput = e => setAxis(id, e.target.valueAsNumber);
    $(`#dpi-${id}-slider`).oninput = e => setAxis(id, Number(e.target.value));
  }
  $('#dpi-linked').onchange = e => { if (e.target.checked) setAxis('x', value.x); };
  document.querySelectorAll('[data-dpi-preset]').forEach(button => button.onclick = () => {
    value.x = value.y = Number(button.dataset.dpiPreset); renderDpi();
  });
  $('#read-dpi').onclick = () => act(readMouseDpi);
  $('#apply-dpi').onclick = () => act(async () => {
    const target = dpiDevice();
    if (!target || target.productId !== 0x0067) throw new Error('Connect a Naga Trinity first.');
    busy = true; updateHeader();
    try {
      const applied = await api.applyDpi(target.id, value);
      dpiReadback.set(target.id, applied); dpiValues.set(target.id, { ...applied });
      toast('DPI applied to your mouse.');
    } finally { busy = false; render(); }
  });
  if ($('#dpi-device')) $('#dpi-device').onchange = e => { dpiDeviceId = e.target.value; renderDpi(); void act(readMouseDpi); };
  updateDpiControls();
}
