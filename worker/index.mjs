import reports from '../app/hardware-report.cjs';
import models from '../app/catalog.cjs';
const { normalizeReport, reportKey, reportFingerprint, normalizeConfirmation, supportedConfirmation } = reports;
const json = (body, status = 200, retry) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...(retry ? { 'Retry-After': String(retry) } : {}) } });
const marker = key => `<!-- neuron-hardware:${key} -->`;
const evidenceMarker = fingerprint => `<!-- neuron-evidence:${fingerprint} -->`;
const reportBody = (report, fingerprint) => `${marker(reportKey(report))}\n${fingerprint ? evidenceMarker(fingerprint)+'\n' : ''}Automatic unsupported-mouse report from Neuron.\n\nHardware ID: \`${reportKey(report)}\`\n\nRead-only enumeration and identification evidence; no configuration commands or input events were captured. Installed software is a candidate, not proof of the paired mouse model.\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\``;

async function readPayload(request, normalize = normalizeReport) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('JSON required.');
  if (!request.body) throw new Error('Missing report.');
  const reader = request.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 32768) { await reader.cancel(); throw new Error('Report too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return normalize(JSON.parse(new TextDecoder().decode(bytes)));
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
      try {
        return new URL(request.url).pathname === '/hardware-resolution'
          ? await this.resolve(await readPayload(request,normalizeConfirmation))
          : await this.report(await readPayload(request));
      }
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
  async saveIssue(key, issue, status, fingerprint) {
    if (!Number.isSafeInteger(issue.number) || issue.number < 1) throw new Error('Missing issue number.');
    const receipt = { key, issueUrl: `https://github.com/${this.env.GITHUB_REPOSITORY}/issues/${issue.number}` };
    await this.storage.put(`report:${key}`, receipt);
    if (fingerprint) await this.storage.put(`evidence:${key}:${fingerprint}`, { delivered: true });
    return json({ ...receipt, ...(fingerprint ? { fingerprint } : {}) }, status);
  }
  async supplement(report, receipt, fingerprint) {
    const key = reportKey(report), evidenceKey = `evidence:${key}:${fingerprint}`;
    const previous = await this.storage.get(evidenceKey);
    if (previous?.nextCheck > Date.now()) return json({key,status:'pending'},202,600);
    const number = Number(receipt.issueUrl.split('/').pop());
    if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid cached issue number.');
    const markerText = evidenceMarker(fingerprint);
    const issueResponse = await this.github(`/issues/${number}`);
    if (!issueResponse.ok) throw new Error('Cannot read existing hardware issue.');
    const issue = await issueResponse.json();
    if (issue.number !== number || issue.pull_request) throw new Error('Invalid hardware issue.');
    if ((issue.body || '').includes(markerText)) return this.saveIssue(key,issue,200,fingerprint);
    // Recover lost comment responses before sending anything. Stop at the bound,
    // rather than risk a duplicate when the full comment history cannot be read.
    let complete = false;
    for (let page=1;page<=5;page++) {
      const response = await this.github(`/issues/${number}/comments?per_page=100&page=${page}`);
      if (!response.ok) throw new Error('Cannot read hardware evidence comments.');
      const comments = await response.json();
      if (!Array.isArray(comments)) throw new Error('Invalid comment response.');
      if (comments.some(c => (c.body || '').includes(markerText))) return this.saveIssue(key,issue,200,fingerprint);
      if (comments.length < 100) { complete = true; break; }
    }
    if (!complete) throw new Error('Hardware comment history exceeds safety bound.');
    if (previous?.pending) {
      await this.storage.put(evidenceKey,{...previous,nextCheck:Date.now()+600000});
      return json({key,status:'pending'},202,600);
    }
    const count = (await this.storage.get(`evidence-count:${key}`)) || 0;
    const day = new Date().toISOString().slice(0,10), budget = await this.storage.get('evidence-budget');
    if (count >= 8 || (budget?.day === day && budget.count >= 20)) return json({error:'Evidence update limit reached.'},429,86400);
    await this.storage.put(`evidence-count:${key}`,count+1);
    await this.storage.put('evidence-budget',{day,count:budget?.day === day ? budget.count+1 : 1});
    await this.storage.put(evidenceKey,{pending:true,nextCheck:Date.now()+600000});
    const response = await this.github(`/issues/${number}/comments`,{method:'POST',body:JSON.stringify({body:reportBody(report,fingerprint)})});
    if (response.status !== 201) {
      if ([400,401,403,404,410,422,429].includes(response.status)) {
        await this.storage.delete(evidenceKey);
        await this.storage.put(`evidence-count:${key}`,count);
      }
      return json({error:'GitHub did not confirm evidence delivery.'},503,600);
    }
    return this.saveIssue(key,issue,200,fingerprint);
  }
  async resolve(confirmation) {
    if (!this.env.GITHUB_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(this.env.GITHUB_REPOSITORY || '')) return json({error:'Service not configured.'},503,3600);
    const model=supportedConfirmation(confirmation),key=reportKey(confirmation);
    // Never trust a client-supplied "supported" flag, issue URL, or model name alone.
    // The server must have a driver for this exact VID/PID and confirmed model.
    if(!model)return json({key,status:'unsupported'},409);
    const resolved=await this.storage.get(`resolved:${key}`);
    if(resolved)return json(resolved);
    const minute=Math.floor(Date.now()/60000),quota=await this.storage.get('scan-quota');
    if(quota?.minute===minute&&quota.count>=10)return json({error:'Busy. Retry later.'},429,60);
    await this.storage.put('scan-quota',{minute,count:quota?.minute===minute?quota.count+1:1});
    const receipt=await this.storage.get(`report:${key}`);
    let issue;
    if(receipt?.issueUrl) {
      const number=Number(receipt.issueUrl.split('/').pop());
      if(!Number.isSafeInteger(number)||number<1)throw new Error('Invalid cached issue number.');
      const response=await this.github(`/issues/${number}`);
      if(!response.ok)throw new Error('Cannot read associated hardware issue.');
      issue=await response.json();
      if(issue.number!==number)throw new Error('Unexpected hardware issue.');
    } else issue=await this.existingIssue({...confirmation,model:model.name});
    if(!issue)return json({key,status:'no-issue'});
    if(!Number.isSafeInteger(issue.number)||issue.number<1)throw new Error('Invalid hardware issue.');
    const issueUrl=`https://github.com/${this.env.GITHUB_REPOSITORY}/issues/${issue.number}`;
    // Shared IDs and manually maintained discussions need maintainer judgment.
    // Only the reporter's own matching support issue can be closed automatically.
    if(issue.pull_request || !(issue.body||'').includes(marker(key)))return json({key,issueUrl,status:'manual-review'});
    if(issue.state!=='closed') {
      const response=await this.github(`/issues/${issue.number}`,{method:'PATCH',body:JSON.stringify({state:'closed',state_reason:'completed'})});
      if(!response.ok)throw new Error('GitHub did not confirm issue closure.');
      const updated=await response.json();
      if(updated.number!==issue.number||updated.state!=='closed')throw new Error('Invalid issue closure response.');
    }
    const result={key,issueUrl,status:'closed'};
    await this.storage.put(`resolved:${key}`,result);
    return json(result);
  }
  async report(report) {
    if (!this.env.GITHUB_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(this.env.GITHUB_REPOSITORY || '')) return json({ error: 'Service not configured.' }, 503, 3600);
    const key = reportKey(report), storageKey = `report:${key}`, previous = await this.storage.get(storageKey);
    const fingerprint = report.version === 2 ? await reportFingerprint(report) : null;
    if (previous?.issueUrl && (!fingerprint || (await this.storage.get(`evidence:${key}:${fingerprint}`))?.delivered)) return json({...previous,...(fingerprint ? {fingerprint} : {})});
    if (previous?.nextCheck > Date.now()) return json({ key, status: 'pending' }, 202, 600);
    // Bound all uncached GitHub scans as well as creates; anonymous callers cannot trigger unlimited API calls.
    const minute = Math.floor(Date.now() / 60000), quota = await this.storage.get('scan-quota');
    if (quota?.minute === minute && quota.count >= 10) return json({ error: 'Busy. Retry later.' }, 429, 60);
    await this.storage.put('scan-quota', { minute, count: quota?.minute === minute ? quota.count + 1 : 1 });
    if (previous?.issueUrl) return this.supplement(report,previous,fingerprint);
    const existing = await this.existingIssue(report);
    if (existing) {
      if (!fingerprint || (existing.body || '').includes(evidenceMarker(fingerprint))) return this.saveIssue(key,existing,200,fingerprint);
      const receipt = await (await this.saveIssue(key,existing,200)).json();
      return this.supplement(report,receipt,fingerprint);
    }
    if (previous?.pending) {
      // A timed-out POST might have succeeded. Reconcile, but never blindly create again.
      await this.storage.put(storageKey, { ...previous, nextCheck: Date.now() + 600000 });
      return json({ key, status: 'pending' }, 202, 600);
    }
    const day = new Date().toISOString().slice(0,10), budget = await this.storage.get('create-budget');
    if (budget?.day === day && budget.count >= 20) return json({ error: 'Daily new-model limit reached.' }, 429, 86400);
    await this.storage.put('create-budget', { day, count: budget?.day === day ? budget.count + 1 : 1 });
    await this.storage.put(storageKey, { pending: true, nextCheck: Date.now() + 600000 });
    const body = reportBody(report,fingerprint);
    const response = await this.github('/issues', { method: 'POST', body: JSON.stringify({ title: `Unsupported mouse: ${report.model} [${key}]`, body }) });
    if (response.status !== 201) {
      // These are definite rejections, so a later retry is safe. 5xx/timeouts stay pending.
      if ([400,401,403,404,410,422,429].includes(response.status)) await this.storage.delete(storageKey);
      return json({ error: 'GitHub did not confirm creation.' }, 503, 600);
    }
    return this.saveIssue(key, await response.json(), 201, fingerprint);
  }
}

export default {
  async fetch(request, env) {
    const route=new URL(request.url).pathname;
    if (!['/hardware-report','/hardware-resolution'].includes(route)) return json({ error: 'Not found.' }, 404);
    if (request.method !== 'POST') return json({ error: 'POST required.' }, 405);
    let report;
    try { report = await readPayload(request,route==='/hardware-resolution'?normalizeConfirmation:normalizeReport); } catch { return json({ error: 'Invalid hardware report.' }, 400); }
    // One durable coordinator per repository serializes checks and creates across all users.
    const id = env.HARDWARE_ISSUES.idFromName(env.GITHUB_REPOSITORY);
    return env.HARDWARE_ISSUES.get(id).fetch(new Request(request.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) }));
  }
};
