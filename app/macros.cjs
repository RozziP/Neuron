const { setTimeout: delay, setImmediate: yieldTurn } = require('node:timers/promises');
const { parseChord } = require('./keys.cjs');
class MacroPlayer {
  constructor(bridge, notify = () => {}) { this.bridge = bridge; this.notify = notify; this.running = null; this.runningMacroId = null; }
  stop() { this.running?.abort(); }
  trigger(macro, options) {
    if (macro.repeatMode === 'toggle' && this.running && this.runningMacroId === macro.id) { this.stop(); return; }
    return this.play(macro, options);
  }
  async play(macro, { signal } = {}) {
    if (this.running) return; // No overlapping macros or unbounded trigger queue.
    const controller = new AbortController(); this.running = controller; this.runningMacroId = macro.id; this.notify(`Running ${macro.name}`);
    const release = () => controller.abort();
    if (macro.repeatMode === 'held') {
      if (!signal || signal.aborted) controller.abort();
      else signal.addEventListener('abort', release, { once: true });
    }
    try {
      const mode = macro.repeatMode ?? (macro.repeat === 1 ? 'once' : 'count');
      const repeats = mode === 'once' ? 1 : macro.repeat;
      const continuous = mode === 'toggle' || mode === 'held';
      for (let repeat = 0; continuous || repeat < repeats; repeat++) {
        for (const step of macro.steps) {
          controller.signal.throwIfAborted();
          if (step.type === 'delay') await delay(step.ms, undefined, { signal: controller.signal });
          else await this.bridge.call('tap', { keys: parseChord(step.value).virtualKeys });
        }
        controller.signal.throwIfAborted();
        // Keep stop commands responsive even for sequences without delay steps.
        if (continuous || repeat + 1 < repeats) await yieldTurn(undefined, { signal: controller.signal });
      }
      this.notify(`${macro.name} finished`);
    } catch (error) { this.notify(error.name === 'AbortError' ? 'Macro stopped' : error.message); }
    finally { signal?.removeEventListener('abort', release); this.running = null; this.runningMacroId = null; }
  }
}
module.exports = { MacroPlayer };
