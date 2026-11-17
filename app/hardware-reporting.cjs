const fs = require('node:fs');
const path = require('node:path');
const { atomicWrite } = require('./store.cjs');
const { collectReports, reportKey } = require('./hardware-report.cjs');
const DAY = 86400000;

class HardwareReporter {
  constructor({ directory, endpoint = '', repository, system, fetch = globalThis.fetch, now = Date.now }) {
    this.directory = directory; this.endpoint = endpoint; this.repository = repository;
    this.system = system; this.fetch = fetch; this.now = now; this.busy = false; this.nextScan = 0;
    this.file = path.join(directory, 'hardware-reporting.json'); this.entries = {};
    if (endpoint) {
      const url = new URL(endpoint);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new Error('Hardware reporting requires an HTTPS endpoint.');
    }
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (data.version === 1 && data.endpoint === endpoint && data.entries && typeof data.entries === 'object' && !Array.isArray(data.entries)) this.entries = data.entries;
    } catch { /* Missing or damaged delivery cache can be rebuilt; the server also deduplicates. */ }
  }
  persist() { atomicWrite(this.file, { version: 1, endpoint: this.endpoint, entries: this.entries }); }
  async tick(records) {
    if (this.busy || this.now() < this.nextScan) return;
    this.busy = true; this.nextScan = this.now() + 60000;
    try {
      for (const report of collectReports(records, this.system)) {
        const key = reportKey(report), previous = this.entries[key] || {};
        if (previous.issueUrl || previous.nextAttempt > this.now()) continue;
        atomicWrite(path.join(this.directory, 'hardware-reports', key.replace(':','-') + '.json'), report);
        if (!this.endpoint) continue;
        // Persist backoff before sending, including across crashes and restarts.
        const attempts = Math.min((Number(previous.attempts) || 0) + 1, 10);
        this.entries[key] = { attempts, nextAttempt: this.now() + Math.min(DAY, 60000 * 2 ** (attempts - 1)) };
        this.persist();
        try {
          const response = await this.fetch(this.endpoint, { method: 'POST', redirect: 'error',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report), signal: AbortSignal.timeout(15000) });
          const retry = Number(response.headers.get('retry-after'));
          if (Number.isFinite(retry) && retry > 0) this.entries[key].nextAttempt = this.now() + Math.min(7 * DAY, Math.max(60000, retry * 1000));
          if (response.status === 200 || response.status === 201) {
            const result = await response.json();
            const prefix = `https://github.com/${this.repository}/issues/`;
            if (result.key !== key || typeof result.issueUrl !== 'string' || !result.issueUrl.startsWith(prefix) || !/^[1-9][0-9]*$/.test(result.issueUrl.slice(prefix.length))) throw new Error('Invalid report receipt.');
            this.entries[key] = { issueUrl: result.issueUrl };
          }
          this.persist();
        } catch { /* Offline, timeout, or service failure: retry without affecting mouse controls. */ }
      }
    } finally { this.busy = false; }
  }
}
module.exports = { HardwareReporter };
