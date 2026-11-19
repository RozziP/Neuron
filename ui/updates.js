(() => {
  const api = window.neuron;
  const version = document.querySelector('#app-version');
  const status = document.querySelector('#update-status');
  const check = document.querySelector('#check-updates');
  const progress = document.querySelector('#update-progress');
  const cancel = document.querySelector('#cancel-update');
  let starting = false, latest = {};
  function render(state) {
    latest = state;
    const downloading = state.phase === 'downloading', installing = state.phase === 'installing', ready = state.phase === 'ready';
    const working = starting || downloading || installing;
    version.textContent = `v${state.currentVersion}`;
    check.disabled = !!(state.checking || working);
    check.textContent = installing ? 'Restarting…' : downloading ? `Downloading ${state.progress}%` : starting ? 'Preparing update…'
      : ready ? 'Install and restart' : state.checking ? 'Checking…' : state.release ? `Download v${state.release.version}` : 'Check for updates';
    check.title = ready ? 'Install the verified update and restart Neuron after reviewing unsaved changes.'
      : state.release ? 'Download the update in the background. You choose when to install and restart.' : 'Check for updates.';
    status.textContent = installing ? 'Restoring mouse mappings and installing the update…'
      : downloading ? (state.progress === 100 ? 'Verifying the download…' : state.received
        ? `${state.progress}% · ${(state.received / 1048576).toFixed(1)} / ${(state.total / 1048576).toFixed(1)} MB downloaded. You can keep working.`
        : 'Connecting to GitHub… You can keep working.')
      : state.error || state.installError || (ready ? `v${state.release.version} is ready. Install and restart when you’re ready.`
        : state.checking ? 'Checking for updates…' : state.release
        ? 'Download now; install when you’re ready.' : state.checkedAt ? 'You’re up to date.' : 'Updates from GitHub');
    status.classList.toggle('update-error', !!(state.error || state.installError) && !working && !state.checking);
    progress.hidden = !downloading;
    if (state.received > 0) progress.value = state.progress;
    else progress.removeAttribute('value');
    cancel.hidden = !downloading;
    for (const selector of ['main','nav','#mouse-list']) document.querySelector(selector).inert = installing || (starting && ready);
  }
  api.onUpdates(render);
  api.updates().then(render).catch(error => { status.textContent = error.message; });
  check.onclick = async () => {
    if (starting || ['downloading','installing'].includes(latest.phase)) return;
    const ready = latest.phase === 'ready', updating = !!latest.release;
    starting = true; latest = { ...latest, error: '' }; render(latest);
    try {
      if (ready) { if (await prepareForUpdate()) render(await api.installUpdate()); }
      else if (updating) render(await api.downloadUpdate());
      else render(await api.checkUpdates());
    } catch (error) { latest = { ...latest, error: error.message }; }
    finally { starting = false; render(latest); }
  };
  cancel.onclick = async () => {
    try { await api.cancelUpdate(); }
    catch (error) { status.textContent = error.message; }
  };
})();
