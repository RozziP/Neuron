import reports from '../app/hardware-report.cjs';
import models from '../app/catalog.cjs';
const { normalizeReport, reportKey } = reports;
const json = (body, status = 200, retry) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...(retry ? { 'Retry-After': String(retry) } : {}) } });
const marker = key => `<!-- neuron-hardware:${key} -->`;

async function readReport(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('JSON required.');
  if (!request.body) throw new Error('Missing report.');
  const reader = request.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 8192) { await reader.cancel(); throw new Error('Report too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return normalizeReport(JSON.parse(new TextDecoder().decode(bytes)));
}

export function matchesIssue(issue, report) {
  if (issue.pull_request) return false;
  const key = reportKey(report), body = issue.body || '', title = issue.title || '';
  if (body.includes(marker(key))) return true;
  const [vid,pid] = key.split(':');
  const text = `${title}\n${body}`;
  // Also recognize hand-filed issues with explicit IDs, including closed issues.
  const pair = new RegExp(`\\b${vid}\\s*:\\s*${pid}\\b`, 'i');
  const ids = new RegExp(`\\bVID\\b[^a-z0-9]{0,12}(?:0x)?${vid}\\b`, 'i').test(text)
    && new RegExp(`\\bPID\\b[^a-z0-9]{0,12}(?:0x)?${pid}\\b`, 'i').test(text);
  const known = report.vendorId === 0x1532 && models.catalog.find(m => m.productId === report.productId);
  const normalizeName = value => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // Match descriptive manual titles for known models too. The bare name "Naga" is
  // ambiguous across generations, so it still requires IDs or the hidden marker.
  const name = known && normalizeName(known.name.split(' · ')[0]);
  const named = name && name !== 'naga' && /\b(support|unsupported|compatibility|driver)\b/i.test(title)
    && (` ${normalizeName(title)} `).includes(` ${name} `);
  return pair.test(text) || ids || Boolean(named);
}

export class HardwareIssues {
  constructor(ctx, env) {
    this.storage = ctx.storage; this.env = env; this.queue = Promise.resolve(); this.queued = 0;
    this.requestWindow = 0; this.requestCount = 0;
  }
  async fetch(request) {
    const minute = Math.floor(Date.now() / 60000);
    if (minute !== this.requestWindow) { this.requestWindow = minute; this.requestCount = 0; }
    if (++this.requestCount > 120 || this.queued >= 16) return json({ error: 'Busy. Retry later.' }, 429, 60);
    this.queued++;
    const task = this.queue.then(async () => {
      try { return await this.report(await readReport(request)); }
      catch (error) {
        console.warn('Hardware reporting failed:', error instanceof Error ? error.message : 'Unknown error');
        return json({ error: 'Reporting temporarily unavailable.' }, 503, 600);
      }
    });
    this.queue = task.catch(() => {});
    try { return await task; } finally { this.queued--; }
  }
  async github(suffix, init = {}) {
    return fetch(`https://api.github.com/repos/${this.env.GITHUB_REPOSITORY}${suffix}`, {
      // Workers supports manual/follow only. A 3xx is rejected by the callers,
      // so the GitHub credential is never forwarded to a redirected origin.
      ...init, redirect: 'manual', signal: AbortSignal.timeout(12000),
      headers: { Authorization: `Bearer ${this.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Neuron-hardware-reporter', 'Content-Type': 'application/json' }
    });
  }
  async existingIssue(report) {
    // Use the repository listing, not the eventually indexed search endpoint.
    for (let page = 1; page <= 20; page++) {
      const response = await this.github(`/issues?state=all&sort=created&direction=asc&per_page=100&page=${page}`);
      if (!response.ok) throw new Error(`GitHub listing failed (${response.status}).`);
      const issues = await response.json();
      if (!Array.isArray(issues)) throw new Error('Invalid GitHub response.');
      const existing = issues.find(issue => matchesIssue(issue, report));
      if (existing) return existing;
      if (issues.length < 100) return null;
    }
    throw new Error('Issue listing exceeded safety bound; no new issue will be created.');
  }
  async saveIssue(key, issue, status) {
    if (!Number.isSafeInteger(issue.number) || issue.number < 1) throw new Error('Missing issue number.');
    const receipt = { key, issueUrl: `https://github.com/${this.env.GITHUB_REPOSITORY}/issues/${issue.number}` };
    await this.storage.put(`report:${key}`, receipt);
    return json(receipt, status);
  }
  async report(report) {
    if (!this.env.GITHUB_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(this.env.GITHUB_REPOSITORY || '')) return json({ error: 'Service not configured.' }, 503, 3600);
    const key = reportKey(report), storageKey = `report:${key}`, previous = await this.storage.get(storageKey);
    if (previous?.issueUrl) return json(previous);
    if (previous?.nextCheck > Date.now()) return json({ key, status: 'pending' }, 202, 600);
    // Bound all uncached GitHub scans as well as creates; anonymous callers cannot trigger unlimited API calls.
    const minute = Math.floor(Date.now() / 60000), quota = await this.storage.get('scan-quota');
    if (quota?.minute === minute && quota.count >= 10) return json({ error: 'Busy. Retry later.' }, 429, 60);
    await this.storage.put('scan-quota', { minute, count: quota?.minute === minute ? quota.count + 1 : 1 });
    const existing = await this.existingIssue(report);
    if (existing) return this.saveIssue(key, existing, 200);
    if (previous?.pending) {
      // A timed-out POST might have succeeded. Reconcile, but never blindly create again.
      await this.storage.put(storageKey, { ...previous, nextCheck: Date.now() + 600000 });
      return json({ key, status: 'pending' }, 202, 600);
    }
    const day = new Date().toISOString().slice(0,10), budget = await this.storage.get('create-budget');
    if (budget?.day === day && budget.count >= 20) return json({ error: 'Daily new-model limit reached.' }, 429, 86400);
    await this.storage.put('create-budget', { day, count: budget?.day === day ? budget.count + 1 : 1 });
    await this.storage.put(storageKey, { pending: true, nextCheck: Date.now() + 600000 });
    const body = `${marker(key)}\nAutomatic unsupported-mouse report from Neuron.\n\nHardware ID: \`${key}\`\n\nThis report contains enumeration metadata only; no device commands were sent.\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\``;
    const response = await this.github('/issues', { method: 'POST', body: JSON.stringify({ title: `Unsupported mouse: ${report.model} [${key}]`, body }) });
    if (response.status !== 201) {
      // These are definite rejections, so a later retry is safe. 5xx/timeouts stay pending.
      if ([400,401,403,404,410,422,429].includes(response.status)) await this.storage.delete(storageKey);
      return json({ error: 'GitHub did not confirm creation.' }, 503, 600);
    }
    return this.saveIssue(key, await response.json(), 201);
  }
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/hardware-report') return json({ error: 'Not found.' }, 404);
    if (request.method !== 'POST') return json({ error: 'POST required.' }, 405);
    let report;
    try { report = await readReport(request); } catch { return json({ error: 'Invalid hardware report.' }, 400); }
    // One durable coordinator per repository serializes checks and creates across all users.
    const id = env.HARDWARE_ISSUES.idFromName(env.GITHUB_REPOSITORY);
    return env.HARDWARE_ISSUES.get(id).fetch(new Request(request.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) }));
  }
};
