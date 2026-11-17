let dpiValues = new Map(), dpiReadback = new Map(), dpiReading = false;
function dpiDevice() { return currentDevice(); }
function dpiLimits() { return dpiDevice()?.dpi || null; }
function updateDpiControls() {
  const device = dpiDevice(), unavailable = !dpiLimits() || busy || state.applying || dpiReading;
  if ($('#read-dpi')) $('#read-dpi').disabled = unavailable;
  if ($('#apply-dpi')) $('#apply-dpi').disabled = unavailable || !dpiReadback.has(device?.id);
  if ($('#dpi-device')) $('#dpi-device').disabled = busy || state.applying || dpiReading;
  if ($('.dpi-controls')) $('.dpi-controls').disabled = unavailable || !dpiReadback.has(device?.id);
}
async function readMouseDpi() {
  const device = dpiDevice();
  if (!dpiLimits() || dpiReading) return;
  dpiReadback.delete(device.id);
  dpiReading = true; updateDpiControls();renderMouseSidebar();
  try {
    const value = await api.inspectDpi(device.id);
    dpiReadback.set(device.id, value); dpiValues.set(device.id, { ...value });
  } finally { dpiReading = false;renderMouseSidebar(); if (page === 'dpi') renderDpi(); }
}
function renderDpi() {
  const device = dpiDevice();
  const limits = device ? dpiLimits() : mouseModel()?.dpi;
  if (!limits) {
    $('#content').innerHTML = `<div class="dpi-layout"><section class="card"><div class="card-head"><h2>Mouse sensitivity</h2><button class="button primary" id="apply-dpi" disabled>Apply DPI</button></div><div class="dpi-editor"><h3>DPI unavailable for this mouse</h3><p class="help">Neuron cannot read or change DPI for ${esc(state.selectedMouse?.name || 'this mouse')} yet. Applying button mappings leaves your existing sensitivity unchanged.</p><p class="help">Use your mouse’s own controls or its manufacturer’s software to adjust sensitivity.</p></div></section><aside class="dpi-aside"><section class="card"><div class="card-head"><h2>On your mouse</h2><button class="button" id="read-dpi" disabled>Read DPI</button></div><div class="dpi-device-value"><strong>—</strong><span>Current DPI is unknown</span></div></section></aside></div>`;
    return;
  }
  const value = dpiValues.get(device?.id) || { x: limits.min, y: limits.min };
  const reading = dpiReadback.get(device?.id);
  const axis = (id, label) => `<div class="dpi-axis"><div class="dpi-axis-heading"><label for="dpi-${id}">${label}</label><div class="dpi-number"><input id="dpi-${id}" type="number" min="${limits.min}" max="${limits.max}" step="1" value="${value[id]}" aria-label="${label} DPI"><span>DPI</span></div></div><input id="dpi-${id}-slider" type="range" min="${limits.min}" max="${limits.max}" step="50" value="${value[id]}" aria-label="${label} DPI slider"><div class="dpi-scale"><span>${limits.min.toLocaleString()}</span><span>${limits.max.toLocaleString()}</span></div></div>`;
  $('#content').innerHTML = `<div class="dpi-layout">
    <section class="card">
      <div class="card-head"><h2>Mouse sensitivity</h2><button class="button primary" id="apply-dpi">Apply DPI</button></div>
      <div class="dpi-editor">
        <p class="help">${esc(state.selectedMouse?.name || 'Selected mouse')}</p>
        ${!device ? '<p class="help">Connect this mouse to read and adjust DPI.</p>' : !reading ? '<p class="help">Read DPI to load the current sensitivity before making changes.</p>' : '<p class="help">Changes apply to the current sensitivity. Button profiles do not change DPI.</p>'}
        <fieldset class="dpi-controls" ${reading ? '' : 'hidden'}>
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
    if (!dpiLimits() || !dpiReadback.has(target?.id)) throw new Error('Read DPI from a supported mouse first.');
    if (![value.x,value.y].every(n=>Number.isInteger(n) && n>=limits.min && n<=limits.max))
      throw new Error(`DPI must be a whole number from ${limits.min.toLocaleString()} to ${limits.max.toLocaleString()} for each axis.`);
    busy = true; updateHeader();
    try {
      const applied = await api.applyDpi(target.id, value);
      dpiReadback.set(target.id, applied); dpiValues.set(target.id, { ...applied });
      toast('DPI applied to your mouse.');
    } catch (error) { dpiReadback.delete(target.id); throw error; }
    finally { busy = false; render(); }
  });
  updateDpiControls();
}
