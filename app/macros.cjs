const { setTimeout: delay } = require('node:timers/promises');
const { parseChord } = require('./keys.cjs');
class MacroPlayer {
  constructor(bridge, notify = () => {}) { this.bridge = bridge; this.notify = notify; this.running = null; }
  stop() { this.running?.abort(); }
  async play(macro) {
    if (this.running) return; // No overlapping macros or unbounded trigger queue.
    const controller = new AbortController(); this.running = controller; this.notify(`Running ${macro.name}`);
    try {
      for (let repeat = 0; repeat < macro.repeat; repeat++) for (const step of macro.steps) {
        if (controller.signal.aborted) return;
        if (step.type === 'delay') await delay(step.ms, undefined, { signal: controller.signal });
        else await this.bridge.call('tap', { keys: parseChord(step.value).virtualKeys });
      }
      this.notify(`${macro.name} finished`);
    } catch (error) { this.notify(error.name === 'AbortError' ? 'Macro stopped' : error.message); }
    finally { this.running = null; }
  }
}
module.exports = { MacroPlayer };
