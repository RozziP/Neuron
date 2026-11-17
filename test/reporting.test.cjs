const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { collectReports, normalizeReport, reportKey } = require('../app/hardware-report.cjs');
const { HardwareReporter } = require('../app/hardware-reporting.cjs');
const system = { appVersion: '0.1.0', platform: 'win32', osVersion: '10.0.26100', architecture: 'x64' };
const device = { vendorId: 0x1532, productId: 0x0096, product: 'Naga X', manufacturer: 'Razer', interface: 0, usagePage: 1, usage: 2,
  serialNumber: 'PRIVATE-SERIAL', path: 'PRIVATE-DEVICE-PATH', release: 256 };
const report = () => collectReports([device], system)[0];
const receipt = { key: '1532:0096', issueUrl: 'https://github.com/RozziP/Neuron/issues/1' };
const request = (input = report()) => new Request('https://reports.example/hardware-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
const storage = () => {
  const entries = new Map();
  return { entries, async get(k) { return structuredClone(entries.get(k)); }, async put(k,v) { entries.set(k, structuredClone(v)); }, async delete(k) { entries.delete(k); } };
};
async function service(store = storage()) {
  const { HardwareIssues } = await import('../worker/index.mjs');
  return new HardwareIssues({ storage: store }, { GITHUB_TOKEN: 'test-only', GITHUB_REPOSITORY: 'RozziP/Neuron' });
}
function client(t, fetch, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neuron-reporting-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = { directory, endpoint: 'https://reports.example/hardware-report', repository: 'RozziP/Neuron', system, fetch, ...options };
  return { config, reporter: new HardwareReporter(config) };
}

test('reports group interfaces by model and exclude supported mice, keyboards and private identifiers', () => {
  const reports = collectReports([device, { ...device, interface: 1, usage: 6 }, { ...device, serialNumber: 'OTHER-UNIT' },
    { ...device, productId: 0x0067 }, { vendorId: 12, productId: 13, usagePage: 1, usage: 6 },
    { ...device, vendorId: 12, productId: 14, product: 'Other mouse' }], system);
  assert.equal(reports.length, 2); assert.equal(reports[0].interfaces.length, 2);
  assert.equal(reportKey(reports[0]), '1532:0096');
  assert.equal(JSON.stringify(reports).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(normalizeReport({ ...report(), serialNumber: 'SECRET', path: 'SECRET', profile: 'SECRET' })).includes('SECRET'), false);
  assert.throws(() => normalizeReport({ ...report(), productId: 0x0067 }), /driver/);
  assert.throws(() => normalizeReport({ ...report(), vendorId: 0 }));
  assert.throws(() => normalizeReport({ ...report(), interfaces: [] }));
});

test('client exports a sanitized report and persists receipt across restarts', async t => {
  let sent = 0;
  const { config, reporter } = client(t, async (_url, init) => {
    sent++; assert.equal(init.redirect, 'error'); assert.equal(init.body.includes('PRIVATE'), false);
    return Response.json(receipt, { status: 201 });
  });
  await Promise.all([reporter.tick([device]), reporter.tick([device])]);
  await new HardwareReporter(config).tick([device]);
  assert.equal(sent, 1);
  const exported = JSON.parse(fs.readFileSync(path.join(config.directory, 'hardware-reports', '1532-0096.json')));
  assert.deepEqual(exported, report());
});

test('offline attempts back off across restart, then retry successfully', async t => {
  let now = 100000, sent = 0;
  const { config, reporter } = client(t, async () => { sent++; if (sent === 1) throw new Error('offline'); return Response.json(receipt); }, { now: () => now });
  await reporter.tick([device]); await new HardwareReporter(config).tick([device]); assert.equal(sent, 1);
  now += 60001; await new HardwareReporter(config).tick([device]); assert.equal(sent, 2);
});

test('pending and rate limits stay retryable; wrong-repository receipts are not cached as success', async t => {
  let now = 100000;
  const { reporter } = client(t, async () => Response.json({ status: 'pending' }, { status: 202, headers: { 'Retry-After': '600' } }), { now: () => now });
  await reporter.tick([device]); assert.equal(reporter.entries['1532:0096'].nextAttempt, now + 600000);
  now += 600001; reporter.fetch = async () => Response.json({ ...receipt, issueUrl: 'https://github.com/other/repo/issues/1' });
  await reporter.tick([device]); assert.equal(reporter.entries['1532:0096'].issueUrl, undefined);
});

test('unconfigured client stays local and rejects insecure endpoints', async t => {
  const { config, reporter } = client(t, () => { throw new Error('must not send'); }, { endpoint: '' });
  await reporter.tick([device]); assert.ok(fs.existsSync(path.join(config.directory, 'hardware-reports', '1532-0096.json')));
  assert.throws(() => new HardwareReporter({ ...config, endpoint: 'http://example.com' }), /HTTPS/);
});

test('concurrent submissions create one issue, with safe hardware content, including across service restart', async () => {
  const s = await service(); let creates = 0;
  s.github = async (_url, init) => {
    await new Promise(resolve => setImmediate(resolve));
    if (!init) return Response.json([]);
    creates++; const payload = JSON.parse(init.body);
    assert.match(payload.body, /neuron-hardware:1532:0096/); assert.equal(payload.body.includes('PRIVATE'), false);
    return Response.json({ number: 1 }, { status: 201 });
  };
  const responses = await Promise.all(Array.from({ length: 8 }, () => s.fetch(request())));
  assert.equal(creates, 1); assert.deepEqual(responses.map(r => r.status), [201,200,200,200,200,200,200,200]);
  const restarted = await service(s.storage); restarted.github = () => { throw new Error('should use cache'); };
  assert.equal((await restarted.fetch(request())).status, 200);
});

test('closed manual issue found on later page suppresses creation; PRs do not count', async () => {
  const s = await service(); let pages = 0;
  s.github = async (url, init) => {
    assert.equal(init, undefined); pages++;
    if (pages === 1) return Response.json(Array.from({ length: 100 }, () => ({ number: 2, title: '1532:0096', pull_request: {} })));
    assert.match(url, /state=all/); assert.match(url, /page=2/);
    return Response.json([{ number: 31, title: 'Support Naga X', body: 'VID: `0x1532` PID: `0x0096`', state: 'closed' }]);
  };
  const response = await s.fetch(request()); assert.equal(response.status, 200);
  assert.equal((await response.json()).issueUrl, 'https://github.com/RozziP/Neuron/issues/31');
});

test('known-model support titles also suppress duplicates without IDs', async () => {
  const { matchesIssue } = await import('../worker/index.mjs');
  assert.equal(matchesIssue({ title: 'Add support for Razer Naga X', state: 'closed' }, report()), true);
  assert.equal(matchesIssue({ title: 'Add support for Razer Naga X' }, { ...report(), productId: 0x0015, model: 'Naga' }), false);
  assert.equal(matchesIssue({ title: 'Naga X screenshots' }, report()), false);
});

test('GitHub requests use the Workers-compatible redirect mode and reject redirects', async t => {
  const s = await service();
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(url, /^https:\/\/api\.github\.com\/repos\/RozziP\/Neuron\/issues\?/);
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'https://example.invalid' } });
  });
  await assert.rejects(s.existingIssue(report()), /GitHub listing failed \(302\)/);
});

test('lost creation response reconciles the original issue without a second POST', async () => {
  const s = await service(); let creates = 0;
  s.github = async (_url, init) => { if (init) { creates++; throw new Error('response lost'); } return Response.json([]); };
  assert.equal((await s.fetch(request())).status, 503);
  const pending = await s.storage.get('report:1532:0096'); assert.equal(pending.pending, true);
  pending.nextCheck = 0; await s.storage.put('report:1532:0096', pending);
  const restarted = await service(s.storage);
  restarted.github = async (_url, init) => { assert.equal(init, undefined); return Response.json([{ number: 1, body: '<!-- neuron-hardware:1532:0096 -->' }]); };
  assert.equal((await restarted.fetch(request())).status, 200); assert.equal(creates, 1);
});

test('unresolved ambiguous POST never automatically creates a duplicate', async () => {
  const s = await service(); await s.storage.put('report:1532:0096', { pending: true, nextCheck: 0 });
  s.github = async (_url, init) => { assert.equal(init, undefined); return Response.json([]); };
  assert.equal((await s.fetch(request())).status, 202);
});

test('failed listing blocks creation and daily creation budget bounds anonymous abuse', async () => {
  const s = await service(); s.github = async (_url, init) => { assert.equal(init, undefined); return Response.json({}, { status: 403 }); };
  assert.equal((await s.fetch(request())).status, 503); assert.equal(await s.storage.get('report:1532:0096'), undefined);
  await s.storage.put('create-budget', { day: new Date().toISOString().slice(0,10), count: 20 });
  s.github = async (_url, init) => { assert.equal(init, undefined); return Response.json([]); };
  assert.equal((await s.fetch(request())).status, 429);
});

test('worker validates payload size and unsupported mouse before forwarding', async () => {
  const { default: worker } = await import('../worker/index.mjs');
  assert.equal((await worker.fetch(request({ ...report(), productId: 0x0067 }), {})).status, 400);
  assert.equal((await worker.fetch(request({ ...report(), extra: 'x'.repeat(9000) }), {})).status, 400);
  let forwarded;
  const env = { GITHUB_REPOSITORY: 'RozziP/Neuron', HARDWARE_ISSUES: { idFromName: x => x, get: () => ({ async fetch(r) { forwarded = await r.json(); return Response.json(receipt); } }) } };
  assert.equal((await worker.fetch(request({ ...report(), serialNumber: 'PRIVATE' }), env)).status, 200);
  assert.equal(forwarded.serialNumber, undefined);
});
