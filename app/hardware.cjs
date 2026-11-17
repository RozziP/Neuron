const hid = require('node-hid');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { catalog } = require('./catalog.cjs');
const { packet, decode, bindingPacket, bindingFromReply } = require('./protocol.cjs');
const { parseChord } = require('./keys.cjs');
const { atomicWrite, validateProfile } = require('./store.cjs');
const { topControls, mouseActions, macroTriggers } = require('./controls.cjs');
const { validateDpi, dpiPacket, dpiFromReply, sameDpi } = require('./dpi.cjs');
const same = (a, b) => a.type === b.type && JSON.stringify(a.params) === JSON.stringify(b.params);
function actionsFor(profile) {
  const p = validateProfile(profile);
  if (p.model !== 0x0067 || ![7,12].includes(p.plate)) throw new Error('Hardware writes are currently available for Trinity 7- and 12-button plates. Other Naga drivers are pending verification.');
  const triggers = macroTriggers(p);
  const entries = p.bindings.map((binding,index)=>({binding,source:(p.plate===12 ? 0x40 : 0x50)+index}));
  for (const c of topControls) if(p.topBindings[c.id].type!=='default') entries.push({binding:p.topBindings[c.id],source:c.source});
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
  constructor(bridge, directory) { this.bridge = bridge; this.directory = directory; this.queue = Promise.resolve(); }
  serialize(fn) { const result = this.queue.then(fn); this.queue = result.catch(() => {}); return result; }
  async devices() {
    this.enumerated = await hid.devicesAsync();
    const all = this.enumerated.filter(d => d.vendorId === 0x1532), devices = [];
    for (const d of all) {
      const model = catalog.find(m => m.productId === d.productId);
      if (!model) continue;
      const id = `${d.productId}:${d.serialNumber || d.path.replace(/&MI_[0-9]+/i, '')}`;
      let device = devices.find(x => x.id === id);
      if (!device) { device = { ...model, id, serial: d.serialNumber, paths: [], connected: true }; devices.push(device); }
      device.paths.push({ path: d.path, interface: d.interface, usage: d.usage });
    }
    return devices;
  }
  async exchange(devicePath, request) {
    const response = await this.bridge.call('exchange', { path: devicePath, report: request.toString('base64') });
    return decode(Buffer.from(response.report, 'base64'), request);
  }
  async target(id) {
    const devices = await this.devices(), device = devices.find(d => d.id === id);
    if (!device) throw new Error('The selected Naga is disconnected.');
    if (device.productId !== 0x0067) throw new Error('This model is recognized; its hardware driver is not verified yet.');
    const control = device.paths.find(p => p.interface === 0 && p.usage === 2);
    if (!control) throw new Error('The Trinity control interface is unavailable.');
    return { ...device, path: control.path };
  }
  async read(device, slot, source) {
    return bindingFromReply(await this.exchange(device.path, packet(0x8c, [slot, source])), slot, source);
  }
  async readDpi(device) {
    return dpiFromReply(await this.exchange(device.path, dpiPacket()));
  }
  async inspectDpi(id) {
    return this.serialize(async () => this.readDpi(await this.target(id)));
  }
  async writeDpi(device, dpi) {
    const value = validateDpi(dpi);
    await this.exchange(device.path, dpiPacket(value));
    if (!sameDpi(await this.readDpi(device), value)) throw new Error('DPI readback does not match the requested sensitivity.');
  }
  async applyDpi(id, input) {
    const value = validateDpi(input);
    return this.serialize(async () => {
      const device = await this.target(id), before = await this.readDpi(device);
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
  backupFile(device) { return path.join(this.directory, 'backups', crypto.createHash('sha256').update(device.id).digest('hex').slice(0,24) + '.json'); }
  async inspect(id, plate = 12) {
    return this.serialize(async () => {
      const device = await this.target(id), bindings = [];
      if (![7,12].includes(plate)) throw new Error('Choose a 7- or 12-button Trinity plate.');
      for (let i = 0; i < plate; i++) bindings.push(await this.read(device, 1, (plate === 12 ? 0x40 : 0x50) + i));
      return { bindings, backupAvailable: fs.existsSync(this.backupFile(device)) };
    });
  }
  async apply(id, profile) {
    profile = validateProfile(profile);
    const actions = actionsFor(profile);
    return this.serialize(async () => {
      const device = await this.target(id), before = [];
      const file = this.backupFile(device);
      let backup = { version: 1, deviceId: device.id, created: new Date().toISOString(), entries: [] };
      if (fs.existsSync(file)) backup = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (backup.deviceId !== device.id || !Array.isArray(backup.entries)) throw new Error('Invalid original-settings backup.');

      // Default top controls remain untouched until explicitly rebound. Returning to
      // Default later restores the original value of each slot, not a guessed factory value.
      for (const c of topControls) if ((profile.topBindings?.[c.id]?.type || 'default') === 'default' && backup.entries.some(e=>e.source===c.source)) {
        actions.push({source:c.source,original:true});
      }
      for (const slot of [2,1]) for (const binding of actions) before.push({slot,source:binding.source,action:await this.read(device,slot,binding.source)});
      const targetAction = (binding, slot) => binding.original ? backup.entries.find(e=>e.source===binding.source && e.slot===slot)?.action : binding.action;
      if (actions.some(b=>[2,1].some(slot=>!targetAction(b,slot)))) throw new Error('Incomplete top-button backup. Restore the original backup before applying.');
      for (const entry of before) if (!backup.entries.some(e => e.slot === entry.slot && e.source === entry.source)) backup.entries.push(entry);
      atomicWrite(file, backup); // Durable original snapshot before the first device mutation.
      try {
        // Trinity requires a pending-slot write before the corresponding active-slot write,
        // even when the pending slot already has the target value.
        const changed = actions.filter(binding => [2,1].some(slot =>
          !same(before.find(e => e.slot === slot && e.source === binding.source).action, targetAction(binding,slot))));
        for (const slot of [2,1]) for (const binding of changed) await this.write(device, { slot, source:binding.source,action:targetAction(binding,slot) });

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
