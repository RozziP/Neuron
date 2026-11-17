(() => {
  const api = window.neuron;
  const version = document.querySelector('#app-version');
  const status = document.querySelector('#update-status');
  const check = document.querySelector('#check-updates');
  const update = document.querySelector('#open-update');
  const hint = document.querySelector('#update-hint');
  let opening = false;
  function render(state) {
    version.textContent = `v${state.currentVersion}`;
    check.disabled = state.checking;
    check.textContent = state.checking ? 'Checking…' : 'Check for updates';
    update.hidden = !state.release;
    hint.hidden = !state.release;
    update.textContent = state.release ? `Update to v${state.release.version}` : 'Update';
    update.disabled = opening;
    status.textContent = state.checking ? 'Checking GitHub…' : state.error || (state.release
      ? 'A new version is available.' : state.checkedAt ? 'You’re up to date.' : 'Updates from GitHub');
    status.classList.toggle('update-error', !!state.error && !state.checking);
  }
  api.onUpdates(render);
  api.updates().then(render).catch(error => { status.textContent = error.message; });
  check.onclick = async () => {
    check.disabled = true;
    try { render(await api.checkUpdates()); }
    catch (error) { status.textContent = error.message; }
    finally { check.disabled = false; }
  };
  update.onclick = async () => {
    opening = true; update.disabled = true;
    try { await api.openUpdate(); }
    catch (error) { status.textContent = error.message; }
    finally { opening = false; update.disabled = false; }
  };
})();
