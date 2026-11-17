const test = require('node:test');
const assert = require('node:assert/strict');
const { batteryPacket, batteryFromReply, BatteryMonitor } = require('../app/battery.cjs');
const { checksum, decode } = require('../app/protocol.cjs');
const { Hardware } = require('../app/hardware.cjs');
const { trayState, trayPixels } = require('../app/tray.cjs');
const device = { id: 'wireless', productId: 0x0090, name: 'Naga Pro', paths: [{ path: 'control', interface: 0, usage: 2 }] };

test('battery reads use model-specific transactions and validate replies', () => {
  for (const id of [0x001f, 0x003e, 0x008f, 0x0090, 0x00a7, 0x00a8, 0x00b4]) {
    const request = batteryPacket(id);
    assert.equal(request[1], [0x001f, 0x003e].includes(id) ? 0xff : 0x1f);
    assert.deepEqual([...request.subarray(5, 10)], [2, 7, 0x80, 0, 0]);
    assert.equal(request[88], checksum(request));
    assert.equal(batteryPacket(id, true)[7], 0x84);
  }
  assert.throws(() => batteryPacket(0x0067));
  for (const [raw, expected] of [[0, 0], [128, 50], [255, 100]]) assert.equal(batteryFromReply(Buffer.from([0, raw])), expected);
  assert.equal(batteryFromReply(Buffer.from([0, 1]), true), true);
  assert.equal(batteryFromReply(Buffer.from([0, 0]), true), false);
  assert.throws(() => batteryFromReply(Buffer.from([0])));
  assert.throws(() => batteryFromReply(Buffer.from([0, 2]), true));
  const request = batteryPacket(device.productId), reply = Buffer.from(request);
  reply[0] = 2; reply[5] = 1; reply[88] = checksum(reply);
  assert.throws(() => decode(reply, request), /Incomplete battery/);
});

test('battery operations serialize with writes and preserve level when charging read fails', async () => {
  const h = new Hardware(null, ''), calls = [];
  let release;
  const pendingWrite = h.serialize(() => new Promise(resolve => { release = resolve; }));
  h.exchange = async (path, report) => {
    calls.push(report[7]); assert.equal(path, 'control');
    if (report[7] === 0x84) throw new Error('Unsupported charging');
    return Buffer.from([0, 128]);
  };
  const read = h.readBattery(device);
  await Promise.resolve(); assert.deepEqual(calls, []);
  release(); await pendingWrite;
  assert.deepEqual(await read, { level: 50, charging: null });
  assert.deepEqual(calls, [0x80, 0x84]);
  calls.length = 0;
  assert.deepEqual(await h.readBattery({ ...device, productId: 0x00b4 }), { level: 50, charging: false });
  assert.deepEqual(calls, [0x80]);
  await assert.rejects(h.readBattery({ ...device, paths: [] }), /interface/);
});

test('battery polling throttles reads, clears failures and refreshes after reconnect', async () => {
  let calls = 0, fail = false;
  const monitor = new BatteryMonitor({ readBattery: async () => { calls++; if (fail) throw new Error('Asleep'); return { level: 75, charging: true }; } });
  const wired = { id: 'wired', productId: 0x0067, name: 'Naga Trinity' };
  await monitor.refresh([device, wired], 0);
  assert.equal(calls, 1);
  assert.equal(monitor.status(wired), 'Wired · no battery');
  assert.equal(monitor.status(device), 'Battery 75% · Charging');
  await monitor.refresh([device], 29999); assert.equal(calls, 1);
  fail = true; await monitor.refresh([device], 30000);
  assert.equal(monitor.status(device), 'Battery unavailable');
  assert.equal(trayState([device], monitor).level, null);
  await monitor.refresh([], 30001); assert.equal(monitor.cache.size, 0);
  fail = false; await monitor.refresh([device], 30002); assert.equal(calls, 3);
  assert.equal(trayState([wired, device], monitor, wired.id).level, 75);
  assert.match(trayState([], monitor).tooltip, /No mouse or receiver detected/);
});

test('tray uses the active wireless device, includes all devices and renders 0–100 distinctly', () => {
  const monitor = new BatteryMonitor(null), second = { ...device, id: 'second', name: 'Naga V2 Pro' };
  monitor.cache.set(device.id, { level: 0, charging: false });
  monitor.cache.set(second.id, { level: 100, charging: true });
  assert.equal(trayState([device, second], monitor).level, 0);
  const status = trayState([device, second], monitor, second.id);
  assert.equal(status.level, 100); assert.equal(status.charging, true);
  assert.match(status.tooltip, /Naga Pro: Battery 0%/);
  assert.match(status.tooltip, /Naga V2 Pro: Battery 100% · Charging/);
  assert.equal(new Set([null, 0, 1, 20, 50, 99, 100].map(level => trayPixels(level).toString('hex'))).size, 7);
  assert.notDeepEqual(trayPixels(50), trayPixels(50, true));
  assert.equal(trayPixels(100).length, 32 * 32 * 4);
});
