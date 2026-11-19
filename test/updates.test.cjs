const test = require('node:test');
const assert = require('node:assert/strict');
const { UpdateChecker, newerRelease, RELEASES_API } = require('../app/updates.cjs');
const release = tag_name => ({ tag_name, draft: false, prerelease: false });
const response = tag => ({ ok: true, status: 200, json: async () => release(tag) });

test('updates compare numeric versions, ignore old releases, drafts and prereleases', () => {
  assert.equal(newerRelease(release('v0.1.10'), '0.1.9').version, '0.1.10');
  assert.equal(newerRelease(release('v1.0.0'), '0.99.99').version, '1.0.0');
  assert.equal(newerRelease(release('v0.2.0'), '0.2.0-beta.1').version, '0.2.0');
  for (const tag of ['v0.1.1', 'v0.1.2', 'v0.1.2+build', 'v0.2.0-beta.1', 'latest', 'v01.2.3', 'v999999999999999999.0.0', 'https://evil.example']) {
    assert.equal(newerRelease(release(tag), '0.1.2'), null, tag);
  }
  assert.equal(newerRelease({ ...release('v0.2.0'), draft: true }, '0.1.2'), null);
  assert.equal(newerRelease({ ...release('v0.2.0'), prerelease: true }, '0.1.2'), null);
});

test('concurrent checks share one request and expose checking and completion state', async () => {
  let finish, calls = 0;
  const states = [];
  const checker = new UpdateChecker({ currentVersion: '0.1.2', onChange: state => states.push(state), fetchRelease: async (url, options) => {
    calls++; assert.equal(url, RELEASES_API);
    assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
    return new Promise(resolve => { finish = resolve; });
  } });
  const first = checker.check(), second = checker.check();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(checker.snapshot().checking, true);
  finish(response('v0.1.10'));
  const result = await first;
  assert.equal(calls, 1); assert.equal(result.checking, false);
  assert.equal(result.release.version, '0.1.10'); assert.ok(result.checkedAt);
  assert.deepEqual(states.map(s => s.checking), [true, false]);
  result.release.version = 'tampered';
  assert.equal(checker.snapshot().release.version, '0.1.10');
});

test('offline, timeout, rate limit and malformed responses are recoverable without losing a known update', async () => {
  const checker = new UpdateChecker({ currentVersion: '0.1.2', fetchRelease: async () => response('v0.2.0') });
  await checker.check();
  for (const [fetchRelease, pattern] of [
    [async () => { throw new TypeError('fetch failed'); }, /connection/],
    [async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); }, /timed out/],
    [async () => ({ ok: false, status: 429 }), /limiting/],
    [async () => ({ ok: false, status: 500 }), /Could not check/],
    [async () => ({ ok: true, json: async () => ({ tag_name: 'bogus' }) }), /unrecognized/],
    [async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid json'); } }), /Could not reach/]
  ]) {
    checker.fetchRelease = fetchRelease;
    const state = await checker.check();
    assert.equal(state.checking, false); assert.match(state.error, pattern);
    assert.equal(state.release.version, '0.2.0');
  }
  checker.fetchRelease = async () => response('v0.2.1');
  const recovered = await checker.check();
  assert.equal(recovered.error, ''); assert.equal(recovered.release.version, '0.2.1');
});

test('no published release and equal or older versions do not offer an update', async () => {
  const checker = new UpdateChecker({ currentVersion: '0.2.0', fetchRelease: async () => ({ ok: false, status: 404 }) });
  let state = await checker.check();
  assert.equal(state.error, ''); assert.equal(state.release, null); assert.ok(state.checkedAt);
  for (const tag of ['v0.2.0', 'v0.1.9']) {
    checker.fetchRelease = async () => response(tag);
    state = await checker.check();
    assert.equal(state.release, null); assert.equal(state.error, '');
  }
});

test('downloads are shared and wait for an explicit install using verified metadata; failures permit retry', async () => {
  const states = [], installed = [];
  const asset = { name:'Neuron-Setup-0.2.0-x64.exe', state:'uploaded', size:123,
    digest:'sha256:'+'a'.repeat(64), browser_download_url:'https://github.com/RozziP/Neuron/releases/download/v0.2.0/Neuron-Setup-0.2.0-x64.exe' };
  let finish, downloads=0;
  const checker = new UpdateChecker({ currentVersion:'0.1.2', canInstall:true, directory:'cache',
    onChange:s=>states.push(s), fetchRelease:async()=>({ok:true,json:async()=>({...release('v0.2.0'),assets:[asset]})}),
    download:async (file,directory,progress)=>{downloads++;assert.equal(file.sha256,'a'.repeat(64));assert.equal(directory,'cache');progress(50);return new Promise(resolve=>finish=resolve);},
    install:async info=>installed.push(info) });
  await assert.rejects(checker.installUpdate(),/Download the update/);
  await assert.rejects(checker.downloadUpdate(),/No newer/);
  await checker.check();
  const a=checker.downloadUpdate(), b=checker.downloadUpdate();assert.equal(a,b);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(checker.snapshot().phase,'downloading');assert.equal(checker.snapshot().progress,50);
  await checker.check();assert.equal(downloads,1);
  await assert.rejects(checker.installUpdate(),/Download the update/);
  assert.equal(checker.snapshot().phase,'downloading');
  finish({file:'verified.exe',sha256:'a'.repeat(64)});await a;
  assert.equal(checker.snapshot().phase,'ready');assert.equal(installed.length,0);
  await checker.downloadUpdate();await checker.check();assert.equal(downloads,1);
  const installing=checker.installUpdate();assert.equal(installing,checker.installUpdate());await installing;
  assert.equal(installed[0].version,'0.2.0');assert.equal(checker.snapshot().phase,'installing');
  checker.install=async()=>{throw new Error('Restore failed');};checker.download=async()=>({file:'verified.exe'});
  await checker.downloadUpdate();
  await assert.rejects(checker.installUpdate(),/Restore failed/);assert.equal(checker.snapshot().phase,'idle');
  checker.install=async()=>{};await checker.downloadUpdate();await checker.installUpdate();
});

test('missing digests and development builds cannot start an installer; shutdown cancels downloads', async () => {
  const checker=new UpdateChecker({currentVersion:'0.1.2',fetchRelease:async()=>response('v0.2.0'),install:()=>assert.fail('must not install')});
  await checker.check();await assert.rejects(checker.downloadUpdate(),/installed Windows/);
  checker.state.canInstall=true;await assert.rejects(checker.downloadUpdate(),/verified Windows installer/);
  checker.state.release.installer={};
  checker.download=async(_asset,_dir,_progress,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  const pending=checker.downloadUpdate();await new Promise(resolve=>setImmediate(resolve));checker.stop();
  await assert.rejects(pending,/canceled/);assert.equal(checker.snapshot().phase,'idle');
});

test('cancel and stalled downloads allow retry without installing; quitting discards a ready installer', async () => {
  let discarded = 0;
  const checker = new UpdateChecker({ currentVersion:'0.1.0', canInstall:true, install:()=>assert.fail('must wait for confirmation'),
    download:async(_asset,_dir,_progress,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})) });
  checker.state.release={version:'0.2.0',installer:{size:100}};
  const pending=checker.downloadUpdate();await new Promise(resolve=>setImmediate(resolve));checker.cancelDownload();
  await assert.rejects(pending,/canceled/);assert.equal(checker.snapshot().phase,'idle');
  checker.download=async()=>{throw new DOMException('stalled','TimeoutError');};
  await assert.rejects(checker.downloadUpdate(),/timed out/);
  checker.download=async()=>({file:'verified.exe',discard:async()=>{discarded++;}});
  await checker.downloadUpdate();assert.equal(checker.snapshot().phase,'ready');
  checker.stop();assert.equal(discarded,1);assert.equal(checker.downloaded,null);
});
