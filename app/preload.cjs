const { contextBridge, ipcRenderer } = require('electron');
let mouseWorkspaceKey = null;
ipcRenderer.on('state', (_event,state) => { mouseWorkspaceKey=state.selectedMouse?.key || null; });
const call = async (name, ...args) => { const response = await ipcRenderer.invoke(name, {workspaceKey:mouseWorkspaceKey,args}); if (!response.ok) throw new Error(response.error); if(response.result?.selectedMouse)mouseWorkspaceKey=response.result.selectedMouse.key; return response.result; };
contextBridge.exposeInMainWorld('neuron', {
  selectMouse: key => call('workspace:select', key),
  updates: () => call('updates:get'), checkUpdates: () => call('updates:check'), installUpdate: () => call('updates:install'),
  downloadUpdate: () => call('updates:download'), cancelUpdate: () => call('updates:cancel'),
  onUpdates: callback => { ipcRenderer.on('updates', (_event, status) => callback(status)); },
  games: () => call('games:get'), scanGames: () => call('games:scan'), addGame: id => call('games:add',id),
  createGame: (id,baseId,model,plate,executablePath,importFile=false) => call('games:create',id,baseId,model,plate,executablePath,importFile),
  saveMacros: macros => call('macros:save',macros),
  inspectDpi: id => call('devices:dpi', id),
  applyDpi: (id, value) => call('devices:dpi:apply', id, value),
  state: () => call('state:get'), scan: () => call('devices:scan'), inspect: (id, plate) => call('devices:inspect', id, plate),
  selectDeviceModel: (id, model) => call('devices:model', id, model),
  preferMouseModel: model => call('devices:prefer-model', model),
  confirmHardware: (key,modelName) => call('hardware:confirm',key,modelName),
  openHardwareIssue: key => call('hardware:open-issue',key),
  save: profile => call('profile:save', profile), create: (name, model, plate) => call('profile:new', name, model, plate),
  remove: id => call('profile:delete', id), export: profile => call('profile:export', profile), import: () => call('profile:import'),
  apply: (id, profile) => call('profile:apply', id, profile), restore: id => call('device:restore', id),
  saveOnboard: (id, profile) => call('profile:onboard', id, profile),
  stop: () => call('macro:stop'),
  onState: callback => { ipcRenderer.on('state', (_event, state) => callback(state)); },
  onNotice: callback => { ipcRenderer.on('notice', (_event, message) => callback(message)); }
});
