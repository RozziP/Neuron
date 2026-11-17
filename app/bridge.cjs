const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const path = require('node:path');
class Bridge {
  constructor() {
    this.pending = new Map(); this.sequence = 0;
    const executable = path.join(__dirname, '../native/NeuronBridge.exe').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    this.process = spawn(executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    createInterface({ input: this.process.stdout }).on('line', line => {
      try {
        const message = JSON.parse(line), pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(message.id);
        message.ok ? pending.resolve(message.result) : pending.reject(new Error(message.error));
      } catch { /* Ignore non-protocol output. */ }
    });
    const fail = error => { this.dead = true; for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear(); };
    this.process.on('error', fail);
    this.process.on('exit', () => fail(new Error('The native bridge stopped. Restart Neuron.')));
    this.process.stdin.on('error', fail);
  }
  call(method, args = {}) {
    if (this.dead) return Promise.reject(new Error('Native bridge unavailable. Restart Neuron.'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Native operation timed out.')); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(JSON.stringify({ ...args, method, id }) + '\n');
    });
  }
  close() { this.process.stdin.end(); }
}
module.exports = { Bridge };
