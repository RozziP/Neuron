const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { collectReports, normalizeReport, reportKey, reportFingerprint } = require('../app/hardware-report.cjs');
const { HardwareReporter } = require('../app/hardware-reporting.cjs');
const system = { appVersion: '0.1.0', platform: 'win32', osVersion: '10.0.26100', architecture: 'x64' };
const device = { vendorId: 0x1532, productId: 0x0096, product: 'Naga X', manufacturer: 'Razer', interface: 0, usagePage: 1, usage: 2,
  serialNumber: 'PRIVATE-SERIAL', path: 'PRIVATE-DEVICE-PATH', release: 256 };
const report = () => normalizeReport({...collectReports([device], system)[0],version:1});
const receipt = { key: '1532:0096', issueUrl: 'https://github.com/RozziP/Neuron/issues/1' };
const acknowledge = async init => Response.json({...receipt,fingerprint:await reportFingerprint(JSON.parse(init.body))});
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
    return acknowledge(init);
  });
  await Promise.all([reporter.tick([device]), reporter.tick([device])]);
  await new HardwareReporter(config).tick([device]);
  assert.equal(sent, 1);
  const exported = JSON.parse(fs.readFileSync(path.join(config.directory, 'hardware-reports', '1532-0096.json')));
  assert.deepEqual(exported, collectReports([device],system)[0]);
});

test('offline attempts back off across restart, then retry successfully', async t => {
  let now = 100000, sent = 0;
  const { config, reporter } = client(t, async (_url,init) => { sent++; if (sent === 1) throw new Error('offline'); return acknowledge(init); }, { now: () => now });
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
  assert.equal((await worker.fetch(request({ ...report(), extra: 'x'.repeat(33000) }), {})).status, 400);
  let forwarded;
  const env = { GITHUB_REPOSITORY: 'RozziP/Neuron', HARDWARE_ISSUES: { idFromName: x => x, get: () => ({ async fetch(r) { forwarded = await r.json(); return Response.json(receipt); } }) } };
  assert.equal((await worker.fetch(request({ ...report(), serialNumber: 'PRIVATE' }), env)).status, 200);
  assert.equal(forwarded.serialNumber, undefined);
});

test('client upgrades old receipts, retries old servers, then only resends changed identification', async t => {
  let now=100000,sent=0;
  const {config,reporter}=client(t,async (_url,init)=>{sent++;return sent===1?Response.json(receipt):acknowledge(init);},{now:()=>now});
  reporter.entries[receipt.key]={issueUrl:receipt.issueUrl};reporter.persist();
  await reporter.tick([device]);assert.equal(sent,1);assert.equal(reporter.entries[receipt.key].fingerprint,undefined);
  now+=60001;await reporter.tick([device]);assert.equal(sent,2);assert.ok(reporter.entries[receipt.key].fingerprint);
  now+=60001;await new HardwareReporter(config).tick([device]);assert.equal(sent,2);
  now+=60001;await new HardwareReporter(config).tick([{...device,release:769}]);assert.equal(sent,3);
});

test('client preserves base metadata when enrichment fails', async t => {
  const {reporter}=client(t,async (_url,init)=>{assert.equal(JSON.parse(init.body).version,2);return acknowledge(init);},
    {enrich:async()=>{throw new Error('Unavailable');}});
  await reporter.tick([device]);assert.ok(reporter.entries[receipt.key].fingerprint);
});

test('v2 creates one issue and delivers new evidence once on the existing issue, including after restart', async () => {
  const s=await service();let creates=0,comments=0,body='';
  const enriched=collectReports([device],system)[0];
  s.github=async (url,init)=>{
    if(url==='/issues' && init){creates++;body=JSON.parse(init.body).body;return Response.json({number:1},{status:201});}
    if(url.includes('comments?'))return Response.json([]);
    if(url==='/issues/1/comments'){comments++;return Response.json({id:1},{status:201});}
    if(url==='/issues/1')return Response.json({number:1,body});
    return Response.json([]);
  };
  const first=await s.fetch(request(enriched));assert.equal(first.status,201);
  assert.equal((await first.json()).fingerprint,await reportFingerprint(enriched));
  const changed={...enriched,release:769};
  const results=await Promise.all([s.fetch(request(changed)),s.fetch(request(changed))]);
  assert.deepEqual(results.map(r=>r.status),[200,200]);assert.equal(creates,1);assert.equal(comments,1);
  const restarted=await service(s.storage);restarted.github=()=>{throw new Error('Must use evidence cache');};
  assert.equal((await restarted.fetch(request(enriched))).status,200);
  assert.equal((await restarted.fetch(request(changed))).status,200);
});

test('old cached and closed manual issues receive new evidence without changing their body or reopening', async () => {
  const s=await service();await s.storage.put('report:1532:0096',receipt);let posts=0;
  s.github=async (url,init)=>{
    if(url==='/issues/1')return Response.json({number:1,state:'closed',body:'Human investigation'});
    if(url.includes('comments?'))return Response.json([]);
    assert.equal(url,'/issues/1/comments');assert.equal(init.method,'POST');posts++;
    assert.match(JSON.parse(init.body).body,/neuron-evidence:/);return Response.json({id:1},{status:201});
  };
  const r=await s.fetch(request(collectReports([device],system)[0]));assert.equal(r.status,200);assert.equal(posts,1);
});

test('lost evidence response is reconciled after restart and never blindly posted twice', async () => {
  const s=await service();await s.storage.put('report:1532:0096',receipt);let body='',posts=0;
  s.github=async (url,init)=>{
    if(url==='/issues/1')return Response.json({number:1,body:'Original report'});
    if(url.includes('comments?'))return Response.json([]);
    posts++;body=JSON.parse(init.body).body;throw new Error('Response lost');
  };
  const enriched=collectReports([device],system)[0], fp=await reportFingerprint(enriched), key=`evidence:1532:0096:${fp}`;
  assert.equal((await s.fetch(request(enriched))).status,503);
  await s.storage.put(key,{pending:true,nextCheck:0});
  const restarted=await service(s.storage);
  restarted.github=async (url,init)=>{assert.equal(init,undefined);return Response.json(url==='/issues/1'?{number:1,body:'Original report'}:[{body}]);};
  assert.equal((await restarted.fetch(request(enriched))).status,200);assert.equal(posts,1);
  await s.storage.put(key,{pending:true,nextCheck:0});
  restarted.github=async (url,init)=>{assert.equal(init,undefined);return Response.json(url==='/issues/1'?{number:1,body:'Original report'}:[]);};
  assert.equal((await restarted.fetch(request(enriched))).status,202);assert.equal(posts,1);
});

test('evidence posting rejects listing failures and honors update limits', async () => {
  const enriched=collectReports([device],system)[0],s=await service();
  await s.storage.put('report:1532:0096',receipt);
  s.github=async (_url,init)=>{assert.equal(init,undefined);return Response.json({}, {status:403});};
  assert.equal((await s.fetch(request(enriched))).status,503);
  s.github=async (url,init)=>{assert.equal(init,undefined);return Response.json(url==='/issues/1'?{number:1,body:''}:[]);};
  await s.storage.put('evidence-count:1532:0096',8);
  assert.equal((await s.fetch(request(enriched))).status,429);
});

const trinity={...device,productId:0x0067,product:'Naga Trinity'};
const confirmation={version:1,vendorId:0x1532,productId:0x0067,modelName:'Razer Naga Trinity'};
const resolutionRequest=(value=confirmation)=>new Request('https://reports.example/hardware-resolution',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)
});

test('user confirmations persist, unsupported identities enrich reports, and matching IDs are required for support', async t => {
  let submitted;
  const {config,reporter}=client(t,async (_url,init)=>{submitted=JSON.parse(init.body);return acknowledge(init);});
  reporter.observe([device]);reporter.confirm('1532:0096','Razer Naga X');
  assert.equal(reporter.summaries()[0].supported,false);
  assert.equal(reporter.summaries()[0].status,'driver-needed');
  await reporter.tick([device]);assert.equal(submitted.identification.confirmedModel,'Razer Naga X');
  const restarted=new HardwareReporter(config);restarted.observe([device]);
  assert.equal(restarted.summaries()[0].confirmedModel,'Razer Naga X');
  assert.throws(()=>reporter.confirm('3554:f55d','Naga Trinity'),/no longer detected/);
  reporter.confirm('1532:0096','Razer Naga Trinity');assert.equal(reporter.summaries()[0].supported,false);
  assert.throws(()=>reporter.confirm('1532:0096',' '),/brand and model/);
});

test('supported confirmation retries resolution offline, then remembers closure across restart', async t => {
  let now=100000,calls=0;
  const {config,reporter}=client(t,async (url,init)=>{
    calls++;assert.equal(url,'https://reports.example/hardware-resolution');assert.equal(init.redirect,'error');
    assert.deepEqual(JSON.parse(init.body),confirmation);
    if(calls===1)throw new Error('Offline');
    return Response.json({key:'1532:0067',status:'closed',issueUrl:'https://github.com/RozziP/Neuron/issues/9'});
  },{now:()=>now});
  reporter.observe([trinity]);reporter.confirm('1532:0067','Razer Naga Trinity');
  await reporter.tick([trinity]);assert.equal(reporter.summaries()[0].status,'pending');
  now+=60001;await reporter.tick([trinity]);assert.equal(reporter.summaries()[0].status,'closed');
  now+=60001;await new HardwareReporter(config).tick([trinity]);assert.equal(calls,2);
});

test('confirmation never sends a closure request for an unsupported shared receiver', async t => {
  const receiver={...device,vendorId:13652,productId:62813,product:'2.4G Wireless Receiver'};
  const {reporter}=client(t,async (url,init)=>{
    assert.equal(url,'https://reports.example/hardware-report');
    return Response.json({key:'3554:f55d',issueUrl:'https://github.com/RozziP/Neuron/issues/2',fingerprint:await reportFingerprint(JSON.parse(init.body))});
  });
  reporter.observe([receiver]);reporter.confirm('3554:f55d','Razer Naga Trinity');await reporter.tick([receiver]);
  assert.equal(reporter.summaries()[0].status,'driver-needed');assert.equal(reporter.summaries()[0].supported,false);
});

test('service closes only a matching automatic issue for a server-supported confirmed USB identity', async () => {
  const s=await service();let patches=0;
  await s.storage.put('report:1532:0067',{key:'1532:0067',issueUrl:'https://github.com/RozziP/Neuron/issues/7'});
  s.github=async (url,init)=>{
    assert.equal(url,'/issues/7');
    if(!init)return Response.json({number:7,state:'open',body:'<!-- neuron-hardware:1532:0067 -->'});
    patches++;assert.equal(init.method,'PATCH');assert.deepEqual(JSON.parse(init.body),{state:'closed',state_reason:'completed'});
    return Response.json({number:7,state:'closed'});
  };
  const responses=await Promise.all([s.fetch(resolutionRequest()),s.fetch(resolutionRequest())]);
  assert.equal(patches,1);assert.deepEqual(responses.map(r=>r.status),[200,200]);
  assert.equal((await responses[0].json()).status,'closed');
  const restarted=await service(s.storage);restarted.github=()=>{throw new Error('Already resolved');};
  assert.equal((await restarted.fetch(resolutionRequest())).status,200);
});

test('service rejects spoofed support flags, shared receiver model claims and arbitrary issue targets', async () => {
  const s=await service();s.github=()=>{throw new Error('Must not access GitHub');};
  for(const input of [{...confirmation,vendorId:13652,productId:62813,supported:true,issueUrl:'https://github.com/other/repo/issues/1'},
    {...confirmation,productId:0x0096,modelName:'Razer Naga X',supported:true},{...confirmation,modelName:'Other mouse'}]) {
    assert.equal((await s.fetch(resolutionRequest(input))).status,409);
  }
});

test('manual, mismatched, and pull-request issues are left for review; already closed issues are idempotent', async () => {
  for(const issue of [{number:7,state:'open',body:'manual report'},
    {number:7,state:'open',body:'<!-- neuron-hardware:3554:f55d -->'},
    {number:7,state:'open',body:'<!-- neuron-hardware:1532:0067 -->',pull_request:{}},
    {number:7,state:'closed',body:'<!-- neuron-hardware:1532:0067 -->'}]) {
    const s=await service();await s.storage.put('report:1532:0067',{issueUrl:'https://github.com/RozziP/Neuron/issues/7'});
    s.github=async (_url,init)=>{assert.equal(init,undefined);return Response.json(issue);};
    const r=await s.fetch(resolutionRequest());assert.equal(r.status,200);
    assert.equal((await r.json()).status,issue.state==='closed'?'closed':'manual-review');
  }
});

test('resolution finds an uncached issue and retries a lost close response without closing twice', async () => {
  const s=await service();let state='open',patches=0;
  s.github=async (url,init)=>{
    const issue={number:7,state,body:'<!-- neuron-hardware:1532:0067 -->'};
    if(!init)return Response.json(url.includes('?')?[issue]:issue);
    patches++;state='closed';throw new Error('Lost close response');
  };
  assert.equal((await s.fetch(resolutionRequest())).status,503);
  assert.equal((await s.fetch(resolutionRequest())).status,200);assert.equal(patches,1);
});

test('resolution route validates payload and strips caller-selected issue information', async () => {
  const {default:worker}=await import('../worker/index.mjs');let forwarded;
  const env={GITHUB_REPOSITORY:'RozziP/Neuron',HARDWARE_ISSUES:{idFromName:x=>x,get:()=>({fetch:async r=>{forwarded=await r.json();assert.equal(new URL(r.url).pathname,'/hardware-resolution');return Response.json({});}})}};
  assert.equal((await worker.fetch(resolutionRequest({...confirmation,issueUrl:'PRIVATE',supported:true}),env)).status,200);
  assert.deepEqual(forwarded,confirmation);
  assert.equal((await worker.fetch(resolutionRequest({...confirmation,modelName:''}),env)).status,400);
});
