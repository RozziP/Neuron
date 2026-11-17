(() => {
  const api = window.neuron;
  const version = document.querySelector('#app-version');
  const status = document.querySelector('#update-status');
  const check = document.querySelector('#check-updates');
  let opening = false;
  let latest = {};
  function showError(error) {
    status.textContent = error.message;
    status.classList.add('update-error');
  }
  function render(state) {
    latest = state;
    version.textContent = `v${state.currentVersion}`;
    check.disabled = state.checking || opening;
    check.textContent = opening ? 'Opening…' : state.checking ? 'Checking…' : state.release ? `Update to v${state.release.version}` : 'Check for updates';
    check.title = state.release
      ? 'Download the installer from GitHub, quit Neuron from the tray, then run the installer.'
      : state.checkedAt ? 'You’re up to date. Check again for updates.' : 'Check GitHub for updates.';
    status.textContent = state.checking ? 'Checking GitHub…' : state.error || (state.release
      ? 'A new version is available.' : state.checkedAt ? 'You’re up to date.' : 'Updates from GitHub');
    status.classList.toggle('update-error', !!state.error && !state.checking);
  }
  api.onUpdates(render);
  api.updates().then(render).catch(showError);
  check.onclick = async () => {
    const openRelease = !!latest.release;
    opening = openRelease;
    render(latest);
    check.disabled = true;
    try {
      if (openRelease) await api.openUpdate();
      else render(await api.checkUpdates());
    }
    catch (error) { showError(error); }
    finally {
      opening = false;
      check.disabled = !!latest.checking;
      check.textContent = latest.checking ? 'Checking…' : latest.release ? `Update to v${latest.release.version}` : 'Check for updates';
    }
  };
})();
