const { packet } = require('./protocol.cjs');
// Read-only protocol facts: OpenRazer razermouse_driver.c / razerchromacommon.c.
const batteryModels = new Map([
  [0x001f, 0xff], [0x003e, 0xff],
  [0x008f, 0x1f], [0x0090, 0x1f], [0x00a7, 0x1f], [0x00a8, 0x1f], [0x00b4, 0x1f]
]);
function batteryPacket(productId, charging = false) {
  if (!batteryModels.has(productId)) throw new Error('This mouse has no supported battery.');
  return packet(charging ? 0x84 : 0x80, [], 0x07, 2, batteryModels.get(productId));
}
function batteryFromReply(args, charging = false) {
  if (args.length < 2 || (charging && args[1] > 1)) throw new Error('Invalid battery response.');
  return charging ? args[1] === 1 : Math.round(args[1] * 100 / 255);
}
class BatteryMonitor {
  constructor(hardware) { this.hardware = hardware; this.cache = new Map(); }
  async refresh(devices, now = Date.now()) {
    const ids = new Set(devices.map(d => d.id));
    for (const id of this.cache.keys()) if (!ids.has(id)) this.cache.delete(id);
    for (const device of devices) {
      if (!batteryModels.has(device.productId)) continue;
      const previous = this.cache.get(device.id);
      if (previous && now - previous.checkedAt < 30000) continue;
      let value;
      try { value = await this.hardware.readBattery(device); }
      catch { value = { level: null, charging: null }; }
      this.cache.set(device.id, { ...value, checkedAt: now });
    }
  }
  status(device) {
    if (device.support === 'recognition-only') return 'Receiver detected · Battery unavailable';
    if (!batteryModels.has(device.productId)) return 'Wired · no battery';
    const battery = this.cache.get(device.id);
    if (!battery) return 'Reading battery…';
    if (battery.level === null) return 'Battery unavailable';
    return `Battery ${battery.level}%${battery.charging ? ' · Charging' : battery.charging === null ? ' · Charging status unavailable' : ''}`;
  }
}
module.exports = { batteryModels, batteryPacket, batteryFromReply, BatteryMonitor };
