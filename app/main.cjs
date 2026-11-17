const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, globalShortcut } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { Bridge } = require('./bridge.cjs');
const { Store, newProfile, validateProfile } = require('./store.cjs');
const { Hardware } = require('./hardware.cjs');
const { catalog } = require('./catalog.cjs');
const { MacroPlayer } = require('./macros.cjs');
const { topControls, mouseActions, macroTriggers } = require('./controls.cjs');
const { GameLibrary, createGameProfile, automaticTarget } = require('./games.cjs');
const { HardwareReporter } = require('./hardware-reporting.cjs');
const reportingConfig = require('./reporting-config.json');
const os = require('node:os');
const dpiSmoke = process.argv.includes('--dpi-smoke-test');
const smoke = dpiSmoke || process.argv.includes('--smoke-test');
if (smoke) {
  const root = process.env.NEURON_SMOKE_DIR || (app.isPackaged ? path.join(app.getPath('temp'), 'neuron-smoke') : path.join(__dirname, '../artifacts'));
  app.setPath('userData', path.join(root, `smoke-data-${Date.now()}`));
}
app.setName('Neuron');
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.exit(0);
let window, tray, bridge, store, hardware, player, timer, library, reporter;
let devices = [], active = null, applying = false, auto = true, quitting = false, fallbackId = null, lastError = '', autoCandidate = '', autoSince = 0, retryAfter = 0;
const registered = new Set();
const heldTriggers = new Set();
const rendererURL = pathToFileURL(path.join(__dirname, '../ui/index.html')).href;
function notify(message) { if (window && !window.isDestroyed()) window.webContents.send('notice', message); }
function state() { return { profiles: store.profiles, macros: store.macros, devices: devices.map(({ paths, ...d }) => d), catalog, topControls, mouseActions, active: active && { profileId: active.profile.id, deviceId: active.deviceId, profile: active.profile }, applying, auto, error: lastError || store.warning }; }
function changed() { if (window && !window.isDestroyed()) window.webContents.send('state', state()); }
function clearShortcuts() { for (const key of registered) globalShortcut.unregister(key); registered.clear(); heldTriggers.clear(); }
async function waitForRelease(key) {
  const virtualKey = 111 + Number(key.slice(1));
  try {
    while (!quitting && heldTriggers.has(key)) {
      await new Promise(resolve => setTimeout(resolve, 25));
      if (!(await bridge.call('keyDown', { key: virtualKey })).down) break;
    }
  } catch(error) { notify(error.message); }
  finally { heldTriggers.delete(key); }
}
function reserveShortcuts(profile) {
  const added = [];
  const needed = macroTriggers(profile).map(t=>t.key);
  if (needed.length) needed.push('Control+Alt+Escape');
  try {
    for (const key of needed) if (!registered.has(key)) {
      const success = globalShortcut.register(key, () => {
        if (key === 'Control+Alt+Escape') { player.stop(); return; }
        if (applying || !active || heldTriggers.has(key)) return;
        heldTriggers.add(key); void waitForRelease(key);
        const trigger = macroTriggers(active.profile).find(t=>t.key===key);
        if (trigger) {
          const macro = active.profile.macros.find(m => m.id === trigger.id);
          if (macro) void player.play(macro);
        }
      });
      if (!success) throw new Error(`${key} is used by another app. Close that app before enabling macros.`);
      registered.add(key); added.push(key);
    }
  } catch(error) { for (const key of added) { globalShortcut.unregister(key); registered.delete(key); } throw error; }
  return { added, needed: new Set(needed) };
}
async function applyProfile(deviceId, input) {
  if (applying) throw new Error('Wait for the current device operation to finish.');
  const profile = validateProfile(input);
  if (active && active.deviceId !== deviceId) throw new Error('Restore the active mouse before switching to another device.');
  applying = true; changed(); player.stop();
  let reservation;
  try {
    reservation = reserveShortcuts(profile);
    const result = await hardware.apply(deviceId, profile);
    active = { deviceId, profile: structuredClone(profile) };
    if (!profile.executable) fallbackId = profile.id;
    for (const key of [...registered]) if (!reservation.needed.has(key)) { globalShortcut.unregister(key); registered.delete(key); }
    lastError = ''; notify(result.message); return result;
  } catch (error) {
    if (reservation) for (const key of reservation.added) { globalShortcut.unregister(key); registered.delete(key); }
    lastError = error.message; throw error;
  } finally { applying = false; changed(); }
}
async function restoreDevice(id, options) {
  if (applying) throw new Error('Wait for the current device operation to finish.');
  applying = true; player.stop(); changed();
  try {
    const result = await hardware.restore(id, options);
    if (active?.deviceId === id) { active = null; clearShortcuts(); }
    notify(result.message); lastError = ''; return result;
  } finally { applying = false; changed(); }
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== rendererURL) throw new Error('Untrusted IPC sender.');
    try { return { ok: true, result: await fn(...args) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
}
async function poll() {
  if (applying || quitting) return;
  try {
    const next = await hardware.devices();
    if (reporter) void reporter.tick(hardware.enumerated).catch(() => {});
    if (JSON.stringify(next) !== JSON.stringify(devices)) {
      devices = next;
      if (active && !devices.some(d => d.id === active.deviceId)) { player.stop(); notify('Naga disconnected. Game profiles resume automatically after reconnecting.'); clearShortcuts(); active = null; }
      changed();
    }
    if (Date.now()<retryAfter) return;
    const foreground = await bridge.call('foreground');
    const target=automaticTarget(store.profiles,devices,active,foreground,fallbackId);
    if(!target){autoCandidate='';return;}
    const identity=target.deviceId+':'+(target.restore?'restore':target.profile.id);
    if(autoCandidate!==identity){autoCandidate=identity;autoSince=Date.now();return;}
    if(Date.now()-autoSince>=1200) {
      if(target.restore)await restoreDevice(target.deviceId);
      else { await applyProfile(target.deviceId,target.profile); notify('Switched to '+target.profile.name); }
      autoCandidate='';
    }
  } catch(error) { retryAfter=Date.now()+5000; lastError=error.message; changed(); }
}
app.whenReady().then(async () => {
  bridge = new Bridge(); store = new Store(app.getPath('userData'));
  library = new GameLibrary(app.getPath('userData'));
  hardware = new Hardware(bridge, app.getPath('userData')); player = new MacroPlayer(bridge, notify);
  devices = await hardware.devices(); fallbackId = store.profiles.find(p => !p.executable)?.id;
  window = new BrowserWindow({ width: 1380, height: 900, minWidth: 1080, minHeight: 730, backgroundColor: '#0d1015', title: 'Neuron', show: false,
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#0d1015', symbolColor: '#9da8b8', height: 38 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  handle('state:get', () => state());
  handle('games:get', () => library.data);
  handle('games:scan', () => library.scan());
  handle('games:add', async id => {
    if (id && !library.data.games.some(g=>g.id===id)) throw new Error('Game not found.');
    const result = await dialog.showOpenDialog(window, { title: 'Choose the game executable', filters: [{name:'Game executable',extensions:['exe']}], properties:['openFile'] });
    if (result.canceled) return null;
    return library.add(result.filePaths[0],null,id);
  });
  handle('games:create', async (id, baseId, model, plate, executablePath, importFile) => {
    const game=library.data.games.find(g=>g.id===id);
    if (!game) throw new Error('Game not found. Scan your library again.');
    let base=baseId ? store.profiles.find(p=>p.id===baseId && !p.gameId) : null;
    if (baseId && !base) throw new Error('Standard profile not found.');
    if (importFile) {
      const result=await dialog.showOpenDialog(window,{title:'Import a Neuron profile for this game',filters:[{name:'Neuron profile',extensions:['json']}],properties:['openFile']});
      if(result.canceled)return null;
      if(fs.statSync(result.filePaths[0]).size>256000)throw new Error('Profile file exceeds 256 KB.');
      const data=JSON.parse(fs.readFileSync(result.filePaths[0],'utf8'));
      if(data.version!==1)throw new Error('Unsupported profile format.');
      base=validateProfile(data.profile);
    }
    const profile=store.save(createGameProfile(game,base,model,plate,executablePath)); changed(); return profile;
  });
  handle('devices:scan', async () => { devices = await hardware.devices(); changed(); return state(); });
  handle('devices:dpi:apply', async (id, value) => {
    if (applying) throw new Error('A device operation is already running.');
    applying = true; changed();
    try { return await hardware.applyDpi(id, value); }
    finally { applying = false; changed(); }
  });
  handle('devices:dpi', id => { if (applying) throw new Error('A device operation is already running.'); return hardware.inspectDpi(id); });
  handle('devices:inspect', (id, plate) => { if (applying) throw new Error('A device operation is already running.'); return hardware.inspect(id, plate); });
  handle('macros:save', input => { const macros=store.saveMacros(input); player.stop(); if(active)active.profile.macros=structuredClone(macros); changed(); return macros; });
  handle('profile:save', input => { const p = store.save(input); changed(); return p; });
  handle('profile:new', (name, model, plate) => { const p = store.save(newProfile(name, model, plate)); changed(); return p; });
  handle('profile:delete', id => {
    if (active?.profile.id === id) throw new Error('Restore the mouse or apply another profile before deleting this one.');
    store.remove(id); changed();
  });
  handle('profile:export', async input => {
    const profile = validateProfile(input);
    const result = await dialog.showSaveDialog(window, { defaultPath: `${profile.name.replace(/[^\w-]/g, '_')}.neuron.json`, filters: [{ name: 'Neuron profile', extensions: ['json'] }] });
    if (!result.canceled) fs.writeFileSync(result.filePath, JSON.stringify({ version: 1, profile }, null, 2));
    return !result.canceled;
  });
  handle('profile:import', async () => {
    const result = await dialog.showOpenDialog(window, { filters: [{ name: 'Neuron profile', extensions: ['json'] }], properties: ['openFile'] });
    if (result.canceled) return null;
    if (fs.statSync(result.filePaths[0]).size > 256000) throw new Error('Profile file exceeds 256 KB.');
    const data = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
    if (data.version !== 1) throw new Error('Unsupported profile format.');
    const profile = store.save({ ...data.profile, id: randomUUID(), gameId:'', gameName:'', executable:'', executablePath:'' }); changed(); return profile;
  });
  handle('profile:apply', (id, input) => {
    if (applying) throw new Error('Wait for the current device operation to finish.');
    const profile = store.save(input); changed(); return applyProfile(id, profile);
  });
  handle('device:restore', id => restoreDevice(id, { restoreDpi: true }));
  handle('macro:stop', () => player.stop());
  handle('window:minimize', () => window.minimize());
  // Construct a crisp native tray icon without external assets.
  const pixels = Buffer.alloc(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const lit = (x >= 7 && x <= 10 && y >= 7 && y <= 25) || (x >= 21 && x <= 24 && y >= 7 && y <= 25) || (Math.abs(y - x) <= 2 && x > 8 && x < 23);
    const i = (y * 32 + x) * 4; pixels[i] = lit ? 180 : 21; pixels[i+1] = lit ? 235 : 16; pixels[i+2] = lit ? 124 : 13; pixels[i+3] = 255;
  }
  tray = new Tray(nativeImage.createFromBitmap(pixels, { width: 32, height: 32 })); tray.setToolTip('Neuron · Naga control');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Neuron', click: () => { window.show(); window.focus(); } }, { label: 'Stop macro', click: () => player.stop() }, { type: 'separator' }, { label: 'Restore mappings and quit', click: () => app.quit() }]));
  tray.on('double-click', () => { window.show(); window.focus(); });
  window.on('close', event => { if (!quitting && !smoke) { event.preventDefault(); window.hide(); } });
  await window.loadFile(path.join(__dirname, '../ui/index.html'));
  window.show();
  if (smoke) { await require(dpiSmoke ? '../scripts/dpi-smoke.cjs' : '../scripts/smoke.cjs').run(window, app, hardware); return; }
  try {
    reporter = new HardwareReporter({ directory: app.getPath('userData'), ...reportingConfig,
      system: { appVersion: app.getVersion(), platform: process.platform, osVersion: os.release(), architecture: process.arch } });
    void reporter.tick(hardware.enumerated).catch(() => {});
  } catch { /* Reporting configuration must never prevent using the app. */ }
  void library.scan().catch(error=>notify('Game scan: '+error.message));
  let polling = false;
  timer = setInterval(async () => { if (polling) return; polling = true; try { await poll(); } finally { polling = false; } }, 1000);
}).catch(error => { console.error(error); if (!smoke) dialog.showErrorBox('Neuron could not start', error.message); app.exit(1); });
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault();
  if (applying) { notify('Wait for the device operation to finish before quitting.'); return; }
  auto = false; player?.stop();
  (async () => {
    try {
      if (active) await restoreDevice(active.deviceId);
      quitting = true; clearInterval(timer); clearShortcuts(); bridge?.close(); tray?.destroy(); app.quit();
    } catch(error) { window?.show(); dialog.showErrorBox('Reconnect your Naga to restore it', `${error.message}\nOriginal settings are backed up locally. Reconnect the mouse and try Restore mappings and quit again.`); }
  })();
});
app.on('window-all-closed', () => { if (smoke) app.quit(); });
app.on('activate', () => window?.show());
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
