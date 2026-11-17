const { contextBridge, ipcRenderer } = require('electron');
const call = async (name, ...args) => { const response = await ipcRenderer.invoke(name, ...args); if (!response.ok) throw new Error(response.error); return response.result; };
contextBridge.exposeInMainWorld('neuron', {
  games: () => call('games:get'), scanGames: () => call('games:scan'), addGame: id => call('games:add',id),
  createGame: (id,baseId,model,plate,executablePath,importFile=false) => call('games:create',id,baseId,model,plate,executablePath,importFile),
  saveMacros: macros => call('macros:save',macros),
  inspectDpi: id => call('devices:dpi', id),
  applyDpi: (id, value) => call('devices:dpi:apply', id, value),
  state: () => call('state:get'), scan: () => call('devices:scan'), inspect: (id, plate) => call('devices:inspect', id, plate),
  save: profile => call('profile:save', profile), create: (name, model, plate) => call('profile:new', name, model, plate),
  remove: id => call('profile:delete', id), export: profile => call('profile:export', profile), import: () => call('profile:import'),
  apply: (id, profile) => call('profile:apply', id, profile), restore: id => call('device:restore', id),
  stop: () => call('macro:stop'),
  onState: callback => { ipcRenderer.on('state', (_event, state) => callback(state)); },
  onNotice: callback => { ipcRenderer.on('notice', (_event, message) => callback(message)); }
});
