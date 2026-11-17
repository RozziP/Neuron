const fs = require('node:fs');
const path = require('node:path');
const { catalog } = require('./catalog.cjs');
const { atomicWrite } = require('./store.cjs');

// Local per-connection choices. Never substitute a model ID for a transport PID.
class DeviceModels {
  constructor(directory) {
    this.file = path.join(directory, 'device-models.json');
    this.models = {};
    this.preferredModel = null;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (data.version === 1 && catalog.some(m => m.productId === data.preferredModel)) this.preferredModel = data.preferredModel;
      if (data.version === 1 && data.models && typeof data.models === 'object' && !Array.isArray(data.models))
        for (const [id, model] of Object.entries(data.models))
          if (catalog.some(m => m.productId === model)) Object.defineProperty(this.models, id, {value:model, enumerable:true, configurable:true, writable:true});
    } catch { /* Detection remains available when preferences cannot be read. */ }
  }
  select(device, model) {
    if (!device || device.support !== 'recognition-only') throw new Error('Select a detected receiver or dock.');
    if (model !== null && !catalog.some(m => m.productId === model)) throw new Error('Select a valid mouse model.');
    const next = { ...this.models };
    if (model === null) delete next[device.id];
    else next[device.id] = model;
    atomicWrite(this.file, {version:1, models:next, preferredModel:this.preferredModel});
    this.models = next;
  }
  prefer(model) {
    if (!catalog.some(m => m.productId === model)) throw new Error('Select a valid mouse model.');
    atomicWrite(this.file, {version:1, models:this.models, preferredModel:model});
    this.preferredModel = model;
  }
  describe(device) {
    const model = device.support === 'recognition-only' && catalog.find(m => m.productId === this.models[device.id]);
    if (!model) return device;
    const mouseName = model.name.replace(/ · .+$/, '');
    return {...device, modelId:model.productId, modelSource:'manual', transportName:device.name,
      name:`${mouseName} · ${device.name}`,
      supportMessage:`${mouseName} selected manually for ${device.name}. Button mapping, DPI, macros, and battery readings through this connection are not supported yet.`};
  }
}
module.exports = { DeviceModels };
