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

test('opening an update only uses the fixed repository and validated release tag', async () => {
  const opened = [];
  const checker = new UpdateChecker({ currentVersion: '0.1.2', openExternal: async url => opened.push(url),
    fetchRelease: async () => ({ ok: true, json: async () => ({ ...release('v0.2.0'), html_url: 'https://evil.example/download.exe' }) }) });
  await assert.rejects(checker.openRelease(), /No newer release/);
  await checker.check(); await checker.openRelease();
  assert.deepEqual(opened, ['https://github.com/RozziP/Neuron/releases/tag/v0.2.0']);
  checker.openExternal = async () => { throw new Error('Browser unavailable'); };
  await assert.rejects(checker.openRelease(), /Browser unavailable/);
});
