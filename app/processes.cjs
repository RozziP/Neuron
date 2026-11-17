const { execFile } = require('node:child_process');
const children = new Set();
let stopping = false;
function exec(file, args, options) {
  if (stopping) return Promise.reject(new Error('Background work stopped for shutdown.'));
  let child;
  const promise = new Promise((resolve, reject) => {
    child = execFile(file, args, options, (error, stdout, stderr) => error ? reject(error) : resolve({stdout, stderr}));
    children.add(child);
    child.once('close', () => children.delete(child));
  });
  promise.child = child;
  return promise;
}
async function stopBackgroundProcesses() {
  stopping = true;
  await Promise.all([...children].map(child => new Promise(resolve => {
    child.once('close', resolve);
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    child.kill();
  })));
}
module.exports = { exec, stopBackgroundProcesses };
