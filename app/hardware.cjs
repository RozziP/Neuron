const hid = require('node-hid');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { catalog } = require('./catalog.cjs');
const { discoverReceivers } = require('./receivers.cjs');
const { DeviceModels } = require('./device-models.cjs');
const { driverFor, sideSources, mappingCapabilities, pairedMouse, dockModels } = require('./drivers.cjs');
const {controlsFor,sideLabels} = require('./razer-layouts.cjs');
const { packet, decode, bindingPacket, bindingFromReply, functionBlock } = require('./protocol.cjs');
const { parseChord } = require('./keys.cjs');
const { atomicWrite, validateProfile } = require('./store.cjs');
const { topControls, mouseActions, macroTriggers } = require('./controls.cjs');
const { dpiCapabilities, dpiWriteStorage, validateDpi, dpiPacket, dpiFromReply, sameDpi } = require('./dpi.cjs');
const { batteryPacket, batteryFromReply } = require('./battery.cjs');
const redragon = require('./redragon.cjs');
const same = (a, b) => JSON.stringify(functionBlock(a)) === JSON.stringify(functionBlock(b));
function actionsFor(profile) {
  const p = validateProfile(profile);
  const driver = driverFor({productId:p.model}), sources = sideSources(driver, p.plate);
  const triggers = macroTriggers(p);
  const entries = p.bindings.map((binding,index)=>({binding,source:sources[index]})).filter(e=>e.binding.type!=='default');
  for (const c of topControls) if(p.topBindings[c.id].type!=='default') {
    if(!Number.isInteger(driver.top[c.id]))throw new Error(`${c.name} is absent or fixed on this model. Set it to Original before applying.`);
    entries.push({binding:p.topBindings[c.id],source:driver.top[c.id]});
  }
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
  constructor(bridge, directory) { this.bridge = bridge; this.directory = directory; this.queue = Promise.resolve(); this.models = new DeviceModels(directory); this.dockModels = new Map(); this.redragonModels = new Map(); this.openRedragon = redragon.open; }
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
    for (const id of this.redragonModels.keys()) if(!receivers.some(d=>d.id===id)) this.redragonModels.delete(id);
    for (const receiver of receivers.filter(d=>d.vendorId===0x3554)) {
      let known=this.redragonModels.get(receiver.id);
      if(identify && (!known || Date.now()-known.checkedAt>=30000)) {
        let verified=false;
        try { await this.serialize(async()=>{const session=await this.openRedragon(receiver);try{verified=true;}finally{await session.close();}}); } catch { /* Sleep or another Compx model: keep controls disabled. */ }
        known={verified,checkedAt:Date.now()};this.redragonModels.set(receiver.id,known);
      }
      if(known?.verified && (receiver.modelSource!=='manual' || receiver.modelId===redragon.MODEL)) Object.assign(receiver,{modelId:redragon.MODEL,modelVerified:true,modelSource:receiver.modelSource||'automatic',name:'Redragon M990-WL',transportName:receiver.name});
    }
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
      if (model && dockModels.includes(model.productId)) Object.assign(receiver, {
        modelId:model.productId, modelSource:'automatic', transportName:receiver.name,
        name:`${model.name.replace(/ · .+$/, '')} · ${receiver.name}`
      });
    }
    return [...devices, ...receivers].map(d => ({...d, ...mappingCapabilities(d), dpi:dpiCapabilities(d)}));
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
      if(device.vendorId===0x3554 && device.modelId===redragon.MODEL && device.modelVerified) {
        const session=await this.openRedragon(device);try{return await session.battery();}finally{await session.close();}
      }
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
    if (device.vendorId === 0x3554 && driverFor(device)) return {...device,mappingDriver:driverFor(device)};
    if (device.vendorId !== 0x1532) throw new Error('No verified hardware driver for this device.');
    const driver = driverFor(device);
    if (!driver) throw new Error('This model is recognized; no remapping driver is available yet.');
    const control = device.paths.find(p => p.interface === 0 && p.usage === 2);
    if (!control) throw new Error('The mouse control interface is unavailable.');
    return { ...device, path: control.path, mappingDriver:driver };
  }
  async read(device, slot, source) {
    const driver=driverFor(device);
    return bindingFromReply(await this.exchange(device.path, packet(0x8c, [slot, source],2,driver?.requestSize??10,driver?.transaction??0x1f)), slot, source, driver?.raw, driver?.readLayout);
  }
  async readDpi(device) {
    const limits = dpiCapabilities(device);
    if (!limits) throw new Error('DPI control is available for supported Naga models on supported USB connections.');
    return dpiFromReply(await this.exchange(device.path, dpiPacket()), limits);
  }
  async inspectDpi(id) {
    return this.serialize(async () => { const device = await this.target(id);
      return this.readDpi(device); });
  }
  async writeDpi(device, dpi) {
    const limits = dpiCapabilities(device), value = validateDpi(dpi, limits);
    await this.exchange(device.path, dpiPacket(value, limits, dpiWriteStorage(device)));
    if (!sameDpi(await this.readDpi(device), value)) throw new Error('DPI readback does not match the requested sensitivity.');
  }
  async applyDpi(id, input) {
    return this.serialize(async () => {
      const device = await this.target(id);
      if (!dpiCapabilities(device)) throw new Error('DPI control is available for supported Naga models on supported USB connections.');
      const value = validateDpi(input, dpiCapabilities(device));
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
        const driver=driverFor(device);
        await this.exchange(device.path, bindingPacket(entry.slot, entry.source, entry.action,driver?.requestSize??10,driver?.transaction??0x1f));
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
      if(device.vendorId===0x3554) {
        if(plate!==16) throw new Error('The M990-WL has 16 side buttons.');
        const session=await this.openRedragon(device);
        try { const snapshot=await session.snapshot();return {bindings:Array.from({length:16},(_,i)=>({type:snapshot.keys[i*4],params:snapshot.keys.slice(i*4+1,i*4+3)})),backupAvailable:fs.existsSync(this.backupFile(device))}; }
        finally {await session.close();}
      }
      const driver = driverFor(device);
      const controls=[],sources=sideSources(driver,plate),names=sideLabels(plate);
      const physical=[...sources.map((source,i)=>({source,name:names[i],editable:true,side:true})),...controlsFor(device.modelId??device.productId)];
      for(const c of physical) {
        if(!c.editable) {controls.push({...c,status:'fixed'});continue;}
        try { const binding=await this.read(device,driver.readSlot,c.source);controls.push({...c,status:'readable',binding});if(c.side)bindings.push(binding); }
        catch(error) {controls.push({...c,status:'unavailable',error:error.message});if(c.side)bindings.push({type:null,params:[],error:error.message});}
      }
      return { bindings,controls,backupAvailable: fs.existsSync(this.backupFile(device)) };
    });
  }
  async apply(id, profile) {
    profile = validateProfile(profile);
    if(profile.model===redragon.MODEL) return this.serialize(()=>this.applyRedragon(id,profile));
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
      const sources=sideSources(driver,profile.plate);
      profile.bindings.forEach((b,i)=>{if(b.type==='default'&&backup.entries.some(e=>e.source===sources[i]))actions.push({source:sources[i],original:true});});
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
      return { message: `${actions.length} button mappings verified on your mouse.`, backupAvailable: true };
    });
  }
  async restore(id, { restoreDpi = false } = {}) {
    return this.serialize(async () => {
      const device = await this.target(id), file = this.backupFile(device);
      if(device.vendorId===0x3554) return this.applyRedragon(id,null,device);
      if (!fs.existsSync(file)) throw new Error('No original-settings backup exists for this mouse.');
      const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (backup.version!==1 || backup.deviceId !== device.id || !Array.isArray(backup.entries)) throw new Error('Invalid original-settings backup.');
      for (const entry of backup.entries) await this.write(device, entry);
      if (restoreDpi && backup.dpi) await this.writeDpi(device, validateDpi(backup.dpi, dpiCapabilities(device)));
      return { message: `Original mappings${restoreDpi && backup.dpi ? ' and DPI' : ''} restored and verified.` };
    });
  }
  async applyRedragon(id,profile,target) {
    const device=target || await this.target(id);
    if(device.vendorId!==0x3554 || !driverFor(device)) throw new Error('This profile does not match the selected mouse.');
    const session=await this.openRedragon(device);
    try {
      const before=await session.snapshot(), file=this.backupFile(device);
      let backup=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
      if(backup && (backup.version!==2 || backup.deviceId!==id || backup.model!==redragon.MODEL || !redragon.validSnapshot(backup.original))) throw new Error('Invalid Redragon original-settings backup.');
      if(backup && backup.original.config!==before.config) throw new Error('Switch the Redragon back to its original onboard profile before applying or restoring.');
      if(!profile && !backup) throw new Error('No original-settings backup exists for this mouse.');
      const next=profile?redragon.desired(profile,before):{...backup.original,config:before.config};
      if(!backup) {backup={version:2,deviceId:id,model:redragon.MODEL,created:new Date().toISOString(),original:before};atomicWrite(file,backup);}
      try { await redragon.transfer(session,before,next); }
      catch(error) {
        try {
          // Restore every possibly touched mapping, including a partially written shortcut.
          await session.write(0x100,before.shortcuts);await session.write(0x60,before.keys);await session.reload(before.config);
        } catch {throw new Error(error.message+' Original settings are backed up. Reconnect the mouse and use Restore original.');}
        throw new Error(error.message+' Previous mappings restored.');
      }
      return {message:profile?'16 Redragon side-button mappings verified.':'Original Redragon mappings restored and verified.',backupAvailable:true};
    } finally {await session.close();}
  }
}
module.exports = { Hardware, actionsFor, same };
