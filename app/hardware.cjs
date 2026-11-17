const hid = require('node-hid');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { catalog } = require('./catalog.cjs');
const { discoverReceivers } = require('./receivers.cjs');
const { DeviceModels } = require('./device-models.cjs');
const { driverFor, sideSources, mappingCapabilities, pairedMouse } = require('./drivers.cjs');
const { packet, decode, bindingPacket, bindingFromReply, functionBlock } = require('./protocol.cjs');
const { parseChord } = require('./keys.cjs');
const { atomicWrite, validateProfile } = require('./store.cjs');
const { topControls, mouseActions, macroTriggers } = require('./controls.cjs');
const { validateDpi, dpiPacket, dpiFromReply, sameDpi } = require('./dpi.cjs');
const { batteryPacket, batteryFromReply } = require('./battery.cjs');
const same = (a, b) => JSON.stringify(functionBlock(a)) === JSON.stringify(functionBlock(b));
function actionsFor(profile) {
  const p = validateProfile(profile);
  const driver = driverFor({productId:p.model}), sources = sideSources(driver, p.plate);
  const triggers = macroTriggers(p);
  const entries = p.bindings.map((binding,index)=>({binding,source:sources[index]}));
  for (const c of topControls) if(p.topBindings[c.id].type!=='default') entries.push({binding:p.topBindings[c.id],source:driver.top[c.id]});
  return entries.map(({binding, source}) => {
    let action;
    if (binding.type === 'disabled') action = { type: 0, params: [] };
    else if (binding.type === 'macro') action = { type: 2, params: [0, triggers.find(t=>t.id===binding.value).hid] };
    else if (binding.type === 'mouse') { const a=mouseActions[binding.value]; action={type:a.type,params:[...a.params]}; }
    else { const key = parseChord(binding.value); action = { type: 2, params: [key.modifiers, key.hid] }; }
    return { source, action };
  });
}
class Hardware {
  constructor(bridge, directory) { this.bridge = bridge; this.directory = directory; this.queue = Promise.resolve(); this.models = new DeviceModels(directory); this.dockModels = new Map(); }
  serialize(fn) { const result = this.queue.then(fn); this.queue = result.catch(() => {}); return result; }
  async devices({ identify = true } = {}) {
    this.enumerated = await hid.devicesAsync();
    const all = this.enumerated.filter(d => d.vendorId === 0x1532), devices = [];
    for (const d of all) {
      const model = catalog.find(m => m.productId === d.productId);
      if (!model) continue;
      const id = `${d.productId}:${d.serialNumber || d.path.replace(/&MI_[0-9]+/i, '')}`;
      let device = devices.find(x => x.id === id);
      if (!device) { device = { ...model, vendorId: d.vendorId, id, serial: d.serialNumber, paths: [], connected: true }; devices.push(device); }
      device.paths.push({ path: d.path, interface: d.interface, usage: d.usage });
    }
    const receivers = discoverReceivers(this.enumerated).map(d => this.models.describe(d));
    for (const id of this.dockModels.keys()) if (!receivers.some(d => d.id === id)) this.dockModels.delete(id);
    for (const receiver of receivers) {
      if (receiver.connection !== 'dock' || receiver.modelSource === 'manual') continue;
      let known = this.dockModels.get(receiver.id);
      if (identify && this.bridge && (!known || Date.now() - known.checkedAt >= 30000)) {
        let modelId = null;
        try { modelId = pairedMouse(await this.serialize(() => this.exchange(receiver.paths[0].path, packet(0xbf, [], 0, 80)))); }
        catch { /* Some dock firmware cannot identify the paired mouse. Ask the user. */ }
        known = {modelId, checkedAt:Date.now()}; this.dockModels.set(receiver.id, known);
      }
      const model = catalog.find(m => m.productId === known?.modelId);
      if (model && [0x00a8,0x00e8].includes(model.productId)) Object.assign(receiver, {
        modelId:model.productId, modelSource:'automatic', transportName:receiver.name,
        name:`${model.name.replace(/ · .+$/, '')} · ${receiver.name}`
      });
    }
    return [...devices, ...receivers].map(d => ({...d, ...mappingCapabilities(d)}));
  }
  async selectModel(id, model) {
    const device = (await this.devices()).find(d => d.id === id);
    if (!device) throw new Error('The selected mouse or receiver is disconnected.');
    if (device.connection) device.support = 'recognition-only';
    this.models.select(device, model);
  }
  async exchange(devicePath, request) {
    const response = await this.bridge.call('exchange', { path: devicePath, report: request.toString('base64') });
    return decode(Buffer.from(response.report, 'base64'), request);
  }
  async readBattery(device) {
    return this.serialize(async () => {
      if (device.support === 'recognition-only' || (device.vendorId !== undefined && device.vendorId !== 0x1532))
        throw new Error('Battery readings are not supported for this receiver yet.');
      const control = device.paths.find(p => p.interface === 0 && p.usage === 2);
      if (!control) throw new Error('Battery control interface unavailable.');
      const level = batteryFromReply(await this.exchange(control.path, batteryPacket(device.modelId ?? device.productId)));
      let charging = device.productId === 0x00b4 ? false : null;
      if (charging !== false) {
        try { charging = batteryFromReply(await this.exchange(control.path, batteryPacket(device.modelId ?? device.productId, true)), true); }
        catch { /* Keep a valid level if this firmware cannot report charging. */ }
      }
      return { level, charging };
    });
  }
  async target(id) {
    // Called inside the operation queue: reuse dock identification instead of
    // nesting a queued probe inside a queued read/apply/restore.
    const devices = await this.devices({identify:false}), device = devices.find(d => d.id === id);
    if (!device) throw new Error('The selected mouse or receiver is disconnected.');
    if (device.support === 'recognition-only') throw new Error(device.supportMessage);
    if (device.vendorId !== 0x1532) throw new Error('No verified hardware driver for this device.');
    const driver = driverFor(device);
    if (!driver) throw new Error('This model is recognized; no remapping driver is available yet.');
    const control = device.paths.find(p => p.interface === 0 && p.usage === 2);
    if (!control) throw new Error('The mouse control interface is unavailable.');
    return { ...device, path: control.path, mappingDriver:driver };
  }
  async read(device, slot, source) {
    return bindingFromReply(await this.exchange(device.path, packet(0x8c, [slot, source])), slot, source, driverFor(device)?.raw);
  }
  async readDpi(device) {
    return dpiFromReply(await this.exchange(device.path, dpiPacket()));
  }
  async inspectDpi(id) {
    return this.serialize(async () => { const device = await this.target(id);
      if (device.productId !== 0x0067) throw new Error('DPI control is currently available for Trinity.');
      return this.readDpi(device); });
  }
  async writeDpi(device, dpi) {
    const value = validateDpi(dpi);
    await this.exchange(device.path, dpiPacket(value));
    if (!sameDpi(await this.readDpi(device), value)) throw new Error('DPI readback does not match the requested sensitivity.');
  }
  async applyDpi(id, input) {
    const value = validateDpi(input);
    return this.serialize(async () => {
      const device = await this.target(id);
      if (device.productId !== 0x0067) throw new Error('DPI control is currently available for Trinity.');
      const before = await this.readDpi(device);
      const file = this.backupFile(device);
      const backup = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, deviceId: device.id, created: new Date().toISOString(), entries: [] };
      if (backup.deviceId !== device.id || !Array.isArray(backup.entries)) throw new Error('Invalid original-settings backup.');
      if (!backup.dpi) backup.dpi = before;
      atomicWrite(file, backup);
      try {
        if (!sameDpi(before, value)) await this.writeDpi(device, value);
      } catch (error) {
        try { await this.writeDpi(device, before); }
        catch { throw new Error(error.message + ' Previous DPI could not be restored. Reconnect the mouse and use Restore original.'); }
        throw new Error(error.message + ' Previous DPI restored.');
      }
      return value;
    });
  }
  async write(device, entry) {
    // Some firmware silently drops writes. Never count an ACK alone as success.
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.exchange(device.path, bindingPacket(entry.slot, entry.source, entry.action));
        const stored = await this.read(device, entry.slot, entry.source);
        if (same(stored, entry.action)) return;
        last = new Error('Readback does not match the requested mapping.');
      } catch (error) { last = error; }
      await new Promise(r => setTimeout(r, 40 * (attempt + 1)));
    }
    throw new Error(`Button 0x${entry.source.toString(16)}: ${last.message}`);
  }
  backupFile(device) { return path.join(this.directory, 'backups', crypto.createHash('sha256').update(device.productId === 0x00a4 ? `${device.id}:${device.modelId}` : device.id).digest('hex').slice(0,24) + '.json'); }
  async inspect(id, plate = 12) {
    return this.serialize(async () => {
      const device = await this.target(id), bindings = [];
      const driver = driverFor(device);
      for (const source of sideSources(driver, plate)) bindings.push(await this.read(device, driver.readSlot, source));
      return { bindings, backupAvailable: fs.existsSync(this.backupFile(device)) };
    });
  }
  async apply(id, profile) {
    profile = validateProfile(profile);
    const actions = actionsFor(profile);
    return this.serialize(async () => {
      const device = await this.target(id), before = [], driver = driverFor(device);
      if (profile.model !== (device.modelId ?? device.productId)) throw new Error('This profile does not match the selected mouse.');
      const slots = driver.slots;
      const file = this.backupFile(device);
      let backup = { version: 1, deviceId: device.id, created: new Date().toISOString(), entries: [] };
      if (fs.existsSync(file)) backup = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (backup.deviceId !== device.id || !Array.isArray(backup.entries)) throw new Error('Invalid original-settings backup.');

      // Default top controls remain untouched until explicitly rebound. Returning to
      // Default later restores the original value of each slot, not a guessed factory value.
      for (const c of topControls) if ((profile.topBindings?.[c.id]?.type || 'default') === 'default' && backup.entries.some(e=>e.source===driver.top[c.id])) {
        actions.push({source:driver.top[c.id],original:true});
      }
      for (const slot of slots) for (const binding of actions) before.push({slot,source:binding.source,action:await this.read(device,slot,binding.source)});
      const targetAction = (binding, slot) => binding.original ? backup.entries.find(e=>e.source===binding.source && e.slot===slot)?.action : binding.action;
      if (actions.some(b=>slots.some(slot=>!targetAction(b,slot)))) throw new Error('Incomplete top-button backup. Restore the original backup before applying.');
      for (const entry of before) if (!backup.entries.some(e => e.slot === entry.slot && e.source === entry.source)) backup.entries.push(entry);
      atomicWrite(file, backup); // Durable original snapshot before the first device mutation.
      try {
        // Each adapter chooses its storage layers and write order. Trinity stages
        // pending before active; modern Pro models change only the live layer.
        const changed = actions.filter(binding => slots.some(slot =>
          !same(before.find(e => e.slot === slot && e.source === binding.source).action, targetAction(binding,slot))));
        for (const slot of slots) for (const binding of changed) await this.write(device, { slot, source:binding.source,action:targetAction(binding,slot) });

      } catch (error) {
        const failures = [];

        for (const entry of before) { try { await this.write(device, entry); } catch { failures.push(entry.source); } }
        throw new Error(`${error.message} ${failures.length ? 'Some settings could not be restored. Reconnect the mouse and use Restore original.' : 'Previous mappings restored.'}`);
      }
      return { message: `${actions.length} button mappings verified on your Naga.`, backupAvailable: true };
    });
  }
  async restore(id, { restoreDpi = false } = {}) {
    return this.serialize(async () => {
      const device = await this.target(id), file = this.backupFile(device);
      if (!fs.existsSync(file)) throw new Error('No original-settings backup exists for this mouse.');
      const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (backup.deviceId !== device.id || !Array.isArray(backup.entries) || (!backup.entries.length && !backup.dpi)) throw new Error('Invalid original-settings backup.');
      for (const entry of backup.entries) await this.write(device, entry);
      if (restoreDpi && backup.dpi) await this.writeDpi(device, validateDpi(backup.dpi));
      return { message: `Original mappings${restoreDpi && backup.dpi ? ' and DPI' : ''} restored and verified.` };
    });
  }
}
module.exports = { Hardware, actionsFor, same };
