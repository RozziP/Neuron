const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function launchUpdateHelper({ file, sha256, version, appPath, parentId, bridgeId, resultPath }, { helperPath, spawnProcess = spawn } = {}) {
  const directory = path.dirname(file);
  const helper = path.join(directory, 'NeuronUpdater.exe');
  const request = path.join(directory, 'request.json');
  const ready = path.join(directory, 'ready');
  await fs.copyFile(helperPath, helper);
  await fs.writeFile(request, JSON.stringify({ file, sha256, version, appPath, parentId, bridgeId, resultPath }), { flag: 'wx' });
  const child = spawnProcess(helper, [request], { detached: true, windowsHide: true, stdio: 'ignore', cwd: directory });
  let failure;
  child.once('error', error => { failure = error; });
  child.once('exit', code => { failure = new Error(`Update helper stopped before installation (${code}).`); });
  try {
    for (let i = 0; i < 150; i++) {
      if (failure) throw failure;
      if (await fs.stat(ready).then(() => true, () => false)) { child.unref(); return; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('The update helper did not start. Neuron has stayed open; please try again.');
  } catch (error) {
    child.kill();
    try {
      const result = JSON.parse(await fs.readFile(resultPath, 'utf8'));
      if (!result.ok && result.version === version && typeof result.error === 'string') error = new Error(result.error);
    } catch { /* Keep the launch error when the helper could not write a result. */ }
    throw error;
  }
}

async function performUpdateInstall({ prepare, restore, launch, quit, recover }) {
  await prepare();
  try { await restore(); await launch(); await quit(); }
  catch (error) { await recover(); throw error; }
}

module.exports = { launchUpdateHelper, performUpdateInstall };
