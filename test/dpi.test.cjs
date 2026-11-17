const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, newProfile, validateProfile } = require('../app/store.cjs');
const { Hardware } = require('../app/hardware.cjs');
const { dpiPacket, dpiFromReply } = require('../app/dpi.cjs');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuron-dpi-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const h = new Hardware(null, dir), device = { id: 'dpi-trinity', path: 'fixture' };
  let dpi = { x: 1800, y: 2000 };
  const writes = [], bindings = new Map();
  h.target = async () => device;
  h.read = async (_d, slot, source) => bindings.get(`${slot}:${source}`) || { type: 2, params: [0, 30] };
  h.write = async (_d, entry) => bindings.set(`${entry.slot}:${entry.source}`, entry.action);
  h.exchange = async (_p, request) => {
    if (request[7] === 5) { dpi = { x: request.readUInt16BE(9), y: request.readUInt16BE(11) }; writes.push(dpi); }
    return Buffer.from([0, dpi.x >> 8, dpi.x & 255, dpi.y >> 8, dpi.y & 255, 0, 0]);
  };
  return { h, device, dir, writes, bindings, current: () => dpi };
}
test('legacy profile DPI is ignored and no longer saved or exported', t => {
  const { dir } = fixture(t), p = { ...newProfile(), dpi: { x: 800, y: 800 } };
  assert.equal(validateProfile(p).dpi, undefined);
  const store = new Store(dir); store.save(p);
  assert.equal(new Store(dir).profiles.find(x => x.id === p.id).dpi, undefined);
  assert.equal(validateProfile({ ...p, dpi: 'legacy' }).dpi, undefined);
});

test('DPI report uses big-endian axes and rejects invalid replies', () => {
  const request = dpiPacket({ x: 800, y: 16000 });
  assert.deepEqual([...request.subarray(5, 15)], [7, 4, 5, 0, 3, 32, 62, 128, 0, 0]);
  assert.equal(dpiPacket()[7], 0x85);
  assert.deepEqual(dpiFromReply(Buffer.from([0, 3, 32, 62, 128, 0, 0])), { x: 800, y: 16000 });
  assert.throws(() => dpiFromReply(Buffer.from([0, 3, 32])));
  assert.throws(() => dpiFromReply(Buffer.from([1, 3, 32, 3, 32, 0, 0])));
});
test('mouse DPI is backed up, verified, and unchanged by profile switching or automatic restore', async t => {
  const { h, device, current, writes } = fixture(t), p = newProfile();
  const exchange = h.exchange;
  h.exchange = async (path, report) => {
    if (report[7] === 5) assert.deepEqual(JSON.parse(fs.readFileSync(h.backupFile(device))).dpi, { x: 1800, y: 2000 });
    return exchange(path, report);
  };
  await h.applyDpi(device.id, { x: 800, y: 800 });
  await h.applyDpi(device.id, { x: 800, y: 800 });
  assert.equal(writes.length, 1);
  await h.apply(device.id, { ...p, dpi: { x: 3200, y: 3200 } });
  await h.apply(device.id, newProfile('Other'));
  await h.restore(device.id);
  assert.deepEqual(current(), { x: 800, y: 800 });
  assert.equal(writes.length, 1);
  await h.restore(device.id, { restoreDpi: true });
  assert.deepEqual(current(), { x: 1800, y: 2000 });
});

test('standalone DPI works without applying bindings and explicit restore accepts a DPI-only backup', async t => {
  const { h, device, current, bindings } = fixture(t);
  for (const value of [{ x: 0, y: 800 }, { x: 800, y: 16001 }, { x: 800.5, y: 800 }, { x: '800', y: 800 }, [], false])
    await assert.rejects(h.applyDpi(device.id, value), /DPI/);
  await h.applyDpi(device.id, { x: 100, y: 16000 });
  assert.equal(bindings.size, 0);
  await h.restore(device.id, { restoreDpi: true });
  assert.deepEqual(current(), { x: 1800, y: 2000 });
});

test('DPI failure rolls back sensitivity without touching button mappings', async t => {
  const { h, device, current, bindings } = fixture(t);
  const exchange = h.exchange;
  h.exchange = async (path, report) => {
    const result = await exchange(path, report);
    if (report[7] === 5 && report.readUInt16BE(9) === 800) throw new Error('Simulated DPI write failure');
    return result;
  };
  await assert.rejects(h.applyDpi(device.id, { x: 800, y: 800 }), /Previous DPI restored/);
  assert.deepEqual(current(), { x: 1800, y: 2000 });
  assert.equal(bindings.size, 0);
});

test('DPI writes require matching readback and surface restoration failures', async t => {
  const { h, device } = fixture(t);
  h.readDpi = async () => ({ x: 1800, y: 2000 });
  await assert.rejects(h.writeDpi(device, { x: 800, y: 800 }), /readback/);
  h.writeDpi = async () => { throw new Error('Disconnected'); };
  await assert.rejects(h.applyDpi(device.id, { x: 800, y: 800 }), /Previous DPI could not be restored/);
});
