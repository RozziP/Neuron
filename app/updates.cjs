const RELEASES_API = 'https://api.github.com/repos/RozziP/Neuron/releases/latest';
const RELEASES_URL = 'https://github.com/RozziP/Neuron/releases/tag/';
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

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
  constructor({ currentVersion, fetchRelease = fetch, onChange = () => {}, openExternal }) {
    this.fetchRelease = fetchRelease;
    this.onChange = onChange;
    this.openExternal = openExternal;
    this.state = { currentVersion, checking: false, checkedAt: null, release: null, error: '' };
    this.pending = null;
    this.timer = null;
  }
  snapshot() { return structuredClone(this.state); }
  publish() { this.onChange(this.snapshot()); }
  check() {
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
  stop() { clearInterval(this.timer); this.timer = null; }
  async openRelease() {
    if (!this.state.release) throw new Error('No newer release is available. Check for updates first.');
    // The main process constructs this URL from a validated tag in the fixed repository.
    await this.openExternal(this.state.release.url);
  }
}

module.exports = { UpdateChecker, newerRelease, RELEASES_API, CHECK_INTERVAL };
