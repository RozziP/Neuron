const RELEASES_API = 'https://api.github.com/repos/RozziP/Neuron/releases/latest';
const RELEASES_URL = 'https://github.com/RozziP/Neuron/releases/tag/';
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const { installerAsset, downloadInstaller } = require('./update-download.cjs');

function parseVersion(value) {
  if (typeof value !== 'string' || value.length > 100) return null;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1, 4).map(Number);
  if (!parts.every(Number.isSafeInteger)) return null;
  return { parts, prerelease: !!match[4] };
}

function newerRelease(release, currentVersion) {
  const current = parseVersion(currentVersion), next = parseVersion(release?.tag_name);
  if (!current || !next || next.prerelease || release.draft !== false || release.prerelease !== false) return null;
  for (let i = 0; i < 3; i++) {
    if (next.parts[i] < current.parts[i]) return null;
    if (next.parts[i] > current.parts[i]) return { version: release.tag_name.replace(/^v/, ''), url: RELEASES_URL + encodeURIComponent(release.tag_name) };
  }
  return current.prerelease ? { version: release.tag_name.replace(/^v/, ''), url: RELEASES_URL + encodeURIComponent(release.tag_name) } : null;
}

class UpdateChecker {
  constructor({ currentVersion, fetchRelease = fetch, onChange = () => {}, install, directory, canInstall = false, download = downloadInstaller, startupError = '' }) {
    this.fetchRelease = fetchRelease;
    this.onChange = onChange;
    this.install = install; this.directory = directory; this.download = download;
    this.state = { currentVersion, checking: false, checkedAt: null, release: null, error: '', installError: startupError, canInstall, phase: 'idle', progress: 0, received: 0, total: 0 };
    this.installPending = null; this.downloadPending = null; this.downloaded = null; this.abort = null;
    this.pending = null;
    this.timer = null;
  }
  snapshot() { return structuredClone(this.state); }
  publish() { this.onChange(this.snapshot()); }
  check() {
    if (this.downloadPending || this.installPending || this.downloaded) return Promise.resolve(this.snapshot());
    if (this.pending) return this.pending;
    // Defer the request so simultaneous startup and manual checks share one promise.
    this.pending = Promise.resolve().then(async () => {
      this.state.checking = true; this.state.error = ''; this.publish();
      try {
        const response = await this.fetchRelease(RELEASES_API, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Neuron', 'X-GitHub-Api-Version': '2026-03-10' },
          signal: AbortSignal.timeout(15000), redirect: 'error'
        });
        if (response.status === 404) {
          this.state.release = null;
        } else {
          if (!response.ok) throw new Error(response.status === 403 || response.status === 429
            ? 'GitHub is limiting update checks. Try again later.' : 'Could not check GitHub for updates. Try again later.');
          const release = await response.json();
          if (!parseVersion(release?.tag_name) || typeof release.draft !== 'boolean' || typeof release.prerelease !== 'boolean') {
            throw new Error('GitHub returned an unrecognized release. Try again later.');
          }
          this.state.release = newerRelease(release, this.state.currentVersion);
          if (this.state.release) this.state.release.installer = installerAsset(release, this.state.release.version);
        }
        this.state.checkedAt = new Date().toISOString();
      } catch (error) {
        // Keep a previously discovered update available while offline.
        this.state.error = error.name === 'TimeoutError' || error.name === 'AbortError'
          ? 'Update check timed out. Try again.'
          : error.message?.startsWith('GitHub ') || error.message?.startsWith('Could not check GitHub ')
            ? error.message : 'Could not reach GitHub. Check your connection and try again.';
      } finally {
        this.state.checking = false; this.pending = null; this.publish();
      }
      return this.snapshot();
    });
    return this.pending;
  }
  start() {
    if (this.timer) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL);
    this.timer.unref?.();
  }
  stop() {
    clearInterval(this.timer); this.timer = null; this.abort?.abort();
    if (this.state.phase === 'ready') {
      void this.downloaded?.discard?.(); this.downloaded = null; this.state.phase = 'idle';
    }
  }
  cancelDownload() { this.abort?.abort(); }
  downloadUpdate() {
    if (this.downloadPending) return this.downloadPending;
    if (this.downloaded || this.installPending) return Promise.resolve(this.snapshot());
    this.downloadPending = Promise.resolve().then(async () => {
      if (this.pending) await this.pending;
      const release = structuredClone(this.state.release);
      if (!release) throw new Error('No newer release is available. Check for updates first.');
      if (!this.state.canInstall) throw new Error('Automatic updates require the installed Windows version of Neuron.');
      if (!release.installer) throw new Error('This release does not contain a verified Windows installer. Try checking for updates later.');
      this.abort = new AbortController();
      const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(10 * 60 * 1000)]);
      this.state.phase = 'downloading'; this.state.progress = 0; this.state.received = 0; this.state.total = release.installer.size;
      this.state.error = ''; this.state.installError = ''; this.publish();
      const downloaded = await this.download(release.installer, this.directory, (progress, details) => {
        this.state.progress = progress;
        this.state.received = details?.received ?? Math.floor(this.state.total * progress / 100);
        this.publish();
      }, { signal });
      if (signal.aborted) { await downloaded.discard?.(); signal.throwIfAborted(); }
      this.downloaded = { ...downloaded, version: release.version };
      this.state.phase = 'ready'; this.state.progress = 100; this.state.error = ''; this.publish();
      return this.snapshot();
    }).catch(error => {
      this.state.phase = 'idle';
      this.state.error = error.name === 'TimeoutError' ? 'The update download timed out. Check your connection and try again.'
        : error.name === 'AbortError' ? 'Update download canceled. You can try again.' : error.message;
      this.publish(); throw new Error(this.state.error);
    }).finally(() => { this.downloadPending = null; this.abort = null; });
    return this.downloadPending;
  }
  installUpdate() {
    if (this.installPending) return this.installPending;
    this.installPending = Promise.resolve().then(async () => {
      if (this.state.phase !== 'ready' || !this.downloaded) throw new Error('Download the update before restarting.');
      const { discard, ...installer } = this.downloaded;
      this.state.phase = 'installing'; this.state.error = ''; this.publish();
      try { await this.install(installer); }
      catch (error) {
        await discard?.(); this.state.phase = 'idle'; throw error;
      } finally { this.downloaded = null; }
      return this.snapshot();
    }).catch(error => {
      this.state.error = error.message; this.publish(); throw error;
    }).finally(() => { this.installPending = null; });
    return this.installPending;
  }
}

module.exports = { UpdateChecker, newerRelease, RELEASES_API, CHECK_INTERVAL };
