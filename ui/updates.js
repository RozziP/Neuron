(() => {
  const api = window.neuron;
  const version = document.querySelector('#app-version');
  const status = document.querySelector('#update-status');
  const check = document.querySelector('#check-updates');
  let starting = false, latest = {};
  function render(state) {
    latest = state;
    const downloading = state.phase === 'downloading', installing = state.phase === 'installing';
    const working = starting || downloading || installing;
    version.textContent = `v${state.currentVersion}`;
    check.disabled = !!(state.checking || working);
    check.textContent = installing ? 'Restarting…' : downloading ? `Downloading ${state.progress}%` : starting ? 'Preparing update…'
      : state.checking ? 'Checking…' : state.release ? `Update to v${state.release.version}` : 'Check for updates';
    check.title = state.release ? 'Review unsaved changes, download the update, and restart Neuron automatically.' : 'Check for updates.';
    status.textContent = installing ? 'Restoring mouse mappings and installing the update…'
      : downloading ? 'Downloading and verifying the installer…'
      : state.installError || state.error || (state.checking ? 'Checking for updates…' : state.release
        ? 'Update and restart automatically.' : state.checkedAt ? 'You’re up to date.' : 'Updates from GitHub');
    status.classList.toggle('update-error', !!(state.error || state.installError) && !working && !state.checking);
    for (const selector of ['main','nav','#mouse-list']) document.querySelector(selector).inert = working;
  }
  api.onUpdates(render);
  api.updates().then(render).catch(error => { status.textContent = error.message; });
  check.onclick = async () => {
    if (starting || ['downloading','installing'].includes(latest.phase)) return;
    const updating = !!latest.release;
    starting = updating; render(latest);
    try {
      if (updating) { if (await prepareForUpdate()) await api.installUpdate(); }
      else render(await api.checkUpdates());
    } catch (error) { latest = { ...latest, phase: 'idle', error: error.message }; }
    finally { starting = false; render(latest); }
  };
})();
