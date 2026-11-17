const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('../app/processes.cjs');
async function run(app, hardware, bridge, setActive) {
  const mode = process.env.NEURON_SHUTDOWN_CASE || 'idle';
  const directory = path.dirname(app.getPath('userData'));
  const file = path.join(directory, `shutdown-${mode}.json`);
  const result = { mode, restoreCompleted: false, hardwareWrites: false, pids: [] };
  hardware.restore = async () => {
    await new Promise(resolve => setTimeout(resolve, 50));
    result.restoreCompleted = true; fs.writeFileSync(file, JSON.stringify(result));
    return { message: 'Simulated mappings restored.' };
  };
  if (mode === 'active') setActive();
  // Exercise cleanup of a slow read-only background helper as well as Chromium.
  const pending = exec('powershell.exe', ['-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 30'], {windowsHide:true});
  pending.catch(() => {});
  result.pids = [...new Set([process.pid, bridge.process.pid, pending.child.pid, ...app.getAppMetrics().map(item=>item.pid)])];
  fs.writeFileSync(file, JSON.stringify(result));
  app.quit();
}
module.exports = { run };
