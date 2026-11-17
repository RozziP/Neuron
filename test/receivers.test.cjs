const test = require('node:test');
const assert = require('node:assert/strict');
const hid = require('node-hid');
const { discoverReceivers } = require('../app/receivers.cjs');
const { Hardware } = require('../app/hardware.cjs');
const { BatteryMonitor } = require('../app/battery.cjs');
const { trayState } = require('../app/tray.cjs');
const { collectReports } = require('../app/hardware-report.cjs');
const { automaticTarget } = require('../app/games.cjs');
const { newProfile } = require('../app/store.cjs');

// All eight collections from the submitted 0.1.1 Windows hardware report.
const records = [[0,1,6], [1,1,128], [1,12,1], [1,65282,2],
  [1,65283,0], [1,65284,2], [1,65285,0], [2,1,2]].map(([iface, usagePage, usage], index) => ({
  vendorId: 13652, productId: 62813, product: '2.4G Wireless Receiver',
  manufacturer: 'Compx', release: 768, interface: iface, usagePage, usage,
  path: `receiver-collection-${index}`, serialNumber: ''
}));

test('reported composite receiver is discovered once, without guessing its mouse model', () => {
  const devices = discoverReceivers(records);
  assert.equal(devices.length, 1);
  assert.equal(devices[0].name, 'Compx 2.4G Wireless Receiver');
  assert.equal(devices[0].driver, null);
  assert.equal(devices[0].buttons, undefined);
  assert.equal(devices[0].support, 'recognition-only');
  assert.equal(devices[0].paths[0].interface, 2);
  assert.equal(discoverReceivers([...records].reverse())[0].id, devices[0].id);
  assert.equal(discoverReceivers([...records, records[7]]).length, 1);
  assert.equal(discoverReceivers([...records, { ...records[7], path: 'second-receiver' }]).length, 2);
  assert.deepEqual(discoverReceivers(records.slice(0,7)), []);
  for (const override of [{vendorId: 0x1532}, {productId: 0xf55e}, {usagePage: 65282}, {usage: 6}, {interface: 1}, {path: ''}])
    assert.deepEqual(discoverReceivers([{...records[7], ...override}]), []);
});

test('enumeration preserves Naga identity and handles receiver disconnects', async t => {
  let connected = records;
  t.mock.method(hid, 'devicesAsync', async () => connected);
  const hardware = new Hardware(null, '');
  const receiver = (await hardware.devices())[0];
  const naga = {vendorId: 0x1532, productId: 0x0067, serialNumber: 'naga', path: 'naga-mouse', interface: 0, usage: 2};
  connected = [...records, naga, {...naga, path: 'naga-keyboard', interface: 1, usage: 6}];
  const devices = await hardware.devices();
  assert.equal(devices.length, 2);
  assert.equal(devices[0].id, '103:naga');
  assert.equal(devices[0].paths.length, 2);
  assert.equal(devices[1].id, receiver.id);
  assert.equal((await hardware.target(devices[0].id)).path, 'naga-mouse');
  connected = [];
  assert.deepEqual(await hardware.devices(), []);
  await assert.rejects(hardware.target(receiver.id), /disconnected/);
});

test('receiver cannot enter Razer configuration, battery or automatic profile paths', async () => {
  const [receiver] = discoverReceivers(records);
  let calls = 0;
  const hardware = new Hardware({call: async () => { calls++; throw new Error('Unexpected HID operation'); }}, '');
  hardware.devices = async () => [receiver];
  await assert.rejects(hardware.inspect(receiver.id), /model is unknown/);
  await assert.rejects(hardware.apply(receiver.id, newProfile()), /model is unknown/);
  await assert.rejects(hardware.inspectDpi(receiver.id), /model is unknown/);
  await assert.rejects(hardware.applyDpi(receiver.id, {x: 800, y: 800}), /model is unknown/);
  await assert.rejects(hardware.restore(receiver.id), /model is unknown/);
  await assert.rejects(hardware.readBattery(receiver), /not supported/);
  const monitor = new BatteryMonitor(hardware);
  await monitor.refresh([receiver]);
  assert.match(trayState([receiver], monitor).tooltip, /Compx.*Battery unavailable/);
  assert.doesNotMatch(monitor.status(receiver), /Wired/);
  assert.equal(calls, 0);
  const profile = {...newProfile(), model: receiver.productId, executable: 'Game.exe'};
  assert.equal(automaticTarget([profile], [receiver], null, {executable: 'Game.exe'}, null), null);
  const reports = collectReports(records, {appVersion: '0.1.2', platform: 'win32'});
  assert.equal(reports.length, 1, 'Recognition must not suppress reports for a mouse without a driver');
  assert.equal(reports[0].interfaces.length, 8);
});
